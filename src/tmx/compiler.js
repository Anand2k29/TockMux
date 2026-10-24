import { THEMES } from "./themes.js";

const safeJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Compile a parsed .tmx AST into a normal HTML page. The page is a pure function of time
 * (render(t)), driven by requestAnimationFrame, so it goes through the same virtual-clock
 * pipeline as any hand-written HTML. It also exposes window.__seek(ms).
 */
export function compileTmxToHtml(ast) {
  const theme = THEMES[ast.theme] || THEMES.midnight;
  const vars = Object.entries(theme.vars).map(([k, v]) => `--${k}:${v};`).join("");
  const data = {
    scenes: ast.scenes,
    duration: ast.duration,
    bg: ast.bg,
    base: { transition: "pop" }
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${ast.width}, initial-scale=1">
<meta name="html2mp4:duration" content="${ast.duration}">
<meta name="html2mp4:width" content="${ast.width}">
<meta name="html2mp4:height" content="${ast.height}">
<meta name="html2mp4:start" content="auto">
<title>${escHtml(ast.title)}</title>
<style>
  :root{${vars}}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;overflow:hidden;background:var(--bg1);color:var(--ink);
    font-family:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif}
  #bg{position:absolute;inset:0;background:radial-gradient(120% 90% at 15% 0%,var(--bg2) 0%,var(--bg1) 62%)}
  #glow{position:absolute;width:70vmin;height:70vmin;right:-18vmin;bottom:-22vmin;border-radius:50%;
    background:radial-gradient(circle,var(--accent) 0%,transparent 68%);opacity:.28;filter:blur(2vmin)}
  #stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:9vmin}
  .scene{width:100%;max-width:150vmin;display:flex;flex-direction:column;gap:3vmin;align-items:flex-start}
  .el{will-change:transform,opacity}
  .badge{display:inline-block;padding:1.1vmin 2.6vmin;border-radius:99px;font-size:2.5vmin;font-weight:600;
    color:var(--ink);background:var(--card);border:.3vmin solid var(--line);letter-spacing:.02em}
  .title{font-size:8vmin;font-weight:800;line-height:1.04;letter-spacing:-.02em}
  .hl{background:linear-gradient(100deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.04em}
  .subtitle{font-size:3.7vmin;line-height:1.35;color:var(--muted);font-weight:500;max-width:100vmin}
  .code{font-family:"Cascadia Code",Consolas,"SF Mono",Menlo,monospace;font-size:3vmin;background:var(--code);color:var(--gold);
    padding:2.4vmin 3.2vmin;border-radius:2vmin;border:.3vmin solid var(--line);max-width:100%;overflow-wrap:anywhere}
  .counter{font-size:16vmin;font-weight:800;letter-spacing:-.03em;background:linear-gradient(100deg,var(--accent),var(--accent2));
    -webkit-background-clip:text;background-clip:text;color:transparent;line-height:1}
  .bar{width:100%;height:3.2vmin;border-radius:99px;background:var(--card);border:.3vmin solid var(--line);overflow:hidden}
  .bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
  .list{list-style:none;display:flex;flex-direction:column;gap:2vmin}
  .list li{font-size:4vmin;font-weight:600;display:flex;gap:2vmin;align-items:center}
  .list li:before{content:"";width:1.6vmin;height:1.6vmin;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));flex:none}
  .quote{font-size:5vmin;font-weight:600;line-height:1.25;border-left:.9vmin solid var(--accent);padding-left:3vmin;max-width:110vmin}
  .quote small{display:block;margin-top:1.6vmin;font-size:2.8vmin;color:var(--muted);font-weight:500}
  .image{max-width:100%;max-height:48vmin;border-radius:2vmin;border:.3vmin solid var(--line)}
  #caption{position:absolute;left:50%;bottom:6vmin;transform:translateX(-50%);max-width:88%;text-align:center;font-size:3vmin;font-weight:600;
    padding:1.4vmin 3.4vmin;border-radius:99px;background:rgba(0,0,0,.55);color:#fff;display:none;backdrop-filter:blur(1vmin)}
  #mark{position:absolute;top:4vmin;right:5vmin;font-size:2.4vmin;font-weight:700;color:var(--muted);letter-spacing:.04em}
  #progress{position:absolute;left:0;bottom:0;height:.9vmin;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2),var(--gold))}
