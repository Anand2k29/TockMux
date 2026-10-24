# Changelog

## 4.0.1

- Numbered menu: run `tockmux` with no arguments to pick a task by number (render a file, paste HTML, samples, watch, check, Studio, setup check, guide).
- `tockmux watch` re-renders on every save.
- `tockmux demo` saves to your home folder when run from a drive root (Windows blocks writes there).
- Fixed "EPERM" when writing into a drive root; folders are created only when missing.
- Landing page: SVG favicon (stops the /favicon.ico 500 error), longer guide, promo films.
- Contributing guide and a long README with an animated GIF.
- CI now runs on Node 20 and 22 (Playwright needs Node 20).

## 4.0.0

A ground-up rebuild. The renderer is new, so this is a major version.

- **Virtual clock renderer.** Timers, `requestAnimationFrame`, `Date`, `performance.now()`, CSS animations and
  transitions, Web Animations and `<video>` are all driven frame by frame. Any self-playing page now renders
  correctly, not only pages written for TockMux. Repeat renders are identical (seeded `Math.random`).
- **Parallel workers.** Long videos are split into segments that render in parallel and are joined losslessly.
- **Faster capture** through the DevTools protocol (about 45% faster than screenshots, identical pixels).
- **Voice-over auto-fit** stretches the animation (not just the audio) to the narration length; music loops, fades
  and can duck under speech.
- **ElevenLabs account pool** now reads real usage from the API, fails over on quota/invalid-key errors, splits long
  narration across accounts and stores keys privately (`~/.tockmux`, mode 0600) instead of in the project folder.
- **New commands:** `check`, `frame`, `batch`, `sync`, `probe`, `init`, `doctor`, `setup`, `studio`, `mcp`, `presets`.
- **Studio:** a drag-and-drop web app with live preview, progress and download.
- **MCP server** so Claude, Cursor and other assistants can check, preview and render videos.
- **Formats:** MP4, GIF and WebM. New presets: portrait, cinema (60 fps), 4K.
- **`.tmx` format:** real transitions, five themes, line-numbered error messages with suggestions.
- New landing page, redesigned CLI, 182 automated tests.

## 3.0.0

Initial public package (superseded).
