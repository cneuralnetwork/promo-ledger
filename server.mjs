import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".md": "text/plain; charset=utf-8",
};

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (
    pathname.split("/").some((part) => part.startsWith(".") && part !== ".")
  ) {
    response.writeHead(404);
    response.end();
    return;
  }
  const target = resolve(
    root,
    "." + (pathname === "/" ? "/index.html" : pathname),
  );
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    const extension = target.slice(target.lastIndexOf("."));
    response.writeHead(200, {
      "Content-Type": types[extension] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(
      request.method === "HEAD" ? undefined : await readFile(target),
    );
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Promo Ledger is ready at http://127.0.0.1:${port}`),
);
