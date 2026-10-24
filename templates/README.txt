Your TockMux starter project
============================

video.html   An HTML page with CSS + JavaScript animation.
             Render it:   tockmux render video.html
story.tmx    A short script in the .tmx format (no HTML needed).
             Render it:   tockmux render story.tmx

Handy options
  --preset tiktok        9:16 vertical (also: youtube, square, portrait, cinema, hd720, 4k)
  --format gif           make a GIF instead of an MP4
  --voice narration.mp3 --auto-fit    add a voice-over and stretch the video to match
  tockmux check video.html            test the file before rendering

Tips for your own HTML
  - Add  <meta name="html2mp4:duration" content="12">  so TockMux knows how long to record.
  - Let it animate by itself (CSS, JavaScript, GSAP, canvas, SVG). Pages that need a click
    can use  --start "#button"  to click it at 0 seconds.

Questions? Discord: Spidey_Moon
