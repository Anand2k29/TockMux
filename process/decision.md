# Decisions

Each decision has: what was decided, why, and what was rejected. Dates are 2026-10-23 unless noted.

---

## D1. Build one engine, and reach it from four doors

**Decided:** TockMux is one engine (`src/core/`) with four front doors: the command line, a library import, the
Studio web app, and an MCP server.

**Why:** The people who need this are split. Creators want a command. Developers want an import. Non-experts want a
drag-and-drop app. AI-assistant users want to say "make me a video" and have it happen. Four doors on one engine means
one place to fix bugs and one set of tests.

**Rejected:** Separate products for each door. That would multiply maintenance and make the behaviour drift.

---

## D2. Package first, MCP second (the answer to "MCP or package?")

**Decided:** Publish the npm package as the primary product. The MCP server ships inside the same package
(`tockmux mcp`) as a thin adapter. Do not publish a separate MCP-only product.

**Why:**

- An MCP server is only a way for an assistant to call a tool. Without an engine behind it, it is a wrapper.
  Several MCP wrappers for HTML-to-video already exist (see `process.md`, section 2), so an MCP alone is not a moat.
- An npm package is what people install, script, put in CI, and import. It is also what an MCP server needs in order
  to run (`npx -y tockmux mcp`), so the package is the base layer either way.
- Doing both costs almost nothing extra here, because the MCP server is already built, tested, and uses the same
  `convert()` function as the CLI.
- The package is discoverable by people who have no assistant at all.

**Answer in one line:** Both, but the package is the product and the MCP is a door into it.

**Rejected:** MCP only. It would be crowded, depend on an assistant being present, and offer no way to automate
renders outside a chat.

---

## D3. Keep the virtual-clock renderer

**Decided:** Keep the deterministic renderer (timers, `requestAnimationFrame`, `Date`, `performance.now()`, CSS
animations and `Math.random` are driven by TockMux, frame by frame).

**Why:** This is the real difference. Screen recording is not repeatable. Most competitors capture frames but do not
all control every clock a page can read. The test suite proves the claim: a square at 100 px/s lands on the exact
pixel at frame 10 with five animation methods.

**Rejected:** Switching to plain screenshot capture. Faster to write, but it loses the repeatability that is the
product's promise.

---

## D4. Add `tockmux watch` as the next feature

**Decided:** Add a watch command that re-renders on save.

**Why:** Creators write a page, render, look, edit, and render again. Each cycle used to mean typing the command again.
A watch mode turns the loop into "save and look". It is the single most-asked-for convenience for this kind of tool
and it fits the "easy to use" goal.

**How it was built (see `functions.mvp`):**

- It reuses the same `convert()` call as `render`, so output is identical.
- Saves are debounced by 300 ms, because editors often write a file twice.
- If a save arrives while a render is running, one more render is queued. Saves do not pile up.
- A failed render prints a plain-English error and keeps watching, so a typo does not kill the session.
- Ctrl+C stops it cleanly.

**Known limit:** On some editors that save by replacing the file, the operating system may stop reporting changes for
that file. If that happens, run `tockmux watch` again. A fix (watching the folder and filtering by name) is listed as
a next step in `mvp.md`.

**Rejected:** A live preview server that re-renders in the browser. Useful, but a larger feature, and the MP4 is the
product.

---

## D5. Keep the terminal animations, do not rewrite them

**Decided:** Keep the existing animated spinner (braille frames at 80 ms), the progress bar with fps and ETA, the
gradient banner, and colour that turns off with `NO_COLOR`, `--no-color` or a non-terminal.

**Why:** The request asked for "the same terminal, with animations". These were already there and tested. Rewriting
them would add risk for no gain. The fallback to ASCII on old Windows consoles stays, so nothing breaks there.

---

## D6. Neo-brutalist landing page with a muted palette

