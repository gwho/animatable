/**
 * Spur-gear geometry and exact meshing kinematics for the SVG cutaways.
 * Pure TypeScript — no React, no DOM — so the invariants are unit-testable.
 *
 * Convention: angles are in the SVG coordinate system (y down, positive =
 * clockwise on screen). A gear rotated by θ has tooth centres at θ + 2πk/N.
 */
import { ICE_GEAR_RATIOS, ICE_REVERSE_RATIO } from '../../../physics';

export interface GearPair {
  /** Driving (input-shaft) gear tooth count. */
  driver: number;
  /** Driven (output-shaft) gear tooth count. */
  driven: number;
}

/**
 * Tooth counts whose ratio driven/driver equals the physics gear ratio
 * exactly, so what learners see matches what the simulation computes.
 */
export const ICE_GEAR_TEETH: readonly GearPair[] = [
  { driver: 10, driven: 38 }, // 3.8
  { driver: 15, driven: 36 }, // 2.4
  { driver: 20, driven: 34 }, // 1.7
  { driver: 20, driven: 26 }, // 1.3
  { driver: 22, driven: 22 }, // 1.0
  { driver: 25, driven: 20 }, // 0.8
];
export const ICE_REVERSE_TEETH: GearPair = { driver: 10, driven: 34 }; // 3.4

/** EV two-stage helical reduction: 39/13 × 39/13 = 9.0 exactly. */
export const EV_STAGE_TEETH: readonly [GearPair, GearPair] = [
  { driver: 13, driven: 39 },
  { driver: 13, driven: 39 },
];

export function pairRatio(pair: GearPair): number {
  return pair.driven / pair.driver;
}

// Compile-time data, runtime-checked once: tooth ratios must equal physics ratios.
ICE_GEAR_TEETH.forEach((pair, i) => {
  const expected = ICE_GEAR_RATIOS[i];
  if (expected === undefined || Math.abs(pairRatio(pair) - expected) > 1e-12) {
    throw new Error(`Gear ${i + 1} tooth ratio ${pair.driven}:${pair.driver} != ${String(expected)}`);
  }
});
if (Math.abs(pairRatio(ICE_REVERSE_TEETH) - ICE_REVERSE_RATIO) > 1e-12) {
  throw new Error('Reverse tooth ratio mismatch');
}

/** Pitch radius for a given module (length per tooth) and tooth count. */
export function pitchRadius(module: number, teeth: number): number {
  return (module * teeth) / 2;
}

/** Module that makes a pair fit an exact centre distance: C = m(N1 + N2)/2. */
export function moduleForCentreDistance(centreDistance: number, pair: GearPair): number {
  return (2 * centreDistance) / (pair.driver + pair.driven);
}

/**
 * Angle of a driven gear meshing with a driver at `driverAngle`.
 *
 * `contactAngle` is the direction from the driver centre to the driven centre.
 * Rolling without slip at the pitch circles gives ω₂ = −ω₁·N₁/N₂ (= −ω₁·R₁/R₂),
 * and the constant offset places a driven-gear *gap* exactly where a driver
 * tooth sits on the line of centres, so teeth interleave and never clip.
 */
export function meshedAngle(driverAngle: number, driverTeeth: number, drivenTeeth: number, contactAngle = 0): number {
  return -(driverAngle - contactAngle) * (driverTeeth / drivenTeeth) + contactAngle + Math.PI - Math.PI / drivenTeeth;
}

/**
 * Closed SVG path of a spur gear centred on the origin with a tooth centred at
 * angle 0. Trapezoidal teeth: addendum = m, dedendum = 1.25 m, tooth thickness
 * ≈ half the circular pitch.
 */
export function gearPath(teeth: number, module: number): string {
  const rp = pitchRadius(module, teeth);
  const ra = rp + module;
  const rr = Math.max(rp - 1.25 * module, module * 0.5);
  const quarter = Math.PI / (2 * teeth); // quarter of the angular pitch
  const pts: string[] = [];
  const pt = (r: number, a: number): string => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  for (let k = 0; k < teeth; k += 1) {
    const c = (2 * Math.PI * k) / teeth;
    pts.push(pt(rr, c - 1.4 * quarter), pt(ra, c - 0.6 * quarter), pt(ra, c + 0.6 * quarter), pt(rr, c + 1.4 * quarter));
  }
  return `M${pts.join(' L')} Z`;
}

/** Converts radians to an SVG rotate() degree string. */
export function toDeg(rad: number): string {
  return ((rad * 180) / Math.PI).toFixed(2);
}
