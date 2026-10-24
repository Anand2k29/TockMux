# Contributing to TockMux

Thank you for wanting to help. TockMux turns an HTML animation into a frame-perfect video. Every contribution should
make that simpler, more reliable, or easier to use.

This guide covers three things:

1. [How to contribute, step by step](#how-to-contribute-step-by-step)
2. [What we need help with right now](#what-we-need-help-with-right-now)
3. [Rules every contribution follows](#rules-every-contribution-follows)

---

## How to contribute, step by step

There are four ways to help. Pick the one that fits.

| You want to | Do this |
| --- | --- |
| Report a bug | Open an issue with the **Bug report** template |
| Suggest a feature | Open an issue with the **Feature request** template |
| Add support for a platform (macOS, Linux) | Open an issue with the **Platform support** template, then send a pull request |
| Change the code or the docs | Fork the repository, make a branch, and send a pull request |

### 1. Set up

```bash
git clone https://github.com/Anand2k29/TockMux.git
cd TockMux
npm install
npx tockmux doctor        # checks Node, FFmpeg and the browser
npx tockmux setup         # downloads the browser for the tests, once
```

You need **Node.js 20 or newer** (the browser installer requires it), and Git.

### 2. Make a branch

Use a short name that says what the change does:

```bash
git checkout -b fix-watch-on-rename
```

### 3. Make the change

- Keep one pull request to one purpose.
- Match the code around your change: naming, comments, error messages.
- Add a test for any behaviour you change. A bug fix needs a test that fails before the fix.
- If you change a command, a flag, or the menu, update `README.md` and `CHANGELOG.md`.

### 4. Run the tests

```bash
npm test                  # the full suite, including real renders (a few minutes)
npm run test:fast         # quick tests only, no rendering
```

Every test must pass. Tests named `[render]` need a browser, and skip themselves when none is found.

### 5. Commit

Write a short message in the present tense. The first line says what changed, and the body says why if that is not
obvious:

```
Fix watch on editors that replace the file on save

Some editors delete and recreate the file, so the watcher lost it.
Watch the folder and match the file name instead.
```

### 6. Open a pull request

Push your branch and open a pull request against `main`. Fill in the template. A maintainer will review it. Please
be patient: reviews may take a few days.

#### Pull request template

```
## What this changes
One or two sentences.

## Why
The problem, or the issue number it fixes (for example "Fixes #12").

## How I tested it
The commands I ran and what they showed.

## Checklist
- [ ] Tests added or updated, and `npm test` passes
- [ ] README and CHANGELOG updated if the behaviour changed
- [ ] No keys, tokens, personal data or private files in this change
- [ ] I wrote this code, or I am allowed to contribute it under the MIT licence
```

---

## What we need help with right now

These are the areas where help matters most. If you want to work on one, comment on its issue first so two people do
not work on the same thing.

| Area | What is needed | Good for |
| --- | --- | --- |
| **macOS support** | Run the test suite on macOS, fix what breaks, and add the macOS browser paths to `src/core/browser.js` | People with a Mac |
| **Linux support** | Run the tests on Linux (Ubuntu, Fedora), fix what breaks, and document the FFmpeg and browser setup | People who use Linux |
| **Continuous integration** | Keep the GitHub Actions workflow green on each platform | Anyone comfortable with CI |
| **Docker image** | A small image that can render without a desktop | DevOps and server users |
| **Title-film elements** | New `.tmx` elements, themes and transitions, each with an example and a test | Designers and motion people |
| **Voice providers** | A second voice service behind the same interface as ElevenLabs (`src/voice`) | Anyone who uses other voice tools |
| **Documentation** | Clearer examples, translations, and fixes to any unclear step | Anyone who found a step hard |
| **Examples** | Sample HTML animations that show a feature well | Creators and designers |

### Feature ideas people have asked for

- A live preview in Studio that updates while you type
- A GitHub Action that renders a video on each release
- A "pick a template" gallery in the menu
- Automatic captions from a text file

Have another idea? Open a feature request. Please describe the problem first, then the idea.

---

## Rules every contribution follows

These rules are required. A pull request that breaks them will be closed.

1. **Only send code you wrote, or code you are allowed to contribute.** If you copy from another project, its licence
   must allow it, and you must keep its notice.
2. **TockMux is MIT licensed.** By contributing, you agree that your change is released under the MIT licence. You keep
   your copyright.
3. **Never send secrets.** API keys, tokens, passwords, personal data and private recordings must not appear in code,
   tests, screenshots or commit messages. If one slips in, tell a maintainer straight away so it can be removed and the
   key rotated.
4. **Respect third-party services.** Do not add code that removes DRM or watermarks, downloads paid content, or gets
   around a provider's limits or terms.
5. **Be respectful.** Keep issues, reviews and chat constructive. Harassment is not welcome.

## Where things live

| Folder or file | What it holds |
| --- | --- |
| `bin/tockmux.js` | The command you type |
| `src/cli` | The argument parser, terminal UI, the numbered menu, one file per command group |
| `src/core` | The virtual clock, renderer, FFmpeg helpers, settings, checks, and the pipeline |
| `src/tmx` | The `.tmx` parser, compiler and themes |
| `src/voice` | The ElevenLabs client, account store and failover pool |
| `src/studio`, `studio/` | The Studio server and its web page |
| `src/mcp` | The MCP server |
| `site/` | The landing page (one static file) |
| `docs/` | Guides for people who use TockMux |
| `test/` | The automated tests |

## Questions

Ask on Discord: **Spidey_Moon**. For code questions, open an issue. Thank you for helping make TockMux better.
