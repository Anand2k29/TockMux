// Replays recorded terminal output at its original timing.
// CHUNKS is inserted by build-recording.mjs: real output from real runs, with real seconds.
const LINE_H = 18 * 1.42;
const VISIBLE = Math.floor((560 - 36) / LINE_H);
const SGR_FG = { 30: "fg30", 31: "fg31", 32: "fg32", 33: "fg33", 34: "fg34", 35: "fg35", 36: "fg36", 37: "fg37",
  90: "fg90", 91: "fg91", 92: "fg92", 93: "fg93", 94: "fg94", 95: "fg95", 96: "fg96", 97: "fg97" };

// A small terminal model: rows of cells, carriage return, newline, erase line, and colour codes.
let rows = [[]];
let row = 0;
let col = 0;
let cls = "";
let next = 0;

function put(ch) {
  const r = rows[row] || (rows[row] = []);
  while (r.length < col) r.push({ c: " ", k: "" });
  r[col] = { c: ch, k: cls };
  col++;
}

function fgClasses(list) {
  return list.filter(function (x) { return x.indexOf("fg") !== 0 && x.indexOf("c:") !== 0; });
}

function sgr(params) {
  const codes = params === "" ? [0] : params.split(";").map(Number);
  for (let i = 0; i < codes.length; i++) {
    const n = codes[i];
    if (n === 38 && codes[i + 1] === 2) {
      // 24-bit colour: ESC[38;2;r;g;bm
      const parts = fgClasses(cls.split(" ").filter(Boolean));
      parts.push("c:" + codes[i + 2] + "," + codes[i + 3] + "," + codes[i + 4]);
      cls = parts.join(" ");
      i += 4;
    } else if (n === 0) {
      cls = "";
    } else if (n === 1) {
      const parts = cls.split(" ").filter(function (x) { return x && x !== "b"; });
      parts.push("b");
      cls = parts.join(" ");
    } else if (SGR_FG[n]) {
      const parts = fgClasses(cls.split(" ").filter(Boolean));
      parts.push(SGR_FG[n]);
      cls = parts.join(" ");
    } else if (n === 22) {
      cls = cls.split(" ").filter(function (x) { return x && x !== "b"; }).join(" ");
    } else if (n === 39) {
      cls = fgClasses(cls.split(" ").filter(Boolean)).join(" ");
    }
  }
}

function feed(s) {
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === "\u001b" && s.charAt(i + 1) === "[") {
      let j = i + 2;
      let p = "";
      while (j < s.length && !/[A-Za-z]/.test(s.charAt(j))) { p += s.charAt(j); j++; }
      const end = s.charAt(j);
      if (end === "m") sgr(p.split("?").join(""));
      else if (end === "K") { const r = rows[row] || (rows[row] = []); r.length = Math.min(r.length, col); }
      i = j;
    } else if (ch === "\r") {
      col = 0;
    } else if (ch === "\n") {
      row++;
      col = 0;
      rows[row] = rows[row] || [];
    } else if (ch === "\u001b") {
      // other escape codes are ignored
    } else {
      put(ch);
    }
  }
}

function esc(t) { return t.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;"); }

// Turns a cell's class string into a span, with inline colour for 24-bit colours.
function spanFor(k, text) {
  const tokens = k.split(" ").filter(Boolean);
  const colour = tokens.filter(function (x) { return x.indexOf("c:") === 0; })[0];
  const names = tokens.filter(function (x) { return x.indexOf("c:") !== 0; }).join(" ");
  const style = colour ? ' style="color:rgb(' + colour.slice(2) + ')"' : "";
  return '<span class="' + names + '"' + style + ">" + esc(text) + "</span>";
}

function html() {
  return rows.map(function (r) {
    let out = "";
    let last = null;
    let buf = "";
    const flush = function () {
      if (buf) out += last ? spanFor(last, buf) : esc(buf);
      buf = "";
    };
    for (const cell of r) {
      if (cell.k !== last) { flush(); last = cell.k; }
      buf += cell.c;
    }
    flush();
    return out;
  }).join("\n");
}

const screen = document.getElementById("screen");
const clock = document.getElementById("clock");
let t0 = null;

function frame(t) {
  while (next < CHUNKS.length && CHUNKS[next].t <= t) { feed(CHUNKS[next].text); next++; }
  screen.innerHTML = html();
  const shift = Math.max(0, rows.length - VISIBLE) * LINE_H;
  screen.style.transform = "translateY(" + (-shift) + "px)";
  clock.textContent = t.toFixed(1) + " s";
}

function loop(now) {
  if (t0 === null) t0 = now;
  frame((now - t0) / 1000);
  requestAnimationFrame(loop);
}

frame(0);
requestAnimationFrame(loop);
