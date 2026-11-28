/**
 * Drivetrains: ICE 6-speed automated manual with launch clutch, and the EV
 * single-speed reduction. Pure TypeScript — no React, no DOM.
 *
 * The step functions mutate the state object they are handed (zero allocation
 * per frame) and return the signed torque delivered at the road wheels.
 */
import { clamp01, finiteOr, lerp, rpmToRadPerS, radPerSToRpm } from './math';
import {
  ICE_IDLE_RPM,
  ICE_STALL_RPM,
  getEvElectromagnetics,
  getIceTorque,
} from './powertrains';
import type {
  EvDrivetrainState,
  GearSelector,
  IceClutchMode,
  IceDrivetrainState,
  IceGearMode,
} from './types';

export const WHEEL_RADIUS_M = 0.32;

// ---------------------------------------------------------------------------
// ICE transmission
// ---------------------------------------------------------------------------

export const ICE_GEAR_RATIOS: readonly number[] = [3.8, 2.4, 1.7, 1.3, 1.0, 0.8];
export const ICE_GEAR_COUNT = ICE_GEAR_RATIOS.length;
/** Sliding-idler reverse gear (Module 4). */
export const ICE_REVERSE_RATIO = 3.4;
export const ICE_FINAL_DRIVE = 3.5;
export const ICE_DRIVETRAIN_EFFICIENCY = 0.88;
export const ICE_UPSHIFT_RPM = 6_200;
export const ICE_SHIFT_DURATION_S = 0.3;
export const ICE_LOCKED_GEAR = 4;
/** Auto mode downshifts when engine speed falls below this… */
export const ICE_DOWNSHIFT_RPM = 2_000;
/** …provided the lower gear would land below this (hysteresis vs. upshift). */
export const ICE_DOWNSHIFT_CEILING_RPM = 5_500;
/** Launch-clutch slip speed at full throttle in `auto-slip` mode. */
export const ICE_LAUNCH_RPM_MAX = 2_800;
/** Free-revving engine response time constant in neutral (s). */
export const ICE_FREE_REV_TAU_S = 0.15;
export const ICE_FREE_REV_MAX_RPM = 6_000;

/** Clutch lumped thermal model. */
export const CLUTCH_AMBIENT_C = 40;
export const CLUTCH_HEAT_CAPACITY_J_PER_K = 2_500;
export const CLUTCH_COOLING_TAU_S = 30;

const SHIFT_TIMER_EPSILON_S = 1e-9;

export function selectorDirection(selector: GearSelector): -1 | 0 | 1 {
  return selector === 'D' ? 1 : selector === 'R' ? -1 : 0;
}

export function getIceGearRatio(gear: number): number {
  const index = Math.min(Math.max(Math.round(gear), 1), ICE_GEAR_COUNT) - 1;
  return ICE_GEAR_RATIOS[index] ?? 1;
}

/**
 * Engine speed imposed by the wheels through a fully locked clutch.
 * Only motion in the selected direction spins the engine forwards; motion
 * against it maps to 0 rpm (the engine cannot run backwards).
 */
export function wheelCoupledRpm(velocityMps: number, direction: -1 | 0 | 1, overallRatio: number): number {
  const wheelRadPerS = Math.max(0, direction * finiteOr(velocityMps, 0)) / WHEEL_RADIUS_M;
  return radPerSToRpm(wheelRadPerS * overallRatio);
}

export function createIceDrivetrainState(): IceDrivetrainState {
  return {
    gear: 1,
    targetGear: 1,
    engineRpm: ICE_IDLE_RPM,
    engineTorqueNm: 0,
    isShifting: false,
    shiftTimerS: 0,
    isStalled: false,
    clutchState: 'open',
    clutchSlipPowerW: 0,
    clutchTempC: CLUTCH_AMBIENT_C,
    clutchEnergyJ: 0,
    inputShaftRpm: 0,
  };
}

export interface IceDrivetrainInput {
  velocityMps: number;
  throttle: number;
  gearMode: IceGearMode;
  clutchMode: IceClutchMode;
  gearSelector: GearSelector;
  dt: number;
}

