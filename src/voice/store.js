import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function configDir() {
  return process.env.TOCKMUX_HOME || path.join(os.homedir(), ".tockmux");
}

export function maskKey(key) {
  const k = String(key || "");
  if (k.length <= 8) return "••••";
  return k.slice(0, 3) + "…" + k.slice(-4);
}

/**
 * Stores voice accounts in ~/.tockmux/voice.json (folder 0700, file 0600 on macOS/Linux).
 * API keys are never printed in full and are never stored in the project folder.
 * Keys in ELEVENLABS_API_KEY / ELEVENLABS_API_KEYS (comma separated) are also picked up.
 */
export class VoiceStore {
  constructor(file = path.join(configDir(), "voice.json")) {
    this.file = file;
    this.data = { accounts: [] };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw && Array.isArray(raw.accounts)) this.data = raw;
    } catch {
      this.data = { accounts: [] };
    }
    return this;
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      /* not supported on this platform */
    }
    fs.renameSync(tmp, this.file);
  }

  envAccounts() {
    const raw = [process.env.ELEVENLABS_API_KEYS, process.env.ELEVENLABS_API_KEY].filter(Boolean).join(",");
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((apiKey, i) => ({ name: `env-${i + 1}`, apiKey, fromEnv: true, status: "ok" }));
  }

  /** Saved accounts followed by environment accounts. */
  all() {
    const saved = this.data.accounts.map((a) => ({ status: "ok", ...a }));
    const env = this.envAccounts().filter((e) => !saved.some((s) => s.apiKey === e.apiKey));
    return [...saved, ...env];
  }

  add({ name, apiKey, characterLimit, characterCount = 0 }) {
    const existing = this.data.accounts.find((a) => a.name === name);
    const rec = { name, apiKey, characterLimit, characterCount, status: "ok", addedAt: new Date().toISOString() };
    if (existing) Object.assign(existing, rec);
    else this.data.accounts.push(rec);
    this.save();
    return rec;
  }

  remove(name) {
    const before = this.data.accounts.length;
    this.data.accounts = this.data.accounts.filter((a) => a.name !== name);
    this.save();
    return this.data.accounts.length < before;
  }

  update(name, patch) {
    const a = this.data.accounts.find((x) => x.name === name);
    if (a) {
      Object.assign(a, patch);
      this.save();
    }
    return a;
  }
}

export function remaining(a) {
  if (a.status === "exhausted" || a.status === "invalid") return 0;
  if (typeof a.characterLimit !== "number") return Infinity; // unknown until refreshed
  return Math.max(0, a.characterLimit - (a.characterCount || 0));
}
