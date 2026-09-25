# Boids Wallpaper

![Boids flock preview](assets/thumbnail.png)

A classic 2D boids simulation: every triangle follows three local rules—**separation**, **alignment**, and **cohesion**—inside a seamless toroidal world. It runs as a normal web page or as a native-feeling [Lively Wallpaper](https://github.com/rocksdanister/lively) with no runtime dependencies.

## Run it

```powershell
npm start
```

Open <http://127.0.0.1:4173>. The project has no install step or third-party packages.

### Browser controls

- Move the pointer to guide the flock. Clicks do not change it.
- Press `Space` to pause or resume.
- Press `F` for fullscreen.

## Install in Lively Wallpaper

1. Open Lively Wallpaper.
2. Choose **Library** → **Add wallpaper**.
3. Select this repository folder.
4. Select **Boids** and apply it to a display.

The root `LivelyInfo.json` and `LivelyProperties.json` provide the thumbnail, preview, playback integration, and controls for flock size, speed, and cursor behavior. Triangles are exactly white on exactly black. Pointer movement steers the flock, while clicks have no effect. The simulation runs at 120 Hz and drawing is capped at 120 fps. WebGPU runs both the flocking rules and the triangle drawing on the graphics card; Canvas 2D is the automatic fallback. Lively can pause the simulation when playback is disabled or the wallpaper is not visible.

## Controls in Lively

| Property | Values | Default |
| --- | --- | --- |
| Flock size | 20–1024 | 256 |
| Speed | 0.25–6× | 4× |
| Cursor | Orbit, Follow, Avoid, Ignore | Orbit |

## Development

```powershell
npm test
npm run check
```

The CPU simulation is in [`src/flock.js`](src/flock.js). [`src/webgpu.js`](src/webgpu.js) runs the same rules in a WGSL compute shader and draws one instanced triangle per boid, with the state kept on the GPU. [`src/main.js`](src/main.js) selects that path when WebGPU is available and otherwise uses Canvas 2D. A spatial hash limits the CPU fallback to nine nearby cells. On a slower display, physics still advances at 120 Hz and the browser presents the latest frame at the monitor rate.

Regenerate the committed preview assets with Python and Pillow:

```powershell
python tools/generate-assets.py
```

## License

[MIT](LICENSE)
