import { createContext, useContext, useEffect, useRef } from 'react';
import type { SimulationState } from '../../../physics';
import type { DisplayAngles } from './displayKinematics';

/** Per-frame imperative renderer: mutate refs only, never React state. */
export type FrameRenderer = (state: Readonly<SimulationState>, angles: Readonly<DisplayAngles>) => void;
export type RegisterRenderer = (renderer: FrameRenderer) => () => void;

export const FrameRegistryContext = createContext<RegisterRenderer | null>(null);

/** Registers `renderer` with the module's single rAF loop for this component's lifetime. */
export function useFrameRenderer(renderer: FrameRenderer): void {
  const register = useContext(FrameRegistryContext);
  const latest = useRef(renderer);
  useEffect(() => {
    latest.current = renderer;
  });
  useEffect(() => {
    if (!register) return undefined;
    return register((state, angles) => latest.current(state, angles));
  }, [register]);
}
