import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { remaining } from "./store.js";
import { fetchSubscription, requestSpeech, DEFAULT_VOICE_ID, DEFAULT_MODEL } from "./elevenlabs.js";
import { runFfmpeg } from "../core/ffmpeg.js";
import { TockError } from "../errors.js";

/** Split narration into chunks on sentence boundaries so each chunk fits one request. */
export function splitText(text, maxChars = 2500) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.split(/(?<=[.!?…。！？])\s+/);
  const chunks = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const s of sentences) {
    if (s.length > maxChars) {
      push();
      let piece = "";
      for (const w of s.split(" ")) {
        if ((piece + " " + w).length > maxChars) {
          chunks.push(piece.trim());
          piece = w;
        } else piece += " " + w;
      }
      cur = piece;
      continue;
    }
    if ((cur + " " + s).length > maxChars) push();
    cur += " " + s;
  }
  push();
  return chunks;
}

/**
 * A pool of API keys with automatic failover. Each chunk of narration goes to the first
 * account that has enough characters left; if a request fails because that account is out
 * of quota (or the key is invalid) the pool marks it and tries the next one.
 *
 * Use keys from accounts you are entitled to use (your own plans, team workspaces).
 * Creating many free accounts to get around a provider's limits can violate its terms.
 */
export class VoicePool {
  constructor(store, { fetchImpl = fetch, strategy = "fill", onEvent = () => {} } = {}) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.strategy = strategy;
    this.onEvent = onEvent;
    this.session = new Map(); // in-memory status for env accounts
  }

  accounts() {
    return this.store.all().map((a) => ({ ...a, ...(this.session.get(a.name) || {}) }));
  }

  patch(acc, patch) {
    if (acc.fromEnv) this.session.set(acc.name, { ...(this.session.get(acc.name) || {}), ...patch });
    else this.store.update(acc.name, patch);
  }

  /** Ask the API for real usage numbers. Returns one result per account. */
  async refresh(names) {
    const out = [];
    for (const acc of this.accounts()) {
      if (names && !names.includes(acc.name)) continue;
      try {
        const r = await fetchSubscription(acc.apiKey, this.fetchImpl);
        if (r.ok) {
          this.patch(acc, { characterCount: r.characterCount, characterLimit: r.characterLimit, tier: r.tier, status: r.characterLimit && r.characterCount >= r.characterLimit ? "exhausted" : "ok", lastChecked: new Date().toISOString() });
          out.push({ name: acc.name, ok: true, used: r.characterCount, limit: r.characterLimit, tier: r.tier });
        } else {
          if (r.kind === "invalid") this.patch(acc, { status: "invalid" });
          out.push({ name: acc.name, ok: false, error: r.message, kind: r.kind });
        }
      } catch (e) {
        out.push({ name: acc.name, ok: false, error: e.message, kind: "network" });
      }
    }
    return out;
  }

  candidates(needed) {
    const list = this.accounts().filter((a) => a.status !== "invalid" && remaining(a) >= needed);
    if (this.strategy === "balance") list.sort((a, b) => remaining(b) - remaining(a));
    return list;
  }

  async synthesize(text, outPath, { voiceId = DEFAULT_VOICE_ID, modelId = DEFAULT_MODEL, maxChunk = 2500 } = {}) {
    const chunks = splitText(text, maxChunk);
    if (!chunks.length) throw new TockError("There is no narration text to speak.", { code: "NO_TEXT" });
    if (!this.accounts().length) {
      throw new TockError("No ElevenLabs account is connected.", {
        hint: "Add one:  tockmux voice add --name main --key YOUR_KEY\nOr set the ELEVENLABS_API_KEY environment variable.",
        code: "NO_VOICE_ACCOUNT"
      });
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tockmux-voice-"));
    const files = [];
    const usage = new Map();
    const events = [];
    const emit = (e) => {
      events.push(e);
      this.onEvent(e);
    };
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let done = false;
        let lastMsg = "";
        for (const acc of this.candidates(chunk.length)) {
          emit({ type: "try", account: acc.name, chunk: i + 1, chunks: chunks.length, chars: chunk.length });
          const r = await requestSpeech({ apiKey: acc.apiKey, text: chunk, voiceId, modelId, fetchImpl: this.fetchImpl });
          if (r.ok) {
            const f = path.join(tmp, `chunk${String(i).padStart(3, "0")}.mp3`);
            fs.writeFileSync(f, r.buffer);
            files.push(f);
            const used = (acc.characterCount || 0) + chunk.length;
            this.patch(acc, { characterCount: used });
            usage.set(acc.name, (usage.get(acc.name) || 0) + chunk.length);
            done = true;
            break;
          }
          lastMsg = r.message;
          if (r.kind === "exhausted") {
            this.patch(acc, { status: "exhausted", characterCount: acc.characterLimit ?? acc.characterCount });
            emit({ type: "rotate", account: acc.name, reason: "out of characters" });
          } else if (r.kind === "invalid") {
            this.patch(acc, { status: "invalid" });
            emit({ type: "rotate", account: acc.name, reason: "invalid API key" });
          } else {
            emit({ type: "rotate", account: acc.name, reason: r.kind === "rate_limited" ? "rate limited" : `error: ${r.message}` });
          }
        }
        if (!done) {
          throw new TockError("No connected account could speak this text.", {
            hint:
              (lastMsg ? `Last error: ${lastMsg}\n` : "") +
              `Needed ${chunk.length} characters. Check usage with: tockmux voice status --refresh\nAdd another account with: tockmux voice add --name another --key KEY`,
            code: "VOICE_EXHAUSTED"
          });
        }
      }
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
      if (files.length === 1) fs.copyFileSync(files[0], outPath);
      else {
        const list = path.join(tmp, "list.txt");
        fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
        await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-q:a", "2", outPath]);
      }
      return {
        output: path.resolve(outPath),
        chars: chunks.reduce((n, c) => n + c.length, 0),
        chunks: chunks.length,
        usage: Object.fromEntries(usage),
        events
      };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
