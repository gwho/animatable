import { useSyncExternalStore } from 'react';
import type { UiSnapshot } from '../physics';
import { simulationStore } from '../app/simulation';

/** Discrete-state subscription: re-renders only on gear/stall/shift/control changes. */
export function useUiSnapshot(): UiSnapshot {
  return useSyncExternalStore(simulationStore.subscribe, simulationStore.getUiSnapshot);
}
