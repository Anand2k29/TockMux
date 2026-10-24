import readline from "node:readline";
import path from "node:path";
import { VoiceStore, maskKey, remaining } from "../../voice/store.js";
import { VoicePool } from "../../voice/pool.js";
import { TockError } from "../../errors.js";

async function promptSecret(ui, question) {
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const origWrite = rl._writeToOutput;
  let muted = false;
  rl._writeToOutput = (s) => {
    if (!muted) origWrite.call(rl, s);
  };
  const p = new Promise((res) => rl.question(`  ${ui.c.violet("?")} ${question} `, res));
  muted = true;
  const answer = await p;
  muted = false;
  rl.close();
  process.stdout.write("\n");
  return answer.trim();
}

function accountRow(ui, a) {
  const rem = remaining(a);
  const limit = typeof a.characterLimit === "number" ? a.characterLimit : null;
  const used = a.characterCount || 0;
  const state = a.status === "invalid" ? ui.c.red("invalid key") : a.status === "exhausted" ? ui.c.amber("out of characters") : limit ? ui.c.mint(`${(limit - used).toLocaleString()} left`) : ui.c.gray("not checked yet");
  return { name: a.name, key: maskKey(a.apiKey), used, limit, remaining: rem === Infinity ? null : rem, status: a.status, tier: a.tier || null, state, fromEnv: Boolean(a.fromEnv) };
}

export const voiceCommand = {
  name: "voice",
  aliases: ["el-add", "el-status", "el-speak"],
  summary: "Manage ElevenLabs accounts and generate narration",
  usage: [
    "tockmux voice add --name main [--key YOUR_KEY]",
    "tockmux voice status [--refresh]",
    "tockmux voice remove <name>",
    'tockmux voice speak "Your narration text" -o narration.mp3'
  ],
  examples: ["tockmux voice add --name work", 'tockmux voice speak "Welcome to our product." -o intro.mp3', "tockmux voice status --refresh"],
  flags: {
    name: { type: "string", desc: "A label for the account" },
    key: { type: "string", desc: "ElevenLabs API key (omit to be asked privately)" },
    refresh: { type: "boolean", desc: "Ask ElevenLabs for the real remaining characters" },
    "no-verify": { type: "boolean", desc: "Do not test the key when adding it" },
    output: { type: "string", alias: "o", desc: "Audio file for `speak` (default narration.mp3)" },
    "voice-id": { type: "string", desc: "ElevenLabs voice ID to speak with" },
    strategy: { type: "string", choices: ["fill", "balance"], desc: "fill: use accounts in order. balance: most characters left first" }
  },
  async run({ positional, flags, ui, invokedAs }) {
    let [sub, ...rest] = positional;
    if (invokedAs === "el-add") (sub = "add"), (rest = positional);
    if (invokedAs === "el-status") (sub = "status"), (rest = positional);
    if (invokedAs === "el-speak") (sub = "speak"), (rest = positional);
    const store = new VoiceStore();
    const pool = new VoicePool(store, { strategy: flags.strategy || "fill", onEvent: (e) => e.type === "rotate" && ui.warn(`Account "${e.account}": ${e.reason}. Trying the next account.`) });

    if (!sub || sub === "list" || sub === "status") {
      if (flags.refresh) {
        const sp = ui.spinner("Asking ElevenLabs for current usage");
        await pool.refresh();
        sp.succeed("Usage updated");
      }
      const rows = pool.accounts().map((a) => accountRow(ui, a));
      if (ui.json) return { json: rows };
      ui.banner({ compact: true });
      if (!rows.length) {
        ui.info("No accounts yet. Add one with:  tockmux voice add --name main");
        ui.write();
        return;
      }
      for (const r of rows) {
        const bar = r.limit ? ` ${ui.c.gray(`${r.used.toLocaleString()} / ${r.limit.toLocaleString()} used`)}` : "";
        ui.write(`  ${ui.c.bold(r.name.padEnd(14))} ${ui.c.gray(r.key.padEnd(10))} ${r.state}${bar}${r.fromEnv ? ui.c.gray("  (from environment)") : ""}`);
      }
      ui.write();
      return;
    }

    if (sub === "add") {
      const name = flags.name || rest[0];
      if (!name) throw new TockError("Give the account a name.", { hint: "Example: tockmux voice add --name main", code: "NO_NAME" });
      let key = flags.key;
      if (!key) key = await promptSecret(ui, "Paste your ElevenLabs API key (hidden):");
      if (!key) throw new TockError("No API key provided.", { hint: "Pass --key YOUR_KEY, or run the command in a terminal to be asked.", code: "NO_KEY" });
      store.add({ name, apiKey: key });
      let msg = `Saved account "${name}" (${maskKey(key)}) to ${store.file}`;
      if (!flags.noVerify) {
        const [r] = await pool.refresh([name]);
        if (r?.ok) msg += `\n    ${r.used.toLocaleString()} of ${r.limit.toLocaleString()} characters used (${r.tier} plan)`;
        else if (r) ui.warn(`Saved, but ElevenLabs did not accept the key yet: ${r.error}`);
      }
      ui.success(msg);
      if (ui.json) return { json: { added: name } };
      ui.write();
      return;
    }

    if (sub === "remove" || sub === "rm") {
      const name = rest[0] || flags.name;
      if (!name) throw new TockError("Which account should I remove?", { hint: "Example: tockmux voice remove main", code: "NO_NAME" });
      if (!store.remove(name)) throw new TockError(`No saved account named "${name}".`, { hint: "See the list with: tockmux voice status", code: "NOT_FOUND" });
      ui.success(`Removed "${name}"`);
      return;
    }

    if (sub === "speak") {
      const text = rest.join(" ").trim();
      if (!text) throw new TockError("Tell me what to say.", { hint: 'Example: tockmux voice speak "Hello world" -o hello.mp3', code: "NO_TEXT" });
      const out = path.resolve(flags.output || "narration.mp3");
      const sp = ui.spinner(`Speaking ${text.length} characters`);
      let r;
      try {
        r = await pool.synthesize(text, out, { voiceId: flags.voiceId });
      } catch (e) {
        sp.fail("Could not generate speech");
        throw e;
      }
      sp.succeed(`Saved ${ui.c.bold(ui.rel(r.output))} ${ui.c.gray(Object.entries(r.usage).map(([k, v]) => `${k}: ${v} chars`).join(", "))}`);
      if (ui.json) return { json: r };
      return;
    }
    throw new TockError(`Unknown voice command "${sub}".`, { hint: "Use: add, status, remove or speak", code: "BAD_SUBCOMMAND" });
  }
};
