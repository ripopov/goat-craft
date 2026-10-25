# Meadow Goat

[![CI](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml/badge.svg)](https://github.com/ripopov/goat-craft/actions/workflows/pages.yml)

**Play online: [ripopov.github.io/goat-craft](https://ripopov.github.io/goat-craft/)**

An endless blocky meadow with a procedural goat, winding rivers, deep seas, ponds full of fish, a wandering herd of animals, a three-minute day/night cycle, and growing enemy waves that attack a living Hearth Tree, built with three.js.


## Run it

Open **`index.html`** directly in a browser (`file://`). No server, build step or package install is required for local play. Keep the folder structure intact.

## Structure

```
index.html          markup only
css/style.css       page + HUD styling
vendor/three.min.js three.js r149 (classic UMD build)
js/core.js          shared config, math helpers, material helper
js/audio.js         shared WebAudio mixer, smooth sound envelopes, voice cleanup, bleat, hoofbeats, jump/land, headbutt/stomp, pickup, breath and splash sounds
js/music.js         original adaptive three-movement Dorian soundtrack (WebAudio)
js/ui.js            hint, speech bubble and "Say hi" button
js/console.js       / developer console with money and spawn shortcuts
js/items.js         ten-slot hotbar, block drops, pickup and item stacking
js/actor-physics.js shared body collision, buoyancy, shore jumps, swept movement, support and overlap recovery
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
js/hell-gates.js    four unbreakable forest portals, winding permanent roads and protected spawn openings
js/enemy-rules.js   species stats, special-wave registry, difficulty, timers and rewards
js/enemy-models.js  beveled voxel geometry and articulated enemy model construction
js/enemies.js       nine instanced species, parachutes, tunnels, specialist abilities and combat
js/coin-model.js    shared minted gold geometry, emissive finish and animated glint
js/upgrades.js      individual training tiers, prices, resource purchases and nearby targeting
js/upgrade-menu.js  accessible paused training menu, character switching and purchase feedback
js/minimap.js       circular player-centered radar for enemies, herd, coin drops and the Hearth
js/fish.js          seeded pond fish, lily pads, ripples and shoal animation
js/water.js         pooled swimming wakes/bubbles, underwater fog/tint and swimming status
js/environment.js   3-minute solar cycle, dynamic sky/lighting, moon, stars, drifting clouds
js/animal-style.js shared speed-style glow, wheel rims and elemental horn styling for the goat and herd
js/goat.js          goat rig, coat, gaits, swimming/buoyancy, physics, jumps, elemental spells, headbutt and hoof stomp
js/animal-models.js species definitions, sheep/cow/stag rigs, shared materials and fitting scales
js/animal-navigation.js cached body-sized visibility paths around the Hearth roots
js/animal-recovery.js target-progress monitoring, jump/detour decisions, and dig/build escape target selection
js/animals.js       specialized sheep, cow and stag NPCs: zombie hunting, spell casting, wall building, repairs and physical recovery
js/controls.js      pointer-lock mouse look, third-/first-person cameras, keyboard and touch input
js/main.js          bootstraps the scene and owns the render loop
scripts/build-site.mjs  copies the playable files into _site/
scripts/check-site.mjs  checks local asset references in the built site
scripts/helpers/animal-game.mjs  reusable real-world fixtures with one independently controllable NPC
scripts/test-collision.mjs corner escapes, wall seams, corridors, all herd species, bridges and root collision
scripts/test-fluids.mjs source spreading, waterfalls, walls, tunnels, draining and bounded simulation work
scripts/test-swimming.mjs surface routes, enemy/NPC paddling, high shore exits, headroom and airdrop water landings
scripts/test-water.mjs  dependency-free terrain, bank leaks, swimming, collision, input and camera regression tests
scripts/test-audio.mjs  dependency-free audio scheduling, fade, mixing and voice-lifetime regression tests
scripts/test-console.mjs keyboard capture, command history and resource/wave console shortcuts
scripts/test-hearth-tree.mjs  landmark geometry, root collision, clearing terrain, player spawn, placement and reduced-motion checks
scripts/test-enemies.mjs  routes, jumps, chewing, tree damage, mixed waves, shared cap and loot
scripts/test-hell-gates.mjs  distant permanent gate collision, protection and species delivery
scripts/test-special-enemies.mjs  airdrops, physical Worm tunnels, mining combat and specialist counterplay
scripts/check-enemy-balance-tests.mjs  separately runnable full-defense clearance regressions
scripts/check-enemy-balance.mjs  staged loadout combat and CPU timing benchmark
scripts/check-performance.mjs  sustained 200-enemy / 80-tower CPU and render-batch benchmark
scripts/test-model-modules.mjs standalone model construction, joint validity, capacities and cache ownership
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

The modules are **classic scripts** (IIFEs) sharing a small `window.Meadow` namespace. They are deliberately not ES modules: browsers block `import` and `fetch` from `file://` for security reasons, which would require a local server. Classic `<script src>` tags work from disk, so this remains a zero-server static page. See [the architecture and extension guide](docs/architecture.md) for module responsibilities, dependency order, and adding species or special waves.

## Controls

- **WASD / arrow keys** — move
- **Shift** — gallop (2× speed, four-beat gait), or swim faster in water
- **Space** — jump (up to three times in the air); hold to swim toward the surface. Near shore, jump toward a surface block to climb out, or keep moving into the bank for an automatic shore jump.
- **Ctrl** — hold to dive deeper; WASD still works while Ctrl is held
- **W / S + mouse look** — swim along the view pitch; A / D strafe horizontally. Space / Ctrl override vertical steering.
- **Left click / tap / E** — mine the block under the center reticle (up to 5.5 units away, aimed in any direction from the camera), or place the selected block on the aimed face instead. Attacks are never bound to input here: the goat fights automatically. P gives an unobstructed first-person view for precise mining.
- **Right click** — same mine / place action
- **Q / Upgrades** — open training; selects a visible animal within 5.5 units, otherwise your goat. Switch to your goat using its tab. Q toggles the menu open and closed. The world pauses while training.
- **1–9 / 0** — select hotbar slot (slot 1 is horns and hooves; broken blocks stack in the other slots)
- Selected blocks ride on the goat's horns. A hollow mint contour previews placement; coral means the cell is blocked. A gold contour marks the aimed mining block, and a gold animal outline shows which NPC Q will open. Enemies are never outlined for combat: attacks are automatic.
- **P** — toggle between third-person and first-person (FPS) cameras
- **T / Strategic view** — enter or leave the live RTS camera. Your goat roams with its own AI while the battle continues. Your previous FPS / third-person view returns when you leave.
- In strategic view: **WASD / arrows / drag** pan, **Shift** pans faster, **scroll** zooms, **Space / Hearth** centers the objective, and **Goat** centers on your goat. Select a cannon in the workshop or use **1–0**, then click dry, supported ground. A green tower ghost and ring show a valid site and attack range; red means blocked or unaffordable. **Shift-click** deploys repeatedly. **Right-click** cancels selection; **T / Close** returns to your goat.
- Click a deployed tower to inspect its stats and kills, or **Pack tower**. You can also mine any tower block using your horns in FPS / third-person view. The whole cannon becomes one persistent item: walk your goat over it to collect it into the hotbar. Select that stack and place it like a block, or redeploy it from the RTS workshop at no resource cost. Full inventories leave the pickup on the ground. Towers also pack if their foundation is mined, and enemies can chew them when breaching defenses.
- **Mouse look** (button / **F**) — capture the pointer and steer either camera with the mouse; **F** releases it. Once enabled, capture returns automatically after closing training, returning from strategic view, or refocusing the game, until you explicitly release it. Use **Q** to close training, **T** to leave strategic view, and **/** to close the console.
- **Drag / pinch** — orbit and zoom while the pointer is free (drag and pinch are the touch fallback)
- **Say hi** — bleat and jump
- **Music** (top-right button) — toggle the adaptive original soundtrack; enabled by default and starts with the first click or keypress permitted by the browser
- **Sound** (top-right button) — mute/unmute effects independently of music; enabled by default
- **? Controls** (bottom-left) — toggle the compact controls guide; click the button again to close it
- **/ — Console** — open a developer console; **/** again closes it, mirroring how Q toggles the upgrades menu and T toggles the strategic view. `money` grants 1000 coins and 1000 of every tower resource; `spawn` starts the next enemy wave immediately; `spawn 10` jumps directly to wave 10 (and lower levels work too). Enter runs a command, and Up / Down recalls history.

### Cannon workshop

The compact strategic HUD uses a single tower strip beneath the animal upgrade toolbar. On narrow screens, swipe or scroll the strip horizontally to reach all ten towers; the **1–0** shortcuts also work. Tower stats and packing controls appear only when a blueprint or deployed tower is selected.

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

Collision checks the occupied voxels rather than treating everything below the terrain surface as solid. The goat can walk through mined tunnels, hits low ceilings when jumping, slides along walls, and lands on block ledges. The goat, herd and zombies share upright body boxes that keep their size when the model turns; horns, noses and animation poses do not enlarge collision. Movement follows player input or the NPC target independently of visual facing. Contact resolves at the block face, preserving wall slides and allowing characters to walk away from inside corners. True overlaps recover locally; touching a wall does not trigger a backward nudge. Herd spacing accounts for height, so an animal above a bridge cannot obstruct one below it. Dry bridges remain walkable even when water flows underneath them. Placement checks the goat, herd and zombies before consuming a block. Underground cameras use the actual floor below them. Pickups fall when their support is mined and cannot be collected through walls. Grass and flowers disappear when their soil is mined or covered.

Gameplay runs at a fixed 60 simulation steps per second, with bounded catch-up after slow frames and no hidden-tab simulation. Block edits update collision immediately and batch mesh rebuilding by chunk. Prop meshes omit hidden faces, construction looks up placed blocks by chunk, and chunk streaming reuses its nearby-first queue. Fluid updates process at most 1,024 queued cells per tick; settled water needs no simulation work. Generation caches are bounded, and flowing cells outside streamed chunks are reconstructed from saved terrain edits when the area returns.

Deployed towers share instanced GPU batches by geometry and material, including shadow rendering, while retaining independent aiming, recoil and loading mechanisms. Projectile collision uses a six-meter spatial grid rebuilt from current enemy positions each simulation tick; swept hits, splash and chain attacks query nearby cells. Enemy voxel transforms and palette colors are precomputed. Catch-up steps and multi-victim spells prepare the horde only once for the displayed frame, and instance uploads cover only occupied slots.

Run `node scripts/check-performance.mjs` for a seeded, sustained battle at both caps (200 enemies and 80 mixed towers). It reports median and p95 CPU times plus visible mesh and shadow batch counts; timings exclude WebGL and depend on hardware. An optional frame count, such as `node scripts/check-performance.mjs 1200`, extends the measured run after a 120-step warmup. Add a blueprint ID, such as `node scripts/check-performance.mjs 360 arcane`, to stress 80 rapid-fire towers. Combatants remain invulnerable so the workload cannot shrink as enemies die.

The player starts at **(8, 24)** in an open, level meadow, with the ancient **Hearth Tree** at its center, world coordinates **(0, 0)**. The meadow stays flat and dry for a **15-block radius** (30 world units) around the tree, leaving room to build defenses in every direction. Natural trees, rocks, ponds and rivers stay outside this space. A five-block terrain transition leads into denser woodland, hills and the infinite procedural wilderness. The builders place defensive walls on the lawn at least ten blocks from the tree and quarry turf outside the clearing; players can still dig and build everywhere on the lawn.

The tree's half-unit voxels form a forked oak, a layered green-and-gold crown, and mossy roots fitted to the terrain. An inset amber heart, golden sap seams, hanging lanterns, and slowly drifting embers make it a warm landmark after dark. The trunk, roots, and canopy have persistent collision; the foundation is protected from mining and herd construction. The tree starts with **100 HP**, shown alongside the coin balance and living enemy count in the defense HUD. Its glow fades as its health falls.

After **30 seconds** of preparation, the first three waves send **6, 10, and 14 enemies**. Each wave adds four enemies, up to **200 per wave**. Enemies enter in **squads of three**, growing to four on wave four and five on wave nine. Squad members spawn 0.6 seconds apart at first, with a 4.2-second recovery gap between squads; later waves tighten these intervals to 0.3 and 2.4 seconds. The opening attacks from the goat's side of the meadow, wave two alternates squads between **two opposing approaches**, and wave six adds a **third front**. These changes fall between species introductions to avoid stacking difficulty spikes. The front rotates between waves. The HUD shows approach directions and the next squad countdown; **amber warning triangles on the minimap** mark incoming approaches, including during preparation.

Ground enemies emerge from **four permanent hell gates** deep in the forest, roughly **77–89 world units** from the Hearth. Jagged obsidian horns, molten seams and animated red-orange portals mark each entrance; red gate symbols remain visible on the minimap. Gate frames and stone foundations are **unbreakable**, and their openings stay clear for arrivals. Each gate has a winding, six-unit-wide stone road to the Hearth, graded into walkable steps and raised across water. Enemies favor the roads but can detour around defenses. The paving cannot be mined or destroyed; players can still build walls on top. Squads alternate between the announced gates. **Worms spawn underground beneath the announced gates**, tunnel toward the Hearth, then emerge in a 19–36-unit band and crawl on the surface. Parachute drops retain their separate air delivery. Blocked gate attempts retain the queued enemy and retry without releasing a catch-up burst. There are never more than **200 living enemies total**, across all species. Clear every enemy to earn a **6–24 coin bonus** and start a **10-second preparation break**. After every tenth wave (10, 20, 30, and so on), the break lasts **one full minute**. Unfinished waves never stack on top of each other.

Health stays at its base value through **wave three**, letting the opening teach positioning and squad control before durability starts increasing. Health then grows toward **5&times;**, while speed grows more gradually toward **3&times;** its wave-one value. Enemy stats are fixed when they spawn. Each zombie follows the terrain toward the tree and eats **1 HP every 3 seconds** while in contact with its trunk or roots. At zero HP, attacks and spawning stop and **Defend again** restarts the game.

Zombies walk around high walls and hills, jump up **one block**, and cannot jump up two. All surface enemy species swim across deep water with buoyancy and paddling animations, then jump onto a clear bank up to one block above the waterline. NPCs that fall into water paddle back toward a shore and use the same exit check; normal wandering still avoids entering water. Shore jumps need a nearby solid landing and clear headroom. Shared navigation covers the defense arena and extends along the four forest approaches to the distant gates; it updates locally when blocks change. If no walking route exists, zombies plan a breach and chew each obstructing block for **10 seconds**. Terrain can be tunneled and player-built walls can be dismantled. Every chewed block becomes a **persistent collectible drop**; nearby matching materials stack and can be collected and placed again. The tree's protected foundation, hell gates and roads remain intact, and the arena stays loaded while the goat explores elsewhere.

Select **Horns & Hooves** to fight — the goat attacks **fully automatically**, Vampire-Survivors style, whenever an enemy is in reach: two headbutts or one stomp kill a zombie, each headbutt hits only one enemy for 1 base damage, while stomps hit up to eight, and NPC hunters strike one target at a time; closest valid targets take priority. The goat never turns you toward a target: your facing stays fully mouse-controlled, bolts and fireballs auto-aim at the nearest enemy, melee headbutts swing at what you look at, and the stomp pounds everything in range all around. All attack ranges are **tripled**: the default headbutt reaches about 8.4 units and the stomp 9.3, so the goat clears a wide circle around your position while you build and mine. **Long horns** training re-forges the horns of the player **and every trained hunter** into an elemental caster: tier 1 throws a lightning bolt at the nearest enemy within **9 blocks**, tier 2 chains electricity across up to three foes within **12 blocks**, and tier 3 lobs a fireball up to **30 blocks** that bursts with a **3-block blast radius**. Walls stop the bolt; a fireball instead bursts on the wall and burns whatever sits near the impact. Killed enemies leave **physical gold pickups**, including kills made by hunters. Walk close to attract and collect them, just like blocks; they never take a hotbar slot. Coin stacks persist and retain their full value. The wallet changes when coins are collected, rather than on a kill. Wave-clear bonuses are paid directly.

Press **Q** near an animal to train it, or away from the herd to train yourself. In **strategic view**, click Mallow, Clover, Bramble or Poppy's portrait in the workshop toolbar to open that animal's upgrades from anywhere on the map. The menu shows current and next effects, tier progress, owned resources and prices. Each animal keeps its own upgrades; a sheep's training never affects another sheep. Training lasts until the run ends. You start with **no coins or materials**, carrying only your built-in Horns & Hooves. Gather supplies and earn gold to build towers or train. In strategic view, workshop cards have a red border whenever you lack the resources to build them; packed towers remain available for free redeployment. Mine natural trees for more logs. **Stone is guaranteed beneath the grass and one dirt layer**; dig two blocks down, then mine the exposed stone. The cyan minimap marker leads to a nearby cave entrance at **(21, 33)**; materials are spent from the hotbar, including a currently carried stack.

| Training | Effect per tier | Coin prices (tiers 1 / 2 / 3) | Block prices | Available to |
| --- | --- | --- | --- | --- |
| Fleet hooves | +33% movement; builders also gather and build faster (2× at tier 3) | 8 / 20 / 36 | 2 / 4 / 6 wood | Player and every NPC |
| Quick strikes | +33% attack speed (2× at tier 3), with braced jab → spring snap → piston strike neck models and animations | 10 / 24 / 42 | 2 / 4 / 6 stone | Player and hunters |
| Long horns | Electric bolt (9 blocks) → electric chain (12 blocks) → fireball (30 blocks, 3-block blast) — the same strike tiers for the player and hunters | 8 / 20 / 36 | 2 / 4 / 6 wood | Player and hunters |
| Heavy horns | +0.7 damage per hit (3× at tier 3), larger horns, tiered beards and thicker, brighter spell effects | 12 / 28 / 48 | 3 / 5 / 8 stone | Player and hunters |
| Practiced builder | +25% work speed; unlocks Frost Spires I → II → III alongside walls and coin collection | 8 / 18 / 32 | 2 / 4 / 6 stone | Builders |

Every track has three tiers. Bonuses add within each track: movement and attack speed cap at +100% (2×), strike damage caps at 3× the base value (and every base range is tripled). For builders, Fleet hooves also speeds up quarrying, placement and job preparation by +33% per tier, reaching **2× gathering and building speed at tier 3**. Builders still gather and carry real blocks, consuming one per placement. Practiced builder adds its own multiplier, up to 1.75×; training both tracks fully gives 3.5× work speed. A single tier of Heavy horns lets basic zombie headbutts, bolts and fireballs drop in one hit; brutes still need focused attacks. The Long horns tiers each change the strike itself on the player **and on hunters**: an electric bolt, then a chaining arc, then a fireball. Because attacks are automatic, the goat repeatedly clears everything in reach while you dig tunnels, haul resources and build towers — and a trained hunter turns into a second, mobile artillery piece. Holding a selected block (about to place) keeps the goat out of combat.

Fleet hooves and Long horns training are visible on the goat **and on the trained animals**, never stat-only changes. Energized hooves glow with teal bands at tier 1, gold leg bands deepen the stride and add a bouncier hop at tier 2, and tier 3 turns the whole animal into a cartoon blur: magenta wheel rims spin at each hip and the legs cartwheel end over end like wheel spokes, winding down to a normal trot when the animal stops. The horns charge alongside them: pulsing cyan tips at tier 1, gold overcharge with base bands at tier 2, and molten fire horns at tier 3 that flare before every fireball. Hunters fire the same elemental projectiles, and builders show the same speed glow as they hustle between jobs.

**Quick strikes** also changes the neck model and attack motion at every tier, immediately on purchase, for the goat and each trained hunter. Tier 1 broadens the neck with a teal brace and a sharp jab; tier 2 lengthens it into a gold-braced spring neck that coils sideways before snapping forward; tier 3 adds three violet braces, overlapping front plates and side pistons, with a compressed windup and rapid recoil. The goat's eyes change alongside its neck: teal, gold, then violet irises, with progressively brighter shine, extra catchlights and a star-shaped gleam at tier 3. The dark horizontal pupils remain visible, and the shine follows the goat's blinking. Headbutts, elemental casts and the player's stomps use the new motion on their existing impact clocks. The head stays attached as the neck extends, and reduced motion removes sideways twists and recoil while limiting extension.

**Heavy horns** grows thicker, longer horns at every tier, reaching almost twice their original length at tier 3. The goat and trained hunters gain a fuller pointed goatee at tier 1, a forked beard with gold ties at tier 2, and a long woven braid with a gold clasp at tier 3. Elemental tips and bands stay attached as horns and antlers grow. Lightning bolts and every chain link gain progressively thicker white cores and cyan halos; fireballs grow into bright cores inside orange shells and amber coronas, with rotating rings at tiers 2 and 3. Larger ember trails, sparks and impact glows show the caster's own Heavy horns tier. These visual changes preserve the existing spell range, flight speed, blast radius and damage rules. Temporary effects expire, spark particles reuse a bounded pool, and reduced motion suppresses the extra spell effects.

| Enemy | First wave | HP | Move speed | Hearth damage | Wall break time | Dropped coins |
| --- | --- | --- | --- | --- | --- | --- |
| Zombie | 1 | 2 | 1.65 | 1 / 3s | 10s | 1 |
| Spider | 3 | 2 | 2.7 | 1 / 3.5s | 12s | 2 |
| Skeleton | 5 | 3 | 1.9 | 1 / 2.6s | 10s | 2 |
| Briar Binder | 7 | 3 | 1.35 | 1 / 3.8s | 11s | 3 |
| Stone brute | 8 | 7 | 1.15 | 2 / 3.5s | 7s | 4 |
| Burrow Worm | 10 | 4 | 1.6; 2.1 underground | 1 / 3.6s | 9s | 4 |
| Prismback | 12 | 4 | 1.25; short 2× rush | 1 / 3.8s | 9s | 4 |
| Mire Sower | 15 | 3 | 1.5 | 1 / 3.5s | 11s | 3 |
| Boss | 7 | 20× a regular enemy | 1.2 | 2 / 4s | 6s | 20 |

Spiders pressure gaps with speed, bone-white skeletons add staying power, and slow stone brutes threaten walls. Brutes occupy at most one in six wave slots; zombies remain the main force. Beveled voxel parts, hierarchical joints, species-specific silhouettes, layered faces, clothing, bone and rock details share one bounded instanced draw; fallen bodies do not count toward the live cap.

From **wave 7 onward, every 7th wave leads with a Boss**: a hulking blackened war-brute (30% larger) with a molten chest core and **glowing red eyes**, marching ahead of the same wave's regular horde. It has **twenty times the health** of a regular enemy at that wave, keeps its punches reaching the Hearth at 2 HP per bite, chews walls in 6 seconds, and drops **20 coins**. A gold star on the minimap tracks it, and its deep stone-and-wood roar plays on idle, hurt and death. Focused stomps, splash damage, elemental chains and full tower fire all work; the same solid wall-chew rules and the 30-second distance watchdog apply. The Boss replaces exactly one ordinary slot — every 7th wave is that slot larger in spirit, not in count.

**Waves 20, 40, 60 and 80 deliver every enemy by parachute**, retaining the mixed species roster; air-dropped Worms crawl after landing. From **wave 5**, some zombies and skeletons descend by parachute into the outer meadow. A lavender landing marker warns of their arrival; they can be shot during descent and recover for 0.9 seconds after landing. **Waves 30, 70 and 130 contain only Worms**, overriding the usual mixed roster and wave-70 Boss. From **wave 10**, Worms spawn beneath the distant gate foundations and excavate covered tunnels toward the Hearth, passing below the unbreakable roads. Their segmented bodies remain modeled and animated inside the soil: **mine down into a tunnel to find and fight them normally**. Soil blocks attacks. Worms emerge only within **19–36 world units** from the Hearth — twice the previous emergence distance — with a warning and a short recovery. The band is biased outward so they dig out earlier, and a Worm that finds no walkable exit fills its shaft and re-targets a fresh surfacing point rather than stalling underground.

**Briar Binders** chant before slowing one tower to 60% firing cadence for three seconds. Kill the caster to interrupt or release the snare. **Prismbacks** mitigate frontal direct hits by 55%; flank them or use splash. A visible brace precedes their rush, followed by an open-armor window. **Mire Sowers** outline a puddle before it forms, slowing goat and herd movement by 35% for five seconds; leave or jump clear. Puddles and snares do not stack. Specialists replace ordinary wave slots, with bounded casts and effect counts. Each has an original articulated model, warning effects and spatial synthesized audio. See [enemy design and validation](docs/enemy-design.md) for timings, counters and research.

An enemy watchdog measures each enemy's closest approach to the Hearth, ignoring animation and tiny jitter. **After 30 simulation seconds without reducing that distance by at least half a world unit, the enemy explodes and drops its normal collectible coins.** Wall breaks, attacks, casting, circling and route replanning do not reset the timer. The four-unit blast destroys ordinary terrain and player-built blocks, leaving recoverable materials, but cannot destroy the gates, road paving, protected foundation or Hearth tree. It does not damage the objective or other actors. The watchdog applies to every species and frees live slots immediately; its effects are bounded and respect reduced motion. Pausing the training menu pauses the watchdog too.

Below the meadow, deterministic winding caves cross chunk boundaries and open into chambers with four world units of headroom. Three-block-wide stair entrances lead underground; the starter entrance lies just southeast of spawn and has a clear exit. The Hearth foundation stays solid, and covered caves retain their soil/stone roof. Water can enter only if a player breaches the separating rock. Stone, coal ore, copper ore and iron ore have separate textures, drops, hotbar stacks and placeable block forms; exposed starter veins make each ore discoverable. Mining edits persist across chunk streaming. A warm player light makes underground exploration readable.

The meadow runs a complete **3-minute day/night cycle**: warm sunrise, blue midday, golden sunset, then a moonlit night with stars. The sun follows a physically based solar path for 50°N on the equinox, so its orbit is tilted, it casts moving shadows, and day and night are each a minute and a half long. An **oversized stylized sun** with a layered corona floats in the sky, kept subtly alive by a slow breathing pulse; the night brings an equally huge **cratered moon** with dark maria, rim-lit craters and a silver-blue halo.

A small herd lives in the meadow: two sheep (Mallow and Poppy), a cow (Clover) and a stag (Bramble). Bramble and Poppy are hunters: they chase nearby zombies and headbutt them, casting the same elemental spells and wearing the same glow, wheel rims and charged horns as the goat once trained. Mallow and Clover are builders, who anchor the defense economy by quarrying and stacking walls.

The builders shave the top turf course around a flat site, one block at a time, and carry the load between their horns. Each project is a straight, two-block-high wall section ten blocks long, with every block at least ten blocks from the Hearth Tree. Every block is real and collides with the player and zombies. Builders revisit their completed sections and replace missing blocks before starting new ones, so walls damaged by zombies are repaired automatically.

**Practiced builder tier 1** also unlocks occasional **Frost Spire** construction alongside wall projects. Trained builders walk to nearby dropped coins and keep a personal construction purse, shown with their gathered tower stone in the upgrade menu. Each spire costs **12 collected coins and 3 quarried stone**; builders uncover and mine natural stone outside the clearing, without using the player's wallet or hotbar. Untrained builders continue making walls and leave coins for the player. Coins cannot be collected through walls or from another floor, and a stack is claimed only once. Builders start with wall construction, preserve their wall project during tower jobs, and resume walls and repairs afterward. When tower funds or a safe site are unavailable, ordinary wall work continues.

Builder spires deal **0.5 / 1 / 1.5 damage** and fire every **1.3 / 1.15 / 1 second** at Practiced builder tiers 1 / 2 / 3, retaining Frost Spire range and slowing. One, two or three glowing marks show their tier. Training a builder also improves that builder's standing spires; player-built towers keep their own stats. Mining a spire packs its current tier into a collectible tower item, which can be redeployed from the hotbar or the strategic Frost card without paying again. Towers share the existing 80-tower limit, dry-foundation checks, collision and physical projectile rules.

NPC walking uses a shared, body-sized visibility graph around the Hearth roots. Collision-checked routes stay committed to one side, reuse cached edges, and invalidate after construction or target changes; hunters also route around cover instead of swinging through the trunk. NPC recovery measures progress toward the current walk, hunt, quarry, build, climb, or descent target. A blocked animal tries a validated jump, then a local detour, then digs a body-sized opening and uses the recovered blocks to build steps out. Recovery can dismantle placed blocks when physically necessary; ordinary quarrying still leaves player construction alone, and the Hearth Tree foundation remains protected. Solvable escapes happen through normal movement and block edits, with relocation reserved for a final failed-recovery fallback. `scripts/test-animal-recovery.mjs` runs each stuck scenario against one independently controlled NPC. Animal quarrying creates no competing item drops.

The HUD keeps Hearth health at the upper left, the wave timer at the top center, resources at the upper right, and the hotbar along the bottom. A circular **80m minimap** at the lower left stays centered on the player and points north. A white arrow shows the player and facing, red dots show enemies, green dots show animals, gold dots show dropped coin stacks, and the gold diamond marks the Hearth. Minted gold coins have beveled edges, raised rims and a Hearth flame on both faces; their emissive gold and moving glint remain visible in darkness, with a static finish in reduced-motion mode. Coin dots follow the loot and disappear when collected. Ringed edge markers indicate locations beyond range. The controls guide opens only when requested. The layout adapts to narrow screens without covering the central action.

Goat and herd movement blend through planted-hoof stance, ankle articulation and lifted recovery, with breathing, weight shifts, turn lean, landing compression and timed attack wind-ups. Layered fleece, expressive faces, cloven hooves and secondary ear, tail and bell motion give each species a distinct silhouette. Builders strike at the moment their block edit happens, and hunters wind up before dealing damage. Every enemy has hierarchical joints: zombies shamble and reach, skeletons loosen their bone gait, spiders step on eight two-segment legs, and brutes carry their armor with heavy sway. Chewing, recoil and brief collapses remain bounded by the death pool. Fish bank through turns and vary tail cadence with their speed. Reduced motion suppresses extra leaning, compression, death tumbles and item spins.

The original 84 BPM soundtrack, **Hearth / Canopy / Ridgeline**, unfolds over three eight-bar movements in D Dorian, with alternate picking patterns and deliberate rests on later passes. Warm wooden plucks, breathy woodwind, struck-stone chimes, open chord beds and bass share a recurring melodic vocabulary. A 3+3+2 drum pulse, shakers and low picking build with the horde and danger to the Hearth, then recede after combat without resetting the musical clock. Travel brings out chime replies; caves lower the woodwind and soften the mix. Pausing or hiding the page dims both direct music and reverb, and defeat releases the combat layers.

All sounds are synthesized in-browser; there are no audio files. Zombies have original raspy, vowel-shaped moans, hurt and death cries, dry bites and scraping steps. Herd species have distinct calls, footsteps and jump/landing sounds. Wood, stone, soil and foliage have distinct block break/place sounds. Hoofbeats combine woody resonances and ground grit; splashes include spray and rising bubbles. Each of the ten towers has its own launch and impact signature: timber snap, siege boom, ice chinks, fire crackle, poison bubbles, lightning, stone rubble or harmonic magic. Rapid pickups climb a short pentatonic pattern. Changing hotbar slots, arriving and cleared waves, Hearth damage and defeat also have cues. World effects attenuate and lose high frequencies with distance, and pan relative to the camera; distant events are culled, and crowd sounds are rate limited. Hoof and combat impacts use short, dry transients rather than exaggerated bass slides.

Music and effects share a filtered, compressed output with volume headroom. Important cues briefly lower the music; an effects voice budget reserves room for the score during heavy combat. Every note and effect fades in and ends at exact silence, and finished voices release their audio nodes. The wind loop has smooth endpoints; late music timers skip missed beats instead of playing a burst of overdue notes. Rapid music toggles preserve the current fade level and cancel notes queued by the previous playback.

## CI and hosting

The default suite (`node --test scripts/test-*.mjs`) stays within 30 seconds. Run `node --test scripts/check-enemy-balance-tests.mjs` for the longer wave-12 and wave-15 defense simulations; focused combat CI also includes them.

Every push and pull request runs the CI workflow: it checks every classic-script module with `node --check`, runs `node --test scripts/test-*.mjs`, builds the playable `_site/` artifact, verifies all local asset references, and smoke-tests the result over a local HTTP server. The water tests cover river continuity, generation-cache eviction, terrain edits, swimming and diving, bed/ceiling collisions, shore exits, frame-rate stability, held-key combinations and the underwater camera. The audio tests cover silent envelope endpoints, shared mixing, wind-loop seams, delayed timers, suspended contexts, rapid music toggles, bounded polyphony, positional attenuation, camera-relative stereo, crowd limits, independent effects mute, adaptive combat and recovery, cave/pause mixing, music ducking, distinct tower/material signatures, reserved music polyphony and node cleanup during long playback.

Pushes to `main` also run the Pages workflow, which rebuilds and checks the same artifact and deploys it with the official GitHub Pages Actions. The published game is served from **[https://ripopov.github.io/goat-craft/](https://ripopov.github.io/goat-craft/)**.
