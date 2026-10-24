# Changelog

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
