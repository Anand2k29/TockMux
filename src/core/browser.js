import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { TockError } from "../errors.js";

const require = createRequire(import.meta.url);

/** Chromium flags that make headless rendering stable and identical between machines. */
export function launchArgs() {
  const args = [
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--font-render-hinting=none",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--mute-audio"
  ];
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (isRoot || process.env.TOCKMUX_NO_SANDBOX === "1") args.push("--no-sandbox");
  if (process.platform === "linux") args.push("--disable-dev-shm-usage");
  return args;
}

function whichSync(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim() || null;
  return null;
}

function systemBrowserCandidates() {
  const list = [];
  if (process.platform === "win32") {
    const roots = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) {
      list.push(path.join(r, "Google", "Chrome", "Application", "chrome.exe"));
      list.push(path.join(r, "Microsoft", "Edge", "Application", "msedge.exe"));
      list.push(path.join(r, "Chromium", "Application", "chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    list.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
    list.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  } else {
    for (const n of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
      const p = whichSync(n);
      if (p) list.push(p);
    }
  }
  return list;
}

/**
 * Find a Chromium-family browser. Order:
 *   1. --browser / TOCKMUX_BROWSER
 *   2. the Chromium that `tockmux setup` downloads
 *   3. Chrome / Edge / Chromium already installed on this computer
 */
export async function findBrowser({ browserPath } = {}) {
  const explicit = browserPath || process.env.TOCKMUX_BROWSER;
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new TockError(`Browser not found at ${explicit}`, {
        hint: "Check the path passed to --browser / TOCKMUX_BROWSER, or run: tockmux setup",
        code: "BROWSER_NOT_FOUND"
      });
    }
    return { executablePath: explicit, source: "explicit" };
  }
  try {
    const { chromium } = await import("playwright-core");
    const managed = chromium.executablePath();
    if (managed && fs.existsSync(managed)) return { executablePath: managed, source: "playwright" };
  } catch {
    /* fall through */
  }
  for (const p of systemBrowserCandidates()) {
    if (p && fs.existsSync(p)) return { executablePath: p, source: "system" };
  }
  return null;
}

/** Download Chromium (what `tockmux setup` runs). */
export function installBrowser({ onData } = {}) {
  return new Promise((resolve, reject) => {
    let cli;
    try {
      cli = require.resolve("playwright-core/cli.js");
    } catch {
      return reject(new TockError("playwright-core is not installed.", { hint: "Run: npm install -g tockmux" }));
    }
    const child = spawn(process.execPath, [cli, "install", "chromium"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });
    let tail = "";
    const sink = (b) => {
      const s = b.toString();
      tail = (tail + s).slice(-2000);
      if (onData) onData(s);
    };
    child.stdout.on("data", sink);
    child.stderr.on("data", sink);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new TockError("Chromium download failed.", {
            hint:
              "Check your internet connection / proxy, then retry: tockmux setup\n" +
              "If downloads are blocked, install Google Chrome or Edge instead: TockMux will use it automatically.\n" +
              tail.trim().split("\n").slice(-3).join("\n"),
            code: "BROWSER_INSTALL_FAILED"
          })
        );
      }
    });
  });
}

export async function launchBrowser(opts = {}) {
  const found = await findBrowser(opts);
  if (!found) {
    throw new TockError("No browser found to render with.", {
      hint: "Run once:  tockmux setup   (downloads Chromium, about 150 MB)\nOr install Google Chrome / Edge: TockMux detects it automatically.",
      code: "BROWSER_MISSING"
    });
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: found.executablePath,
    headless: true,
    args: launchArgs()
  });
  return { browser, source: found.source, executablePath: found.executablePath };
}

export function defaultWorkerCount(totalFrames) {
  if (totalFrames < 120) return 1;
  const cpus = os.cpus()?.length || 1;
  return Math.max(1, Math.min(4, Math.floor(cpus / 2)));
}
