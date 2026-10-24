import fs from "node:fs";
import path from "node:path";
import { convert, checkInput, snapshot } from "../../core/pipeline.js";
import { probeMedia, countFrames, runFfmpeg, buildMuxArgs } from "../../core/ffmpeg.js";
import { presetNames } from "../../core/presets.js";
import { findBrowser, installBrowser } from "../../core/browser.js";
import { TockError } from "../../errors.js";

/** Settings shared by every command that opens a page. */
export const PAGE_FLAGS = {
  preset: { type: "string", desc: `Size preset: ${presetNames().join(", ")}` },
  width: { type: "number", desc: "Frame width in pixels" },
  height: { type: "number", desc: "Frame height in pixels" },
  fps: { type: "number", desc: "Frames per second (default 30)" },
  duration: { type: "time", desc: "Video length, e.g. 12 or 12s or 1:30" },
  start: { type: "string", desc: 'CSS selector to click at 0s (e.g. "#go")' },
  recipe: { type: "string", choices: ["timeline", "autoscroll"], desc: "autoscroll scrolls a long static page" },
  seed: { type: "number", desc: "Random seed for Math.random (default 1337)" },
  browser: { type: "string", desc: "Path to Chrome/Chromium/Edge to use" }
};

export const RENDER_FLAGS = {
  output: { type: "string", alias: "o", desc: "Output file (default: next to the input)" },
  format: { type: "string", choices: ["mp4", "webm", "gif"], desc: "mp4 (default), webm or gif" },
  ...PAGE_FLAGS,
  from: { type: "time", desc: "Render only from this time" },
  to: { type: "time", desc: "Render only until this time" },
  workers: { type: "number", desc: "Parallel browser pages (default: automatic)" },
  crf: { type: "number", desc: "Quality 0-51, lower is better (default 18)" },
  fast: { type: "boolean", desc: "Faster, slightly lower quality (JPEG frames)" },
  voice: { type: "string", desc: "Voice-over audio file to add" },
  "auto-fit": { type: "boolean", desc: "Stretch the animation to match the voice-over length" },
  tail: { type: "time", desc: "Seconds to hold after the voice-over ends (default 0.6)" },
  "voice-offset": { type: "time", desc: "Delay the voice-over by this many seconds" },
  music: { type: "string", desc: "Background music file (loops, fades out)" },
  "music-volume": { type: "number", desc: "Music volume 0-1 (default 0.25)" },
  duck: { type: "boolean", desc: "Lower the music while the voice speaks" },
  tts: { type: "string", desc: "Narration text to speak with ElevenLabs" },
  "voice-id": { type: "string", desc: "ElevenLabs voice ID" },
  "gif-fps": { type: "number", desc: "GIF frame rate (default 15)" },
  "gif-width": { type: "number", desc: "GIF width in pixels (default 640)" }
};

/** Make sure a browser exists; offer to download one if we are in a terminal. */
export async function ensureBrowser(ui, flags) {
  if (await findBrowser({ browserPath: flags.browser })) return;
  ui.warn("No browser found yet. TockMux needs Chromium to draw your page (one-time, about 150 MB).");
  const yes = await ui.confirm("Download it now?");
  if (!yes) {
    throw new TockError("A browser is required.", { hint: "Run:  tockmux setup\nOr install Google Chrome / Edge and TockMux will find it.", code: "BROWSER_MISSING" });
  }
  const sp = ui.spinner("Downloading Chromium");
  try {
    await installBrowser();
    sp.succeed("Chromium installed");
  } catch (e) {
    sp.fail("Download failed");
    throw e;
  }
}

function normalizeFlags(flags) {
  const f = { ...flags };
  if (f.fast) {
    f.quality = "jpeg";
    f.encoderPreset = "ultrafast";
  }
  return f;
}

