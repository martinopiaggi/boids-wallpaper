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

function capInto(out, x, y, maximum) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maximum || magnitude === 0) {
    out.x = x;
    out.y = y;
    return out;
  }
  const scale = maximum / magnitude;
  out.x = x * scale;
  out.y = y * scale;
  return out;
}

function steerInto(out, x, y, velocityX, velocityY, speed, force) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.0001) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  return capInto(
    out,
    (x / magnitude) * speed - velocityX,
    (y / magnitude) * speed - velocityY,
    force,
  );
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
    this.baseMaxForce = Math.max(1, maxForce);
    this.separationWeight = separationWeight;
    this.alignmentWeight = alignmentWeight;
    this.cohesionWeight = cohesionWeight;
    this.boids = [];
    this.accelerations = [];
    this.grid = new Map();
    this.columns = 1;
    this.rows = 1;
    this.cellSize = this.perception;
    this.steerScratch = { x: 0, y: 0 };
    this.pointerScratch = { x: 0, y: 0 };
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

  get maxForce() {
    return this.baseMaxForce * this.speed;
  }

  setSpeed(value) {
    this.speed = clamp(Number.isFinite(value) ? value : 1, 0.1, 9);
    return this.speed;
  }

  setCount(value) {
    const next = clamp(Math.round(Number(value) || 0), 0, 4096);
    while (this.boids.length < next) this.boids.push(this.createBoid());
    while (this.accelerations.length < next) this.accelerations.push({ x: 0, y: 0 });
    this.boids.length = next;
    this.accelerations.length = next;
    return this.count;
  }

  reset(count = this.count) {
    this.boids.length = 0;
    return this.setCount(count);
  }

  createBoid() {
    const angle = this.random() * TAU;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const speed = this.minSpeed + this.random() * (this.maxSpeed - this.minSpeed);
    return {
      x: this.random() * this.width,
      y: this.random() * this.height,
      vx: cosine * speed,
      vy: sine * speed,
      fx: cosine,
      fy: sine,
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
    const cellSize = Math.max(1, Math.min(this.perception, shortestSide / 4));
    const columns = Math.max(4, Math.ceil(this.width / cellSize));
    const rows = Math.max(4, Math.ceil(this.height / cellSize));
    if (cellSize !== this.cellSize || columns !== this.columns || rows !== this.rows) {
      this.grid.clear();
    }
    this.cellSize = cellSize;
    this.columns = columns;
    this.rows = rows;
  }

  cellKey(x, y) {
    return x + y * this.columns;
  }

  positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  rebuildGrid() {
    for (const cell of this.grid.values()) cell.length = 0;
    for (let index = 0; index < this.boids.length; index += 1) {
      const boid = this.boids[index];
      const key = this.cellKey(
        Math.floor(boid.x / this.cellSize),
        Math.floor(boid.y / this.cellSize),
      );
      const cell = this.grid.get(key);
      if (cell) cell.push(index);
      else this.grid.set(key, [index]);
    }
  }

  pointerForce(boid, pointer) {
    const out = this.pointerScratch;
    out.x = 0;
    out.y = 0;
    if (!pointer?.active || this.boids.length === 0) return out;
    const mode = pointer.mode ?? "orbit";
    if (mode === "ignore") return out;

    let dx = pointer.x - boid.x;
    let dy = pointer.y - boid.y;
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;
    if (dx > halfWidth) dx -= this.width;
    else if (dx < -halfWidth) dx += this.width;
    if (dy > halfHeight) dy -= this.height;
    else if (dy < -halfHeight) dy += this.height;
    let distance = Math.hypot(dx, dy);
    const radius = Math.max(640, Math.min(this.width, this.height) * (mode === "follow" ? 0.95 : 0.85));
    if (distance >= radius) return out;
    if (distance < 0.001) {
      const angle = boid.phase * TAU;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }

    const radialX = dx / distance;
    const radialY = dy / distance;
    const falloff = (1 - distance / radius) ** 0.55;
    const force = this.maxForce * 4.5 * falloff;

    if (mode === "follow") {
      out.x = radialX * force;
      out.y = radialY * force;
      return out;
    }
    if (mode === "avoid") {
      out.x = -radialX * force;
      out.y = -radialY * force;
      return out;
    }

    const ring = Math.min(420, radius * 0.42);
    const ringError = clamp((distance - ring) / ring, -1, 1);
    out.x = -radialY * force * 1.35 + radialX * ringError * force * 1.1;
    out.y = radialX * force * 1.35 + radialY * ringError * force * 1.1;
    return out;
  }

  step(deltaSeconds, pointer = null) {
    const dt = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
    if (dt === 0 || this.boids.length === 0) return;
    this.updateGridGeometry();
    this.rebuildGrid();

    const perceptionSquared = this.cellSize * this.cellSize;
    const separationRadius = Math.min(this.separationRadius, this.cellSize * 0.48);
    const separationSquared = separationRadius * separationRadius;
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;
    const maxForce = this.maxForce;
    const maxSpeed = this.maxSpeed;

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
          const cell = this.grid.get(this.cellKey(
            this.positiveModulo(centerX + offsetX, this.columns),
            cellY,
          ));
          if (!cell) continue;

          for (let neighborSlot = 0; neighborSlot < cell.length; neighborSlot += 1) {
            const neighborIndex = cell[neighborSlot];
            if (neighborIndex === index) continue;
            const neighbor = this.boids[neighborIndex];
            let dx = neighbor.x - boid.x;
            let dy = neighbor.y - boid.y;
            if (dx > halfWidth) dx -= this.width;
            else if (dx < -halfWidth) dx += this.width;
            if (dy > halfHeight) dy -= this.height;
            else if (dy < -halfHeight) dy += this.height;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared > perceptionSquared) continue;

            neighbors += 1;
            alignmentX += neighbor.vx;
            alignmentY += neighbor.vy;
            cohesionX += dx;
            cohesionY += dy;
            if (distanceSquared < separationSquared && distanceSquared > 0.000001) {
              separationX -= dx / distanceSquared;
              separationY -= dy / distanceSquared;
            }
          }
        }
      }

      let accelerationX = 0;
      let accelerationY = 0;
      if (neighbors > 0) {
        const steer = steerInto(
          this.steerScratch,
          separationX,
          separationY,
          boid.vx,
          boid.vy,
          maxSpeed,
          maxForce,
        );
        accelerationX += steer.x * this.separationWeight;
        accelerationY += steer.y * this.separationWeight;
        const alignment = capInto(
          this.steerScratch,
          (alignmentX / neighbors - boid.vx) * this.alignmentWeight,
          (alignmentY / neighbors - boid.vy) * this.alignmentWeight,
          maxForce,
        );
        accelerationX += alignment.x;
        accelerationY += alignment.y;
        const cohesion = steerInto(
          this.steerScratch,
          cohesionX / neighbors,
          cohesionY / neighbors,
          boid.vx,
          boid.vy,
          maxSpeed,
          maxForce,
        );
        accelerationX += cohesion.x * this.cohesionWeight;
        accelerationY += cohesion.y * this.cohesionWeight;
      }

      const pointerSteering = this.pointerForce(boid, pointer);
      accelerationX += pointerSteering.x;
      accelerationY += pointerSteering.y;
      let acceleration = this.accelerations[index];
      if (!acceleration) {
        acceleration = { x: 0, y: 0 };
        this.accelerations[index] = acceleration;
      }
      const influenced = pointerSteering.x !== 0 || pointerSteering.y !== 0;
      capInto(acceleration, accelerationX, accelerationY, maxForce * (influenced ? 6 : 1.8));
    }

    const minSpeed = this.minSpeed;
    for (let index = 0; index < this.boids.length; index += 1) {
      const boid = this.boids[index];
      const acceleration = this.accelerations[index];
      boid.vx += acceleration.x * dt;
      boid.vy += acceleration.y * dt;

      let speed = Math.hypot(boid.vx, boid.vy);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        boid.vx *= scale;
        boid.vy *= scale;
        speed = maxSpeed;
      } else if (speed < minSpeed) {
        if (speed < 0.000001) {
          boid.vx = Math.cos(boid.phase * TAU) * minSpeed;
          boid.vy = Math.sin(boid.phase * TAU) * minSpeed;
        } else {
          const scale = minSpeed / speed;
          boid.vx *= scale;
          boid.vy *= scale;
        }
        speed = minSpeed;
      }
      const inverseSpeed = 1 / speed;
      boid.fx = boid.vx * inverseSpeed;
      boid.fy = boid.vy * inverseSpeed;

      boid.x = wrap(boid.x + boid.vx * dt, this.width);
      boid.y = wrap(boid.y + boid.vy * dt, this.height);
    }
  }
}
