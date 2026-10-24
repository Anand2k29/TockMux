import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { convert, checkInput, snapshot } from "../core/pipeline.js";
import { parseTmx } from "../tmx/parser.js";
import { compileTmxToHtml } from "../tmx/compiler.js";
import { probeMedia } from "../core/ffmpeg.js";
import { PRESETS } from "../core/presets.js";
import { THEMES } from "../tmx/themes.js";
import { VoiceStore } from "../voice/store.js";
import { VoicePool } from "../voice/pool.js";
import { getVersion } from "../version.js";
import { TockError } from "../errors.js";

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const CONTRACT = `# Writing HTML that TockMux can turn into a video

TockMux opens your page in a browser, controls the clock, takes one screenshot per frame and
encodes an MP4. For a clean result:

1. **The page must animate by itself.** CSS animations/transitions, requestAnimationFrame,
   setTimeout/setInterval, GSAP, anime.js, canvas, SVG and Lottie all work. Scroll-, hover- or
   click-driven pages do not (use start="#button" to click something at 0s).
2. **Declare the video in <head>:**
   <meta name="html2mp4:duration" content="12">   (seconds)
   <meta name="html2mp4:width" content="1920">
   <meta name="html2mp4:height" content="1080">
3. **Fix the stage size.** Use html,body{width:100%;height:100%;overflow:hidden}. Design for the
   declared width and height (or a preset: youtube, tiktok, square, portrait, cinema, hd720, 4k).
4. **Keep everything reachable.** Inline images as data: URIs or keep files next to the HTML.
   Remote fonts/CDNs work only with internet access.
5. **No pop-ups.** No alert(), cookie banners or permission prompts.
6. **Randomness is seeded**, so Math.random() gives the same result on every render.
7. **Sound is not captured from the page.** Provide a separate voice-over/music file instead.
8. Optional: define window.__seek = (ms) => {...} to render a pure function of time.

Workflow: write the file, call check_html, fix any warnings, call snapshot_frame to look at a
few moments, then render_video.`;

const pathProp = { type: "string", description: "File path inside the allowed folder (relative paths are resolved against it)." };
const sourceProps = {
  path: pathProp,
  source: { type: "string", description: "Inline HTML or .tmx text, used instead of path." },
  kind: { type: "string", enum: ["html", "tmx"], description: "What `source` contains. Default html." }
};
const pageProps = {
  preset: { type: "string", enum: Object.keys(PRESETS), description: "Size preset (youtube 1920x1080, tiktok 1080x1920, square, portrait, cinema 60fps, hd720, 4k)." },
  width: { type: "integer" },
  height: { type: "integer" },
  fps: { type: "integer" },
  duration: { type: "number", description: "Video length in seconds (overrides the file)." },
  start: { type: "string", description: 'CSS selector to click at 0s, e.g. "#go".' }
};

