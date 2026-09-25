import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function json(name) {
  return JSON.parse(await readFile(new URL(name, root), "utf8"));
}

test("Lively package points to existing web runtime assets", async () => {
  const info = await json("LivelyInfo.json");
  assert.equal(info.Type, 1);
  assert.equal(info.FileName, "index.html");
  await Promise.all(
    [info.FileName, info.Thumbnail, info.Preview].map(path => access(new URL(path, root))),
  );
});

test("Lively properties use supported controls", async () => {
  const properties = await json("LivelyProperties.json");
  assert.equal(properties.trails, undefined);
  assert.equal(properties.glow, undefined);
  assert.equal(properties.palette, undefined);
  assert.equal(properties.scatter, undefined);
  assert.equal(properties.speed.value, 4);
  assert.equal(properties.count.value, 256);
  assert.equal(properties.count.max, 1024);
  const supported = new Set(["slider", "dropdown", "checkbox", "button"]);
  for (const [name, property] of Object.entries(properties)) {
    assert.ok(property.text, `${name} needs a label`);
    assert.ok(supported.has(property.type), `${name} has an unsupported type`);
    if (property.type === "slider") {
      assert.ok(property.min < property.max);
      assert.ok(property.value >= property.min && property.value <= property.max);
    }
  }
});