export const renderCommand = {
  name: "render",
  aliases: ["convert", "compile", "build"],
  summary: "Turn an .html or .tmx file into MP4 / GIF / WebM",
  usage: ["tockmux render <file.html|file.tmx> [options]"],
  examples: [
    "tockmux render promo.html",
    "tockmux render promo.html --preset tiktok -o promo-vertical.mp4",
    "tockmux render promo.html --voice narration.mp3 --auto-fit",
    "tockmux render story.tmx --format gif"
  ],
  flags: RENDER_FLAGS,
  async run({ positional, flags, ui }) {
    const input = positional[0];
    if (!input) throw new TockError("Tell me which file to render.", { hint: "Example: tockmux render promo.html\nNo file yet? Run: tockmux init", code: "NO_INPUT" });
    const f = normalizeFlags(flags);
    ui.banner({ compact: true });
    await ensureBrowser(ui, f);
    const bar = ui.progress("Rendering");
    let sp = ui.spinner("Reading " + path.basename(input));
    let planned = false;
    const result = await convert({
      input,
      flags: f,
      hooks: {
        onPlan({ plan, settings, output, format, voice, timeScale }) {
          planned = true;
          sp.succeed(`Read ${ui.c.bold(path.basename(input))} ${ui.c.gray("(" + (plan.kind === "tmx" ? ".tmx script" : "HTML page") + ")")}`);
          const src = { flag: "set by you", meta: "from the file", tmx: "from the file", detected: "detected from CSS", default: "default", preset: "preset" };
          ui.kv([
            ["Output", ui.c.bold(ui.rel(output))],
            ["Size", `${settings.width}x${settings.height} at ${settings.fps} fps`],
            ["Length", `${settings.duration}s ${ui.c.gray("(" + src[settings.sources.duration] + ")")}, ${Math.round(settings.duration * settings.fps)} frames`],
            ...(voice ? [["Voice-over", path.basename(voice) + (timeScale !== 1 ? ui.c.gray(`  animation stretched x${(1 / timeScale).toFixed(2)}`) : "")]] : []),
            ...(plan.music ? [["Music", path.basename(plan.music)]] : []),
            ...(settings.actions.some((a) => a.type === "click" && a.at === 0) ? [["Start", `clicks ${settings.actions.find((a) => a.type === "click").selector} at 0s${settings.sources.start === "guessed" ? ui.c.gray("  (guessed from the page; --start none to disable)") : ""}`]] : []),
            ["Format", format.toUpperCase()]
          ]);
          if (settings.sources.duration === "default") {
            ui.warn('No length found, using 10s. Add <meta name="html2mp4:duration" content="12"> or pass --duration 12.');
          }
          ui.write();
          sp = null;
        },
        onLog(msg) {
          if (planned && !ui.caps.isTTY) ui.dim(msg);
        },
        onVoiceEvent(e) {
          if (e.type === "rotate") ui.warn(`Account "${e.account}": ${e.reason}, switching to the next account`);
        },
        onProgress: (p) => bar.update(p)
      }
    }).catch((e) => {
      bar.done();
      sp?.fail("Could not start");
      throw e;
    });
    bar.done();
    if (ui.json) return { json: result };
    ui.write();
    ui.box(
      [
        `${ui.c.mint(ui.sym.ok)} ${ui.c.bold("Video ready")}`,
        ui.c.bold(ui.rel(result.output)),
        `${result.width}x${result.height}  ${ui.sym.dot}  ${result.fps} fps  ${ui.sym.dot}  ${result.durationSec}s  ${ui.sym.dot}  ${ui.fmtBytes(result.bytes)}`,
        ui.c.gray(`rendered in ${result.elapsedSec}s${result.workers > 1 ? ` with ${result.workers} workers` : ""}${result.hasAudio ? "  " + ui.sym.dot + "  with audio" : ""}`)
      ],
      { color: "mint" }
    );
    for (const w of result.warnings) ui.warn(w);
    for (const n of result.notes) ui.info(n);
    if (!result.hasAudio && result.format === "mp4" && !result.warnings.length) {
      ui.write();
      ui.dim("Next: add a narration with  --voice narration.mp3 --auto-fit");
    }
    ui.write();
  }
};

