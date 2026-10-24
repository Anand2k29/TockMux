# 3. Publishing TockMux and launching it

Everything here is free. Steps marked **(verified)** were checked against the official docs while preparing this
package. Steps marked **(untested)** I could not run from the build environment, so test them yourself.

## Part A. Before you publish (30 minutes)

1. **Check the name is still free.** On the day of writing, `tockmux` was not taken on npm.
   ```bash
   npm view tockmux        # an "E404 Not Found" error means the name is free
   ```
   If someone took it in the meantime, use a scoped name such as `@yourname/tockmux` and change `"name"` in
   `package.json` (users then run `npx @yourname/tockmux`). The `bin` names `tockmux` and `tmx` stay the same.
2. **Edit `package.json`:** add your real links. Replace the placeholders:
   ```json
   "repository": { "type": "git", "url": "git+https://github.com/YOUR_GITHUB_NAME/tockmux.git" },
   "homepage": "https://YOUR_SITE_OR_GITHUB_PAGES_URL",
   "bugs": { "url": "https://github.com/YOUR_GITHUB_NAME/tockmux/issues" }
   ```
3. **Run the tests and look at the tarball:**
   ```bash
   npm install
   npx tockmux setup            # or set TOCKMUX_BROWSER to a Chrome path
   npm test                     # a few minutes; renders real video
   npm pack --dry-run           # lists exactly what will be published (about 49 files, 100 KB)
   ```
4. **Try it exactly as a user will** (this caught real problems while building this package):
   ```bash
   npm pack                                  # creates tockmux-4.0.0.tgz
   mkdir ../trial && cd ../trial && npm init -y
   npm install ../tockmux/tockmux-4.0.0.tgz
   npx tockmux demo
   ```

## Part B. Publish to npm **(verified)**

1. Create a free account at <https://www.npmjs.com/signup> and **turn on two-factor authentication** (Account
   settings). npm's rules for publishing credentials have been tightening, so follow whatever the site asks at login.
2. In PowerShell or a terminal, inside the project folder:
   ```bash
   npm login
   npm publish --access public
   ```
3. Check <https://www.npmjs.com/package/tockmux>, then on a different computer (or a fresh folder):
   ```bash
   npx tockmux demo
   ```
4. **Releasing updates later:**
   ```bash
   # edit CHANGELOG.md first
   npm version patch            # 4.0.0 -> 4.0.1  (use minor for features, major for breaking changes)
   npm test
   npm publish
   ```
   A published version number can never be reused. If you publish a mistake, publish a fixed version, and optionally
   run `npm deprecate tockmux@4.0.1 "use 4.0.2"`.

**What "registering the package" means:** on npm there is nothing separate to register. Publishing creates the
package page and makes `npm install -g tockmux` and `npx tockmux` work for everyone in the world within a minute or two.

## Part C. GitHub **(untested workflows)**

1. Create a public repository named `tockmux` and push the project:
   ```bash
   git init && git add . && git commit -m "TockMux 4.0.0"
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_NAME/tockmux.git
   git push -u origin main
   ```
2. Add repository topics: `html-to-video`, `html-to-mp4`, `mcp`, `mcp-server`, `ffmpeg`, `playwright`, `claude`,
   `elevenlabs`, `video-automation`.
3. `.github/workflows/ci.yml` runs the tests on Linux, Windows and macOS for Node 18, 20 and 22 every time you push.
   **I have not been able to run it**, so expect to fix small things on the first run (Windows especially).
4. `.github/workflows/publish.yml` publishes to npm when you create a GitHub Release. It needs a repository secret
   called `NPM_TOKEN` (npm > Access Tokens > Generate New Token > Automation). Optional: you can instead publish by
   hand as in Part B.
5. Create a Release: GitHub > Releases > Draft a new release > tag `v4.0.0`.

## Part D. Host the landing page (free, 10 minutes)

The page is one file: `site/index.html`. Any static host works:

| Host | How |
| --- | --- |
| **GitHub Pages** | Repo Settings > Pages > deploy from a branch. Put `index.html` in a `/docs` folder or a `gh-pages` branch. |
| **Netlify** | Go to app.netlify.com/drop and drag the `site` folder onto the page. Live in seconds. |
| **Cloudflare Pages / Vercel** | Connect the repo, set the output folder to `site`. |

Tips: the page loads three Google Fonts and falls back to system fonts if they are blocked. Add an `og:image` (a 1200x630
picture) so links look good when shared. You can make one with TockMux itself:
`tockmux frame site-card.html --at 1 --width 1200 --height 630 -o og.png`. Also put the page's address in
`package.json` as `homepage`.

`tockmux studio` serves the same landing page at <http://127.0.0.1:4321/landing>.

## Part E. List the MCP server **(verified, registry is in preview)**

The official MCP Registry stores only metadata, so **publish to npm first**. Then:

