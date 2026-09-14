#!/usr/bin/env node
/* Local preview that mirrors production.

     npm run serve      then open http://localhost:5288/library/

   The page is mounted at /library/ exactly as on datarail.org. /assets/* is
   fetched from the live site so the circuit rails render, and every other
   path redirects to the live site, which is where the library's links point.

   Port 5288 because 5173, 5199 and 4173 are already taken by other projects. */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const portArg = process.argv.find((a) => a.startsWith("--port="));
const PORT = Number(portArg ? portArg.slice("--port=".length) : 5288);
const DIST = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const LIVE = "https://datarail.org";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  try {
    if (path === "/") {
      res.writeHead(302, { Location: "/library/" });
      return res.end();
    }
    if (path === "/library") {
      res.writeHead(301, { Location: `/library/${url.search}` });
      return res.end();
    }

    if (path.startsWith("/library/")) {
      let file = resolve(DIST, `.${path.slice("/library".length)}`);
      /* Refuse anything that resolves outside dist/, such as an encoded ../ */
      if (file !== DIST && !file.startsWith(DIST + sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      const info = await stat(file).catch(() => null);
      if (info && info.isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      return res.end(body);
    }

    if (path.startsWith("/assets/")) {
      const upstream = await fetch(LIVE + path);
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream"
      });
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    }

    res.writeHead(302, { Location: LIVE + path + url.search });
    return res.end();
  } catch (err) {
    const missing = err.code === "ENOENT";
    res.writeHead(missing ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(missing ? "Not found. Has `npm run build` run?" : String(err));
  }
}).listen(PORT, () => {
  console.log(`Library preview: http://localhost:${PORT}/library/`);
});
