# Meadow Goat

[![CI](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml)

**Play online: [ripopov.github.io/goat-craft](https://ripopov.github.io/goat-craft/)**

An endless blocky meadow with a procedural goat, winding rivers, deep seas, ponds full of fish, a wandering herd of animals, a one-minute day/night cycle, and growing zombie waves that attack a living Hearth Tree, built with three.js.


## Run it

Open **`index.html`** directly in a browser (`file://`). No server, build step or package install is required for local play. Keep the folder structure intact.

## Structure

```
index.html          markup only
css/style.css       page + HUD styling
vendor/three.min.js three.js r149 (classic UMD build)
js/core.js          shared config, math helpers, material helper
js/audio.js         shared WebAudio mixer, smooth sound envelopes, voice cleanup, bleat, hoofbeats, jump/land, headbutt/stomp, pickup, breath and splash sounds
js/music.js         procedural atmospheric folk soundtrack (WebAudio)
js/ui.js            hint, speech bubble and "Say hi" button
js/items.js         ten-slot hotbar, block drops, pickup and item stacking
js/world.js         procedural terrain, rivers, seas and ponds, chunk streaming, block removal, drops and debris
js/hearth-tree.js    voxel objective, 100 HP, amber heart, lanterns, embers and persistent collision
js/zombie-navigation.js shared walk routes, one-block jumps, terrain edits and weighted breach planning
js/enemies.js       instanced voxel zombies, staggered waves, bites, combat, coins and defeat
js/fish.js          seeded pond fish, lily pads, ripples and shoal animation
js/water.js         pooled swimming wakes/bubbles, underwater fog/tint and swimming status
js/environment.js   60-second solar cycle, dynamic sky/lighting, moon, stars, drifting clouds
js/goat.js          goat rig, coat, gaits, swimming/buoyancy, physics, jumps, headbutt and hoof stomp
js/animals.js       sheep, cow and stag NPCs: grazing, jumping, turf quarrying, stair building and pit escape
js/controls.js      pointer-lock mouse look, third-/first-person cameras, keyboard and touch input
js/main.js          bootstraps the scene and owns the render loop
scripts/build-site.mjs  copies the playable files into _site/
scripts/check-site.mjs  checks local asset references in the built site
scripts/test-water.mjs  dependency-free terrain, swimming, input and camera regression tests
scripts/test-audio.mjs  dependency-free audio scheduling, fade, mixing and voice-lifetime regression tests
scripts/test-hearth-tree.mjs  landmark geometry, root collision, placement, foundation protection and reduced-motion checks
scripts/test-enemies.mjs  routes, jumps, block chewing, tree damage, combat, spawning and persistent drops
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
- **Left click / tap / E** — headbutt nearby zombies (two hits to kill) or a block the head/horns actually touch; with a block selected, place it instead
- **Right click** — stomp nearby zombies (one hit to kill), or the block beneath the goat
- **1–9 / 0** — select hotbar slot (slot 1 is horns and hooves; broken blocks stack in the other slots)
- Selected blocks ride on the goat's horns and are set down by the headbutt lunge.
- **P** — toggle between third-person and first-person (FPS) cameras
- **Mouse look** (button / **F**) — capture the pointer and steer either camera with the mouse; **Esc** releases it
- **Drag / pinch** — orbit and zoom while the pointer is free (drag and pinch are the touch fallback)
- **Say hi** — bleat and jump
- **Music** (top-right button) — start/stop the generated folk soundtrack

The meadow has **winding rivers, coastal seas and blocky ponds**. Rivers run continuously across chunk boundaries and meet the seas at a common waterline. Terraced banks and shallow coastal shelves descend into sea beds more than ten world units deep. A river is about 56 world units along +Z from spawn; seas lie farther east and west. A starter pond sits just beyond the goat, and other ponds are seeded deterministically on a 64-block lattice, away from channels and coasts. Ponds have raised grassy banks, muddy swimming basins, transparent animated water, lily pads, and five to nine fish. Fish swim in stable elliptical shoals, wag their tails, and produce small surface ripples. The herd prefers to stay on dry ground.

The goat wades in shallows and automatically **swims when its body is immersed**. Swimming uses buoyancy and water drag instead of walking on the bed, with a smoothly blended, alternating four-leg paddle, body roll, and a raised head. Hold Space to rise or Ctrl to dive; a surface swimmer can scramble over a one-block bank. Swimming resets air jumps without consuming them. Mouse look, free-pointer dragging and zoom all work underwater, and forward/backward swimming follows the camera pitch. The camera follows dives, retracts around solid banks and blocks, and gains blue distance fog underwater. Wakes, rising bubbles and synthesized splashes provide water feedback. Terrain edits change the measured water depth; water is procedural rather than a full Minecraft block-fluid simulation.

An ancient **Hearth Tree** stands on the dry bank beyond the starter pond, at world coordinates **(-8, -26)**, about 28 units from spawn. Its half-unit voxels form a forked oak, a layered green-and-gold crown, and mossy roots fitted to the terrain. An inset amber heart, golden sap seams, hanging lanterns, and slowly drifting embers make it a warm landmark after dark. The trunk, roots, and canopy have persistent collision; the foundation is protected from mining and herd construction. The tree starts with **100 HP**, shown alongside the coin balance and living zombie count in the defense HUD. Its glow fades as its health falls.

After **10 seconds** of preparation, the first wave sends four zombies. A new wave arrives every **35 seconds**, with three more zombies than the previous wave; they enter individually, increasingly quickly. There are never more than **50 living zombies**. Each zombie follows the terrain toward the tree and eats **1 HP every 3 seconds** while in contact with its trunk or roots. At zero HP, attacks and spawning stop and **Defend again** restarts the game.

Zombies walk around high walls and hills, jump up **one block**, and cannot jump up two. Shared navigation covers the defense arena, 56 world units in each direction from the tree, and updates locally when blocks change. If no walking route exists, zombies plan a breach and chew each obstructing block for **10 seconds**. Terrain can be tunneled and player-built walls can be dismantled. Every chewed block becomes a **persistent collectible drop**; nearby matching materials stack and can be collected and placed again. The tree's protected foundation remains intact, and the arena stays loaded while the goat explores elsewhere.

Select **Horns & Hooves** to fight: two headbutts or one stomp kill a zombie, earning exactly **one coin**. Walls block player attacks. Coins are counted in the HUD; spending and tree upgrades are not yet implemented.

The meadow runs a complete **60-second day/night cycle**: warm sunrise, blue midday, golden sunset, then a moonlit night with stars. The sun follows a physically based solar path for 50°N on the equinox, so its orbit is tilted, it casts moving shadows, and day and night are each 30 seconds long.

A small herd lives in the meadow: two sheep (Mallow and Poppy), a cow (Clover) and a stag (Bramble). They wander, graze, jump up ledges, and set out to build independently.

When an animal starts a project it shaves the top turf course around a flat site, one block at a time, and carries the load between its horns. It then lays a 3×3 turf plinth, a 2×2 tier, and a 20-step spiral stair that climbs toward the sky. Every step is a real world block, so the tower collides with the player and can be climbed or dismantled. The builders jump from step to step as they work, and retire to graze once their tower is finished.

If an animal falls into a pit, it does not dig itself deeper: it breaks open the pit wall, builds or jumps onto a step, and keeps widening and climbing until it is back on the surface. The herd leaves ponds and player-placed blocks alone, and animal quarrying creates no competing item drops.

All action sounds (hoofbeats, jump, landing, headbutt, stomp, pickup and breathing) are synthesized in-browser; there are no audio files.

Music and effects share a filtered, compressed output with volume headroom. Every note and effect fades in and ends at exact silence, and finished voices release their audio nodes. The wind loop has smooth endpoints; late music timers skip missed beats instead of playing a burst of overdue notes. Rapid music toggles preserve the current fade level and cancel notes queued by the previous playback.

## CI and hosting

Every push and pull request runs the CI workflow: it checks every classic-script module with `node --check`, runs `node --test scripts/test-water.mjs scripts/test-audio.mjs scripts/test-hearth-tree.mjs scripts/test-enemies.mjs`, builds the playable `_site/` artifact, verifies all local asset references, and smoke-tests the result over a local HTTP server. The water tests cover river continuity, generation-cache eviction, terrain edits, swimming and diving, bed/ceiling collisions, shore exits, frame-rate stability, held-key combinations and the underwater camera. The audio tests cover silent envelope endpoints, shared mixing, wind-loop seams, delayed timers, suspended contexts, rapid music toggles, bounded polyphony and node cleanup during long playback.

Pushes to `main` also run the Pages workflow, which rebuilds and checks the same artifact and deploys it with the official GitHub Pages Actions. The published game is served from **[https://ripopov.github.io/goat-craft/](https://ripopov.github.io/goat-craft/)**.
