import path from "node:path";
import { PRESETS, getPreset, DEFAULT_PRESET } from "./presets.js";
import { TockError } from "../errors.js";

/**
 * Work out the final render settings. Precedence, highest first:
 *   1. explicit flags  (--width, --height, --fps, --duration)
 *   2. --preset
 *   3. the file itself  (<meta name="html2mp4:*"> tags or the .tmx film line)
 *   4. built-in defaults
 * `sources` records where each value came from so the report can show it.
 */
export function resolveSettings({ kind, file, htmlInfo, tmx, flags = {}, detectedDurationSec = null }) {
  const sources = {};
  const preset = flags.preset ? getPreset(flags.preset) : null;
  if (flags.preset && !preset) {
    throw new TockError(`Unknown preset "${flags.preset}".`, { hint: `Available presets: ${Object.keys(PRESETS).join(", ")}`, code: "BAD_PRESET" });
  }
  const fromFile = kind === "tmx"
    ? { width: tmx.sizeDeclared || tmx.preset ? tmx.width : undefined, height: tmx.height, fps: tmx.fps, duration: tmx.duration || undefined }
    : { width: htmlInfo?.width, height: htmlInfo?.height, fps: htmlInfo?.fps, duration: htmlInfo?.duration };
  const def = PRESETS[DEFAULT_PRESET];

  const pick = (name, flagVal, presetVal, fileVal, defVal) => {
    if (flagVal !== undefined) return (sources[name] = "flag"), flagVal;
    if (presetVal !== undefined) return (sources[name] = "preset"), presetVal;
    if (fileVal !== undefined) return (sources[name] = kind === "tmx" ? "tmx" : "meta"), fileVal;
    return (sources[name] = "default"), defVal;
  };

  const width = pick("width", flags.width, preset?.width, fromFile.width, def.width);
  const height = pick("height", flags.height, preset?.height, fromFile.height, def.height);
  const fps = pick("fps", flags.fps, preset?.fps, fromFile.fps, def.fps);

  let duration;
  if (flags.duration !== undefined) (duration = flags.duration), (sources.duration = "flag");
  else if (fromFile.duration !== undefined) (duration = fromFile.duration), (sources.duration = kind === "tmx" ? "tmx" : "meta");
  else if (detectedDurationSec) (duration = detectedDurationSec), (sources.duration = "detected");
  else (duration = 10), (sources.duration = "default");

  const errors = [];
  if (!(width >= 16 && width <= 7680)) errors.push(`width ${width} must be between 16 and 7680`);
  if (!(height >= 16 && height <= 7680)) errors.push(`height ${height} must be between 16 and 7680`);
  if (!(fps >= 1 && fps <= 120)) errors.push(`fps ${fps} must be between 1 and 120`);
  if (!(duration > 0 && duration <= 3600)) errors.push(`duration ${duration}s must be between 0 and 3600`);
  if (errors.length) throw new TockError("Invalid render settings.", { hint: errors.join("\n"), code: "BAD_SETTINGS" });

  let start;
  if (flags.start !== undefined) (start = flags.start), (sources.start = "flag");
  else if (kind === "html" && htmlInfo?.start) (start = htmlInfo.start), (sources.start = "meta");
  else if (kind === "html" && htmlInfo?.startGuess) (start = htmlInfo.startGuess), (sources.start = "guessed");
  const actions = [];
  if (kind === "tmx") actions.push(...tmx.actions);
  if (start && start !== "auto" && start !== "none") actions.push({ type: "click", selector: start, at: 0 });

  const recipe = flags.recipe ?? (kind === "tmx" ? tmx.recipe : undefined);

  return {
    kind,
    file: file ? path.resolve(file) : null,
    width: Math.round(width),
    height: Math.round(height),
    fps: Math.round(fps),
    duration: Number(duration),
    start: start || "auto",
    actions,
    recipe: recipe === "autoscroll" ? "autoscroll" : "timeline",
    sources
  };
}

/** Turn "12s", "1500ms", "0:12" or "12" into seconds. Returns undefined for empty input. */
export function parseTime(value, label = "time") {
  if (value === undefined || value === null || value === "") return undefined;
  const s = String(value).trim();
  let m;
  if ((m = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number("0." + m[3]) : 0);
  if ((m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(s))) return m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]);
  throw new TockError(`Cannot read ${label} "${value}".`, { hint: 'Use seconds like 12 or 12s, milliseconds like 1500ms, or minutes:seconds like 1:30.', code: "BAD_TIME" });
}
