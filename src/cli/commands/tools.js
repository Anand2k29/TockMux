import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PRESETS } from "../../core/presets.js";
import { findBrowser, installBrowser } from "../../core/browser.js";
import { resolveFfmpeg, probeMedia } from "../../core/ffmpeg.js";
import { convert } from "../../core/pipeline.js";
import { THEMES } from "../../tmx/themes.js";
import { VoiceStore, configDir } from "../../voice/store.js";
import { getVersion, DISCORD, GITHUB } from "../../version.js";
import { TockError } from "../../errors.js";
import { ensureBrowser } from "./render.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function openExternal(target) {
  try {
    const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* ignore */
  }
}

export const presetsCommand = {
  name: "presets",
  aliases: [],
  summary: "List output size presets and .tmx themes",
  usage: ["tockmux presets"],
  examples: ["tockmux render promo.html --preset tiktok"],
  flags: {},
  async run({ ui }) {
    if (ui.json) return { json: { presets: PRESETS, themes: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.label])) } };
    ui.banner({ compact: true });
    ui.write(`  ${ui.c.bold("Size presets")}  ${ui.c.gray("--preset <name>")}`);
    for (const [name, p] of Object.entries(PRESETS)) ui.write(`    ${ui.c.violet(name.padEnd(9))} ${`${p.width}x${p.height}`.padEnd(10)} ${String(p.fps).padStart(2)} fps  ${ui.c.gray(p.label)}`);
    ui.write();
    ui.write(`  ${ui.c.bold(".tmx themes")}  ${ui.c.gray("film ... theme=<name>")}`);
    for (const [name, t] of Object.entries(THEMES)) ui.write(`    ${ui.c.pink(name.padEnd(9))} ${ui.c.gray(t.label)}`);
    ui.write();
  }
};

export const setupCommand = {
  name: "setup",
  aliases: ["install-browser"],
  summary: "One-time setup: download the Chromium browser TockMux draws with",
  usage: ["tockmux setup"],
  examples: ["tockmux setup"],
  flags: { force: { type: "boolean", desc: "Download again even if a browser is already found" } },
  async run({ flags, ui }) {
    ui.banner({ compact: true });
    const existing = await findBrowser({});
    if (existing && !flags.force) {
      ui.success(`A browser is already available (${existing.source === "system" ? "Chrome/Edge on this computer" : existing.source}). Nothing to download.`);
      ui.dim("Run  tockmux demo  to see it work.");
      return;
    }
    const sp = ui.spinner("Downloading Chromium (about 150 MB, one time)");
    try {
      await installBrowser();
    } catch (e) {
      sp.fail("Download failed");
      throw e;
    }
    sp.succeed("Chromium installed");
    ui.write();
    ui.dim("Next:  tockmux demo");
  }
};

function ffmpegVersion(bin) {
  try {
    const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
    return /ffmpeg version (\S+)/.exec(r.stdout || "")?.[1] || null;
  } catch {
    return null;
  }
}

