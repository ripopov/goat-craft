# Extending Meadow Goat

The game uses classic scripts under `window.Meadow`. `index.html` declares the
load order; `main.js` initializes the scene and advances the controllers.
Keep new dependencies local and declare their `<script src>` before consumers.
Do not introduce runtime imports, fetches or server requirements: the same page
must run from `file://` and from GitHub Pages.

## Responsibilities

| Module | Owns | Dependencies |
| --- | --- | --- |
| `enemy-rules.js` | Species stats, wave composition, special-wave overrides, difficulty, timers and clear rewards | None |
| `enemy-models.js` | Beveled voxel geometry and articulated enemy model construction | Three.js |
| `enemy-boats.js` | Lazy bounded water-route discovery, four-passenger transport, disembarking and instanced hull rendering | World water queries, actor physics, enemy models, walker navigation |
| `enemies.js` | Live enemies, delivery, movement, abilities, combat, final Cthulhu encounter, watchdog and render synchronization | Rules, models, actor physics, enemy navigation, hell gates, enemy boats |
| `animal-models.js` | Shared species definitions, animal rigs, materials and fitting scales | Three.js, core utilities, animal style |
| `animal-navigation.js` | Cached body-sized Hearth routes and terrain-edit invalidation | Actor physics, core utilities |
| `animal-recovery.js` | Progress monitoring and physical escape target selection | World query interface |
| `animals.js` | Individual NPC jobs, movement, hunting, building and recovery | Models, navigation, recovery, actor physics |
| `coin-model.js` | Shared minted gold geometry, emissive material and glint clock | Three.js, core materials |
| `victory.js` | Final-boss defeat camera, farewell embers, Hearth celebration, input capture and replay | Enemy completion state, controls, audio |
| `inventory.js` | Hotbar and bag stacks, transfers, validation and atomic material spending | None |
| `items.js` | Hotbar presentation, held items, physical drops, attraction and collection | Inventory, coin model, world; tower item definitions when initialized |
| `inventory-menu.js` | Paused inventory and resource exchange | Items, enemy coin wallet, controls |

Models can be constructed without initializing a world or controller. Enemy
model factories return separate joint state, so posing one renderer does not
mutate another. Mesh geometry and material caches stay within their model
module. Controllers own simulation state and invoke model APIs rather than
building inventory art or duplicating wave rules.

## Add or rebalance a wave

Edit `enemy-rules.js`. `specialWaves` is the single registry for an exact wave's
species override, delivery override and announcement. Type overrides take
precedence over ordinary slots (including Boss slots). Delivery overrides apply
to every species; parachuted and sea-delivered Worms stay on the surface rather than burrowing. All-boat waves round their size up to four. Ordinary sea slots form complete groups of four and never consume a partial final crew; the endless wave repeats four ground, four sea and four air slots beyond its initial 200 slots. The controller reserves four living slots before launching. Boat passengers are ordinary live enemies for combat, rewards and the watchdog; transport temporarily owns their positions. Ocean-to-bank routes use a separate bounded water flood, while walking after landing uses the existing navigation field. Hulls share one instanced draw synchronized with the final enemy pose each frame.
Keep ordinary unlock/slot rules in `typeForWave`, difficulty in `waveDifficulty`,
and timings in `firstWaveDelay` and `restAfter`. Worm dig-out bounds and outward
bias belong together in `wormEmergence`.

The runtime keeps `M.enemies.waveSize`, `typeForWave`, `deliveryForWave` and other
existing query APIs available for UI and console callers. Wave rules can also be
loaded and tested directly without terrain initialization.

## Add an enemy species

1. Add its stats and collision dimensions to `enemy-rules.js` and choose its
   unlock/slots in `typeForWave`.
2. Add its articulated parts and joints to `enemy-models.js`. Parents must be
   created before their children. The factory derives ordinary render capacity from
   the largest wave model plus its parachute. The final-boss rig replaces the
   horde, so its capacity is reserved once; do not add a fixed part limit.
3. Flying species use `types[type].flying`; the controller owns gate delivery and a fixed three-sample look-ahead flight path, using shared solid-column and body-clearance queries to clear walls. Two-block cruising clearance is four world units. Shared transport runs before flight.
4. Add any new joint pose, ability or movement behavior to `enemies.js`. Reuse
   actor physics, shared navigation, targetability, damage and removal paths so
   water, cover, rewards and the 30-second watchdog remain consistent.
5. Add silhouettes to the minimap and sounds to `audio.js` if needed. Exercise
   ground delivery, parachute landing and boat disembarking.

## Final encounter and victory

