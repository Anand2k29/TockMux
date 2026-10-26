import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const PLUGIN = path.join(ROOT, "claude-plugin");
const COMMANDS = ["render", "watch", "check", "make", "setup"];

describe("Claude Code plugin", () => {
  test("the plugin manifest is valid and matches the package version", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.equal(manifest.name, "tockmux");
    assert.equal(manifest.version, pkg.version);
    assert.ok(manifest.description && manifest.license === "MIT");
  });

  test("the marketplace file points at the plugin folder", () => {
    const market = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
    const entry = market.plugins.find((p) => p.name === "tockmux");
    assert.ok(entry, "tockmux plugin listed");
    assert.ok(fs.existsSync(path.join(ROOT, entry.source, ".claude-plugin", "plugin.json")), "source has a manifest");
  });

  test("every command exists, has a description, and runs TockMux through npx", () => {
    for (const name of COMMANDS) {
      const file = path.join(PLUGIN, "commands", `${name}.md`);
      assert.ok(fs.existsSync(file), `${name}.md exists`);
      const text = fs.readFileSync(file, "utf8");
      const front = text.match(/^---\n([\s\S]*?)\n---\n/);
      assert.ok(front, `${name}.md has front matter`);
      assert.match(front[1], /^description: .+/m, `${name} has a description`);
      assert.match(text, /npx -y tockmux/, `${name} runs tockmux through npx`);
    }
  });

  test("the plugin is not shipped in the npm package", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.ok(!pkg.files.some((f) => f.startsWith("claude-plugin")), "claude-plugin not in files");
  });
});
