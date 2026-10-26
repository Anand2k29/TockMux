---
description: Re-render a file with TockMux every time it is saved
argument-hint: <file.html|file.tmx>
allowed-tools: Bash(npx -y tockmux:*)
---

Watch this file and re-render on every save: $ARGUMENTS

1. If no file was given, ask the user which file to watch.
2. Start watch mode. It runs until the user stops it with Ctrl+C, so run it in a way the user can stop:

   ```bash
   npx -y tockmux watch $ARGUMENTS
   ```

3. Tell the user to save the file to render, and that Ctrl+C stops the watch.
