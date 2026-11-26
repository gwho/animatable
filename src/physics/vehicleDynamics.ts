/**
 * Longitudinal vehicle dynamics shared by both (equal-mass) vehicles.
 * Pure TypeScript — no React, no DOM.
 *
 *   F_net = τ·G·η / r  −  ½ρC_dAv²  −  m·g·sin θ  −  C_rr·m·g·cos θ
 *
 * Zero-speed handling: at v = 0 rolling resistance behaves like static
 * friction — it cancels any applied force up to its limit — so a car on flat
 * ground never creeps, and the integrator clamps velocity sign reversals to an
 * exact stop instead of oscillating through zero.
 */
import { clamp, finiteOr, signWithDeadband } from './math';
import { WHEEL_RADIUS_M } from './drivetrain';
import type { ForceBreakdown } from './types';

export interface VehicleParams {
  massKg: number;
  dragCoefficient: number;
  frontalAreaM2: number;
  rollingResistanceCoefficient: number;
  airDensityKgM3: number;
  gravityMps2: number;
  wheelRadiusM: number;
}

export const VEHICLE_PARAMS: Readonly<VehicleParams> = Object.freeze({
  massKg: 1_650,
  dragCoefficient: 0.28,
  frontalAreaM2: 2.3,
  rollingResistanceCoefficient: 0.012,
  airDensityKgM3: 1.225,
  gravityMps2: 9.81,
  wheelRadiusM: WHEEL_RADIUS_M,
});

export const MAX_GRADE_PERCENT = 15;

export function clampGradePercent(gradePercent: number): number {
  return clamp(gradePercent, 0, MAX_GRADE_PERCENT);
}

/** Converts a road grade (rise/run × 100) to the slope angle θ. */
export function gradePercentToAngleRad(gradePercent: number): number {
  return Math.atan(clampGradePercent(gradePercent) / 100);
}

export function createForceBreakdown(): ForceBreakdown {
  return { tractiveN: 0, aeroN: 0, gradeN: 0, rollingN: 0, netN: 0, accelerationMps2: 0 };
}

/**
 * Computes every longitudinal force term for the current state.
 * Writes into `out` when provided (allocation-free hot path).
 */
export function computeLongitudinalForces(
  wheelTorqueNm: number,
  velocityMps: number,
  gradePercent: number,
  params: Readonly<VehicleParams> = VEHICLE_PARAMS,
  out: ForceBreakdown = createForceBreakdown(),
): ForceBreakdown {
  const v = finiteOr(velocityMps, 0);
  const theta = gradePercentToAngleRad(gradePercent);
  const { massKg: m, gravityMps2: g } = params;

  const tractiveN = finiteOr(wheelTorqueNm, 0) / params.wheelRadiusM;
  const aeroN = -0.5 * params.airDensityKgM3 * params.dragCoefficient * params.frontalAreaM2 * v * Math.abs(v);
  const gradeN = -m * g * Math.sin(theta);
  const rollingLimitN = params.rollingResistanceCoefficient * m * g * Math.cos(theta);

  const motionSign = signWithDeadband(v);
  let rollingN: number;
  if (motionSign !== 0) {
    rollingN = -motionSign * rollingLimitN;
  } else {
    // Static: friction opposes the impending motion, never exceeding its limit.
    const appliedN = tractiveN + gradeN;
    rollingN = -Math.sign(appliedN) * Math.min(Math.abs(appliedN), rollingLimitN);
  }

  const netN = tractiveN + aeroN + gradeN + rollingN;
  out.tractiveN = tractiveN;
  out.aeroN = aeroN;
  out.gradeN = gradeN;
  out.rollingN = rollingN;
  out.netN = netN;
  out.accelerationMps2 = netN / m;
  return out;
}

export interface LongitudinalState {
  velocityMps: number;
  distanceM: number;
}

/**
 * Semi-implicit Euler step. If the velocity would change sign in one step
 * the vehicle is brought to an exact stop; the next step then re-evaluates
 * from rest using the static-friction rule above.
 */
export function integrateLongitudinal(
  state: LongitudinalState,
  accelerationMps2: number,
  dt: number,
): LongitudinalState {
  const v0 = finiteOr(state.velocityMps, 0);
  const step = Math.max(0, finiteOr(dt, 0));
  let v1 = v0 + finiteOr(accelerationMps2, 0) * step;

  const s0 = signWithDeadband(v0);
  if (s0 !== 0 && signWithDeadband(v1) !== s0) v1 = 0;
  if (signWithDeadband(v1) === 0) v1 = 0;

  state.distanceM = finiteOr(state.distanceM + 0.5 * (v0 + v1) * step, 0);
  state.velocityMps = v1;
  return state;
}
