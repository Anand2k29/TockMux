---
description: Check whether an HTML or .tmx file will convert to video well, before a long render
argument-hint: <file.html|file.tmx>
allowed-tools: Bash(npx -y tockmux:*)
---

Check this file before rendering: $ARGUMENTS

1. If no file was given, ask the user which file to check.
2. Run the check:

   ```bash
   npx -y tockmux check $ARGUMENTS
   ```

3. Explain each warning or failure in plain words, and say what to change for each one. Typical fixes:
   - "still image": the page does not move by itself. Add a CSS or JavaScript animation.
   - "waits for a click": add `--start "#button-id"` when rendering.
   - "missing file": check the path of images and other assets the page uses.
