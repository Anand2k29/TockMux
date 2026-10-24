import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findBrowser } from "../src/core/browser.js";
import { resolveFfmpeg } from "../src/core/ffmpeg.js";
import { writeToneWav } from "../src/core/wav.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "bin", "tockmux.js");

export function tmpDir(prefix = "tmx-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function browserAvailable() {
  if (process.env.TOCKMUX_NO_RENDER === "1") return false;
  return Boolean(await findBrowser({}));
}

/** Small page: a 60px red square whose left edge is x = speed * t (pixels, t in seconds). */
export function squareHtml({ mode = "raf", seconds = 2, w = 320, h = 180, speed = 100, extraHead = "" } = {}) {
  const head = `<meta name="html2mp4:duration" content="${seconds}"><meta name="html2mp4:width" content="${w}"><meta name="html2mp4:height" content="${h}">${extraHead}`;
  const box = `<div id="b" style="position:absolute;left:0;top:60px;width:40px;height:40px;background:#f00"></div>`;
  const body = {
    raf: `<script>let s=null;function tk(ts){if(s===null)s=ts;document.getElementById('b').style.left=((ts-s)/1000*${speed})+'px';requestAnimationFrame(tk)}requestAnimationFrame(tk)</script>`,
    timers: `<script>let x=0;setInterval(()=>{x+=${speed / 25};document.getElementById('b').style.left=x+'px'},40)</script>`,
    css: `<style>#b{animation:m ${seconds}s linear forwards}@keyframes m{from{left:0}to{left:${speed * seconds}px}}</style>`,
    date: `<script>const t0=Date.now();setInterval(()=>{document.getElementById('b').style.left=((Date.now()-t0)/1000*${speed})+'px'},10)</script>`,
    perf: `<script>function tk(){document.getElementById('b').style.left=(performance.now()/1000*${speed})+'px';requestAnimationFrame(tk)}tk()</script>`
  }[mode];
  return `<!doctype html><html><head>${head}</head><body style="margin:0;background:#000;overflow:hidden">${box}${body}</body></html>`;
}

export function write(dir, name, content) {
  const f = path.join(dir, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  return f;
}

export function runCli(args, { env = {}, cwd, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function ffmpegRun(args) {
  const bin = await resolveFfmpeg();
  return new Promise((resolve) => {
    const c = spawn(bin, ["-hide_banner", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    c.stdout.on("data", (b) => out.push(b));
    c.stderr.on("data", (b) => (err += b));
    c.on("close", () => resolve({ stdout: Buffer.concat(out), stderr: err }));
  });
}

/** Average PSNR (dB) between two videos. Higher is closer; 'inf' for identical. */
export async function psnr(a, b) {
  const { stderr } = await ffmpegRun(["-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"]);
  const m = /average:(\S+)/.exec(stderr);
  if (!m) return 0;
  return m[1] === "inf" ? Infinity : Number(m[1]);
}

/** MD5 of every decoded frame (hex of the whole raw stream). */
export async function rawHash(file) {
  const { stdout } = await ffmpegRun(["-loglevel", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(stdout).digest("hex");
}

/** Find the x of the left edge of the red square at a time by scanning one row. */
export async function squareLeftEdge(file, timeSec, y = 80, width = 320) {
  const { stdout } = await ffmpegRun(["-loglevel", "error", "-ss", String(timeSec), "-i", file, "-frames:v", "1", "-vf", `format=rgb24,crop=${width}:1:0:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  for (let x = 0; x < width; x++) {
    const r = stdout[x * 3], g = stdout[x * 3 + 1], b = stdout[x * 3 + 2];
    if (r > 128 && g < 100 && b < 100) return x;
  }
  return -1;
}

export function toneWav(dir, name = "voice.wav", seconds = 3) {
  return writeToneWav(path.join(dir, name), seconds);
}

/** A local server that imitates the ElevenLabs endpoints we use. */
export async function mockElevenLabs(accounts) {
  // accounts: { KEY: { limit, used, invalid?, rateLimited? } }
  const calls = [];
  const server = http.createServer((req, res) => {
    const key = req.headers["xi-api-key"];
    const acc = accounts[key];
    const done = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (!acc || acc.invalid) return done(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
    if (req.url.startsWith("/v1/user/subscription")) {
      return done(200, { character_count: acc.used, character_limit: acc.limit, tier: "free" });
    }
    if (req.url.startsWith("/v1/text-to-speech/")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const text = JSON.parse(body).text;
        calls.push({ key, chars: text.length });
        if (acc.rateLimited) return done(429, { detail: { status: "too_many_concurrent_requests", message: "Too many requests" } });
        if (acc.used + text.length > acc.limit) return done(401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota limit" } });
        acc.used += text.length;
        const wav = fs.readFileSync(toneWav(os.tmpdir(), `mock-${process.pid}.wav`, 1));
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.end(wav);
      });
      return;
    }
    done(404, { detail: "not found" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((r) => server.close(r)) };
}
