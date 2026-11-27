import { describe, expect, it } from 'vitest';
import { EV_BASE_RPM, sampleEvCurve, sampleIceCurve, shaftPowerKw } from '../index';

describe('curve sampling', () => {
  it('ICE curve starts at the stall threshold with 0 Nm and peaks at 360 Nm', () => {
    const ice = sampleIceCurve();
    expect(ice[0]).toMatchObject({ rpm: 750, torqueNm: 0 });
    expect(Math.max(...ice.map((s) => s.torqueNm))).toBeCloseTo(360, 6);
    expect(ice.at(-1)?.rpm).toBe(7_000);
    for (let i = 1; i < ice.length; i += 1) expect(ice[i]!.rpm).toBeGreaterThan(ice[i - 1]!.rpm);
  });

  it('EV curve holds 400 Nm to base speed and plateaus in power with field weakening', () => {
    const ev = sampleEvCurve(true);
    expect(ev[0]).toMatchObject({ rpm: 0, torqueNm: 400, powerKw: 0 });
    const fw = ev.filter((s) => s.rpm > EV_BASE_RPM);
    for (const s of fw) expect(s.powerKw).toBeCloseTo(188.5, 0);
  });

  it('EV curve without field weakening contains an explicit cliff at base speed', () => {
    const ev = sampleEvCurve(false);
    const at = ev.find((s) => s.rpm === EV_BASE_RPM);
    const after = ev.find((s) => s.rpm > EV_BASE_RPM);
    expect(at?.torqueNm).toBe(400);
    expect(after?.torqueNm).toBe(0);
    expect(after!.rpm - EV_BASE_RPM).toBeLessThan(0.01);
  });

  it('shaft power is finite and sign-safe', () => {
    expect(shaftPowerKw(400, -4_500)).toBeCloseTo(188.5, 0);
    expect(shaftPowerKw(Number.NaN, 1_000)).toBe(0);
  });
});