const TOOLS = [
  {
    name: "check_html",
    description: "Pre-flight check of an HTML page or .tmx script. Opens it in a browser and reports whether it animates, whether assets load, the detected size/duration and any problems. Run this before render_video.",
    inputSchema: { type: "object", properties: { ...sourceProps, ...pageProps }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "render_video",
    description: "Render an HTML page or .tmx script to MP4 (or GIF/WebM). Deterministic: every frame is drawn at an exact time. Optionally add a voice-over (auto_fit stretches the animation to its length) and music. Can take a minute or more for long videos.",
    inputSchema: {
      type: "object",
      properties: {
        ...sourceProps,
        ...pageProps,
        output: { type: "string", description: "Output file path (default: tockmux-output/<name>.<format>)." },
        format: { type: "string", enum: ["mp4", "webm", "gif"] },
        voice: { type: "string", description: "Voice-over audio file path." },
        music: { type: "string", description: "Background music file path." },
        auto_fit: { type: "boolean", description: "Stretch the animation to match the voice-over length." },
        narration: { type: "string", description: "Text to speak with ElevenLabs (needs a connected account) instead of a voice file." },
        workers: { type: "integer", description: "Parallel browser pages (default automatic)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "snapshot_frame",
    description: "Capture one frame at a given time and return it as an image so you can see how the video will look. Also saves a PNG if `output` is given.",
    inputSchema: { type: "object", properties: { ...sourceProps, ...pageProps, at: { type: "number", description: "Time in seconds (default 0)." }, output: { type: "string", description: "Optional PNG file to save." } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "compile_tmx",
    description: "Compile .tmx video script text into the HTML page it describes, with line-numbered diagnostics. Does not render.",
    inputSchema: { type: "object", properties: { source: { type: "string" } }, required: ["source"], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "list_presets",
    description: "List size presets and .tmx themes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "probe_media",
    description: "Read length, resolution, fps and audio info of a video or audio file.",
    inputSchema: { type: "object", properties: { path: pathProp }, required: ["path"], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "speak_text",
    description: "Turn text into a narration MP3 using the ElevenLabs accounts connected with `tockmux voice add` (automatic failover between accounts).",
    inputSchema: { type: "object", properties: { text: { type: "string" }, output: { type: "string", description: "MP3 path (default narration.mp3)." }, voice_id: { type: "string" } }, required: ["text"], additionalProperties: false }
  }
];

const PROMPTS = [
  {
    name: "make_html_video",
    description: "Guide for writing an animated HTML page and turning it into an MP4 with TockMux.",
    arguments: [
      { name: "topic", description: "What the video is about", required: true },
      { name: "seconds", description: "Target length in seconds (default 12)", required: false },
      { name: "format", description: "youtube, tiktok, square... (default youtube)", required: false }
    ]
  }
];

export function createMcpHandler({ root = process.cwd() } = {}) {
  const rootAbs = path.resolve(root);
  const unrestricted = process.env.TOCKMUX_MCP_UNRESTRICTED === "1";

  const resolveInside = (p, label = "path") => {
    const abs = path.resolve(rootAbs, String(p));
    const rel = path.relative(rootAbs, abs);
    if (!unrestricted && (rel.startsWith("..") || path.isAbsolute(rel))) {
      throw new TockError(`${label} "${p}" is outside the allowed folder (${rootAbs}).`, { hint: "Use a path inside that folder, or start the server with --root.", code: "OUTSIDE_ROOT" });
    }
    return abs;
  };

  const flagsFrom = (a) => {
    const f = {};
    for (const k of ["preset", "width", "height", "fps", "duration", "start", "format", "workers"]) if (a[k] !== undefined) f[k] = a[k];
    if (a.auto_fit) f.autoFit = true;
    if (a.voice) f.voice = resolveInside(a.voice, "voice");
    if (a.music) f.music = resolveInside(a.music, "music");
    if (a.narration) f.tts = a.narration;
    return f;
  };

  const inputFrom = (a) => {
    if (a.path) return { input: resolveInside(a.path) };
    if (typeof a.source === "string") return { text: a.source, kind: a.kind || "html", baseDir: rootAbs, name: a.kind === "tmx" ? "inline.tmx" : "inline.html" };
    throw new TockError("Provide either `path` or `source`.", { code: "NO_INPUT" });
  };

  const text = (t) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }] });

  async function callTool(name, args = {}, { progress, signal } = {}) {
    switch (name) {
      case "check_html": {
        const { report, plan } = await checkInput({ ...inputFrom(args), baseDir: rootAbs, flags: flagsFrom(args) });
        return text({ ok: report.ok, settings: { width: plan.settings.width, height: plan.settings.height, fps: plan.settings.fps, duration: plan.settings.duration }, checks: report.rows.map((r) => ({ check: r.label, status: r.status, detail: r.detail, ...(r.fix ? { fix: r.fix } : {}) })) });
      }
      case "render_video": {
        const flags = flagsFrom(args);
        const format = args.format || (args.output && path.extname(args.output).slice(1)) || "mp4";
        const stem = args.path ? path.basename(args.path, path.extname(args.path)) : "video";
        flags.output = args.output ? resolveInside(args.output, "output") : resolveInside(path.join("tockmux-output", `${stem}.${format}`));
        const r = await convert({
          ...inputFrom(args),
          baseDir: rootAbs,
          flags,
          hooks: { signal, onProgress: (p) => progress?.(p.done, p.total, `Rendered ${p.done} of ${p.total} frames`) }
        });
        return text({ output: r.output, format: r.format, width: r.width, height: r.height, fps: r.fps, durationSec: r.durationSec, bytes: r.bytes, renderSeconds: r.elapsedSec, hasAudio: r.hasAudio, animated: r.animated, autoFit: r.autoFit, warnings: r.warnings });
      }
      case "snapshot_frame": {
        const { buffer, settings } = await snapshot({ ...inputFrom(args), baseDir: rootAbs, flags: flagsFrom(args), atSec: args.at || 0, type: "jpeg" });
        let saved = "";
        if (args.output) {
          const out = resolveInside(args.output, "output");
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, buffer);
          saved = ` Saved to ${out}.`;
        }
        return { content: [{ type: "text", text: `Frame at ${args.at || 0}s, ${settings.width}x${settings.height}.${saved}` }, { type: "image", data: buffer.toString("base64"), mimeType: "image/jpeg" }] };
      }
      case "compile_tmx": {
        const ast = parseTmx(args.source || "");
        return text({ ok: !ast.diagnostics.some((d) => d.level === "error"), diagnostics: ast.diagnostics, duration: ast.duration, size: `${ast.width}x${ast.height}`, html: ast.diagnostics.some((d) => d.level === "error") ? undefined : compileTmxToHtml(ast) });
      }
      case "list_presets":
        return text({ presets: PRESETS, themes: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.label])) });
      case "probe_media":
        return text(await probeMedia(resolveInside(args.path)));
      case "speak_text": {
        const pool = new VoicePool(new VoiceStore());
        const out = resolveInside(args.output || "narration.mp3", "output");
        const r = await pool.synthesize(args.text, out, { voiceId: args.voice_id });
        return text({ output: r.output, characters: r.chars, chunks: r.chunks, usage: r.usage });
      }
      default:
        throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
    }
  }

  async function handle(msg, ctx = {}) {
    const { method, params = {} } = msg;
    switch (method) {
      case "initialize": {
        const requested = params.protocolVersion;
        return {
          protocolVersion: SUPPORTED.includes(requested) ? requested : SUPPORTED[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: "tockmux", title: "TockMux", version: getVersion() },
          instructions: "Turn animated HTML (or .tmx scripts) into MP4/GIF/WebM. Read the tockmux://contract resource for how to write compatible HTML. Typical flow: check_html, snapshot_frame, render_video."
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: TOOLS };
      case "tools/call": {
        try {
          return await callTool(params.name, params.arguments || {}, ctx);
        } catch (e) {
          if (e.rpcCode) throw e;
          return { isError: true, content: [{ type: "text", text: `${e.message}${e.hint ? "\n" + e.hint : ""}` }] };
        }
      }
      case "prompts/list":
        return { prompts: PROMPTS };
      case "prompts/get": {
        if (params.name !== "make_html_video") throw Object.assign(new Error(`Unknown prompt: ${params.name}`), { rpcCode: -32602 });
        const a = params.arguments || {};
        return {
          description: PROMPTS[0].description,
          messages: [{ role: "user", content: { type: "text", text: `Create a ${a.seconds || 12}-second animated HTML video about: ${a.topic || "(topic)"}.\nTarget format: ${a.format || "youtube"}.\n\n${CONTRACT}\n\nWrite the HTML file, then use the TockMux tools to check it, preview a few frames, and render the MP4.` } }]
        };
      }
      case "resources/list":
        return { resources: [{ uri: "tockmux://contract", name: "html-video-contract", title: "How to write HTML for TockMux", mimeType: "text/markdown" }] };
      case "resources/read":
        if (params.uri !== "tockmux://contract") throw Object.assign(new Error(`Unknown resource: ${params.uri}`), { rpcCode: -32002 });
        return { contents: [{ uri: "tockmux://contract", mimeType: "text/markdown", text: CONTRACT }] };
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { rpcCode: -32601 });
    }
  }
  return { handle, callTool, tools: TOOLS, rootAbs };
}

