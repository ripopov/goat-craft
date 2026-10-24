# Meadow Goat

[![CI](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml)

**Play online: [ripopov.github.io/goat-craft](https://ripopov.github.io/goat-craft/)**

An endless blocky meadow with a procedural goat, winding rivers, deep seas, ponds full of fish, a wandering herd of animals, a one-minute day/night cycle, and growing enemy waves that attack a living Hearth Tree, built with three.js.


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
js/console.js       / developer console with money and spawn shortcuts
js/items.js         ten-slot hotbar, block drops, pickup and item stacking
js/actor-physics.js shared upright body collision, swept movement, wall sliding, support and local overlap recovery
js/voxel-water.js   queued voxel fluid simulation, downward flow, spreading, containment and draining
js/caves.js         deterministic tunnels, chambers, entrances and coal/copper/iron geology
js/targeting.js     camera voxel ray traversal and physical reach checks
js/highlights.js    Q character outlines, enemy range outlines and block placement/mining contours
js/towers.js        ten detailed voxel cannons, animated mechanisms, pooled particles, atomic purchases, packing and swept projectile collisions
js/strategy.js      live RTS camera, command workshop, tower inspection and placement previews
assets/towers/      ten locally stored imagegen icons and their generation prompts
assets/upgrades/    five locally stored voxel training icons and their generation prompts
js/world.js         procedural terrain, flowing rivers, seas and ponds, chunk streaming, exact voxel collision, block edits and debris
js/hearth-tree.js    voxel objective, 100 HP, amber heart, lanterns, embers and persistent collision
js/zombie-navigation.js shared walk routes, one-block jumps, terrain edits and weighted breach planning
js/enemies.js       instanced zombies, spiders, skeletons and brutes; waves, combat and defeat
js/upgrades.js      individual training tiers, prices, resource purchases and nearby targeting
js/upgrade-menu.js  accessible paused training menu, character switching and purchase feedback
js/minimap.js       circular player-centered radar for enemies, herd, coin drops and the Hearth
js/fish.js          seeded pond fish, lily pads, ripples and shoal animation
js/water.js         pooled swimming wakes/bubbles, underwater fog/tint and swimming status
js/environment.js   60-second solar cycle, dynamic sky/lighting, moon, stars, drifting clouds
js/goat.js          goat rig, coat, gaits, swimming/buoyancy, physics, jumps, headbutt and hoof stomp
js/animal-recovery.js target-progress monitoring, jump/detour decisions, and dig/build escape target selection
js/animals.js       specialized sheep, cow and stag NPCs: zombie hunting, wall building, repairs and physical recovery
js/controls.js      pointer-lock mouse look, third-/first-person cameras, keyboard and touch input
js/main.js          bootstraps the scene and owns the render loop
scripts/build-site.mjs  copies the playable files into _site/
scripts/check-site.mjs  checks local asset references in the built site
scripts/helpers/animal-game.mjs  reusable real-world fixtures with one independently controllable NPC
scripts/test-collision.mjs corner escapes, wall seams, corridors, all herd species, bridges and root collision
scripts/test-fluids.mjs source spreading, waterfalls, walls, tunnels, draining and bounded simulation work
scripts/test-water.mjs  dependency-free terrain, bank leaks, swimming, collision, input and camera regression tests
scripts/test-audio.mjs  dependency-free audio scheduling, fade, mixing and voice-lifetime regression tests
scripts/test-console.mjs keyboard capture, command history and resource/wave console shortcuts
scripts/test-hearth-tree.mjs  landmark geometry, root collision, clearing terrain, player spawn, placement and reduced-motion checks
scripts/test-enemies.mjs  routes, jumps, chewing, tree damage, mixed waves, shared cap and loot
scripts/test-upgrades.mjs training, atomic purchases, individual NPC effects, live combat and collectible coins
scripts/test-caves.mjs    geology, exposed ore, protected roofs and actual player descent/exit
scripts/test-targeting.mjs camera mining in every direction, obstruction, preview/action agreement and outlines
scripts/test-minimap.mjs  player-centered coordinates and exact range boundaries
scripts/test-towers.mjs   blueprints, purchases, packing, swept combat, independent model rigs, bounded particles and effect cleanup
scripts/test-strategy.mjs view restoration, live goat AI, command input routing and camera movement
scripts/test-animals.mjs  herd roles, zombie combat, ten-block wall construction and repairs
scripts/test-animal-recovery.mjs  isolated ledge, wall, pit, roof, crowd and hunter recovery scenarios
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
- **Left click / tap / E** — headbutt nearby enemies or mine the block under the center reticle within 5.5 units; aim in any horizontal direction, upward or downward by moving the camera. With a block selected, place it on the aimed face instead. P gives an unobstructed first-person view for precise mining.
- **Right click** — stomp nearby zombies (one hit to kill), or the block beneath the goat
- **Q / Upgrades** — open training; selects a visible animal within 5.5 units, otherwise your goat. Switch to your goat using its tab. Q / Esc closes the menu. The world pauses while training.
- **1–9 / 0** — select hotbar slot (slot 1 is horns and hooves; broken blocks stack in the other slots)
- Selected blocks ride on the goat's horns. A hollow mint contour previews placement; coral means the cell is blocked. A gold contour marks the aimed mining block. A gold animal outline shows which NPC Q will open, and subtle warm outlines mark enemies within melee range.
- **P** — toggle between third-person and first-person (FPS) cameras
- **T / Strategic view** — enter or leave the live RTS camera. Your goat roams with its own AI while the battle continues. Your previous FPS / third-person view returns when you leave.
- In strategic view: **WASD / arrows / drag** pan, **Shift** pans faster, **scroll** zooms, **Space / Hearth** centers the objective, and **Find goat** centers on your goat. Select a cannon in the workshop or use **1–0**, then click dry, supported ground. A green tower ghost and ring show a valid site and attack range; red means blocked or unaffordable. **Shift-click** deploys repeatedly. **Right-click / Esc** cancels selection; Esc again returns to your goat.
- Click a deployed tower to inspect its stats and kills, or **Pack tower into pickup**. You can also mine any tower block using your horns in FPS / third-person view. The whole cannon becomes one persistent item: walk your goat over it to collect it into the hotbar. Select that stack and place it like a block, or redeploy it from the RTS workshop at no resource cost. Full inventories leave the pickup on the ground. Towers also pack if their foundation is mined, and enemies can chew them when breaching defenses.
- **Mouse look** (button / **F**) — capture the pointer and steer either camera with the mouse; **Esc** or **F** releases it. Once enabled, capture returns automatically after closing training, returning from strategic view, or refocusing the game, until you explicitly release it. Esc in a menu closes the menu and restores capture.
- **Drag / pinch** — orbit and zoom while the pointer is free (drag and pinch are the touch fallback)
- **Say hi** — bleat and jump
- **Music** (top-right button) — toggle the generated folk soundtrack; enabled by default and starts with the first click or keypress permitted by the browser
- **Sound** (top-right button) — mute/unmute effects independently of music; enabled by default
- **? Controls** (bottom-left) — open the compact controls guide; Esc closes it
- **/ — Console** — open a developer console. `money` grants 1000 coins and 1000 of every tower resource; `spawn` starts the next enemy wave immediately; `spawn 10` jumps directly to wave 10 (and lower levels work too). Enter runs a command, Up / Down recalls history, and Esc closes the console.

### Cannon workshop

Towers occupy one grid cell and are one to three blocks tall. Build within 50 meters of the Hearth, on solid, dry ground with clearance for the whole tower. Construction checks allies, enemies, the Hearth and every occupied cell before spending anything. Up to 80 towers can be deployed; their collision participates in the same enemy navigation and breach system as walls. Towers keep firing in both camera modes. Walls and terrain block shots and splash propagation.

| Tower (shortcut) | Height | Attack | Price |
| --- | --- | --- | --- |
| Oak Ballista (1) | 1 block | 1 damage / 1.15s, 19m | 6 coins, 2 wood |
| Iron Mortar (2) | 1 block | 1.5 splash / 2.5s, 22m | 14 coins, 4 stone, 1 iron |
| Frost Spire (3) | 2 blocks | 0.5 / 1.3s, 17m; 45% slow | 12 coins, 3 stone |
| Ember Cannon (4) | 2 blocks | 1 splash / 1.6s, 18m; burn | 18 coins, 3 stone, 2 coal |
| Venom Idol (5) | 2 blocks | 0.3 / 1.2s, 18m; four-second poison | 15 coins, 3 wood, 3 soil |
| Storm Coil (6) | 2 blocks | 1.2 / 1.8s, 19m; chain to 3 | 24 coins, 3 stone, 2 copper |
| Watchman (7) | 3 blocks | 3.5 / 2.7s, 32m | 22 coins, 4 wood, 2 iron |
| Earthshaker (8) | 1 block | 1.8 splash / 2.8s, 16m; 65% slow | 16 coins, 5 stone, 4 soil |
| Arcane Prism (9) | 3 blocks | 0.8 / 0.45s, 20m | 32 coins, 4 stone, 3 copper |
| Sunspire (0) | 3 blocks | 2.5 / 1.7s, 25m; pierce up to 3 | 45 coins, 5 stone, 3 iron, 2 coal |

Wood uses oak logs; soil uses dirt; ores use their mined block stacks. Packed tower items are consumed before fresh construction costs. Attacks prioritize enemies nearest the Hearth; slows last 2.5 seconds, fire deals 0.5 damage/second and poison 0.7 damage/second for four seconds. Reapplying a type refreshes its effect instead of stacking it indefinitely. Kills leave collectible coins. Every shot deals damage only when its projectile collides with a live enemy. Physical shots lead walking targets and can miss; elemental homing shots follow their target. Fast shots use swept collision so they cannot pass through a body between simulation ticks. Walls built during flight block attacks. Splash victims are checked at impact, lightning jumps travel and hit in sequence, and Sunspire hits up to three bodies in flight order. Fired projectiles keep flying if their tower is packed. Reduced motion keeps the same visible projectiles and combat timing while suppressing recoil, spinning and decorative bursts. Projectiles and effects have separate budgets; shared geometry and materials are reused.


Each cannon has its own architecture: timber bow limbs and strings, an open braced Watchman frame with a ladder and scope, armored cannon bores, a crown of ice, a vine-covered fanged idol, copper coil windings, a stone siege cradle, an orbiting arcane armillary, and a gilded sun wheel. Staggered masonry, buttresses, inset runes, rivets and distinct stone, timber and metal palettes keep them readable from the strategic camera. Model geometry and materials are baked and shared; firing mechanisms animate independently on each deployed tower.

Each cannon also has its own visual attack signature:

| Cannon | Firing, flight and impact |
| --- | --- |
| Oak Ballista | Bow flex, feathered iron-tipped bolt, wooden splinters and sparks |
| Iron Mortar | Barrel recoil and smoke puff, banded fused shell, hot sparks, smoke bloom and double blast rings |
| Frost Spire | Floating ice pulse, spinning three-shard spear and spiral frost trail, ice spikes and freezing mist |
| Ember Cannon | Furnace vents and drifting embers, rolling fireball and spark trail, smoky fire splash and lingering flames |
| Venom Idol | Pulsing idol and toxic drips, wobbling green glob, poison mist, rising bubbles and pool ring |
| Storm Coil | Idle fork arcing, jagged lightning afterimages, sequential chain arcs and electric crackle |
| Watchman | Sharp muzzle flash, smoke and sliding bolt, fast golden dart, short tracer and piercing sparks |
| Earthshaker | Heavy kick and reloading stone cradle, tumbling fractured boulder and dust, debris and double shockwaves |
| Arcane Prism | Floating rotating armillary, orbiting violet shards and spiral trail, collapsing crystal burst |
| Sunspire | Turning sun wheel, radiant flare, luminous lance and spinning halos, sun rays and layered gold rings |

Soft glowing sparks and expanding smoke use two fixed GPU particle batches (900 glow slots and 220 smoke slots), with reusable buffers and shared shaders. Trails sample the actual traveled segment, ballistic models follow their flight tangent, and temporary lightning geometry is released when its afterimage fades. Burn, poison and frost particles follow affected enemies. Reduced motion suppresses decorative particles and moving mechanisms while preserving combat timing and visible projectiles. Everything is generated locally with no texture downloads or extra dependencies.

The meadow has **winding rivers, coastal seas and blocky ponds**. Rivers run continuously across chunk boundaries and meet the seas at a common waterline. Terraced banks and shallow coastal shelves descend into sea beds more than ten world units deep. A river lies about 56 world units along +Z from the tree; seas lie farther east and west. A nearby pond sits west of the starting clearing at **(-54, 6)**, and other ponds are seeded deterministically on a 64-block lattice, away from the clearing, channels and coasts. Ponds have raised grassy banks, muddy swimming basins, transparent animated water, lily pads, and five to nine fish. Fish swim in stable elliptical shoals, wag their tails, and produce small surface ripples. The herd prefers to stay on dry ground.

The goat wades in shallows and automatically **swims when its body is immersed**. Swimming uses buoyancy and water drag instead of walking on the bed, with a smoothly blended, alternating four-leg paddle, body roll, and a raised head. Hold Space to rise or Ctrl to dive; a surface swimmer can scramble over a one-block bank. Swimming resets air jumps without consuming them. Mouse look, free-pointer dragging and zoom all work underwater, and forward/backward swimming follows the camera pitch. The camera follows dives, retracts around solid banks and blocks, and gains blue distance fog underwater. Wakes, rising bubbles and synthesized splashes provide water feedback. Water now uses a **local voxel fluid simulation**. Natural ponds, rivers and seas supply renewable source cells. Breaking a bank lets water leak through the opening, fall down shafts and spread into lower ground or mined tunnels. Flow becomes shallower with distance; a full supported flow spreads up to seven cells. Solid blocks contain and displace it, and disconnected streams drain after the opening is sealed. Water never climbs uphill. Source-to-source conversion, buckets, lava and water currents are not implemented.

Collision checks the occupied voxels rather than treating everything below the terrain surface as solid. The goat can walk through mined tunnels, hits low ceilings when jumping, slides along walls, and lands on block ledges. The goat, herd and zombies share upright body boxes that keep their size when the model turns; horns, noses and animation poses do not enlarge collision. Movement follows player input or the NPC target independently of visual facing. Contact resolves at the block face, preserving wall slides and allowing characters to walk away from inside corners. True overlaps recover locally; touching a wall does not trigger a backward nudge. Herd spacing accounts for height, so an animal above a bridge cannot obstruct one below it. Dry bridges remain walkable even when water flows underneath them. Placement checks the goat, herd and zombies before consuming a block. Underground cameras use the actual floor below them; stomping removes the touching floor rather than the roof. Pickups fall when their support is mined and cannot be collected through walls. Grass and flowers disappear when their soil is mined or covered.

Gameplay runs at a fixed 60 simulation steps per second, with bounded catch-up after slow frames and no hidden-tab simulation. Block edits update collision immediately and batch mesh rebuilding by chunk. Prop meshes omit hidden faces, construction looks up placed blocks by chunk, and chunk streaming reuses its nearby-first queue. Fluid updates process at most 1,024 queued cells per tick; settled water needs no simulation work. Generation caches are bounded, and flowing cells outside streamed chunks are reconstructed from saved terrain edits when the area returns.

The player starts at **(8, 24)** in an open, level meadow, with the ancient **Hearth Tree** at its center, world coordinates **(0, 0)**. The meadow stays flat and dry for a **15-block radius** (30 world units) around the tree, leaving room to build defenses in every direction. Natural trees, rocks, ponds and rivers stay outside this space. A five-block terrain transition leads into denser woodland, hills and the infinite procedural wilderness. The builders place defensive walls on the lawn at least ten blocks from the tree and quarry turf outside the clearing; players can still dig and build everywhere on the lawn.

The tree's half-unit voxels form a forked oak, a layered green-and-gold crown, and mossy roots fitted to the terrain. An inset amber heart, golden sap seams, hanging lanterns, and slowly drifting embers make it a warm landmark after dark. The trunk, roots, and canopy have persistent collision; the foundation is protected from mining and herd construction. The tree starts with **100 HP**, shown alongside the coin balance and living enemy count in the defense HUD. Its glow fades as its health falls.

After **10 seconds** of preparation, the first wave sends four zombies. Each new wave sends three more enemies than the previous one, up to **200 per wave**; they enter individually, increasingly quickly. Clear every enemy to earn a **6–24 coin bonus** and start a **12-second preparation break**. Unfinished waves never stack on top of each other. Enemies spawn **54–72 world units** from the tree, fifty percent farther away than the original ring. Spawn selection prefers proven walking routes and falls back to viable breaches when the defense is sealed; isolated treetops cannot strand a wave. There are never more than **200 living enemies total**, across all species. Enemies get tougher as waves progress: health grows toward **5&times; and speed toward 3&times;** their wave-1 values, easing in fast early and slowly capping on long runs. Each zombie follows the terrain toward the tree and eats **1 HP every 3 seconds** while in contact with its trunk or roots. At zero HP, attacks and spawning stop and **Defend again** restarts the game.

Zombies walk around high walls and hills, jump up **one block**, and cannot jump up two. Shared navigation covers the defense arena, 56 world units in each direction from the tree, and updates locally when blocks change. If no walking route exists, zombies plan a breach and chew each obstructing block for **10 seconds**. Terrain can be tunneled and player-built walls can be dismantled. Every chewed block becomes a **persistent collectible drop**; nearby matching materials stack and can be collected and placed again. The tree's protected foundation remains intact, and the arena stays loaded while the goat explores elsewhere.

Select **Horns & Hooves** to fight: two base headbutts or one stomp kill a zombie. Headbutts hit up to three enemies, stomps up to eight, and NPC hunters strike one target at a time; closest valid targets take priority. Walls block attacks even after reach upgrades. Killed enemies leave **physical gold pickups**, including kills made by hunters. Walk close to attract and collect them, just like blocks; they never take a hotbar slot. Coin stacks persist and retain their full value. The wallet changes when coins are collected, rather than on a kill. Wave-clear bonuses are paid directly.

Press **Q** near an animal to train it, or away from the herd to train yourself. The menu shows current and next effects, tier progress, owned resources and prices. Each animal keeps its own upgrades; a sheep's training never affects another sheep. Training lasts until the run ends. You start with **45 coins, 4 wood (oak logs), 5 stone, 4 soil, 2 coal, 3 copper and 3 iron**, enough to build any one tower immediately or spend on training. In strategic view, workshop cards have a red border whenever you lack the resources to build them; packed towers remain available for free redeployment. Mine natural trees for more logs. **Stone is guaranteed beneath the grass and one dirt layer**; dig two blocks down, then mine the exposed stone. The cyan minimap marker leads to a nearby cave entrance at **(21, 33)**; materials are spent from the hotbar, including a currently carried stack.

| Training | Effect per tier | Coin prices (tiers 1 / 2 / 3) | Block prices | Available to |
| --- | --- | --- | --- | --- |
| Fleet hooves | +12% movement | 8 / 20 / 36 | 2 / 4 / 6 wood | Player and every NPC |
| Quick strikes | +18% attack speed, including windup/recovery | 10 / 24 / 42 | 2 / 4 / 6 stone | Player and hunters |
| Long horns | +0.4 units of attack reach | 8 / 20 / 36 | 2 / 4 / 6 wood | Player and hunters |
| Heavy horns | +0.5 damage per hit | 12 / 28 / 48 | 3 / 5 / 8 stone | Player and hunters |
| Practiced builder | +25% quarry/place/job preparation speed | 8 / 18 / 32 | 2 / 4 / 6 stone | Builders |

Every track has three tiers. Bonuses add within each track, with movement capped at +36%, attack speed at +54% and work speed at +75%. Damage tier 2 changes basic zombie headbutts from two hits to one, while brutes still need focused attacks. Prices rise so upgrading the player competes with investing in hunters and wall repairs.

| Enemy | First wave | HP | Move speed | Hearth damage | Wall break time | Dropped coins |
| --- | --- | --- | --- | --- | --- | --- |
| Zombie | 1 | 2 | 1.65 | 1 / 3s | 10s | 1 |
| Spider | 3 | 2 | 2.7 | 1 / 3.5s | 12s | 2 |
| Skeleton | 5 | 3 | 1.9 | 1 / 2.6s | 10s | 2 |
| Stone brute | 8 | 7 | 1.15 | 2 / 3.5s | 7s | 4 |

Spiders pressure gaps with speed, bone-white skeletons add staying power, and slow stone brutes threaten walls. Brutes occupy at most one in six wave slots; zombies remain the main force. All types share the arena routes, one-block jumps and live wall collision, with individual body sizes. Beveled voxel parts, hierarchical joints, species-specific silhouettes, layered faces, clothing, bone and rock details share one bounded instanced draw; fallen bodies do not count toward the live cap.

An enemy watchdog measures meaningful progress rather than animation or tiny jitter. **After 20 simulation seconds without getting closer to the Hearth or advancing along a valid route, the enemy bursts apart and drops its normal collectible coins.** Successful wall breaks and Hearth damage count as progress, so real sieges do not trigger false alarms. The watchdog applies to every species, frees live slots immediately, and does not damage terrain, allies or the Hearth. Its debris shares the bounded death pool and respects reduced motion. Pausing the training menu pauses the watchdog too.

Below the meadow, deterministic winding caves cross chunk boundaries and open into chambers with four world units of headroom. Three-block-wide stair entrances lead underground; the starter entrance lies just southeast of spawn and has a clear exit. The Hearth foundation stays solid, and covered caves retain their soil/stone roof. Water can enter only if a player breaches the separating rock. Stone, coal ore, copper ore and iron ore have separate textures, drops, hotbar stacks and placeable block forms; exposed starter veins make each ore discoverable. Mining edits persist across chunk streaming. A warm player light makes underground exploration readable.

The meadow runs a complete **60-second day/night cycle**: warm sunrise, blue midday, golden sunset, then a moonlit night with stars. The sun follows a physically based solar path for 50°N on the equinox, so its orbit is tilted, it casts moving shadows, and day and night are each 30 seconds long.

A small herd lives in the meadow: two sheep (Mallow and Poppy), a cow (Clover) and a stag (Bramble). Bramble and Poppy are hunters: they chase nearby zombies and headbutt them, using the same two-hit combat rules as the goat. Mallow and Clover are builders.

The builders shave the top turf course around a flat site, one block at a time, and carry the load between their horns. Each project is a straight, two-block-high wall section ten blocks long, with every block at least ten blocks from the Hearth Tree. Every block is real and collides with the player and zombies. Builders revisit their completed sections and replace missing blocks before starting new ones, so walls damaged by zombies are repaired automatically.

NPC recovery measures progress toward the current walk, hunt, quarry, build, climb, or descent target. A blocked animal tries a validated jump, then a local detour, then digs a body-sized opening and uses the recovered blocks to build steps out. Recovery can dismantle placed blocks when physically necessary; ordinary quarrying still leaves player construction alone, and the Hearth Tree foundation remains protected. Solvable escapes happen through normal movement and block edits, with relocation reserved for a final failed-recovery fallback. `scripts/test-animal-recovery.mjs` runs each stuck scenario against one independently controlled NPC. Animal quarrying creates no competing item drops.

The HUD keeps Hearth health at the upper left, the wave timer at the top center, resources at the upper right, and the hotbar along the bottom. A circular **80m minimap** at the lower left stays centered on the player and points north. A white arrow shows the player and facing, red dots show enemies, green dots show animals, gold dots show dropped coin stacks, and the gold diamond marks the Hearth. Coin dots follow the loot and disappear when collected. Ringed edge markers indicate locations beyond range. The controls guide opens only when requested. The layout adapts to narrow screens without covering the central action.

Goat and herd movement blend through planted-hoof stance, ankle articulation and lifted recovery, with breathing, weight shifts, turn lean, landing compression and timed attack wind-ups. Layered fleece, expressive faces, cloven hooves and secondary ear, tail and bell motion give each species a distinct silhouette. Builders strike at the moment their block edit happens, and hunters wind up before dealing damage. Every enemy has hierarchical joints: zombies shamble and reach, skeletons loosen their bone gait, spiders step on eight two-segment legs, and brutes carry their armor with heavy sway. Chewing, recoil and brief collapses remain bounded by the death pool. Fish bank through turns and vary tail cadence with their speed. Reduced motion suppresses extra leaning, compression, death tumbles and item spins.

All sounds are synthesized in-browser; there are no audio files. Zombies have original raspy, vowel-shaped moans, hurt and death cries, dry bites and scraping steps. Herd species have distinct calls, footsteps and jump/landing sounds. Breaking and placing blocks, changing hotbar slots, arriving waves, Hearth damage and defeat also have cues. World effects attenuate with distance and pan relative to the camera; distant events are culled, and crowd sounds are rate limited. Hoof and combat impacts use short, dry transients rather than exaggerated bass slides.

Music and effects share a filtered, compressed output with volume headroom. Every note and effect fades in and ends at exact silence, and finished voices release their audio nodes. The wind loop has smooth endpoints; late music timers skip missed beats instead of playing a burst of overdue notes. Rapid music toggles preserve the current fade level and cancel notes queued by the previous playback.

## CI and hosting

Every push and pull request runs the CI workflow: it checks every classic-script module with `node --check`, runs `node --test scripts/test-*.mjs`, builds the playable `_site/` artifact, verifies all local asset references, and smoke-tests the result over a local HTTP server. The water tests cover river continuity, generation-cache eviction, terrain edits, swimming and diving, bed/ceiling collisions, shore exits, frame-rate stability, held-key combinations and the underwater camera. The audio tests cover silent envelope endpoints, shared mixing, wind-loop seams, delayed timers, suspended contexts, rapid music toggles, bounded polyphony, positional attenuation, camera-relative stereo, crowd limits, independent effects mute and node cleanup during long playback.

Pushes to `main` also run the Pages workflow, which rebuilds and checks the same artifact and deploys it with the official GitHub Pages Actions. The published game is served from **[https://ripopov.github.io/goat-craft/](https://ripopov.github.io/goat-craft/)**.
