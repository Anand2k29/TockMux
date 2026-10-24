# 5. How it is built, whether it scales, and where it stops

## Module map

```
bin/tockmux.js            thin entry point
src/cli/                  argument parser, terminal UI, one file per group of commands
src/core/
  clock-script.js         the virtual clock injected into the page      <- the key idea
  renderer.js             frame capture, parallel workers, encode, mux  <- the engine
  pipeline.js             plan -> narrate -> render: ONE code path used by CLI, Studio, MCP and the library
  settings.js             precedence: flag > preset > file meta > default
  preflight.js            the `check` report
  html-inspect.js         reads <meta> contract and detects features without a browser
  browser.js              finds Chromium/Chrome/Edge, installs Chromium, launch flags
  ffmpeg.js               streaming encoder, probing, concat, mux/GIF/WebM argument builders
  static-server.js        serves the page over http://127.0.0.1 (relative files, fetch, ES modules)
src/tmx/                  .tmx parser (line-numbered diagnostics), compiler, themes
src/voice/                ElevenLabs client, private key store, failover pool
src/studio/               local web server + job queue (UI in studio/index.html)
src/mcp/server.js         dependency-free MCP server
site/index.html           landing page
```

Design rules that keep it maintainable:

- **One code path.** `convert()` is the only place that plans and renders. The CLI, Studio, MCP server and the library
  all call it, so a fix or feature lands everywhere at once. (The previous version had separate logic per entry point.)
- **No dependencies you can avoid.** Two runtime dependencies (`playwright-core`, `ffmpeg-static`), 22 packages in
  total. The argument parser, terminal UI, static server, job queue and MCP server are small and dependency-free.
- **Errors are for humans.** `TockError` carries a hint; the CLI prints it without a stack trace; `--json` returns it
  as data.

## Data flow of one render

```
file.html / file.tmx
   |  planJob(): read, inspect <meta>, resolve settings, (detect duration), find audio
   v
static server (127.0.0.1) ---> Chromium page(s)  [virtual clock injected before any page script]
                                   |  for each frame:  stepTo(t) -> screenshot via DevTools protocol
                                   v
                               FFmpeg (one per worker, fed through a pipe, H.264)
                                   v
                    segment_0.mp4 ... segment_n.mp4 --concat (no re-encode)--> joined.mp4
                                   v
              mux voice/music (video copied, audio padded/trimmed to exact length)
                                   v
              write to  name.partial.mp4  then rename  (a crash never leaves a half file)
```

## Is it scalable?

The honest answer: **it scales on one machine, and it has clear recipes for more, but I only measured one core.**

### What was wrong before

The first version was a single process that rendered every frame in sequence, assumed pages expose a special
`__seek` function (so ordinary JavaScript animations rendered as a frozen first frame), parsed options it never used
(`click`, `autoscroll`, `transition`), stored API keys in the project folder, and its "tests" and demo simulated
success instead of rendering. That was not a foundation to scale.

### What was changed

| Concern | Now |
| --- | --- |
| Correctness on any self-playing page | Virtual clock for timers, rAF, `Date`, `performance.now`, CSS/Web Animations, `<video>`, seeded `Math.random` |
| Speed on multi-core | `--workers N`: the frame range is split into segments, each in its own browser page. A worker fast-forwards its clock (about 5 ms per skipped frame) to its start frame. Segments are joined without re-encoding. Automatic default: half your cores, at most 4, and 1 for short videos |
| Memory | Frames stream through a pipe into FFmpeg and are never stored. Memory does not grow with video length |
| Capture cost | DevTools-protocol capture with `optimizeForSpeed`: measured ~45% faster than `page.screenshot`, pixel-identical |
| Many jobs | `batch` command; Studio queue (one render at a time by default, the rest wait; cancellable; finished jobs expire after 30 minutes) |
| Resilience | Atomic output (temp name, then rename); cancel via AbortSignal kills FFmpeg and cleans temp files |
| Reuse | `import { convert } from "tockmux"` for your own servers and scripts |

### Measured numbers (this environment: 1 CPU core, software rendering, so treat as pessimistic)

| What | Result |
| --- | --- |
| Virtual clock step | about 5 ms per frame |
| Screenshot, 1280x720, effect-heavy page | PNG via Playwright about 125 ms; via DevTools `optimizeForSpeed` about 70 ms |
| Bundled demo, 180 frames at 720p | 43 s before the capture change, about 22 s after |
| Small 320x180 pages | about 23 frames per second |
| Install | 22 packages, about 4 s; tarball about 100 KB |

