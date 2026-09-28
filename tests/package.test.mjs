import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Windows package includes the wallpaper entry point and its module graph", async () => {
  const project = await readFile(new URL("windows/Boids.Desktop/Boids.Desktop.csproj", root), "utf8");
  assert.match(project, /index\.html;.*styles\.css/);
  assert.match(project, /src\\\*\.js/);
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /src="src\/main\.js"/);
  for (const path of ["styles.css", "src/main.js", "src/config.js", "src/flock.js", "src/webgpu.js", "src/host.js"])
    await access(new URL(path, root));
});
