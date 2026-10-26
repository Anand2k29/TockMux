---
description: Write an animated HTML page from a description, then render it to an MP4 with TockMux
argument-hint: <what the video should show> [--duration 10] [--preset tiktok]
allowed-tools: Write, Bash(npx -y tockmux:*)
---

Make a video about: $ARGUMENTS

1. Write one self-contained HTML file that moves by itself. Use CSS keyframe animations or a short
   `requestAnimationFrame` script. Do not wait for clicks, typing or network requests.
2. Put this in the `<head>` so TockMux knows the length and size:

   ```html
   <meta name="html2mp4:duration" content="10">
   <meta name="html2mp4:width" content="1920">
   <meta name="html2mp4:height" content="1080">
   ```

   Change the duration and size to match what the user asked for. If the user gave `--duration` or `--preset`
   in the arguments, use those instead.
3. Save the file in the current folder with a short name, for example `my-video.html`.
4. Check it, then render it:

   ```bash
   npx -y tockmux check my-video.html
   npx -y tockmux render my-video.html
   ```

5. Report the MP4 path and length. Offer to change the timing or the look if the user wants it.
