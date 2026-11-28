/** Thermal colour map for the clutch heatmap (°C → CSS rgb). Pure TS. */

const STOPS: readonly (readonly [number, number, number, number])[] = [
  [40, 30, 58, 138], // cold: deep blue
  [90, 109, 40, 217], // warm: violet
  [150, 220, 38, 38], // hot: red
  [220, 249, 115, 22], // glazing: orange
  [290, 250, 204, 21], // fade: yellow
  [360, 254, 252, 232], // burning facing: white-hot
];

export const HEAT_MIN_C = STOPS[0]![0];
export const HEAT_MAX_C = STOPS[STOPS.length - 1]![0];
/** Organic facings start to glaze and lose friction ("fade") around here. */
export const CLUTCH_FADE_C = 250;

export function heatColor(tempC: number): string {
  const t = Number.isFinite(tempC) ? tempC : HEAT_MIN_C;
  let lo = STOPS[0]!;
  let hi = STOPS[STOPS.length - 1]!;
  if (t <= lo[0]) hi = lo;
  else if (t >= hi[0]) lo = hi;
  else {
    for (let i = 1; i < STOPS.length; i += 1) {
      if (t <= STOPS[i]![0]) {
        lo = STOPS[i - 1]!;
        hi = STOPS[i]!;
        break;
      }
    }
  }
  const span = hi[0] - lo[0];
  const f = span === 0 ? 0 : (t - lo[0]) / span;
  const c = (i: 1 | 2 | 3): number => Math.round(lo[i] + (hi[i] - lo[i]) * f);
  return `rgb(${c(1)},${c(2)},${c(3)})`;
}

/** CSS gradient for the legend bar. */
export function heatLegendGradient(): string {
  return `linear-gradient(90deg, ${STOPS.map(([t, r, g, b]) => `rgb(${r},${g},${b}) ${(((t - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C)) * 100).toFixed(1)}%`).join(', ')})`;
}