export const doctorCommand = {
  name: "doctor",
  aliases: ["diagnose"],
  summary: "Check your setup and tell you exactly what to fix",
  usage: ["tockmux doctor"],
  examples: ["tockmux doctor --json"],
  flags: {},
  async run({ ui }) {
    const rows = [];
    const add = (label, status, detail, fix) => rows.push({ label, status, detail, ...(fix ? { fix } : {}) });
    const major = Number(process.versions.node.split(".")[0]);
    add("Node.js", major >= 18 ? "pass" : "fail", `v${process.versions.node}`, major >= 18 ? undefined : "Install Node.js 18 or newer from nodejs.org");
    const ff = await resolveFfmpeg();
    const fv = ffmpegVersion(ff);
    add("FFmpeg", fv ? "pass" : "fail", fv ? `${fv} (${ff === "ffmpeg" ? "system" : "bundled"})` : "not found", fv ? undefined : "Reinstall: npm install -g tockmux");
    const b = await findBrowser({});
    add("Browser", b ? "pass" : "fail", b ? `${b.source === "playwright" ? "TockMux Chromium" : b.source === "system" ? "Chrome/Edge" : "custom"}: ${b.executablePath}` : "none found", b ? undefined : "Run: tockmux setup");
    try {
      fs.mkdirSync(configDir(), { recursive: true });
      fs.accessSync(configDir(), fs.constants.W_OK);
      add("Config folder", "pass", configDir());
    } catch {
      add("Config folder", "warn", `${configDir()} is not writable`, "Set TOCKMUX_HOME to a writable folder");
    }
    const accounts = new VoiceStore().all();
    add("Voice accounts", "info", accounts.length ? `${accounts.length} connected` : "none (optional)", accounts.length ? undefined : "Add one: tockmux voice add --name main");
    add("CPU / memory", "info", `${os.cpus().length} cores, ${(os.totalmem() / 1073741824).toFixed(1)} GB RAM`);
    const ok = !rows.some((r) => r.status === "fail");
    if (ui.json) return { json: { ok, version: getVersion(), rows }, exitCode: ok ? 0 : 1 };
    ui.banner({ compact: true });
    ui.checklist(rows);
    ui.write();
    if (ok) ui.success("Everything needed is in place.");
    else ui.error("Something needs fixing", "Follow the arrows above, then run  tockmux doctor  again.");
    ui.write();
    return { exitCode: ok ? 0 : 1 };
  }
};

export const initCommand = {
  name: "init",
  aliases: ["new"],
  summary: "Create a starter project (an HTML film and a .tmx script)",
  usage: ["tockmux init [folder] [--template html|tmx|both]"],
  examples: ["tockmux init my-video", "tockmux init . --template tmx"],
  flags: { template: { type: "string", choices: ["html", "tmx", "both"], desc: "What to create (default both)" } },
  async run({ positional, flags, ui }) {
    const dir = path.resolve(positional[0] || "tockmux-project");
    const which = flags.template || "both";
    fs.mkdirSync(dir, { recursive: true });
    const made = [];
    const copy = (src, dest) => {
      const target = path.join(dir, dest);
      if (fs.existsSync(target)) return ui.warn(`${dest} already exists, left unchanged`);
      fs.copyFileSync(path.join(PKG_ROOT, "templates", src), target);
      made.push(dest);
    };
    if (which !== "tmx") copy("video.html", "video.html");
    if (which !== "html") copy("story.tmx", "story.tmx");
    copy("README.txt", "README.txt");
    ui.banner({ compact: true });
    for (const m of made) ui.success(`Created ${ui.c.bold(path.join(ui.rel(dir), m))}`);
    ui.write();
    const rel = ui.rel(dir);
    const cd = rel !== "." ? `cd ${rel}\n  ` : "";
    ui.write(`  ${ui.c.bold("Try it:")}\n  ${cd}${which !== "tmx" ? "tockmux render video.html" : "tockmux render story.tmx"}`);
    ui.write();
    if (ui.json) return { json: { dir, created: made } };
  }
};

/** The demo is saved where you run it, unless that is a drive root (D:\), which Windows often blocks; then use your home folder. */
function defaultDemoOutput() {
  const cwd = process.cwd();
  return path.parse(cwd).root === cwd ? path.join(os.homedir(), "tockmux-demo.mp4") : "tockmux-demo.mp4";
}

