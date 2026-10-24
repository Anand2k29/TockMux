import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { parseArgs } from "../src/cli/args.js";
import { tokenize, parseTmx, assertValidTmx, didYouMean } from "../src/tmx/parser.js";
import { compileTmxToHtml } from "../src/tmx/compiler.js";
import { PRESETS, getPreset } from "../src/core/presets.js";
import { resolveSettings, parseTime } from "../src/core/settings.js";
import { inspectHtml, readMetaContract } from "../src/core/html-inspect.js";
import { planSegments, detectKind } from "../src/core/renderer.js";
import { buildMuxArgs, buildGifArgs } from "../src/core/ffmpeg.js";
import { startStaticServer } from "../src/core/static-server.js";
import { splitText } from "../src/voice/pool.js";
import { VoiceStore, maskKey, remaining } from "../src/voice/store.js";
import { createUI, stripAnsi, detectCapabilities } from "../src/cli/ui.js";
import { expandInputs } from "../src/cli/commands/render.js";
import { safeRelative } from "../src/studio/server.js";
import { buildClockScript } from "../src/core/clock-script.js";
import { tmpDir, write } from "./helpers.js";

describe("args parser", () => {
  const spec = { output: { type: "string", alias: "o" }, fps: { type: "number" }, duration: { type: "time" }, fast: { type: "boolean" }, "auto-fit": { type: "boolean" }, format: { type: "string", choices: ["mp4", "gif"] } };
  test("flags, aliases, inline values, camelCase", () => {
    const r = parseArgs(["a.html", "-o", "x.mp4", "--fps=60", "--auto-fit", "--duration", "1:30"], spec);
    assert.deepEqual(r.positional, ["a.html"]);
    assert.equal(r.flags.output, "x.mp4");
    assert.equal(r.flags.fps, 60);
    assert.equal(r.flags.autoFit, true);
    assert.equal(r.flags.duration, 90);
    assert.deepEqual(r.errors, []);
  });
  test("--no-flag negates booleans", () => {
    assert.equal(parseArgs(["--no-fast"], spec).flags.fast, false);
  });
  test("unknown flag suggests the closest one", () => {
    const r = parseArgs(["--fsp", "30"], spec);
    assert.match(r.errors[0], /Unknown option --fsp.*--fps/);
  });
  test("rejects bad numbers, choices and missing values", () => {
    assert.match(parseArgs(["--fps", "fast"], spec).errors[0], /must be a number/);
    assert.match(parseArgs(["--format", "avi"], spec).errors[0], /must be one of: mp4, gif/);
    assert.match(parseArgs(["--output"], spec).errors[0], /needs a value/);
  });
  test("-- ends option parsing", () => {
    assert.deepEqual(parseArgs(["--", "--weird.html"], spec).positional, ["--weird.html"]);
  });
  test("negative numbers are values, not flags", () => {
    assert.equal(parseArgs(["--fps", "-5"], spec).flags.fps, -5);
  });
});

describe("time parsing", () => {
  test("accepts seconds, ms and m:ss", () => {
    assert.equal(parseTime("12"), 12);
    assert.equal(parseTime("12s"), 12);
    assert.equal(parseTime("1500ms"), 1.5);
    assert.equal(parseTime("0:04"), 4);
    assert.equal(parseTime("2:05.5"), 125.5);
    assert.equal(parseTime(undefined), undefined);
  });
  test("rejects nonsense with a helpful hint", () => {
    assert.throws(() => parseTime("soon"), (e) => e.code === "BAD_TIME" && /seconds/.test(e.hint));
  });
});

