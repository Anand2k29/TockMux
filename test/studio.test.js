import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startStudio } from "../src/studio/server.js";
import { browserAvailable, squareHtml, toneWav, tmpDir, mockElevenLabs } from "./helpers.js";
import { probeMedia } from "../src/core/ffmpeg.js";

let studio, base, HAS = false;
process.env.TOCKMUX_HOME = tmpDir("tmx-studio-home-");

before(async () => {
  HAS = await browserAvailable();
  studio = await startStudio({ port: 0 });
  base = studio.url;
});
after(async () => studio.close());

const b64 = (s) => Buffer.from(s).toString("base64");
function req(method, p, { body, headers = {}, host } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const r = http.request({ host: u.hostname, port: u.port, path: p, method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(host ? { Host: host } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString(), json });
      });
    });
    r.on("error", reject);
    if (body) r.write(typeof body === "string" ? body : JSON.stringify(body));
    r.end();
  });
}

describe("studio pages and info", () => {
  test("serves the app, the landing page and info", async () => {
    const home = await req("GET", "/");
    assert.equal(home.status, 200);
    assert.match(home.text, /TockMux Studio/);
    assert.equal(home.headers["x-content-type-options"], "nosniff");
    const land = await req("GET", "/landing");
    assert.match(land.text, /Spidey_Moon/);
    const info = await req("GET", "/api/info");
    assert.ok(info.json.presets.tiktok && info.json.version && info.json.discord === "Spidey_Moon");
  });
  test("unknown routes are 404", async () => assert.equal((await req("GET", "/nope")).status, 404));
});

describe("studio security", () => {
  test("rejects a foreign Host header (DNS rebinding)", async () => {
    const r = await req("GET", "/api/info", { host: "evil.example.com" });
    assert.equal(r.status, 403);
  });
  test("rejects cross-site POSTs by Origin", async () => {
    const r = await req("POST", "/api/voice", { body: { name: "x", key: "y" }, headers: { Origin: "https://evil.example.com" } });
    assert.equal(r.status, 403);
  });
  test("accepts same-origin POSTs", async () => {
    const r = await req("POST", "/api/compile", { body: { source: 'scene 0s..1s { title "x" }' }, headers: { Origin: base } });
    assert.equal(r.status, 200);
  });
  test("refuses path traversal and absolute paths in uploads", async () => {
    for (const name of ["../escape.html", "/etc/x.html", "a/../../b.html", "C:\\x.html"]) {
      const r = await req("POST", "/api/check", { body: { files: [{ name, data: b64("<p>x</p>") }] } });
      assert.equal(r.status, 500, name);
      assert.match(r.json.error, /Unsafe file name/, name);
    }
  });
  test("API responses are never cacheable and API keys are masked", async () => {
    const r = await req("POST", "/api/voice", { body: { name: "k", key: "SECRETSECRET12345" }, headers: { Origin: base } });
    assert.equal(r.status, 200);
    const list = await req("GET", "/api/voice");
    assert.ok(!list.text.includes("SECRETSECRET12345"));
    assert.match(list.json[0].key, /…/);
    assert.equal(list.headers["cache-control"], "no-store");
    await req("DELETE", "/api/voice?name=k", { headers: { Origin: base } });
  });
  test("bad JSON is a 400, not a crash", async () => {
    const r = await req("POST", "/api/compile", { body: "{not json" });
    assert.equal(r.status, 400);
    assert.equal((await req("GET", "/api/info")).status, 200, "server still alive");
  });
  test("no files / no main file is a friendly error", async () => {
    assert.match((await req("POST", "/api/render", { body: { files: [] } })).json.error, /No files/);
    assert.match((await req("POST", "/api/render", { body: { files: [{ name: "a.txt", data: b64("x") }] } })).json.error, /Include an .html or .tmx/);
  });
  test("unknown job ids are 404", async () => assert.equal((await req("GET", "/api/jobs/deadbeef/events")).status, 404));
});

describe("studio compile and voice endpoints", () => {
  test("compile returns html plus diagnostics for a .tmx", async () => {
    const r = await req("POST", "/api/compile", { body: { source: 'film "x" size=640x360\nscene 0s..2s { titel "oops" }' } });
    assert.equal(r.json.width, 640);
    assert.ok(r.json.diagnostics.some((d) => /Did you mean "title"/.test(d.message)));
    assert.match(r.json.html, /<!DOCTYPE html>/);
  });
  test("adding an account verifies it against the provider", async () => {
    const mock = await mockElevenLabs({ GOODKEY123456: { limit: 100, used: 10 } });
    process.env.TOCKMUX_ELEVENLABS_URL = mock.url;
    try {
      const r = await req("POST", "/api/voice", { body: { name: "m", key: "GOODKEY123456" }, headers: { Origin: base } });
      assert.equal(r.json.check.ok, true);
      assert.equal(r.json.check.limit, 100);
      const list = await req("GET", "/api/voice");
      assert.deepEqual([list.json[0].used, list.json[0].limit], [10, 100]);
      await req("DELETE", "/api/voice?name=m", { headers: { Origin: base } });
      assert.deepEqual((await req("GET", "/api/voice")).json, []);
    } finally {
      delete process.env.TOCKMUX_ELEVENLABS_URL;
      await mock.close();
    }
  });
});

