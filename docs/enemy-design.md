# Air, earth and specialist enemies

The roster expands through delivery and behavior, while retaining the 200-enemy cap, physical projectiles, destructible terrain, collectible rewards, and static offline page.

## Research and design decisions

Mike Stout's [Enemy Attacks and Telegraphing](https://www.gamedeveloper.com/design/enemy-attacks-and-telegraphing) frames enemies around a readable question and the player's available response. Each specialist therefore has a warning, a bounded action and a counter available without buying a particular tower.

Riot's [Clarity in League](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/) emphasizes identifiable silhouettes, readable effect boundaries and transformations that communicate gameplay state. [VALORANT Shaders and Gameplay Clarity](https://www.riotgames.com/en/news/valorant-shaders-and-gameplay-clarity) also connects visual readability with effect budgets. These inform the distinct body shapes, persistent hazard outlines, visible shield opening and shared rendering resources here. Models, effects and synthesized sounds are original code assets; no art or audio was taken from these sources.

## Encounters

| Encounter | First wave | Behavior and response | Model, VFX and audio |
| --- | --- | --- | --- |
| Parachute delivery | 5 | One zombie or skeleton descends into the outer meadow in its introductory wave; later eligible slots remain at most one in ten. Shoot during descent or meet the landing. A 0.9-second landing recovery prevents an immediate bite. | Arched cream/terracotta cloth panels, four suspension cords, hanging limbs, lavender landing ring and downward minimap triangle. Filtered cloth/wind noise resolves into a short woody landing. |
| Burrow Worm | 10 | Spawns underground beneath the announced hell gate and tunnels toward the Hearth through real covered tunnels, passing below permanent paving. The existing 9.5–18-unit emergence band is unchanged. It opens the surface anywhere within nine two-unit voxels of the tree — about three times the surface area of the former five-voxel ring — biased outward so the dig-out happens earlier, after a 1.4-second warning. The player can mine down, see the whole moving Worm, enter its tunnel and attack it normally. A Worm whose shaft offers no walkable exit fills the shaft and re-targets a fresh surfacing point (bounded retries, then the progress watchdog) instead of stalling underground. Soil provides cover; the Worm has no damage immunity. | Six articulated earth-colored segments, ridged armor, amber eyes and ivory digging fangs remain rendered underground. Amber tremor rings and horizontal minimap bars give a surface clue without displaying the body through soil. Grainy stone/soil sounds, dry grit, and a distinct emergence cue. |
| Briar Binder | 7 | Charges for 1.25 seconds, then slows one nearby tower to 60% firing cadence for three seconds. Kill it during the chant to interrupt, or afterward to release the tower. Snares do not stack; a Binder can cast at most four times before continuing its normal attack route. | Bark body, branching moss crown, root fingers and an inset amber sap lantern. Raised-arm chant and green root stakes around the affected tower. Wood resonances, a rising reed tone and seed rattles. |
| Prismback | 12 | Frontal armor reduces direct damage by 55%; flanks, rear attacks, stomps and splash bypass it. A 1.1-second brace warns of a short rush. The plates then open for a 1.8-second unarmored window. It retains ordinary contact damage, with no bonus rush hit on the Hearth. | Low four-legged blue crystal carapace, hinged front plates and a warm rear core. Cyan brace/impact rings, physical plate opening and crystalline pings/chimes. |
| Mire Sower | 15 | A 0.9-second outline warns before a puddle forms. It slows goat/herd movement by 35% inside its exact 2.4-unit radius for five seconds. Leave, jump clear or defend with stationary towers. Overlapping puddles do not multiply the penalty; bridges/other floors remain unaffected. | Squat moss creature with a strapped seed amphora and four paddling feet. Amber outline becomes a brown pool when active. Wet pitch drops, granular splashes and ceramic body tones. |
| Boss | 7 (every 7th) | One leads each 7th wave beside the regular horde, with **twenty times** a regular enemy's health at that wave. No new mechanics: it uses the standard walk/chew/bite rules, so the response is the same one the wave already teaches (focused fire, splash, stomps, elemental chains). Drops 20 coins and honors the same 30-second distance watchdog. | The hulking stone-brute articulation recoated in near-black char, 30% larger, with a molten red chest core and **glowing red eyes**. Deep stone-and-wood roars, ground impact on steps, and a gold minimap star. |

The three researched specialist concepts ask different questions: **interrupt the support**, **change the attack angle**, and **reposition around terrain**. They do not heal enemies, create unlimited reinforcements or require an immunity-breaking purchase.