describe("tmx tokenizer and parser", () => {
  test("tokenizes quoted strings with escapes and attributes", () => {
    const t = tokenize('title "Say \\"hi\\"" highlight="hi" color=#ff0000');
    assert.equal(t[1].value, 'Say "hi"');
    assert.equal(t[2].key, "highlight");
    assert.equal(t[3].value, "#ff0000");
  });
  test("unclosed quote throws", () => assert.throws(() => tokenize('title "oops'), /Unclosed quote/));

  const GOOD = 'film "T" duration=6s preset=tiktok theme=sunset\nwatermark "w"\nmusic "m.mp3" volume=30%\naction click="#go" at=1.5s\nscene 0s..3s transition=slide {\n title "Hi" highlight="Hi"\n list "a" "b"\n counter from=0 to=50 suffix="%"\n bar percent=80\n quote "q" by="me"\n caption "c"\n}\nscene 3s..6s { title "Two" }\n';
  test("parses a full film", () => {
    const a = parseTmx(GOOD);
    assert.deepEqual(a.diagnostics, []);
    assert.equal(a.duration, 6);
    assert.equal(a.width, 1080);
    assert.equal(a.height, 1920);
    assert.equal(a.theme, "sunset");
    assert.equal(a.musicVolume, 0.3);
    assert.equal(a.actions[0].at, 1.5);
    assert.equal(a.scenes[0].transition, "slide");
    assert.equal(a.scenes[0].elements.length, 6);
    assert.deepEqual(a.scenes[0].elements[1].items, ["a", "b"]);
  });
  test("handles Windows line endings and a BOM", () => {
    const a = parseTmx("\uFEFF" + GOOD.replace(/\n/g, "\r\n"));
    assert.deepEqual(a.diagnostics, []);
    assert.equal(a.scenes.length, 2);
  });
  test("single-line scenes with ; separators", () => {
    const a = parseTmx('scene 0s..2s { title "A"; caption "B" }');
    assert.equal(a.scenes[0].elements.length, 2);
    assert.deepEqual(a.diagnostics, []);
  });
  test("duration is inferred from the last scene when not declared", () => {
    assert.equal(parseTmx('scene 0s..2s { title "A" }\nscene 2s..7.5s { title "B" }').duration, 7.5);
  });
  test("reports every problem with line numbers and suggestions", () => {
    const a = parseTmx('film "x" preset=tiktk\nscene 0s..2s {\n titel "A"\n bar percent=900\n}\nscene soon {\n');
    const errs = a.diagnostics.filter((d) => d.level === "error");
    assert.ok(errs.some((e) => e.line === 1 && /Did you mean "tiktok"/.test(e.message)));
    assert.ok(errs.some((e) => e.line === 3 && /Did you mean "title"/.test(e.message)));
    assert.ok(errs.some((e) => e.line === 4 && /between 0 and 100/.test(e.message)));
    assert.ok(errs.some((e) => e.line === 6));
    assert.throws(() => assertValidTmx(a, "x.tmx"), (e) => e.code === "TMX_INVALID" && /x\.tmx:3/.test(e.hint));
  });
  test("warns when the last scene overruns the declared duration", () => {
    const a = parseTmx('film "x" duration=2s\nscene 0s..5s { title "A" }');
    assert.ok(a.diagnostics.some((d) => d.level === "warn" && /cut off/.test(d.message)));
  });
  test("empty file is an error", () => assert.ok(parseTmx("").diagnostics.some((d) => /No scenes/.test(d.message))));
  test("didYouMean", () => {
    assert.equal(didYouMean("subtilte", ["title", "subtitle"]), "subtitle");
    assert.equal(didYouMean("zzzzzz", ["title"]), null);
  });
});