**Decided:** Rebuild `site/index.html` in neo-brutalism: thick black borders, hard offset shadows, flat blocks, a bold
display face. Palette: cream paper `#F4EFE3`, ink `#161514`, and muted mustard `#E3B95C`, dusty rose `#E59A8A`,
sage `#A9C5A0`, slate `#9DB2CC`, lilac `#C9BEDD`.

**Why:** The request asked for neo-brutalism with colours that are not Gen Z or very bright. Muted tones with heavy
black outlines keep the style strong without shouting. The old dark violet page was replaced because it did not match.

**Accessibility kept:** text contrast is high (ink on cream), focus rings are visible, the animation in the terminal
block stops under `prefers-reduced-motion`, and the layout collapses to one column under 860 px.

---

## D7. Contact details

**Decided:** Use **Spidey_Moon** (Discord) and **Anand2k29** (GitHub), as the author gave them.

**Why:** The author asked for these in the landing page. The older docs said "Spidy_Moon". The spelling was changed
everywhere to the one the author gave. If that is not right, change `DISCORD` in `src/version.js`, and the tests will
show every place to update.

---

## D8. Do not publish or enter credentials

**Decided:** Do not run `npm publish`, `npm login`, create accounts, or register on any official site.

**Why:** The author offered credentials, but none were given in the chat. Publishing is outward-facing and cannot be
undone (an npm version number, once used, is kept). The safe path is to prepare everything and give the exact commands
(see `use.md`, "For the maintainer").

---

## D9. Fix the Windows `npm pack` test rather than skipping it

**Decided:** The test calls `npm` through a shell on Windows.

**Why:** On Windows `npm` is `npm.cmd`, which `spawnSync` cannot run directly. The check was failing for a reason
that had nothing to do with the package. The test still checks the same things.

---

## D10. Keep the `.tmx` language

**Decided:** Keep `.tmx` as the small language for title films. Do not design a new language.

**Why:** It already exists, has themes, transitions, line-numbered errors with suggestions, and tests. A new language
would need a new parser, new docs, and new users to learn it. The request said "easy to use", and `.tmx` already is.
If a new language is wanted later, it should be a separate decision.

---

## D11. What is not in this version

- No cloud rendering service. TockMux renders on the user's machine, which keeps costs and privacy simple.
- No account system. The ElevenLabs keys stay in the user's own folder (`~/.tockmux`, owner-only).
- No public hosting of the Studio. It listens on 127.0.0.1 only.

Each of these can be a later decision, with its own reasons.

---

## Decisions added on 2026-10-24

### D12. `tockmux` with no arguments opens a numbered menu
**Why:** People who have never used a command line need a way to start without learning commands. Each menu item calls
an ordinary command, so the menu adds no new behaviour. The menu opens only in a real terminal; in a pipe or a log,
the old home screen is shown.

### D13. The menu uses one line reader for the whole session
**Why:** Piped input and pasted HTML were lost when each question opened and closed its own reader. One reader keeps
every line in order.

### D14. `demo` saves to the home folder when run from a drive root
**Why:** Windows blocks writes to drive roots such as `D:\` in many setups, so the demo failed for new users. Other
folders still use the current folder.

### D15. Create folders only when they do not already exist
**Why:** Node throws `EPERM` when asked to create a drive root, even though it exists. A shared helper,
`src/core/fs-util.js`, now checks first.

### D16. CI runs Node 20 and 22, on Windows and macOS
**Why:** The browser installer (Playwright) requires Node 20 or newer, so Node 18 failed at setup. Ubuntu was removed
from the matrix while the Windows and macOS results are checked.

### D17. Use an SVG favicon file for the landing page
**Why:** Browsers request `/favicon.ico` on their own. Serving a real icon file stops that request from returning an
error.

### D18. Publishing needs the author's own approval step
**Why:** npm requires two-factor authentication to publish. The author completes the code or browser approval
personally, so credentials never pass through the conversation.

### D19. Process notes are split by question
**Why:** One long file was hard to use. Each topic is now its own file: `what-and-why.md`, `how-it-works.md`,
`flow.md`, `functions.mvp`, `mvp.md`, `using-as-import.md`, and this log.
