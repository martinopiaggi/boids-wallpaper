import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requestedPort = Number(process.env.PORT ?? 4173);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536
  ? requestedPort
  : 4173;
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const fileStat = await stat(file);
    if (!fileStat.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": fileStat.size,
      "Content-Type": mimeTypes.get(extname(file).toLowerCase()) ?? "application/octet-stream",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch (error) {
    const missing = error?.code === "ENOENT" || error?.code === "ENOTDIR";
    response.writeHead(missing ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(missing ? "Not found" : "Internal server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Boids wallpaper: http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
