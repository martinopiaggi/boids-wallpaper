import assert from "node:assert/strict";
import test from "node:test";
import { Flock, createRandom, wrap, wrappedDelta } from "../src/flock.js";
import { CONFIG } from "../src/config.js";

function flockWith(boids, options = {}) {
  const flock = new Flock({ width: 100, height: 100, random: createRandom(7), ...options });
  flock.boids = boids.map((boid) => ({ phase: 0, ...boid }));
  flock.accelerations.length = flock.boids.length;
  return flock;
}

test("wrap keeps values inside a toroidal world", () => {
  assert.equal(wrap(-1, 10), 9);
  assert.equal(wrap(11, 10), 1);
});

test("wrappedDelta chooses the short route across an edge", () => {
  assert.deepEqual(wrappedDelta(98, 50, 2, 50, 100, 100), { x: 4, y: 0 });
  assert.deepEqual(wrappedDelta(50, 98, 50, 2, 100, 100), { x: 0, y: 4 });
});

test("boids wrap around every edge", () => {
  const flock = flockWith([{ x: 99, y: 50, vx: 95, vy: 0 }], { count: 0 });
  flock.step(0.05);
  assert.ok(flock.boids[0].x > 3 && flock.boids[0].x < 5);
  assert.equal(flock.boids[0].y, 50);
});

test("separation pushes close boids apart", () => {
  const flock = flockWith([
    { x: 45, y: 50, vx: 0, vy: 0 },
    { x: 55, y: 50, vx: 0, vy: 0 },
  ], { count: 0 });
  flock.step(1 / 60);
  assert.ok(flock.boids[0].vx < 0);
  assert.ok(flock.boids[1].vx > 0);
});

test("alignment adopts a neighbor heading across the wrapped edge", () => {
  const flock = flockWith([
    { x: 3, y: 50, vx: 0, vy: 0 },
    { x: 97, y: 50, vx: 50, vy: 0 },
  ], { count: 0 });
  flock.step(1 / 60);
  assert.ok(flock.boids[0].vx > 0);
});

test("cursor avoidance pushes a boid away from the pointer", () => {
  const flock = flockWith([{ x: 50, y: 50, vx: 90, vy: 0 }], { count: 0 });
  flock.step(1 / 60, { x: 80, y: 50, active: true, mode: "avoid" });
  assert.ok(flock.boids[0].vx < 90);
});

test("cursor follow pulls a boid toward the pointer", () => {
  const flock = flockWith([{ x: 50, y: 50, vx: 90, vy: 0 }], { count: 0 });
  flock.step(1 / 60, { x: 80, y: 50, active: true, mode: "follow" });
  assert.ok(flock.boids[0].vx > 90);
});

test("speed remains within minimum and maximum limits", () => {
  const flock = flockWith([
    { x: 10, y: 10, vx: 0, vy: 0 },
    { x: 90, y: 90, vx: 900, vy: 0 },
  ], { count: 0, minSpeed: 40, maxSpeed: 100 });
  flock.step(1 / 60);
  for (const boid of flock.boids) {
    const speed = Math.hypot(boid.vx, boid.vy);
    assert.ok(speed >= 40 - 0.000001 && speed <= 100 + 0.000001);
  }
});

test("cursor influence is strong beyond the old 270px radius", () => {
  const flock = new Flock({ width: 2560, height: 1440, count: 1, speed: 4 });
  const boid = { x: 600, y: 720, vx: 0, vy: 384, phase: 0 };
  const force = flock.pointerForce(boid, { x: 1280, y: 720, active: true, mode: "orbit" });
  assert.ok(Math.hypot(force.x, force.y) > flock.maxForce * 3);
  assert.ok(force.x > 0, "outside the orbit, steer inward toward the pointer");
  assert.ok(force.y > 0, "retain tangential orbit steering");
});

test("orbit repels boids inside its ring instead of collapsing them onto the pointer", () => {
  const flock = new Flock({ width: 2560, height: 1440, count: 1, speed: 4 });
  const force = flock.pointerForce(
    { x: 1180, y: 720, vx: 0, vy: 384, phase: 0 },
    { x: 1280, y: 720, active: true, mode: "orbit" },
  );
  assert.ok(force.x < 0);
  assert.ok(force.y > 0);
});

test("inactive and ignored pointers do not steer the flock", () => {
  const flock = new Flock({ width: 2560, height: 1440, count: 1 });
  const boid = { x: 1280, y: 720, vx: 90, vy: 0, phase: 0 };
  for (const pointer of [
    { x: 1380, y: 720, active: false, mode: "orbit" },
    { x: 1380, y: 720, active: true, mode: "ignore" },
  ]) {
    assert.deepEqual(flock.pointerForce(boid, pointer), { x: 0, y: 0 });
  }
});

test("cross-species affinity attracts and repels", () => {
  const flock = flockWith([
    { x: 40, y: 50, vx: 0, vy: 0, species: 0 },
    { x: 55, y: 50, vx: 0, vy: 0, species: 2 },
  ], { count: 0 });
  flock.step(1 / 60);
  assert.ok(flock.boids[0].vx < 0, "species 0 flees the predator");
  assert.ok(flock.boids[1].vx < 0, "species 2 chases species 0");
});

test("species 0 and 1 bond while species 2 repels itself", () => {
  const { count, affinity } = CONFIG.species;
  const at = (from, to) => affinity[from * count + to];
  assert.ok(at(0, 1) > 0 && at(1, 0) > 0);
  assert.ok(at(2, 2) < 0);
});

test("count changes are deterministic with a seeded generator", () => {
  const first = new Flock({ width: 800, height: 600, count: 24, random: createRandom(99) });
  const second = new Flock({ width: 800, height: 600, count: 24, random: createRandom(99) });
  assert.deepEqual(first.boids, second.boids);
  assert.equal(first.setCount(40), 40);
  assert.equal(first.setCount(12), 12);
});

test("chaos field stays bounded and varies across the world", async () => {
  const { chaosFactor } = await import("../src/flock.js");
  let min = Infinity;
  let max = -Infinity;
  for (let x = 0; x < 4000; x += 137) {
    for (let y = 0; y < 3000; y += 131) {
      const value = chaosFactor(x, y, (x % 97) / 97, x * 0.01);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  assert.ok(min >= -1.15 && max <= 1.15, `out of range: ${min}..${max}`);
  assert.ok(max - min > 1, "field is too uniform to break up the flock");
});
