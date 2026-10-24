/** Colour themes for compiled .tmx films. Each is a set of CSS variables. */
export const THEMES = Object.freeze({
  midnight: {
    label: "Deep indigo with violet, pink and amber",
    vars: { bg1: "#0f1030", bg2: "#1d1450", ink: "#f6f4ff", muted: "#b9b4e6", accent: "#8b6bff", accent2: "#ff6b9a", gold: "#ffc857", card: "rgba(255,255,255,0.07)", line: "rgba(255,255,255,0.16)", code: "#0a0b22" }
  },
  paper: {
    label: "Light, clean and editorial",
    vars: { bg1: "#f7f5ff", bg2: "#e8e4ff", ink: "#1a1740", muted: "#5c5890", accent: "#5b3df5", accent2: "#e5367a", gold: "#f0a500", card: "rgba(255,255,255,0.85)", line: "rgba(26,23,64,0.14)", code: "#1a1740" }
  },
  sunset: {
    label: "Warm plum into orange",
    vars: { bg1: "#2a0f3d", bg2: "#7a2a4f", ink: "#fff6ee", muted: "#f2c8b8", accent: "#ff8a4c", accent2: "#ffd36e", gold: "#ffd36e", card: "rgba(255,255,255,0.09)", line: "rgba(255,255,255,0.2)", code: "#1c0a2a" }
  },
  ocean: {
    label: "Deep teal with mint and sky",
    vars: { bg1: "#06202b", bg2: "#0b4a55", ink: "#effffb", muted: "#a5d9d1", accent: "#2fe0b8", accent2: "#5cc8ff", gold: "#ffe08a", card: "rgba(255,255,255,0.08)", line: "rgba(255,255,255,0.18)", code: "#041820" }
  },
  mono: {
    label: "Black and white with a single accent",
    vars: { bg1: "#0c0c0c", bg2: "#1b1b1b", ink: "#ffffff", muted: "#a8a8a8", accent: "#ffffff", accent2: "#ff4d4d", gold: "#ffffff", card: "rgba(255,255,255,0.06)", line: "rgba(255,255,255,0.2)", code: "#000000" }
  }
});
