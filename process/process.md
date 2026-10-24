# TockMux: the process

This folder explains how TockMux was researched, decided, built and checked, and how it is meant to be used.
Read the files in this order:

| File | What it answers |
| --- | --- |
| `process.md` (this file) | What was done, in order, and what is still open |
| `decision.md` | Every important decision and why it was taken |
| `mvp.md` | What the MVP is, why it is the MVP, and how it works |
| `functions.mvp` | Which function talks to which, and what it passes |
| `flow.md` | The flow of a render, from a command to an MP4 |
| `use.md` | How to use the product, and every case it covers |

Product name: **TockMux** (npm package `tockmux`, version 4.0.0).
Author: **Spidey_Moon** on Discord, **Anand2k29** on GitHub. Licence: MIT.

---

## 1. The idea

Claude and other AI tools can write a beautiful animated web page in a minute. A web page is not a video, though.
You cannot post it on TikTok or YouTube, put it in a slide deck, or send it to a client as an MP4.

TockMux turns a self-playing HTML animation into a frame-perfect MP4, GIF or WebM. It takes control of the clock,
draws one frame at a time, and encodes the result with FFmpeg. The same input gives the same output on every computer.

## 2. What was researched

Research was done on 2026-10-23 and in the earlier build sessions for this project.

**The question:** should TockMux be an MCP server, an npm package, or both?

**What the market looks like today (web search, 2026-10-23):**

- **HyperFrames (HeyGen, open source).** An npm package and a CLI that turns HTML into deterministic MP4 with
  Puppeteer and FFmpeg. It is aimed at AI agents and is installed as skills for Claude Code, Cursor, Gemini CLI and
  Codex. It is the closest direct competitor.
- **Clip.A.Canvas (ClipACanvas).** An MCP server for Claude Code that captures HTML, CSS, SVG and canvas motion with
  Playwright and FFmpeg. It is distributed on PyPI, not npm, and the sources do not say it is deterministic.
- **Playwright MCP video server (jvidal86).** A JavaScript MCP server that converts HTML or URLs to MP4 with Playwright.
  The listing is marked unvalidated and is Linux-focused.
- **Remotion.** Makes video from React components. You write React, not plain HTML.
- **Screen recorders and browser extensions.** Not deterministic.

Sources:
- HyperFrames listing: https://dev.co/ai/mcp/hyperframes
- HyperFrames framework page: https://docsearch.algolia.com/mcp/docs/repo/heygen-com/hyperframes
- Clip.A.Canvas: https://glama.ai/mcp/servers/mechreaper007x/ClipACanvas
- Playwright MCP video server: https://lobehub.com/mcp/jvidal86-playwright-mcp-server

**What this means:**

1. An MCP server alone is not a moat. Several already exist, and the ecosystem is crowded with thin wrappers.
2. An npm package alone is invisible to AI assistants, which is where the new demand is.
3. The combination is the strongest position: one engine, reachable from the terminal, from a library, from an app
   and from an assistant. That is what TockMux already was.

Full reasoning is in `decision.md`.

## 3. What was built

Starting point: the TockMux 4.0.0 project already in this folder (renderer, CLI, `.tmx` language, Studio, MCP server,
ElevenLabs voice pool, 182 tests, landing page). This work added or changed:

| Area | Change | Status |
| --- | --- | --- |
| CLI | New `tockmux watch` command (alias `dev`): re-renders on every save, debounced, queues a save that arrives mid-render | Done and tested end to end |
| Contact | Discord **Spidey_Moon** and GitHub **Anand2k29** in the CLI (`tockmux about`), Studio API, README, package author and every doc | Done |
| Landing page | `site/index.html` rewritten in a neo-brutalist style with a muted palette, a long explanation of what TockMux is, a comparison table, use cases, the MCP section, FAQ and contact | Done, reads well at phone width |
| Tests | Fixed a Windows-only failure in `npm pack` (the `npm` command needs a shell on Windows); added two tests for `watch` | Done, see the test result below |
| Process docs | This folder: `process.md`, `decision.md`, `mvp.md`, `functions.mvp`, `flow.md`, `use.md` | Done |

## 4. How it was checked

- The full automated test suite was run with `node scripts/run-tests.js`. The result is in section 6.
- `watch` was run for real: a page was rendered, the file was saved, and a second render started and finished. The log
  showed `render #1` and `render #2`.
- The landing page was checked for layout rules: a 16px side gutter, a phone breakpoint under 860px, no horizontal
  page scroll, and reduced-motion support.

## 5. What is still open (honest list)

These need you, and I did not do them because they need your credentials or your decision:

1. **Publish to npm.** Needs `npm login` with your account and `npm publish`. The package is ready (`npm pack --dry-run`
   passes, 50 files). See `use.md`, section "For the maintainer".
2. **Publish the repository to GitHub** under `Anand2k29`. The `repository`, `homepage` and `bugs` fields in
   `package.json` are still empty. Fill them after the repo exists.
3. **Host the landing page** (for example GitHub Pages or Netlify, from the `site/` folder).
4. **Register the MCP server** in the official MCP registry. This needs the package to be on npm first.
5. **Test the ElevenLabs narration with a real key.** The existing docs say it was only tested against a mock.
6. **Test on macOS and Linux with the watch command.** Only Windows was used for the watch test.

I did not enter any credentials or publish anything. Publishing is outward-facing and was not confirmed in chat.

## 6. Result of the test run

See the bottom of this file, filled in after the final run.

---

## Reading the code

- `bin/tockmux.js` is the entry point. `src/cli/main.js` lists the commands.
- `src/cli/commands/watch.js` is the new command.
- `src/core/pipeline.js` is the heart: `convert()` runs the whole job.
- `site/index.html` is the landing page.
- `docs/` holds the older guides (problem, setup, publishing, MCP, architecture, test report).

---

## 7. Update: longer landing page, promo video, README (second round)

- **Promo video:** `promo/promo.html` is an 18-second, 1280x720 film made with CSS animations. It was rendered by TockMux
  itself (`tockmux render promo/promo.html --workers 1`, about 28 s) to `promo/tockmux-promo.mp4`. A copy is in `site/promo.mp4`
  and the root (linked from the README). Frames at 2 s and 12 s were checked by eye.
- **Landing page:** longer now, with a video section, a "Why it is useful" section, a day-one list, a privacy section,
  and the existing features, comparison, use cases, MCP, library, get-started, FAQ and contact sections. Headings use
  tighter word spacing (`word-spacing: -.08em`) to fix the wide gaps. Checked at desktop and 375 px phone width with no
  horizontal scroll.
- **README:** a "Why TockMux" section and a link to the promo.
- **Tests:** full suite run, then the one failing Windows test (examples path with a space in the folder name) was fixed.
  After the fix, `test/render.test.js` passes 40 of 40 when run alone. The full-suite run was done before that fix.

## 8. Publishing status

Not published. npm publishing needs the author's npm login, and PyPI is only needed if a Python package is also wanted
(TockMux is a Node package today, so PyPI does not apply yet).
