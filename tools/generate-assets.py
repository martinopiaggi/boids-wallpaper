from __future__ import annotations

import colorsys
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
TAU = math.tau


class Point:
    def __init__(self, x: float, y: float, vx: float, vy: float, phase: float) -> None:
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.phase = phase


def make_flock(width: int, height: int, count: int, seed: int) -> list[Point]:
    rng = random.Random(seed)
    flock = []
    for _ in range(count):
        angle = rng.random() * TAU
        speed = rng.uniform(46, 96)
        flock.append(
            Point(
                rng.random() * width,
                rng.random() * height,
                math.cos(angle) * speed,
                math.sin(angle) * speed,
                rng.random(),
            )
        )
    return flock


def delta(x1: float, y1: float, x2: float, y2: float, width: int, height: int) -> tuple[float, float]:
    dx = x2 - x1
    dy = y2 - y1
    if dx > width / 2:
        dx -= width
    elif dx < -width / 2:
        dx += width
    if dy > height / 2:
        dy -= height
    elif dy < -height / 2:
        dy += height
    return dx, dy


def wrap(value: float, size: int) -> float:
    return (value + size) % size


def cap(x: float, y: float, maximum: float) -> tuple[float, float]:
    magnitude = math.hypot(x, y)
    if magnitude <= maximum or magnitude == 0:
        return x, y
    scale = maximum / magnitude
    return x * scale, y * scale


def steer(
    x: float,
    y: float,
    velocity_x: float,
    velocity_y: float,
    speed: float,
    force: float,
) -> tuple[float, float]:
    magnitude = math.hypot(x, y)
    if magnitude < 0.0001:
        return 0.0, 0.0
    return cap(
        x / magnitude * speed - velocity_x,
        y / magnitude * speed - velocity_y,
        force,
    )


def step(flock: list[Point], width: int, height: int, delta_seconds: float) -> None:
    perception = min(104, min(width, height) / 4)
    perception_squared = perception * perception
    separation_radius = min(34, perception * 0.48)
    separation_squared = separation_radius * separation_radius
    accelerations: list[tuple[float, float]] = []

    for boid in flock:
        separation_x = 0.0
        separation_y = 0.0
        alignment_x = 0.0
        alignment_y = 0.0
        cohesion_x = 0.0
        cohesion_y = 0.0
        neighbors = 0
        for neighbor in flock:
            if neighbor is boid:
                continue
            dx, dy = delta(boid.x, boid.y, neighbor.x, neighbor.y, width, height)
            distance_squared = dx * dx + dy * dy
            if distance_squared > perception_squared:
                continue
            neighbors += 1
            alignment_x += neighbor.vx
            alignment_y += neighbor.vy
            cohesion_x += dx
            cohesion_y += dy
            if 0.000001 < distance_squared < separation_squared:
                separation_x -= dx / distance_squared
                separation_y -= dy / distance_squared

        acceleration_x = 0.0
        acceleration_y = 0.0
        if neighbors:
            sx, sy = steer(separation_x, separation_y, boid.vx, boid.vy, 96, 310)
            ax, ay = cap(
                (alignment_x / neighbors - boid.vx) * 1.05,
                (alignment_y / neighbors - boid.vy) * 1.05,
                310,
            )
            cx, cy = steer(cohesion_x / neighbors, cohesion_y / neighbors, boid.vx, boid.vy, 96, 310)
            acceleration_x += sx * 1.55 + ax + cx * 0.78
            acceleration_y += sy * 1.55 + ay + cy * 0.78
        accelerations.append(cap(acceleration_x, acceleration_y, 558))

    for boid, (ax, ay) in zip(flock, accelerations, strict=True):
        boid.vx += ax * delta_seconds
        boid.vy += ay * delta_seconds
        speed = math.hypot(boid.vx, boid.vy)
        if speed > 96:
            boid.vx *= 96 / speed
            boid.vy *= 96 / speed
            speed = 96
        if speed < 46:
            if speed < 0.000001:
                boid.vx = math.cos(boid.phase * TAU) * 46
                boid.vy = math.sin(boid.phase * TAU) * 46
            else:
                boid.vx *= 46 / speed
                boid.vy *= 46 / speed
        boid.x = wrap(boid.x + boid.vx * delta_seconds, width)
        boid.y = wrap(boid.y + boid.vy * delta_seconds, height)


