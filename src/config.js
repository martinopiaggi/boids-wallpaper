// Single source of truth for simulation and presentation tuning.
//
// src/flock.js (CPU), src/webgpu.js (GPU) and src/main.js (runtime) all read
// these values, so the two backends cannot drift apart.
// The .NET host cannot import JavaScript; keep windows/Boids.Desktop/Program.cs
// in step by hand when you change a runtime range here.

export const CONFIG = Object.freeze({
  // Live controls. countMin..capacity is enforced in Flock.setCount and main.js.
  flock: Object.freeze({
    count: 2048,          // starting boids; the tray settings adjust this at runtime
    countMin: 20,
    speed: 6,             // global speed multiplier applied to minSpeed/maxSpeed/maxForce
    speedMin: 0.25,
    speedMax: 9,
    interaction: "orbit",
    interactions: Object.freeze(["orbit", "follow", "avoid", "ignore"]),
  }),

  animation: Object.freeze({
    fps: 120,                                  // fixed physics + presentation rate
    fpsOptions: Object.freeze([30, 60, 120]),
  }),

  // Interaction matrix, row = observer species, column = neighbour species.
  // > 0 approach, < 0 flee, 0 ignore. The diagonal is self-cohesion; keep it
  // below a positive off-diagonal value to make those two species pair up.
  // count is capped at 3 by the fixed uniform array in src/webgpu.js.
  species: Object.freeze({
    count: 3,
    affinity: Object.freeze([
      0.3, 0.95, -0.95,   // species 0 sees 0, 1, 2
      0.95, 0.3, -0.95,   // species 1 sees 0, 1, 2
      0.9, 0.9, -0.5,     // species 2 sees 0, 1, 2
    ]),
  }),

  // Per-boid steering. Values are pre-multiplier units (see flock.speed).
  boids: Object.freeze({
    perception: 104,        // neighbour radius, also sizes the spatial-hash cell
    separationRadius: 34,   // distance at which boids start pushing apart
    minSpeed: 46,
    maxSpeed: 96,
    maxForce: 310,
    separationWeight: 1.55,
    alignmentWeight: 1.05,
    cohesionWeight: 0.78,
  }),

  render: Object.freeze({
    capacity: 4096,         // GPU buffer size and hard ceiling for flock.count
    triangleDivisor: 118,   // triangle size = clamp(min(width, height) / divisor, min, max)
    triangleMin: 5.2,
    triangleMax: 8.8,
  }),
});
