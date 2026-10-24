# How TockMux works, step by step

This page follows one render from start to finish. For the function-by-function view, read `functions.mvp`. For the
diagrams, read `flow.md`.

## The short version

1. TockMux reads your file and works out the size, the length and the frame rate.
2. It opens the page in a headless browser, with a virtual clock injected before the page loads.
3. For each frame, it moves the clock forward by one frame and captures the picture.
4. The pictures go to FFmpeg, which writes the video. Long videos are split into parts, rendered in parallel, and
   joined without re-encoding.

## The steps in detail

### 1. Read the input

- An `.html` file is read and inspected for `<meta name="html2mp4:...">` tags and CSS animation lengths.
- A `.tmx` file is parsed. Errors are reported with the line number and a suggestion. Then it is compiled into HTML.

### 2. Decide the settings

Each setting takes the first value that is set, in this order:

1. the flag you typed (for example `--duration 12`)
2. a meta tag in the file
3. the preset (for example `--preset tiktok`)
4. a length detected from CSS animations
5. the default (10 seconds, 1920x1080, 30 frames per second)

The summary shows where each value came from, so you can see why a video is the length it is.

### 3. Control the clock

Before the page loads, TockMux injects a script that replaces the clocks the page can read: timers,
`requestAnimationFrame`, `Date`, `performance.now()`, CSS animation timing, and `<video>` playback. Randomness is
seeded, so `Math.random` gives the same numbers each run.

### 4. Draw the frames

For each frame:

1. advance the virtual clock by one frame (1/30 of a second at the default rate)
2. let the page react (timers fire, animation callbacks run)
3. capture the picture through the browser's debugging protocol
4. send the picture to FFmpeg

Each parallel worker starts its own page and moves its clock forward to its first frame, so every worker produces the
same frames as a single worker would.

### 5. Encode the video

FFmpeg joins the parts without re-encoding. If you added a voice-over, it is mixed in, and `--auto-fit` has already
stretched the animation to match its length. GIF and WebM use their own encoder settings.

### 6. Report the result

The output file, its size, its length and the time taken are printed. Warnings appear as plain sentences, for example
"every frame is identical, so the video is a still image".

## Where the work happens

| Stage | File |
| --- | --- |
| Read and check the file | `src/core/pipeline.js`, `src/core/html-inspect.js`, `src/tmx/` |
| Decide the settings | `src/core/settings.js`, `src/core/presets.js` |
| Control the clock and draw frames | `src/core/clock-script.js`, `src/core/renderer.js`, `src/core/browser.js` |
| Encode | `src/core/ffmpeg.js` |
| Voice | `src/voice/` |
| Show progress and errors | `src/cli/ui.js`, `src/errors.js` |