def background(width: int, height: int, seed: int) -> Image.Image:
    image = Image.new("RGB", (width, height))
    pixels = image.load()
    for y in range(height):
        vertical = y / max(1, height - 1)
        for x in range(width):
            horizontal = x / max(1, width - 1)
            radial = max(0.0, 1.0 - math.hypot(horizontal - 0.48, vertical - 0.44) / 0.78)
            edge = abs(horizontal - 0.5) + abs(vertical - 0.5)
            pixels[x, y] = (
                round(2 + 8 * radial - 2 * edge),
                round(4 + 18 * radial - 3 * edge),
                round(12 + 42 * radial - 8 * edge),
            )
    stars = ImageDraw.Draw(image)
    rng = random.Random(seed)
    for _ in range(max(20, width * height // 18000)):
        x = rng.randrange(width)
        y = rng.randrange(height)
        value = rng.randint(10, 34)
        stars.point((x, y), fill=(70 + value, 100 + value, 145 + value))
    return image


def triangle(boid: Point, size: float, scale: float = 1.0) -> list[tuple[float, float]]:
    angle = math.atan2(boid.vy, boid.vx)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    length = size * scale
    half_width = length * 0.48
    return [
        (boid.x + cosine * length, boid.y + sine * length),
        (boid.x - cosine * length * 0.58 - sine * half_width, boid.y - sine * length * 0.58 + cosine * half_width),
        (boid.x - cosine * length * 0.58 + sine * half_width, boid.y - sine * length * 0.58 - cosine * half_width),
    ]


def color_for(boid: Point) -> tuple[int, int, int, int]:
    hue = (154 / 360 + boid.phase * 104 / 360) % 1
    saturation = 0.92
    lightness = 0.62
    red, green, blue = colorsys.hls_to_rgb(hue, lightness, saturation)
    return round(red * 255), round(green * 255), round(blue * 255), 235


def draw_frame(base: Image.Image, flock: list[Point], fade: int | None) -> Image.Image:
    frame = base.convert("RGBA")
    if fade is not None:
        frame = Image.alpha_composite(frame, Image.new("RGBA", frame.size, (3, 7, 18, fade)))
    glow = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    draw = ImageDraw.Draw(frame)
    size = max(4.2, min(frame.size) / 118)
    for boid in flock:
        color = color_for(boid)
        glow_color = (color[0], color[1], color[2], 42)
        glow_draw.polygon(triangle(boid, size, 1.85), fill=glow_color)
    frame = Image.alpha_composite(frame, glow.filter(ImageFilter.GaussianBlur(max(1.2, size * 0.42))))
    draw = ImageDraw.Draw(frame)
    for boid in flock:
        draw.polygon(triangle(boid, size), fill=color_for(boid))
    return frame.convert("RGB")


def write_assets() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    thumbnail_base = background(640, 360, 0x51A7F00D)
    thumbnail_flock = make_flock(640, 360, 145, 0xB01D5)
    for _ in range(180):
        step(thumbnail_flock, 640, 360, 1 / 60)
    draw_frame(thumbnail_base, thumbnail_flock, None).save(ASSETS / "thumbnail.png", optimize=True)

    width, height = 320, 180
    preview_base = background(width, height, 0x51A7F00D)
    preview_flock = make_flock(width, height, 72, 0xB01D5)
    for _ in range(120):
        step(preview_flock, width, height, 1 / 60)
    frames = []
    for _ in range(48):
        frame = draw_frame(preview_base, preview_flock, 70)
        frames.append(frame.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
        step(preview_flock, width, height, 1 / 30)
    frames[0].save(
        ASSETS / "preview.gif",
        save_all=True,
        append_images=frames[1:],
        duration=50,
        loop=0,
        optimize=False,
        disposal=2,
    )


if __name__ == "__main__":
    write_assets()