The Boss is not a fourth mechanic but a pacing beat: a durability check that reuses everything the player already knows. It appears at most once per wave (slot zero of every 7th wave), so the count of a 7th wave's enemies does not grow; one ordinary slot simply becomes the warboss.

## Balance and economy

The first three waves retain their 6/10/14 counts and original health. Existing wave size, health scaling, speed scaling, squad spacing and lane pacing remain intact. Specialists replace existing slots rather than adding extra wave members. Worms occupy at most one slot in twelve; each other specialist occupies at most one in twenty, and the combined specialist share stays below roughly one quarter. Rewards are physical coins and are paid once.

Base stats before the existing wave multiplier:

| Type | HP | Speed | Coins | Hearth bite |
| --- | --- | --- | --- | --- |
| Worm | 4 | 1.6 surfaced; 2.1 tunneling | 4 | 1 HP / 3.6s |
| Binder | 3 | 1.35 | 3 | 1 HP / 3.8s |
| Prismback | 4 | 1.25; short 2× rush | 4 | 1 HP / 3.8s |
| Sower | 3 | 1.5 | 3 | 1 HP / 3.5s |
| Boss | 2 (×20 at spawn) | 1.2 | 20 | 2 HP / 4s |

Worm tunnels use bounded real voxel edits and preserve an outer roof course. The original terrain level prevents successive Worms from treating an earlier tunnel mouth as a new ground level. Emergence moves the Worm onto checked adjacent ground (including a wider fallback ring for pond edges, cliffs and player walls) and settles retained excavation material into a one-block exit step, keeping following walkers out of deep shafts. Abandoned shafts are filled the same way before a Worm re-targets elsewhere. Unused material drops at the exit; killing a buried Worm releases its retained material underground. Tests account for every cut, restored block and physical drop. The Hearth's protected foundation remains intact. Existing unreachable-enemy recovery still applies.

## Validation

`node --test scripts/test-special-enemies.mjs` exercises unlock distributions, actual airdrops, underground excavation, emergence boundaries, a real player mining and killing a Worm underground, spawn distance, snare interruption/expiry, directional armor, actual controller slowdown, altitude isolation, effect limits and cleanup. Existing enemy tests cover navigation, ordinary wave pacing, rewards, physics and watchdog behavior. Audio graph tests cover every new event's scheduling, silent endpoints and graph cleanup.

`node scripts/check-enemy-balance.mjs` runs real combat for representative waves with deterministic randomness, a fixed defender position, and staged mixed defenses. It reports investment, remaining health, clearance time, maximum simultaneous enemies, deliveries and watchdog deaths. The benchmark is an attainable-defense regression check, not proof that every strategy will win. Enemy attack-angle and splash counters matter; no frame rate or difficulty guarantee is inferred for other hardware or loadouts.

Across seeds 1, 42 and 1337, all 18 samples cleared with the Hearth surviving. Exact observations are saved in [enemy-balance-results.json](enemy-balance-results.json). CPU timings were collected alongside other local tests and exclude rendering.

| Wave | Invested coins | Hearth HP remaining | Clearance time | Watchdog recoveries |
| --- | --- | --- | --- | --- |
| 5 | 102 | 100 | 36.3–38s | 0 |
| 10 | 174 | 92–98 | 68.5–69s | 0 |
| 12 | 202 | 66–90 | 68–100.1s | 0–1 |
| 15 | 328 | 98–100 | 62.4–72s | 0 |
| 20 | 356 | 100 | 89.6–90.5s | 2 |
| 30 | 484 | 95–100 | 113.7–114.8s | 5 |

The existing watchdog still resolves some stalled paths in later waves. These samples establish bounded wave completion with the stated defenses, rather than perfect navigation in every destructible layout. Automated wave-12 and wave-15 seed-42 regressions also require zero watchdog kills.

A local Chrome review directly loaded the classic scripts via `file://`, rendered all eight silhouettes and the parachute, then ran 200 live units. The observed crowded-scene sample was approximately **77 FPS, 75 draw calls and 358k triangles, with zero runtime errors** on this machine. This measures the enemy test scene rather than the entire streamed world. A separate covered-tunnel view verified the articulated Worm is visible from inside an excavated passage. The full game was separately opened directly from `index.html` and wave 15 was started in strategic view.

The horde remains one instanced draw plus its optional highlight draw. Transient signal groups are capped at 64; active puddles at 12; digging at 32 voxel edits per simulation step. Reduced-motion mode keeps gameplay boundaries and timing while suppressing cosmetic motion. New sounds use the existing spatial mixer, crowd limits and voice budget rather than permanent audio loops.
