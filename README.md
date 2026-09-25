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

## Standalone Windows desktop

`windows/Boids.Desktop` is a self-contained WinForms/WebView2 host. It places the same page behind the desktop icons, without Lively, and exposes Pause, Settings, Reattach, and Exit through its tray icon. `--preview` opens a normal window instead. Build it with the .NET 8 SDK:

```powershell
dotnet publish windows/Boids.Desktop/Boids.Desktop.csproj -c Release -r win-x64 --self-contained true -o dist/BoidsWallpaper-win-x64
```

For a PC without the WebView2 Evergreen Runtime, copy a fixed-version runtime into `dist/BoidsWallpaper-win-x64/runtime` so `msedgewebview2.exe` is directly inside it. `scripts/package-windows.ps1` does both steps and writes `dist/BoidsWallpaper-win-x64.zip`. Settings are stored in `%LOCALAPPDATA%\BoidsWallpaper\settings.json`; the original desktop wallpaper is never modified.

## Install in Lively Wallpaper

1. Open Lively Wallpaper.
2. Choose **Library** → **Add wallpaper**.
3. Select this repository folder.
4. Select **Boids** and apply it to a display.

The root `LivelyInfo.json` and `LivelyProperties.json` provide the thumbnail, preview, playback integration, and controls for flock size, speed, and cursor behavior. Triangles are exactly white on exactly black. The pointer position strongly steers most of the flock for as long as it remains on screen, while clicks have no effect. The simulation runs at 120 Hz and drawing is capped at 120 fps. WebGPU runs both the flocking rules and the triangle drawing on the graphics card; Canvas 2D is the automatic fallback. Lively can pause the simulation when playback is disabled or the wallpaper is not visible.

## Controls in Lively

| Property | Values | Default |
| --- | --- | --- |
| Flock size | 20–4096 | 2048 |
| Speed | 0.25–9× | 6× |
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
