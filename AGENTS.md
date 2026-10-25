# Project vision

Our long-term goal is to create a tower defense game set in a Minecraft-style voxel world, with AAA-quality gameplay, visuals, audio, performance, and overall polish.

Use this vision to guide design and implementation decisions as the current prototype evolves toward that goal.

The game must remain a static web page. It must be playable locally without a server and deployable to GitHub Pages.

# Test suite time budget

The full test suite (`node --test scripts/test-*.mjs`) must complete within 30 seconds. Maintain this limit as tests are added or changed.

If the suite exceeds 30 seconds, refactor it before considering the work complete: exclude less relevant tests from the default suite, shorten test scenarios, or reduce redundant coverage while preserving essential regression checks. Keep longer or specialized checks separately runnable when useful. Do not raise the 30-second limit.
