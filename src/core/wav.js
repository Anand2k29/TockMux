import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./fs-util.js";

/** Write a valid 16-bit mono PCM WAV containing a soft two-tone chime. Used by the demo and tests. */
export function writeToneWav(file, seconds = 3, sampleRate = 22050) {
  const n = Math.max(1, Math.floor(seconds * sampleRate));
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t * 8, (seconds - t) * 8);
    const s = (0.6 * Math.sin(2 * Math.PI * 440 * t) + 0.4 * Math.sin(2 * Math.PI * 554.37 * t)) * 0.35 * Math.max(0, env);
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  ensureDir(path.dirname(path.resolve(file)));
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}
