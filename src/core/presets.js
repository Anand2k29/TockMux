/** Named output sizes. `tockmux presets` prints this table. */
export const PRESETS = Object.freeze({
  youtube:  { width: 1920, height: 1080, fps: 30, label: "16:9 Full HD (YouTube, web, slides)" },
  hd720:    { width: 1280, height: 720,  fps: 30, label: "16:9 HD 720p (fast previews)" },
  tiktok:   { width: 1080, height: 1920, fps: 30, label: "9:16 vertical (TikTok, Reels, Shorts)" },
  square:   { width: 1080, height: 1080, fps: 30, label: "1:1 square (feed posts)" },
  portrait: { width: 1080, height: 1350, fps: 30, label: "4:5 portrait (Instagram feed)" },
  cinema:   { width: 1920, height: 1080, fps: 60, label: "16:9 Full HD at 60 fps (smooth motion)" },
  "4k":     { width: 3840, height: 2160, fps: 30, label: "16:9 4K UHD (slow, large files)" }
});

export const DEFAULT_PRESET = "youtube";

export function getPreset(name) {
  if (!name) return null;
  return PRESETS[String(name).toLowerCase()] ?? null;
}

export function presetNames() {
  return Object.keys(PRESETS);
}
