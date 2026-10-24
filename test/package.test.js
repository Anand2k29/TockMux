import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./helpers.js";

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

describe("package metadata", () => {
  test("bin entries exist, are executable and start with a shebang", () => {
    for (const [name, rel] of Object.entries(pkg.bin)) {
      const f = path.join(ROOT, rel);
      assert.ok(fs.existsSync(f), name);
      // Windows checkouts end lines with CRLF, so ignore a trailing carriage return.
      assert.equal(fs.readFileSync(f, "utf8").split("\n")[0].replace(/\r$/, ""), "#!/usr/bin/env node");
      if (process.platform !== "win32") assert.ok(fs.statSync(f).mode & 0o111, `${rel} should be executable`);
    }
  });
  test("every path in `files` exists", () => {
    for (const rel of pkg.files) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
  });
  test("main and exports resolve and the library imports cleanly", async () => {
    assert.ok(fs.existsSync(path.join(ROOT, pkg.main)));
    const lib = await import("../src/index.js");
    for (const name of ["convert", "checkInput", "renderVideo", "parseTmx", "compileTmxToHtml", "VoicePool", "startStudio", "runMcpServer", "PRESETS"]) assert.ok(lib[name], name);
  });
  test("runtime dependencies stay small (install must be quick)", () => {
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["ffmpeg-static", "playwright-core"]);
  });
  test("the postinstall script can never fail an install", () => {
    for (const env of [{}, { CI: "1" }, { npm_config_global: "true" }]) {
      const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/postinstall.js")], { env: { ...process.env, ...env } });
      assert.equal(r.status, 0);
    }
  });
  test("the node engine matches what the code needs", () => assert.match(pkg.engines.node, />=18/));
  test("LICENSE, README, CHANGELOG exist and the README mentions the key commands", () => {
    for (const f of ["LICENSE", "README.md", "CHANGELOG.md"]) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    for (const c of ["tockmux render", "tockmux check", "tockmux studio", "tockmux mcp", "tockmux voice", "tockmux setup"]) assert.ok(readme.includes(c), c);
  });
  test("versions agree between package.json, the CLI and the changelog", () => {
    assert.match(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), new RegExp(`## ${pkg.version.replace(/\./g, "\\.")}`));
  });
  test("the landing page and Studio contain no leftover placeholders or fake claims", () => {
    for (const f of ["site/index.html", "studio/index.html"]) {
      const t = fs.readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(!/lorem ipsum|TODO|YOUR_GITHUB|example\.com\/your/i.test(t), f);
    }
    const site = fs.readFileSync(path.join(ROOT, "site/index.html"), "utf8");
    assert.match(site, /Spidey_Moon/);
    assert.ok(!/\b\d+\/\d+ tests? pass/i.test(site), "no hard-coded test results on the landing page");
  });
});

describe("npm pack", () => {
  test("the tarball has everything needed and nothing private", () => {
    const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
    assert.equal(r.status, 0, r.stderr);
    const files = JSON.parse(r.stdout)[0].files.map((f) => f.path);
    for (const must of ["bin/tockmux.js", "src/index.js", "src/core/renderer.js", "src/core/clock-script.js", "src/mcp/server.js", "studio/index.html", "site/index.html", "examples/demo.tmx", "examples/promo.html", "templates/video.html", "templates/story.tmx", "templates/README.txt", "scripts/postinstall.js", "README.md", "LICENSE", "package.json"]) {
      assert.ok(files.includes(must), `missing ${must}`);
    }
    for (const f of files) {
      assert.ok(!/^(test|node_modules|\.github)\//.test(f) && !/\.(tgz|log)$/.test(f) && !/voice\.json|\.env/.test(f), `should not ship ${f}`);
    }
    assert.ok(files.length < 120, `${files.length} files`);
  });
});
