# START HERE

This folder is the complete TockMux 4.0.0 project. You do not need to read all of it. Do these in order:

## 1. See it work (5 minutes)

```bash
cd tockmux          # this folder
npm install
npx tockmux setup   # one time; skipped automatically if you have Chrome or Edge
npx tockmux demo    # makes tockmux-demo.mp4
```

Then try your own file: `npx tockmux check your-file.html` and `npx tockmux render your-file.html`.
Or `npx tockmux studio` for the drag-and-drop app.

## 2. Read the guides (in `docs/`)

| File | What it answers |
| --- | --- |
| `01-PROBLEM-AND-SOLUTION.md` | What problem this solves, how, what is unique (honestly), can ALL HTML become MP4, can it be an MCP |
| `02-SETUP-AND-USAGE.md` | Easy install and daily use, voice-over, `.tmx`, troubleshooting (Windows notes included) |
| `03-PUBLISH-AND-LAUNCH.md` | How to publish to npm, GitHub, host the landing page, list the MCP server, where to announce, checklist |
| `04-MCP.md` | Connect it to Claude Desktop / Claude Code / Cursor |
| `05-ARCHITECTURE-AND-SCALABILITY.md` | How it is built, whether it scales, limits, security, testing |
| `TEST-REPORT.md` | Every automated test, from a real run (182 passed) |

## 3. Before you publish

- Fill in `repository`, `homepage` and `bugs` in `package.json`.
- Test the ElevenLabs flow with a real key (it was only tested against a mock).
- Try the MCP server in Claude Desktop or Claude Code once.
- Follow the checklist at the bottom of `docs/03-PUBLISH-AND-LAUNCH.md`.

## Where things are

- `site/index.html` the landing page (one file; host it anywhere). Your Discord, **Spidey_Moon**, is on it.
- `studio/index.html` the drag-and-drop app (started by `tockmux studio`).
- `src/` the code. `test/` the 182 tests. `examples/` and `templates/` sample files.
- `Dockerfile` and `.github/workflows/` are provided but untested.
