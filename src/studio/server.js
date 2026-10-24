import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JobQueue } from "./jobs.js";
import { convert, checkInput } from "../core/pipeline.js";
import { PRESETS } from "../core/presets.js";
import { THEMES } from "../tmx/themes.js";
import { findBrowser } from "../core/browser.js";
import { mimeFor } from "../core/static-server.js";
import { compileTmxToHtml } from "../tmx/compiler.js";
import { parseTmx } from "../tmx/parser.js";
import { VoiceStore, maskKey } from "../voice/store.js";
import { VoicePool } from "../voice/pool.js";
import { getVersion, DISCORD } from "../version.js";
import { TockError } from "../errors.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_BODY = 250 * 1024 * 1024;
const SAFE_FLAGS = ["preset", "width", "height", "fps", "duration", "start", "recipe", "format", "quality", "workers", "crf", "autoFit", "tail", "voiceOffset", "musicVolume", "duck", "from", "to", "gifFps", "gifWidth", "seed", "tts", "voiceId"];

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new TockError("Upload is too large.", { hint: "The limit is 250 MB per request.", code: "TOO_LARGE" }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Keep only a safe relative path (no drive letters, no .., no absolute). */
export function safeRelative(name) {
  const norm = path.posix.normalize(String(name).replace(/\\/g, "/")).replace(/^(\.\/)+/, "");
  if (!norm || norm === "." || norm.startsWith("/") || norm.startsWith("..") || /^[a-zA-Z]:/.test(norm) || norm.includes("\0")) return null;
  return norm;
}

function writeUpload(dir, files) {
  if (!Array.isArray(files) || !files.length) throw new TockError("No files were uploaded.", { code: "NO_FILES" });
  if (files.length > 300) throw new TockError("Too many files in one upload (limit 300).", { code: "TOO_MANY" });
  const written = [];
  for (const f of files) {
    const rel = safeRelative(f.name);
    if (!rel) throw new TockError(`Unsafe file name: ${f.name}`, { code: "BAD_NAME" });
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(String(f.data || ""), "base64"));
    written.push(rel);
  }
  return written;
}

function pickFlags(raw = {}) {
  const out = {};
  for (const k of SAFE_FLAGS) if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") out[k] = raw[k];
  for (const k of ["width", "height", "fps", "duration", "workers", "crf", "tail", "voiceOffset", "musicVolume", "from", "to", "gifFps", "gifWidth", "seed"]) if (out[k] !== undefined) out[k] = Number(out[k]);
  for (const k of ["autoFit", "duck"]) if (out[k] !== undefined) out[k] = Boolean(out[k]);
  return out;
}

function findMain(written, hint) {
  if (hint && written.includes(hint)) return hint;
  return written.find((n) => /\.(html?|tmx)$/i.test(n) && !n.includes("/")) || written.find((n) => /\.(html?|tmx)$/i.test(n));
}