1. Add to `package.json` (the value must be exactly `io.github.<your-github-username>/tockmux`, case sensitive):
   ```json
   "mcpName": "io.github.YOUR_GITHUB_NAME/tockmux"
   ```
   Publish a new version so npm contains it (`npm version patch && npm publish`).
2. Install the publisher: `brew install mcp-publisher` (macOS/Linux) or download it from the MCP registry releases
   (Windows). Then in the project folder:
   ```bash
   mcp-publisher init            # creates server.json; set "name" to the same value as mcpName
   mcp-publisher login github
   mcp-publisher publish
   ```
   In `server.json` the package entry looks like `{ "registryType": "npm", "identifier": "tockmux", "version": "4.0.0" }`
   with a short description. `mcp-publisher validate` checks it before you publish. Follow
   <https://modelcontextprotocol.io/registry/quickstart> for the current exact fields, because the format is still evolving.
3. Other MCP directories (Smithery, Glama, PulseMCP, mcp.so and community "awesome MCP servers" lists) change often.
   Search for "MCP server directory", read each site's submission rules, and submit the GitHub link. Most take a
   short form or a pull request.

## Part F. Where to announce it (in this order)

Do not post everywhere on day one. Aim for a calm first week.

1. **GitHub README and npm page** (they are the first thing people see). The README already opens with `npx tockmux demo`.
2. **A 30-second demo video.** Make it with TockMux itself: a `.tmx` or HTML film that ends with the install command.
   This is also proof that the tool works. Post it as a GIF in the README (`--format gif --gif-width 720`).
3. **Developer communities** (read each community's self-promotion rules first):
   - Hacker News: "Show HN: TockMux, turn HTML animations into frame-perfect MP4 from the command line".
     Be present in the comments for the first few hours. Be honest about limits and about similar tools.
   - Reddit: r/node, r/javascript, r/webdev, r/SideProject, and the Claude/AI-tool communities. Several limit
     self-promotion; share it as a story ("I wanted to post Claude's HTML animations on TikTok, here is what I built").
   - Dev.to or Hashnode: write one tutorial, "Turn a Claude-written HTML animation into a TikTok video in 3 commands".
4. **MCP and AI-tool audiences:** MCP registry and directories (Part E), the "awesome MCP servers" lists, and AI
   Discord servers (follow their rules; do not spam).
5. **Product Hunt:** worth doing once you have a polished demo video, a few users and some feedback. Pick a Tuesday to Thursday.
6. **Social video:** TikTok, Reels, Shorts and X. Post videos made with TockMux and say how. Showing the "before
   (screen recording) and after" is the strongest hook.
7. **Your Discord (`Spidey_Moon`)** is the support channel on the landing page. Consider creating a small public server
   so users can help each other; put its invite link on the landing page later.

### What to say (copy to adapt)

> **TockMux** turns the HTML animation you already have (CSS, JavaScript, GSAP, canvas) into an MP4, GIF or WebM. It
> controls the browser's clock, so every frame is exact and identical on every computer. `--auto-fit` stretches the
> animation to match your voice-over. Install: `npm i -g tockmux`. There is also a drag-and-drop app and an MCP server so
> Claude or Cursor can make videos. Free, MIT. Honest limits: it needs pages that play by themselves.

## Part G. Things that protect you

- **Licences.** TockMux is MIT. It depends on `ffmpeg-static`, which downloads a prebuilt FFmpeg when users install it.
  Common FFmpeg builds include GPL-licensed parts (such as the H.264 encoder). Because TockMux does not ship FFmpeg
  inside your package, your package stays MIT, but **if you ever build a Docker image or an installer that contains
  the FFmpeg binary, check the FFmpeg and x264 licences first** (this is not legal advice).
- **Names and logos.** You can say "works with Claude" and "ElevenLabs integration". Do not use their logos or imply
  they endorse TockMux. ElevenLabs' terms apply to keys used through TockMux.
- **Do not promise "any HTML".** Say "any self-playing HTML animation" and link the limits table.
- **Do not host a public converter** unless you sandbox it (see `docs/05`).
- **Secrets.** Never commit API keys. `.gitignore` already excludes `.env`. TockMux stores keys in `~/.tockmux`, not in the project.
- **Security reports.** Add a `SECURITY.md` with a contact (your Discord or an email) once people use it.

## Launch checklist

- [ ] `npm view tockmux` still returns "not found" (name free)
- [ ] `repository`, `homepage`, `bugs` filled in `package.json`
- [ ] `npm test` passes on your machine
- [ ] Clean-room trial from the tarball works (`npx tockmux demo`)
- [ ] 2FA enabled on npm, `npm publish --access public` done
- [ ] GitHub repo public, topics added, v4.0.0 release created
- [ ] Landing page hosted, link added to `homepage` and the GitHub repo description
- [ ] Demo GIF in the README
- [ ] ElevenLabs flow tested with a **real** key
- [ ] MCP tested in Claude Desktop or Claude Code (`docs/04`)
- [ ] First announcement posted; you are available for questions that day
