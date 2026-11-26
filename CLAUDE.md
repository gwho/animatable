# CLAUDE.md — ICE vs. EV Torque & Transmission Interactive Workbench

## Project Overview
An interactive engineering learning application comparing the torque curves, drivetrain mechanics, electromagnetic field control, and reverse mechanisms of an Internal Combustion Engine (ICE) vehicle against a single-speed Electric Vehicle (EV) across four synchronized modules:
1. **Drag-Strip & Torque-Curve Explorer** (Live acceleration + dual SVG curves)
2. **Drivetrain Cutaway & Launch Stall Simulator** (Reciprocating/clutch/gearbox SVG + thermal heatmap)
3. **Stator-Rotor Magnetic Field & Field-Weakening Explorer** (HiDPI 2D Canvas PMSM cross-section + Back-EMF meter)
4. **Mechanical Reverse Gear vs. Electronic Phase Inversion** (Sliding idler gear SVG + 3-phase AC oscilloscope)

## Tech Stack
- **Framework:** React 19 + TypeScript (Strict Mode) + Vite
- **Styling:** Tailwind CSS (Dark engineering dashboard palette)
- **Graphics:** Inline SVG (mechanical linkages, gears, curves) + HTML5 2D Canvas (high-frequency magnetic flux & oscilloscopes)
- **Testing:** Vitest (Pure TypeScript physics unit tests)

## Directory Layout
- `src/physics/` — framework-agnostic engine (no React, no DOM globals)
  - `math.ts` — clamps, smoothstep, unit conversions, NaN guards
  - `powertrains.ts` — `getIceTorque`, `getEvTorque`, `getEvElectromagnetics` (back-EMF, I_d/I_q)
  - `drivetrain.ts` — ICE 6-speed + launch clutch + shift interrupt; EV 9.0:1 reduction
  - `vehicleDynamics.ts` — longitudinal force model + zero-speed-safe integrator
  - `simulationStore.ts` — fixed-timestep store (`play/pause/reset/step/advance`, setters, `subscribe`, `getUiSnapshot`, `getMutableState`)
  - `types.ts` — shared interfaces; `index.ts` — public barrel
- `src/app/simulation.ts` — the store instance, bound to `requestAnimationFrame` via an injected `FrameScheduler`
- `src/hooks/` — `useUiSnapshot` (useSyncExternalStore), `useAnimationFrame` (auto-cancelling rAF)
- `workbench.html` — Vite entry. The root `index.html`/`index.js`/`style.css` are the legacy "Animatable" demo; leave them alone.

## Critical Architectural Invariants
1. **Zero React Imports in `src/physics/`:**
   All vehicle dynamics, powertrain torque curves, gear ratios, and electromagnetic calculations must be deterministic, framework-agnostic TypeScript modules. (Enforced by a test.)
2. **Dual-Tier State Access (60fps Render Hygiene):**
   - **Never** push continuous 60fps values (`rpm`, `velocityMps`, `distanceM`, `rotorAngleRad`, `phaseAnglesRad`) into React `useState`.
   - Continuous visualizers (Canvas and SVG refs) read directly from `simulationStore.getMutableState()` inside a `requestAnimationFrame` callback.
   - React components subscribe via `useSyncExternalStore(simulationStore.subscribe, simulationStore.getUiSnapshot)` which only emits a new snapshot reference when discrete UI state changes (`isPlaying`, `controls`, `ice.gear`, `ice.isShifting`, `ice.isStalled`, `activeModule`).
3. **HiDPI / Retina Canvas Scaling:**
   Every HTML5 `<canvas>` component must scale its backing store by `window.devicePixelRatio` and normalize context transforms so vector arrows and waveforms render razor-sharp.
4. **Kinematic Gear Accuracy:**
   Meshing SVG gears must rotate at exact inverse tooth/radius ratios ($\omega_2 = -\omega_1 \cdot \frac{R_1}{R_2}$) with phase-aligned tooth offsets so teeth never visually clip or slip.
5. **Lifecycle Cleanup:**
   All `requestAnimationFrame` loops must pause or cancel immediately when their module tab is inactive or unmounted.

## Domain Physics Rules
- **ICE Stall Boundary:** Below `750 RPM`, volumetric airflow collapses and `getIceTorque()` strictly returns `0 Nm`. If `iceClutchMode === 'locked-clutch'` and road speed forces engine speed below `750 RPM`, set `ice.isStalled = true` and zero out wheel propulsion until reset or clutch release.
- **ICE Shift Interrupt:** Upshifts occur at `6,200 RPM` and trigger a `300 ms` `isShifting` window where engine torque transmitted to the wheels drops to `0 Nm`.
- **EV Constant Torque vs. Field Weakening:** Delivers `400 Nm` flat from `0` to `4,500 RPM` (base speed). Above `4,500 RPM`:
  - If `fieldWeakening === true`: Injects negative d-axis current ($-I_d$), weakening net rotor flux so torque decays hyperbolically ($\tau = P_{\text{base}} / \omega$) up to `18,000 RPM` while holding Back-EMF under the `800 V` DC bus ceiling.
  - If `fieldWeakening === false`: Back-EMF hits `800 V` at `4,500 RPM`, collapsing stator current and dropping torque to `0 Nm`.

## Verification Commands
- `npm test` — Run Vitest physics unit tests (must pass 100% before UI integration)
- `npm run typecheck` — Run `tsc --noEmit` with zero errors
- `npm run build` — Verify production bundle builds cleanly
- `npm run dev` — Dev server (opens `/workbench.html`)
