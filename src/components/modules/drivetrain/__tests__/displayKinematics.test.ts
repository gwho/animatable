import { describe, expect, it } from 'vitest';
import { createSimulationStore } from '../../../../physics';
import { DisplayKinematics } from '../displayKinematics';
import { CLUTCH_FADE_C, heatColor } from '../heatColor';

describe('display kinematics', () => {
  it('integrates display angles at speedFactor × real shaft speed and resets with the sim', () => {
    const store = createSimulationStore({ initialControls: { gearSelector: 'N' } });
    const kin = new DisplayKinematics();
    for (let i = 0; i < 30; i += 1) store.step();
    const s = store.getMutableState();
    // Engine idles at 800 rpm in neutral → 800/60 rev/s.
    const a = kin.update(s, 0.1);
    const expected = (800 / 60) * 2 * Math.PI * s.timeS * 0.1;
    expect(a.crank).toBeCloseTo(expected, 6);
    expect(a.input).toBeCloseTo(expected % (2 * Math.PI), 6);
    store.reset();
    expect(kin.update(store.getMutableState(), 0.1).crank).toBe(0);
  });
});

describe('heat colour map', () => {
  it('is cold blue at ambient and hot by the fade threshold, never NaN', () => {
    expect(heatColor(40)).toBe('rgb(30,58,138)');
    expect(heatColor(CLUTCH_FADE_C)).toMatch(/^rgb\(2[45]\d,/);
    expect(heatColor(Number.NaN)).toBe('rgb(30,58,138)');
    expect(heatColor(1e6)).toBe('rgb(254,252,232)');
  });
});