export const demoCommand = {
  name: "demo",
  aliases: [],
  summary: "Render a sample video to prove your setup works",
  usage: ["tockmux demo [-o demo.mp4]"],
  examples: ["tockmux demo"],
  flags: { output: { type: "string", alias: "o", desc: "Where to save the demo video" }, browser: { type: "string", desc: "Path to Chrome/Chromium/Edge" } },
  async run({ flags, ui }) {
    ui.banner();
    await ensureBrowser(ui, flags);
    const out = path.resolve(flags.output || defaultDemoOutput());
    const bar = ui.progress("Rendering demo");
    ui.step("Rendering a 6-second sample film from a .tmx script");
    const r = await convert({
      input: path.join(PKG_ROOT, "examples", "demo.tmx"),
      flags: { output: out, preset: "hd720", browser: flags.browser },
      hooks: { onProgress: (p) => bar.update(p) }
    }).catch((e) => (bar.done(), Promise.reject(e)));
    bar.done();
    const m = await probeMedia(out);
    ui.write();
    ui.box(
      [
        `${ui.c.mint(ui.sym.ok)} ${ui.c.bold("Everything works")}`,
        `${ui.rel(out)}  ${ui.sym.dot}  ${m.video.width}x${m.video.height}  ${ui.sym.dot}  ${m.duration}s  ${ui.sym.dot}  ${ui.fmtBytes(m.bytes)}`,
        ui.c.gray(`rendered in ${r.elapsedSec}s`)
      ],
      { color: "mint" }
    );
    ui.write();
    ui.dim("Now try your own page:  tockmux render my-animation.html");
    ui.dim("Or open the drag-and-drop app:  tockmux studio");
    ui.write();
    if (ui.json) return { json: { output: out, ...m } };
  }
};

export const studioCommand = {
  name: "studio",
  aliases: ["ui", "app"],
  summary: "Open the drag-and-drop app in your browser",
  usage: ["tockmux studio [--port 4321] [--no-open]"],
  examples: ["tockmux studio", "tockmux studio --port 5000"],
  flags: { port: { type: "number", desc: "Port to listen on (default 4321)" }, "no-open": { type: "boolean", desc: "Do not open the browser automatically" }, browser: { type: "string", desc: "Path to Chrome/Chromium/Edge" } },
  async run({ flags, ui }) {
    const { startStudio } = await import("../../studio/server.js");
    ui.banner();
    const { url, close } = await startStudio({ port: flags.port ?? 4321, browserPath: flags.browser });
    ui.success(`Studio is running at ${ui.c.bold(ui.c.underline(url))}`);
    ui.dim("Drop an .html or .tmx file onto the page. Press Ctrl+C to stop.");
    ui.write();
    if (flags.open !== false && process.stdout.isTTY) openExternal(url);
    await new Promise((resolve) => {
      const stop = () => close().then(resolve);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  }
};

export const mcpCommand = {
  name: "mcp",
  aliases: [],
  summary: "Run TockMux as an MCP server so AI assistants can make videos",
  usage: ["tockmux mcp            (started by your AI app, speaks over stdio)", "tockmux mcp --print-config"],
  examples: ["tockmux mcp --print-config"],
  flags: { "print-config": { type: "boolean", desc: "Print the settings to paste into Claude Desktop / Cursor" }, root: { type: "string", desc: "Folder the assistant may read and write (default: current folder)" } },
  async run({ flags, ui }) {
    if (flags.printConfig) {
      const cfg = { mcpServers: { tockmux: { command: "npx", args: ["-y", "tockmux", "mcp"] } } };
      const win = { mcpServers: { tockmux: { command: "cmd", args: ["/c", "npx", "-y", "tockmux", "mcp"] } } };
      ui.raw("");
      ui.write(ui.c.bold("  Claude Desktop / Cursor / any MCP client (macOS, Linux):"));
      ui.write(JSON.stringify(cfg, null, 2).replace(/^/gm, "  "));
      ui.write(ui.c.bold("\n  Windows:"));
      ui.write(JSON.stringify(win, null, 2).replace(/^/gm, "  "));
      ui.write(ui.c.gray("\n  Claude Code:  claude mcp add tockmux -- npx -y tockmux mcp\n"));
      return;
    }
    const { runMcpServer } = await import("../../mcp/server.js");
    await runMcpServer({ root: flags.root ? path.resolve(flags.root) : process.cwd() });
    return { keepAlive: true };
  }
};

export const aboutCommand = {
  name: "about",
  aliases: ["contact"],
  summary: "Version and how to reach the author",
  usage: ["tockmux about"],
  examples: [],
  flags: {},
  async run({ ui }) {
    ui.banner();
    ui.kv([["Version", getVersion()], ["Licence", "MIT"], ["Discord", ui.c.bold(DISCORD)], ["GitHub", ui.c.bold("github.com/" + GITHUB)]]);
    ui.write();
  }
};
