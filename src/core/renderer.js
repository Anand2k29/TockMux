import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { buildClockScript } from "./clock-script.js";
import { launchBrowser, defaultWorkerCount } from "./browser.js";
import { startStaticServer } from "./static-server.js";
import { compileTmxToHtml } from "../tmx/compiler.js";
import { FrameEncoder, concatSegments, runFfmpeg, buildMuxArgs, buildGifArgs, buildWebmArgs, probeMedia } from "./ffmpeg.js";
import { TockError } from "../errors.js";
import { ensureDir } from "./fs-util.js";

export const FORMATS = ["mp4", "webm", "gif"];

export function detectKind(file) {
  const ext = path.extname(String(file)).toLowerCase();
  if (ext === ".tmx") return "tmx";
  if (ext === ".html" || ext === ".htm") return "html";
  throw new TockError(`Unsupported file type "${ext || "(none)"}".`, {
    hint: "TockMux converts .html / .htm pages and .tmx scripts. Example: tockmux render promo.html",
    code: "BAD_INPUT"
  });
}

/** Describe where a page lives: a folder to serve plus an entry URL path. */
export function prepareSource({ file, kind, tmx, html, root }) {
  if (kind === "tmx") {
    const abs = path.resolve(file);
    return { root: root || path.dirname(abs), entry: "/__tockmux.html", virtualFiles: { "/__tockmux.html": compileTmxToHtml(tmx) } };
  }
  if (html !== undefined && !file) {
    return { root: root || os.tmpdir(), entry: "/__tockmux.html", virtualFiles: { "/__tockmux.html": html } };
  }
  const abs = path.resolve(file);
  return { root: root || path.dirname(abs), entry: "/" + path.relative(root || path.dirname(abs), abs).split(path.sep).map(encodeURIComponent).join("/"), virtualFiles: {} };
}

/* ------------------------------------------------------------------ */
/* Opening a page with the virtual clock installed                     */
/* ------------------------------------------------------------------ */
async function openStage({ browser, url, settings, seed, timeScale = 1, durationSec }) {
  const context = await browser.newContext({ viewport: { width: settings.width, height: settings.height }, deviceScaleFactor: 1 });
  await context.addInitScript({ content: buildClockScript({ seed }) });
  const page = await context.newPage();
  const diag = { pageErrors: [], failedRequests: [], consoleErrors: [] };
  page.on("pageerror", (e) => diag.pageErrors.push(String(e.message || e).split("\n")[0]));
  page.on("console", (m) => {
    if (m.type() === "error") diag.consoleErrors.push(m.text().split("\n")[0]);
  });
  page.on("requestfailed", (r) => diag.failedRequests.push(`${r.url().replace(/^https?:\/\/127\.0\.0\.1:\d+/, "")} (${r.failure()?.errorText || "failed"})`));
  page.on("response", (r) => {
    if (r.status() >= 400) diag.failedRequests.push(`${r.url().replace(/^https?:\/\/127\.0\.0\.1:\d+/, "")} (HTTP ${r.status()})`);
  });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));

  await page.goto(url, { waitUntil: "load", timeout: 45000 });
  await page.evaluate(async () => {
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
    } catch (_) {
      /* ignore */
    }
  });
  // Pages may announce readiness; wait briefly in real time if they use the flag.
  const usesReady = await page.evaluate(() => typeof window.__READY !== "undefined");
  let readyTimedOut = false;
  if (usesReady) {
    try {
      await page.waitForFunction(() => window.__READY === true, undefined, { timeout: 4000 });
    } catch {
      readyTimedOut = true;
    }
  }

  const ms = (sec) => sec * 1000 * timeScale;
  const actions = (settings.actions || []).map((a) => ({ ...a, at: ms(a.at || 0) }));
  let autoscroll = null;
  if (settings.recipe === "autoscroll") {
    const hold = Math.min(1000, durationSec * 100);
    autoscroll = { startMs: hold * timeScale, durationMs: Math.max(1, durationSec * 1000 - 2 * hold) * timeScale };
  }
  await page.evaluate((o) => window.__tmx.prepare(o), { actions, autoscroll });
  await page.evaluate(() => window.__tmx.stepTo(0)); // first paint of rAF-driven pages
  return { context, page, diag, readyTimedOut, capture: (o) => makeCapture(context, page, o) };
}