export const checkCommand = {
  name: "check",
  aliases: ["lint", "preflight"],
  summary: "Test whether a file will convert well (before you wait for a render)",
  usage: ["tockmux check <file.html|file.tmx> [options]"],
  examples: ["tockmux check promo.html", "tockmux check promo.html --static"],
  flags: { static: { type: "boolean", desc: "Skip opening the page in a browser (faster, less thorough)" }, ...PAGE_FLAGS, voice: { type: "string", desc: "Voice-over file to verify" }, music: { type: "string", desc: "Music file to verify" } },
  async run({ positional, flags, ui }) {
    const input = positional[0];
    if (!input) throw new TockError("Tell me which file to check.", { hint: "Example: tockmux check promo.html", code: "NO_INPUT" });
    ui.banner({ compact: true });
    if (!flags.static) await ensureBrowser(ui, flags);
    const sp = ui.spinner(flags.static ? "Reading file" : "Opening the page in a browser");
    let out;
    try {
      out = await checkInput({ input, flags, live: !flags.static });
      sp.succeed("Checked " + ui.c.bold(path.basename(input)));
    } catch (e) {
      sp.fail("Check failed");
      throw e;
    }
    if (ui.json) return { json: { ok: out.report.ok, rows: out.report.rows, settings: out.plan.settings }, exitCode: out.report.ok ? 0 : 1 };
    ui.write();
    ui.checklist(out.report.rows);
    ui.write();
    const warns = out.report.rows.filter((r) => r.status === "warn").length;
    if (!out.report.ok) ui.error("Not ready to render", "Fix the items marked above, then run check again.");
    else if (warns) ui.warn(`Ready, with ${warns} thing${warns > 1 ? "s" : ""} worth a look.`);
    else ui.success("All good. Render it with:  " + ui.c.bold(`tockmux render ${input}`));
    ui.write();
    return { exitCode: out.report.ok ? 0 : 1 };
  }
};

export const frameCommand = {
  name: "frame",
  aliases: ["poster", "screenshot"],
  summary: "Save one frame (a poster image) at a given time",
  usage: ["tockmux frame <file> --at 3s [-o poster.png]"],
  examples: ["tockmux frame promo.html --at 2.5", "tockmux frame story.tmx --at 0:04 -o thumb.jpg"],
  flags: { at: { type: "time", desc: "Time of the frame (default 0)" }, output: { type: "string", alias: "o", desc: "Image file (.png or .jpg)" }, ...PAGE_FLAGS },
  async run({ positional, flags, ui }) {
    const input = positional[0];
    if (!input) throw new TockError("Tell me which file to capture.", { hint: "Example: tockmux frame promo.html --at 3s", code: "NO_INPUT" });
    await ensureBrowser(ui, flags);
    const at = flags.at ?? 0;
    const out = path.resolve(flags.output || path.join(path.dirname(input), path.basename(input, path.extname(input)) + ".png"));
    const type = /\.jpe?g$/i.test(out) ? "jpeg" : "png";
    const sp = ui.spinner(`Capturing frame at ${at}s`);
    const { buffer, settings } = await snapshot({ input, flags, atSec: at, type }).catch((e) => (sp.fail("Capture failed"), Promise.reject(e)));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buffer);
    sp.succeed(`Saved ${ui.c.bold(ui.rel(out))} ${ui.c.gray(`${settings.width}x${settings.height}, ${ui.fmtBytes(buffer.length)}`)}`);
    if (ui.json) return { json: { output: out, at, width: settings.width, height: settings.height, bytes: buffer.length } };
  }
};

