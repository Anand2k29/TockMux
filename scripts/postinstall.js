#!/usr/bin/env node
// Friendly hint after `npm install`. This script must NEVER fail the install.
try {
  if (process.env.CI || process.env.TOCKMUX_QUIET || process.env.npm_config_loglevel === "silent") process.exit(0);
  const isGlobal = process.env.npm_config_global === "true";
  const cmd = isGlobal ? "tockmux" : "npx tockmux";
  const lines = [
    "",
    "  TockMux installed.",
    `  Next:  ${cmd} setup     (one-time: downloads the Chromium browser)`,
    `         ${cmd} demo      (renders a sample video to prove everything works)`,
    ""
  ];
  process.stderr.write(lines.join("\n") + "\n");
} catch {
  /* ignore */
}
process.exit(0);
