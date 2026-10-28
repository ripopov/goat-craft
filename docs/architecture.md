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
| `enemies.js` | Live enemies, delivery, movement, abilities, combat, watchdog and render synchronization | Rules, models, actor physics, enemy navigation, hell gates, enemy boats |
| `animal-models.js` | Shared species definitions, animal rigs, materials and fitting scales | Three.js, core utilities, animal style |
| `animal-navigation.js` | Cached body-sized Hearth routes and terrain-edit invalidation | Actor physics, core utilities |
| `animal-recovery.js` | Progress monitoring and physical escape target selection | World query interface |
| `animals.js` | Individual NPC jobs, movement, hunting, building and recovery | Models, navigation, recovery, actor physics |
| `coin-model.js` | Shared minted gold geometry, emissive material and glint clock | Three.js, core materials |
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
   created before their children. The factory derives render capacities from
   the largest model plus its parachute; do not add a separate capacity limit.
3. Add any new joint pose, ability or movement behavior to `enemies.js`. Reuse
   actor physics, shared navigation, targetability, damage and removal paths so
   water, cover, rewards and the 30-second watchdog remain consistent.
4. Add silhouettes to the minimap and sounds to `audio.js` if needed. Exercise
   ground delivery, parachute landing and boat disembarking.

## Change NPC navigation or appearance

Edit rigs in `animal-models.js` without changing NPC job logic. The shared
species definitions supply both the model proportions and collision body.
`animal-navigation.js` plans around the Hearth before physical recovery is
needed. It caches graph edges by body dimensions, standing height and world
revision, commits to waypoints, and replans for terrain or target changes.
`core.js` owns shared goat/herd locomotion speeds and gait cadence. All NPC jobs use `travelSpeed`, `moveAnimal` and `updateRecovery`; roles choose goals without speed multipliers or separate navigation. Wall planning stays on the starting meadow, outside the 24-unit Hearth exclusion, and checks quarry availability with the same selector used during gathering.
`animals.js` also uses `goat-excavation.js` for body-sized ascending cave exits. Wall sites store their X/Z axis, and footprint/quarry checks must honor it. Salvage claims one physical tower item through `items.js`; `towers.js` consumes it only after successful validated construction.
`animal-recovery.js` remains the fallback for ledges, walls and pits elsewhere.
`actor-physics.js` owns `shoreRoute`, the bounded water-corridor search shared by the goat and herd; `shoreExit` validates every final jump. Recovery uses a short per-target monitor plus a spatial travel monitor that survives job changes, and its deadline must run across all escape modes. Permanent blocks must never become excavation targets.

## Validate changes

`node --test scripts/test-*.mjs` must finish within **30 seconds**. Model-only
checks in `test-model-modules.mjs` use `classicModules()` from
`scripts/helpers/animal-game.mjs`; gameplay checks use `game()` or
`isolatedAnimal()` with fresh state. Avoid generating a forest for pure model
or rule checks. Longer complete-defense runs remain separately runnable with
`node --test scripts/check-enemy-balance-tests.mjs`.

Run `node scripts/build-site.mjs` and
`node scripts/check-site.mjs _site` after changing scripts or local assets.
Check the actual page from disk after changing initialization or shader code.
