import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStudio } from "../src/studio/server.js";
import { launchArgs, findBrowser } from "../src/core/browser.js";
import { squareHtml, tmpDir, write, toneWav } from "./helpers.js";

let studio, browser, HAS = false;
process.env.TOCKMUX_HOME = tmpDir("tmx-ui-home-");
before(async () => {
  const found = process.env.TOCKMUX_NO_RENDER === "1" ? null : await findBrowser({});
  HAS = Boolean(found);
  if (!HAS) return;
  studio = await startStudio({ port: 0 });
  browser = await chromium.launch({ executablePath: found.executablePath, args: launchArgs() });
});
after(async () => {
  await browser?.close();
  await studio?.close();
});
const rt = (name, fn) => test(`[render] ${name}`, { timeout: 150000 }, async (t) => (HAS ? fn(t) : t.skip("no browser")));

rt("Studio UI: add a file, check it, render it, and play the result", async () => {
  const dir = tmpDir();
  const html = write(dir, "promo.html", squareHtml());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(studio.url);
  assert.equal(await page.locator("#renderBtn").isDisabled(), true, "buttons are disabled until a file is added");

  await page.setInputFiles("#fileInput", html);
  await page.waitForSelector("#fileList li");
  assert.equal(await page.locator("#renderBtn").isDisabled(), false);
  assert.match(await page.locator("#fileList").innerText(), /promo\.html/);
  await page.waitForSelector("#stage iframe", { timeout: 5000 });

  await page.click("#checkBtn");
  await page.waitForSelector("#reportCard:not([hidden])", { timeout: 60000 });
  assert.match(await page.locator("#report").innerText(), /Page animates/);
  await page.screenshot({ path: process.env.STUDIO_SHOT || path.join(dir, "studio-check.png") });

  await page.fill("#fps", "10");
  await page.check("#fast");
  await page.click("#renderBtn");
  await page.waitForSelector("#resultCard:not([hidden])", { timeout: 120000 });
  const src = await page.getAttribute("#player video", "src");
  assert.match(src, /\/api\/jobs\/[a-f0-9]+\/file\?inline=1/);
  assert.match(await page.locator("#resultMeta").innerText(), /320x180, 10 fps, 2s/);
  const dl = await page.getAttribute("#dl", "href");
  const bytes = await page.evaluate(async (u) => (await (await fetch(u)).arrayBuffer()).byteLength, dl);
  assert.ok(bytes > 1000, "download works");
  // the video element can actually decode the file
  const dur = await page.evaluate(() => new Promise((res) => { const v = document.querySelector("#player video"); v.onloadedmetadata = () => res(v.duration); if (v.readyState >= 1) res(v.duration); }));
  assert.ok(Math.abs(dur - 2) < 0.2, `browser decoded video, duration ${dur}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

rt("Studio UI: paste code, sample .tmx renders a preview; folder-style names and bad files are handled", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(studio.url);
  await page.click("#tabPaste");
  await page.click("#sample");
  await page.click("#usePasted");
  await page.waitForSelector("#fileList li");
  assert.match(await page.locator("#fileList").innerText(), /pasted\.tmx/);
  await page.waitForSelector("#stage iframe");
  const framed = await page.frameLocator("#stage iframe").locator("#stage").count();
  assert.equal(framed, 1, "the compiled .tmx preview is shown");
  // an unsupported file shows a message and keeps the buttons disabled
  await page.click("#tabDrop");
  const bad = write(tmpDir(), "notes.txt", "hello");
  await page.setInputFiles("#fileInput", bad);
  await page.waitForSelector(".banner.warn");
  assert.match(await page.locator("#alerts").innerText(), /No .html or .tmx file/);
  assert.equal(await page.locator("#renderBtn").isDisabled(), true);
  // audio files appear in the voice-over picker
  await page.setInputFiles("#fileInput", [write(tmpDir(), "x.html", squareHtml()), toneWav(tmpDir(), "narration.wav", 1)]);
  await page.waitForSelector("#fileList li");
  assert.ok((await page.locator("#voiceSel option").allTextContents()).includes("narration.wav"));
  assert.deepEqual(errors, []);
  await ctx.close();
});

rt("Studio UI works on a phone-sized screen without sideways scrolling", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(studio.url);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.equal(m.sw, m.cw, `page is ${m.sw}px wide in a ${m.cw}px window`);
  await ctx.close();
});
