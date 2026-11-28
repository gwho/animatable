/**
 * Central simulation store — fixed-timestep, framework-agnostic.
 * Pure TypeScript — no React, no DOM.
 *
 * Two access tiers:
 *  1. `getMutableState()` — the live, mutated-in-place state. Canvas / SVG
 *     visualisers read it inside their own animation-frame callbacks.
 *  2. `subscribe` + `getUiSnapshot` — `useSyncExternalStore`-compatible. The
 *     snapshot reference only changes when discrete UI state changes
 *     (play state, controls, active module, ICE gear / shifting / stall).
 */
import {
  createEvDrivetrainState,
  createIceDrivetrainState,
  evMotorRpm,
  stepEvDrivetrain,
  stepIceDrivetrain,
  WHEEL_RADIUS_M,
} from './drivetrain';
import { clamp, clamp01, finiteOr, TWO_PI, wrapAngle, rpmToRadPerS } from './math';
import { EV_POLE_PAIRS, ICE_IDLE_RPM } from './powertrains';
import type {
  EvVehicleState,
  GearSelector,
  IceClutchMode,
  IceGearMode,
  IceVehicleState,
  ModuleId,
  SimulationControls,
  SimulationState,
  UiSnapshot,
  VehicleKinematics,
} from './types';
import {
  clampGradePercent,
  computeLongitudinalForces,
  createForceBreakdown,
  integrateLongitudinal,
  VEHICLE_PARAMS,
} from './vehicleDynamics';

/** Fixed simulation timestep (s). */
export const FIXED_DT = 1 / 60;
/** Largest dt accepted by `step()`; larger requests are clamped for stability. */
export const MAX_STEP_DT = 0.1;
/** Cap on catch-up steps per `advance()` call (prevents a spiral of death). */
export const MAX_STEPS_PER_ADVANCE = 8;
export const MIN_TIME_SCALE = 0.05;
export const MAX_TIME_SCALE = 4;
/** Park pawl only engages below this speed (m/s); faster, P behaves like N. */
export const PARK_PAWL_ENGAGE_MPS = 0.5;

export const DEFAULT_CONTROLS: Readonly<SimulationControls> = Object.freeze({
  throttle: 0,
  gradePercent: 0,
  iceGearMode: 'auto',
  iceClutchMode: 'auto-slip',
  fieldWeakening: true,
  gearSelector: 'D',
  timeScale: 1,
});

/** Injectable frame scheduler so the store never touches DOM globals itself. */
export interface FrameScheduler {
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

export interface SimulationStoreOptions {
  initialControls?: Partial<SimulationControls>;
  activeModule?: ModuleId;
  /** When provided, `play()` drives `advance()` from this scheduler automatically. */
  scheduler?: FrameScheduler;
}

export type Listener = () => void;
export type StepListener = (state: Readonly<SimulationState>) => void;

export interface SimulationStore {
  play(): void;
  pause(): void;
  reset(): void;
  /** Advances exactly one simulation step of `dt` seconds (default FIXED_DT). */
  step(dt?: number): void;
  /** Feeds real elapsed time; runs whole FIXED_DT steps scaled by `timeScale`. */
  advance(realElapsedS: number): number;

  setThrottle(throttle: number): void;
  setGrade(gradePercent: number): void;
  setIceGearMode(mode: IceGearMode): void;
  setIceClutchMode(mode: IceClutchMode): void;
  setFieldWeakening(enabled: boolean): void;
  setGearSelector(selector: GearSelector): void;
  setTimeScale(scale: number): void;
  setActiveModule(module: ModuleId): void;
  setControls(patch: Partial<SimulationControls>): void;

