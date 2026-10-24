import fs from "node:fs";

let cached;
export function getVersion() {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    cached = pkg.version;
  } catch {
    cached = "0.0.0";
  }
  return cached;
}

export const DISCORD = "Spidey_Moon";
export const GITHUB = "Anand2k29";
