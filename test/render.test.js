import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { convert, checkInput, snapshot, planJob } from "../src/core/pipeline.js";
import { probeMedia, countFrames, samplePixel, resolveFfmpeg } from "../src/core/ffmpeg.js";
import { browserAvailable, squareHtml, write, tmpDir, squareLeftEdge, psnr, rawHash, toneWav, ROOT } from "./helpers.js";

let HAS = false;
before(async () => {
  HAS = await browserAvailable();
  if (!HAS) console.log("# No browser found: render tests are skipped. Run `tockmux setup` or set TOCKMUX_BROWSER.");
});
const rt = (name, fn) => test(`[render] ${name}`, { timeout: 180000 }, async (t) => {
  if (!HAS) return t.skip("no browser available");
  await fn(t);
});

// 10 fps and speed 100px/s: the square's left edge at frame k is exactly 10*k pixels.
const BASE = { fps: 10 };
const expectEdge = async (file, sec, tol = 2) => {
  const x = await squareLeftEdge(file, sec);
  assert.ok(Math.abs(x - sec * 100) <= tol, `at ${sec}s expected x≈${sec * 100}, got ${x}`);
};

describe("every kind of animation lands on the exact frame", () => {
  for (const mode of ["raf", "css", "timers", "date", "perf"]) {
    rt(`${mode}: exact frame count and exact position`, async () => {
      const dir = tmpDir();
      const f = write(dir, "p.html", squareHtml({ mode }));
      const out = path.join(dir, "o.mp4");
      const r = await convert({ input: f, flags: { ...BASE, output: out, workers: 1 } });
      assert.equal(r.frames, 20);
      assert.equal(await countFrames(out), 20, "decoded frame count");
      const m = await probeMedia(out);
      assert.deepEqual([m.video.width, m.video.height, m.video.codec], [320, 180, "h264"]);
      assert.ok(Math.abs(m.duration - 2) < 0.05, `duration ${m.duration}`);
      assert.equal(r.animated, true);
      assert.deepEqual(r.warnings, []);
      await expectEdge(out, 0.5);
      await expectEdge(out, 1.0);
      await expectEdge(out, 1.5);
    });
  }

  rt("a window.__seek(ms) page works with no timers at all", async () => {
    const dir = tmpDir();
    const html = `<!doctype html><meta name="html2mp4:duration" content="2"><meta name="html2mp4:width" content="320"><meta name="html2mp4:height" content="180"><body style="margin:0;background:#000"><div id="b" style="position:absolute;top:60px;width:40px;height:40px;background:#f00"></div><script>window.__seek=ms=>{document.getElementById('b').style.left=(ms/10)+'px'}</script>`;
    const out = path.join(dir, "o.mp4");
    await convert({ input: write(dir, "p.html", html), flags: { ...BASE, output: out, workers: 1 } });
    await expectEdge(out, 1.0);
  });

  rt("repeat renders are identical (seeded Math.random)", async () => {
    const dir = tmpDir();
    const html = `<!doctype html><meta name="html2mp4:duration" content="1"><meta name="html2mp4:width" content="160"><meta name="html2mp4:height" content="90"><body style="margin:0"><script>setInterval(()=>{document.body.style.background='hsl('+Math.floor(Math.random()*360)+',80%,50%)'},50)</script>`;
    const f = write(dir, "r.html", html);
    const a = path.join(dir, "a.mp4"), b = path.join(dir, "b.mp4");
    await convert({ input: f, flags: { ...BASE, output: a, workers: 1 } });
    await convert({ input: f, flags: { ...BASE, output: b, workers: 1 } });
    assert.equal(await rawHash(a), await rawHash(b));
  });

  rt("odd sizes are padded to even dimensions for H.264", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    await convert({ input: write(dir, "p.html", squareHtml({ w: 321, h: 181 })), flags: { ...BASE, output: out, workers: 1 } });
    const m = await probeMedia(out);
    assert.equal(m.video.width % 2, 0);
    assert.equal(m.video.height % 2, 0);
  });

  rt("a virtual-clock page cannot see real time passing", async () => {
    // If real time leaked in, a slow machine would change the result. Sleep a little inside the page's own script.
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    await convert({ input: write(dir, "p.html", squareHtml({ mode: "perf" })), flags: { ...BASE, output: out, workers: 1 } });
    await expectEdge(out, 1.0, 1);
  });
});

