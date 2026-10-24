import readline from "node:readline";
import path from "node:path";
import { getVersion } from "../version.js";

const ESC = "\x1b[";

export function detectCapabilities(env = process.env, stream = process.stdout, platform = process.platform) {
  const isTTY = Boolean(stream.isTTY);
  const noColor = "NO_COLOR" in env || env.TERM === "dumb";
  const forceColor = Boolean(env.FORCE_COLOR) && env.FORCE_COLOR !== "0";
  const color = !noColor && (isTTY || forceColor);
  const truecolor = Boolean(color) && (/truecolor|24bit/i.test(env.COLORTERM || "") || Boolean(env.WT_SESSION) || env.TERM_PROGRAM === "vscode" || env.TERM_PROGRAM === "iTerm.app" || /kitty|alacritty|wezterm/i.test(env.TERM || ""));
  // Legacy Windows consoles render box-drawing and braille poorly.
  const legacyWindows = platform === "win32" && !env.WT_SESSION && !env.TERM_PROGRAM && !env.ConEmuTask;
  const unicode = env.TOCKMUX_ASCII !== "1" && !legacyWindows;
  return { isTTY, color, truecolor, unicode, columns: Math.max(40, Math.min(stream.columns || 80, 110)) };
}

/** Closest xterm-256 colour for an RGB value. */
function to256(r, g, b) {
  const c = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * c(r) + 6 * c(g) + c(b);
}

export const PALETTE = {
  violet: [139, 107, 255],
  pink: [255, 107, 154],
  amber: [255, 200, 87],
  mint: [61, 219, 176],
  red: [255, 92, 92],
  sky: [92, 200, 255],
  gray: [150, 150, 175]
};

export function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleLength(s) {
  return [...stripAnsi(s)].length;
}

