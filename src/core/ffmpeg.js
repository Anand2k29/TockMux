import fs from "node:fs";
import { spawn } from "node:child_process";
import { TockError } from "../errors.js";

let cachedBin;

/** FFmpeg binary: TOCKMUX_FFMPEG, then the bundled ffmpeg-static, then `ffmpeg` on PATH. */
export async function resolveFfmpeg() {
  if (cachedBin) return cachedBin;
  if (process.env.TOCKMUX_FFMPEG && fs.existsSync(process.env.TOCKMUX_FFMPEG)) {
    return (cachedBin = process.env.TOCKMUX_FFMPEG);
  }
  try {
    const mod = await import("ffmpeg-static");
    const p = mod.default;
    if (p && fs.existsSync(p)) return (cachedBin = p);
  } catch {
    /* fall through */
  }
  return (cachedBin = "ffmpeg");
}

/** Run ffmpeg to completion. Rejects with the tail of stderr on failure. */
export async function runFfmpeg(args, { onStderr } = {}) {
  const bin = await resolveFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-hide_banner", "-loglevel", "error", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (b) => {
      err = (err + b.toString()).slice(-4000);
      if (onStderr) onStderr(b.toString());
    });
    child.on("error", (e) =>
      reject(new TockError(`Could not start FFmpeg (${bin}): ${e.message}`, { hint: "Reinstall with: npm install -g tockmux, or install FFmpeg and set TOCKMUX_FFMPEG.", code: "FFMPEG_MISSING" }))
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new TockError("FFmpeg failed.", { hint: err.trim().split("\n").slice(-4).join("\n"), code: "FFMPEG_FAILED" }));
    });
  });
}

