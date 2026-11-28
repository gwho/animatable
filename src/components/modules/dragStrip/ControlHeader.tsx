import { gradePercentToAngleRad, type IceClutchMode, type IceGearMode, type UiSnapshot } from '../../../physics';
import { simulationStore as store } from '../../../app/simulation';
import { Button, Segmented, Slider } from '../../ui/controls';

const GEARBOX_OPTIONS = [
  { value: 'auto', label: 'Auto-Shift 1–6' },
  { value: 'locked-4th', label: 'Locked in 4th' },
] as const satisfies readonly { value: IceGearMode; label: string }[];

const CLUTCH_OPTIONS = [
  { value: 'auto-slip', label: 'Slip clutch' },
  { value: 'locked-clutch', label: 'Dump clutch' },
] as const satisfies readonly { value: IceClutchMode; label: string }[];

/** Small incline glyph: the road line tilts by the real slope angle. */
function InclineGlyph({ gradePercent }: { gradePercent: number }) {
  const angleRad = gradePercentToAngleRad(gradePercent);
  const deg = (angleRad * 180) / Math.PI;
  const w = 64;
  const h = 30;
  const rise = Math.tan(angleRad) * (w - 8);
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
        <polygon points={`4,${h - 4} ${w - 4},${h - 4} ${w - 4},${h - 4 - rise}`} className="fill-amber-500/20" />
        <line x1={4} y1={h - 4} x2={w - 4} y2={h - 4 - rise} className="stroke-amber-400" strokeWidth={2} strokeLinecap="round" />
        <line x1={4} y1={h - 4} x2={w - 4} y2={h - 4} className="stroke-slate-600" strokeWidth={1} />
        {/* Car block sitting on the slope, rotated to match it. */}
        <rect
          x={w / 2 - 7}
          y={h - 4 - rise / 2 - 7}
          width={14}
          height={6}
          rx={1.5}
          className="fill-slate-300"
          transform={`rotate(${-deg} ${w / 2} ${h - 4 - rise / 2})`}
        />
      </svg>
      <span className="tabular-nums text-slate-400">{deg.toFixed(1)}°</span>
    </span>
  );
}

export function ControlHeader({ ui }: { ui: UiSnapshot }) {
  const { controls } = ui;
  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
        <Button variant="primary" onClick={() => (ui.isPlaying ? store.pause() : store.play())}>
          {ui.isPlaying ? '❚❚ Pause' : '▶ Play'}
        </Button>
        <Button onClick={() => store.reset()}>↺ Reset</Button>
      </div>

      <Slider
        ariaLabel="Throttle"
        label={
          <span className="flex justify-between">
            Throttle <span className="tabular-nums text-white">{Math.round(controls.throttle * 100)}%</span>
          </span>
        }
        min={0}
        max={1}
        step={0.01}
        value={controls.throttle}
        onChange={(v) => store.setThrottle(v)}
      />

      <Slider
        ariaLabel="Road grade"
        label={
          <span className="flex items-center justify-between gap-2">
            <span>
              Grade <span className="tabular-nums text-white">{controls.gradePercent.toFixed(1)}%</span>
            </span>
            <InclineGlyph gradePercent={controls.gradePercent} />
          </span>
        }
        min={0}
        max={15}
        step={0.5}
        value={controls.gradePercent}
        onChange={(v) => store.setGrade(v)}
      />

      <div className="grid grid-cols-1 gap-3 border-t border-slate-800 pt-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <Segmented
          label={<span className="text-ice">ICE gearbox</span>}
          options={GEARBOX_OPTIONS}
          value={controls.iceGearMode}
          onChange={(v) => store.setIceGearMode(v)}
        />
        <Segmented
          label={<span className="text-ice">ICE launch</span>}
          options={CLUTCH_OPTIONS}
          value={controls.iceClutchMode}
          onChange={(v) => store.setIceClutchMode(v)}
        />
        <label className="flex items-center gap-2 text-slate-300 sm:col-span-2 lg:col-span-1 lg:pb-1">
          <input
            type="checkbox"
            className="accent-cyan-400"
            checked={controls.fieldWeakening}
            onChange={(e) => store.setFieldWeakening(e.target.checked)}
          />
          <span>
            <span className="text-ev">EV</span> field weakening above 4,500 rpm
          </span>
        </label>
      </div>
    </div>
  );
}