export function expandInputs(patterns, cwd = process.cwd()) {
  const found = [];
  const exts = /\.(html?|tmx)$/i;
  const walk = (dir, recursive, test) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && recursive && e.name !== "node_modules" && !e.name.startsWith(".")) walk(full, recursive, test);
      else if (e.isFile() && test(e.name)) found.push(full);
    }
  };
  for (const p of patterns) {
    const abs = path.resolve(cwd, p);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) walk(abs, false, (n) => exts.test(n));
    else if (/[*?]/.test(p)) {
      const recursive = p.includes("**");
      const dirPart = p.split(/[\\/]/).filter((s) => !/[*?]/.test(s));
      const baseDir = path.resolve(cwd, dirPart.join(path.sep) || ".");
      const last = p.split(/[\\/]/).pop();
      const re = new RegExp("^" + last.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
      if (fs.existsSync(baseDir)) walk(baseDir, recursive, (n) => re.test(n) && exts.test(n));
    } else if (fs.existsSync(abs)) found.push(abs);
    else throw new TockError(`No such file: ${p}`, { code: "FILE_NOT_FOUND" });
  }
  return [...new Set(found)];
}

export const batchCommand = {
  name: "batch",
  aliases: [],
  summary: "Render many files at once (folders and wildcards work)",
  usage: ["tockmux batch <folder|pattern|files...> [--out-dir videos] [render options]"],
  examples: ['tockmux batch ./slides --preset tiktok --out-dir ./videos', 'tockmux batch "scenes/*.html" --format gif'],
  flags: { "out-dir": { type: "string", desc: "Folder for the finished videos" }, "stop-on-error": { type: "boolean", desc: "Stop at the first failure" }, ...Object.fromEntries(Object.entries(RENDER_FLAGS).filter(([k]) => !["output", "voice", "tts", "from", "to"].includes(k))) },
  async run({ positional, flags, ui }) {
    if (!positional.length) throw new TockError("Tell me which files or folder to render.", { hint: 'Example: tockmux batch ./slides --out-dir ./videos', code: "NO_INPUT" });
    const files = expandInputs(positional);
    if (!files.length) throw new TockError("No .html or .tmx files matched.", { code: "NO_MATCH" });
    ui.banner({ compact: true });
    await ensureBrowser(ui, flags);
    ui.step(`Rendering ${files.length} file${files.length > 1 ? "s" : ""}`);
    ui.write();
    const format = flags.format || "mp4";
    const rows = [];
    for (const [i, file] of files.entries()) {
      const out = flags.outDir ? path.join(path.resolve(flags.outDir), path.basename(file, path.extname(file)) + "." + format) : undefined;
      const bar = ui.progress(`[${i + 1}/${files.length}] ${path.basename(file)}`);
      try {
        const r = await convert({ input: file, flags: normalizeFlags({ ...flags, output: out }), hooks: { onProgress: (p) => bar.update(p) } });
        bar.done();
        ui.success(`${path.basename(file)} ${ui.c.gray(`${ui.sym.arrow} ${ui.rel(r.output)}  ${r.durationSec}s  ${ui.fmtBytes(r.bytes)}`)}`);
        r.warnings.forEach((w) => ui.warn(w));
        rows.push({ file, ok: true, output: r.output, seconds: r.elapsedSec });
      } catch (e) {
        bar.done();
        ui.write(`  ${ui.c.red(ui.sym.fail)} ${path.basename(file)} ${ui.c.gray(e.message)}`);
        rows.push({ file, ok: false, error: e.message });
        if (flags.stopOnError) break;
      }
    }
    const okN = rows.filter((r) => r.ok).length;
    ui.write();
    (okN === rows.length ? ui.success : ui.warn)(`${okN} of ${rows.length} finished.`);
    if (ui.json) return { json: rows, exitCode: okN === rows.length ? 0 : 1 };
    return { exitCode: okN === rows.length ? 0 : 1 };
  }
};

