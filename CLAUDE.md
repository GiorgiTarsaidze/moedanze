# CLAUDE.md — Rustavi Driving Exam simulator

First-person 3D browser simulator of the Rustavi (Georgia) B-category Stage 1 driving exam ground.
Plain ES modules + vendored three.js (`vendor/`), no framework, no build needed to run.
Read README.md for the course interpretation, assumptions and scoring sources.

## Commands
- `npm run dev` — static server on http://localhost:5173 (no dependencies)
- `npm test` — headless test suite (physics, all six elements, mistake detection, scoring). Must stay green.
- `npm run test:exam` — full exam driven by the automated instructor; prints the result sheet
- `npm run test:browser` — Playwright smoke test + screenshots (needs `npm install` and a running dev server; add `?lowgfx` for software GL)
- `npm run build` — single-file `dist/index.html` (esbuild)

## Architecture (where to look)
- `src/config/vehicle.js` — car dimensions, steering, drivetrain, eye & mirror positions
- `src/config/examRules.js` — every penalty value and rule toggle
- `src/courses/rustavi/course.js` — course data in PDF map pixels (7.5 px = 1 m), element stations, route legs, restart poses
- `src/sim/` — pure JS, no three.js, runs in Node:
  - `vehicle.js` physics (kinematic bicycle + longitudinal forces, fixed 120 Hz)
  - `world.js` colliders, kerbs, terrain height (hill ramp), marking list
  - `exam.js` exam state machine, penalties, skip detection, restarts, result
  - `exercises/<element>.js` each has `buildStation` (geometry), an Evaluator (scoring) and `createCoach` (training steps)
  - `assistant.js` training guidance + reference stickers; `optics.js` eye/mirror geometry shared with the renderer
  - `driver.js` path tracker + automated driver (demo mode and tests — drives through normal inputs only)
- `src/render/` — three.js scene (`world3d.js`), car + cockpit (`car3d.js`), mirror render targets (`mirrors.js`), training/debug overlays
- `src/ui/` — HUD, guidance card, toasts, minimap, debug text, result sheet; `src/main.js` bootstrap & loop

## Conventions
- Units are metres/seconds/radians. 2D sim plane: x = east, z = south (same as the PDF page); heading 0 = east, +π/2 = south.
- Car-local 3D: +X forward from the rear-axle centre, +Y up, +Z right (left-hand drive).
- Station geometry is defined in a local frame (origin `o`, travel direction `f`, b to the right) so elements are location-independent.
- Never move the car directly from game logic — everything goes through `Vehicle.step` inputs.
- Scoring must use real geometry (tyre contact points, body outline), not checkpoints.
- When fixing a bug in an element, add a case to `tests/test-suite.mjs` that reproduces it (use the `override` hook of `runElement`).
- Debug view (F3, training mode) shows colliders, lines, zones and telemetry incl. map-pixel coordinates — use it to reproduce reports.
