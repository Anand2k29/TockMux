# Using TockMux as a library (import)

TockMux can be used from your own JavaScript or TypeScript code. This is the way to use it in a build script, a CI
job, a back end, or a tool you are writing.

## Install

```bash
npm install tockmux
```

For a command-line tool you can run anywhere, install it globally with `npm install -g tockmux`. A library install
only needs the local `npm install tockmux`.

You also need a browser for rendering. Run `npx tockmux setup` once, or install Chrome or Edge.

## The one function you need

```js
import { convert } from "tockmux";

const result = await convert({
  input: "promo.html",
  flags: { output: "promo.mp4", preset: "tiktok" }
});

console.log(result.output);      // full path of the video file
console.log(result.durationSec); // length in seconds
console.log(result.warnings);    // plain-sentence warnings, an empty list if none
```

`input` is a file path. `flags` takes the same names as the command-line options, written in camelCase: `preset`,
`duration`, `fps`, `format`, `voice`, `autoFit`, `start`, and so on.

## Other functions

| Function | What it does |
| --- | --- |
| `convert({ input, flags, hooks })` | Renders a video. Returns the result above. |
| `checkInput({ input, flags, live })` | Tests whether a page will convert well. Returns a list of checks. |
| `snapshot({ input, flags, atSec, type })` | Renders one frame. Returns an object whose `buffer` property holds the image bytes. |
| `planJob({ input, flags })` | Works out the plan (settings and source) without rendering. |
| `PRESETS` | The size presets, for example `PRESETS.tiktok`. |

## Progress and logs

`convert` accepts `hooks`, which are callbacks:

```js
await convert({
  input: "promo.html",
  flags: { output: "promo.mp4" },
  hooks: {
    onProgress: (p) => console.log(`${p.done}/${p.total} frames`),
    onLog: (message) => console.log(message),
    onPlan: ({ settings, output }) => console.log("plan", settings.width, settings.height, output)
  }
});
```

## Errors

Expected problems throw a `TockError` with a `code` and a `hint`:

```js
import { convert } from "tockmux";

try {
  await convert({ input: "missing.html" });
} catch (e) {
  console.error(e.code, e.message); // FILE_NOT_FOUND "File not found: missing.html"
  console.error(e.hint);            // what to do next
}
```

## Batch rendering in a script

```js
import { convert } from "tockmux";
import fs from "node:fs";

for (const file of fs.readdirSync("slides").filter((f) => f.endsWith(".html"))) {
  const output = `videos/${file.replace(/\.html$/, ".mp4")}`;
  const r = await convert({ input: `slides/${file}`, flags: { output } });
  console.log("rendered", r.output);
}
```

Run renders one after another. A single render already uses several parallel browser pages on a multi-core machine.

## Things to know

- **It needs a browser and FFmpeg at run time.** FFmpeg comes with the package. The browser comes from `setup`, or from
  Chrome or Edge on your machine.
- **Only render files you trust.** The page runs in a real browser. Treat untrusted HTML as hostile.
- **Output is deterministic.** The same input, flags and `seed` produce the same frames.
- **Node 20 or newer is what the tests run on.** Node 18 may work, but the browser installer needs Node 20.
