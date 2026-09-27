import { clamp, createRandom } from "./flock.js";

export const GPU_CAPACITY = 4096;
const STRIDE_FLOATS = 8;
const STRIDE_BYTES = STRIDE_FLOATS * 4;
const MODES = Object.freeze({ orbit: 0, follow: 1, avoid: 2, ignore: 3 });

const SHADER = /* wgsl */ `
struct Boid {
  position: vec2<f32>,
  velocity: vec2<f32>,
  phase: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

struct Sim {
  width: f32,
  height: f32,
  dt: f32,
  count: f32,
  min_speed: f32,
  max_speed: f32,
  max_force: f32,
  perception: f32,
  separation_radius: f32,
  pointer_x: f32,
  pointer_y: f32,
  pointer_active: f32,
  pointer_mode: f32,
  triangle_size: f32,
  time: f32,
  padding1: f32,
}

@group(0) @binding(0) var<storage, read> source_boids: array<Boid>;
@group(0) @binding(1) var<storage, read_write> destination_boids: array<Boid>;
@group(0) @binding(2) var<uniform> sim: Sim;

fn shortest(delta: f32, size: f32) -> f32 {
  if (delta > size * 0.5) { return delta - size; }
  if (delta < -size * 0.5) { return delta + size; }
  return delta;
}

fn wrap_position(value: f32, size: f32) -> f32 {
  return fract(value / size) * size;
}

fn limit(vector: vec2<f32>, maximum: f32) -> vec2<f32> {
  let magnitude = length(vector);
  if (magnitude <= maximum || magnitude == 0.0) { return vector; }
  return vector * (maximum / magnitude);
}

fn steer(direction: vec2<f32>, velocity: vec2<f32>, speed: f32, force: f32) -> vec2<f32> {
  let magnitude = length(direction);
  if (magnitude < 0.0001) { return vec2<f32>(0.0); }
  return limit(direction / magnitude * speed - velocity, force);
}

fn chaos_factor(position: vec2<f32>, phase: f32) -> f32 {
  let band = sin(position.x * 0.0045 + sim.time * 0.6) * sin(position.y * 0.0052 - sim.time * 0.43);
  return band * 0.7 + (phase * 2.0 - 1.0) * 0.45;
}

fn pointer_force(position: vec2<f32>, phase: f32) -> vec2<f32> {
  if (sim.pointer_active < 0.5 || sim.pointer_mode > 2.5) { return vec2<f32>(0.0); }
  var dx = shortest(sim.pointer_x - position.x, sim.width);
  var dy = shortest(sim.pointer_y - position.y, sim.height);
  var distance = length(vec2<f32>(dx, dy));
  let screen = min(sim.width, sim.height);
  let radius = max(640.0, screen * select(0.85, 0.95, sim.pointer_mode > 0.5 && sim.pointer_mode < 1.5));
  if (distance >= radius) { return vec2<f32>(0.0); }
  if (distance < 0.001) {
    let angle = phase * 6.283185307179586;
    dx = cos(angle);
    dy = sin(angle);
    distance = 1.0;
  }
  let radial = vec2<f32>(dx, dy) / distance;
  let falloff = pow(1.0 - distance / radius, 0.55);
  let force = sim.max_force * 4.5 * falloff;
  if (sim.pointer_mode > 0.5 && sim.pointer_mode < 1.5) { return radial * force; }
  if (sim.pointer_mode > 1.5) { return -radial * force; }
  let tangent = vec2<f32>(-radial.y, radial.x);
  let ring = min(420.0, radius * 0.42);
  let ring_error = clamp((distance - ring) / ring, -1.0, 1.0);
  return tangent * force * 1.35 + radial * ring_error * force * 1.1;
}

@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let count = u32(sim.count);
  if (index >= count) { return; }

  let boid = source_boids[index];
  let perception_squared = sim.perception * sim.perception;
  let separation_squared = sim.separation_radius * sim.separation_radius;
  var separation = vec2<f32>(0.0);
  var alignment = vec2<f32>(0.0);
  var cohesion = vec2<f32>(0.0);
  var neighbors = 0.0;

  for (var other = 0u; other < count; other++) {
    if (other == index) { continue; }
    let neighbor = source_boids[other];
    let delta = vec2<f32>(
      shortest(neighbor.position.x - boid.position.x, sim.width),
      shortest(neighbor.position.y - boid.position.y, sim.height),
    );
    let distance_squared = dot(delta, delta);
    if (distance_squared > perception_squared) { continue; }
    neighbors += 1.0;
    alignment += neighbor.velocity;
    cohesion += delta;
    if (distance_squared < separation_squared && distance_squared > 0.000001) {
      separation -= delta / distance_squared;
    }
  }

  var acceleration = vec2<f32>(0.0);
  if (neighbors > 0.0) {
    let chaos = chaos_factor(boid.position, boid.phase);
    acceleration += steer(separation, boid.velocity, sim.max_speed, sim.max_force) * 1.55 * (1.0 + chaos * 0.2);
    acceleration += limit((alignment / neighbors - boid.velocity) * 1.05 * (1.0 - chaos * 0.5), sim.max_force);
    acceleration += steer(cohesion / neighbors, boid.velocity, sim.max_speed, sim.max_force) * 0.78 * (1.0 + chaos * 1.2);
  }
  let pointer_steering = pointer_force(boid.position, boid.phase);
  acceleration += pointer_steering;
  let influenced = any(pointer_steering != vec2<f32>(0.0));
  acceleration = limit(acceleration, sim.max_force * select(1.8, 6.0, influenced));

  var velocity = boid.velocity + acceleration * sim.dt;
  let speed = length(velocity);
  if (speed > sim.max_speed) {
    velocity *= sim.max_speed / speed;
  } else if (speed < sim.min_speed) {
    if (speed < 0.000001) {
      let angle = boid.phase * 6.283185307179586;
      velocity = vec2<f32>(cos(angle), sin(angle)) * sim.min_speed;
    } else {
      velocity *= sim.min_speed / speed;
    }
  }

  destination_boids[index] = Boid(
    vec2<f32>(
      wrap_position(boid.position.x + velocity.x * sim.dt, sim.width),
      wrap_position(boid.position.y + velocity.y * sim.dt, sim.height),
    ),
    velocity,
    boid.phase,
    0.0,
    0.0,
    0.0,
  );
}

`;

