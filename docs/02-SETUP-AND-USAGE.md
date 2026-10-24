# 2. Setup and daily use (for people who just want videos)

## Install in three commands

You need **Node.js 18 or newer**. Check with `node --version`. If you do not have it, install the "LTS" version from
<https://nodejs.org> (Windows, macOS and Linux installers are one click).

```bash
npm install -g tockmux
tockmux setup
tockmux demo
```

- `npm install -g tockmux` installs the program (about 4 seconds, 22 small packages, FFmpeg included).
- `tockmux setup` downloads the browser TockMux draws with (about 150 MB, once). **If you already have Google Chrome
  or Microsoft Edge, TockMux finds and uses it, and `setup` has nothing to download.**
- `tockmux demo` renders a 6-second sample video called `tockmux-demo.mp4`. When you see "Everything works", you are done.

Do not want to install anything permanently? Use `npx` in front of every command: `npx tockmux demo`.

### Windows notes (PowerShell)

- Open **PowerShell** or **Windows Terminal** (not an old `cmd` window, which draws the logo badly; TockMux switches
  to plain characters automatically if it detects one).
- If PowerShell says *"running scripts is disabled"*, run this once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- If you use Anaconda, make sure the terminal shows a Node.js-capable environment, or install Node.js normally. TockMux
  does **not** need Python at all (your old Python/Playwright/FFmpeg setup is no longer needed).
- Paths with spaces need quotes: `tockmux render "P:\My Videos\film.html"`.

### If something is wrong

```bash
tockmux doctor
```

It checks Node, FFmpeg and the browser and prints what to fix, with the exact command.

## Your first real video

```bash
tockmux init my-video          # creates my-video/video.html and my-video/story.tmx
cd my-video
tockmux check video.html       # opens the page, tests it, prints a checklist
tockmux render video.html      # creates video.mp4 next to it
```

Or skip the terminal: run `tockmux studio`, drop your file on the page, press **Render video**, press **Download**.

## Using your own HTML (for example one written by Claude)

Ask Claude something like:

> Create a 15-second animated HTML promo for my app. It must animate by itself (no clicks), use a fixed 1920x1080
> stage, and include `<meta name="html2mp4:duration" content="15">` plus width and height meta tags.

Then:

```bash
tockmux check promo.html
tockmux render promo.html
```

If the page has a Play button you must click, add `--start "#play"` (or it is guessed automatically when the button's
id is `go`, `play` or `start`).

## The options you will actually use

| I want to... | Add this |
| --- | --- |
| TikTok / Reels / Shorts (vertical) | `--preset tiktok` |
| Square post | `--preset square` |
| Smoother motion | `--preset cinema` (60 fps) |
| A GIF | `--format gif` (add `--gif-width 480` for smaller) |
| A different name or folder | `-o final.mp4` |
| Only seconds 2 to 5 | `--from 2 --to 5` |
| A different length | `--duration 20` |
| A voice-over that fits | `--voice narration.mp3 --auto-fit` |
| Background music that dips under the voice | `--music bg.mp3 --duck` |
| Render faster (slightly lower quality) | `--fast` |
| Use all my CPU | `--workers 4` |
| A long page that scrolls | `--recipe autoscroll --duration 20` |
| See every option | `tockmux help render` |

## Voice-over, step by step

**You already have a recording:**

```bash
tockmux render promo.html --voice narration.mp3 --auto-fit
```

`--auto-fit` stretches the animation so it ends when the voice does (plus 0.6 s). Without it, the video keeps its own
length and TockMux warns you if the voice would be cut off.

**You want ElevenLabs to speak a script:**

```bash
tockmux voice add --name main                         # asks for your API key (hidden)
tockmux voice speak "Welcome to our product." -o narration.mp3
tockmux render promo.html --voice narration.mp3 --auto-fit
```

Choose a voice with `--voice-id` (copy the ID from "My Voices" in ElevenLabs) or set `TOCKMUX_VOICE_ID`.
In a `.tmx` file you can write `tts "Your narration here"` and TockMux speaks it during the render.

**More than one account?** Add each with `tockmux voice add --name another`. When one runs out of characters (or its key
is invalid), TockMux switches to the next. `tockmux voice status --refresh` shows real remaining characters. Only use
keys you are entitled to use; see the note in `docs/01`.

**You already made a silent MP4:** `tockmux sync video.mp4 narration.mp3 --stretch -o final.mp4`.

## Writing videos without HTML (`.tmx`)

Create `story.tmx`:

```
film "My film" duration=9s preset=youtube theme=ocean
scene 0s..3s transition=pop {
  badge "Hello"
  title "A video from plain text" highlight="plain text"
}
scene 3s..9s transition=slide {
  list "No HTML" "No editor" "Just words"
  caption "Made with TockMux"
}
```

`tockmux render story.tmx`. If you make a typo, TockMux shows the line and suggests the fix
(`Unknown element "titel". Did you mean "title"?`). `tockmux presets` lists sizes and themes.

## Many files at once

```bash
tockmux batch ./slides --preset tiktok --out-dir ./videos
tockmux batch "scenes/*.html" --format gif
```

A file that fails does not stop the rest; you get a summary at the end.

## Use it from an AI assistant

See `docs/04-MCP.md`.

## Troubleshooting

| You see | Do this |
| --- | --- |
| `No browser found` | Run `tockmux setup`, or install Chrome/Edge |
| `Page animates: warn` or "every frame is identical" | The page does not move by itself. Check it opens and animates in Chrome. If it needs a click: `--start "#id"` |
| Video is cropped | The page is bigger than the frame. Match `--width/--height` or `--preset` to the page's design size |
| Missing images or fonts | Keep images next to the HTML (or inline them). Remote fonts need internet |
| Render is slow | Try `--fast`, `--preset hd720`, or `--workers 4` on a multi-core computer. 4K is slow by nature |
| Voice cut off | Add `--auto-fit` |
| Embedded video has no picture | Use WebM, or point TockMux at Google Chrome (it can play H.264): `--browser "C:\Program Files\Google\Chrome\Application\chrome.exe"` |
| Anything else | Run again with `--debug` and send the output on Discord: **Spidey_Moon** |

## Updating and removing

```bash
npm update -g tockmux        # update
npm uninstall -g tockmux     # remove
```

Saved ElevenLabs keys live in `~/.tockmux/` (Windows: `C:\Users\<you>\.tockmux`). Delete that folder to remove them.
