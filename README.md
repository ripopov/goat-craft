# Meadow Goat

[![CI](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml)

**Play online: [ripopov.github.io/goat-craft](https://ripopov.github.io/goat-craft/)**

An endless blocky meadow with a procedural goat, winding rivers, deep seas, ponds full of fish, a wandering herd of animals, and a one-minute day/night cycle, built with three.js.


## Run it

Open **`index.html`** directly in a browser (`file://`). No server, build step or package install is required for local play. Keep the folder structure intact.

## Structure

```
index.html          markup only
css/style.css       page + HUD styling
vendor/three.min.js three.js r149 (classic UMD build)
js/core.js          shared config, math helpers, material helper
js/audio.js         WebAudio bleat, hoofbeats, jump/land, headbutt/stomp, pickup, breath and splash sounds
js/music.js         procedural atmospheric folk soundtrack (WebAudio)
js/ui.js            hint, speech bubble and "Say hi" button
js/items.js         ten-slot hotbar, block drops, pickup and item stacking
js/world.js         procedural terrain, rivers, seas and ponds, chunk streaming, block removal, drops and debris
js/fish.js          seeded pond fish, lily pads, ripples and shoal animation
js/water.js         pooled swimming wakes/bubbles, underwater fog/tint and swimming status
js/environment.js   60-second solar cycle, dynamic sky/lighting, moon, stars, drifting clouds
js/goat.js          goat rig, coat, gaits, swimming/buoyancy, physics, jumps, headbutt and hoof stomp
js/animals.js       sheep, cow and stag NPCs: grazing, jumping, turf quarrying, stair building and pit escape
js/controls.js      pointer-lock mouse look, orbit camera, keyboard and touch input
js/main.js          bootstraps the scene and owns the render loop
scripts/build-site.mjs  copies the playable files into _site/
scripts/check-site.mjs  checks local asset references in the built site
scripts/test-water.mjs  dependency-free terrain, swimming, input and camera regression tests
.github/workflows/ci.yml    syntax, asset and served-page checks
.github/workflows/pages.yml builds and deploys the GitHub Pages site
```

The modules are **classic scripts** (IIFEs) sharing a small `window.Meadow` namespace. They are deliberately not ES modules: browsers block `import` and `fetch` from `file://` for security reasons, which would require a local server. Classic `<script src>` tags work from disk, so this remains a zero-server static page.

## Controls

- **WASD / arrow keys** — move
- **Shift** — gallop (2× speed, four-beat gait), or swim faster in water
- **Space** — jump (up to three times in the air); hold to swim toward the surface
- **Ctrl** — hold to dive deeper; WASD still works while Ctrl is held
- **W / S + mouse look** — swim along the view pitch; A / D strafe horizontally. Space / Ctrl override vertical steering.
- **Left click / tap / E** — headbutt a block the head/horns actually touch; with a block selected, place it instead
- **Right click** — stomp the block beneath the goat
- **1–9 / 0** — select hotbar slot (slot 1 is horns and hooves; broken blocks stack in the other slots)
- Selected blocks ride on the goat's horns and are set down by the headbutt lunge.
- **Mouse look** (button / **F**) — capture the pointer and steer the third-person camera with the mouse; **Esc** releases it
- **Drag / pinch** — orbit and zoom while the pointer is free (drag and pinch are the touch fallback)
- **Say hi** — bleat and jump
- **Music** (top-right button) — start/stop the generated folk soundtrack

The meadow has **winding rivers, coastal seas and blocky ponds**. Rivers run continuously across chunk boundaries and meet the seas at a common waterline. Terraced banks and shallow coastal shelves descend into sea beds more than ten world units deep. A river is about 56 world units along +Z from spawn; seas lie farther east and west. A starter pond sits just beyond the goat, and other ponds are seeded deterministically on a 64-block lattice, away from channels and coasts. Ponds have raised grassy banks, muddy swimming basins, transparent animated water, lily pads, and five to nine fish. Fish swim in stable elliptical shoals, wag their tails, and produce small surface ripples. The herd prefers to stay on dry ground.

The goat wades in shallows and automatically **swims when its body is immersed**. Swimming uses buoyancy and water drag instead of walking on the bed, with a smoothly blended, alternating four-leg paddle, body roll, and a raised head. Hold Space to rise or Ctrl to dive; a surface swimmer can scramble over a one-block bank. Swimming resets air jumps without consuming them. Mouse look, free-pointer dragging and zoom all work underwater, and forward/backward swimming follows the camera pitch. The camera follows dives, retracts around solid banks and blocks, and gains blue distance fog underwater. Wakes, rising bubbles and synthesized splashes provide water feedback. Terrain edits change the measured water depth; water is procedural rather than a full Minecraft block-fluid simulation.

The meadow runs a complete **60-second day/night cycle**: warm sunrise, blue midday, golden sunset, then a moonlit night with stars. The sun follows a physically based solar path for 50°N on the equinox, so its orbit is tilted, it casts moving shadows, and day and night are each 30 seconds long.

A small herd lives in the meadow: two sheep (Mallow and Poppy), a cow (Clover) and a stag (Bramble). They wander, graze, jump up ledges, and set out to build independently.

When an animal starts a project it shaves the top turf course around a flat site, one block at a time, and carries the load between its horns. It then lays a 3×3 turf plinth, a 2×2 tier, and a 20-step spiral stair that climbs toward the sky. Every step is a real world block, so the tower collides with the player and can be climbed or dismantled. The builders jump from step to step as they work, and retire to graze once their tower is finished.

If an animal falls into a pit, it does not dig itself deeper: it breaks open the pit wall, builds or jumps onto a step, and keeps widening and climbing until it is back on the surface. The herd leaves ponds and player-placed blocks alone, and animal quarrying creates no competing item drops.

All action sounds (hoofbeats, jump, landing, headbutt, stomp, pickup and breathing) are synthesized in-browser; there are no audio files.

## CI and hosting

Every push and pull request runs the CI workflow: it checks every classic-script module with `node --check`, runs `node --test scripts/test-water.mjs`, builds the playable `_site/` artifact, verifies all local asset references, and smoke-tests the result over a local HTTP server. The water tests cover river continuity, generation-cache eviction, terrain edits, swimming and diving, bed/ceiling collisions, shore exits, frame-rate stability, held-key combinations and the underwater camera.

Pushes to `main` also run the Pages workflow, which rebuilds and checks the same artifact and deploys it with the official GitHub Pages Actions. The published game is served from **[https://ripopov.github.io/goat-craft/](https://ripopov.github.io/goat-craft/)**.
