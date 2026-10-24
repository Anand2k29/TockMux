import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTmx, assertValidTmx } from "../tmx/parser.js";
import { inspectHtml } from "./html-inspect.js";
import { resolveSettings } from "./settings.js";
import { runPreflight } from "./preflight.js";
import { detectKind, prepareSource, probeLive, renderVideo, renderFrame, FORMATS } from "./renderer.js";
import { probeMedia } from "./ffmpeg.js";
import { VoiceStore } from "../voice/store.js";
import { VoicePool } from "../voice/pool.js";
import { TockError } from "../errors.js";

/**
 * Read an input (.html or .tmx, from disk or inline text) and decide everything about the render.
 * No video is produced here. `flags` use camelCase names (width, height, fps, duration, preset, ...).
 */
export async function planJob({ input, text, kind: kindHint, name, baseDir, flags = {}, detectDuration = true, lenient = false }) {
  let kind = kindHint;
  let file = null;
  let raw = text;
  if (input) {
    file = path.resolve(input);
    if (!fs.existsSync(file)) {
      throw new TockError(`File not found: ${input}`, { hint: "Check the spelling and the folder you are running the command from.", code: "FILE_NOT_FOUND" });
    }
    kind = detectKind(file);
    raw = fs.readFileSync(file, "utf8");
  }
  if (!kind) throw new TockError("Provide a file or inline text.", { code: "BAD_INPUT" });
  const root = input ? path.dirname(file) : baseDir ? path.resolve(baseDir) : os.tmpdir();
  const label = input ? path.basename(file) : name || (kind === "tmx" ? "inline.tmx" : "inline.html");

  let tmx = null;
  let htmlInfo = null;
  if (kind === "tmx") {
    tmx = parseTmx(raw);
    if (!lenient) assertValidTmx(tmx, label);
  } else {
    htmlInfo = inspectHtml(raw);
  }

  let settings = resolveSettings({ kind, file, htmlInfo, tmx, flags });
  const source = kind === "tmx" ? prepareSource({ file: file || path.join(root, label), kind, tmx, root }) : prepareSource({ file, kind, html: raw, root });
  const warnings = [];

  if (kind === "html" && detectDuration && settings.sources.duration === "default" && flags.duration === undefined) {
    try {
      const live = await probeLive({ source, settings, seed: flags.seed ?? 1337, browserPath: flags.browser, quick: true });
      if (live.detectedDuration) {
        settings = resolveSettings({ kind, file, htmlInfo, tmx, flags, detectedDurationSec: live.detectedDuration });
      }
    } catch {
      /* detection is best-effort */
    }
  }

  const voice = flags.voice ?? tmx?.voiceover ?? null;
  const music = flags.music ?? tmx?.music ?? null;
  const musicVolume = flags.musicVolume ?? tmx?.musicVolume ?? 0.25;
  const tts = flags.tts ?? tmx?.ttsScript ?? null;
  return {
    kind,
    file,
    label,
    root,
    raw,
    tmx,
    htmlInfo,
    settings,
    source,
    voice: voice ? path.resolve(root, voice) : null,
    music: music ? path.resolve(root, music) : null,
    musicVolume,
    tts,
    warnings
  };
}

/** Pre-flight report. `live: true` opens the page in a browser to confirm it really animates. */
export async function checkInput({ input, text, kind, name, baseDir, flags = {}, live = true }) {
  const plan = await planJob({ input, text, kind, name, baseDir, flags, detectDuration: false, lenient: true });
  let probe = null;
  let probeError = null;
  const tmxErrors = (plan.tmx?.diagnostics || []).filter((d) => d.level === "error");
  if (live && !tmxErrors.length) {
    try {
      probe = await probeLive({ source: plan.source, settings: plan.settings, seed: flags.seed ?? 1337, browserPath: flags.browser });
      if (plan.settings.sources.duration === "default" && probe.detectedDuration) {
        plan.settings = resolveSettings({ kind: plan.kind, file: plan.file, htmlInfo: plan.htmlInfo, tmx: plan.tmx, flags, detectedDurationSec: probe.detectedDuration });
      }
    } catch (e) {
      probeError = e;
    }
  }
  const report = await runPreflight({
    settings: plan.settings,
    htmlInfo: plan.htmlInfo,
    tmx: plan.tmx,
    live: probe,
    voice: plan.voice ? path.relative(plan.root, plan.voice) : null,
    music: plan.music ? path.relative(plan.root, plan.music) : null,
    baseDir: plan.root,
    browserPath: flags.browser
  });
  for (const d of plan.tmx?.diagnostics || []) {
    report.rows.push({ id: "tmx", label: `Line ${d.line || "-"}`, status: d.level === "error" ? "fail" : "warn", detail: d.message });
    if (d.level === "error") report.ok = false;
  }
  if (probeError && !report.rows.some((r) => r.id === "browser" && r.status === "fail")) {
    report.rows.push({ id: "probe", label: "Live test", status: "warn", detail: `could not open the page: ${probeError.message}` });
  }
  return { plan, report, probe };
}