/** Streaming encoder: feed it image frames, get a video segment. */
export class FrameEncoder {
  static async start({ out, fps, imageCodec = "png", crf = 18, preset = "veryfast" }) {
    const bin = await resolveFfmpeg();
    const args = [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", imageCodec, "-i", "-",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-c:v", "libx264", "-preset", preset, "-crf", String(crf),
      "-g", String(Math.max(1, Math.round(fps))),
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-movflags", "+faststart", out
    ];
    return new FrameEncoder(spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"] }));
  }

  constructor(child) {
    this.child = child;
    this.stderr = "";
    this.exit = new Promise((resolve) => {
      child.on("close", (code) => resolve(code));
      child.on("error", () => resolve(-1));
    });
    child.stderr.on("data", (b) => (this.stderr = (this.stderr + b.toString()).slice(-4000)));
    child.stdin.on("error", () => {});
    this.closed = false;
  }

  write(buf) {
    return new Promise((resolve, reject) => {
      const s = this.child.stdin;
      if (s.destroyed || this.closed) return reject(new TockError("FFmpeg stopped unexpectedly.", { hint: this.stderr.trim().split("\n").slice(-3).join("\n") }));
      const ok = s.write(buf, (e) => e && reject(e));
      if (ok) resolve();
      else s.once("drain", resolve);
    });
  }

  async finish() {
    this.closed = true;
    this.child.stdin.end();
    const code = await this.exit;
    if (code !== 0) throw new TockError("FFmpeg could not encode the frames.", { hint: this.stderr.trim().split("\n").slice(-4).join("\n"), code: "FFMPEG_FAILED" });
  }

  kill() {
    this.closed = true;
    try {
      this.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

const num = (s) => (s === undefined ? undefined : Number(s));

/** Read duration, size, fps and audio info by parsing `ffmpeg -i` output (no ffprobe needed). */
export async function probeMedia(file) {
  if (!file || !fs.existsSync(file)) throw new TockError(`File not found: ${file}`, { code: "FILE_NOT_FOUND" });
  const bin = await resolveFfmpeg();
  const stderr = await new Promise((resolve) => {
    const child = spawn(bin, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    child.stderr.on("data", (b) => (s += b.toString()));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(s));
  });
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duration = d ? num(d[1]) * 3600 + num(d[2]) * 60 + num(d[3]) : 0;
  const v = /Stream #[^\n]*Video:\s*([^\s,(]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr);
  const vLine = /Stream #[^\n]*Video:[^\n]*/.exec(stderr);
  const fps = vLine ? /(\d+(?:\.\d+)?)\s*fps/.exec(vLine[0]) : null;
  const a = /Stream #[^\n]*Audio:\s*([^\s,(]+)[^\n]*?,\s*(\d+)\s*Hz/.exec(stderr);
  return {
    file,
    bytes: fs.statSync(file).size,
    duration: Number(duration.toFixed(3)),
    video: v ? { codec: v[1], width: num(v[2]), height: num(v[3]), fps: fps ? num(fps[1]) : null } : null,
    audio: a ? { codec: a[1], sampleRate: num(a[2]) } : null
  };
}

/** Count video frames exactly (used by tests and `tockmux probe --frames`). */
export async function countFrames(file) {
  const bin = await resolveFfmpeg();
  return new Promise((resolve) => {
    const child = spawn(bin, ["-hide_banner", "-stats", "-i", file, "-map", "0:v:0", "-an", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    child.stderr.on("data", (b) => (s += b.toString()));
    child.on("close", () => {
      const all = [...s.matchAll(/frame=\s*(\d+)/g)];
      resolve(all.length ? Number(all[all.length - 1][1]) : 0);
    });
  });
}

/** Return the RGB value of one pixel at `timeSec` (used by tests to prove frames differ). */
export async function samplePixel(file, timeSec, x, y) {
  const bin = await resolveFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-hide_banner", "-loglevel", "error", "-ss", String(timeSec), "-i", file, "-frames:v", "1", "-vf", `format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    child.stdout.on("data", (b) => chunks.push(b));
    child.on("error", reject);
    child.on("close", () => {
      const buf = Buffer.concat(chunks);
      resolve(buf.length >= 3 ? [buf[0], buf[1], buf[2]] : null);
    });
  });
}

/** Concatenate same-encoded segments without re-encoding. */
export async function concatSegments(segments, listFile, out) {
  fs.writeFileSync(listFile, segments.map((s) => `file '${s.replace(/'/g, "'\\''").replace(/\\/g, "/")}'`).join("\n"));
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", out]);
}

/**
 * Build the final mux command: video (copied, not re-encoded) + optional voice-over + optional music.
 * Audio is always padded or trimmed to the exact video length.
 */
export function buildMuxArgs({ video, out, duration, voice, music, musicVolume = 0.25, duck = false, voiceOffset = 0 }) {
  const args = ["-y", "-i", video];
  const filters = [];
  let idx = 1;
  let voiceIdx = null;
  let musicIdx = null;
  if (voice) {
    args.push("-i", voice);
    voiceIdx = idx++;
  }
  if (music) {
    args.push("-stream_loop", "-1", "-i", music);
    musicIdx = idx++;
  }
  if (voiceIdx === null && musicIdx === null) {
    args.push("-c", "copy", "-movflags", "+faststart", out);
    return args;
  }
  const delay = Math.max(0, Math.round(voiceOffset * 1000));
  const fadeStart = Math.max(0, duration - 1.2).toFixed(3);
  const voiceChain = `[${voiceIdx}:a]${delay ? `adelay=${delay}:all=1,` : ""}apad[vo]`;
  const musicChain = `[${musicIdx}:a]volume=${musicVolume},afade=t=out:st=${fadeStart}:d=1.2[bgm]`;
  let mapLabel;
  if (voiceIdx !== null && musicIdx !== null) {
    filters.push(voiceChain.replace("[vo]", "[vo0]"));
    if (duck) {
      filters.push(`[vo0]asplit=2[vo][vsc]`);
      filters.push(musicChain);
      filters.push(`[bgm][vsc]sidechaincompress=threshold=0.03:ratio=10:attack=30:release=500[ducked]`);
      filters.push(`[vo][ducked]amix=inputs=2:duration=first:dropout_transition=0,volume=2[aout]`);
    } else {
      filters.push(`[vo0]anull[vo]`);
      filters.push(musicChain);
      filters.push(`[vo][bgm]amix=inputs=2:duration=first:dropout_transition=0,volume=2[aout]`);
    }
    mapLabel = "[aout]";
  } else if (voiceIdx !== null) {
    filters.push(voiceChain);
    mapLabel = "[vo]";
  } else {
    filters.push(musicChain);
    mapLabel = "[bgm]";
  }
  args.push("-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", mapLabel, "-t", duration.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out);
  return args;
}

export function buildGifArgs({ video, out, fps = 15, width = 640 }) {
  const f = Math.max(1, Math.min(fps, 30));
  const vf = `fps=${f},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
  return ["-y", "-i", video, "-vf", vf, "-loop", "0", out];
}

export function buildWebmArgs({ video, out, crf = 32 }) {
  return ["-y", "-i", video, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-pix_fmt", "yuv420p", "-an", out];
}
