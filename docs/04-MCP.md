# 4. Using TockMux from an AI assistant (MCP)

**MCP (Model Context Protocol)** is the standard way to give an AI assistant tools. `tockmux mcp` turns TockMux into
an MCP server, so you can say to Claude: *"Make a 12-second vertical promo for my coffee shop and render it"*, and
the assistant writes the HTML, checks it, looks at frames, fixes problems and renders the MP4 itself.

It was tested against the official MCP SDK client (handshake, all tools, progress notifications, error cases). It has
**not** yet been tested inside Claude Desktop, Cursor or Claude Code themselves, so please do that once and tell me
if anything differs.

## Connect it

You need Node.js 18+ and a browser (`tockmux setup` once). No global install is required, because `npx` fetches it.

**Claude Code**
```bash
claude mcp add tockmux -- npx -y tockmux mcp
```

**Claude Desktop** (Settings > Developer > Edit Config, then restart). Run `tockmux mcp --print-config` for the exact JSON:
```json
{
  "mcpServers": {
    "tockmux": { "command": "npx", "args": ["-y", "tockmux", "mcp"] }
  }
}
```
On Windows, use `"command": "cmd", "args": ["/c", "npx", "-y", "tockmux", "mcp"]`.

**Cursor and other MCP apps:** add the same command (`npx -y tockmux mcp`) wherever the app asks for an MCP server.

### Choose the folder the assistant may use

The server can only read and write **inside one folder**. By default that is the folder the app starts it in. Set it
explicitly with `--root`:

```json
{ "mcpServers": { "tockmux": { "command": "npx", "args": ["-y", "tockmux", "mcp", "--root", "C:/Users/me/Videos"] } } }
```

Anything outside is refused with a clear message. (Advanced: `TOCKMUX_MCP_UNRESTRICTED=1` removes the limit. Only do
that if you fully trust the assistant and the prompts it sees.)

## What the assistant can do

| Tool | What it does |
| --- | --- |
| `check_html` | Opens a page (file or pasted text), reports size, duration, whether it animates, missing files, script errors |
| `snapshot_frame` | Returns one frame as an image so the assistant can *see* the result at any second |
| `render_video` | Renders MP4/GIF/WebM, with optional voice-over, music, auto-fit; reports progress |
| `compile_tmx` | Turns `.tmx` script text into the page it describes, with line-numbered errors |
| `list_presets` | Sizes (YouTube, TikTok, square, 4K...) and themes |
| `probe_media` | Length, resolution, audio info of a media file |
| `speak_text` | Narration through your connected ElevenLabs accounts |

It also offers a **prompt** (`make_html_video`) and a **resource** (`tockmux://contract`) that teach the assistant the
rules for writing HTML that renders well (self-playing, fixed stage size, duration meta tag, no pop-ups, and so on).

## Try it

1. Connect it as above and restart the app.
2. Ask: *"Use TockMux to create a 10-second 1080x1920 animated HTML intro for 'Moon Cafe', preview frames at 1s, 5s and
   9s, fix anything that looks off, then render it to moon-cafe.mp4."*
3. The video appears in your chosen folder under `tockmux-output/` unless you named a path.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The tool list is empty or the server fails to start | Run `npx -y tockmux mcp` in a terminal. It should wait silently (it speaks JSON over stdio). Press Ctrl+C. If it errors, run `tockmux doctor` |
| "No browser found" in a tool result | Run `tockmux setup` once |
| "outside the allowed folder" | Use paths inside `--root`, or change `--root` |
| Windows: `npx` not found | Use the `cmd /c npx ...` form shown above |
| Renders time out in the app | Long videos can take minutes. Ask for a shorter test render first (`duration`, or `hd720`) |
| Nothing at all prints in the log | Correct: stdout is reserved for the protocol. Errors come back as tool results |

## For developers

The server (`src/mcp/server.js`) is a small dependency-free implementation of the stdio transport: newline-delimited
JSON-RPC with `initialize`, `ping`, `tools/*`, `prompts/*`, `resources/*`, progress notifications and cancellation. It
negotiates protocol versions `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`. It was written by hand to
keep installation light (the official SDK adds over 90 packages). If you prefer the SDK, the tool handlers are exported
as `createMcpHandler()` and can be wrapped in a few lines. Listing it in the official MCP Registry is covered in
`docs/03-PUBLISH-AND-LAUNCH.md`.