/** Advances the ICE drivetrain by `dt` and returns the signed wheel torque (Nm). */
export function stepIceDrivetrain(state: IceDrivetrainState, input: IceDrivetrainInput): number {
  const throttle = clamp01(input.throttle);
  const dt = Math.max(0, finiteOr(input.dt, 0));
  const direction = selectorDirection(input.gearSelector);
  const wheelTorque = computeIceWheelTorque(state, input, throttle, dt, direction);
  updateClutchTemperature(state, dt);
  return wheelTorque;
}

function computeIceWheelTorque(
  state: IceDrivetrainState,
  input: IceDrivetrainInput,
  throttle: number,
  dt: number,
  direction: -1 | 0 | 1,
): number {
  state.clutchSlipPowerW = 0;
  const v = input.velocityMps;

  // --- Neutral / Park: gearbox disengaged, engine free-revs (or sits stalled).
  if (direction === 0) {
    state.isShifting = false;
    state.shiftTimerS = 0;
    state.targetGear = state.gear;
    state.clutchState = 'open';
    state.engineTorqueNm = 0;
    if (state.isStalled) {
      state.engineRpm = 0;
    } else {
      const target = ICE_IDLE_RPM + throttle * (ICE_FREE_REV_MAX_RPM - ICE_IDLE_RPM);
      const alpha = Math.min(1, dt / ICE_FREE_REV_TAU_S);
      state.engineRpm = lerp(state.engineRpm, target, alpha);
    }
    state.inputShaftRpm = state.engineRpm;
    return 0;
  }

  const isReverse = direction < 0;
  const inAutoDrive = !isReverse && input.gearMode === 'auto';

  if (!isReverse && input.gearMode === 'locked-4th') {
    state.gear = ICE_LOCKED_GEAR;
    state.targetGear = ICE_LOCKED_GEAR;
    state.isShifting = false;
    state.shiftTimerS = 0;
  }
  if (isReverse) {
    state.isShifting = false;
    state.shiftTimerS = 0;
    state.targetGear = state.gear;
  }

  const overall = (gear: number): number =>
    (isReverse ? ICE_REVERSE_RATIO : getIceGearRatio(gear)) * ICE_FINAL_DRIVE;
  const coupled = (gear: number): number => wheelCoupledRpm(v, direction, overall(gear));

  // --- Stalled: no combustion; a locked clutch lets the wheels drag the crank.
  if (state.isStalled) {
    state.isShifting = false;
    state.shiftTimerS = 0;
    state.engineTorqueNm = 0;
    state.clutchState = input.clutchMode === 'locked-clutch' ? 'locked' : 'open';
    state.inputShaftRpm = coupled(state.gear);
    state.engineRpm = state.clutchState === 'locked' ? state.inputShaftRpm : 0;
    return 0;
  }

  // --- Upshift in progress: clutch open, zero torque reaches the wheels.
  if (state.isShifting) {
    state.shiftTimerS -= dt;
    const progress = clamp01(1 - state.shiftTimerS / ICE_SHIFT_DURATION_S);
    // Synchroniser drags the input shaft from the old gear's speed to the new one's.
    state.inputShaftRpm = lerp(coupled(state.gear), coupled(state.targetGear), progress);
    state.engineRpm = Math.max(ICE_IDLE_RPM, state.inputShaftRpm);
    state.engineTorqueNm = 0;
    state.clutchState = 'open';
    if (state.shiftTimerS <= SHIFT_TIMER_EPSILON_S) {
      state.gear = state.targetGear;
      state.isShifting = false;
      state.shiftTimerS = 0;
    }
    return 0;
  }

  // --- Automatic gear selection.
  if (inAutoDrive) {
    if (coupled(state.gear) >= ICE_UPSHIFT_RPM && state.gear < ICE_GEAR_COUNT) {
      state.isShifting = true;
      state.targetGear = state.gear + 1;
      state.shiftTimerS = ICE_SHIFT_DURATION_S - dt; // this step is the first interrupted one
      state.engineRpm = coupled(state.gear);
      state.inputShaftRpm = state.engineRpm;
      state.engineTorqueNm = 0;
      state.clutchState = 'open';
      return 0;
    }
    while (
      state.gear > 1 &&
      coupled(state.gear) < ICE_DOWNSHIFT_RPM &&
      coupled(state.gear - 1) < ICE_DOWNSHIFT_CEILING_RPM
    ) {
      state.gear -= 1; // rev-matched downshift, no torque interrupt
    }
    state.targetGear = state.gear;
  }

  const ratio = overall(state.gear);
  const coupledRpm = coupled(state.gear);
  state.inputShaftRpm = coupledRpm;
  let engineTorque: number;

  if (input.clutchMode === 'locked-clutch') {
    state.clutchState = 'locked';
    state.engineRpm = coupledRpm;
    if (coupledRpm < ICE_STALL_RPM) {
      // Road speed drags the crank below the combustion threshold.
      state.isStalled = true;
      state.engineTorqueNm = 0;
      return 0;
    }
    engineTorque = getIceTorque(coupledRpm, throttle);
  } else {
    const slipTargetRpm = ICE_IDLE_RPM + throttle * (ICE_LAUNCH_RPM_MAX - ICE_IDLE_RPM);
    if (coupledRpm >= slipTargetRpm && coupledRpm >= ICE_IDLE_RPM) {
      state.clutchState = 'locked';
      state.engineRpm = coupledRpm;
      engineTorque = getIceTorque(coupledRpm, throttle);
    } else if (throttle <= 0) {
      state.clutchState = 'open';
      state.engineRpm = ICE_IDLE_RPM;
      engineTorque = 0;
    } else {
      // Engine held at the slip speed; clutch passes the full engine torque.
      state.clutchState = 'slipping';
      state.engineRpm = slipTargetRpm;
      engineTorque = getIceTorque(slipTargetRpm, throttle);
      state.clutchSlipPowerW = engineTorque * rpmToRadPerS(slipTargetRpm - coupledRpm);
    }
  }

  state.engineTorqueNm = engineTorque;
  return engineTorque * ratio * ICE_DRIVETRAIN_EFFICIENCY * direction;
}

