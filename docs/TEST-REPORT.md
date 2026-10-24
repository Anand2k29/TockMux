# Test report

Generated from a real run of `npm test` on 2026-10-18 (Linux, Node 22, 1 CPU core, Chromium 153).

**182 tests, 182 passed, 0 failed, 0 skipped, 104 seconds.**

Tests marked `[render]` draw real video in a real browser and check the result (frame counts, pixel positions, audio, files).

## Not covered by these tests

- The live ElevenLabs service (a mock server that imitates the documented API was used instead)
- Claude Desktop, Cursor and Claude Code as MCP clients (the official MCP SDK client was used)
- Windows and macOS (the code handles them, but the run was Linux only)
- Docker image and the GitHub Actions workflows
- Multi-core speed-ups from `--workers` (output correctness with 2 and 3 workers is tested)
- Google Fonts on the landing page (blocked in the sandbox)

## Every test

### cli basics

- --version prints just the version
- no arguments shows a friendly start screen
- help lists every command, in groups
- help <command> documents its options
- an unknown command exits 2 and suggests the right one
- an unknown option exits 2 with a suggestion
- a missing file is a plain-English error, not a stack trace
- render with no file explains what to do
- an unsupported file type is explained
- --no-color and piped output contain no escape codes
- presets --json is valid JSON with every preset
- doctor --json reports each requirement
- doctor tells you how to fix a missing browser
- a bad --browser path is reported clearly
- errors are JSON when --json is used
- mcp --print-config gives paste-ready JSON
- about shows the Discord contact

### init

- creates a starter project and never overwrites your files
- --template tmx only creates the script

### check (no browser needed with --static)

- --static check of a good file passes; JSON mode works
- check of a broken .tmx exits 1 and names the line

### rendering commands

- [render] render: writes the file next to the input, reports it, exits 0
- [render] render --json returns a machine-readable result
- [render] `tockmux file.html` is a shortcut for render
- [render] --format gif and --preset work from the CLI
- [render] --start none and the guessed start are shown in the plan
- [render] frame saves a PNG or JPEG poster
- [render] check (live) exits 0 for a good page and shows the checklist
- [render] batch renders a folder, honours --out-dir, and reports failures without stopping
- [render] sync adds a voice-over to an existing MP4, and --stretch fits the video to it
- [render] probe prints details and counts frames
- [render] demo renders the bundled film end to end

### voice commands

- add, status, remove (key verified against a mock server)
- legacy el-add / el-status aliases still work
- speak writes an MP3 and fails over between accounts
- speak without an account explains how to add one
- a .tmx with a narration script is spoken and auto-fitted

### MCP server (verified with the official MCP SDK client)

- handshake reports name, version and capabilities
- lists the tools with schemas
- list_presets and compile_tmx work without a browser
- paths outside the allowed folder are refused (as a tool error, not a crash)
- a missing input is a clear tool error
- unknown tools are a protocol error
- prompt and resource carry the authoring contract
- ping works
- [render] check_html inspects a file and an inline source
- [render] snapshot_frame returns an image the assistant can look at
- [render] render_video renders, streams progress notifications, and stays inside the folder
- [render] render_video accepts inline .tmx and an explicit output path
- speak_text without an account explains how to connect one

### MCP protocol edge cases (raw handler)

- negotiates down to a version it supports
- unknown method is -32601

### package metadata

- bin entries exist, are executable and start with a shebang
- every path in `files` exists
- main and exports resolve and the library imports cleanly
- runtime dependencies stay small (install must be quick)
- the postinstall script can never fail an install
- the node engine matches what the code needs
- LICENSE, README, CHANGELOG exist and the README mentions the key commands
- versions agree between package.json, the CLI and the changelog
- the landing page and Studio contain no leftover placeholders or fake claims

### npm pack

- the tarball has everything needed and nothing private

### every kind of animation lands on the exact frame

- [render] raf: exact frame count and exact position
- [render] css: exact frame count and exact position
- [render] timers: exact frame count and exact position
- [render] date: exact frame count and exact position
- [render] perf: exact frame count and exact position
- [render] a window.__seek(ms) page works with no timers at all
- [render] repeat renders are identical (seeded Math.random)
- [render] odd sizes are padded to even dimensions for H.264
- [render] a virtual-clock page cannot see real time passing

### parallel workers

- [render] 2 and 3 workers give the same video as 1 worker
- [render] a worker that starts mid-video fast-forwards timers and CSS correctly

### page features

