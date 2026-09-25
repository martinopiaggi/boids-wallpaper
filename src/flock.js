export const TAU = Math.PI * 2;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function wrap(value, size) {
  return ((value % size) + size) % size;
}

export function wrappedDelta(fromX, fromY, toX, toY, width, height) {
  let dx = toX - fromX;
  let dy = toY - fromY;
  if (dx > width / 2) dx -= width;
  else if (dx < -width / 2) dx += width;
  if (dy > height / 2) dy -= height;
  else if (dy < -height / 2) dy += height;
  return { x: dx, y: dy };
}

export function createRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cap(x, y, maximum) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maximum || magnitude === 0) return { x, y };
  const scale = maximum / magnitude;
  return { x: x * scale, y: y * scale };
}

function steer(x, y, velocityX, velocityY, speed, force) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.0001) return { x: 0, y: 0 };
  const desiredX = (x / magnitude) * speed;
  const desiredY = (y / magnitude) * speed;
  return cap(desiredX - velocityX, desiredY - velocityY, force);
}

export class Flock {
  constructor({
    width = 1280,
    height = 720,
    count = 120,
    random = Math.random,
    perception = 104,
    separationRadius = 34,
    minSpeed = 46,
    maxSpeed = 96,
    maxForce = 310,
    speed = 1,
    separationWeight = 1.55,
    alignmentWeight = 1.05,
    cohesionWeight = 0.78,
  } = {}) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.random = random;
    this.perception = Math.max(1, perception);
    this.separationRadius = Math.max(1, separationRadius);
    this.baseMinSpeed = Math.max(0, minSpeed);
    this.baseMaxSpeed = Math.max(this.baseMinSpeed + 1, maxSpeed);
    this.maxForce = Math.max(1, maxForce);
    this.separationWeight = separationWeight;
    this.alignmentWeight = alignmentWeight;
    this.cohesionWeight = cohesionWeight;
    this.boids = [];
    this.accelerations = [];
    this.grid = new Map();
    this.columns = 1;
    this.rows = 1;
    this.cellSize = this.perception;
    this.speed = 1;
    this.setSpeed(speed);
    this.setCount(count);
  }

  get count() {
    return this.boids.length;
  }

  get minSpeed() {
    return this.baseMinSpeed * this.speed;
  }

  get maxSpeed() {
    return this.baseMaxSpeed * this.speed;
  }

  setSpeed(value) {
    this.speed = clamp(Number.isFinite(value) ? value : 1, 0.1, 4);
    return this.speed;
  }

  setCount(value) {
    const next = clamp(Math.round(Number(value) || 0), 0, 320);
    while (this.boids.length < next) this.boids.push(this.createBoid());
    if (this.boids.length > next) this.boids.length = next;
    this.accelerations.length = next;
    return this.count;
  }

  reset(count = this.count) {
    this.boids.length = 0;
    return this.setCount(count);
  }

  createBoid() {
    const angle = this.random() * TAU;
    const speed = this.minSpeed + this.random() * (this.maxSpeed - this.minSpeed);
    return {
      x: this.random() * this.width,
      y: this.random() * this.height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      phase: this.random(),
    };
  }

  resize(width, height) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    if (this.width > 0 && this.height > 0) {
      const scaleX = nextWidth / this.width;
      const scaleY = nextHeight / this.height;
      for (const boid of this.boids) {
        boid.x *= scaleX;
        boid.y *= scaleY;
      }
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.updateGridGeometry();
  }

  updateGridGeometry() {
    const shortestSide = Math.min(this.width, this.height);
    this.cellSize = Math.max(1, Math.min(this.perception, shortestSide / 4));
    this.columns = Math.max(4, Math.ceil(this.width / this.cellSize));
    this.rows = Math.max(4, Math.ceil(this.height / this.cellSize));
  }

  cellKey(x, y) {
    return `${x},${y}`;
  }

  positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  rebuildGrid() {
    this.grid.clear();
    for (let index = 0; index < this.boids.length; index += 1) {
      const boid = this.boids[index];
      const cellX = Math.floor(boid.x / this.cellSize);
      const cellY = Math.floor(boid.y / this.cellSize);
      const key = this.cellKey(cellX, cellY);
      const cell = this.grid.get(key);
      if (cell) cell.push(index);
      else this.grid.set(key, [index]);
    }
  }

  pointerForce(boid, pointer) {
    if (!pointer?.active || this.boids.length === 0) return { x: 0, y: 0 };
    const mode = pointer.mode ?? "orbit";
    if (mode === "ignore") return { x: 0, y: 0 };

    let dx = wrappedDelta(boid.x, boid.y, pointer.x, pointer.y, this.width, this.height).x;
    let dy = wrappedDelta(boid.x, boid.y, pointer.x, pointer.y, this.width, this.height).y;
    let distance = Math.hypot(dx, dy);
    const radius = mode === "follow" ? 330 : 270;
    if (distance >= radius) return { x: 0, y: 0 };
    if (distance < 0.001) {
      const angle = boid.phase * TAU;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }

    const radialX = dx / distance;
    const radialY = dy / distance;
    const falloff = (1 - distance / radius) ** 2;
    const force = this.maxForce * falloff;

    if (mode === "follow") {
      return { x: radialX * force, y: radialY * force };
    }
    if (mode === "avoid") {
      return { x: -radialX * force, y: -radialY * force };
    }

    const tangentX = -radialY;
    const tangentY = radialX;
    const ringError = clamp((distance - 135) / 135, -1, 1);
    return {
      x: tangentX * force * 0.72 - radialX * ringError * force * 0.3,
      y: tangentY * force * 0.72 - radialY * ringError * force * 0.3,
    };
  }

  step(deltaSeconds, pointer = null) {
    const dt = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
    if (dt === 0 || this.boids.length === 0) return;
    this.updateGridGeometry();
    this.rebuildGrid();

    const perceptionSquared = this.cellSize * this.cellSize;
    const separationRadius = Math.min(this.separationRadius, this.cellSize * 0.48);
    const separationSquared = separationRadius * separationRadius;

    for (let index = 0; index < this.boids.length; index += 1) {
      const boid = this.boids[index];
      const centerX = Math.floor(boid.x / this.cellSize);
      const centerY = Math.floor(boid.y / this.cellSize);
      let separationX = 0;
      let separationY = 0;
      let alignmentX = 0;
      let alignmentY = 0;
      let cohesionX = 0;
      let cohesionY = 0;
      let neighbors = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const cellY = this.positiveModulo(centerY + offsetY, this.rows);
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const cellX = this.positiveModulo(centerX + offsetX, this.columns);
          const cell = this.grid.get(this.cellKey(cellX, cellY));
          if (!cell) continue;

          for (const neighborIndex of cell) {
            if (neighborIndex === index) continue;
            const neighbor = this.boids[neighborIndex];
            const delta = wrappedDelta(boid.x, boid.y, neighbor.x, neighbor.y, this.width, this.height);
            const distanceSquared = delta.x * delta.x + delta.y * delta.y;
            if (distanceSquared > perceptionSquared) continue;

            neighbors += 1;
            alignmentX += neighbor.vx;
            alignmentY += neighbor.vy;
            cohesionX += delta.x;
            cohesionY += delta.y;
            if (distanceSquared < separationSquared && distanceSquared > 0.000001) {
              separationX -= delta.x / distanceSquared;
              separationY -= delta.y / distanceSquared;
            }
          }
        }
      }

      let accelerationX = 0;
      let accelerationY = 0;
      if (neighbors > 0) {
        const separation = steer(
          separationX,
          separationY,
          boid.vx,
          boid.vy,
          this.maxSpeed,
          this.maxForce,
        );
        const alignment = cap(
          (alignmentX / neighbors - boid.vx) * this.alignmentWeight,
          (alignmentY / neighbors - boid.vy) * this.alignmentWeight,
          this.maxForce,
        );
        const cohesion = steer(
          cohesionX / neighbors,
          cohesionY / neighbors,
          boid.vx,
          boid.vy,
          this.maxSpeed,
          this.maxForce,
        );
        accelerationX += separation.x * this.separationWeight;
        accelerationY += separation.y * this.separationWeight;
        accelerationX += alignment.x;
        accelerationY += alignment.y;
        accelerationX += cohesion.x * this.cohesionWeight;
        accelerationY += cohesion.y * this.cohesionWeight;
      }

      const pointerSteering = this.pointerForce(boid, pointer);
      accelerationX += pointerSteering.x;
      accelerationY += pointerSteering.y;
      const acceleration = cap(accelerationX, accelerationY, this.maxForce * 1.8);
      this.accelerations[index] = acceleration;
    }

    for (let index = 0; index < this.boids.length; index += 1) {
      const boid = this.boids[index];
      const acceleration = this.accelerations[index];
      boid.vx += acceleration.x * dt;
      boid.vy += acceleration.y * dt;

      let speed = Math.hypot(boid.vx, boid.vy);
      if (speed > this.maxSpeed) {
        const scale = this.maxSpeed / speed;
        boid.vx *= scale;
        boid.vy *= scale;
        speed = this.maxSpeed;
      } else if (speed < this.minSpeed) {
        if (speed < 0.000001) {
          boid.vx = Math.cos(boid.phase * TAU) * this.minSpeed;
          boid.vy = Math.sin(boid.phase * TAU) * this.minSpeed;
        } else {
          const scale = this.minSpeed / speed;
          boid.vx *= scale;
          boid.vy *= scale;
        }
      }

      boid.x = wrap(boid.x + boid.vx * dt, this.width);
      boid.y = wrap(boid.y + boid.vy * dt, this.height);
    }
  }

  scatter(strength = 235) {
    const amount = clamp(Number(strength) || 0, 0, 900);
    for (const boid of this.boids) {
      const angle = this.random() * TAU;
      boid.vx += Math.cos(angle) * amount;
      boid.vy += Math.sin(angle) * amount;
      const speed = Math.hypot(boid.vx, boid.vy);
      if (speed > this.maxSpeed * 1.35) {
        const scale = (this.maxSpeed * 1.35) / speed;
        boid.vx *= scale;
        boid.vy *= scale;
      }
    }
  }

  scatterAt(x, y, radius = 250, strength = 390) {
    const safeRadius = Math.max(1, radius);
    for (const boid of this.boids) {
      const delta = wrappedDelta(boid.x, boid.y, x, y, this.width, this.height);
      const distance = Math.hypot(delta.x, delta.y);
      if (distance >= safeRadius) continue;
      const angle = this.random() * TAU;
      const impulse = strength * (1 - distance / safeRadius);
      boid.vx += Math.cos(angle) * impulse;
      boid.vy += Math.sin(angle) * impulse;
    }
  }
}