function updateClutchTemperature(state: IceDrivetrainState, dt: number): void {
  state.clutchEnergyJ = finiteOr(state.clutchEnergyJ + state.clutchSlipPowerW * dt, 0);
  const heating = state.clutchSlipPowerW / CLUTCH_HEAT_CAPACITY_J_PER_K;
  const cooling = (state.clutchTempC - CLUTCH_AMBIENT_C) / CLUTCH_COOLING_TAU_S;
  state.clutchTempC = finiteOr(state.clutchTempC + (heating - cooling) * dt, CLUTCH_AMBIENT_C);
}

// ---------------------------------------------------------------------------
// EV transmission
// ---------------------------------------------------------------------------

export const EV_REDUCTION_RATIO = 9.0;
export const EV_DRIVETRAIN_EFFICIENCY = 0.95;

/** Signed rotor speed for a given road speed: direct coupling from 0 rpm. */
export function evMotorRpm(velocityMps: number): number {
  return radPerSToRpm((finiteOr(velocityMps, 0) / WHEEL_RADIUS_M) * EV_REDUCTION_RATIO);
}

export function createEvDrivetrainState(): EvDrivetrainState {
  return {
    motorRpm: 0,
    motorTorqueNm: 0,
    phaseSequence: 'ABC',
    em: getEvElectromagnetics(0, 0, true),
  };
}

export interface EvDrivetrainInput {
  velocityMps: number;
  throttle: number;
  fieldWeakening: boolean;
  gearSelector: GearSelector;
}

/** Updates the EV drivetrain and returns the signed wheel torque (Nm). No shift interrupt. */
export function stepEvDrivetrain(state: EvDrivetrainState, input: EvDrivetrainInput): number {
  const direction = selectorDirection(input.gearSelector);
  state.motorRpm = evMotorRpm(input.velocityMps);
  // Reverse is purely electronic: swapping two phases reverses the rotating field.
  if (direction !== 0) state.phaseSequence = direction > 0 ? 'ABC' : 'ACB';
  const throttle = direction === 0 ? 0 : clamp01(input.throttle);
  state.em = getEvElectromagnetics(state.motorRpm, throttle, input.fieldWeakening);
  state.motorTorqueNm = state.em.torqueNm;
  return state.motorTorqueNm * EV_REDUCTION_RATIO * EV_DRIVETRAIN_EFFICIENCY * direction;
}
