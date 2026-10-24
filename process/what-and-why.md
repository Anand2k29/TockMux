# What TockMux is, and why it works

## What it is

TockMux is a program that turns a web page that moves by itself into a video file: MP4, GIF or WebM.

You give it an HTML file. It opens the page in a browser it controls, draws the page one frame at a time, and joins
the frames into a video. The output is the same every time you render the same page.

It is:

- **a command-line tool**, run with `tockmux render my.html`
- **a numbered menu**, opened by typing `tockmux` on its own
- **a JavaScript library**, used with `import { convert } from "tockmux"`
- **a small title-film language** called `.tmx`, for films made of text and bars without HTML
- **an MCP server**, so an AI assistant can make videos through a standard protocol
- **a local drag-and-drop app**, started with `tockmux studio`

It is not a screen recorder, a video editor, or a hosted service. Everything runs on your own computer.

## Why it exists

An animated web page is easy to make now, for example with an AI tool. A web page is not a video, though. You cannot
post it to TikTok, drop it into a presentation, or send it to a client who expects an MP4.

The usual fix is a screen recording, and it has four problems:

1. **It stutters.** The browser moves on the wall clock. A busy computer drops frames.
2. **It is different every time.** Two recordings of the same page never match.
3. **It is the wrong size.** The result depends on the window, the screen and the zoom.
4. **The voice is out of sync.** The narration is lined up by hand in an editor.

## Why it works

A page can only look different from one run to the next because it reads the clock. Timers, animation frames, `Date`,
`performance.now()`, CSS animations and `Math.random` all depend on time or chance.

TockMux replaces those clocks before the page loads. Time then moves only when TockMux says so. For each frame it
advances the clock by exactly one frame, lets the page react, takes a picture, and gives the picture to FFmpeg.
Because nothing depends on the real clock, the same input gives the same frames.

A few things follow from that:

- **A slow computer takes longer, but the output is the same.** The frames do not depend on how fast the machine is.
- **Voice-over can stretch the animation.** The clock is virtual, so `--auto-fit` can make the page's own timeline
  fit the narration.
- **The tests can check exact pixels.** The test suite renders a square moving at a known speed and checks where it
  is at frame 10, to the pixel.

## What it does not do

- Pages that wait for a person to click, type or log in cannot be recorded without help (`--start` covers a single
  click at the start).
- Sound made by the page is not captured. Pass `--voice` or `--music` files instead.
- DRM-protected embeds such as YouTube or Netflix are out of scope and must not be circumvented.
