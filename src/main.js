import { Flock, clamp, createRandom } from "./flock.js";
import { GPU_CAPACITY, createGpuFlock } from "./webgpu.js";
import { attachHostBridge } from "./host.js";

let canvas = document.querySelector("#boids");
const errorBox = document.querySelector("#error");
const FOREGROUND = "#fff";

const TARGET_FPS = 120;
const FIXED_STEP = 1 / TARGET_FPS;
let frameMilliseconds = 1000 / TARGET_FPS;

const defaults = Object.freeze({
  count: 2048,
  speed: 6,
  fps: TARGET_FPS,
  interaction: "orbit",
});

const config = { ...defaults };
const pointer = { x: 0, y: 0, active: false, mode: config.interaction };
const interactionModes = Object.freeze(["orbit", "follow", "avoid", "ignore"]);

let width = 1;
let height = 1;
let hostPaused = false;
let pagePaused = document.hidden;
let contextLost = false;
let accumulator = 0;
let lastFrame = performance.now();
let nextFrameAt = 0;
let triangleSize = 6;
let animationFrame = null;
let renderContext;
let flock;
let gpu;
let backend = "none";
let frameCount = 0;
let elapsedRunning = 0;
let resizeObserver;
const nativeHost = new URLSearchParams(location.search).get("desktop") === "1" && window.chrome?.webview;
const hostBridge = nativeHost ? attachHostBridge(nativeHost, {
  configure: applyProperty,
  pause: setHostPaused,
  pointer: value => Object.assign(pointer, {
    x: value.x * Math.max(1, canvas.clientWidth),
    y: value.y * Math.max(1, canvas.clientHeight),
    active: value.active
  }),
  status: () => ({ backend, count: config.count, speed: config.speed, targetFps: config.fps,
    frames: frameCount, averageFps: elapsedRunning > 0 ? frameCount / elapsedRunning : 0 }),
}) : null;

function showError(error) {
  console.error(error);
  hostBridge?.error(error);
  if (!errorBox) return;
  errorBox.hidden = false;
  errorBox.textContent = "The wallpaper could not start. Reload this page to try again.";
}

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDropdown(value, items, fallback) {
  const name = String(value ?? "").toLowerCase();
  if (/^-?\d+$/.test(name)) {
    const index = Number(name);
    if (Number.isInteger(index) && index >= 0 && index < items.length) return items[index];
  }
  return items.includes(name) ? name : fallback;
}

function applyProperty(name, value) {
  switch (name) {
    case "count":
      config.count = clamp(Math.round(parseNumber(value, config.count)), 20, GPU_CAPACITY);
      gpu?.setCount(config.count);
      flock?.setCount(config.count);
      break;
    case "speed":
      config.speed = clamp(parseNumber(value, config.speed), 0.25, 9);
      gpu?.setSpeed(config.speed);
      flock?.setSpeed(config.speed);
      break;
    case "fps":
      config.fps = [30, 60, 120].includes(Number(value)) ? Number(value) : config.fps;
      frameMilliseconds = 1000 / config.fps;
      nextFrameAt = performance.now();
      break;
    case "interaction":
      config.interaction = normalizeDropdown(value, interactionModes, config.interaction);
      pointer.mode = config.interaction;
      gpu?.setMode(config.interaction);
      break;
    default:
      break;
  }
}

function setHostPaused(value) {
  hostPaused = Boolean(value);
  accumulator = 0;
  synchronizeLoop();
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  width = Math.max(1, rect.width);
  height = Math.max(1, rect.height);
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const renderWidth = Math.max(1, Math.round(width * ratio));
  const renderHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }

  triangleSize = clamp(Math.min(width, height) / 118, 5.2, 8.8);
  if (backend === "webgpu") {
    gpu.resize(width, height);
    return;
  }
  if (!renderContext) return;
  renderContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  renderContext.imageSmoothingEnabled = false;
  flock?.resize(width, height);
  renderContext.clearRect(0, 0, width, height);
}

function render(context) {
  context.clearRect(0, 0, width, height);
  context.beginPath();
  context.fillStyle = FOREGROUND;
  const length = triangleSize;
  const backScale = length * 0.58;
  const halfWidth = length * 0.48;
  const boids = flock.boids;
  for (let index = 0; index < boids.length; index += 1) {
    const boid = boids[index];
    const cosine = boid.fx;
    const sine = boid.fy;
    const backX = boid.x - cosine * backScale;
    const backY = boid.y - sine * backScale;
    const offsetX = sine * halfWidth;
    const offsetY = cosine * halfWidth;
    context.moveTo(boid.x + cosine * length, boid.y + sine * length);
    context.lineTo(backX - offsetX, backY + offsetY);
    context.lineTo(backX + offsetX, backY - offsetY);
    context.closePath();
  }
  context.fill();
}