describe("studio check and render", () => {
  const rt = (name, fn) => test(`[render] ${name}`, { timeout: 120000 }, async (t) => (HAS ? fn(t) : t.skip("no browser")));

  rt("check returns the checklist for an uploaded page", async () => {
    const r = await req("POST", "/api/check", { body: { files: [{ name: "p.html", data: b64(squareHtml()) }] } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.rows.find((x) => x.id === "motion").status, "pass");
  });

  async function runJob(body) {
    const start = await req("POST", "/api/render", { body });
    assert.equal(start.status, 202, start.text);
    const id = start.json.id;
    return await new Promise((resolve, reject) => {
      const u = new URL(base);
      const events = [];
      http.get({ host: u.hostname, port: u.port, path: `/api/jobs/${id}/events` }, (res) => {
        assert.match(res.headers["content-type"], /text\/event-stream/);
        let buf = "";
        res.on("data", (c) => {
          buf += c;
          const parts = buf.split("\n\n");
          buf = parts.pop();
          for (const p of parts) {
            const type = /event: (\w+)/.exec(p)?.[1];
            const data = JSON.parse(/data: (.*)/.exec(p)?.[1] || "null");
            events.push({ type, data });
            if (type === "done" || type === "error") resolve({ id, events });
          }
        });
        res.on("error", reject);
      }).on("error", reject);
    });
  }

  rt("render job streams progress, then the file can be downloaded and played", async () => {
    const { id, events } = await runJob({ main: "p.html", files: [{ name: "p.html", data: b64(squareHtml()) }], flags: { fps: 10, workers: 1, format: "mp4" } });
    assert.ok(events.some((e) => e.type === "progress"), "progress events");
    const done = events.at(-1);
    assert.equal(done.type, "done");
    assert.deepEqual([done.data.width, done.data.height, done.data.format], [320, 180, "mp4"]);
    assert.ok(!("output" in done.data), "server paths must not leak to the browser");
    const file = await req("GET", `/api/jobs/${id}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers["content-type"], "video/mp4");
    assert.match(file.headers["content-disposition"], /attachment; filename="p\.mp4"/);
    const tmp = path.join(tmpDir(), "dl.mp4");
    fs.writeFileSync(tmp, file.buf);
    assert.equal((await probeMedia(tmp)).video.codec, "h264");
    const inline = await req("GET", `/api/jobs/${id}/file?inline=1`);
    assert.ok(!inline.headers["content-disposition"]);
    const range = await req("GET", `/api/jobs/${id}/file`, { headers: { Range: "bytes=0-99" } });
    assert.equal(range.status, 206);
    assert.equal(range.buf.length, 100);
  });

  rt("uploaded sibling assets are available to the page, and voice-over is mixed in", async () => {
    const wav = fs.readFileSync(toneWav(tmpDir(), "v.wav", 1));
    const html = squareHtml().replace("</body>", `<script type="module">import {c} from "./c.mjs"; document.body.style.background=c</script></body>`);
    const { events } = await runJob({ main: "p.html", files: [{ name: "p.html", data: b64(html) }, { name: "c.mjs", data: b64('export const c="#123456"') }, { name: "v.wav", data: wav.toString("base64") }], flags: { fps: 10, workers: 1, voiceFile: "v.wav", autoFit: false } });
    const done = events.at(-1);
    assert.equal(done.type, "done", JSON.stringify(done));
    assert.equal(done.data.hasAudio, true);
    assert.deepEqual(done.data.warnings.filter((w) => /Missing/.test(w)), []);
  });

  rt("a failing render reports a readable error through the stream", async () => {
    const { events } = await runJob({ main: "b.tmx", files: [{ name: "b.tmx", data: b64('scene 0s..2s {\n titel "x"\n}') }] });
    const last = events.at(-1);
    assert.equal(last.type, "error");
    assert.match(last.data.message, /problem/);
    assert.match(last.data.hint, /b\.tmx:2/);
  });

  rt("jobs are queued one at a time and can be cancelled", async () => {
    const long = { main: "p.html", files: [{ name: "p.html", data: b64(squareHtml({ seconds: 120 })) }], flags: { fps: 30, workers: 1 } };
    const first = (await req("POST", "/api/render", { body: long })).json;
    const second = (await req("POST", "/api/render", { body: long })).json;
    assert.equal(first.ahead, 0);
    assert.equal(second.ahead, 1, "second job waits behind the running first one");
    assert.equal((await req("POST", `/api/jobs/${second.id}/cancel`, { headers: { Origin: base } })).json.cancelled, true);
    assert.equal((await req("POST", `/api/jobs/${first.id}/cancel`, { headers: { Origin: base } })).json.cancelled, true);
    // wait for the first job to wind down
    for (let i = 0; i < 100 && studio.queue.get(first.id).status === "running"; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(studio.queue.get(first.id).status, "cancelled");
    assert.equal(studio.queue.get(second.id).status, "cancelled");
  });
});

describe("studio lifecycle", () => {
  test("a busy port gives a helpful message", async () => {
    await assert.rejects(startStudio({ port: studio.port }), (e) => e.code === "PORT_BUSY" && /--port/.test(e.hint));
  });
});