export const syncCommand = {
  name: "sync",
  aliases: [],
  summary: "Add a voice-over (and music) to an MP4 you already have",
  usage: ["tockmux sync <video.mp4> <voice.mp3> [-o final.mp4] [options]"],
  examples: ["tockmux sync promo.mp4 narration.mp3 -o final.mp4", "tockmux sync promo.mp4 narration.mp3 --stretch --music bg.mp3 --duck"],
  flags: {
    output: { type: "string", alias: "o", desc: "Output file (default: <video>-synced.mp4)" },
    stretch: { type: "boolean", desc: "Slow or speed the video so it ends exactly with the voice-over" },
    "voice-offset": { type: "time", desc: "Delay the voice-over by this many seconds" },
    music: { type: "string", desc: "Background music file" },
    "music-volume": { type: "number", desc: "Music volume 0-1 (default 0.25)" },
    duck: { type: "boolean", desc: "Lower the music while the voice speaks" }
  },
  async run({ positional, flags, ui }) {
    const [video, voice] = positional;
    if (!video || !voice) throw new TockError("Give me a video and a voice-over file.", { hint: "Example: tockmux sync promo.mp4 narration.mp3 -o final.mp4", code: "NO_INPUT" });
    const vm = await probeMedia(video);
    if (!vm.video) throw new TockError(`${video} has no video stream.`, { code: "BAD_INPUT" });
    const am = await probeMedia(voice);
    if (!am.audio) throw new TockError(`${voice} has no audio stream.`, { code: "BAD_INPUT" });
    const out = path.resolve(flags.output || video.replace(/\.[^.]+$/, "") + "-synced.mp4");
    const tmp = out.replace(/\.mp4$/i, "") + ".tmp-stretch.mp4";
    let source = path.resolve(video);
    let dur = vm.duration;
    ui.banner({ compact: true });
    const sp = ui.spinner("Mixing audio");
    try {
      if (flags.stretch) {
        const ratio = (am.duration + (flags.voiceOffset || 0)) / vm.duration;
        await runFfmpeg(["-y", "-i", source, "-vf", `setpts=PTS*${ratio.toFixed(6)}`, "-r", String(vm.video.fps || 30), "-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", tmp]);
        source = tmp;
        dur = am.duration + (flags.voiceOffset || 0);
      } else if (am.duration + (flags.voiceOffset || 0) > vm.duration + 0.25) {
        ui.warn(`The voice-over (${am.duration}s) is longer than the video (${vm.duration}s) and will be cut. Add --stretch to fit the video to it.`);
      }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await runFfmpeg(buildMuxArgs({ video: source, out, duration: dur, voice: path.resolve(voice), music: flags.music ? path.resolve(flags.music) : null, musicVolume: flags.musicVolume ?? 0.25, duck: flags.duck, voiceOffset: flags.voiceOffset || 0 }));
    } catch (e) {
      sp.fail("Could not mix the audio");
      throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    sp.succeed(`Saved ${ui.c.bold(ui.rel(out))}`);
    if (ui.json) return { json: { output: out, ...(await probeMedia(out)) } };
  }
};

export const probeCommand = {
  name: "probe",
  aliases: ["info"],
  summary: "Show the length, size and audio of a video or audio file",
  usage: ["tockmux probe <media-file> [--frames]"],
  examples: ["tockmux probe promo.mp4 --frames"],
  flags: { frames: { type: "boolean", desc: "Also count the exact number of frames" } },
  async run({ positional, flags, ui }) {
    if (!positional[0]) throw new TockError("Tell me which file to inspect.", { hint: "Example: tockmux probe promo.mp4", code: "NO_INPUT" });
    const m = await probeMedia(positional[0]);
    const frames = flags.frames && m.video ? await countFrames(positional[0]) : undefined;
    if (ui.json) return { json: { ...m, frames } };
    ui.banner({ compact: true });
    ui.kv([
      ["File", path.basename(m.file)],
      ["Length", `${m.duration}s`],
      ["Size", ui.fmtBytes(m.bytes)],
      ["Video", m.video ? `${m.video.codec}, ${m.video.width}x${m.video.height}${m.video.fps ? ", " + m.video.fps + " fps" : ""}` : "none"],
      ["Audio", m.audio ? `${m.audio.codec}, ${m.audio.sampleRate} Hz` : "none"],
      ...(frames !== undefined ? [["Frames", String(frames)]] : [])
    ]);
    ui.write();
  }
};
