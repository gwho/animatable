import { describe, expect, it } from 'vitest';
import { ICE_GEAR_RATIOS } from '../../../../physics';
import {
  EV_STAGE_TEETH,
  ICE_GEAR_TEETH,
  meshedAngle,
  moduleForCentreDistance,
  pairRatio,
  pitchRadius,
} from '../gearGeometry';

const frac = (x: number): number => x - Math.floor(x);

describe('gear geometry', () => {
  it('tooth counts reproduce the physics gear ratios exactly', () => {
    ICE_GEAR_TEETH.forEach((pair, i) => expect(pairRatio(pair)).toBe(ICE_GEAR_RATIOS[i]));
    expect(pairRatio(EV_STAGE_TEETH[0]) * pairRatio(EV_STAGE_TEETH[1])).toBeCloseTo(9, 12);
  });

  it('driven gear turns at ω₂ = −ω₁·R₁/R₂', () => {
    for (const pair of ICE_GEAR_TEETH) {
      const m = moduleForCentreDistance(150, pair);
      const r1 = pitchRadius(m, pair.driver);
      const r2 = pitchRadius(m, pair.driven);
      expect(r1 + r2).toBeCloseTo(150, 9);
      const d1 = 0.37;
      const d2 = meshedAngle(d1, pair.driver, pair.driven) - meshedAngle(0, pair.driver, pair.driven);
      expect(d2).toBeCloseTo(-d1 * (r1 / r2), 12);
      // Pitch-line surface speeds match (no slip).
      expect(Math.abs(d1 * r1)).toBeCloseTo(Math.abs(d2 * r2), 12);
    }
  });

  it.each([0, Math.PI / 2, 2.1])('keeps a driver tooth facing a driven gap on the line of centres (contact %f)', (contact) => {
    for (const { driver, driven } of [...ICE_GEAR_TEETH, ...EV_STAGE_TEETH]) {
      for (const theta1 of [0, 0.123, 1.5, -4.2, 37.9]) {
        const theta2 = meshedAngle(theta1, driver, driven, contact);
        // Position of the contact point within each gear's tooth pitch (0 = tooth centre).
        const phase1 = frac((contact - theta1) / ((2 * Math.PI) / driver));
        const phase2 = frac((contact + Math.PI - theta2) / ((2 * Math.PI) / driven));
        // A tooth of one gear always aligns with the middle of a gap of the other.
        expect(frac(phase1 + phase2 + 1e-12)).toBeCloseTo(0.5, 9);
      }
    }
  });
});
