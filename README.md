# Boids Wallpaper

![Boids flock preview](assets/thumbnail.png)

A classic 2D boids simulation: every triangle follows three local rules—**separation**, **alignment**, and **cohesion**—inside a seamless toroidal world. It runs as a normal web page or as a native-feeling [Lively Wallpaper](https://github.com/rocksdanister/lively) with no runtime dependencies.

## Run it

```powershell
npm start
```

Open <http://127.0.0.1:4173>. The project has no install step or third-party packages.

### Browser controls

- Move the pointer to guide the flock around its cursor.
- Click to scatter nearby boids.
- Press `Space` to pause or resume.
- Press `R` to scatter the flock.
- Press `F` for fullscreen.

## Install in Lively Wallpaper

1. Open Lively Wallpaper.
2. Choose **Library** → **Add wallpaper**.
3. Select this repository folder.
4. Select **Boids** and apply it to a display.

The root `LivelyInfo.json` and `LivelyProperties.json` provide the thumbnail, preview, playback integration, and controls for flock size, speed, palette, and cursor behavior. Rendering is deliberately flat: there are no glows, blur, trails, or click effects. Lively can pause the simulation when playback is disabled or the wallpaper is not visible.

## Controls in Lively

| Property | Values | Default |
| --- | --- | --- |
| Flock size | 20–280 | 128 |
| Speed | 0.25–2.5× | 1.15× |
| Palette | Aurora, Ice, Ember, Mono | Aurora |
| Cursor | Orbit, Follow, Avoid, Ignore | Orbit |
| Scatter flock | Action button | — |

## Development

```powershell
npm test
npm run check
```

The simulation is in [`src/flock.js`](src/flock.js), while [`src/main.js`](src/main.js) handles Canvas rendering, fixed-step animation, resizing, pointer input, and Lively playback/property hooks. A spatial hash limits neighbor checks to the nine nearby cells; the simulation still wraps every boundary so the flock never clusters at an edge.

Regenerate the committed preview assets with Python and Pillow:

```powershell
python tools/generate-assets.py
```

## License

[MIT](LICENSE)