/** Run the server over stdio (what AI apps launch). Resolves when stdin closes. */
export async function runMcpServer({ root = process.cwd(), input = process.stdin, output = process.stdout } = {}) {
  const { handle } = createMcpHandler({ root });
  const inflight = new Map();
  const send = (obj) => output.write(JSON.stringify(obj) + "\n");
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    if (msg.method === "notifications/cancelled") {
      inflight.get(msg.params?.requestId)?.abort();
      return;
    }
    if (msg.id === undefined || msg.id === null) return; // other notifications need no reply
    if (!msg.method) return; // a response from the client: nothing to do
    const controller = new AbortController();
    inflight.set(msg.id, controller);
    const token = msg.params?._meta?.progressToken;
    let last = 0;
    const progress = token === undefined ? undefined : (done, total, message) => {
      const now = Date.now();
      if (now - last < 400 && done < total) return;
      last = now;
      send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: done, total, message } });
    };
    try {
      const result = await handle(msg, { progress, signal: controller.signal });
      send({ jsonrpc: "2.0", id: msg.id, result });
    } catch (e) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: e.rpcCode || -32603, message: e.message } });
    } finally {
      inflight.delete(msg.id);
    }
  });
  await new Promise((resolve) => rl.once("close", resolve));
  for (const c of inflight.values()) c.abort();
}
