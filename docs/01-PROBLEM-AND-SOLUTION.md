# 1. The problem, the solution, and what makes TockMux different

## The problem

AI tools such as Claude can now write beautiful animated web pages: promo films, explainers, animated slides,
kinetic typography. They come out as a single `.html` file.

But **a web page is not a video**. You cannot post it on TikTok, YouTube or Instagram, put it in a PowerPoint,
or send it to a client who expects an MP4.

The usual workaround is a screen recorder. It fails in four ways:

| Failure | Why it happens |
| --- | --- |
| Stutter and dropped frames | The browser animates against the wall clock. If the computer is busy for a moment, the recorder captures whatever happened to be on screen. |
| Different every time | Two recordings of the same page are never identical. |
| Wrong size | The result depends on your window, your screen and your zoom level. |
| Manual voice-over sync | You export a silent video, then line up audio by hand in an editor. |

People who know this problem often build a one-off script (Playwright plus FFmpeg). It works for one file, then
breaks on the next page, because every page times itself differently.

## What is needed

A tool that:

1. Takes the HTML you **already have**, with no special rewriting.
2. Produces the same video on any computer, at any size, with no dropped frames.
3. Can be installed in minutes by a non-expert and tells them in plain English what to fix.
4. Handles the voice-over, because most promo videos need one.
5. Can be driven by people (command line, drag and drop) **and** by AI assistants.

## The solution: take control of time

A page can only look different from run to run because it reads the clock. TockMux replaces every clock the page
can see, **before the page loads**:

- `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`
- `Date`, `performance.now()`
- CSS animations and transitions, Web Animations, `<video>` (seeked explicitly)
- `Math.random` (seeded, so randomness repeats)

Then, for every frame of the video, TockMux:

1. advances the virtual clock by exactly one frame (1/30 s by default),
2. lets the page react (timers fire in order, animation callbacks run),
3. takes a screenshot through the browser's debugging protocol,
4. pipes it into FFmpeg.

Time only moves when TockMux says so. A slow computer takes longer, but the frames are the same. You can prove it
with the test suite in this package: it renders a square moving at 100 px per second and checks, to the pixel, that
frame 10 shows it at x = 100, using five different ways of animating.

Long videos are split into segments that render in parallel (each worker fast-forwards its own clock to its starting
frame) and are joined without re-encoding.

## How it helps, concretely

| You want to | Before | With TockMux |
| --- | --- | --- |
| Post a Claude-made animation on TikTok | Screen record, crop, hope | `tockmux render promo.html --preset tiktok` |
| Add a voice-over | Edit by hand in CapCut/DaVinci | `--voice narration.mp3 --auto-fit` stretches the animation to the voice |
| Know if a page will work | Render for minutes, find out it is a still image | `tockmux check promo.html` in seconds |
| Make 40 videos | 40 manual recordings | `tockmux batch ./slides --out-dir ./videos` |
| Let an AI do the whole job | Not possible | MCP server: the AI writes HTML, previews frames, renders the MP4 |
| Share the setup with a team | Long README of manual steps | `npm install -g tockmux` |

## What is unique, honestly

TockMux is **not the first** tool that turns HTML into video. Know the landscape before you launch:

- **HyperFrames (by HeyGen, open source)** is the most prominent: an HTML-to-video framework aimed at AI agents.
  It has its own authoring conventions for compositions.
- **timecut / puppeteer-capture** are older open-source libraries that capture frames from a browser.
- **Remotion** makes video from React components (you write React, not plain HTML).
- Screen recorders and browser extensions (not deterministic).

What TockMux does that is a **useful difference**, not a magic one:

1. **Bring the HTML you already have.** A plain page with CSS, `requestAnimationFrame`, GSAP, canvas or SVG renders as
   it is. You do not adopt a framework or add special attributes. (It still helps to declare a duration.)
2. **Voice-over fit that stretches the animation, not just the audio.** `--auto-fit` changes the page's own timeline
   to match the narration length, because the clock is virtual.
3. **A pre-flight check** that actually opens the page and tells you "this would be a still image", "this image
   failed to load", "this wide content will be cropped" before you wait for a render.
4. **Small and easy.** 22 npm packages, a package of about 100 KB, one command to install, `tockmux doctor` to diagnose,
   plain-English errors. Uses your own Chrome/Edge if you have it.
5. **One engine, four ways in:** command line, drag-and-drop Studio, a library, and an MCP server.
6. **ElevenLabs account pool with failover** and private key storage (see the voice notes below).

Position it as: *"Convert the HTML you already have into a video, with the voice-over fitted, from one command."*
Do **not** claim it is the first, the only, or the fastest. In this sandbox (1 CPU core) it renders about 8 to 25
frames per second depending on page complexity. You have not benchmarked it against the others, and neither have I.

## Frequently asked questions

### Can we convert ALL HTML files into MP4 with this?

**No, and the package says so honestly.** It converts any HTML page that *plays by itself over time*.

A video has a timeline. A page that only changes when someone clicks, scrolls, hovers or types has no timeline.

| Page type | Result |
| --- | --- |
| CSS animation, JS timelines, GSAP, anime.js, Lottie, canvas, SVG, timed slide decks | Works as it is |
| Needs one click to start | Works with `--start "#button"` (a `#go`/`#play`/`#start` button is guessed and clicked automatically) |
| Long static page (article, landing page) | Works as a gentle scroll with `--recipe autoscroll` |
| 3D / WebGL | Works, slower (software drawing) |
| Embedded `<video>` | Works for WebM; H.264 needs Google Chrome via `--browser`; the clip's sound is not captured |
| Needs a person to interact during the video (games, forms, quizzes) | Does not work |
| YouTube / Netflix / DRM embeds | Does not work, and must not be circumvented |
| Pages behind a login or bot protection | Does not work. Convert files you own and can open locally |
| Sound produced by the page | Not captured. Pass `--voice` / `--music` files instead |

`tockmux check file.html` tells you which row your file falls into.

### Can we make an MCP of this?

**Yes, it is built in and tested.** `tockmux mcp` starts an MCP server over stdio. It exposes seven tools
(`check_html`, `render_video`, `snapshot_frame`, `compile_tmx`, `list_presets`, `probe_media`, `speak_text`), a prompt
that teaches the AI how to write compatible HTML, and a resource with the rules. It was tested against the official
MCP SDK client. See `docs/04-MCP.md`.

### Is it safe to run other people's HTML?

Locally, you are running files you chose, in a browser, like opening them in Chrome. Studio only listens on your own
computer (127.0.0.1), rejects other Host/Origin headers and blocks path traversal. **If you ever host this as a public
web service**, treat uploaded HTML as hostile: run each job in a container with no network access to internal systems
and strict CPU/time limits. This package does not do that for you.

### About the ElevenLabs "account rotator"

The account pool now reads real usage from the API, fails over on quota and invalid-key errors, and keeps keys in a
private file. **Be careful how you describe it.** Using several keys that belong to you or your team is fine.
Creating many free accounts to get around ElevenLabs' free-tier limits can violate its terms and get the accounts
banned, so this guide and the landing page do not advertise that. Describe it as "multiple accounts with automatic
failover". It was tested against a mock server that imitates the documented API; it was **not** tested against the
live ElevenLabs service, because the sandbox has no access to it. Please test with a real key before announcing it.