**Not measured:** speed-up from `--workers` on a real multi-core machine (the sandbox has one core). Correctness with
2 and 3 workers is tested (the output matches a 1-worker render at PSNR above 38 dB and lands on the exact frame), but
please benchmark `--workers 1` against `--workers 4` on your own computer before quoting a speed-up.

### Where it stops (know these before you promise anything)

1. **CPU-bound on one machine.** Throughput is roughly (cores / cost per frame). 4K is about 4 times slower than 1080p.
2. **Diminishing returns on very long videos.** Each worker replays the clock from frame 0 to its start, so a worker
   starting at the end of a 1-hour 30 fps video skips about 100,000 frames (several minutes) before it draws anything.
   Splitting into more than about 4 workers rarely helps. Hours-long videos are not a target. (Duration is capped at 3600 s.)
3. **Memory per worker.** Each worker is a Chromium page; budget a few hundred MB each. Measure on your machine.
4. **Things the virtual clock does not control:** Web Workers, cross-origin iframes, Web Audio, `Event.timeStamp`,
   `document.timeline.currentTime`, network timing, GPU/WebGL differences between machines. Pages that depend on them
   can differ between runs. JS-created CSS animations are discovered at the next frame (at most one frame late).
5. **WebGL** uses software drawing, which is slower.
6. **Audio inside the page is not captured**, by design.
7. **One machine.** There is no built-in distributed mode.

### Scaling beyond one machine (a recipe, **untested**)

`--from` and `--to` render a part of a video. You could render parts on several machines with identical settings and join
them with `ffmpeg -f concat -c copy`, then add audio. Each part replays the clock from 0, so see point 2. For a hosted
service, put `tockmux render` behind a queue (BullMQ, SQS, Cloud Tasks) with one container per job (`Dockerfile`
included, also untested), and **sandbox every job** (see below).

## Security model

- **CLI and Studio are local.** Studio listens on 127.0.0.1 only, rejects any Host header that is not
  `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding defence), rejects cross-origin POSTs, never returns server
  file paths to the browser, limits uploads (250 MB), refuses unsafe upload names (`..`, absolute paths, drive letters),
  and serves the compiled preview inside a sandboxed iframe. All of this has automated tests.
- **The page you render runs JavaScript** in headless Chromium with network access, like opening it in Chrome. Only
  render files you trust. A public conversion website must run each job in a container with no access to internal
  networks and with CPU, memory and time limits. TockMux does not provide that.
- **MCP is folder-scoped** (`--root`), so an assistant cannot read or write elsewhere.
- **API keys** live in `~/.tockmux/voice.json`, owner-only permissions on macOS/Linux, are masked in every output,
  and are never sent anywhere except the provider's API. On Windows the file inherits your user folder's permissions.

## Testing

`npm test` runs 182 automated tests in about two minutes on one CPU core (`npm run test:fast` runs the 118 that do not need a browser, in about 8 seconds):

| Area | What is proven |
| --- | --- |
| Rendering | Five animation styles (rAF, CSS, intervals, `Date`, `performance.now`) land on the exact frame, to the pixel; exact frame counts; identical repeat renders; 1, 2 and 3 workers agree; a worker starting mid-video fast-forwards timers and CSS correctly |
| Page features | Click-to-start (declared, guessed, disabled), autoscroll, WebM `<video>`, ES modules and `fetch` over http, missing-asset and script-error reports, duration detection |
| Outputs | MP4, GIF, WebM, `--from/--to`, odd sizes, JPEG fast mode, cancel, no partial files |
| Audio | Voice mix length, auto-fit maths (3 s voice on a 2 s animation: stretch 1.5, square position checked), music loop, and ducking (music measured 5 dB quieter under the voice), `.tmx` voice/tts |
| Voice pool | Mock ElevenLabs server: usage refresh, failover on quota exhaustion, invalid key, rate limit, chunk splitting across accounts, error messages, private storage |
| CLI | Every command, exit codes, `--json`, typo suggestions, no stack traces, no colour codes when piped |
| Studio | Security cases, SSE progress, download and range requests, queue and cancel, plus a real browser driving the UI |
| MCP | Official SDK client: handshake, all tools, images, progress, path restrictions, errors |
| Packaging | `npm pack` contents, clean-room install from the tarball in an empty folder and a global prefix, then `demo` |

**Not tested** (no access from the build environment): the live ElevenLabs API, Claude Desktop / Cursor / Claude Code
as MCP clients, Windows and macOS (the code uses portable APIs and has Windows-specific path and console handling, but
it ran only on Linux), Docker, the GitHub workflows, and the landing page's Google Fonts (blocked in the sandbox, so
fallback fonts were reviewed). The CI workflow will cover Windows and macOS once you push.