- [render] a start button is clicked at 0s with --start, and not otherwise
- [render] a \#go / \#play / \#start button is guessed, reported as guessed, and can be switched off
- [render] a start trigger can also be declared in a <meta> tag
- [render] autoscroll turns a tall static page into a scrolling video
- [render] a static page is detected and warned about
- [render] missing files and script errors are reported
- [render] relative assets and ES modules load (served over http, not file://)
- [render] WebM <video> elements are seeked frame by frame
- [render] the duration is detected from finite CSS animations when not declared

### output formats and ranges

- [render] GIF and WebM
- [render] --from/--to render only that part
- [render] the fast option (JPEG frames) still renders correctly
- [render] a failed render leaves no partial file behind
- [render] a render can be cancelled

### tmx films

- [render] a .tmx script renders with its own size, duration and content
- [render] a broken .tmx is rejected before any rendering, with line numbers
- [render] the bundled examples all render

### audio

- [render] --voice adds an audio track matching the video length
- [render] --auto-fit stretches the animation to the narration (and the maths is right)
- [render] a voice-over longer than the video warns and suggests --auto-fit
- [render] music loops, fades and ducks under the voice
- [render] ducking really makes the music quieter while the voice speaks (measured)
- [render] audio is ignored with a clear warning for GIF output
- [render] a .tmx can name its own voice-over and music files

### check and snapshot

- [render] check passes an animated page and warns about a static one
- [render] check reports missing assets, fixed-size overflow and bad audio paths
- [render] check on a broken .tmx fails and lists the lines
- [render] snapshot returns a valid image of the requested moment
- [render] inline source text works (used by Studio and MCP)

### studio pages and info

- serves the app, the landing page and info
- unknown routes are 404

### studio security

- rejects a foreign Host header (DNS rebinding)
- rejects cross-site POSTs by Origin
- accepts same-origin POSTs
- refuses path traversal and absolute paths in uploads
- API responses are never cacheable and API keys are masked
- bad JSON is a 400, not a crash
- no files / no main file is a friendly error
- unknown job ids are 404

### studio compile and voice endpoints

- compile returns html plus diagnostics for a .tmx
- adding an account verifies it against the provider

### studio check and render

- [render] check returns the checklist for an uploaded page
- [render] render job streams progress, then the file can be downloaded and played
- [render] uploaded sibling assets are available to the page, and voice-over is mixed in
- [render] a failing render reports a readable error through the stream
- [render] jobs are queued one at a time and can be cancelled

### studio lifecycle

- a busy port gives a helpful message

### args parser

- flags, aliases, inline values, camelCase
- --no-flag negates booleans
- unknown flag suggests the closest one
- rejects bad numbers, choices and missing values
- -- ends option parsing
- negative numbers are values, not flags

### time parsing

- accepts seconds, ms and m:ss
- rejects nonsense with a helpful hint

### tmx tokenizer and parser

- tokenizes quoted strings with escapes and attributes
- unclosed quote throws
- parses a full film
- handles Windows line endings and a BOM
- single-line scenes with ; separators
- duration is inferred from the last scene when not declared
- reports every problem with line numbers and suggestions
- warns when the last scene overruns the declared duration
- empty file is an error
- didYouMean

### tmx compiler

- produces a page with the contract meta tags
- user text cannot break out of the script block

### presets and settings

- presets are well formed
- precedence: flag > preset > file > default
- rejects impossible values with a hint
- start selector becomes a click action at 0s
- detectKind

### html inspection

- reads meta in any attribute order, both namespaces
- detects features
- static page is not flagged as animated

### renderer planning

- segments cover the range exactly once
- tiny jobs are not split across many workers

### ffmpeg argument builders

- no audio means a plain copy
- voice only pads to the video length
- music loops and fades out; ducking uses a sidechain
- gif uses a palette

### voice store

- masks keys and stores them privately
- environment keys are picked up
- remaining() treats unknown limits as available
- splitText respects sentence boundaries and the size limit

### static server

- serves files, blocks traversal, supports ranges and virtual files

### CLI ui

- no colour codes when NO_COLOR is set or output is not a TTY
- colour works when forced and stripAnsi removes it
- legacy Windows consoles fall back to ASCII
- progress bar prints coarse lines when not a TTY
- json/quiet mode silences chatter
- box and checklist align

### batch input expansion

- folders, wildcards and recursion

### studio upload safety

- safeRelative rejects traversal and absolute names

### virtual clock script

- is self-contained and parseable

### voice pool failover (mock ElevenLabs server)

- refresh reads real usage numbers
- uses the first account while it has characters
- rotates to the next account when quota runs out mid-request
- skips an invalid key and marks it
- a rate-limited account is skipped but not marked as exhausted
- long narration is split and chunks can land on different accounts
- balance strategy prefers the account with most characters left
- when every account is exhausted the error explains what to do
- no accounts gives a clear setup hint
- empty text is rejected
- usage is saved back so a later run remembers it

### Studio UI (a real browser driving the app)

- [render] Studio UI: add a file, check it, render it, and play the result
- [render] Studio UI: paste code, sample .tmx renders a preview; folder-style names and bad files are handled
- [render] Studio UI works on a phone-sized screen without sideways scrolling