describe("parallel workers", () => {
  rt("2 and 3 workers give the same video as 1 worker", async () => {
    const dir = tmpDir();
    const f = write(dir, "p.html", squareHtml({ mode: "raf", seconds: 4 }));
    const one = path.join(dir, "one.mp4"), two = path.join(dir, "two.mp4"), three = path.join(dir, "three.mp4");
    const r1 = await convert({ input: f, flags: { ...BASE, output: one, workers: 1 } });
    const r2 = await convert({ input: f, flags: { ...BASE, output: two, workers: 2 } });
    const r3 = await convert({ input: f, flags: { ...BASE, output: three, workers: 3 } });
    assert.deepEqual([r1.workers, r2.workers, r3.workers], [1, 2, 2]); // 40 frames: at most ceil(40/30)=2 segments
    for (const f2 of [two, three]) {
      assert.equal(await countFrames(f2), 40);
      const p = await psnr(one, f2);
      assert.ok(p > 38, `PSNR vs single worker was ${p} dB`);
      await expectEdge(f2, 3.0);
    }
  });

  rt("a worker that starts mid-video fast-forwards timers and CSS correctly", async () => {
    const dir = tmpDir();
    const html = `<!doctype html><meta name="html2mp4:duration" content="6"><meta name="html2mp4:width" content="320"><meta name="html2mp4:height" content="180"><body style="margin:0;background:#000"><div id="b" style="position:absolute;top:60px;left:0;width:40px;height:40px;background:#f00"></div><style>#b{animation:m 6s linear forwards}@keyframes m{to{left:300px}}</style><script>setTimeout(()=>{document.body.style.background='#0a0'},4000)</script>`;
    const f = write(dir, "p.html", html);
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: f, flags: { fps: 10, output: out, workers: 2 } });
    assert.equal(r.workers, 2);
    assert.ok(Math.abs((await squareLeftEdge(out, 1.0)) - 50) <= 2, "first half");
    assert.ok(Math.abs((await squareLeftEdge(out, 5.0)) - 250) <= 2, "second half (worker 2 fast-forwarded 3s)");
    const before4 = await samplePixel(out, 3.8, 5, 5);
    const after4 = await samplePixel(out, 4.2, 5, 5);
    assert.ok(before4[1] < 40, "background still black before the 4s timer");
    assert.ok(after4[1] > 100, "background green after the 4s timer");
  });
});

