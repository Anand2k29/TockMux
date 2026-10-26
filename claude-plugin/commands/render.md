---
description: Render an HTML or .tmx file into an MP4, GIF or WebM with TockMux
argument-hint: <file.html|file.tmx> [--preset tiktok] [--format gif] [--duration 12]
allowed-tools: Bash(npx -y tockmux:*)
---

Render the file the user gave: $ARGUMENTS

1. If no file was given, ask the user which `.html` or `.tmx` file to render. Do not guess.
2. Run TockMux with the arguments as given. Use `npx -y tockmux render` so nothing needs a global install:

   ```bash
   npx -y tockmux render $ARGUMENTS
   ```

3. If it fails with "No browser found", run `npx -y tockmux setup` once, then render again.
4. Report the output file path, its size and its length, from the "Video ready" box.
5. Show any warnings in plain words, and say what to change, using the hint TockMux printed.
