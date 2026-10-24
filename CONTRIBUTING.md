# Contributing to TockMux

1. Clone the repository and run `npm install`.
2. Install a browser once: `npx tockmux setup` (or set `TOCKMUX_BROWSER` to a Chrome/Chromium path).
3. Run the tests: `npm test`.
   - `npm run test:fast` skips the tests that render real video (skips the tests that need a browser).
   - Tests that need a browser are named `[render]` and skip themselves politely when none is found.
4. Open a pull request. Please add a test for any behaviour you change.

## Where things live

| Folder | What it holds |
| --- | --- |
| `src/core` | Virtual clock, renderer, FFmpeg helpers, settings, pre-flight checks |
| `src/tmx` | The `.tmx` parser, compiler and themes |
| `src/voice` | ElevenLabs client, account store, failover pool |
| `src/cli` | Argument parser, terminal UI, one file per group of commands |
| `src/studio` | Local web server and job queue (`studio/` holds the web page) |
| `src/mcp` | The MCP server |
| `site/` | The marketing landing page (a single static file) |
| `docs/` | Guides |

Ideas that would help most: more voice providers (implement `synthesize` in `src/voice`), a Docker image,
Windows CI, more `.tmx` elements.