describe("page features", () => {
  rt("a start button is clicked at 0s with --start, and not otherwise", async () => {
    const dir = tmpDir();
    const html = `<!doctype html><meta name="html2mp4:duration" content="2"><meta name="html2mp4:width" content="320"><meta name="html2mp4:height" content="180"><style>#b{position:absolute;top:60px;left:0;width:40px;height:40px;background:#f00}.run{animation:m 2s linear forwards}@keyframes m{to{left:200px}}</style><body style="margin:0;background:#000"><button id="go" style="position:absolute;bottom:0">go</button><div id="b"></div><script>document.getElementById('go').onclick=()=>document.getElementById('b').classList.add('run')</script>`;
    const f = write(dir, "p.html", html);
    const withStart = path.join(dir, "a.mp4"), without = path.join(dir, "b.mp4");
    await convert({ input: f, flags: { ...BASE, output: withStart, start: "#go", workers: 1 } });
    await convert({ input: f, flags: { ...BASE, output: without, start: "none", workers: 1 } });
    assert.ok(Math.abs((await squareLeftEdge(withStart, 1.0)) - 100) <= 2);
    assert.equal(await squareLeftEdge(without, 1.0), 0);
  });

  rt("a #go / #play / #start button is guessed, reported as guessed, and can be switched off", async () => {
    const dir = tmpDir();
    const html = `<!doctype html><meta name="html2mp4:duration" content="2"><meta name="html2mp4:width" content="320"><meta name="html2mp4:height" content="180"><button id="play">p</button>`;
    const f = write(dir, "p.html", html);
    const guessed = await planJob({ input: f });
    assert.equal(guessed.settings.sources.start, "guessed");
    assert.deepEqual(guessed.settings.actions, [{ type: "click", selector: "#play", at: 0 }]);
    const off = await planJob({ input: f, flags: { start: "none" } });
    assert.deepEqual(off.settings.actions, []);
    const { report } = await checkInput({ input: f, live: false });
    assert.match(report.rows.find((r) => r.id === "start").detail, /guessed/);
  });

  rt("a start trigger can also be declared in a <meta> tag", async () => {
    const dir = tmpDir();
    const html = `<!doctype html><meta name="html2mp4:start" content="#go"><meta name="html2mp4:duration" content="2"><meta name="html2mp4:width" content="320"><meta name="html2mp4:height" content="180"><body style="margin:0;background:#000"><button id="go" style="position:absolute;bottom:0">go</button><div id="b" style="position:absolute;top:60px;left:0;width:40px;height:40px;background:#f00"></div><script>document.getElementById('go').onclick=()=>{let s=null;(function t(ts){if(s===null)s=ts;document.getElementById('b').style.left=((ts-s)/10)+'px';requestAnimationFrame(t)})(0)}</script>`;
    const out = path.join(dir, "o.mp4");
    await convert({ input: write(dir, "p.html", html), flags: { ...BASE, output: out, workers: 1 } });
    assert.ok(Math.abs((await squareLeftEdge(out, 1.0)) - 100) <= 2);
  });

  rt("autoscroll turns a tall static page into a scrolling video", async () => {
    const dir = tmpDir();
    const html = `<!doctype html><meta name="html2mp4:width" content="320"><meta name="html2mp4:height" content="180"><body style="margin:0"><div style="height:2000px;background:linear-gradient(#f00,#00f)"></div>`;
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "p.html", html), flags: { ...BASE, output: out, duration: 3, recipe: "autoscroll", workers: 1 } });
    assert.equal(r.animated, true);
    const top = await samplePixel(out, 0.1, 160, 10);
    const bottom = await samplePixel(out, 2.8, 160, 170);
    assert.ok(top[0] > 200 && top[2] < 60, `start is red: ${top}`);
    assert.ok(bottom[2] > 200 && bottom[0] < 60, `end is blue: ${bottom}`);
  });

  rt("a static page is detected and warned about", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "s.html", `<!doctype html><body><h1>Hello</h1>`), flags: { ...BASE, output: out, duration: 1, width: 160, height: 90, workers: 1 } });
    assert.equal(r.animated, false);
    assert.ok(r.warnings.some((w) => /still image/.test(w)));
  });

  rt("missing files and script errors are reported", async () => {
    const dir = tmpDir();
    const html = squareHtml({ mode: "raf" }).replace("</body>", `<img src="nope.png"><script>throw new Error("boom")</script></body>`);
    const r = await convert({ input: write(dir, "p.html", html), flags: { ...BASE, output: path.join(dir, "o.mp4"), workers: 1 } });
    assert.ok(r.warnings.some((w) => /Missing file: \/nope\.png/.test(w)), r.warnings.join("|"));
    assert.ok(r.warnings.some((w) => /boom/.test(w)), r.warnings.join("|"));
  });

  rt("relative assets and ES modules load (served over http, not file://)", async () => {
    const dir = tmpDir();
    write(dir, "color.mjs", `export const c = "#0f0";`);
    write(dir, "data.json", `{"w":160}`);
    const html = `<!doctype html><meta name="html2mp4:duration" content="1"><meta name="html2mp4:width" content="160"><meta name="html2mp4:height" content="90"><body style="margin:0"><script type="module">import {c} from "./color.mjs"; const d = await (await fetch("./data.json")).json(); document.body.style.background = c; document.title = "w" + d.w;</script>`;
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "p.html", html), flags: { ...BASE, output: out, workers: 1 } });
    assert.deepEqual(r.warnings.filter((w) => /Missing|error/i.test(w)), []);
    const px = await samplePixel(out, 0.5, 80, 45);
    assert.ok(px[1] > 200 && px[0] < 60, `background should come from the module: ${px}`);
  });

  rt("WebM <video> elements are seeked frame by frame", async (t) => {
    const dir = tmpDir();
    const ff = await resolveFfmpeg();
    const gen = spawnSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=2", "-c:v", "libvpx", "-b:v", "500k", path.join(dir, "clip.webm")]);
    if (gen.status !== 0) return t.skip("this ffmpeg cannot create a WebM test clip");
    const html = `<!doctype html><meta name="html2mp4:duration" content="2"><meta name="html2mp4:width" content="160"><meta name="html2mp4:height" content="90"><body style="margin:0"><video src="clip.webm" muted autoplay loop style="width:160px;height:90px"></video>`;
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "p.html", html), flags: { ...BASE, output: out, workers: 1 } });
    assert.equal(r.animated, true, "video frames should change over time");
  });

  rt("the duration is detected from finite CSS animations when not declared", async () => {
    const dir = tmpDir();
    const html = `<!doctype html><meta name="html2mp4:width" content="160"><meta name="html2mp4:height" content="90"><style>div{width:20px;height:20px;background:red;animation:a 2.5s linear forwards}@keyframes a{to{margin-left:100px}}</style><div></div>`;
    const plan = await planJob({ input: write(dir, "p.html", html) });
    assert.equal(plan.settings.sources.duration, "detected");
    assert.equal(plan.settings.duration, 3); // 2.5s animation + 0.5s hold
  });
});

