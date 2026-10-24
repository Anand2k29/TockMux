import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".map": "application/json"
};

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/**
 * Serves a folder on 127.0.0.1 so pages can use relative assets, fetch() and ES modules
 * (none of which work reliably over file://). `virtualFiles` maps URL paths to in-memory
 * strings, used for compiled .tmx pages and uploads.
 */
export async function startStaticServer(root, { virtualFiles = {} } = {}) {
  const rootAbs = path.resolve(root);
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname);
      if (Object.prototype.hasOwnProperty.call(virtualFiles, rel)) {
        const body = Buffer.from(virtualFiles[rel]);
        res.writeHead(200, { "Content-Type": mimeFor(rel), "Content-Length": body.length, "Cache-Control": "no-store" });
        return res.end(req.method === "HEAD" ? undefined : body);
      }
      const target = path.resolve(rootAbs, "." + path.posix.normalize("/" + rel));
      if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      let stat;
      try {
        stat = fs.statSync(target);
      } catch {
        res.writeHead(404);
        return res.end("Not found");
      }
      if (stat.isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const headers = { "Content-Type": mimeFor(target), "Cache-Control": "no-store", "Accept-Ranges": "bytes" };
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (!m || !m[1]) {
          start = Math.max(0, stat.size - (m && m[2] ? parseInt(m[2], 10) : 0));
          end = stat.size - 1;
        }
        end = Math.min(end, stat.size - 1);
        if (start > end || start >= stat.size) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
        if (req.method === "HEAD") return res.end();
        return fs.createReadStream(target, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...headers, "Content-Length": stat.size });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(target).pipe(res);
    } catch {
      res.writeHead(500);
      res.end("Server error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
    port
  };
}