/**
 * Fast frame capture straight through the DevTools protocol. `optimizeForSpeed` keeps PNG
 * lossless (same pixels) but compresses less, which measured ~45% faster than page.screenshot().
 */
async function makeCapture(context, page, { type = "png", quality = 92 } = {}) {
  const cdp = await context.newCDPSession(page);
  const params = type === "jpeg" ? { format: "jpeg", quality, optimizeForSpeed: true } : { format: "png", optimizeForSpeed: true };
  return async () => Buffer.from((await cdp.send("Page.captureScreenshot", params)).data, "base64");
}

function addUnique(arr, items, max = 8) {
  for (const i of items) if (!arr.includes(i) && arr.length < max) arr.push(i);
}

/* ------------------------------------------------------------------ */
/* Live probe: the "does this page really animate?" check              */
/* ------------------------------------------------------------------ */
export async function probeLive({ source, settings, seed = 1337, browserPath, quick = false }) {
  const server = await startStaticServer(source.root, { virtualFiles: source.virtualFiles });
  let handle;
  try {
    handle = await launchBrowser({ browserPath });
    const stage = await openStage({ browser: handle.browser, url: server.origin + source.entry, settings, seed, durationSec: settings.duration });
    const { page, diag } = stage;
    const info = await page.evaluate(() => window.__tmx.info());
    const out = {
      info,
      pageErrors: [...diag.pageErrors, ...diag.consoleErrors.filter((e) => !/Failed to load resource/i.test(e))].slice(0, 6),
      failedRequests: [...new Set(diag.failedRequests)].slice(0, 10),
      readyTimedOut: stage.readyTimedOut,
      animates: false,
      motionDetail: "",
      detectedDuration: info.finiteAnimationEndMs > 0 ? Math.min(600, Math.ceil(info.finiteAnimationEndMs / 100) / 10 + 0.5) : null
    };
    if (!quick) {
      const grab = await stage.capture({ type: "png" });
      const shot = async () => crypto.createHash("md5").update(await grab()).digest("hex");
      const frameMs = 1000 / settings.fps;
      const a = await shot();
      const stepUntil = async (sec) => {
        const target = Math.floor(Math.min(settings.duration, sec) * settings.fps);
        const now = await page.evaluate(() => window.__tmx.now());
        const startFrame = Math.floor(now / frameMs) + 1;
        if (target >= startFrame) await page.evaluate(([f, t, ms]) => window.__tmx.fastForward(f, t, ms), [startFrame, target, frameMs]);
      };
      await stepUntil(1.5);
      const b = await shot();
      let c = b;
      if (a === b) {
        await stepUntil(6);
        c = await shot();
      }
      out.animates = a !== b || a !== c;
      out.motionDetail = a !== b ? "frame changed within 1.5s" : a !== c ? "frame changed within 6s" : "";
      const t = await page.evaluate(() => window.__tmx.take());
      out.notes = t.notes;
      out.pageErrors.push(...t.errors);
    }
    await stage.context.close();
    return out;
  } finally {
    if (handle) await handle.browser.close().catch(() => {});
    await server.close();
  }
}

/* ------------------------------------------------------------------ */
/* Single frame (posters and agent previews)                           */
/* ------------------------------------------------------------------ */
export async function renderFrame({ source, settings, atSec = 0, timeScale = 1, seed = 1337, browserPath, type = "png" }) {
  const server = await startStaticServer(source.root, { virtualFiles: source.virtualFiles });
  let handle;
  try {
    handle = await launchBrowser({ browserPath });
    const stage = await openStage({ browser: handle.browser, url: server.origin + source.entry, settings, seed, timeScale, durationSec: settings.duration });
    const frameMs = (1000 / settings.fps) * timeScale;
    const frame = Math.round(atSec * settings.fps);
    if (frame > 0) await stage.page.evaluate(([f, ms]) => window.__tmx.fastForward(1, f, ms), [frame, frameMs]);
    const buf = await (await stage.capture({ type, quality: 90 }))();
    await stage.context.close();
    return buf;
  } finally {
    if (handle) await handle.browser.close().catch(() => {});
    await server.close();
  }
}

