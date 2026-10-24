import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { VoiceStore } from "../src/voice/store.js";
import { VoicePool } from "../src/voice/pool.js";
import { probeMedia } from "../src/core/ffmpeg.js";
import { mockElevenLabs, tmpDir } from "./helpers.js";

describe("voice pool failover (mock ElevenLabs server)", () => {
  let mock;
  let accounts;
  const makeStore = () => new VoiceStore(path.join(tmpDir(), "voice.json"));
  const events = [];

  before(async () => {
    accounts = {};
    mock = await mockElevenLabs(accounts);
    process.env.TOCKMUX_ELEVENLABS_URL = mock.url;
  });
  after(async () => {
    delete process.env.TOCKMUX_ELEVENLABS_URL;
    await mock.close();
  });

  const reset = (cfg) => {
    for (const k of Object.keys(accounts)) delete accounts[k];
    Object.assign(accounts, cfg);
    mock.calls.length = 0;
    events.length = 0;
  };

  test("refresh reads real usage numbers", async () => {
    reset({ A: { limit: 1000, used: 400 } });
    const store = makeStore();
    store.add({ name: "a", apiKey: "A" });
    const pool = new VoicePool(store);
    const [r] = await pool.refresh();
    assert.deepEqual([r.ok, r.used, r.limit, r.tier], [true, 400, 1000, "free"]);
    assert.equal(store.all()[0].characterLimit, 1000);
  });

  test("uses the first account while it has characters", async () => {
    reset({ A: { limit: 1000, used: 0 }, B: { limit: 1000, used: 0 } });
    const store = makeStore();
    store.add({ name: "a", apiKey: "A" });
    store.add({ name: "b", apiKey: "B" });
    const pool = new VoicePool(store);
    const out = path.join(tmpDir(), "n.mp3");
    const r = await pool.synthesize("Hello there, this is a test.", out);
    assert.deepEqual(Object.keys(r.usage), ["a"]);
    assert.ok(fs.statSync(out).size > 0);
    assert.deepEqual(mock.calls.map((c) => c.key), ["A"]);
  });

  test("rotates to the next account when quota runs out mid-request", async () => {
    // Local numbers say A has room, but the server says it does not.
    reset({ A: { limit: 5, used: 0 }, B: { limit: 1000, used: 0 } });
    const store = makeStore();
    store.add({ name: "a", apiKey: "A" }); // limit unknown locally, so it is tried first
    store.add({ name: "b", apiKey: "B" });
    const pool = new VoicePool(store, { onEvent: (e) => events.push(e) });
    const r = await pool.synthesize("This sentence is longer than five characters.", path.join(tmpDir(), "n.mp3"));
    assert.deepEqual(Object.keys(r.usage), ["b"]);
    assert.ok(events.some((e) => e.type === "rotate" && e.account === "a" && /out of characters/.test(e.reason)));
    assert.equal(store.all().find((a) => a.name === "a").status, "exhausted");
    // Next call skips the exhausted account without even trying it
    mock.calls.length = 0;
    await pool.synthesize("Another sentence for the second call.", path.join(tmpDir(), "n2.mp3"));
    assert.deepEqual(mock.calls.map((c) => c.key), ["B"]);
  });

  test("skips an invalid key and marks it", async () => {
    reset({ BAD: { invalid: true, limit: 1, used: 0 }, B: { limit: 1000, used: 0 } });
    const store = makeStore();
    store.add({ name: "bad", apiKey: "BAD" });
    store.add({ name: "b", apiKey: "B" });
    const pool = new VoicePool(store, { onEvent: (e) => events.push(e) });
    const r = await pool.synthesize("Hello world.", path.join(tmpDir(), "n.mp3"));
    assert.deepEqual(Object.keys(r.usage), ["b"]);
    assert.equal(store.all().find((a) => a.name === "bad").status, "invalid");
  });

  test("a rate-limited account is skipped but not marked as exhausted", async () => {
    reset({ A: { limit: 1000, used: 0, rateLimited: true }, B: { limit: 1000, used: 0 } });
    const store = makeStore();
    store.add({ name: "a", apiKey: "A" });
    store.add({ name: "b", apiKey: "B" });
    const pool = new VoicePool(store);
    const r = await pool.synthesize("Hello world.", path.join(tmpDir(), "n.mp3"));
    assert.deepEqual(Object.keys(r.usage), ["b"]);
    assert.equal(store.all().find((a) => a.name === "a").status, "ok");
  });

  test("long narration is split and chunks can land on different accounts", async () => {
    reset({ A: { limit: 120, used: 0 }, B: { limit: 5000, used: 0 } });
    const store = makeStore();
    store.add({ name: "a", apiKey: "A", characterLimit: 120, characterCount: 0 });
    store.add({ name: "b", apiKey: "B", characterLimit: 5000, characterCount: 0 });
    const pool = new VoicePool(store);
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const out = path.join(tmpDir(), "long.mp3");
    const r = await pool.synthesize(text, out, { maxChunk: 100 });
    assert.ok(r.chunks >= 3, `chunks=${r.chunks}`);
    assert.ok(r.usage.a > 0 && r.usage.b > 0, JSON.stringify(r.usage));
    assert.equal(r.usage.a + r.usage.b, r.chars);
    const m = await probeMedia(out);
    assert.ok(m.audio && m.duration > 1, "joined audio should be playable");
  });

  test("balance strategy prefers the account with most characters left", async () => {
    reset({ A: { limit: 1000, used: 0 }, B: { limit: 1000, used: 0 } });
    const store = makeStore();
    store.add({ name: "a", apiKey: "A", characterLimit: 1000, characterCount: 900 });
    store.add({ name: "b", apiKey: "B", characterLimit: 1000, characterCount: 0 });
    const pool = new VoicePool(store, { strategy: "balance" });
    const r = await pool.synthesize("Hello world.", path.join(tmpDir(), "n.mp3"));
    assert.deepEqual(Object.keys(r.usage), ["b"]);
  });

  test("when every account is exhausted the error explains what to do", async () => {
    reset({ A: { limit: 3, used: 0 } });
    const store = makeStore();
    store.add({ name: "a", apiKey: "A" });
    const pool = new VoicePool(store);
    await assert.rejects(pool.synthesize("Way more than three characters.", path.join(tmpDir(), "n.mp3")), (e) => e.code === "VOICE_EXHAUSTED" && /voice add/.test(e.hint));
  });

  test("no accounts gives a clear setup hint", async () => {
    const pool = new VoicePool(makeStore());
    await assert.rejects(pool.synthesize("Hi", path.join(tmpDir(), "n.mp3")), (e) => e.code === "NO_VOICE_ACCOUNT" && /voice add/.test(e.hint));
  });

  test("empty text is rejected", async () => {
    const store = makeStore();
    store.add({ name: "a", apiKey: "A" });
    await assert.rejects(new VoicePool(store).synthesize("   ", path.join(tmpDir(), "n.mp3")), (e) => e.code === "NO_TEXT");
  });

  test("usage is saved back so a later run remembers it", async () => {
    reset({ A: { limit: 1000, used: 0 } });
    const store = makeStore();
    store.add({ name: "a", apiKey: "A", characterLimit: 1000, characterCount: 0 });
    await new VoicePool(store).synthesize("Twelve chars", path.join(tmpDir(), "n.mp3"));
    assert.equal(new VoiceStore(store.file).all()[0].characterCount, 12);
  });
});