  getMutableState(): Readonly<SimulationState>;
  getUiSnapshot(): UiSnapshot;
  /** Discrete-change subscription (useSyncExternalStore compatible). */
  subscribe(listener: Listener): () => void;
  /** Per-step subscription for imperative consumers (no React). */
  subscribeStep(listener: StepListener): () => void;
  /** Stops any scheduled frames and drops all listeners. */
  dispose(): void;
}

function sanitizeControls(base: Readonly<SimulationControls>, patch: Partial<SimulationControls>): SimulationControls {
  const next: SimulationControls = { ...base, ...patch };
  next.throttle = clamp01(next.throttle);
  next.gradePercent = clampGradePercent(next.gradePercent);
  next.timeScale = clamp(finiteOr(next.timeScale, 1), MIN_TIME_SCALE, MAX_TIME_SCALE);
  next.fieldWeakening = Boolean(next.fieldWeakening);
  return next;
}

function controlsEqual(a: Readonly<SimulationControls>, b: Readonly<SimulationControls>): boolean {
  return (
    a.throttle === b.throttle &&
    a.gradePercent === b.gradePercent &&
    a.iceGearMode === b.iceGearMode &&
    a.iceClutchMode === b.iceClutchMode &&
    a.fieldWeakening === b.fieldWeakening &&
    a.gearSelector === b.gearSelector &&
    a.timeScale === b.timeScale
  );
}

function createKinematics(): VehicleKinematics {
  return {
    velocityMps: 0,
    accelerationMps2: 0,
    distanceM: 0,
    wheelAngleRad: 0,
    wheelTorqueNm: 0,
    forces: createForceBreakdown(),
  };
}

export function createIceVehicleState(): IceVehicleState {
  return { ...createKinematics(), ...createIceDrivetrainState(), crankAngleRad: 0 };
}

export function createEvVehicleState(): EvVehicleState {
  return {
    ...createKinematics(),
    ...createEvDrivetrainState(),
    rotorAngleRad: 0,
    electricalAngleRad: 0,
    phaseAnglesRad: [0, (2 * TWO_PI) / 3, TWO_PI / 3],
  };
}

/** Applies wheel torque through the shared vehicle model and integrates one step. */
function integrateVehicle(
  vehicle: VehicleKinematics,
  wheelTorqueNm: number,
  controls: Readonly<SimulationControls>,
  dt: number,
): void {
  vehicle.wheelTorqueNm = wheelTorqueNm;
  if (controls.gearSelector === 'P' && Math.abs(vehicle.velocityMps) < PARK_PAWL_ENGAGE_MPS) {
    // Park pawl locks the transmission output: the car is held exactly still.
    computeLongitudinalForces(0, 0, controls.gradePercent, VEHICLE_PARAMS, vehicle.forces);
    vehicle.forces.netN = 0;
    vehicle.forces.accelerationMps2 = 0;
    vehicle.velocityMps = 0;
    vehicle.accelerationMps2 = 0;
    return;
  }
  const forces = computeLongitudinalForces(wheelTorqueNm, vehicle.velocityMps, controls.gradePercent, VEHICLE_PARAMS, vehicle.forces);
  integrateLongitudinal(vehicle, forces.accelerationMps2, dt);
  vehicle.accelerationMps2 = forces.accelerationMps2;
  vehicle.wheelAngleRad = wrapAngle(vehicle.wheelAngleRad + (vehicle.velocityMps / WHEEL_RADIUS_M) * dt);
}

export function createSimulationStore(options: SimulationStoreOptions = {}): SimulationStore {
  const scheduler = options.scheduler;
  const initialControls = sanitizeControls(DEFAULT_CONTROLS, options.initialControls ?? {});

  const state: SimulationState = {
    timeS: 0,
    stepCount: 0,
    isPlaying: false,
    activeModule: options.activeModule ?? 'drag-strip',
    controls: initialControls,
    ice: createIceVehicleState(),
    ev: createEvVehicleState(),
  };

  const listeners = new Set<Listener>();
  const stepListeners = new Set<StepListener>();
  let accumulatorS = 0;
  let frameHandle: number | null = null;
  let lastFrameMs: number | null = null;
  let snapshot: UiSnapshot = buildSnapshot();

  function buildSnapshot(): UiSnapshot {
    return Object.freeze({
      isPlaying: state.isPlaying,
      activeModule: state.activeModule,
      controls: state.controls,
      ice: Object.freeze({
        gear: state.ice.gear,
        isShifting: state.ice.isShifting,
        isStalled: state.ice.isStalled,
      }),
    });
  }

  /** Rebuilds the UI snapshot only if a discrete field changed, then notifies. */
  function syncSnapshot(): void {
    const s = snapshot;
    if (
      s.isPlaying === state.isPlaying &&
      s.activeModule === state.activeModule &&
      s.controls === state.controls &&
      s.ice.gear === state.ice.gear &&
      s.ice.isShifting === state.ice.isShifting &&
      s.ice.isStalled === state.ice.isStalled
    ) {
      return;
    }
    snapshot = buildSnapshot();
    for (const listener of [...listeners]) listener();
  }

  function stepOnce(dt: number): void {
    const c = state.controls;
    const { ice, ev } = state;

    const iceWheelTorque = stepIceDrivetrain(ice, {
      velocityMps: ice.velocityMps,
      throttle: c.throttle,
      gearMode: c.iceGearMode,
      clutchMode: c.iceClutchMode,
      gearSelector: c.gearSelector,
      dt,
    });
    integrateVehicle(ice, iceWheelTorque, c, dt);
    ice.crankAngleRad = wrapAngle(ice.crankAngleRad + rpmToRadPerS(ice.engineRpm) * dt);

    const evWheelTorque = stepEvDrivetrain(ev, {
      velocityMps: ev.velocityMps,
      throttle: c.throttle,
      fieldWeakening: c.fieldWeakening,
      gearSelector: c.gearSelector,
    });
    integrateVehicle(ev, evWheelTorque, c, dt);
    updateEvField(ev, dt);

    state.timeS += dt;
    state.stepCount += 1;
  }

  function updateEvField(ev: EvVehicleState, dt: number): void {
    // Integrate with the post-step speed (semi-implicit, matches the wheel angle).
    ev.rotorAngleRad = wrapAngle(ev.rotorAngleRad + rpmToRadPerS(evMotorRpm(ev.velocityMps)) * dt);
    ev.electricalAngleRad = wrapAngle(ev.rotorAngleRad * EV_POLE_PAIRS);
    const offset = (2 * Math.PI) / 3;
    const sequenceSign = ev.phaseSequence === 'ABC' ? -1 : 1;
    ev.phaseAnglesRad[0] = ev.electricalAngleRad;
    ev.phaseAnglesRad[1] = wrapAngle(ev.electricalAngleRad + sequenceSign * offset);
    ev.phaseAnglesRad[2] = wrapAngle(ev.electricalAngleRad - sequenceSign * offset);
  }

  function emitStep(): void {
    for (const listener of [...stepListeners]) listener(state);
  }

  function setControls(patch: Partial<SimulationControls>): void {
    const next = sanitizeControls(state.controls, patch);
    if (controlsEqual(next, state.controls)) return;
    const releasedClutch =
      state.controls.iceClutchMode === 'locked-clutch' && next.iceClutchMode === 'auto-slip';
    state.controls = Object.freeze(next);
    if (releasedClutch && state.ice.isStalled) {
      // Clutch release lets the driver restart the engine.
      state.ice.isStalled = false;
      state.ice.engineRpm = ICE_IDLE_RPM;
    }
    syncSnapshot();
  }

  function onFrame(nowMs: number): void {
    frameHandle = null;
    if (!state.isPlaying || !scheduler) return;
    const elapsedS = lastFrameMs === null ? 0 : (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;
    store.advance(elapsedS);
    // A step listener may have paused + resumed during advance(), which already
    // scheduled a frame; never queue a second one.
    if (state.isPlaying && frameHandle === null) frameHandle = scheduler.request(onFrame);
  }

  function stopScheduler(): void {
    if (frameHandle !== null && scheduler) scheduler.cancel(frameHandle);
    frameHandle = null;
    lastFrameMs = null;
  }

  const store: SimulationStore = {
    play() {
      if (state.isPlaying) return;
      state.isPlaying = true;
      accumulatorS = 0;
      if (scheduler && frameHandle === null) {
        lastFrameMs = null;
        frameHandle = scheduler.request(onFrame);
      }
      syncSnapshot();
    },

    pause() {
      if (!state.isPlaying) return;
      state.isPlaying = false;
      stopScheduler();
      syncSnapshot();
    },

    reset() {
      Object.assign(state.ice, createIceVehicleState());
      Object.assign(state.ev, createEvVehicleState());
      state.timeS = 0;
      state.stepCount = 0;
      accumulatorS = 0;
      emitStep();
      syncSnapshot();
    },

    step(dt = FIXED_DT) {
      const safeDt = clamp(finiteOr(dt, FIXED_DT), 0, MAX_STEP_DT);
      if (safeDt <= 0) return;
      stepOnce(safeDt);
      emitStep();
      syncSnapshot();
    },

    advance(realElapsedS) {
      if (!state.isPlaying) return 0;
      const elapsed = clamp(finiteOr(realElapsedS, 0), 0, MAX_STEPS_PER_ADVANCE * FIXED_DT);
      accumulatorS += elapsed * state.controls.timeScale;
      let steps = 0;
      // Step listeners see every fixed step; they may pause mid-batch.
      while (state.isPlaying && accumulatorS >= FIXED_DT && steps < MAX_STEPS_PER_ADVANCE) {
        stepOnce(FIXED_DT);
        accumulatorS -= FIXED_DT;
        steps += 1;
        emitStep();
      }
      if (steps === MAX_STEPS_PER_ADVANCE) accumulatorS = Math.min(accumulatorS, FIXED_DT);
      // UI snapshot stays batched: at most one React notification per advance().
      if (steps > 0) syncSnapshot();
      return steps;
    },

    setThrottle: (throttle) => setControls({ throttle }),
    setGrade: (gradePercent) => setControls({ gradePercent }),
    setIceGearMode: (iceGearMode) => setControls({ iceGearMode }),
    setIceClutchMode: (iceClutchMode) => setControls({ iceClutchMode }),
    setFieldWeakening: (fieldWeakening) => setControls({ fieldWeakening }),
    setGearSelector: (gearSelector) => setControls({ gearSelector }),
    setTimeScale: (timeScale) => setControls({ timeScale }),
    setControls,

    setActiveModule(module) {
      if (state.activeModule === module) return;
      state.activeModule = module;
      syncSnapshot();
    },

    getMutableState: () => state,
    getUiSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    subscribeStep(listener) {
      stepListeners.add(listener);
      return () => {
        stepListeners.delete(listener);
      };
    },

    dispose() {
      state.isPlaying = false;
      stopScheduler();
      listeners.clear();
      stepListeners.clear();
    },
  };

  return store;
}
