# Project vision

Meadow Goat is evolving into a tower defense game in a Minecraft-style voxel world. Aim for AAA-quality gameplay, visuals, audio, performance, and polish. Preserve coherent combat, terrain interaction, and player feedback as features grow.

# Runtime and architecture

- The game must remain a static web page: open `index.html` directly via `file://`, without a server, build step, or package install, and deploy to GitHub Pages.
- Use classic scripts sharing `window.Meadow`; `index.html` defines dependency order and `js/main.js` owns initialization and the frame loop. Avoid runtime imports, fetches, and remote dependencies.
- Bundle assets locally and use relative paths compatible with the GitHub Pages repository subpath.
- Read `docs/architecture.md` for module ownership and extension guidance; consult `README.md` for gameplay and controls. Reuse shared physics, navigation, inventory, and combat rules.
- Keep simulation work, effects, caches, and audio voices bounded. Respect reduced-motion settings and keyboard/touch controls. Update relevant documentation when behavior changes.

# Validation

- Run relevant regression tests and syntax-check changed JavaScript with `node --check`.
- The full suite, `node --test scripts/test-*.mjs`, must finish within **30 seconds**. Never raise this limit. If exceeded, shorten scenarios, remove redundant coverage, or move less relevant checks outside the default suite while preserving essential regressions.
- Longer defense simulations remain separately runnable: `node --test scripts/check-enemy-balance-tests.mjs`.
- After script or asset changes, run `node scripts/build-site.mjs` and `node scripts/check-site.mjs _site`. Treat `_site/` as generated output.
- Use headless browser testing (for example, Playwright) for browser validation; do not use computer-use or desktop UI automation. Check the actual page from disk after initialization or shader changes, and verify affected gameplay, visuals, and input headlessly.