const RENDER_SHADER = /* wgsl */ `
struct Boid {
  position: vec2<f32>,
  velocity: vec2<f32>,
  phase: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
}

struct Sim {
  width: f32,
  height: f32,
  dt: f32,
  count: f32,
  min_speed: f32,
  max_speed: f32,
  max_force: f32,
  perception: f32,
  separation_radius: f32,
  pointer_x: f32,
  pointer_y: f32,
  pointer_active: f32,
  pointer_mode: f32,
  triangle_size: f32,
  time: f32,
  padding1: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> render_boids: array<Boid>;
@group(0) @binding(1) var<uniform> render_sim: Sim;

@vertex
fn vertex_main(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) instance: u32,
) -> VertexOutput {
  let boid = render_boids[instance];
  let speed = max(length(boid.velocity), 0.000001);
  let cosine = boid.velocity.x / speed;
  let sine = boid.velocity.y / speed;
  let body = render_sim.triangle_size;
  let back = boid.position - vec2<f32>(cosine, sine) * body * 0.58;
  let half = body * 0.48;
  var point = boid.position + vec2<f32>(cosine, sine) * body;
  if (vertex != 0u) {
    let side = select(-1.0, 1.0, vertex == 2u);
    point = back + vec2<f32>(sine, -cosine) * half * side;
  }
  var output: VertexOutput;
  output.position = vec4<f32>(
    point.x / render_sim.width * 2.0 - 1.0,
    1.0 - point.y / render_sim.height * 2.0,
    0.0,
    1.0,
  );
  return output;
}

@fragment
fn fragment_main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebGPU initialization timed out")), milliseconds);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createState(random, count, width, height, minSpeed, maxSpeed) {
  const state = new Float32Array(GPU_CAPACITY * STRIDE_FLOATS);
  for (let index = 0; index < count; index += 1) {
    const offset = index * STRIDE_FLOATS;
    const angle = random() * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const flight = minSpeed + random() * (maxSpeed - minSpeed);
    state[offset] = random() * width;
    state[offset + 1] = random() * height;
    state[offset + 2] = cosine * flight;
    state[offset + 3] = sine * flight;
    state[offset + 4] = random();
  }
  return state;
}

export async function createGpuFlock(canvas, {
  width,
  height,
  count,
  speed,
  random = createRandom(0xb01d5),
} = {}) {
  if (!navigator.gpu) throw new Error("WebGPU is unavailable");
  const adapter = await withTimeout(
    navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
    2000,
  );
  if (!adapter) throw new Error("No WebGPU adapter");
  const device = await withTimeout(adapter.requestDevice(), 2000);
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("WebGPU canvas context is unavailable");
  const format = navigator.gpu.getPreferredCanvasFormat();
  const computeShader = device.createShaderModule({ code: SHADER });
  const renderShader = device.createShaderModule({ code: RENDER_SHADER });
  const compilations = await Promise.all([
    computeShader.getCompilationInfo(),
    renderShader.getCompilationInfo(),
  ]);
  const errors = compilations.flatMap(info => info.messages.filter(message => message.type === "error"));
  if (errors.length > 0) throw new Error(errors.map(message => message.message).join("\n"));

  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const renderLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });
  const uniformBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const boidBuffers = [0, 1].map(() => device.createBuffer({
    size: GPU_CAPACITY * STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }));
  const computeGroups = [0, 1].map(index => device.createBindGroup({
    layout: computeLayout,
    entries: [
      { binding: 0, resource: { buffer: boidBuffers[index] } },
      { binding: 1, resource: { buffer: boidBuffers[1 - index] } },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  }));
  const renderGroups = boidBuffers.map(buffer => device.createBindGroup({
    layout: renderLayout,
    entries: [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: { buffer: uniformBuffer } },
    ],
  }));
  const computePipeline = await device.createComputePipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
    compute: { module: computeShader, entryPoint: "simulate" },
  });
  const renderPipeline = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
    vertex: { module: renderShader, entryPoint: "vertex_main" },
    fragment: { module: renderShader, entryPoint: "fragment_main", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  const uniform = new Float32Array(16);
  const baseMinSpeed = 46;
  const baseMaxSpeed = 96;
  const baseMaxForce = 310;
  const state = {
    width: Math.max(1, width),
    height: Math.max(1, height),
    count: clamp(Math.round(count) || 0, 0, GPU_CAPACITY),
    speed: clamp(Number.isFinite(speed) ? speed : 1, 0.1, 9),
    mode: 0,
    readIndex: 0,
    time: 0,
    random,
    lost: false,
  };

  function uploadAll(nextCount) {
    const data = createState(
      state.random,
      nextCount,
      state.width,
      state.height,
      baseMinSpeed * state.speed,
      baseMaxSpeed * state.speed,
    );
    for (const buffer of boidBuffers) device.queue.writeBuffer(buffer, 0, data);
  }

  function configure() {
    context.configure({ device, format, alphaMode: "opaque" });
  }

  uploadAll(state.count);
  configure();
  device.lost.then(() => {
    state.lost = true;
  });

  return {
    kind: "webgpu",
    get lost() {
      return state.lost;
    },
    resize(nextWidth, nextHeight) {
      state.width = Math.max(1, nextWidth);
      state.height = Math.max(1, nextHeight);
      configure();
    },
    setCount(value) {
      const next = clamp(Math.round(Number(value) || 0), 0, GPU_CAPACITY);
      if (next > state.count) {
        const data = createState(
          state.random,
          next,
          state.width,
          state.height,
          baseMinSpeed * state.speed,
          baseMaxSpeed * state.speed,
        );
        const added = data.subarray(state.count * STRIDE_FLOATS, next * STRIDE_FLOATS);
        for (const buffer of boidBuffers) {
          device.queue.writeBuffer(buffer, state.count * STRIDE_BYTES, added);
        }
      }
      state.count = next;
    },
    setSpeed(value) {
      state.speed = clamp(Number.isFinite(value) ? value : 1, 0.1, 9);
    },
    setMode(mode) {
      state.mode = MODES[mode] ?? 0;
    },
    tick(steps, dt, pointer) {
      if (state.lost || canvas.width < 1 || canvas.height < 1) return;
      const range = Math.max(1, Math.min(104, Math.min(state.width, state.height) / 4));
      uniform[0] = state.width;
      uniform[1] = state.height;
      uniform[2] = dt;
      uniform[3] = state.count;
      uniform[4] = baseMinSpeed * state.speed;
      uniform[5] = baseMaxSpeed * state.speed;
      uniform[6] = baseMaxForce * state.speed;
      uniform[7] = range;
      uniform[8] = Math.min(34, range * 0.48);
      uniform[9] = pointer?.x ?? 0;
      uniform[10] = pointer?.y ?? 0;
      uniform[11] = pointer?.active ? 1 : 0;
      uniform[12] = MODES[pointer?.mode] ?? state.mode;
      uniform[13] = clamp(Math.min(state.width, state.height) / 118, 5.2, 8.8);
      state.time += steps * dt;
      uniform[14] = state.time;
      device.queue.writeBuffer(uniformBuffer, 0, uniform);

      const encoder = device.createCommandEncoder();
      for (let step = 0; step < steps; step += 1) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, computeGroups[state.readIndex]);
        pass.dispatchWorkgroups(Math.max(1, Math.ceil(state.count / 64)));
        pass.end();
        state.readIndex ^= 1;
      }
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(0, renderGroups[state.readIndex]);
      if (state.count > 0) renderPass.draw(3, state.count);
      renderPass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      for (const buffer of boidBuffers) buffer.destroy();
      uniformBuffer.destroy();
      device.destroy();
    },
  };
}
