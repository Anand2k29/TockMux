// Builds promo/demo-recording.html from a recording (rec.json) and replay-script.js.
// Usage: node promo/build-recording.mjs <rec.json> [out.html]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = process.argv[3] || path.join(here, "demo-recording.html");
const script = fs.readFileSync(path.join(here, "replay-script.js"), "utf8");
const seconds = Math.ceil(rec.duration) + 2;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TockMux terminal recording</title>
<meta name="html2mp4:duration" content="${seconds}">
<meta name="html2mp4:width" content="1280">
<meta name="html2mp4:height" content="720">
<style>
  :root { --paper:#F4EFE3; --ink:#161514; --mustard:#E3B95C; --rose:#E59A8A; --sage:#A9C5A0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1280px; height: 720px; overflow: hidden; background: var(--paper); font-family: Arial, sans-serif; }
  .bar { position: absolute; left: 0; right: 0; top: 0; height: 48px; background: var(--ink); display: flex; align-items: center; gap: 10px; padding: 0 22px; }
  .bar i { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--paper); display: inline-block; }
  .bar i:nth-child(1) { background: var(--rose); }
  .bar i:nth-child(2) { background: var(--mustard); }
  .bar i:nth-child(3) { background: var(--sage); }
  .bar span { color: var(--paper); font: 700 15px "Courier New", monospace; margin-left: 16px; opacity: .75; }
  .term { position: absolute; left: 56px; top: 80px; width: 1168px; height: 560px; background: #0E0D0C; border: 3px solid var(--ink); box-shadow: 12px 12px 0 var(--mustard); overflow: hidden; padding: 18px 24px; }
  .screen { font: 18px/1.42 "Courier New", Consolas, monospace; color: #E9E4D6; white-space: pre; will-change: transform; }
  .fg30 { color: #5A5650; } .fg31 { color: #E59A8A; } .fg32 { color: #A9C5A0; } .fg33 { color: #E3B95C; }
  .fg34 { color: #9DB2CC; } .fg35 { color: #C9BEDD; } .fg36 { color: #9DB2CC; } .fg37 { color: #F4EFE3; }
  .fg90 { color: #8A8478; } .fg91 { color: #F0B3A6; } .fg92 { color: #C4DCC0; } .fg93 { color: #F2D38A; }
  .fg94 { color: #BCD0E4; } .fg95 { color: #DDD4EE; } .fg96 { color: #BCD0E4; } .fg97 { color: #FFFDF7; }
  .b { font-weight: 700; }
  .label { position: absolute; left: 56px; bottom: 22px; font: 700 17px Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--ink); }
  .note { position: absolute; right: 56px; bottom: 22px; font: 600 15px "Courier New", monospace; color: #6E685C; }
</style>
</head>
<body>
<div class="bar"><i></i><i></i><i></i><span>terminal · recorded from tockmux 4.0.1</span></div>
<div class="term"><div class="screen" id="screen"></div></div>
<div class="label">Real terminal output · render, then watch</div>
<div class="note" id="clock">0.0 s</div>
<script>
const CHUNKS = ${JSON.stringify(rec.chunks)};
</script>
<script>
${script}
</script>
</body>
</html>
`;

fs.writeFileSync(out, page);
console.log("wrote", out, "seconds", seconds, "chunks", rec.chunks.length);
