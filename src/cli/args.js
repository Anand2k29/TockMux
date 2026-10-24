import { didYouMean } from "../tmx/parser.js";
import { parseTime } from "../core/settings.js";

const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Flags every command accepts. */
export const GLOBAL_FLAGS = {
  json: { type: "boolean", desc: "Print machine-readable JSON instead of text" },
  quiet: { type: "boolean", alias: "q", desc: "Print only errors" },
  "no-color": { type: "boolean", desc: "Disable colours" },
  debug: { type: "boolean", desc: "Show full error details", hidden: true },
  help: { type: "boolean", alias: "h", desc: "Show help for this command" }
};

/**
 * Tiny argument parser (no dependencies).
 * spec: { name: { type: "boolean" | "string" | "number" | "time", alias?, desc?, choices? } }
 * Supports --flag, --flag value, --flag=value, --no-flag, -o value and `--`.
 */
export function parseArgs(argv, spec = {}) {
  const all = { ...GLOBAL_FLAGS, ...spec };
  const aliases = {};
  for (const [name, def] of Object.entries(all)) if (def.alias) aliases[def.alias] = name;
  const flags = {};
  const positional = [];
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    let name;
    let inline;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      inline = eq === -1 ? undefined : arg.slice(eq + 1);
    } else if (/^-[a-zA-Z]$/.test(arg)) {
      name = aliases[arg.slice(1)];
      if (!name) {
        errors.push(`Unknown option ${arg}`);
        continue;
      }
    } else {
      positional.push(arg);
      continue;
    }
    let negated = false;
    if (!all[name] && name.startsWith("no-") && all[name.slice(3)]?.type === "boolean") {
      name = name.slice(3);
      negated = true;
    }
    const def = all[name];
    if (!def) {
      const sug = didYouMean(name, Object.keys(all).filter((k) => !all[k].hidden));
      errors.push(`Unknown option --${name}.${sug ? ` Did you mean --${sug}?` : ""}`);
      continue;
    }
    const key = camel(name);
    if (def.type === "boolean") {
      flags[key] = inline !== undefined ? !/^(false|0|no)$/i.test(inline) : !negated;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined || (value.startsWith("-") && !/^-?\d/.test(value))) {
        errors.push(`--${name} needs a value.`);
        if (value !== undefined) i--;
        continue;
      }
    }
    try {
      if (def.type === "number") {
        const n = Number(value);
        if (!isFinite(n)) throw new Error(`--${name} must be a number (got "${value}").`);
        flags[key] = n;
      } else if (def.type === "time") flags[key] = parseTime(value, `--${name}`);
      else {
        if (def.choices && !def.choices.includes(value)) throw new Error(`--${name} must be one of: ${def.choices.join(", ")} (got "${value}").`);
        flags[key] = value;
      }
    } catch (e) {
      errors.push(e.message || String(e.hint || e));
    }
  }
  return { flags, positional, errors };
}

export function formatFlagHelp(spec, indent = "    ") {
  const rows = Object.entries(spec)
    .filter(([, d]) => !d.hidden)
    .map(([name, d]) => {
      const left = (d.alias ? `-${d.alias}, ` : "    ") + `--${name}` + (d.type && d.type !== "boolean" ? ` <${d.type === "time" ? "time" : d.choices ? d.choices.join("|") : d.type}>` : "");
      return [left, d.desc || ""];
    });
  const w = Math.max(...rows.map((r) => r[0].length));
  return rows.map(([l, d]) => indent + l.padEnd(w + 2) + d);
}
