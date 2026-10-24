import fs from "node:fs";

/**
 * Create a folder and its parents, unless it already exists.
 * Node throws EPERM when asked to mkdir a drive root such as D:\, even though it exists, so skip existing folders.
 */
export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
