import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runCli, tmpDir, write, squareHtml, toneWav, browserAvailable, mockElevenLabs, ROOT } from "./helpers.js";
import { probeMedia, resolveFfmpeg } from "../src/core/ffmpeg.js";
import { spawnSync } from "node:child_process";

let HAS = false;
before(async () => {
  HAS = await browserAvailable();
});
const rt = (name, fn) => test(`[render] ${name}`, { timeout: 180000 }, async (t) => (HAS ? fn(t) : t.skip("no browser")));
const home = () => ({ TOCKMUX_HOME: tmpDir("tmx-home-") });
const SMALL = ["--fps", "10", "--workers", "1"];

describe("cli basics", () => {
  test("--version prints just the version", async () => {
    const r = await runCli(["--version"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.equal(r.stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"))).version);
  });
  test("no arguments shows a friendly start screen", async () => {
    const r = await runCli([], { env: { ...home(), TOCKMUX_BROWSER: "/nonexistent" } });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /tockmux demo/);
    assert.match(r.stdout, /tockmux studio/);
  });
  test("help lists every command, in groups", async () => {
    const r = await runCli(["help"]);
    for (const c of ["render", "batch", "frame", "check", "sync", "voice", "studio", "mcp", "demo", "setup", "doctor", "init", "presets", "probe"]) assert.match(r.stdout, new RegExp(`\\b${c}\\b`), c);
  });
  test("help <command> documents its options", async () => {
    const r = await runCli(["help", "render"]);
    assert.match(r.stdout, /--auto-fit/);
    assert.match(r.stdout, /--preset <string>/);
    assert.match(r.stdout, /Examples/);
    assert.equal((await runCli(["render", "--help"])).stdout, r.stdout);
  });
  test("an unknown command exits 2 and suggests the right one", async () => {
    const r = await runCli(["rendr", "x.html"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr + r.stdout, /Did you mean "tockmux render"/);
  });
  test("an unknown option exits 2 with a suggestion", async () => {
    const r = await runCli(["render", "x.html", "--presett", "tiktok"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr + r.stdout, /Did you mean --preset/);
  });
  test("a missing file is a plain-English error, not a stack trace", async () => {
    const r = await runCli(["render", "nope.html"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr + r.stdout, /File not found: nope\.html/);
    assert.ok(!/at .*\.js:\d+/.test(r.stderr + r.stdout), "no stack trace");
  });
  test("render with no file explains what to do", async () => {
    const r = await runCli(["render"]);
    assert.match(r.stderr + r.stdout, /Tell me which file to render/);
  });
  test("an unsupported file type is explained", async () => {
    const d = tmpDir();
    const r = await runCli(["render", write(d, "a.pdf", "x")]);
    assert.match(r.stderr + r.stdout, /Unsupported file type/);
  });
  test("--no-color and piped output contain no escape codes", async () => {
    const r = await runCli(["presets"]);
    assert.ok(!r.stdout.includes("\x1b["));
  });
  test("presets --json is valid JSON with every preset", async () => {
    const j = JSON.parse((await runCli(["presets", "--json"])).stdout);
    assert.ok(j.presets.tiktok && j.presets.youtube && j.themes.midnight);
  });
  test("doctor --json reports each requirement", async () => {
    const r = await runCli(["doctor", "--json"], { env: home() });
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.rows.map((x) => x.label), ["Node.js", "FFmpeg", "Browser", "Config folder", "Voice accounts", "CPU / memory"]);
    assert.equal(j.rows[0].status, "pass");
    assert.equal(j.rows[1].status, "pass", "bundled ffmpeg works");
  });
  test("doctor tells you how to fix a missing browser", async () => {
    const r = await runCli(["doctor"], { env: { ...home(), TOCKMUX_BROWSER: "" , PATH: "/nonexistent" } });
    // Either no browser is found (hint shown) or one exists on this machine: both are valid, but the hint must be right when missing.
    if (/none found/.test(r.stdout)) assert.match(r.stdout, /tockmux setup/);
  });
  test("a bad --browser path is reported clearly", async () => {
    const d = tmpDir();
    const r = await runCli(["render", write(d, "p.html", squareHtml()), "--browser", "/nonexistent/chrome"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr + r.stdout, /Browser not found at \/nonexistent\/chrome/);
  });
  test("errors are JSON when --json is used", async () => {
    const r = await runCli(["render", "nope.html", "--json"]);
    const j = JSON.parse(r.stdout);
    assert.equal(j.error.code, "FILE_NOT_FOUND");
  });
  test("mcp --print-config gives paste-ready JSON", async () => {
    const r = await runCli(["mcp", "--print-config"]);
    assert.match(r.stdout, /"command": "npx"/);
    assert.match(r.stdout, /claude mcp add tockmux/);
  });
  test("about shows the Discord contact", async () => {
    assert.match((await runCli(["about"])).stdout, /Spidey_Moon/);
  });
});

describe("init", () => {
  test("creates a starter project and never overwrites your files", async () => {
    const d = path.join(tmpDir(), "proj");
    const r = await runCli(["init", d]);
    assert.equal(r.code, 0);
    for (const f of ["video.html", "story.tmx", "README.txt"]) assert.ok(fs.existsSync(path.join(d, f)), f);
    fs.writeFileSync(path.join(d, "video.html"), "MINE");
    const again = await runCli(["init", d]);
    assert.match(again.stdout, /already exists/);
    assert.equal(fs.readFileSync(path.join(d, "video.html"), "utf8"), "MINE");
  });
  test("--template tmx only creates the script", async () => {
    const d = path.join(tmpDir(), "p2");
    await runCli(["init", d, "--template", "tmx"]);
    assert.ok(fs.existsSync(path.join(d, "story.tmx")));
    assert.ok(!fs.existsSync(path.join(d, "video.html")));
  });
});

describe("check (no browser needed with --static)", () => {
  test("--static check of a good file passes; JSON mode works", async () => {
    const d = tmpDir();
    const r = await runCli(["check", write(d, "p.html", squareHtml()), "--static", "--json"]);
    const j = JSON.parse(r.stdout);
    assert.equal(r.code, 0);
    assert.equal(j.settings.duration, 2);
    assert.ok(j.rows.some((x) => x.id === "duration" && x.status === "pass"));
  });
  test("check of a broken .tmx exits 1 and names the line", async () => {
    const d = tmpDir();
    const r = await runCli(["check", write(d, "b.tmx", `scene 0s..2s {\n titel "x"\n}\n`), "--static"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Line 2/);
    assert.match(r.stdout, /Did you mean "title"/);
  });
});

describe("rendering commands", () => {
  rt("render: writes the file next to the input, reports it, exits 0", async () => {
    const d = tmpDir();
    const f = write(d, "promo.html", squareHtml());
    const r = await runCli(["render", f, ...SMALL], { env: home() });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(d, "promo.mp4")));
    assert.match(r.stdout, /Video ready/);
    assert.match(r.stdout, /320x180 at 10 fps/);
  });
  rt("render --json returns a machine-readable result", async () => {
    const d = tmpDir();
    const r = await runCli(["render", write(d, "p.html", squareHtml()), "-o", path.join(d, "x.mp4"), "--json", ...SMALL], { env: home() });
    const j = JSON.parse(r.stdout);
    assert.deepEqual([j.frames, j.width, j.height, j.animated], [20, 320, 180, true]);
    assert.ok(j.bytes > 1000);
  });
  rt("`tockmux file.html` is a shortcut for render", async () => {
    const d = tmpDir();
    const f = write(d, "short.html", squareHtml());
    const r = await runCli([f, ...SMALL], { env: home() });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(d, "short.mp4")));
  });
  rt("--format gif and --preset work from the CLI", async () => {
    const d = tmpDir();
    const f = write(d, "p.html", squareHtml());
    const r = await runCli(["render", f, "--format", "gif", "--preset", "square", "--gif-width", "100", "--duration", "1", ...SMALL], { env: home() });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const g = path.join(d, "p.gif");
    assert.equal(fs.readFileSync(g).subarray(0, 3).toString(), "GIF");
    assert.equal((await probeMedia(g)).video.width, 100);
  });
  rt("--start none and the guessed start are shown in the plan", async () => {
    const d = tmpDir();
    const f = write(d, "p.html", squareHtml().replace("<body", `<button id="go">go</button><body`));
    const r = await runCli(["render", f, ...SMALL], { env: home() });
    assert.match(r.stdout, /clicks #go at 0s.*guessed/);
  });
  rt("frame saves a PNG or JPEG poster", async () => {
    const d = tmpDir();
    const f = write(d, "p.html", squareHtml());
    const png = path.join(d, "a.png"), jpg = path.join(d, "b.jpg");
    assert.equal((await runCli(["frame", f, "--at", "1", "-o", png, "--fps", "10"], { env: home() })).code, 0);
    assert.equal((await runCli(["frame", f, "--at", "0:01", "-o", jpg, "--fps", "10"], { env: home() })).code, 0);
    assert.deepEqual([...fs.readFileSync(png).subarray(1, 4)], [0x50, 0x4e, 0x47]);
    assert.deepEqual([...fs.readFileSync(jpg).subarray(0, 2)], [0xff, 0xd8]);
  });
  rt("check (live) exits 0 for a good page and shows the checklist", async () => {
    const d = tmpDir();
    const r = await runCli(["check", write(d, "p.html", squareHtml())], { env: home() });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Page animates/);
    assert.match(r.stdout, /All good/);
  });
  rt("batch renders a folder, honours --out-dir, and reports failures without stopping", async () => {
    const d = tmpDir();
    write(d, "in/a.html", squareHtml());
    write(d, "in/b.tmx", `film "x" duration=1s size=160x90\nscene 0s..1s { title "B" }\n`);
    write(d, "in/c.tmx", `scene 0s..1s {\n titel "bad"\n}\n`);
    const out = path.join(d, "videos");
    const r = await runCli(["batch", path.join(d, "in"), "--out-dir", out, ...SMALL], { env: home() });
    assert.equal(r.code, 1, "one file failed so exit code is 1");
    assert.deepEqual(fs.readdirSync(out).sort(), ["a.mp4", "b.mp4"]);
    assert.match(r.stdout, /2 of 3 finished/);
  });
  rt("sync adds a voice-over to an existing MP4, and --stretch fits the video to it", async () => {
    const d = tmpDir();
    const f = write(d, "p.html", squareHtml());
    const mp4 = path.join(d, "silent.mp4");
    await runCli(["render", f, "-o", mp4, ...SMALL], { env: home() });
    const voice = toneWav(d, "v.wav", 3);
    const plain = path.join(d, "plain.mp4"), stretched = path.join(d, "stretched.mp4");
    assert.equal((await runCli(["sync", mp4, voice, "-o", plain])).code, 0);
    const p = await probeMedia(plain);
    assert.ok(p.audio && Math.abs(p.duration - 2) < 0.15, `kept video length, got ${p.duration}`);
    assert.equal((await runCli(["sync", mp4, voice, "-o", stretched, "--stretch"])).code, 0);
    const s = await probeMedia(stretched);
    assert.ok(s.audio && Math.abs(s.duration - 3) < 0.2, `stretched to voice length, got ${s.duration}`);
  });
  rt("probe prints details and counts frames", async () => {
    const d = tmpDir();
    const mp4 = path.join(d, "a.mp4");
    await runCli(["render", write(d, "p.html", squareHtml()), "-o", mp4, ...SMALL], { env: home() });
    const j = JSON.parse((await runCli(["probe", mp4, "--frames", "--json"])).stdout);
    assert.equal(j.frames, 20);
    assert.equal(j.video.codec, "h264");
    assert.match((await runCli(["probe", mp4])).stdout, /320x180/);
  });
  rt("demo renders the bundled film end to end", async () => {
    const d = tmpDir();
    const out = path.join(d, "demo.mp4");
    const r = await runCli(["demo", "-o", out], { env: home(), cwd: d });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Everything works/);
    const m = await probeMedia(out);
    assert.deepEqual([m.video.width, m.video.height, Math.round(m.duration)], [1280, 720, 6]);
  });
});

describe("voice commands", () => {
  test("add, status, remove (key verified against a mock server)", async () => {
    const mock = await mockElevenLabs({ GOODKEY123456: { limit: 10000, used: 250 } });
    const env = { ...home(), TOCKMUX_ELEVENLABS_URL: mock.url };
    try {
      const add = await runCli(["voice", "add", "--name", "main", "--key", "GOODKEY123456"], { env });
      assert.equal(add.code, 0, add.stderr);
      assert.match(add.stdout, /250 of 10,000 characters used/);
      assert.ok(!add.stdout.includes("GOODKEY123456"), "key must never be printed in full");
      const st = JSON.parse((await runCli(["voice", "status", "--json"], { env })).stdout);
      assert.deepEqual([st[0].name, st[0].remaining, st[0].limit], ["main", 9750, 10000]);
      assert.ok(!JSON.stringify(st).includes("GOODKEY123456"), "status --json must not leak the key");
      const file = path.join(env.TOCKMUX_HOME, "voice.json");
      if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      const rm = await runCli(["voice", "remove", "main"], { env });
      assert.match(rm.stdout, /Removed/);
      assert.equal((await runCli(["voice", "remove", "main"], { env })).code, 1);
    } finally {
      await mock.close();
    }
  });
  test("legacy el-add / el-status aliases still work", async () => {
    const env = { ...home(), TOCKMUX_ELEVENLABS_URL: "http://127.0.0.1:1" };
    assert.equal((await runCli(["el-add", "--name", "x", "--key", "KEYKEYKEY", "--no-verify"], { env })).code, 0);
    assert.match((await runCli(["el-status"], { env })).stdout, /x\s/);
  });
  test("speak writes an MP3 and fails over between accounts", async () => {
    const mock = await mockElevenLabs({ EMPTYKEY00001: { limit: 3, used: 0 }, FULLKEY000002: { limit: 5000, used: 0 } });
    const env = { ...home(), TOCKMUX_ELEVENLABS_URL: mock.url };
    const d = tmpDir();
    try {
      await runCli(["voice", "add", "--name", "empty", "--key", "EMPTYKEY00001", "--no-verify"], { env });
      await runCli(["voice", "add", "--name", "full", "--key", "FULLKEY000002", "--no-verify"], { env });
      const out = path.join(d, "n.mp3");
      const r = await runCli(["voice", "speak", "This is a test narration.", "-o", out], { env });
      assert.equal(r.code, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /switching|Trying the next account/);
      assert.ok((await probeMedia(out)).audio);
      assert.match(r.stdout, /full: 25 chars/);
    } finally {
      await mock.close();
    }
  });
  test("speak without an account explains how to add one", async () => {
    const r = await runCli(["voice", "speak", "hello"], { env: home() });
    assert.equal(r.code, 1);
    assert.match(r.stderr + r.stdout, /voice add/);
  });
  test("a .tmx with a narration script is spoken and auto-fitted", { skip: false }, async (t) => {
    if (!HAS) return t.skip("no browser");
    const mock = await mockElevenLabs({ KEYKEYKEY0001: { limit: 5000, used: 0 } });
    const env = { ...home(), TOCKMUX_ELEVENLABS_URL: mock.url };
    const d = tmpDir();
    try {
      await runCli(["voice", "add", "--name", "a", "--key", "KEYKEYKEY0001", "--no-verify"], { env });
      const tmx = `film "T" duration=2s size=160x90\ntts "Hello from the narrator."\nscene 0s..2s { title "Hi" }\n`;
      const out = path.join(d, "o.mp4");
      const r = await runCli(["render", write(d, "s.tmx", tmx), "-o", out, "--auto-fit", "--fps", "10", "--workers", "1", "--json"], { env });
      assert.equal(r.code, 0, r.stderr + r.stdout);
      const j = JSON.parse(r.stdout);
      assert.equal(j.hasAudio, true);
      assert.equal(j.narration.chars, 24);
      assert.ok(j.autoFit && j.autoFit.audioSeconds > 0.5);
    } finally {
      await mock.close();
    }
  });
});

describe("watch", () => {
  test("is listed in help and documents itself", async () => {
    const help = await runCli(["help"]);
    assert.match(help.stdout, /watch\s+Re-render the video every time you save/);
    const detail = await runCli(["watch", "--help"]);
    assert.equal(detail.code, 0);
    assert.match(detail.stdout, /tockmux watch <file\.html\|file\.tmx>/);
  });

  test("without a file it explains what to do", async () => {
    const r = await runCli(["watch"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout + r.stderr, /Tell me which file to watch/);
  });
});