export function createUI({ json = false, quiet = false, noColor = false, stream = process.stdout, env = process.env } = {}) {
  const caps = detectCapabilities(env, stream);
  if (noColor) caps.color = false;
  const silent = json || quiet;

  const paint = (rgb, s, bold = false) => {
    if (!caps.color) return String(s);
    const code = caps.truecolor ? `38;2;${rgb[0]};${rgb[1]};${rgb[2]}` : `38;5;${to256(...rgb)}`;
    return `${ESC}${bold ? "1;" : ""}${code}m${s}${ESC}39;22m`;
  };
  const c = {
    violet: (s) => paint(PALETTE.violet, s),
    pink: (s) => paint(PALETTE.pink, s),
    amber: (s) => paint(PALETTE.amber, s),
    mint: (s) => paint(PALETTE.mint, s),
    red: (s) => paint(PALETTE.red, s),
    sky: (s) => paint(PALETTE.sky, s),
    gray: (s) => paint(PALETTE.gray, s),
    bold: (s) => (caps.color ? `${ESC}1m${s}${ESC}22m` : String(s)),
    dim: (s) => (caps.color ? `${ESC}2m${s}${ESC}22m` : String(s)),
    underline: (s) => (caps.color ? `${ESC}4m${s}${ESC}24m` : String(s))
  };

  const sym = caps.unicode
    ? { ok: "✔", warn: "▲", fail: "✖", info: "●", dot: "·", arrow: "›", bar: "█", barEmpty: "░", corner: ["╭", "╮", "╰", "╯"], h: "─", v: "│", bullet: "•", play: "▶" }
    : { ok: "+", warn: "!", fail: "x", info: "*", dot: "-", arrow: ">", bar: "#", barEmpty: "-", corner: ["+", "+", "+", "+"], h: "-", v: "|", bullet: "*", play: ">" };

  /** Colour text with a left-to-right gradient across the palette. */
  function gradient(text, stops = [PALETTE.violet, PALETTE.pink, PALETTE.amber]) {
    if (!caps.color) return text;
    const chars = [...text];
    const n = Math.max(1, chars.length - 1);
    return chars
      .map((ch, i) => {
        if (ch === " ") return ch;
        const pos = (i / n) * (stops.length - 1);
        const a = Math.floor(pos);
        const b = Math.min(stops.length - 1, a + 1);
        const t = pos - a;
        const rgb = [0, 1, 2].map((k) => Math.round(stops[a][k] + (stops[b][k] - stops[a][k]) * t));
        return paint(rgb, ch);
      })
      .join("");
  }

  const write = (s = "") => {
    if (!silent) stream.write(s + "\n");
  };
  const raw = (s) => {
    if (!silent) stream.write(s);
  };

  const LOGO = [
    ["▀█▀", "█▀█", "█▀▀", "█ █", "█▄█▄█", "█ █", "▀▄▀"],
    [" █ ", "█ █", "█  ", "█▀▄", "█ ▀ █", "█ █", " █ "],
    [" ▀ ", "▀▀▀", "▀▀▀", "▀ ▀", "▀   ▀", "▀▀▀", "▄▀▄"]
  ];

  function banner({ compact = false } = {}) {
    if (silent) return;
    const v = getVersion();
    if (compact || !caps.unicode || caps.columns < 50) {
      write(`  ${gradient("TockMux")} ${c.dim("v" + v)}  ${c.gray("HTML to MP4, frame-perfect")}`);
      write();
      return;
    }
    write();
    for (const row of LOGO) write("  " + gradient(row.join(" ")));
    write(`  ${c.gray("HTML to MP4, frame-perfect")}  ${c.dim("v" + v)}`);
    write();
  }

  const step = (msg) => write(`  ${c.violet(sym.arrow)} ${msg}`);
  const success = (msg) => write(`  ${c.mint(sym.ok)} ${msg}`);
  const warn = (msg) => write(`  ${c.amber(sym.warn)} ${msg}`);
  const info = (msg) => write(`  ${c.sky(sym.info)} ${msg}`);
  const dim = (msg) => write(`  ${c.gray(msg)}`);

  function error(title, hint = "") {
    stream.write(`\n  ${c.red(sym.fail)} ${c.bold(title)}\n`);
    if (hint) {
      for (const line of String(hint).split("\n")) stream.write(`    ${c.gray(line)}\n`);
    }
    stream.write("\n");
  }

  function kv(rows, { indent = 2, keyWidth } = {}) {
    if (silent) return;
    const w = keyWidth || Math.max(...rows.map(([k]) => visibleLength(k)));
    for (const [k, v] of rows) write(" ".repeat(indent) + c.gray(String(k).padEnd(w)) + "  " + v);
  }

  function wrap(text, width) {
    const out = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        if (visibleLength(line + " " + word) > width && line) {
          out.push(line);
          line = word;
        } else line = line ? line + " " + word : word;
      }
      out.push(line);
    }
    return out;
  }

  /** Pre-flight style rows: [{ status, label, detail, fix }] */
  function checklist(rows, { title } = {}) {
    if (silent) return;
    if (title) write(`  ${c.bold(title)}`);
    const labelW = Math.min(20, Math.max(...rows.map((r) => visibleLength(r.label))));
    const detailW = caps.columns - labelW - 10;
    for (const r of rows) {
      const icon = { pass: c.mint(sym.ok), warn: c.amber(sym.warn), fail: c.red(sym.fail), info: c.sky(sym.info) }[r.status] || sym.info;
      const lines = wrap(r.detail, detailW);
      write(`  ${icon} ${c.bold(r.label.padEnd(labelW))}  ${lines[0]}`);
      for (const l of lines.slice(1)) write(`    ${" ".repeat(labelW)}  ${l}`);
      if (r.fix && r.status !== "pass") for (const l of wrap(r.fix, detailW)) write(`    ${" ".repeat(labelW)}  ${c.gray(sym.arrow + " " + l)}`);
    }
  }

  function box(lines, { color = "violet" } = {}) {
    if (silent) return;
    const paintBorder = c[color] || ((s) => s);
    const width = Math.min(caps.columns - 4, Math.max(...lines.map((l) => visibleLength(l))) + 4);
    const [tl, tr, bl, br] = sym.corner;
    write("  " + paintBorder(tl + sym.h.repeat(width) + tr));
    for (const l of lines) write("  " + paintBorder(sym.v) + "  " + l + " ".repeat(Math.max(0, width - 2 - visibleLength(l))) + paintBorder(sym.v));
    write("  " + paintBorder(bl + sym.h.repeat(width) + br));
  }

  /** Path relative to the current folder, unless that would climb out of it. */
  const rel = (p) => {
    const r = path.relative(process.cwd(), p);
    if (!r) return ".";
    return r.startsWith("..") || path.isAbsolute(r) ? p : r;
  };

  const fmtTime = (s) => {
    const t = Math.max(0, Math.round(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };
  const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? (n / 1024).toFixed(0) + " KB" : n + " B");

  /** In-place progress bar for TTYs; coarse lines for logs and pipes. */
  function progress(label = "Rendering") {
    let lastPct = -1;
    let active = false;
    return {
      update(p) {
        if (silent) return;
        const ratio = Math.min(1, p.done / Math.max(1, p.total));
        const pct = Math.floor(ratio * 100);
        if (!caps.isTTY) {
          if (pct >= lastPct + 25 || pct === 100) {
            lastPct = pct;
            stream.write(`  ${label} ${pct}%  (${p.done}/${p.total} frames)\n`);
          }
          return;
        }
        const width = Math.max(14, Math.min(34, caps.columns - 54));
        const filled = Math.round(ratio * width);
        const bar = gradient(sym.bar.repeat(filled), [PALETTE.violet, PALETTE.pink]) + c.gray(sym.barEmpty.repeat(width - filled));
        const eta = p.done >= p.total ? "done" : "ETA " + fmtTime(p.etaSec);
        active = true;
        stream.write(`\r${ESC}2K  ${bar} ${c.bold(String(pct).padStart(3))}%  ${c.gray("frame")} ${p.done}/${p.total}  ${c.mint(p.renderFps.toFixed(1) + " fps")}  ${c.gray(eta)}${p.workers > 1 ? c.gray("  x" + p.workers) : ""}`);
      },
      done() {
        if (active && caps.isTTY) stream.write("\n");
        active = false;
      }
    };
  }

  function spinner(text) {
    if (silent) return { update() {}, succeed() {}, fail() {}, stop() {} };
    const frames = caps.unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["|", "/", "-", "\\"];
    let i = 0;
    let label = text;
    let timer = null;
    const render = () => stream.write(`\r${ESC}2K  ${c.violet(frames[i++ % frames.length])} ${label}`);
    if (caps.isTTY) {
      render();
      timer = setInterval(render, 80);
    } else stream.write(`  ${sym.arrow} ${label}...\n`);
    const end = (icon, msg) => {
      if (timer) clearInterval(timer);
      timer = null;
      if (caps.isTTY) stream.write(`\r${ESC}2K  ${icon} ${msg ?? label}\n`);
      else if (msg) stream.write(`  ${icon} ${msg}\n`);
    };
    return {
      update(t) {
        label = t;
        if (!caps.isTTY) stream.write(`  ${sym.arrow} ${t}...\n`);
      },
      succeed: (m) => end(c.mint(sym.ok), m),
      fail: (m) => end(c.red(sym.fail), m),
      stop: () => end("", "")
    };
  }

  async function confirm(question, defaultYes = true) {
    if (!caps.isTTY || !process.stdin.isTTY || silent) return false;
    const rl = readline.createInterface({ input: process.stdin, output: stream });
    const hint = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = await new Promise((res) => rl.question(`  ${c.violet("?")} ${question} ${c.gray(hint)} `, res));
    rl.close();
    const a = answer.trim().toLowerCase();
    return a === "" ? defaultYes : a === "y" || a === "yes";
  }

  return { caps, c, sym, gradient, banner, write, raw, step, success, warn, info, dim, error, kv, checklist, box, progress, spinner, confirm, fmtTime, fmtBytes, rel, wrap, json, quiet, silent, stream };
}