/* ------------------------------------------------------------------ */
/* Full render                                                         */
/* ------------------------------------------------------------------ */
export function planSegments(fromFrame, toFrame, workers) {
  const count = Math.max(0, toFrame - fromFrame);
  const w = Math.max(1, Math.min(workers, Math.ceil(count / 30)));
  const base = Math.floor(count / w);
  const extra = count % w;
  const segs = [];
  let cursor = fromFrame;
  for (let i = 0; i < w; i++) {
    const len = base + (i < extra ? 1 : 0);
    segs.push({ start: cursor, end: cursor + len });
    cursor += len;
  }
  return segs;
}

export async function renderVideo(opts) {
  const {
    source, settings, output,
    format = "mp4", crf = 18, preset = "veryfast", quality = "png", jpegQuality = 92,
    workers, from, to, timeScale = 1, seed = 1337,
    voice, music, musicVolume = 0.25, duck = false, voiceOffset = 0,
    gifFps = 15, gifWidth = 640,
    browserPath, onProgress, onLog, signal
  } = opts;

  if (!FORMATS.includes(format)) throw new TockError(`Unknown format "${format}".`, { hint: `Use one of: ${FORMATS.join(", ")}`, code: "BAD_FORMAT" });
  if (!output) throw new TockError("No output path given.", { code: "BAD_OUTPUT" });

  const fps = settings.fps;
  const totalFrames = Math.max(1, Math.round(settings.duration * fps));
  const fromFrame = from !== undefined ? Math.max(0, Math.round(from * fps)) : 0;
  const toFrame = to !== undefined ? Math.min(totalFrames, Math.round(to * fps)) : totalFrames;
  if (toFrame <= fromFrame) throw new TockError("The selected range is empty.", { hint: `The video is ${settings.duration}s long.`, code: "BAD_RANGE" });
  const frames = toFrame - fromFrame;
  const videoSeconds = frames / fps;
  const nWorkers = workers ? Math.max(1, Math.floor(workers)) : defaultWorkerCount(frames);
  const segs = planSegments(fromFrame, toFrame, nWorkers);
  const frameMs = (1000 / fps) * timeScale;
  const startedAt = Date.now();
  const warnings = [];
  const notes = [];
  const uniqueHashes = new Set();
  let done = 0;
  let lastReport = 0;

  const outAbs = path.resolve(output);
  ensureDir(path.dirname(outAbs));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tockmux-"));
  const server = await startStaticServer(source.root, { virtualFiles: source.virtualFiles });
  let handle;
  const encoders = [];
  const abortHandler = () => encoders.forEach((e) => e.kill());
  signal?.addEventListener("abort", abortHandler);

  try {
    onLog?.(`Launching browser (${nWorkers} worker${nWorkers > 1 ? "s" : ""})`);
    handle = await launchBrowser({ browserPath });

    const runWorker = async (seg, index) => {
      const segOut = path.join(tmp, `seg${String(index).padStart(3, "0")}.mp4`);
      const stage = await openStage({ browser: handle.browser, url: server.origin + source.entry, settings, seed, timeScale, durationSec: settings.duration });
      if (stage.readyTimedOut && index === 0) warnings.push("The page never set window.__READY = true; rendering started anyway.");
      const grab = await stage.capture({ type: quality === "jpeg" ? "jpeg" : "png", quality: jpegQuality });
      const enc = await FrameEncoder.start({ out: segOut, fps, imageCodec: quality === "jpeg" ? "mjpeg" : "png", crf, preset });
      encoders.push(enc);
      try {
        if (seg.start > 0) await stage.page.evaluate(([f, t, ms]) => window.__tmx.fastForward(f, t, ms), [1, seg.start, frameMs]);
        for (let f = seg.start; f < seg.end; f++) {
          if (signal?.aborted) throw new TockError("Render cancelled.", { code: "CANCELLED" });
          if (f > seg.start) await stage.page.evaluate((ms) => window.__tmx.stepTo(ms), f * frameMs);
          const buf = await grab();
          if (uniqueHashes.size < 3) uniqueHashes.add(crypto.createHash("md5").update(buf).digest("hex"));
          await enc.write(buf);
          done++;
          if (onProgress) {
            const now = Date.now();
            if (now - lastReport > 120 || done === frames) {
              lastReport = now;
              const elapsed = (now - startedAt) / 1000;
              const rate = done / Math.max(0.001, elapsed);
              onProgress({ done, total: frames, fps, elapsedSec: elapsed, etaSec: (frames - done) / Math.max(0.001, rate), renderFps: rate, workers: nWorkers });
            }
          }
        }
        await enc.finish();
        const t = await stage.page.evaluate(() => window.__tmx.take());
        addUnique(notes, t.notes);
        addUnique(warnings, t.errors.map((e) => `Page error: ${e.split("\n")[0]}`));
      } catch (e) {
        enc.kill();
        throw e;
      } finally {
        addUnique(warnings, stage.diag.pageErrors.map((e) => `Page error: ${e}`));
        addUnique(warnings, [...new Set(stage.diag.failedRequests)].map((r) => `Missing file: ${r}`));
        await stage.context.close().catch(() => {});
      }
      return segOut;
    };

    let segFiles;
    try {
      segFiles = await Promise.all(segs.map((s, i) => runWorker(s, i)));
    } catch (e) {
      abortHandler();
      throw e;
    }

    // Join segments, then audio, then optional format conversion
    let video = segFiles[0];
    if (segFiles.length > 1) {
      onLog?.("Joining segments");
      video = path.join(tmp, "joined.mp4");
      await concatSegments(segFiles, path.join(tmp, "list.txt"), video);
    }

    const finalPartial = path.join(path.dirname(outAbs), path.basename(outAbs, path.extname(outAbs)) + ".partial." + format);
    let audioInfo = null;

    if (format === "mp4") {
      if (voice || music) {
        onLog?.("Mixing audio");
        if (voice) {
          const vm = await probeMedia(voice);
          audioInfo = { voiceSeconds: vm.duration };
          if (vm.duration + voiceOffset > videoSeconds + 0.25) warnings.push(`Voice-over (${vm.duration}s) is longer than the video (${videoSeconds.toFixed(1)}s) and will be cut. Use --auto-fit to stretch the video to match.`);
        }
        await runFfmpeg(buildMuxArgs({ video, out: finalPartial, duration: videoSeconds, voice, music, musicVolume, duck, voiceOffset }));
      } else {
        fs.copyFileSync(video, finalPartial);
      }
    } else {
      if (voice || music) warnings.push(`${format.toUpperCase()} files cannot carry this audio; it was ignored. Use mp4 for sound.`);
      onLog?.(`Converting to ${format}`);
      const args = format === "gif" ? buildGifArgs({ video, out: finalPartial, fps: Math.min(gifFps, fps), width: Math.min(gifWidth, settings.width) }) : buildWebmArgs({ video, out: finalPartial });
      await runFfmpeg(args);
    }
    fs.renameSync(finalPartial, outAbs);

    if (uniqueHashes.size === 1 && frames > 1) {
      warnings.push("Every frame is identical: the page did not animate, so the video is a still image. Run `tockmux check` for details.");
    }
    return {
      output: outAbs,
      bytes: fs.statSync(outAbs).size,
      format,
      frames,
      fps,
      width: settings.width,
      height: settings.height,
      durationSec: Number(videoSeconds.toFixed(3)),
      workers: segs.length,
      elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      animated: uniqueHashes.size > 1,
      hasAudio: format === "mp4" && Boolean(voice || music),
      audio: audioInfo,
      warnings,
      notes,
      browser: handle.source
    };
  } finally {
    signal?.removeEventListener("abort", abortHandler);
    encoders.forEach((e) => e.kill());
    if (handle) await handle.browser.close().catch(() => {});
    await server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
