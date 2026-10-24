import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CLI, browserAvailable, squareHtml, tmpDir, write } from "./helpers.js";
import { probeMedia } from "../src/core/ffmpeg.js";
import { createMcpHandler } from "../src/mcp/server.js";

let client, root, HAS = false;
const progress = [];

before(async () => {
  HAS = await browserAvailable();
  root = tmpDir("tmx-mcp-");
  write(root, "page.html", squareHtml());
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp", "--root", root], env: { ...process.env, TOCKMUX_HOME: tmpDir("tmx-mcp-home-"), NO_COLOR: "1" } }));
});
after(async () => client?.close());

const rt = (name, fn) => test(`[render] ${name}`, { timeout: 120000 }, async (t) => (HAS ? fn(t) : t.skip("no browser")));
const text = (r) => r.content.find((c) => c.type === "text").text;

describe("MCP server (verified with the official MCP SDK client)", () => {
  test("handshake reports name, version and capabilities", () => {
    const v = client.getServerVersion();
    assert.equal(v.name, "tockmux");
    const caps = client.getServerCapabilities();
    assert.ok(caps.tools && caps.prompts && caps.resources);
    assert.match(client.getInstructions(), /check_html/);
  });

  test("lists the tools with schemas", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["check_html", "compile_tmx", "list_presets", "probe_media", "render_video", "snapshot_frame", "speak_text"]);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, "object", t.name);
      assert.ok(t.description.length > 30, t.name);
    }
  });

  test("list_presets and compile_tmx work without a browser", async () => {
    const p = JSON.parse(text(await client.callTool({ name: "list_presets", arguments: {} })));
    assert.equal(p.presets.tiktok.height, 1920);
    const ok = JSON.parse(text(await client.callTool({ name: "compile_tmx", arguments: { source: 'scene 0s..2s { title "Hi" }' } })));
    assert.equal(ok.ok, true);
    assert.match(ok.html, /<!DOCTYPE html>/);
    const bad = JSON.parse(text(await client.callTool({ name: "compile_tmx", arguments: { source: 'scene 0s..2s { titel "Hi" }' } })));
    assert.equal(bad.ok, false);
    assert.match(bad.diagnostics[0].message, /Did you mean "title"/);
    assert.equal(bad.html, undefined);
  });

  test("paths outside the allowed folder are refused (as a tool error, not a crash)", async () => {
    for (const p of ["../outside.html", "/etc/passwd"]) {
      const r = await client.callTool({ name: "probe_media", arguments: { path: p } });
      assert.equal(r.isError, true, p);
      assert.match(text(r), /outside the allowed folder/);
    }
    const w = await client.callTool({ name: "render_video", arguments: { path: "page.html", output: "../../evil.mp4" } });
    assert.equal(w.isError, true);
    assert.equal(fs.existsSync(path.join(root, "..", "..", "evil.mp4")), false);
  });

  test("a missing input is a clear tool error", async () => {
    const r = await client.callTool({ name: "check_html", arguments: {} });
    assert.equal(r.isError, true);
    assert.match(text(r), /either `path` or `source`/);
  });

  test("unknown tools are a protocol error", async () => {
    await assert.rejects(client.callTool({ name: "nope", arguments: {} }), /Unknown tool/);
  });

  test("prompt and resource carry the authoring contract", async () => {
    const { prompts } = await client.listPrompts();
    assert.equal(prompts[0].name, "make_html_video");
    const pr = await client.getPrompt({ name: "make_html_video", arguments: { topic: "a coffee shop", seconds: "8", format: "tiktok" } });
    const t = pr.messages[0].content.text;
    assert.match(t, /8-second/);
    assert.match(t, /coffee shop/);
    assert.match(t, /html2mp4:duration/);
    const { resources } = await client.listResources();
    assert.equal(resources[0].uri, "tockmux://contract");
    const res = await client.readResource({ uri: "tockmux://contract" });
    assert.match(res.contents[0].text, /animate by itself/);
  });

  test("ping works", async () => assert.deepEqual(await client.ping(), {}));

  rt("check_html inspects a file and an inline source", async () => {
    const a = JSON.parse(text(await client.callTool({ name: "check_html", arguments: { path: "page.html" } })));
    assert.equal(a.ok, true);
    assert.equal(a.settings.duration, 2);
    assert.equal(a.checks.find((c) => c.check === "Page animates").status, "pass");
    const b = JSON.parse(text(await client.callTool({ name: "check_html", arguments: { source: "<h1>static</h1>", kind: "html" } })));
    assert.equal(b.checks.find((c) => c.check === "Page animates").status, "warn");
  });

  rt("snapshot_frame returns an image the assistant can look at", async () => {
    const r = await client.callTool({ name: "snapshot_frame", arguments: { path: "page.html", at: 1, fps: 10, output: "frames/f1.jpg" } });
    const img = r.content.find((c) => c.type === "image");
    assert.equal(img.mimeType, "image/jpeg");
    assert.deepEqual([...Buffer.from(img.data, "base64").subarray(0, 2)], [0xff, 0xd8]);
    assert.ok(fs.existsSync(path.join(root, "frames", "f1.jpg")));
  });

  rt("render_video renders, streams progress notifications, and stays inside the folder", async () => {
    const seen = [];
    const r = await client.callTool({ name: "render_video", arguments: { path: "page.html", fps: 10, workers: 1 } }, undefined, { onprogress: (p) => seen.push(p) });
    assert.ok(!r.isError, text(r));
    const j = JSON.parse(text(r));
    assert.equal(j.output, path.join(root, "tockmux-output", "page.mp4"));
    assert.equal(j.animated, true);
    assert.equal((await probeMedia(j.output)).video.width, 320);
    assert.ok(seen.length >= 1 && seen.at(-1).progress === seen.at(-1).total, "progress reached 100%");
  });

  rt("render_video accepts inline .tmx and an explicit output path", async () => {
    const r = await client.callTool({ name: "render_video", arguments: { source: 'film "x" duration=1s size=160x90\nscene 0s..1s { title "Hi" }', kind: "tmx", output: "out/inline.gif", fps: 8, workers: 1 } });
    assert.ok(!r.isError, text(r));
    assert.equal(fs.readFileSync(path.join(root, "out", "inline.gif")).subarray(0, 3).toString(), "GIF");
  });

  test("speak_text without an account explains how to connect one", async () => {
    const r = await client.callTool({ name: "speak_text", arguments: { text: "hello" } });
    assert.equal(r.isError, true);
    assert.match(text(r), /voice add/);
  });
});

describe("MCP protocol edge cases (raw handler)", () => {
  test("negotiates down to a version it supports", async () => {
    const { handle } = createMcpHandler({ root });
    assert.equal((await handle({ method: "initialize", params: { protocolVersion: "2024-11-05" } })).protocolVersion, "2024-11-05");
    assert.equal((await handle({ method: "initialize", params: { protocolVersion: "1999-01-01" } })).protocolVersion, "2025-11-25");
  });
  test("unknown method is -32601", async () => {
    const { handle } = createMcpHandler({ root });
    await assert.rejects(handle({ method: "does/not/exist" }), (e) => e.rpcCode === -32601);
  });
});
