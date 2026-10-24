# Flow

How a request becomes a video. Each diagram can be read top to bottom. The names match `functions.mvp`.

## 1. The whole product, one picture

```mermaid
flowchart LR
  U1[Terminal user] --> CLI[tockmux CLI<br/>render, watch, batch, check]
  U2[Developer] --> LIB[import convert from tockmux]
  U3[Non-expert] --> STU[tockmux studio<br/>drag and drop]
  U4[AI assistant] --> MCP[tockmux mcp<br/>MCP tools]
  CLI --> P[convert in pipeline.js]
  LIB --> P
  STU --> P
  MCP --> P
  P --> S[settings: size, fps, length]
  P --> R[renderer: virtual clock<br/>frame by frame]
  P --> V[voice pool<br/>optional]
  R --> B[headless Chromium<br/>page under control]
  R --> F[FFmpeg<br/>encode, mux, join]
  F --> OUT[(MP4 / GIF / WebM)]
```

## 2. A render, step by step

```mermaid
sequenceDiagram
  participant User
  participant CLI as render command
  participant P as convert()
  participant Plan as planJob()
  participant Set as resolveSettings()
  participant Ren as renderVideo()
  participant Br as Chromium
  participant Enc as FFmpeg
  User->>CLI: tockmux render promo.html
  CLI->>P: convert({ input, flags, hooks })
  P->>Plan: read file, detect kind, parse
  Plan->>Set: flags + meta tags + preset + CSS detection
  Set-->>Plan: settings (width, height, fps, duration)
  Plan-->>P: plan (source, settings, voice, music)
  P-->>CLI: hooks.onPlan (show the summary table)
  P->>Ren: renderVideo(settings, output, format)
  loop each frame
    Ren->>Br: advance clock by 1/fps, capture frame
    Br-->>Ren: PNG or JPEG bytes
    Ren->>Enc: write frame to stdin
    Ren-->>CLI: hooks.onProgress (animated bar)
  end
  Ren->>Enc: close, concat segments, mux voice/music
  Enc-->>Ren: finished file
  Ren-->>P: { output, durationSec, bytes, warnings }
  P-->>CLI: result
  CLI-->>User: "Video ready" box
```

## 3. The watch loop

```mermaid
flowchart TD
  A[Start: tockmux watch promo.html] --> B[Check browser, then render once]
  B --> C{Save detected?}
  C -- no --> C
  C -- yes --> D[Wait 300 ms<br/>editors save twice]
  D --> E{Render running?}
  E -- yes --> F[Mark one more render queued]
  E -- no --> G[convert promo.html]
  G -- success --> H[Print file and time taken]
  G -- error --> I[Print message and fix hint<br/>keep watching]
  H --> J{Queued?}
  I --> J
  J -- yes --> G
  J -- no --> C
  F --> C
  K[Ctrl+C] --> L[Close watcher, print Stopped]
```

## 4. Choosing the settings (what wins)

```mermaid
flowchart TD
  F1[1. Flag you typed<br/>--duration 12] --> W{Use the first one that is set}
  F2[2. Meta tag in the file<br/>html2mp4:duration] --> W
  F3[3. Preset<br/>--preset tiktok] --> W
  F4[4. Detected from CSS animations] --> W
  F5[5. Default: 10 s, 1920x1080, 30 fps] --> W
  W --> OUT[settings + where each value came from]
```

The summary table shows the source of each value ("set by you", "from the file", "preset", "detected", "default"),
so a user can see why a video is the length it is.

## 5. Voice-over with auto-fit

```mermaid
flowchart LR
  T[narration text or mp3] --> V{voice given?}
  V -- text only --> E[ElevenLabs pool<br/>split, fail over, join]
  V -- mp3 --> M[probeMedia: voice length]
  E --> M
  M --> A{--auto-fit?}
  A -- no --> R[render at the authored length]
  A -- yes --> S[stretch the animation:<br/>timeScale = animation / voice]
  S --> R
  R --> X[buildMuxArgs: add voice and music<br/>duck music under speech]
```

## 6. Check before you wait

```mermaid
flowchart LR
  C1[tockmux check page.html] --> P1[planJob]
  P1 --> PF[runPreflight]
  PF --> LV[probeLive: open the page,<br/>wait a few frames, look]
  LV --> Q{Results}
  Q --> G1[green: will convert well]
  Q --> Y1[yellow: still image, cropped, slow]
  Q --> R1[red: missing file, script error]
```

## 7. The MCP call path

```mermaid
sequenceDiagram
  participant AI as AI assistant
  participant MCP as tockmux mcp
  participant P as convert()
  AI->>MCP: tools/call render_video { input: "promo.html" }
  MCP->>MCP: resolve path, must stay inside the project folder
  MCP->>P: convert({ input })
  P-->>MCP: result (output path, duration)
  MCP-->>AI: text result with the file path
```

## 8. Failure paths (all turn into plain sentences)

| Where it fails | What the user sees | Where it is caught |
| --- | --- | --- |
| File missing | "File not found: x" + "check the spelling" | `planJob` |
| Bad `.tmx` line | line number, the bad word, a suggestion | `parseTmx` / `assertValidTmx` |
| No browser | offer to download once | `ensureBrowser` |
| Page throws an error | the script error and where it happened | `renderVideo` and preflight |
| ElevenLabs quota or bad key | "switching to the next account" | `VoicePool` |
| FFmpeg error | the last lines of FFmpeg's error output | `runFfmpeg` |
| Anything unexpected | "Something unexpected went wrong" + `--debug` | `main.js` |
