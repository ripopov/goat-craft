# Meadow Goat

A small, endless blocky meadow with a procedural goat, built with three.js.


## Run it

Open **`index.html`** directly in a browser (`file://`). No server, build step or package install is required. Keep the folder structure intact.

## Structure

```
index.html          markup only
css/style.css       page + HUD styling
vendor/three.min.js three.js r149 (classic UMD build)
js/core.js          shared config, math helpers, material helper
js/audio.js         WebAudio bleat, hoofbeats, jump/land, headbutt and breath sounds
js/music.js         procedural atmospheric folk soundtrack (WebAudio)
js/ui.js            hint, speech bubble and "Say hi" button
js/world.js         procedural terrain, chunk streaming, block removal, debris
js/environment.js   lights, sun shadows, sky dome, drifting clouds
js/goat.js          goat rig, coat, gaits, physics, jumps and headbutt
js/controls.js      orbit camera, keyboard and pointer/touch input
js/main.js          bootstraps the scene and owns the render loop
```

The modules are **classic scripts** (IIFEs) sharing a small `window.Meadow` namespace. They are deliberately not ES modules: browsers block `import` and `fetch` from `file://` for security reasons, which would require a local server. Classic `<script src>` tags work from disk, so this remains a zero-server static page.

## Controls

- **WASD / arrow keys** — move
- **Shift** — gallop (2× speed, four-beat gait)
- **Space** — jump (up to three times in the air)
- **E / left click / tap** — headbutt a block the head/horns actually touch
- **Drag** — orbit · **Wheel / pinch** — zoom
- **Say hi** — bleat and jump
- **Music** (top-right button) — start/stop the generated folk soundtrack

All action sounds (hoofbeats, jump, landing, headbutt and breathing) are synthesized in-browser; there are no audio files.