function isRunning() {
  return backend !== "none" && !hostPaused && !pagePaused && !contextLost && !document.hidden;
}

function stopLoop() {
  accumulator = 0;
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function scheduleFrame() {
  if (isRunning() && animationFrame === null) animationFrame = requestAnimationFrame(frame);
}

function synchronizeLoop() {
  if (!isRunning()) {
    stopLoop();
    return;
  }
  if (animationFrame === null) {
    lastFrame = performance.now();
    nextFrameAt = lastFrame;
    scheduleFrame();
  }
}

function frame(now) {
  animationFrame = null;
  if (!isRunning()) return;
  if (now + 0.5 < nextFrameAt) {
    scheduleFrame();
    return;
  }

  if (gpu?.lost) {
    stopLoop();
    try {
      startCanvasFallback();
      resize();
      hostBridge?.ready();
      synchronizeLoop();
    } catch (error) {
      showError(error);
    }
    return;
  }
  const elapsed = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  accumulator = Math.min(accumulator + elapsed, 0.1);
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 8) {
    if (backend !== "webgpu") flock.step(FIXED_STEP, pointer);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (backend === "webgpu") gpu.tick(steps, FIXED_STEP, pointer);
  else render(renderContext);
  frameCount += 1;
  elapsedRunning += elapsed;
  nextFrameAt += frameMilliseconds;
  if (nextFrameAt <= now - frameMilliseconds) nextFrameAt = now + frameMilliseconds;
  scheduleFrame();
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = clamp(event.clientX - rect.left, 0, width);
  pointer.y = clamp(event.clientY - rect.top, 0, height);
  pointer.active = true;
}

function installCanvasInteractions() {
  if (!nativeHost) {
    canvas.addEventListener("pointermove", updatePointer, { passive: true });
    canvas.addEventListener("pointerenter", updatePointer, { passive: true });
    canvas.addEventListener("pointerleave", () => { pointer.active = false; });
  }
}

function installInteractions() {
  installCanvasInteractions();
  window.addEventListener("keydown", event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Space") {
      event.preventDefault();
      setHostPaused(!hostPaused);
    } else if (event.key.toLowerCase() === "f") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  document.addEventListener("visibilitychange", () => {
    pagePaused = document.hidden;
    synchronizeLoop();
  });
  canvas.addEventListener("contextlost", event => {
    event.preventDefault();
    contextLost = true;
    synchronizeLoop();
  });
  canvas.addEventListener("contextrestored", () => {
    contextLost = false;
    resize();
    synchronizeLoop();
  });
  window.addEventListener("resize", resize, { passive: true });
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
}

function exposeLivelyBridge() {
  window.boidsApplyProperty = applyProperty;
  window.boidsSetPaused = setHostPaused;
  for (const [name, value] of window.__boidsPendingProperties ?? []) applyProperty(name, value);
  window.__boidsPendingProperties?.clear();
  if (typeof window.__boidsPendingPaused === "boolean") {
    setHostPaused(window.__boidsPendingPaused);
  }
}

function startCanvasFallback() {
  gpu?.dispose();
  gpu = null;
  // Canvas contexts cannot change type once acquired, including after failed GPU initialization.
  const replacement = canvas.cloneNode(false);
  resizeObserver?.disconnect();
  canvas.replaceWith(replacement);
  canvas = replacement;
  renderContext = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!renderContext) throw new Error("Canvas 2D is unavailable");
  flock = new Flock({ width, height, count: config.count, speed: config.speed, random: createRandom(0xb01d5) });
  backend = "canvas";
  if (resizeObserver) {
    installCanvasInteractions();
    resizeObserver.observe(canvas);
  }
}

async function start() {
  exposeLivelyBridge();
  const rect = canvas.getBoundingClientRect();
  width = Math.max(1, rect.width);
  height = Math.max(1, rect.height);
  try {
    gpu = await createGpuFlock(canvas, {
      width,
      height,
      count: config.count,
      speed: config.speed,
      random: createRandom(0xb01d5),
    });
    gpu.setCount(config.count);
    gpu.setSpeed(config.speed);
    gpu.setMode(config.interaction);
    backend = "webgpu";
  } catch (error) {
    console.warn(error);
    startCanvasFallback();
  }
  installInteractions();
  resize();
  hostBridge?.ready();
  synchronizeLoop();
}

start().catch(error => {
  showError(error);
  stopLoop();
});
