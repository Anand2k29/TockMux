import fs from "node:fs";
import path from "node:path";
import { findBrowser } from "./browser.js";
import { resolveFfmpeg, probeMedia } from "./ffmpeg.js";

/**
 * Pre-flight checks. Returns { ok, rows } where each row is
 * { id, label, status: "pass"|"warn"|"fail"|"info", detail, fix? }.
 * `live` (optional) is the result of probeLive() from renderer.js.
 */
export async function runPreflight({ settings, htmlInfo = null, tmx = null, live = null, voice = null, music = null, baseDir = ".", browserPath } = {}) {
  const rows = [];
  const add = (id, label, status, detail, fix) => rows.push({ id, label, status, detail, ...(fix ? { fix } : {}) });

  // 1. Duration
  const dsrc = { flag: "from --duration", meta: "from <meta> tag", tmx: "from the .tmx file", detected: "detected from CSS animations", default: "default" }[settings.sources.duration];
  if (settings.sources.duration === "default") {
    add("duration", "Duration", "warn", `${settings.duration}s (default). The page never says how long it lasts.`, 'Add <meta name="html2mp4:duration" content="12"> or pass --duration 12');
  } else {
    add("duration", "Duration", "pass", `${settings.duration}s = ${Math.round(settings.duration * settings.fps)} frames (${dsrc})`);
  }

  // 2. Frame size
  add("size", "Frame size", "pass", `${settings.width}x${settings.height} at ${settings.fps} fps`);
  if (live?.info && (live.info.scrollWidth > settings.width + 2 || live.info.scrollHeight > settings.height + 2) && settings.recipe !== "autoscroll") {
    add("overflow", "Fits the frame", "warn", `Page content is ${live.info.scrollWidth}x${live.info.scrollHeight}, larger than the ${settings.width}x${settings.height} frame, so it will be cropped.`, "Set --width/--height (or --preset) to match the page, or use --recipe autoscroll for a long page");
  }

  // 3. Start
  if (settings.start && settings.start !== "auto" && settings.start !== "none") {
    add("start", "Start trigger", "pass", `will click ${settings.start} at 0s${settings.sources.start === "guessed" ? " (guessed from the page; pass --start none to turn this off)" : ""}`);
  }
  else add("start", "Start trigger", "pass", "starts automatically on load");

  // 4. Motion
  if (live) {
    if (live.animates) add("motion", "Page animates", "pass", live.motionDetail || "frames change over time");
    else if (settings.recipe === "autoscroll") add("motion", "Page animates", "pass", "static page, will auto-scroll");
    else add("motion", "Page animates", "warn", "Two frames at different times look identical: the video would be a still image.", "Make the page animate on its own (CSS, JS, GSAP, canvas) or use --recipe autoscroll");
  } else if (htmlInfo) {
    if (htmlInfo.looksAnimated) add("motion", "Motion", "pass", "animation code found (run `check` without --static to confirm)");
    else add("motion", "Motion", "warn", "no animation code found: the video may be a still image", "Use --recipe autoscroll for long pages, or add CSS/JS animation");
  } else if (tmx) {
    add("motion", "Scenes", tmx.scenes.length ? "pass" : "fail", `${tmx.scenes.length} scene(s), theme ${tmx.theme}`);
  }

  // 5. Page health (live only)
  if (live) {
    const bad = [...(live.failedRequests || [])];
    if (bad.length) add("assets", "Assets load", "warn", `${bad.length} file(s) failed: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "..." : ""}`, "Fix the paths, or inline the images/fonts. Remote URLs need internet.");
    else add("assets", "Assets load", "pass", "images, fonts and scripts loaded");
    const errs = [...(live.pageErrors || [])];
    if (errs.length) add("js", "No script errors", "warn", errs.slice(0, 2).join(" | "), "Open the file in Chrome and check the console");
    else add("js", "No script errors", "pass", "console is clean");
  }

  // 6. Media and risky features
  if (htmlInfo) {
    const notes = [];
    if (htmlInfo.hasVideoTag) notes.push("<video> is seeked frame by frame (WebM/VP9 is safest; H.264 needs system Chrome)");
    if (htmlInfo.hasAudioTag) notes.push("<audio> sound is not captured; use --voice or --music instead");
    if (htmlInfo.hasIframe) notes.push("<iframe> content may be blocked or not animate under the virtual clock");
    if (htmlInfo.hasBlockingDialog) notes.push("alert()/confirm()/prompt() will block the page");
    if (htmlInfo.usesScrollOnly) notes.push("page seems driven by scrolling; use --recipe autoscroll");
    if (htmlInfo.remoteHosts.length) notes.push(`needs internet for ${htmlInfo.remoteHosts.slice(0, 3).join(", ")}`);
    if (notes.length) add("features", "Page features", "warn", notes.join("; "));
    else add("features", "Page features", "pass", htmlInfo.libs.length ? `uses ${htmlInfo.libs.join(", ")}` : "plain HTML/CSS/JS");
  }

  // 7. Audio files
  for (const [kind, p] of [["Voice-over", voice], ["Music", music]]) {
    if (!p) continue;
    const full = path.resolve(baseDir, p);
    if (!fs.existsSync(full)) add(kind.toLowerCase(), kind, "fail", `file not found: ${p}`, "Check the path");
    else {
      try {
        const m = await probeMedia(full);
        add(kind.toLowerCase(), kind, m.audio ? "pass" : "fail", m.audio ? `${p} (${m.duration}s)` : `${p} has no audio stream`);
      } catch (e) {
        add(kind.toLowerCase(), kind, "fail", e.message);
      }
    }
  }

  // 8. Tooling
  const b = await findBrowser({ browserPath });
  if (b) add("browser", "Browser", "pass", { playwright: "TockMux Chromium found", system: "Chrome/Edge on this computer found", explicit: "using the browser you chose (--browser / TOCKMUX_BROWSER)" }[b.source] || "found");
  else add("browser", "Browser", "fail", "no Chromium/Chrome found", "Run: tockmux setup");
  const ff = await resolveFfmpeg();
  add("ffmpeg", "FFmpeg", "pass", ff === "ffmpeg" ? "using system ffmpeg" : "bundled with TockMux");

  const ok = !rows.some((r) => r.status === "fail");
  return { ok, rows };
}