describe("output formats and ranges", () => {
  rt("GIF and WebM", async () => {
    const dir = tmpDir();
    const f = write(dir, "p.html", squareHtml({ mode: "raf" }));
    const gif = path.join(dir, "o.gif"), webm = path.join(dir, "o.webm");
    await convert({ input: f, flags: { ...BASE, output: gif, workers: 1, gifWidth: 160 } });
    await convert({ input: f, flags: { ...BASE, output: webm, workers: 1 } });
    assert.equal(fs.readFileSync(gif).subarray(0, 4).toString(), "GIF8");
    assert.equal((await probeMedia(gif)).video.width, 160);
    assert.match((await probeMedia(webm)).video.codec, /vp9/);
  });

  rt("--from/--to render only that part", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "p.html", squareHtml({ mode: "raf", seconds: 4 })), flags: { ...BASE, output: out, from: 1, to: 2, workers: 1 } });
    assert.equal(r.frames, 10);
    assert.equal(await countFrames(out), 10);
    // First frame of the clip is page time 1.0s: the square sits near x=100
    assert.ok(Math.abs((await squareLeftEdge(out, 0)) - 100) <= 2);
  });

  rt("the fast option (JPEG frames) still renders correctly", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    await convert({ input: write(dir, "p.html", squareHtml({ mode: "css" })), flags: { ...BASE, output: out, quality: "jpeg", encoderPreset: "ultrafast", workers: 1 } });
    await expectEdge(out, 1.0, 3);
  });

  rt("a failed render leaves no partial file behind", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    await assert.rejects(convert({ input: write(dir, "p.html", squareHtml()), flags: { ...BASE, output: out, voice: path.join(dir, "missing.wav"), workers: 1 } }));
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes("partial") || n.endsWith(".mp4")), []);
  });

  rt("a render can be cancelled", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    const ctl = new AbortController();
    const p = convert({ input: write(dir, "p.html", squareHtml({ seconds: 60 })), flags: { fps: 30, output: out, workers: 1 }, hooks: { signal: ctl.signal, onProgress: (pr) => pr.done > 5 && ctl.abort() } });
    await assert.rejects(p, (e) => e.code === "CANCELLED" || e.code === "FFMPEG_FAILED" || /cancel|stopped/i.test(e.message));
    assert.equal(fs.existsSync(out), false);
  });
});

