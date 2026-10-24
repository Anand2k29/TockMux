/** Static (no browser) inspection of an HTML file's "contract": the meta tags and hints. */

const NS = ["html2mp4", "tockmux"];

function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  const inner = tag.replace(/^<\s*meta\b/i, "").replace(/\/?>$/, "");
  while ((m = re.exec(inner))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

export function readMetaContract(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = parseAttrs(tag);
    const name = (a.name || "").toLowerCase();
    for (const ns of NS) {
      if (name.startsWith(ns + ":")) out[name.slice(ns.length + 1)] = a.content ?? "";
    }
  }
  return out;
}

export function inspectHtml(html) {
  const meta = readMetaContract(html);
  const num = (v) => (v === undefined || v === "" || isNaN(Number(v)) ? undefined : Number(v));
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || "";
  const startFromBtn = /\bid\s*=\s*["'](go|play|start)["']/i.exec(html);
  const libs = [];
  if (/gsap/i.test(html)) libs.push("GSAP");
  if (/anime(\.min)?\.js|anime\(/i.test(html)) libs.push("anime.js");
  if (/lottie/i.test(html)) libs.push("Lottie");
  if (/three(\.min)?\.js|THREE\./.test(html)) libs.push("three.js");
  if (/<canvas\b/i.test(html)) libs.push("canvas");
  if (/<svg\b/i.test(html)) libs.push("SVG");
  const remoteHosts = [...new Set([...html.matchAll(/(?:src|href)\s*=\s*["']https?:\/\/([^/"']+)/gi)].map((m) => m[1]))];
  return {
    title,
    meta,
    duration: num(meta.duration),
    width: num(meta.width),
    height: num(meta.height),
    fps: num(meta.fps),
    start: meta.start || undefined,
    startGuess: startFromBtn ? "#" + startFromBtn[1].toLowerCase() : undefined,
    hasDurationMeta: num(meta.duration) !== undefined,
    hasVideoTag: /<video\b/i.test(html),
    hasAudioTag: /<audio\b/i.test(html),
    hasIframe: /<iframe\b/i.test(html),
    hasBlockingDialog: /\b(alert|confirm|prompt)\s*\(/.test(html),
    hasSeekHook: /window\.__seek\s*=|__seek\s*=\s*(async\s*)?(function|\()/.test(html),
    looksAnimated: /(@keyframes|requestAnimationFrame|setInterval|setTimeout|gsap|anime\(|lottie|\.animate\(|transition\s*:|__seek|<canvas|<animate)/i.test(html),
    usesScrollOnly: /(scroll-snap|IntersectionObserver|addEventListener\(\s*["']scroll["'])/i.test(html) && !/(@keyframes|requestAnimationFrame|gsap)/i.test(html),
    libs,
    remoteHosts
  };
}