export async function startStudio({ port = 4321, host = "127.0.0.1", browserPath, maxJobs = 1 } = {}) {
  const queue = new JobQueue({ maxJobs });
  const voiceStore = new VoiceStore();
  let boundPort = port;
  const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]);

  const server = http.createServer(async (req, res) => {
    try {
      // Block DNS-rebinding and cross-site requests: only same-origin local access is allowed.
      if (!allowedHosts().has(String(req.headers.host || "").toLowerCase())) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("Forbidden host");
      }
      if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin && !allowedHosts().has(req.headers.origin.replace(/^https?:\/\//, ""))) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("Forbidden origin");
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      const p = url.pathname;

      if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, path.join(ROOT, "studio/index.html"));
      if (req.method === "GET" && (p === "/landing" || p === "/about")) return serveFile(res, path.join(ROOT, "site/index.html"));

      if (req.method === "GET" && p === "/api/info") {
        const b = await findBrowser({ browserPath }).catch(() => null);
        return sendJson(res, 200, { version: getVersion(), discord: DISCORD, presets: PRESETS, themes: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.label])), browserReady: Boolean(b), cpus: os.cpus().length });
      }

      if (req.method === "POST" && p === "/api/compile") {
        const { source } = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString() || "{}");
        const ast = parseTmx(source || "");
        return sendJson(res, 200, { html: compileTmxToHtml(ast), diagnostics: ast.diagnostics, duration: ast.duration, width: ast.width, height: ast.height });
      }

      if (req.method === "POST" && (p === "/api/check" || p === "/api/render")) {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tockmux-studio-"));
        let written;
        try {
          written = writeUpload(dir, body.files);
        } catch (e) {
          fs.rmSync(dir, { recursive: true, force: true });
          throw e;
        }
        const main = findMain(written, body.main);
        if (!main) {
          fs.rmSync(dir, { recursive: true, force: true });
          throw new TockError("Include an .html or .tmx file.", { code: "NO_MAIN" });
        }
        const flags = { ...pickFlags(body.flags), browser: browserPath };
        const audio = written.find((n) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(n) && n !== main);
        if (audio && (body.flags?.voiceFile === audio || !body.flags?.musicFile)) flags.voice = audio;
        if (body.flags?.musicFile && written.includes(body.flags.musicFile)) flags.music = body.flags.musicFile;
        if (body.flags?.voiceFile && written.includes(body.flags.voiceFile)) flags.voice = body.flags.voiceFile;
        const input = path.join(dir, main);

        if (p === "/api/check") {
          try {
            const { report, plan } = await checkInput({ input, flags, live: body.live !== false });
            return sendJson(res, 200, { ok: report.ok, rows: report.rows, settings: plan.settings });
          } finally {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
        const format = flags.format || "mp4";
        const output = path.join(dir, `${path.basename(main, path.extname(main))}.${format}`);
        const job = queue.create({
          dir,
          run: ({ signal, onProgress, onLog }) => convert({ input, flags: { ...flags, output }, hooks: { onProgress, onLog, signal } }).then((r) => ({ ...r, file: path.basename(output) }))
        });
        return sendJson(res, 202, { id: job.id, ahead: queue.ahead(job) });
      }

      const m = /^\/api\/jobs\/([a-f0-9]+)(?:\/(events|file|cancel))?$/.exec(p);
      if (m) {
        const job = queue.get(m[1]);
        if (!job) return sendJson(res, 404, { error: "Unknown or expired job" });
        if (req.method === "GET" && m[2] === "events") {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
          const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
          if (job.status === "done") send("done", slimResult(job.result));
          else if (job.status === "error" || job.status === "cancelled") send("error", job.error || { message: "Cancelled" });
          else {
            send("status", { status: job.status, ahead: queue.ahead(job) });
            if (job.progress) send("progress", job.progress);
            const off = queue.subscribe(job, ({ type, data }) => {
              send(type, type === "done" ? slimResult(data) : data);
              if (type === "done" || type === "error") {
                off();
                res.end();
              }
            });
            req.on("close", off);
            return;
          }
          return res.end();
        }
        if (req.method === "GET" && m[2] === "file") {
          if (job.status !== "done") return sendJson(res, 409, { error: "Not finished" });
          const file = job.result.output;
          const stat = fs.statSync(file);
          const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
          const name = path.basename(file);
          const headers = { "Content-Type": mimeFor(file), "Accept-Ranges": "bytes", "Cache-Control": "no-store", ...(url.searchParams.get("inline") ? {} : { "Content-Disposition": `attachment; filename="${name}"` }) };
          if (range) {
            const start = range[1] ? parseInt(range[1], 10) : 0;
            const end = range[2] ? Math.min(parseInt(range[2], 10), stat.size - 1) : stat.size - 1;
            res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
            return fs.createReadStream(file, { start, end }).pipe(res);
          }
          res.writeHead(200, { ...headers, "Content-Length": stat.size });
          return fs.createReadStream(file).pipe(res);
        }
        if (req.method === "POST" && m[2] === "cancel") return sendJson(res, 200, { cancelled: queue.cancel(job.id) });
      }

      if (p === "/api/voice") {
        if (req.method === "GET") {
          return sendJson(res, 200, voiceStore.load().all().map((a) => ({ name: a.name, key: maskKey(a.apiKey), status: a.status, used: a.characterCount || 0, limit: a.characterLimit ?? null, fromEnv: Boolean(a.fromEnv) })));
        }
        if (req.method === "POST") {
          const b = JSON.parse((await readBody(req, 64 * 1024)).toString() || "{}");
          if (!b.name || !b.key) throw new TockError("Name and API key are required.", { code: "BAD_REQUEST" });
          voiceStore.add({ name: String(b.name).slice(0, 40), apiKey: String(b.key).trim() });
          const pool = new VoicePool(voiceStore);
          const [r] = await pool.refresh([String(b.name).slice(0, 40)]);
          return sendJson(res, 200, { ok: true, check: r || null });
        }
        if (req.method === "DELETE") {
          voiceStore.remove(url.searchParams.get("name") || "");
          return sendJson(res, 200, { ok: true });
        }
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (e) {
      if (res.headersSent) return res.end();
      sendJson(res, e instanceof SyntaxError ? 400 : 500, { error: e.message, hint: e.hint || "" });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", (e) => reject(e.code === "EADDRINUSE" ? new TockError(`Port ${port} is already in use.`, { hint: `Try another one: tockmux studio --port ${port + 1}`, code: "PORT_BUSY" }) : e));
    server.listen(port, host, resolve);
  });
  boundPort = server.address().port;
  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    server,
    queue,
    close: () =>
      new Promise((resolve) => {
        queue.close();
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
  };
}

function slimResult(r) {
  return { file: r.file, bytes: r.bytes, width: r.width, height: r.height, fps: r.fps, durationSec: r.durationSec, elapsedSec: r.elapsedSec, workers: r.workers, animated: r.animated, warnings: r.warnings, notes: r.notes, hasAudio: r.hasAudio, format: r.format };
}

function serveFile(res, file) {
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, { "Content-Type": mimeFor(file), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}
