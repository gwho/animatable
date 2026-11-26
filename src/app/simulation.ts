/**
 * Browser binding of the framework-agnostic store: injects a
 * requestAnimationFrame scheduler. Lives outside src/physics on purpose.
 */
import { createSimulationStore, type FrameScheduler } from '../physics';

const rafScheduler: FrameScheduler = {
  request: (cb) => window.requestAnimationFrame(cb),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

export const simulationStore = createSimulationStore({ scheduler: rafScheduler });

// Pause the simulation while the browser tab is hidden (lifecycle hygiene).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) simulationStore.pause();
});
