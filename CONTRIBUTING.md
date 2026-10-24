# Contributing to TockMux

Thank you for wanting to help. TockMux is a small project with one clear job: turn an HTML animation into a
frame-perfect video. To keep it reliable, the project accepts changes that are **needed, tested, and within the
licence**. This guide explains what that means in practice.

Please read the whole guide before opening a pull request. It takes about five minutes.

---

## 1. What we accept

| Accepted | Not accepted (for now) |
| --- | --- |
| A bug fix with a test that failed before the fix | Large refactors with no bug or feature behind them |
| A new `.tmx` element, theme or transition, with a test and a documented example | Changes that only reformat code or rename things |
| A clear improvement to the CLI, the menu or the error messages | A new dependency for something the code can already do |
| Documentation fixes, typos and better examples | Code copied from a project with an incompatible licence |
| Support for a new platform, with tests that run on it | Features that need a paid account or a private service |
| A new voice provider behind the same interface as ElevenLabs | Anything that helps get around a provider's terms or limits |

If you are not sure whether something fits, **open an issue first** and describe the problem. A short discussion
saves everyone time.

---

## 2. Legal and licence rules

These rules are required. A pull request that breaks them will be closed.

1. **Only send code you wrote, or code you are allowed to contribute.** Check that the code is not copied from another
   project unless that project's licence allows it and you keep its notice.
2. **TockMux is MIT licensed.** By sending a pull request you agree that your change is released under the same MIT
   licence. You keep your copyright; you give everyone the right to use the change.
3. **Do not send secrets.** API keys, tokens, passwords, personal data and private recordings must never appear in a
   commit, a test fixture or a screenshot. If one is committed by mistake, tell the maintainer straight away so it can
   be removed and rotated.
4. **Respect third-party services.** Do not add code that downloads paid content, removes watermarks or DRM, or gets
   around a service's limits. TockMux must not be used to bypass protection on YouTube, Netflix or similar.
5. **Use the Code of Conduct spirit.** Be respectful in issues, reviews and chat. Harassment and personal attacks are
   not welcome.

---

## 3. Before you start

You need:

- **Node.js 18.17 or newer** (check with `node -v`)
- **Git**
- A browser for the tests. Run `npx tockmux setup` once, or set `TOCKMUX_BROWSER` to the path of Chrome or Chromium.
- FFmpeg is bundled through `ffmpeg-static`. Nothing else is needed.

```bash
git clone https://github.com/Anand2k29/TockMux.git
cd TockMux
npm install
npx tockmux doctor        # checks the setup
```

---

## 4. Run the tests

```bash
npm test                  # every test, including the ones that render real video (a few minutes)
npm run test:fast         # quick tests only, no video rendering
```

- Tests whose names start with `[render]` draw real video in a real browser. They skip themselves politely when no
  browser is found.
- All tests must pass before a pull request is merged.
- On Windows, test paths must work with spaces in the folder name. Use `ROOT` from `test/helpers.js`, not hand-built
  paths.

---

## 5. Make a change

1. **Make a branch** with a short name that says what it does:

   ```bash
   git checkout -b fix-watch-on-rename
   ```

2. **Write the change.** Keep it small. One pull request should do one thing.
3. **Add a test** for any behaviour you change. A bug fix needs a test that would have failed before the fix.
4. **Run the tests** and make sure they pass.
5. **Check the docs.** If you change a command, a flag or a behaviour, update `README.md` and the matching file in
   `docs/` or `process/`.
6. **Commit with a clear message.** The first line says what changed, in the present tense, under about 70 characters.
   The body explains why, if that is not obvious.

   ```
   Fix watch command on editors that replace files on save

   Some editors delete and recreate the file when saving, so the watcher lost it.
   Watch the folder and filter by file name instead.
   ```

7. **Push and open a pull request** against `main`. Fill in the template below.

### Pull request template

```
## What this changes
One or two sentences.

## Why
The problem, or the issue number this fixes.

## How it was tested
The commands you ran and what they showed.

## Checklist
- [ ] Tests added or updated, and all tests pass (npm test)
- [ ] README, docs or process notes updated if behaviour changed
- [ ] No secrets, keys or private files in this change
- [ ] I wrote this code, or I am allowed to contribute it under the MIT licence
```

---

## 6. Code style

- **Match the code around your change.** Same naming, same comment density, same way of handling errors.
- **Plain language in messages.** Errors should say what went wrong and how to fix it. Use `TockError` with a `hint`.
- **No new dependency** unless the change cannot be done without it. Explain why in the pull request.
- **Keep the terminal friendly.** Colours must respect `NO_COLOR` and `--no-color`. Animations must not break in a
  plain log or a pipe.
- **Keep the landing page static.** `site/index.html` is one file with no build step.

---

## 7. Where things live

| Folder or file | What it holds |
| --- | --- |
| `bin/tockmux.js` | The command you type |
| `src/cli` | Argument parser, terminal UI, the menu and one file per group of commands |
| `src/core` | Virtual clock, renderer, FFmpeg helpers, settings, pre-flight checks, the pipeline |
| `src/tmx` | The `.tmx` parser, compiler and themes |
| `src/voice` | ElevenLabs client, account store and the failover pool |
| `src/studio` | The local web server and job queue for Studio |
| `src/mcp` | The MCP server |
| `studio/` | The Studio web page |
| `site/` | The landing page (one static file) |
| `docs/` | Guides for people who use TockMux |
| `process/` | Notes on how TockMux was built: decisions, MVP, functions, flow and usage |
| `examples/`, `templates/` | Sample pages and films |
| `test/` | The automated tests |

Read [`process/functions.mvp`](process/functions.mvp) before a larger change. It shows which function calls which.

---

## 8. Ideas that would help most

- A Windows, macOS and Linux CI run (`.github/workflows/ci.yml` is a start)
- A Docker image that renders without a desktop
- More `.tmx` elements and themes, each with an example
- Tests for the menu flows (paste, sample and random pick)
- A second voice provider behind the same `synthesize` interface as ElevenLabs
- Better detection of pages that need a click to start

---

## 9. Reporting a problem

Open an issue on GitHub and include:

- What you ran, copied exactly
- What you expected and what happened
- Your operating system, Node version (`node -v`) and TockMux version (`tockmux --version`)
- The output of `tockmux doctor`
- A small HTML page that shows the problem, if you can share one

Do not attach private files, keys or recordings you do not have the right to share.

---

## 10. Questions

Ask on Discord: **Spidey_Moon**. For code questions, open an issue or a discussion on GitHub.
