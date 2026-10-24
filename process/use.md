# How to use TockMux

TockMux turns a web page that animates by itself into a video file. This guide covers how to install it, every
main way to use it, and what each case looks like.

---

## 1. Install (once)

You need **Node.js 18 or newer** (check with `node -v`).

```bash
npm install -g tockmux
tockmux setup
```

- `setup` downloads the browser TockMux draws with (about 150 MB). It is skipped if you already have Chrome or Edge.
- Not sure everything works? Run `tockmux doctor`. It checks Node, FFmpeg and the browser and says what to fix.
- Do not want to install it? Put `npx` in front of any command: `npx tockmux render my.html`.

Try the sample first:

```bash
tockmux demo
```

It writes `tockmux-demo.mp4` so you can see a finished video before using your own file.

---

## 2. The five commands most people use

```bash
tockmux render my.html              # make my.mp4 next to the file
tockmux watch  my.html              # make it again every time I save
tockmux check  my.html              # will it convert well? (fast, before a long render)
tockmux frame  my.html --at 3s      # save one frame as a poster image
tockmux batch  ./slides --out-dir ./videos   # render a whole folder
```

Every command accepts `--help` (for example `tockmux watch --help`) and `--json` (for scripts).

---

## 3. Make your HTML work well (optional, but helpful)

Add these to the `<head>` of your page. Without them TockMux uses 1920x1080, 30 fps, and tries to find the length from
your CSS animations.

```html
<meta name="html2mp4:duration" content="12">    <!-- seconds to record -->
<meta name="html2mp4:width"    content="1920">
<meta name="html2mp4:height"   content="1080">
<meta name="html2mp4:start"    content="#go">   <!-- only if a button must be clicked at the start -->
```

A button with the id `go`, `play` or `start` is clicked at 0 seconds automatically. TockMux tells you when it guesses.
Turn that off with `--start none`.

### What works

| Works as it is | Needs one option | Does not work |
| --- | --- | --- |
| CSS animations and transitions | Click to start: `--start "#play"` | Pages that need a person to click, type or play during the video |
| `requestAnimationFrame`, `setTimeout`, `setInterval` | Long static page: `--recipe autoscroll` | YouTube, Netflix and other DRM embeds |
| GSAP, anime.js, Lottie | WebGL and three.js (works, slower) | Pages behind a login |
| Canvas and SVG | `<video>` (WebM works best) | Sound made by the page (use `--voice` or `--music`) |
| Pages using `Math.random` (made repeatable) | | |

Not sure? Run `tockmux check my.html`.

---

## 4. Every case

### Case A: a video for social media

```bash
tockmux render promo.html --preset tiktok           # 1080x1920, for TikTok, Shorts and Reels
tockmux render promo.html --preset youtube          # 1920x1080
tockmux render promo.html --preset square           # for Instagram posts
tockmux render promo.html --preset cinema           # 60 fps, smoother motion
```

Run `tockmux presets` to see every size.

### Case B: a voice-over that the animation follows

```bash
tockmux render promo.html --voice narration.mp3 --auto-fit
```

`--auto-fit` stretches the animation itself to the length of the narration, so the words and the motion finish
together.

Add music too, and let it dip while the voice speaks:

```bash
tockmux render promo.html --voice narration.mp3 --music bg.mp3 --duck
```

### Case C: add audio to a video you already have

```bash
tockmux sync promo.mp4 narration.mp3 --stretch -o final.mp4
```

### Case D: a GIF or WebM instead of an MP4

```bash
tockmux render my.html --format gif
tockmux render my.html --format webm
```

### Case E: a poster image for a thumbnail

```bash
tockmux frame my.html --at 3s -o poster.png
```

### Case F: iterate fast while you edit

```bash
tockmux watch my.html
```

Save the file in your editor. TockMux renders again and shows how long it took. A typo shows a plain message and a
fix, and the watch keeps going. Press **Ctrl+C** to stop.

### Case G: many files at once

```bash
tockmux batch ./slides --out-dir ./videos
tockmux batch "scenes/*.html" --format gif
```

Folders and wildcards work. One failing file does not stop the rest, unless you add `--stop-on-error`.

### Case H: a title film with no HTML

Write a `.tmx` file. It is a short script of scenes:

```
film "Launch" duration=6s preset=youtube theme=midnight
watermark "mybrand.com"

scene 0s..3s transition=pop {
  badge "New"
  title "Ship videos like you ship code" highlight="ship code"
  subtitle "Write it once. Render it anywhere."
}
scene 3s..6s transition=zoom {
  counter from=0 to=100 suffix="% done"
  bar percent=100
  caption "Made with TockMux"
}
```