`hellGates.won` means all eight gates are sealed. It stops further wave delivery;
it does not award victory. `enemies.js` summons one final actor, using Boss combat
rules with `finalBoss: true`, a dedicated `cthulhu` rig and twice the current
wave's Boss health (minimum wave 7). The actor uses shared collision and terrain
queries, warns before damaging the Hearth and is exempt from the travel watchdog.
`finalBossDefeated` becomes true only through the normal lethal-damage path.
`victory.js` gates its camera and overlay on that flag. `main.js` advances the
six-second corpse animation through `updateVictory` while normal combat pauses.
Effects remain bounded and reduced motion keeps the camera stationary.

## Change NPC navigation or appearance

Edit rigs in `animal-models.js` without changing NPC job logic. `animal-style.js` owns independent upgrade modules. `makeLoadout` routes each branch's own level to `makeModuleStyle`: move owns legs, cadence owns neck/jaw, reach owns horns, power owns torso/tail, and builder craft owns its forge shell/tools. The NPC roster assigns a stable `equipmentStyle` (Mallow, Clover, Bramble or Poppy) to both the loadout and neck fitting context. `animal-style.js` owns these character palettes and silhouette variants, with species defaults for standalone models and the original system colors for the goat. Styles affect only owned equipment; model materials and species definitions remain shared and unchanged. There is no maximum-tier chassis. Rank changes rebuild only the affected module; unrelated attachments retain object identity. Modules restore their own natural surfaces and dispose their own resources. Static panels batch per finish and attachment; fixed reactor, jet, discharge and tool meshes animate from locomotion or combat/work clocks. The shared
species definitions supply both the model proportions and collision body.
`animal-navigation.js` plans around the Hearth before physical recovery is
needed. It caches graph edges by body dimensions, standing height and world
revision, commits to waypoints, and replans for terrain or target changes.
Committed segments are also revalidated every 0.75 seconds so collision slides
and crowd detours cannot leave an animal following a blocked waypoint. Local
search uses voxel-centred, eight-direction connections with body sweeps and a
240-expansion budget; this preserves narrow passages regardless of the animal's
starting offset. Ordinary travel rejects destinations on raised Hearth roots,
matching its no-root-climbing rule instead of falling back to jumping at them.
`core.js` owns shared goat/herd locomotion speeds and gait cadence. All NPC jobs use `travelSpeed`, `moveAnimal` and `updateRecovery`; roles choose goals without speed multipliers or separate navigation. Wall planning stays on the starting meadow, outside the 24-unit Hearth exclusion, and checks quarry availability with the same selector used during gathering.
`animals.js` also uses `goat-excavation.js` for body-sized ascending cave exits. Wall sites store their X/Z axis, and footprint/quarry checks must honor it. `safeQuarryColumn` gates both wall and tower resource gathering to the Hearth-opposite side, at least three cells past the wall line, and preserves active/completed wall approach buffers. Tower jobs without an active project use the nearest completed wall. Construction approaches validate the destination against the site standing level; shared navigation handles returning from a quarry several ledges lower, rather than requiring the whole elevation change to fit one jump. Revalidate quarry hits before editing terrain so construction during travel cannot lose its foundation. Salvage claims one physical tower item through `items.js`; `towers.js` consumes it only after successful validated construction.
`animal-recovery.js` remains the fallback for ledges, walls and pits elsewhere.
`actor-physics.js` owns `shoreRoute`, the bounded water-corridor search shared by the goat and herd; `shoreExit` validates every final jump. Recovery uses a short per-target monitor plus a spatial travel monitor that survives job changes, and its deadline must run across all escape modes. Permanent blocks must never become excavation targets.

## Validate changes

`node --test scripts/test-*.mjs` must finish within **30 seconds**. Model-only
checks in `test-model-modules.mjs` use `classicModules()` from
`scripts/helpers/animal-game.mjs`; gameplay checks use `game()` or
`isolatedAnimal()` with fresh state. Avoid generating a forest for pure model
or rule checks. Longer complete-defense runs remain separately runnable with
`node --test scripts/check-enemy-balance-tests.mjs`. Multi-wave progression and tower-effect stress checks run with `node --test scripts/check-enemy-progression-tests.mjs scripts/check-tower-effects-tests.mjs`; both remain in CI.

Run `node scripts/build-site.mjs` and
`node scripts/check-site.mjs _site` after changing scripts or local assets.
Check the actual page from disk after changing initialization or shader code.

Strategic inventory actions reuse the existing `items.js` hotbar DOM and selected
stack. `strategy.js` owns map-pointer raycasts and command-distance previews; it
passes the traced hit to `items.placementTarget(hit)` and
`items.placeSelectedBlock(hit)`. Omitting the hit retains normal goat reach and
camera targeting. Inventory consumption, tower deployment and voxel collision
remain owned by their existing modules.