describe("tmx films", () => {
  rt("a .tmx script renders with its own size, duration and content", async () => {
    const dir = tmpDir();
    const tmx = `film "T" duration=2s size=320x180 theme=mono\nscene 0s..2s transition=none {\n title "HELLO"\n}\n`;
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "s.tmx", tmx), flags: { ...BASE, output: out, workers: 1 } });
    assert.deepEqual([r.width, r.height, r.frames, r.kind], [320, 180, 20, "tmx"]);
    assert.equal(r.animated, true, "the progress bar moves");
    // White title text on a dark background somewhere in the middle band
    const { stdout } = spawnSync(await resolveFfmpeg(), ["-loglevel", "error", "-ss", "1", "-i", out, "-frames:v", "1", "-vf", "format=gray,crop=320:60:0:60", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
    assert.ok(Math.max(...stdout) > 200, "should contain bright title pixels");
  });

  rt("a broken .tmx is rejected before any rendering, with line numbers", async () => {
    const dir = tmpDir();
    await assert.rejects(convert({ input: write(dir, "bad.tmx", `scene 0s..2s {\n titel "x"\n}\n`), flags: { output: path.join(dir, "o.mp4") } }), (e) => e.code === "TMX_INVALID" && /bad\.tmx:2/.test(e.hint));
  });

  rt("the bundled examples all render", async () => {
    const dir = tmpDir();
    for (const name of ["demo.tmx", "story.tmx"]) {
      const r = await convert({ input: path.join(ROOT, "examples", name), flags: { output: path.join(dir, name + ".mp4"), preset: "hd720", duration: 1.5, fps: 8, workers: 1, fast: undefined } });
      assert.equal(r.animated, true, name);
      assert.deepEqual(r.warnings, [], name);
    }
  });
});

describe("audio", () => {
  rt("--voice adds an audio track matching the video length", async () => {
    const dir = tmpDir();
    const voice = toneWav(dir, "v.wav", 1.2);
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "p.html", squareHtml()), flags: { ...BASE, output: out, voice, workers: 1 } });
    const m = await probeMedia(out);
    assert.ok(m.audio, "has audio");
    assert.ok(Math.abs(m.duration - 2) < 0.15, `duration ${m.duration}`);
    assert.equal(r.hasAudio, true);
  });

  rt("--auto-fit stretches the animation to the narration (and the maths is right)", async () => {
    const dir = tmpDir();
    const voice = toneWav(dir, "v.wav", 3);
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "p.html", squareHtml({ mode: "raf", seconds: 2 })), flags: { ...BASE, output: out, voice, autoFit: true, workers: 1 } });
    assert.equal(r.autoFit.stretch, 1.5);
    const m = await probeMedia(out);
    assert.ok(Math.abs(m.duration - 3.6) < 0.15, `3s voice + 0.6s tail, got ${m.duration}`);
    assert.ok(m.audio);
    // video time 1.5s is page time 1.0s -> square at x=100 (it would be at 150 without stretching)
    assert.ok(Math.abs((await squareLeftEdge(out, 1.5)) - 100) <= 2);
  });

  rt("a voice-over longer than the video warns and suggests --auto-fit", async () => {
    const dir = tmpDir();
    const r = await convert({ input: write(dir, "p.html", squareHtml()), flags: { ...BASE, output: path.join(dir, "o.mp4"), voice: toneWav(dir, "v.wav", 5), workers: 1 } });
    assert.ok(r.warnings.some((w) => /auto-fit/.test(w)));
  });

  rt("music loops, fades and ducks under the voice", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    await convert({ input: write(dir, "p.html", squareHtml()), flags: { ...BASE, output: out, voice: toneWav(dir, "v.wav", 1), music: toneWav(dir, "m.wav", 0.5), musicVolume: 0.3, duck: true, workers: 1 } });
    const m = await probeMedia(out);
    assert.ok(m.audio);
    assert.ok(Math.abs(m.duration - 2) < 0.15, `short music must loop to fill ${m.duration}`);
  });

  rt("ducking really makes the music quieter while the voice speaks (measured)", async () => {
    const dir = tmpDir();
    const ff = await resolveFfmpeg();
    toneWav(dir, "v.wav", 1);
    spawnSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=200:duration=4", "-ar", "22050", path.join(dir, "m.wav")]);
    const f = write(dir, "p.html", squareHtml({ seconds: 3, w: 160, h: 90 }));
    const level = (file, ss, t) => {
      const r = spawnSync(ff, ["-hide_banner", "-ss", String(ss), "-t", String(t), "-i", file, "-vn", "-af", "bandpass=f=200:width_type=h:w=60,volumedetect", "-f", "null", "-"], { encoding: "utf8" });
      return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)[1]);
    };
    const common = { ...BASE, workers: 1, voice: path.join(dir, "v.wav"), music: path.join(dir, "m.wav"), musicVolume: 0.5 };
    const plain = path.join(dir, "plain.mp4"), ducked = path.join(dir, "ducked.mp4");
    await convert({ input: f, flags: { ...common, output: plain } });
    await convert({ input: f, flags: { ...common, output: ducked, duck: true } });
    const dip = level(plain, 0.15, 0.7) - level(ducked, 0.15, 0.7);
    assert.ok(dip >= 3, `music should be at least 3 dB quieter under the voice with ducking, measured ${dip.toFixed(1)} dB`);
  });

  rt("audio is ignored with a clear warning for GIF output", async () => {
    const dir = tmpDir();
    const r = await convert({ input: write(dir, "p.html", squareHtml()), flags: { ...BASE, output: path.join(dir, "o.gif"), voice: toneWav(dir, "v.wav", 1), workers: 1 } });
    assert.ok(r.warnings.some((w) => /cannot carry this audio/.test(w)));
  });

  rt("a .tmx can name its own voice-over and music files", async () => {
    const dir = tmpDir();
    toneWav(dir, "v.wav", 1);
    const tmx = `film "T" duration=2s size=160x90\nvoiceover "v.wav"\nscene 0s..2s { title "Hi" }\n`;
    const out = path.join(dir, "o.mp4");
    const r = await convert({ input: write(dir, "s.tmx", tmx), flags: { ...BASE, output: out, workers: 1 } });
    assert.equal(r.hasAudio, true);
  });
});