function inferFormat(flags, output) {
  if (flags.format) return String(flags.format).toLowerCase();
  const ext = output ? path.extname(output).slice(1).toLowerCase() : "";
  return FORMATS.includes(ext) ? ext : "mp4";
}

/** Plan, optionally narrate, render and mux. Shared by the CLI, Studio, MCP server and the library API. */
export async function convert({ input, text, kind, name, baseDir, flags = {}, hooks = {} }) {
  const { onProgress, onLog, onVoiceEvent, onPlan, signal } = hooks;
  const plan = await planJob({ input, text, kind, name, baseDir, flags });
  const format = inferFormat(flags, flags.output);
  const stem = input ? path.join(path.dirname(plan.file), path.basename(plan.file, path.extname(plan.file))) : path.join(process.cwd(), path.basename(plan.label, path.extname(plan.label)));
  const output = path.resolve(flags.output || `${stem}.${format}`);
  const settings = { ...plan.settings };
  const extraWarnings = [];
  let voice = plan.voice;
  let ttsResult = null;
  let timeScale = 1;
  let autoFit = null;

  if (!voice && plan.tts) {
    onLog?.("Generating narration with ElevenLabs");
    const pool = new VoicePool(new VoiceStore(), { onEvent: onVoiceEvent, strategy: flags.voiceStrategy || "fill" });
    const voiceOut = path.join(path.dirname(output), path.basename(output, path.extname(output)) + ".voice.mp3");
    ttsResult = await pool.synthesize(plan.tts, voiceOut, { voiceId: flags.voiceId });
    voice = ttsResult.output;
  }

  if (voice && flags.autoFit) {
    const m = await probeMedia(voice);
    if (!m.duration) throw new TockError("Could not read the voice-over length.", { hint: `Is ${voice} a valid audio file?`, code: "BAD_AUDIO" });
    const offset = flags.voiceOffset || 0;
    const tail = flags.tail ?? 0.6;
    const authored = settings.duration;
    const span = m.duration + offset;
    timeScale = authored / span;
    settings.duration = Number((span + tail).toFixed(3));
    autoFit = { authoredSeconds: authored, audioSeconds: m.duration, newSeconds: settings.duration, stretch: Number((1 / timeScale).toFixed(3)) };
    onLog?.(`Auto-fit: ${authored}s of animation stretched to ${span.toFixed(1)}s of narration (x${autoFit.stretch})`);
  }

  onPlan?.({ plan, settings, output, format, timeScale, voice, autoFit });

  const result = await renderVideo({
    source: plan.source,
    settings,
    output,
    format,
    crf: flags.crf,
    preset: flags.encoderPreset,
    quality: flags.quality,
    workers: flags.workers,
    from: flags.from,
    to: flags.to,
    timeScale,
    seed: flags.seed ?? 1337,
    voice,
    music: plan.music,
    musicVolume: plan.musicVolume,
    duck: flags.duck,
    voiceOffset: flags.voiceOffset || 0,
    gifFps: flags.gifFps,
    gifWidth: flags.gifWidth,
    browserPath: flags.browser,
    onProgress,
    onLog,
    signal
  });
  result.warnings.push(...extraWarnings);
  return { ...result, settings, kind: plan.kind, input: plan.file, autoFit, narration: ttsResult ? { chars: ttsResult.chars, chunks: ttsResult.chunks, usage: ttsResult.usage } : null };
}

/** Render a single frame to a PNG/JPEG buffer. */
export async function snapshot({ input, text, kind, name, baseDir, flags = {}, atSec = 0, type = "png" }) {
  const plan = await planJob({ input, text, kind, name, baseDir, flags });
  return { buffer: await renderFrame({ source: plan.source, settings: plan.settings, atSec, seed: flags.seed ?? 1337, browserPath: flags.browser, type }), settings: plan.settings };
}
