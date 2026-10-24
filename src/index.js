/**
 * TockMux as a library:
 *
 *   import { convert } from "tockmux";
 *   await convert({ input: "promo.html", flags: { output: "promo.mp4", preset: "tiktok" } });
 */
export { convert, checkInput, planJob, snapshot } from "./core/pipeline.js";
export { renderVideo, renderFrame, probeLive, prepareSource, planSegments, detectKind, FORMATS } from "./core/renderer.js";
export { resolveSettings, parseTime } from "./core/settings.js";
export { inspectHtml, readMetaContract } from "./core/html-inspect.js";
export { runPreflight } from "./core/preflight.js";
export { buildClockScript } from "./core/clock-script.js";
export { probeMedia, countFrames, samplePixel, buildMuxArgs, buildGifArgs, buildWebmArgs } from "./core/ffmpeg.js";
export { findBrowser, installBrowser, launchBrowser } from "./core/browser.js";
export { writeToneWav } from "./core/wav.js";
export { PRESETS, getPreset, presetNames } from "./core/presets.js";
export { parseTmx, assertValidTmx, tokenize } from "./tmx/parser.js";
export { compileTmxToHtml } from "./tmx/compiler.js";
export { THEMES } from "./tmx/themes.js";
export { VoiceStore, maskKey, configDir } from "./voice/store.js";
export { VoicePool, splitText } from "./voice/pool.js";
export { startStudio } from "./studio/server.js";
export { runMcpServer, createMcpHandler } from "./mcp/server.js";
export { TockError } from "./errors.js";
export { getVersion } from "./version.js";