describe("check and snapshot", () => {
  rt("check passes an animated page and warns about a static one", async () => {
    const dir = tmpDir();
    const good = await checkInput({ input: write(dir, "a.html", squareHtml()) });
    assert.equal(good.report.ok, true);
    assert.equal(good.report.rows.find((r) => r.id === "motion").status, "pass");
    const bad = await checkInput({ input: write(dir, "b.html", `<!doctype html><h1>static</h1>`) });
    assert.equal(bad.report.rows.find((r) => r.id === "motion").status, "warn");
  });

  rt("check reports missing assets, fixed-size overflow and bad audio paths", async () => {
    const dir = tmpDir();
    const html = squareHtml({ w: 160, h: 90 }).replace("</body>", `<img src="gone.png"><div style="width:900px;height:20px"></div></body>`);
    const { report } = await checkInput({ input: write(dir, "p.html", html), flags: { voice: "nope.mp3" } });
    const st = (id) => report.rows.find((r) => r.id === id)?.status;
    assert.equal(st("assets"), "warn");
    assert.equal(st("overflow"), "warn");
    assert.equal(st("voice-over"), "fail");
    assert.equal(report.ok, false);
  });

  rt("check on a broken .tmx fails and lists the lines", async () => {
    const dir = tmpDir();
    const { report } = await checkInput({ input: write(dir, "b.tmx", `scene 0s..2s {\n titel "x"\n}\n`), live: false });
    assert.equal(report.ok, false);
    assert.ok(report.rows.some((r) => r.id === "tmx" && /Line 2/.test(r.label)));
  });

  rt("snapshot returns a valid image of the requested moment", async () => {
    const dir = tmpDir();
    const f = write(dir, "p.html", squareHtml({ mode: "raf" }));
    const a = await snapshot({ input: f, flags: BASE, atSec: 0 });
    const b = await snapshot({ input: f, flags: BASE, atSec: 1 });
    assert.deepEqual([...a.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.notDeepEqual(a.buffer, b.buffer);
    const j = await snapshot({ input: f, flags: BASE, atSec: 1, type: "jpeg" });
    assert.deepEqual([...j.buffer.subarray(0, 2)], [0xff, 0xd8]);
  });

  rt("inline source text works (used by Studio and MCP)", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "o.mp4");
    const r = await convert({ text: squareHtml(), kind: "html", name: "inline.html", baseDir: dir, flags: { ...BASE, output: out, workers: 1 } });
    assert.equal(r.frames, 20);
    await expectEdge(out, 1.0);
  });
});
