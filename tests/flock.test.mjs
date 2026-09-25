import assert from "node:assert/strict";
import test from "node:test";
import { Flock, createRandom, wrap, wrappedDelta } from "../src/flock.js";

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

test("count changes are deterministic with a seeded generator", () => {
  const first = new Flock({ width: 800, height: 600, count: 24, random: createRandom(99) });
  const second = new Flock({ width: 800, height: 600, count: 24, random: createRandom(99) });
  assert.deepEqual(first.boids, second.boids);
  assert.equal(first.setCount(40), 40);
  assert.equal(first.setCount(12), 12);
});