- Elements: `badge`, `title`, `subtitle`, `code`, `counter`, `bar`, `list`, `quote`, `image`, `caption`.
- Transitions: `pop`, `slide`, `zoom`, `fade`, `none`.
- Themes: `midnight`, `paper`, `sunset`, `ocean`, `mono`.
- Mistakes are reported with the line number and a suggestion.

Then `tockmux render story.tmx`. Start from a sample with `tockmux init my-video`.

### Case I: narration from ElevenLabs (optional)

```bash
tockmux voice add --name main            # asks for your API key privately
tockmux voice status --refresh           # real usage from ElevenLabs
tockmux voice speak "Welcome to our product." -o narration.mp3
```

Keys are stored in `~/.tockmux/voice.json` (owner-only), never in your project folder. Use keys for accounts you are
allowed to use. Creating many accounts to get around a provider's limits can break its terms.

### Case J: drag and drop, no commands

```bash
tockmux studio
```

Your browser opens a small app on your own computer (it listens on 127.0.0.1 only). Drop a file, pick a size, press
render, and download the result.

### Case K: an AI assistant makes the video

Connect TockMux once:

```bash
claude mcp add tockmux -- npx -y tockmux mcp           # Claude Code
tockmux mcp --print-config                             # JSON for Claude Desktop or Cursor
```

Then ask in plain words, for example: "Make a 12-second TikTok-size video from the page we just wrote."

The assistant gets these tools:

| Tool | What it does for the assistant |
| --- | --- |
| `check_html` | Tests whether a page will convert well |
| `snapshot_frame` | Shows one frame as an image so it can look at the design |
| `render_video` | Renders the MP4, GIF or WebM |
| `compile_tmx` | Turns a `.tmx` script into HTML |
| `list_presets` | Lists sizes and themes |
| `probe_media` | Reads the length and size of a video or audio file |
| `speak_text` | Makes narration (needs an ElevenLabs key) |

The assistant can only read and write inside the folder you start it in.

### Case L: a developer uses it in code

```js
import { convert } from "tockmux";

const result = await convert({
  input: "promo.html",
  flags: { output: "promo.mp4", preset: "tiktok" }
});
console.log(result.output, result.durationSec);
```

Use it in a build script, a CI job, or a web app's back end. Keep the input files in a folder you trust (see
"Is it safe?" below).

### Case M: check your setup or a single file

```bash
tockmux doctor            # Node, FFmpeg, browser: what is missing and how to fix it
tockmux probe promo.mp4 --frames   # length, size, audio, exact frame count
tockmux presets           # sizes and themes
tockmux about             # version and contact
```

---

## 5. Useful options

| Option | What it does |
| --- | --- |
| `-o, --output` | Choose the output file |
| `--format` | Choose mp4, webm or gif |
| `--preset` | A size preset |
| `--width`, `--height`, `--fps` | Set the frame exactly |
| `--duration 12s` | Length of the video |
| `--start "#play"` | Click this element at 0 seconds |
| `--seed 1337` | The random seed (same seed, same video) |
| `--from 3s --to 8s` | Render only part of the video |
| `--crf 18` | Quality, lower is better |
| `--fast` | Faster, slightly lower quality |
| `--json` | Machine-readable output |
| `--no-color` | Plain text (also `NO_COLOR=1`) |

---

## 6. Troubleshooting

| What you see | What to do |
| --- | --- |
| "No browser found" | Run `tockmux setup`, or install Chrome or Edge |
| "No length found, using 10s" | Add the `html2mp4:duration` meta tag, or `--duration 12` |
| The video is a still image | The page does not animate by itself. Use `tockmux check` to see why |
| The page waits for a click | Add `--start "#your-button"` |
| Watch does not notice saves | Stop it (Ctrl+C) and run `tockmux watch` again |
| Anything else | Run again with `--debug` and send the output on Discord: **Spidey_Moon** |

---

## 7. Is it safe to run other people's HTML?

Treat it like opening the page in your browser. Only render files you trust. Studio and the MCP server only read and
write inside the folder you chose. If you ever put TockMux on a public web service, run each job in an isolated
container. The package does not do that for you.

---

## 8. For the maintainer (publishing)

These steps need your own accounts. TockMux did not publish anything.

1. Check the package:

   ```bash
   npm test
   npm pack --dry-run
   ```

2. Fill in `repository`, `homepage` and `bugs` in `package.json` after the GitHub repository exists
   (for example `https://github.com/Anand2k29/tockmux`).

3. Log in and publish, with your own npm account:

   ```bash
   npm login
   npm publish --access public
   ```

4. Host the landing page: upload the `site/` folder to GitHub Pages, Netlify or any static host.

5. Register the MCP server in the official MCP registry once the npm package is live.

6. Announce on Discord and in the README's install section.

---

## 9. Contact

- Discord: **Spidey_Moon**
- GitHub: **Anand2k29** (github.com/Anand2k29)
- Licence: MIT
