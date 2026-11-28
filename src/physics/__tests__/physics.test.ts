import { describe, expect, it } from 'vitest';
import {
  EV_BASE_POWER_W,
  EV_BASE_RPM,
  EV_MAX_RPM,
  FIXED_DT,
  ICE_SHIFT_DURATION_S,
  ICE_STALL_RPM,
  computeLongitudinalForces,
  createSimulationStore,
  getEvElectromagnetics,
  getEvTorque,
  getIceTorque,
  rpmToRadPerS,
  type IceGearMode,
  type SimulationStore,
} from '../index';

function runSteps(store: SimulationStore, steps: number): void {
  for (let i = 0; i < steps; i += 1) store.step(FIXED_DT);
}

function assertFiniteState(store: SimulationStore): void {
  const { ice, ev } = store.getMutableState();
  for (const value of [
    ice.velocityMps, ice.distanceM, ice.engineRpm, ice.wheelAngleRad, ice.crankAngleRad, ice.clutchTempC,
    ev.velocityMps, ev.distanceM, ev.motorRpm, ev.rotorAngleRad, ...ev.phaseAnglesRad,
  ]) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

describe('powertrain torque curves', () => {
  it('EV produces 400 Nm at 0 RPM while the ICE produces 0 Nm', () => {
    expect(getEvTorque(0, 1, true)).toBe(400);
    expect(getEvTorque(0, 1, false)).toBe(400);
    expect(getIceTorque(0, 1)).toBe(0);
  });

  it('ICE returns 0 Nm below the 750 RPM stall threshold and hits its anchor points', () => {
    expect(getIceTorque(749.9, 1)).toBe(0);
    expect(getIceTorque(ICE_STALL_RPM - 1, 1)).toBe(0);
    expect(getIceTorque(800, 1)).toBeCloseTo(180, 9);
    expect(getIceTorque(3_800, 1)).toBeCloseTo(360, 9);
    expect(getIceTorque(6_500, 1)).toBeCloseTo(275, 9);
    expect(getIceTorque(3_800, 0.5)).toBeCloseTo(180, 9);
    expect(getIceTorque(Number.NaN, 1)).toBe(0);
  });

  it('ICE curve is monotonic up to peak and tapering after it', () => {
    let previous = getIceTorque(800, 1);
    for (let rpm = 850; rpm <= 3_800; rpm += 50) {
      const t = getIceTorque(rpm, 1);
      expect(t).toBeGreaterThanOrEqual(previous);
      previous = t;
    }
    for (let rpm = 3_850; rpm <= 6_500; rpm += 50) {
      const t = getIceTorque(rpm, 1);
      expect(t).toBeLessThanOrEqual(previous);
      previous = t;
    }
  });

  it('EV torque transitions smoothly from constant torque to 1/ω constant power at 4,500 RPM', () => {
    // Constant-torque region.
    for (let rpm = 0; rpm <= EV_BASE_RPM; rpm += 250) {
      expect(getEvTorque(rpm, 1, true)).toBe(400);
    }
    // Continuity across the corner point (no step).
    const justBelow = getEvTorque(EV_BASE_RPM - 1e-6, 1, true);
    const justAbove = getEvTorque(EV_BASE_RPM + 1e-6, 1, true);
    expect(Math.abs(justAbove - justBelow)).toBeLessThan(1e-3);

    // Constant power: τ·ω = P_base everywhere in the field-weakening region.
    for (let rpm = EV_BASE_RPM + 1; rpm <= EV_MAX_RPM; rpm += 500) {
      const torque = getEvTorque(rpm, 1, true);
      expect(torque * rpmToRadPerS(rpm)).toBeCloseTo(EV_BASE_POWER_W, 6);
      expect(torque).toBeCloseTo((400 * EV_BASE_RPM) / rpm, 9);
    }
    expect(getEvTorque(9_000, 1, true)).toBeCloseTo(200, 9);
    expect(getEvTorque(EV_MAX_RPM, 1, true)).toBeCloseTo(100, 9);
    expect(getEvTorque(EV_MAX_RPM + 1, 1, true)).toBe(0);
  });

  it('EV torque collapses above base speed when field weakening is disabled', () => {
    expect(getEvTorque(EV_BASE_RPM, 1, false)).toBe(400);
    expect(getEvTorque(EV_BASE_RPM + 1, 1, false)).toBe(0);
    expect(getEvTorque(10_000, 1, false)).toBe(0);
  });

  it('field weakening holds back-EMF at the 800 V bus with negative d-axis current', () => {
    const weak = getEvElectromagnetics(9_000, 1, true);
    expect(weak.backEmfV).toBe(800);
    expect(weak.unweakenedBackEmfV).toBeCloseTo(1_600, 9);
    expect(weak.idA).toBeLessThan(0);
    expect(weak.netFluxRatio).toBeCloseTo(0.5, 9);

    const base = getEvElectromagnetics(EV_BASE_RPM, 1, false);
    expect(base.backEmfV).toBeCloseTo(800, 9);
    expect(base.idA).toBe(0);
  });
});

describe('ICE launch stall behaviour', () => {
  const modes: IceGearMode[] = ['auto', 'locked-4th'];

  it.each(modes)('stalls when launched with a locked clutch in %s mode', (iceGearMode) => {
    const store = createSimulationStore({
      initialControls: { iceGearMode, iceClutchMode: 'locked-clutch', throttle: 1 },
    });
    runSteps(store, 120);
    const { ice } = store.getMutableState();
    expect(ice.isStalled).toBe(true);
    expect(store.getUiSnapshot().ice.isStalled).toBe(true);
    expect(ice.wheelTorqueNm).toBe(0);
    expect(ice.velocityMps).toBe(0);
    expect(ice.engineRpm).toBeLessThan(ICE_STALL_RPM);
    expect(ice.gear).toBe(iceGearMode === 'auto' ? 1 : 4);
    assertFiniteState(store);
  });

  it.each(modes)('launches without stalling using auto-slip in %s mode', (iceGearMode) => {
    const store = createSimulationStore({
      initialControls: { iceGearMode, iceClutchMode: 'auto-slip', throttle: 1 },
    });
    runSteps(store, 60);
    const { ice } = store.getMutableState();
    expect(ice.isStalled).toBe(false);
    expect(ice.velocityMps).toBeGreaterThan(0);
    expect(ice.clutchTempC).toBeGreaterThan(40);
  });

  it('clutch release and reset both clear a stall', () => {
    const store = createSimulationStore({ initialControls: { iceClutchMode: 'locked-clutch', throttle: 1 } });
    store.step();
    expect(store.getMutableState().ice.isStalled).toBe(true);
    store.setIceClutchMode('auto-slip');
    expect(store.getMutableState().ice.isStalled).toBe(false);

    store.setIceClutchMode('locked-clutch');
    store.step();
    expect(store.getMutableState().ice.isStalled).toBe(true);
    store.reset();
    expect(store.getMutableState().ice.isStalled).toBe(false);
  });
});

describe('ICE shift interrupt', () => {
  it('upshifts at 6,200 RPM with a 300 ms zero-torque window', () => {
    const store = createSimulationStore({ initialControls: { throttle: 1 } });
    const { ice } = store.getMutableState();
    let interruptedSteps = 0;
    let rpmAtShiftStart = 0;
    for (let i = 0; i < 60 * 20 && ice.gear < 2; i += 1) {
      const gearBefore = ice.gear;
      store.step();
      if (ice.isShifting || ice.gear !== gearBefore) {
        if (interruptedSteps === 0) rpmAtShiftStart = ice.engineRpm;
        interruptedSteps += 1;
        expect(ice.wheelTorqueNm).toBe(0);
      }
    }
    expect(rpmAtShiftStart).toBeGreaterThanOrEqual(6_200);
    expect(rpmAtShiftStart).toBeLessThan(6_300);
    expect(ice.gear).toBe(2);
    expect(interruptedSteps * FIXED_DT).toBeCloseTo(ICE_SHIFT_DURATION_S, 6);
  });
});

describe('vehicle dynamics edge cases', () => {
  it('never creeps or produces NaN at rest on flat ground with zero throttle', () => {
    const store = createSimulationStore({ initialControls: { throttle: 0, gradePercent: 0 } });
    runSteps(store, 600);
    const { ice, ev } = store.getMutableState();
    expect(ice.velocityMps).toBe(0);
    expect(ev.velocityMps).toBe(0);
    expect(ice.distanceM).toBe(0);
    expect(ev.distanceM).toBe(0);
    assertFiniteState(store);
  });

  it('static friction cancels small forces at v = 0', () => {
    const forces = computeLongitudinalForces(10, 0, 0);
    expect(forces.netN).toBe(0);
    expect(forces.accelerationMps2).toBe(0);
  });

  it('coasting to a stop clamps at exactly zero instead of reversing', () => {
    const store = createSimulationStore({ initialControls: { throttle: 1 } });
    runSteps(store, 180);
    store.setThrottle(0);
    runSteps(store, 60 * 600);
    const { ice, ev } = store.getMutableState();
    expect(ice.velocityMps).toBe(0);
    expect(ev.velocityMps).toBe(0);
    assertFiniteState(store);
  });

  it('the EV reaches 100 km/h before the ICE (equal mass, shift interrupts)', () => {
    const store = createSimulationStore({ initialControls: { throttle: 1 } });
    const { ice, ev } = store.getMutableState();
    const target = 100 / 3.6;
    let iceTime = 0;
    let evTime = 0;
    for (let i = 0; i < 60 * 15 && (iceTime === 0 || evTime === 0); i += 1) {
      store.step();
      if (iceTime === 0 && ice.velocityMps >= target) iceTime = store.getMutableState().timeS;
      if (evTime === 0 && ev.velocityMps >= target) evTime = store.getMutableState().timeS;
    }
    expect(evTime).toBeGreaterThan(0);
    expect(iceTime).toBeGreaterThan(evTime);
  });

  it('without field weakening the EV is speed-capped at motor base speed', () => {
    const store = createSimulationStore({ initialControls: { throttle: 1, fieldWeakening: false } });
    runSteps(store, 60 * 20);
    const { ev } = store.getMutableState();
    expect(Math.abs(ev.motorRpm - EV_BASE_RPM)).toBeLessThan(50);
    assertFiniteState(store);
  });

  it('park pawl holds both vehicles on a 15% grade', () => {
    const store = createSimulationStore({ initialControls: { gearSelector: 'P', gradePercent: 15 } });
    runSteps(store, 300);
    const { ice, ev } = store.getMutableState();
    expect(ice.velocityMps).toBe(0);
    expect(ev.velocityMps).toBe(0);
  });

  it('EV reverse inverts the phase sequence and drives backwards', () => {
    const store = createSimulationStore({ initialControls: { gearSelector: 'R', throttle: 0.5 } });
    runSteps(store, 60);
    const { ev, ice } = store.getMutableState();
    expect(ev.phaseSequence).toBe('ACB');
    expect(ev.velocityMps).toBeLessThan(0);
    expect(ice.velocityMps).toBeLessThan(0);
  });
});

describe('simulation store', () => {
  it('is deterministic for identical inputs', () => {
    const a = createSimulationStore({ initialControls: { throttle: 1, gradePercent: 5 } });
    const b = createSimulationStore({ initialControls: { throttle: 1, gradePercent: 5 } });
    runSteps(a, 900);
    runSteps(b, 900);
    expect(a.getMutableState().ice.distanceM).toBe(b.getMutableState().ice.distanceM);
    expect(a.getMutableState().ev.distanceM).toBe(b.getMutableState().ev.distanceM);
  });

  it('only emits a new UI snapshot on discrete changes', () => {
    const store = createSimulationStore({ initialControls: { throttle: 0 } });
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const before = store.getUiSnapshot();
    runSteps(store, 120); // continuous motion only — no discrete changes at rest
    expect(store.getUiSnapshot()).toBe(before);
    expect(notifications).toBe(0);

    store.setThrottle(0.5);
    expect(notifications).toBe(1);
    expect(store.getUiSnapshot()).not.toBe(before);
    store.setThrottle(0.5); // no-op
    expect(notifications).toBe(1);
  });

  it('advance() runs whole fixed steps scaled by timeScale and only while playing', () => {
    const store = createSimulationStore({ initialControls: { throttle: 1, timeScale: 2 } });
    expect(store.advance(0.1)).toBe(0);
    store.play();
    const steps = store.advance(0.05); // 0.05 s × 2 = 0.1 s → 6 steps
    expect(steps).toBe(6);
    expect(store.getMutableState().timeS).toBeCloseTo(0.1, 9);
    store.pause();
    expect(store.advance(0.05)).toBe(0);
  });

  it('play() drives frames through an injected scheduler and pause() cancels them', () => {
    const queue = new Map<number, (now: number) => void>();
    let nextId = 1;
    const store = createSimulationStore({
      scheduler: {
        request: (cb) => {
          const id = nextId++;
          queue.set(id, cb);
          return id;
        },
        cancel: (id) => {
          queue.delete(id);
        },
      },
    });
    const flush = (now: number): void => {
      const pending = [...queue.values()];
      queue.clear();
      pending.forEach((cb) => cb(now));
    };
    store.play();
    flush(0);
    flush(1000 / 60);
    flush(2000 / 60);
    expect(store.getMutableState().stepCount).toBeGreaterThanOrEqual(1);
    store.pause();
    expect(queue.size).toBe(0);
  });
});

describe('architectural invariants', () => {
  it('src/physics has zero React or DOM imports', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(import.meta.dirname, '..');
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const code = readFileSync(join(dir, file), 'utf8');
      expect(code, file).not.toMatch(/from\s+['"](react|react-dom)(\/.*)?['"]/);
      expect(code, file).not.toMatch(/\b(window|document|requestAnimationFrame)\b/);
    }
  });
});

describe('store scheduling edge cases', () => {
  function fakeScheduler() {
    const queue = new Map<number, (now: number) => void>();
    let nextId = 1;
    return {
      queue,
      scheduler: {
        request: (cb: (now: number) => void) => {
          const id = nextId++;
          queue.set(id, cb);
          return id;
        },
        cancel: (id: number) => {
          queue.delete(id);
        },
      },
      flush(now: number) {
        const pending = [...queue.values()];
        queue.clear();
        pending.forEach((cb) => cb(now));
      },
    };
  }

  it('keeps exactly one pending frame when a step listener pauses and resumes', () => {
    const fake = fakeScheduler();
    const store = createSimulationStore({ scheduler: fake.scheduler });
    let bounced = false;
    store.subscribeStep(() => {
      if (bounced) return;
      bounced = true;
      store.pause();
      store.play();
    });
    store.play();
    fake.flush(0);
    fake.flush(1000 / 60);
    expect(bounced).toBe(true);
    expect(fake.queue.size).toBe(1);
    store.pause();
    expect(fake.queue.size).toBe(0);
  });

  it('notifies step listeners once per fixed step inside advance()', () => {
    const store = createSimulationStore({ initialControls: { timeScale: 2 } });
    const seen: number[] = [];
    store.subscribeStep((s) => seen.push(s.stepCount));
    store.play();
    expect(store.advance(0.05)).toBe(6);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('stops stepping inside advance() as soon as a listener pauses', () => {
    const store = createSimulationStore({ initialControls: { timeScale: 2 } });
    store.subscribeStep((s) => {
      if (s.stepCount === 2) store.pause();
    });
    store.play();
    expect(store.advance(0.05)).toBe(2);
    expect(store.getMutableState().stepCount).toBe(2);
  });
});
