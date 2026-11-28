import type { ModuleId } from '../physics';
import { DragStripExplorer } from '../components/modules/DragStripExplorer';
import { DrivetrainSimulator } from '../components/modules/DrivetrainSimulator';
import { useUiSnapshot } from '../hooks/useUiSnapshot';
import { simulationStore as store } from './simulation';

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'drag-strip', label: '1 · Drag Strip & Torque Curves' },
  { id: 'drivetrain', label: '2 · Drivetrain & Launch Stall' },
  { id: 'magnetic-field', label: '3 · Stator Field & Field Weakening' },
  { id: 'reverse', label: '4 · Reverse: Idler vs Phase Swap' },
];

export function App() {
  const ui = useUiSnapshot();

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 font-mono text-sm">
      <header className="flex flex-col gap-3 border-b border-slate-800 pb-3">
        <h1 className="text-base font-semibold tracking-wide">
          <span className="text-ice">ICE</span> vs <span className="text-ev">EV</span> Torque &amp; Transmission Workbench
        </h1>
        <nav className="flex flex-wrap gap-1" aria-label="Modules">
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-current={ui.activeModule === m.id ? 'page' : undefined}
              onClick={() => store.setActiveModule(m.id)}
              className={`rounded px-3 py-1.5 ${
                ui.activeModule === m.id ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
              }`}
            >
              {m.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="min-w-0">
        {ui.activeModule === 'drag-strip' ? (
          <DragStripExplorer />
        ) : ui.activeModule === 'drivetrain' ? (
          <DrivetrainSimulator />
        ) : (
          <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-500">
            This module is not built yet. The simulation keeps running in the background.
          </div>
        )}
      </main>
    </div>
  );
}
