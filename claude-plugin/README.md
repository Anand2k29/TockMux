# TockMux plugin for Claude Code

Make videos from HTML animations without leaving Claude Code. Type `/tockmux` and pick a command.

## Install (two commands, inside Claude Code)

```
/plugin marketplace add Anand2k29/TockMux
/plugin install tockmux@tockmux
```

The first command adds the TockMux marketplace. The second installs the plugin.

## Commands

| Command | What it does |
| --- | --- |
| `/tockmux:render <file>` | Turns an HTML or `.tmx` file into an MP4, GIF or WebM |
| `/tockmux:watch <file>` | Re-renders the file every time you save it |
| `/tockmux:check <file>` | Checks whether a file will convert well, before a long render |
| `/tockmux:make <what to show>` | Writes an animated HTML page for you, then renders it |
| `/tockmux:setup` | Checks your setup, downloads the browser if needed, and runs a demo |

Examples:

```
/tockmux:make a 10-second vertical promo for a coffee shop, warm colours --preset tiktok
/tockmux:render promo.html --format gif
/tockmux:check landing.html
```

## What you need

- Node.js 20 or newer (TockMux runs through `npx`, so no global install is needed)
- A browser (Chrome, Edge or Chromium). `/tockmux:setup` downloads one if none is found.

## Using it without the plugin

The same features are available from the terminal (`npx tockmux`), from the MCP server (`npx -y tockmux mcp`), and from
code (`import { convert } from "tockmux"`). See the main [README](../README.md).
