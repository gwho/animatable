/**
 * Module 1 — Synchronized Drag-Strip & Torque-Curve Explorer.
 *
 * React renders only on discrete UI changes (controls, gear, shift, stall);
 * every per-frame value (positions, speeds, tracer coordinates) is written
 * straight to DOM refs inside rAF callbacks that stop when the tab is inactive.
 */
import { useUiSnapshot } from '../../hooks/useUiSnapshot';
import { Panel } from '../ui/controls';
import { ControlHeader } from './dragStrip/ControlHeader';
import { DragStrip } from './dragStrip/DragStrip';
import { TorquePowerPlot } from './dragStrip/TorquePowerPlot';

export function DragStripExplorer() {
  const ui = useUiSnapshot();
  const active = ui.activeModule === 'drag-strip';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ControlHeader ui={ui} />
      <Panel
        title="Synchronized drag strip · equal mass 1,650 kg"
        aside={<span className="text-[11px] text-slate-500">camera follows the leader · 0–400 m</span>}
      >
        <DragStrip ui={ui} active={active} />
      </Panel>
      <Panel title="Live torque & power · 0–18,000 rpm">
        <TorquePowerPlot fieldWeakening={ui.controls.fieldWeakening} active={active} />
      </Panel>
    </div>
  );
}
