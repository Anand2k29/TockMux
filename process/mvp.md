# MVP

## What the MVP is

The MVP (minimum viable product) is the smallest version of TockMux that someone can install, run on a real page,
and get a finished, good-looking video from, without reading the source code.

For TockMux the MVP is:

1. **Render:** turn one HTML animation (or one `.tmx` script) into an MP4, GIF or WebM, with the same output every time.
2. **Check:** tell the user, before a long render, whether the page will convert well.
3. **Watch:** re-render every time the file is saved, so editing is fast.
4. **Set up:** find or download a browser, and explain in plain English what is missing (`setup`, `doctor`).
5. **Be reachable:** one command (`tockmux mcp`) so an AI assistant can make the same video, and one import
   (`import { convert } from "tockmux"`) for developers.
6. **Be found:** a landing page that explains what it is, with a way to contact the author.

Everything else (voice-over, batch, Studio, presets, themes, the `.tmx` language, ElevenLabs) is already in the
package and is kept. It is useful, but the MVP is the path above.

## Why this is the MVP

A user who wants a video from a page needs the path from "I have an HTML file" to "I have an MP4 I can post" to work
on the first try. That needs four things, in this order:

| Need | Why it is required | Feature that covers it |
| --- | --- | --- |
| Confidence the output is right | Without it, nobody trusts the tool | Deterministic renderer, tested to the pixel |
| A short path to the first video | Otherwise people give up in setup | `setup`, `doctor`, `demo`, `init` |
| Fast iteration | Creators render many times while they edit | `render`, `check`, and the new `watch` |
| A way in for AI users and developers | This is where new demand comes from | `mcp`, library import |

Anything that does not serve one of these four needs is not in the MVP. That is why the ElevenLabs account pool, the
Studio and the `.tmx` language are kept but not the centre of the story.

## How it works

### The short version

1. You give TockMux an HTML file (or a `.tmx` script).
2. It reads the file and works out the size, length and frame rate from the file itself, or from flags.
3. It opens the page in a browser it controls, with a virtual clock.
4. For each frame it moves the clock by one frame, lets the page draw, takes a picture, and sends the picture to FFmpeg.
5. FFmpeg writes the video. Long videos are split into segments, rendered in parallel, and joined without re-encoding.
6. You get the file, and a summary.

### The parts

| Part | Job | Where |
| --- | --- | --- |
| Front doors | Read the command, or the MCP call, or the library call, or the Studio request | `src/cli/`, `src/mcp/`, `src/index.js`, `src/studio/` |
| Pipeline | Plan the job, then render it | `src/core/pipeline.js` |
| Settings | Decide size, fps, length, format from flags, the page's meta tags and the preset | `src/core/settings.js`, `src/core/presets.js` |
| Renderer | Open the page, control the clock, capture frames, run workers | `src/core/renderer.js`, `src/core/browser.js`, `src/core/clock-script.js` |
| Encoder | Turn frames into a video, add voice and music | `src/core/ffmpeg.js` |
| `.tmx` language | Turn a short script into an HTML page | `src/tmx/` |
| Voice | Generate narration with ElevenLabs accounts, fail over between them | `src/voice/` |
| Output for people | Colours, spinners, progress, plain-English errors | `src/cli/ui.js`, `src/errors.js` |

### The watch loop (new in this version)

```
save the file
   -> file watcher fires
   -> wait 300 ms (editors save twice)
   -> render (same convert() as "render")
        success -> print the file and the time taken
        error   -> print the error and the fix hint, keep watching
   -> if another save came in during the render, render once more
```

Ctrl+C stops the watcher.

## What is in the MVP today

- Render MP4, GIF, WebM. Presets for YouTube, HD, TikTok and Shorts (vertical), square, portrait, cinema (60 fps), 4K.
- Voice-over with `--voice`, `--auto-fit` (stretch the animation to the narration), music with `--music`, `--duck`.
- `check`, `frame` (poster image), `batch` (folders and wildcards), `sync` (add audio to an MP4), `probe`.
- `watch` (new): re-render on save.
- `setup`, `doctor`, `init`, `demo`, `presets`, `about`.
- `studio`: a local drag-and-drop web app.
- `mcp`: MCP server with seven tools (`check_html`, `render_video`, `snapshot_frame`, `compile_tmx`, `list_presets`,
  `probe_media`, `speak_text`), a prompt and a resource that teach the assistant how to write compatible HTML.
- The library `convert()` and the lower-level functions it uses.
- The landing page (`site/index.html`) and the docs.

## Not in the MVP, on purpose

- A cloud render service.
- Accounts or logins.
- A live browser preview that updates while you type (watch re-renders instead).
- A new language. `.tmx` is the small language.

## Next steps after the MVP (in order of value)

1. Publish to npm and GitHub, host the landing page, and register the MCP server (needs the author's credentials).
2. Make `watch` also survive editors that replace files on save (watch the folder, match by name).
3. Test the ElevenLabs narration with a real key.
4. Test on macOS and Linux.
5. A live preview in the Studio that uses the same watch loop.

## How success is measured

- A new user goes from `npm install -g tockmux` to a finished MP4 in under 5 minutes, with no reading beyond the README.
- The same page rendered twice gives the same file (checked by the tests).
- An assistant, given the MCP server, can produce a video from a one-line request without help.
- The test suite stays green on Windows, macOS and Linux.
