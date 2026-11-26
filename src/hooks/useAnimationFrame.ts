import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Runs `callback` every animation frame while `active` is true and cancels
 * immediately on deactivation or unmount. The callback should mutate refs
 * (canvas / SVG / DOM) directly — never React state.
 */
export function useAnimationFrame(callback: (nowMs: number) => void, active = true): void {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!active) return;
    let handle = 0;
    const loop = (now: number): void => {
      callbackRef.current(now);
      handle = window.requestAnimationFrame(loop);
    };
    handle = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(handle);
  }, [active]);
}
