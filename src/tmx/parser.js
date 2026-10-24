import { PRESETS, getPreset } from "../core/presets.js";
import { THEMES } from "./themes.js";
import { TockError } from "../errors.js";

export const ELEMENT_TYPES = ["badge", "title", "subtitle", "code", "counter", "bar", "list", "quote", "image", "caption"];
export const TRANSITIONS = ["pop", "slide", "zoom", "fade", "none"];

/* ------------------------------------------------------------------ */
/* tokenizer: handles "quoted strings" (with \" escapes) and key=value */
/* ------------------------------------------------------------------ */
export function tokenize(line) {
  const tokens = [];
  let i = 0;
  const n = line.length;
  const readQuoted = () => {
    // assumes line[i] === '"'
    i++;
    let out = "";
    while (i < n && line[i] !== '"') {
      if (line[i] === "\\" && i + 1 < n) {
        const nx = line[i + 1];
        out += nx === "n" ? "\n" : nx;
        i += 2;
      } else out += line[i++];
    }
    if (i >= n) throw new Error("Unclosed quote");
    i++; // closing quote
    return out;
  };
  while (i < n) {
    const ch = line[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      tokens.push({ type: "str", value: readQuoted() });
      continue;
    }
    if (ch === "{" || ch === "}") {
      tokens.push({ type: "brace", value: ch });
      i++;
      continue;
    }
    // word or key=value
    let start = i;
    while (i < n && !/\s/.test(line[i]) && line[i] !== "=" && line[i] !== "{" && line[i] !== "}" && line[i] !== '"') i++;
    const word = line.slice(start, i);
    if (line[i] === "=") {
      i++;
      let value;
      if (line[i] === '"') value = readQuoted();
      else {
        const s = i;
        while (i < n && !/\s/.test(line[i]) && line[i] !== "{" && line[i] !== "}") i++;
        value = line.slice(s, i);
      }
      tokens.push({ type: "attr", key: word.toLowerCase(), value });
    } else if (word) {
      tokens.push({ type: "word", value: word });
    } else {
      i++; // stray character, skip
    }
  }
  return tokens;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function didYouMean(word, options) {
  let best = null;
  let bestD = 3;
  for (const o of options) {
    const d = levenshtein(word.toLowerCase(), o);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

const seconds = (s) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(String(s).trim());
  if (!m) return NaN;
  return m[2] === "ms" ? parseFloat(m[1]) / 1000 : parseFloat(m[1]);
};

function emptyAst() {
  return {
    title: "Untitled film",
    duration: 0,
    durationDeclared: false,
    width: 1920,
    height: 1080,
    fps: 30,
    preset: "youtube",
    sizeDeclared: false,
    bg: null,
    theme: "midnight",
    watermark: "",
    recipe: "timeline",
    voiceover: null,
    ttsScript: null,
    music: null,
    musicVolume: 0.25,
    actions: [],
    scenes: [],
    diagnostics: []
  };
}

/**
 * Parse .tmx source into an AST. Never throws on bad input: problems are collected in
 * `ast.diagnostics` as `{ line, level: "error" | "warn", message }` so the CLI and Studio
 * can show every problem at once with line numbers.
 */
export function parseTmx(sourceText) {
  const ast = emptyAst();
  const diag = (line, level, message) => ast.diagnostics.push({ line, level, message });
  const lines = String(sourceText).replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  let scene = null;
  let sceneLine = 0;

  const parseElement = (tokens, lineNo) => {
    if (!tokens.length) return;
    const head = tokens[0];
    if (head.type !== "word") return diag(lineNo, "error", "Expected an element name such as title, subtitle or caption.");
    const type = head.value.toLowerCase();
    if (!ELEMENT_TYPES.includes(type)) {
      const sug = didYouMean(type, ELEMENT_TYPES);
      return diag(lineNo, "error", `Unknown element "${head.value}".${sug ? ` Did you mean "${sug}"?` : ` Valid elements: ${ELEMENT_TYPES.join(", ")}.`}`);
    }
    const attrs = {};
    const strs = [];
    for (const t of tokens.slice(1)) {
      if (t.type === "attr") attrs[t.key] = t.value;
      else if (t.type === "str") strs.push(t.value);
    }
    const el = {
      type,
      text: strs[0] ?? "",
      items: type === "list" ? strs : [],
      highlight: attrs.highlight ?? "",
      color: attrs.color ?? "",
      by: attrs.by ?? "",
      fromVal: attrs.from !== undefined ? parseFloat(attrs.from) : 0,
      toVal: attrs.to !== undefined ? parseFloat(attrs.to) : 100,
      suffix: attrs.suffix ?? "",
      percent: attrs.percent !== undefined ? parseFloat(attrs.percent) : 100
    };
    if (["badge", "title", "subtitle", "code", "caption", "quote", "image"].includes(type) && !el.text) {
      return diag(lineNo, "error", `"${type}" needs text in quotes, e.g. ${type} "Hello".`);
    }
    if (type === "list" && !strs.length) return diag(lineNo, "error", 'list needs items, e.g. list "One" "Two" "Three".');
    if (type === "counter" && (isNaN(el.fromVal) || isNaN(el.toVal))) return diag(lineNo, "error", "counter needs numeric from= and to= values.");
    if (type === "bar" && (isNaN(el.percent) || el.percent < 0 || el.percent > 100)) return diag(lineNo, "error", "bar percent= must be between 0 and 100.");
    if (el.highlight && type === "title" && !el.text.includes(el.highlight)) {
      diag(lineNo, "warn", `highlight="${el.highlight}" does not appear in the title text, so it will not be highlighted.`);
    }
    scene.elements.push(el);
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const raw = lines[idx].trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("//")) continue;

    let tokens;
    try {
      tokens = tokenize(raw);
    } catch (e) {
      diag(lineNo, "error", `${e.message} on this line. Check that every " has a matching ".`);
      continue;
    }
    if (!tokens.length) continue;

    // closing brace(s)
    if (tokens.length === 1 && tokens[0].type === "brace" && tokens[0].value === "}") {
      if (!scene) diag(lineNo, "warn", 'Found "}" without an open scene.');
      scene = null;
      continue;
    }

    const first = tokens[0].type === "word" ? tokens[0].value.toLowerCase() : "";

    if (first === "film") {
      const rest = tokens.slice(1);
      const t = rest.find((x) => x.type === "str");
      if (t) ast.title = t.value;
      for (const a of rest.filter((x) => x.type === "attr")) {
        switch (a.key) {
          case "preset": {
            const p = getPreset(a.value);
            if (!p) {
              const sug = didYouMean(a.value, Object.keys(PRESETS));
              diag(lineNo, "error", `Unknown preset "${a.value}".${sug ? ` Did you mean "${sug}"?` : ""} Available: ${Object.keys(PRESETS).join(", ")}.`);
            } else {
              ast.preset = a.value.toLowerCase();
              if (!ast.sizeDeclared) {
                ast.width = p.width;
                ast.height = p.height;
              }
              if (!ast._fpsDeclared) ast.fps = p.fps;
            }
            break;
          }
          case "duration": {
            const d = seconds(a.value);
            if (isNaN(d) || d <= 0) diag(lineNo, "error", `duration="${a.value}" is not a positive time. Use e.g. duration=12s.`);
            else {
              ast.duration = d;
              ast.durationDeclared = true;
            }
            break;
          }
          case "size": {
            const m = /^(\d+)x(\d+)$/i.exec(a.value);
            if (!m) diag(lineNo, "error", `size="${a.value}" must look like 1920x1080.`);
            else {
              ast.width = parseInt(m[1], 10);
              ast.height = parseInt(m[2], 10);
              ast.sizeDeclared = true;
            }
            break;
          }
          case "fps": {
            const f = parseInt(a.value, 10);
            if (!(f >= 1 && f <= 120)) diag(lineNo, "error", `fps=${a.value} must be between 1 and 120.`);
            else {
              ast.fps = f;
              ast._fpsDeclared = true;
            }
            break;
          }
          case "bg":
            ast.bg = a.value;
            break;
          case "theme":
            if (!THEMES[a.value.toLowerCase()]) {
              const sug = didYouMean(a.value, Object.keys(THEMES));
              diag(lineNo, "error", `Unknown theme "${a.value}".${sug ? ` Did you mean "${sug}"?` : ""} Available: ${Object.keys(THEMES).join(", ")}.`);
            } else ast.theme = a.value.toLowerCase();
            break;
          case "recipe":
            ast.recipe = a.value.toLowerCase();
            break;
          default:
            diag(lineNo, "warn", `Unknown film option "${a.key}" was ignored.`);
        }
      }
      continue;
    }

    if (first === "watermark") {
      const s = tokens.find((x) => x.type === "str");
      if (s) ast.watermark = s.value;
      else diag(lineNo, "error", 'watermark needs text in quotes, e.g. watermark "mybrand.com".');
      continue;
    }
    if (first === "voiceover" || first === "audio") {
      const s = tokens.find((x) => x.type === "str");
      if (s) ast.voiceover = s.value;
      else diag(lineNo, "error", `${first} needs a file path in quotes.`);
      continue;
    }
    if (first === "elevenlabs_tts" || first === "tts") {
      const s = tokens.find((x) => x.type === "str");
      if (s) ast.ttsScript = s.value;
      else diag(lineNo, "error", `${first} needs the narration text in quotes.`);
      continue;
    }
    if (first === "music") {
      const s = tokens.find((x) => x.type === "str");
      if (!s) diag(lineNo, "error", "music needs a file path in quotes.");
      else ast.music = s.value;
      const vol = tokens.find((x) => x.type === "attr" && x.key === "volume");
      if (vol) {
        const v = parseFloat(vol.value);
        if (isNaN(v) || v < 0) diag(lineNo, "error", `volume=${vol.value} must be a number such as 20% or 0.2.`);
        else ast.musicVolume = v > 1 ? v / 100 : v;
      }
      continue;
    }
    if (first === "action") {
      const sel = tokens.find((x) => x.type === "attr" && x.key === "click");
      const at = tokens.find((x) => x.type === "attr" && x.key === "at");
      if (!sel) diag(lineNo, "error", 'action needs click="#selector", e.g. action click="#go" at=1.5s.');
      else ast.actions.push({ type: "click", selector: sel.value, at: at ? seconds(at.value) || 0 : 0 });
      continue;
    }

    if (first === "scene") {
      if (scene) diag(lineNo, "warn", `Scene starting on line ${sceneLine} was not closed with "}".`);
      const range = raw.match(/(\d+(?:\.\d+)?)s?\s*\.\.\s*(\d+(?:\.\d+)?)s?/);
      if (!range) {
        diag(lineNo, "error", "scene needs a time range such as scene 0s..3s { ... }.");
        scene = { start: 0, end: 3, bg: "", transition: "pop", elements: [] };
        ast.scenes.push(scene);
        sceneLine = lineNo;
        continue;
      }
      const start = parseFloat(range[1]);
      const end = parseFloat(range[2]);
      if (!(end > start)) diag(lineNo, "error", `scene range ${start}s..${end}s must end after it starts.`);
      const attrs = Object.fromEntries(tokens.filter((x) => x.type === "attr").map((x) => [x.key, x.value]));
      let transition = (attrs.transition || "pop").toLowerCase();
      if (!TRANSITIONS.includes(transition)) {
        diag(lineNo, "error", `Unknown transition "${attrs.transition}". Use one of: ${TRANSITIONS.join(", ")}.`);
        transition = "pop";
      }
      scene = { start, end, bg: attrs.bg || "", transition, elements: [] };
      ast.scenes.push(scene);
      sceneLine = lineNo;
      if (!tokens.some((x) => x.type === "brace" && x.value === "{")) {
        diag(lineNo, "error", 'scene line must end with "{".');
      }
      // single-line form: scene 0s..3s { title "Hi"; caption "There" }
      const open = raw.indexOf("{");
      const close = raw.lastIndexOf("}");
      if (open !== -1 && close > open) {
        for (const part of raw.slice(open + 1, close).split(";")) {
          if (!part.trim()) continue;
          try {
            parseElement(tokenize(part.trim()), lineNo);
          } catch (e) {
            diag(lineNo, "error", e.message);
          }
        }
        scene = null;
      }
      continue;
    }

    if (scene) {
      parseElement(tokens, lineNo);
      continue;
    }

    const sug = didYouMean(tokens[0].value || "", ["film", "scene", "watermark", "voiceover", "music", "action", "tts"]);
    diag(lineNo, "error", `Unexpected "${tokens[0].value ?? tokens[0].key ?? raw}" outside a scene.${sug ? ` Did you mean "${sug}"?` : ""}`);
  }

  if (scene) ast.diagnostics.push({ line: sceneLine, level: "error", message: `Scene starting on line ${sceneLine} is missing its closing "}".` });

  if (!ast.scenes.length) ast.diagnostics.push({ line: 0, level: "error", message: "No scenes found. Add at least one: scene 0s..3s { title \"Hello\" }" });

  const lastEnd = ast.scenes.length ? Math.max(...ast.scenes.map((s) => s.end)) : 0;
  if (!ast.durationDeclared) ast.duration = lastEnd;
  else if (lastEnd > ast.duration + 1e-6) {
    ast.diagnostics.push({ line: 0, level: "warn", message: `Last scene ends at ${lastEnd}s but duration is ${ast.duration}s, so the end will be cut off.` });
  }
  // scene overlap warning
  const sorted = [...ast.scenes].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end - 1e-6) {
      ast.diagnostics.push({ line: 0, level: "warn", message: `Scenes overlap around ${sorted[i].start}s; the earlier scene is shown.` });
    }
  }
  delete ast._fpsDeclared;
  return ast;
}

/** Throw a readable TockError if the AST has errors. */
export function assertValidTmx(ast, fileLabel = "file.tmx") {
  const errs = ast.diagnostics.filter((d) => d.level === "error");
  if (!errs.length) return ast;
  const list = errs.map((e) => `  ${fileLabel}${e.line ? ":" + e.line : ""}  ${e.message}`).join("\n");
  throw new TockError(`${errs.length} problem${errs.length > 1 ? "s" : ""} in ${fileLabel}`, { hint: list, code: "TMX_INVALID" });
}
