# Meadow Goat

[![CI](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml)

**Play online: [ripopov.github.io/goat-craft](https://ripopov.github.io/goat-craft/)**

A small, endless blocky meadow with a procedural goat, ponds full of fish, a wandering herd of animals, and a one-minute day/night cycle, built with three.js.


## Run it

Open **`index.html`** directly in a browser (`file://`). No server, build step or package install is required for local play. Keep the folder structure intact.

## Structure

```
index.html          markup only
css/style.css       page + HUD styling
vendor/three.min.js three.js r149 (classic UMD build)
js/core.js          shared config, math helpers, material helper
js/audio.js         WebAudio bleat, hoofbeats, jump/land, headbutt/stomp, pickup and breath sounds
js/music.js         procedural atmospheric folk soundtrack (WebAudio)
js/ui.js            hint, speech bubble and "Say hi" button
js/items.js         ten-slot hotbar, block drops, pickup and item stacking
js/world.js         procedural terrain and ponds, chunk streaming, block removal, drops and debris
js/fish.js          seeded pond fish, lily pads, ripples and shoal animation
js/environment.js   60-second solar cycle, dynamic sky/lighting, moon, stars, drifting clouds
js/goat.js          goat rig, coat, gaits, physics, jumps, headbutt and hoof stomp
js/animals.js       sheep, cow and stag NPCs: grazing, jumping, turf quarrying, stair building and pit escape
js/controls.js      pointer-lock mouse look, orbit camera, keyboard and touch input
js/main.js          bootstraps the scene and owns the render loop
scripts/build-site.mjs  copies the playable files into _site/
scripts/check-site.mjs  checks local asset references in the built site
.github/workflows/ci.yml    syntax, asset and served-page checks
.github/workflows/pages.yml builds and deploys the GitHub Pages site
```

The modules are **classic scripts** (IIFEs) sharing a small `window.Meadow` namespace. They are deliberately not ES modules: browsers block `import` and `fetch` from `file://` for security reasons, which would require a local server. Classic `<script src>` tags work from disk, so this remains a zero-server static page.

## Controls

- **WASD / arrow keys** — move
- **Shift** — gallop (2× speed, four-beat gait)
- **Space** — jump (up to three times in the air)
- **Left click / tap / E** — headbutt a block the head/horns actually touch; with a block selected, place it instead
- **Right click** — stomp the block beneath the goat
- **1–9 / 0** — select hotbar slot (slot 1 is horns and hooves; broken blocks stack in the other slots)
- Selected blocks ride on the goat's horns and are set down by the headbutt lunge.
- **Mouse look** (button / **F**) — capture the pointer and steer the third-person camera with the mouse; **Esc** releases it
- **Drag / pinch** — orbit and zoom while the pointer is free (drag and pinch are the touch fallback)
- **Say hi** — bleat and jump
- **Music** (top-right button) — start/stop the generated folk soundtrack

The meadow is dotted with **blocky ponds**. A starter pond sits just beyond the goat, and new ponds are seeded deterministically on a 64-block lattice as the player explores. Each pond is a shallow basin with raised grassy banks, a muddy bottom, transparent animated water, lily pads, and five to nine fish. Fish are seeded per pond, swim in stable elliptical shoals, wag their tails, and produce small surface ripples. The player goat can wade into a pond; the herd prefers to stay on dry ground.

The meadow runs a complete **60-second day/night cycle**: warm sunrise, blue midday, golden sunset, then a moonlit night with stars. The sun follows a physically based solar path for 50°N on the equinox, so its orbit is tilted, it casts moving shadows, and day and night are each 30 seconds long.

A small herd lives in the meadow: two sheep (Mallow and Poppy), a cow (Clover) and a stag (Bramble). They wander, graze, jump up ledges, and set out to build independently.

When an animal starts a project it shaves the top turf course around a flat site, one block at a time, and carries the load between its horns. It then lays a 3×3 turf plinth, a 2×2 tier, and a 20-step spiral stair that climbs toward the sky. Every step is a real world block, so the tower collides with the player and can be climbed or dismantled. The builders jump from step to step as they work, and retire to graze once their tower is finished.

If an animal falls into a pit, it does not dig itself deeper: it breaks open the pit wall, builds or jumps onto a step, and keeps widening and climbing until it is back on the surface. The herd leaves ponds and player-placed blocks alone, and animal quarrying creates no competing item drops.

All action sounds (hoofbeats, jump, landing, headbutt, stomp, pickup and breathing) are synthesized in-browser; there are no audio files.

## CI and hosting

Every push and pull request runs the CI workflow: it checks every classic-script module with `node --check`, builds the playable `_site/` artifact, verifies all local asset references, and smoke-tests the result over a local HTTP server.

Pushes to `main` also run the Pages workflow, which rebuilds and checks the same artifact and deploys it with the official GitHub Pages Actions. The published game is served from **[https://ripopov.github.io/goat-craft/](https://ripopov.github.io/goat-craft/)**.