describe("tmx compiler", () => {
  test("produces a page with the contract meta tags", () => {
    const html = compileTmxToHtml(parseTmx('film "My <Film>" duration=4s\nscene 0s..4s { title "Hi" }'));
    assert.match(html, /html2mp4:duration" content="4"/);
    assert.match(html, /html2mp4:width" content="1920"/);
    assert.match(html, /<title>My &lt;Film&gt;<\/title>/);
    assert.match(html, /window\.__seek/);
  });
  test("user text cannot break out of the script block", () => {
    const html = compileTmxToHtml(parseTmx('scene 0s..2s { title "</script><img src=x onerror=alert(1)>" }'));
    assert.equal((html.match(/<\/script>/g) || []).length, 1);
    assert.ok(!html.includes('title":"</script>'));
  });
});

describe("presets and settings", () => {
  test("presets are well formed", () => {
    for (const [name, p] of Object.entries(PRESETS)) {
      assert.ok(p.width > 0 && p.height > 0 && p.fps > 0, name);
      assert.equal(p.width % 2, 0, name + " width must be even for H.264");
      assert.equal(p.height % 2, 0, name + " height must be even for H.264");
    }
    assert.equal(getPreset("TikTok").height, 1920);
    assert.equal(getPreset("nope"), null);
  });
  const info = (m) => inspectHtml(`<meta name="html2mp4:width" content="${m.w}"><meta name="html2mp4:height" content="${m.h}"><meta name="html2mp4:duration" content="${m.d}">`);
  test("precedence: flag > preset > file > default", () => {
    const base = { kind: "html", htmlInfo: info({ w: 800, h: 600, d: 5 }) };
    let s = resolveSettings({ ...base });
    assert.deepEqual([s.width, s.height, s.duration, s.sources.width], [800, 600, 5, "meta"]);
    s = resolveSettings({ ...base, flags: { preset: "tiktok" } });
    assert.deepEqual([s.width, s.height, s.sources.width, s.duration], [1080, 1920, "preset", 5]);
    s = resolveSettings({ ...base, flags: { preset: "tiktok", width: 500, duration: 9 } });
    assert.deepEqual([s.width, s.height, s.duration, s.sources.duration], [500, 1920, 9, "flag"]);
    s = resolveSettings({ kind: "html", htmlInfo: inspectHtml("<p>x</p>") });
    assert.deepEqual([s.width, s.height, s.fps, s.duration, s.sources.duration], [1920, 1080, 30, 10, "default"]);
    s = resolveSettings({ kind: "html", htmlInfo: inspectHtml("<p>x</p>"), detectedDurationSec: 3.5 });
    assert.deepEqual([s.duration, s.sources.duration], [3.5, "detected"]);
  });
  test("rejects impossible values with a hint", () => {
    assert.throws(() => resolveSettings({ kind: "html", htmlInfo: inspectHtml(""), flags: { fps: 500 } }), (e) => e.code === "BAD_SETTINGS" && /fps/.test(e.hint));
    assert.throws(() => resolveSettings({ kind: "html", htmlInfo: inspectHtml(""), flags: { preset: "tiktk" } }), (e) => e.code === "BAD_PRESET");
  });
  test("start selector becomes a click action at 0s", () => {
    const s = resolveSettings({ kind: "html", htmlInfo: inspectHtml('<meta name="html2mp4:start" content="#go">') });
    assert.deepEqual(s.actions, [{ type: "click", selector: "#go", at: 0 }]);
  });
  test("detectKind", () => {
    assert.equal(detectKind("a.HTML"), "html");
    assert.equal(detectKind("a.tmx"), "tmx");
    assert.throws(() => detectKind("a.pdf"), (e) => e.code === "BAD_INPUT");
  });
});

describe("html inspection", () => {
  test("reads meta in any attribute order, both namespaces", () => {
    const m = readMetaContract(`<meta content="12" name="html2mp4:duration"><meta name='tockmux:fps' content='60'><META NAME="html2mp4:start" CONTENT="#go"/>`);
    assert.deepEqual(m, { duration: "12", fps: "60", start: "#go" });
  });
  test("detects features", () => {
    const i = inspectHtml('<title> T </title><video src=a></video><iframe></iframe><script src="https://cdn.x.com/gsap.min.js"></script><canvas></canvas><button id="Play">p</button>alert(1)');
    assert.equal(i.title, "T");
    assert.ok(i.hasVideoTag && i.hasIframe && i.hasBlockingDialog);
    assert.ok(i.libs.includes("GSAP") && i.libs.includes("canvas"));
    assert.deepEqual(i.remoteHosts, ["cdn.x.com"]);
    assert.equal(i.startGuess, "#play");
    assert.equal(i.start, undefined, "only an explicit <meta> counts as declared");
  });
  test("static page is not flagged as animated", () => assert.equal(inspectHtml("<h1>Hi</h1>").looksAnimated, false));
});

describe("renderer planning", () => {
  test("segments cover the range exactly once", () => {
    for (const [from, to, w] of [[0, 100, 3], [10, 95, 4], [0, 7, 4], [0, 1000, 8]]) {
      const segs = planSegments(from, to, w);
      assert.equal(segs[0].start, from);
      assert.equal(segs.at(-1).end, to);
      for (let i = 1; i < segs.length; i++) assert.equal(segs[i].start, segs[i - 1].end);
      assert.ok(segs.every((s) => s.end > s.start));
    }
  });
  test("tiny jobs are not split across many workers", () => assert.equal(planSegments(0, 40, 8).length, 2));
});

describe("ffmpeg argument builders", () => {
  test("no audio means a plain copy", () => assert.ok(buildMuxArgs({ video: "v.mp4", out: "o.mp4", duration: 5 }).includes("copy")));
  test("voice only pads to the video length", () => {
    const a = buildMuxArgs({ video: "v.mp4", out: "o.mp4", duration: 5, voice: "v.wav", voiceOffset: 0.5 });
    const f = a[a.indexOf("-filter_complex") + 1];
    assert.match(f, /adelay=500:all=1,apad/);
    assert.equal(a[a.indexOf("-t") + 1], "5.000");
  });
  test("music loops and fades out; ducking uses a sidechain", () => {
    const a = buildMuxArgs({ video: "v.mp4", out: "o.mp4", duration: 10, voice: "v.wav", music: "m.mp3", duck: true, musicVolume: 0.2 });
    assert.ok(a.includes("-stream_loop"));
    const f = a[a.indexOf("-filter_complex") + 1];
    assert.match(f, /sidechaincompress/);
    assert.match(f, /volume=0.2,afade=t=out:st=8\.800/);
  });
  test("gif uses a palette", () => assert.match(buildGifArgs({ video: "a", out: "b.gif" }).join(" "), /palettegen/));
});

describe("voice store", () => {
  test("masks keys and stores them privately", () => {
    assert.equal(maskKey("sk_1234567890abcdef"), "sk_…cdef");
    assert.equal(maskKey("abc"), "••••");
    const dir = tmpDir();
    const store = new VoiceStore(path.join(dir, "cfg", "voice.json"));
    store.add({ name: "a", apiKey: "KEY1", characterLimit: 100, characterCount: 40 });
    store.add({ name: "a", apiKey: "KEY1b" }); // update in place
    assert.equal(store.all().length, 1);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(store.file)).mode & 0o777, 0o700);
    }
    assert.equal(new VoiceStore(store.file).all()[0].apiKey, "KEY1b");
    assert.equal(store.remove("a"), true);
    assert.equal(store.remove("a"), false);
  });
  test("environment keys are picked up", () => {
    const old = { ...process.env };
    process.env.ELEVENLABS_API_KEYS = "k1, k2";
    process.env.ELEVENLABS_API_KEY = "k3";
    try {
      assert.deepEqual(new VoiceStore(path.join(tmpDir(), "v.json")).all().map((a) => a.apiKey), ["k1", "k2", "k3"]);
    } finally {
      process.env = old;
    }
  });
  test("remaining() treats unknown limits as available", () => {
    assert.equal(remaining({ status: "ok" }), Infinity);
    assert.equal(remaining({ status: "ok", characterLimit: 10, characterCount: 4 }), 6);
    assert.equal(remaining({ status: "exhausted", characterLimit: 10, characterCount: 0 }), 0);
  });
  test("splitText respects sentence boundaries and the size limit", () => {
    assert.deepEqual(splitText("Hello world."), ["Hello world."]);
    assert.deepEqual(splitText("   "), []);
    const text = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i}.`).join(" ");
    const parts = splitText(text, 200);
    assert.ok(parts.length > 1 && parts.every((p) => p.length <= 200));
    assert.equal(parts.join(" "), text);
    const long = splitText("word ".repeat(100).trim(), 50);
    assert.ok(long.every((p) => p.length <= 50));
  });
});

describe("static server", () => {
  test("serves files, blocks traversal, supports ranges and virtual files", async () => {
    const dir = tmpDir();
    write(dir, "a.txt", "0123456789");
    write(path.dirname(dir), "secret-" + path.basename(dir) + ".txt", "nope");
    const srv = await startStaticServer(dir, { virtualFiles: { "/v.html": "<b>virtual</b>" } });
    try {
      const get = (p, headers = {}) => new Promise((res) => http.get(srv.origin + p, { headers }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res({ status: r.statusCode, body: d, headers: r.headers })); }));
      assert.equal((await get("/a.txt")).body, "0123456789");
      assert.equal((await get("/v.html")).body, "<b>virtual</b>");
      assert.equal((await get("/nope")).status, 404);
      for (const evil of ["/..%2fsecret-" + path.basename(dir) + ".txt", "/%2e%2e/secret-" + path.basename(dir) + ".txt", "/../../etc/passwd", "/a.txt/../../etc/passwd"]) {
        const r = await get(evil);
        assert.ok([403, 404].includes(r.status), `${evil} -> ${r.status}`);
        assert.ok(!r.body.includes("nope") && !r.body.includes("root:"), `${evil} leaked a file`);
      }
      const r = await get("/a.txt", { Range: "bytes=2-4" });
      assert.equal(r.status, 206);
      assert.equal(r.body, "234");
      assert.equal(r.headers["content-range"], "bytes 2-4/10");
    } finally {
      await srv.close();
    }
  });
});

describe("CLI ui", () => {
  test("no colour codes when NO_COLOR is set or output is not a TTY", () => {
    const ui = createUI({ env: { NO_COLOR: "1" }, stream: { isTTY: true, write() {}, columns: 80 } });
    assert.equal(ui.c.violet("x"), "x");
    assert.equal(ui.gradient("abc"), "abc");
    const piped = detectCapabilities({}, { isTTY: false }, "linux");
    assert.equal(piped.color, false);
  });
  test("colour works when forced and stripAnsi removes it", () => {
    const ui = createUI({ env: { FORCE_COLOR: "1", COLORTERM: "truecolor" }, stream: { isTTY: false, write() {}, columns: 80 } });
    const s = ui.gradient("hello");
    assert.ok(s.includes("\x1b[38;2;"));
    assert.equal(stripAnsi(s), "hello");
  });
  test("legacy Windows consoles fall back to ASCII", () => {
    assert.equal(detectCapabilities({}, { isTTY: true }, "win32").unicode, false);
    assert.equal(detectCapabilities({ WT_SESSION: "1" }, { isTTY: true }, "win32").unicode, true);
  });
  test("progress bar prints coarse lines when not a TTY", () => {
    const lines = [];
    const ui = createUI({ env: {}, stream: { isTTY: false, write: (s) => lines.push(s), columns: 80 } });
    const p = ui.progress("Rendering");
    for (let i = 1; i <= 100; i++) p.update({ done: i, total: 100, etaSec: 1, renderFps: 10, workers: 1 });
    p.done();
    assert.ok(lines.length >= 4 && lines.length <= 6, `got ${lines.length} lines`);
    assert.match(lines.at(-1), /100%/);
  });
  test("json/quiet mode silences chatter", () => {
    const lines = [];
    const ui = createUI({ json: true, env: {}, stream: { isTTY: false, write: (s) => lines.push(s), columns: 80 } });
    ui.banner();
    ui.success("x");
    ui.box(["a"]);
    assert.equal(lines.length, 0);
  });
  test("box and checklist align", () => {
    const lines = [];
    const ui = createUI({ env: {}, stream: { isTTY: false, write: (s) => lines.push(s), columns: 80 } });
    ui.box(["short", "a much longer line here"]);
    const widths = new Set(lines.join("").split("\n").filter(Boolean).map((l) => [...l].length));
    assert.equal(widths.size, 1, "all box rows should have equal width");
  });
});

describe("batch input expansion", () => {
  test("folders, wildcards and recursion", () => {
    const d = tmpDir();
    write(d, "a.html", "");
    write(d, "b.tmx", "");
    write(d, "c.txt", "");
    write(d, "sub/d.html", "");
    write(d, "node_modules/x/e.html", "");
    const names = (l) => l.map((f) => path.relative(d, f)).sort();
    assert.deepEqual(names(expandInputs([d])), ["a.html", "b.tmx"]);
    assert.deepEqual(names(expandInputs([path.join(d, "*.html")])), ["a.html"]);
    assert.deepEqual(names(expandInputs([path.join(d, "**", "*.html")])), ["a.html", path.join("sub", "d.html")]);
    assert.throws(() => expandInputs([path.join(d, "missing.html")]), (e) => e.code === "FILE_NOT_FOUND");
  });
});

describe("studio upload safety", () => {
  test("safeRelative rejects traversal and absolute names", () => {
    assert.equal(safeRelative("a/b.html"), "a/b.html");
    assert.equal(safeRelative("./a.html"), "a.html");
    for (const bad of ["../x", "/etc/passwd", "a/../../x", "C:\\win", "..\\x", "", "a\0b"]) assert.equal(safeRelative(bad), null, bad);
  });
});

describe("virtual clock script", () => {
  test("is self-contained and parseable", () => {
    const src = buildClockScript({ seed: 7 });
    assert.doesNotThrow(() => new Function(src));
    assert.match(src, /"seed":7/);
  });
});
