# Read this first: what the documents are

TockMux has several kinds of documents. This page explains what each one is and which one to open.

| Document | What it is | Is it a language? |
| --- | --- | --- |
| `README.md` (in the top folder) | The front page: what TockMux is, quick start, every command. | No. A Markdown file (plain text with simple formatting). |
| `docs/` (this folder) | Guides for people who use TockMux. | No. Markdown guides. |
| `process/` | Notes from building TockMux: decisions, MVP, how functions call each other, the flow of a render, and a usage guide. | No. Notes for maintainers. |
| `CONTRIBUTING.md` | How to report problems and send changes. | No. |
| `.tmx` files | Scripts for title films. | **Yes, a small language.** It is TockMux's own format. |
| HTML pages | The animation you give TockMux. | HTML is a language. TockMux only needs the page to move by itself. |
| MCP | A protocol that lets AI tools call TockMux. | No. A way of connecting. |
| The npm package | What you install with `npm install -g tockmux`. | No. A program. |

## Which one to open

- **I want to start:** `README.md`, then type `tockmux` for the menu.
- **I want to understand one part:** the matching file in `docs/` (for example `docs/02-SETUP-AND-USAGE.md`).
- **I want to know why it is built this way:** `process/decision.md`.
- **I want to change the code:** `CONTRIBUTING.md`, then `process/functions.mvp`.
- **I want to write a title film:** the `.tmx` section of `README.md`.

TockMux is one program. `.tmx` is its only small language. MCP is an optional door for AI assistants.
