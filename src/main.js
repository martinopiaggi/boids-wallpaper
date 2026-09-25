import { Flock, clamp, createRandom } from "./flock.js";

const canvas = document.querySelector("#boids");
const errorBox = document.querySelector("#error");

const defaults = Object.freeze({
  count: 128,
  speed: 1.15,
  palette: "aurora",
  interaction: "orbit",
});

const config = { ...defaults };
const pointer = { x: 0, y: 0, active: false, mode: config.interaction, lastMove: 0 };
const palettes = Object.freeze({
  aurora: { hue: 154, spread: 104, saturation: 92, light: 62 },
  ice: { hue: 188, spread: 72, saturation: 82, light: 66 },
  ember: { hue: 8, spread: 58, saturation: 91, light: 61 },
  mono: { hue: 205, spread: 18, saturation: 18, light: 82 },
});
const paletteNames = Object.freeze(Object.keys(palettes));
const interactionModes = Object.freeze(["orbit", "follow", "avoid", "ignore"]);

let width = 1;
let height = 1;
let hostPaused = false;
let pagePaused = document.hidden;
let contextLost = false;
let accumulator = 0;
let lastFrame = performance.now();
let lastPointerDown = 0;
let animationFrame = null;
let renderContext;
let flock;

function showError(error) {
  console.error(error);
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

function normalizePalette(value) {
  return normalizeDropdown(value, paletteNames, config.palette);
}

function normalizeInteraction(value) {
  return normalizeDropdown(value, interactionModes, config.interaction);
}

function applyProperty(name, value) {
  switch (name) {
    case "count":
      config.count = clamp(Math.round(parseNumber(value, config.count)), 20, 280);
      flock?.setCount(config.count);
      break;
    case "speed":
      config.speed = clamp(parseNumber(value, config.speed), 0.25, 2.5);
      flock?.setSpeed(config.speed);
      break;
    case "palette":
      config.palette = normalizePalette(value);
      break;
    case "interaction":
      config.interaction = normalizeInteraction(value);
      pointer.mode = config.interaction;
      break;
    case "scatter":
      scatter();
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

  renderContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  flock?.resize(width, height);
  renderContext.fillStyle = "#02040b";
  renderContext.fillRect(0, 0, width, height);
}

function trianglePath(context, boid, length) {
  const angle = Math.atan2(boid.vy, boid.vx);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const noseX = boid.x + cosine * length;
  const noseY = boid.y + sine * length;
  const backX = boid.x - cosine * length * 0.58;
  const backY = boid.y - sine * length * 0.58;
  const halfWidth = length * 0.48;
  context.beginPath();
  context.moveTo(noseX, noseY);
  context.lineTo(backX - sine * halfWidth, backY + cosine * halfWidth);
  context.lineTo(backX + sine * halfWidth, backY - cosine * halfWidth);
  context.closePath();
}

function boidColor(boid) {
  const palette = palettes[config.palette] ?? palettes.aurora;
  const speed = Math.hypot(boid.vx, boid.vy);
  const speedMix = clamp((speed / Math.max(1, flock.maxSpeed) - 0.45) / 0.8, 0, 1);
  const hue = (palette.hue + boid.phase * palette.spread + speedMix * 22 + 360) % 360;
  const light = palette.light + speedMix * 5;
  return `hsla(${hue.toFixed(1)}, ${palette.saturation}%, ${light.toFixed(1)}%, 0.92)`;
}

function render(context) {
  context.globalAlpha = 1;
  context.fillStyle = "#02040b";
  context.fillRect(0, 0, width, height);

  const size = clamp(Math.min(width, height) / 118, 5.2, 8.8);
  for (const boid of flock.boids) {
    context.fillStyle = boidColor(boid);
    trianglePath(context, boid, size);
    context.fill();
  }
}

function isRunning() {
  return Boolean(flock && !hostPaused && !pagePaused && !contextLost && !document.hidden);
}

function synchronizeLoop() {
  if (!isRunning()) {
    accumulator = 0;
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    return;
  }
  if (animationFrame === null) {
    lastFrame = performance.now();
    animationFrame = requestAnimationFrame(frame);
  }
}

function frame(now) {
  animationFrame = null;
  if (!isRunning()) return;
  const elapsed = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  accumulator = Math.min(accumulator + elapsed, 0.1);
  const fixedStep = 1 / 60;
  let steps = 0;
  while (accumulator >= fixedStep && steps < 4) {
    if (performance.now() - pointer.lastMove > 2400) pointer.active = false;
    flock.step(fixedStep, pointer);
    accumulator -= fixedStep;
    steps += 1;
  }
  render(renderContext);
  animationFrame = requestAnimationFrame(frame);
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = clamp(event.clientX - rect.left, 0, width);
  pointer.y = clamp(event.clientY - rect.top, 0, height);
  pointer.active = true;
  pointer.lastMove = performance.now();
}

function scatter() {
  if (!flock) return;
  if (pointer.active) flock.scatterAt(pointer.x, pointer.y, 280, 430);
  else flock.scatter(245);
}

function installInteractions() {
  canvas.addEventListener("pointermove", updatePointer, { passive: true });
  canvas.addEventListener("pointerenter", updatePointer, { passive: true });
  canvas.addEventListener("pointerleave", () => {
    pointer.active = false;
  });
  canvas.addEventListener("pointerdown", event => {
    const now = performance.now();
    if (now - lastPointerDown < 90) return;
    lastPointerDown = now;
    updatePointer(event);
    scatter();
  });
  window.addEventListener("keydown", event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Space") {
      event.preventDefault();
      setHostPaused(!hostPaused);
    } else if (event.key.toLowerCase() === "r") {
      scatter();
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
  new ResizeObserver(resize).observe(canvas);
}

function exposeLivelyBridge() {
  window.boidsApplyProperty = applyProperty;
  window.boidsSetPaused = setHostPaused;
  window.boidsScatter = scatter;
  for (const [name, value] of window.__boidsPendingProperties ?? []) applyProperty(name, value);
  window.__boidsPendingProperties?.clear();
  if (typeof window.__boidsPendingPaused === "boolean") {
    setHostPaused(window.__boidsPendingPaused);
  }
}

function start() {
  renderContext = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!renderContext) throw new Error("Canvas 2D is unavailable");
  flock = new Flock({
    width,
    height,
    count: config.count,
    speed: config.speed,
    random: createRandom(0xb01d5),
  });
  installInteractions();
  resize();
  exposeLivelyBridge();
  synchronizeLoop();
}

try {
  start();
} catch (error) {
  showError(error);
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
}