</style>
</head>
<body>
<div id="bg"></div><div id="glow"></div>
<div id="stage"></div>
<div id="caption"></div>
<div id="mark">${escHtml(ast.watermark)}</div>
<div id="progress"></div>
<script>
(function () {
  var DATA = ${safeJson(data)};
  var stage = document.getElementById("stage");
  var caption = document.getElementById("caption");
  var progress = document.getElementById("progress");
  var bgEl = document.getElementById("bg");
  var current = -1;
  var nodes = [];

  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }

  function sceneIndexAt(t) {
    var s = DATA.scenes;
    for (var i = 0; i < s.length; i++) if (t >= s[i].start && t < s[i].end) return i;
    return t >= (s.length ? s[s.length - 1].end : 0) ? s.length - 1 : -1;
  }

  function build(i) {
    stage.textContent = "";
    nodes = [];
    caption.style.display = "none";
    var sc = DATA.scenes[i];
    if (!sc) return;
    var box = document.createElement("div");
    box.className = "scene";
    sc.elements.forEach(function (el) {
      if (el.type === "caption") return;
      var n = document.createElement(el.type === "list" ? "ul" : "div");
      n.className = "el " + el.type;
      if (el.type === "title") {
        var hl = el.highlight && el.text.indexOf(el.highlight) !== -1 ? el.highlight : "";
        if (hl) {
          var at = el.text.indexOf(hl);
          n.appendChild(document.createTextNode(el.text.slice(0, at)));
          var sp = document.createElement("span"); sp.className = "hl"; sp.textContent = hl; n.appendChild(sp);
          n.appendChild(document.createTextNode(el.text.slice(at + hl.length)));
        } else n.textContent = el.text;
        if (el.color) n.style.color = el.color;
      } else if (el.type === "code") n.textContent = "$ " + el.text;
      else if (el.type === "bar") n.appendChild(document.createElement("i"));
      else if (el.type === "list") el.items.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; n.appendChild(li); });
      else if (el.type === "quote") { n.textContent = el.text; if (el.by) { var sm = document.createElement("small"); sm.textContent = el.by; n.appendChild(sm); } }
      else if (el.type === "image") { var im = document.createElement("img"); im.className = "image"; im.src = el.text; n = im; n.classList.add("el"); }
      else n.textContent = el.text;
      box.appendChild(n);
      nodes.push({ el: el, n: n });
    });
    stage.appendChild(box);
    var bg = sc.bg || DATA.bg;
    bgEl.style.background = bg ? bg : "";
  }

  function render(t) {
    var i = sceneIndexAt(t);
    if (i !== current) { current = i; build(i); }
    progress.style.width = clamp(t / DATA.duration) * 100 + "%";
    var sc = DATA.scenes[i];
    if (!sc) return;
    var local = t - sc.start;
    var span = Math.max(0.001, sc.end - sc.start);
    var out = clamp((sc.end - t) / 0.25);
    var tr = sc.transition || "pop";
    nodes.forEach(function (o, k) {
      var p = easeOut(clamp((local - k * 0.12) / 0.55));
      var op = tr === "none" ? 1 : p;
      var x = "none";
      if (tr === "pop") x = "translateY(" + (1 - p) * 3 + "vmin) scale(" + (0.94 + 0.06 * p) + ")";
      else if (tr === "slide") x = "translateX(" + (1 - p) * 9 + "vmin)";
      else if (tr === "zoom") x = "scale(" + (1.18 - 0.18 * p) + ")";
      o.n.style.opacity = op * (i === DATA.scenes.length - 1 ? 1 : 0.15 + 0.85 * out);
      o.n.style.transform = x;
      var el = o.el, lp = clamp(local / (span * 0.85));
      if (el.type === "counter") o.n.textContent = Math.round(el.fromVal + (el.toVal - el.fromVal) * easeOut(lp)) + el.suffix;
      if (el.type === "bar") o.n.firstChild.style.width = Math.round(el.percent * easeOut(lp)) + "%";
    });
    var cap = "";
    sc.elements.forEach(function (e) { if (e.type === "caption") cap = e.text; });
    if (cap) { caption.textContent = cap; caption.style.display = "block"; caption.style.opacity = clamp(local / 0.4); }
    else caption.style.display = "none";
  }

  window.__seek = function (ms) { render(Math.max(0, ms / 1000)); };
  render(0);
  function frame(now) { render(now / 1000); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { window.__READY = true; });
  else window.__READY = true;
})();
</script>
</body>
</html>
`;
}
