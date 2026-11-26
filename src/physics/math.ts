/**
 * Deterministic numeric helpers shared by every physics module.
 * Pure TypeScript — no React, no DOM.
 */

export const TWO_PI = Math.PI * 2;

/** Velocities with magnitude below this are treated as exactly zero. */
export const ZERO_VELOCITY_EPSILON = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep: C1-continuous 0→1 ramp with zero slope at both edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function rpmToRadPerS(rpm: number): number {
  return (rpm * TWO_PI) / 60;
}

export function radPerSToRpm(radPerS: number): number {
  return (radPerS * 60) / TWO_PI;
}

/** Wraps an angle into [0, 2π). */
export function wrapAngle(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  const wrapped = rad % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** Sign that returns 0 inside the zero-velocity dead band (never NaN). */
export function signWithDeadband(value: number, epsilon = ZERO_VELOCITY_EPSILON): -1 | 0 | 1 {
  if (!Number.isFinite(value) || Math.abs(value) <= epsilon) return 0;
  return value > 0 ? 1 : -1;
}

/** Replaces NaN / ±Infinity with a fallback so corrupt values never propagate. */
export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
