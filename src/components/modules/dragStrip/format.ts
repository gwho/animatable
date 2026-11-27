/** Helpers for imperative per-frame DOM writes (no React state). */

export const MPS_TO_KMH = 3.6;
export const MPS_TO_MPH = 2.236_936;

/** Writes text only when it changed, avoiding needless layout work. */
export function setText(el: Element | null | undefined, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element | null | undefined, name: string, value: string): void {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Integer with thousands separators, e.g. 12,345. Avoids Intl allocation per frame. */
export function formatInt(value: number): string {
  const n = Math.round(Number.isFinite(value) ? value : 0);
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatFixed(value: number, digits: number): string {
  const v = Number.isFinite(value) ? value : 0;
  // Avoid "-0.0" flicker at rest.
  return (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v).toFixed(digits);
}
