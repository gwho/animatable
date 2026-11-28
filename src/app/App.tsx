import { useRef, type ReactNode } from 'react';
import type { GearSelector, IceClutchMode, IceGearMode, ModuleId } from '../physics';
import { useAnimationFrame } from '../hooks/useAnimationFrame';
import { useUiSnapshot } from '../hooks/useUiSnapshot';
import { simulationStore as store } from './simulation';

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'drag-strip', label: 'Drag Strip & Torque Curves' },
  { id: 'drivetrain', label: 'Drivetrain & Launch Stall' },
  { id: 'magnetic-field', label: 'Stator Field & Field Weakening' },
  { id: 'reverse', label: 'Reverse: Idler vs Phase Swap' },
];

const SELECTORS: GearSelector[] = ['P', 'R', 'N', 'D'];

/** Telemetry fields written straight into the DOM every frame (no React state). */
type TelemetryKey =
  | 'iceSpeed' | 'iceRpm' | 'iceTorque' | 'iceDist' | 'iceClutch' | 'iceTemp'
  | 'evSpeed' | 'evRpm' | 'evTorque' | 'evDist' | 'evEmf' | 'evId' | 'time';

export function App() {
  const ui = useUiSnapshot();
  const fields = useRef<Partial<Record<TelemetryKey, HTMLElement | null>>>({});
  const bind = (key: TelemetryKey) => (el: HTMLElement | null) => {
    fields.current[key] = el;
  };

  useAnimationFrame(() => {
    const { ice, ev, timeS } = store.getMutableState();
    const f = fields.current;
    const set = (key: TelemetryKey, text: string): void => {
      const el = f[key];
      if (el && el.textContent !== text) el.textContent = text;
    };
    set('time', timeS.toFixed(2));
    set('iceSpeed', (ice.velocityMps * 3.6).toFixed(1));
    set('iceRpm', ice.engineRpm.toFixed(0));
    set('iceTorque', ice.engineTorqueNm.toFixed(0));
    set('iceDist', ice.distanceM.toFixed(1));
    set('iceClutch', ice.clutchState);
    set('iceTemp', ice.clutchTempC.toFixed(0));
    set('evSpeed', (ev.velocityMps * 3.6).toFixed(1));
    set('evRpm', ev.motorRpm.toFixed(0));
    set('evTorque', ev.motorTorqueNm.toFixed(0));
    set('evDist', ev.distanceM.toFixed(1));
    set('evEmf', ev.em.backEmfV.toFixed(0));
    set('evId', ev.em.idA.toFixed(0));
  });

  const { controls } = ui;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-4 font-mono text-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <h1 className="text-base font-semibold tracking-wide">
          <span className="text-ice">ICE</span> vs <span className="text-ev">EV</span> Torque &amp; Transmission Workbench
        </h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => (ui.isPlaying ? store.pause() : store.play())}>{ui.isPlaying ? 'Pause' : 'Play'}</Button>
          <Button onClick={() => store.step()}>Step</Button>
          <Button onClick={() => store.reset()}>Reset</Button>
          <span className="text-slate-400">t = <span ref={bind('time')}>0.00</span> s</span>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1">
        {MODULES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => store.setActiveModule(m.id)}
            className={`rounded px-3 py-1.5 ${ui.activeModule === m.id ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <section className="grid gap-4 md:grid-cols-[280px_1fr]">
        <Panel title="Controls">
          <Slider label={`Throttle ${(controls.throttle * 100).toFixed(0)}%`} min={0} max={1} step={0.01}
            value={controls.throttle} onChange={(v) => store.setThrottle(v)} />
          <Slider label={`Grade ${controls.gradePercent.toFixed(1)}%`} min={0} max={15} step={0.5}
            value={controls.gradePercent} onChange={(v) => store.setGrade(v)} />
          <Slider label={`Time scale ×${controls.timeScale.toFixed(2)}`} min={0.1} max={2} step={0.05}
            value={controls.timeScale} onChange={(v) => store.setTimeScale(v)} />
          <Segmented label="Selector" options={SELECTORS} value={controls.gearSelector} onChange={(v) => store.setGearSelector(v)} />
          <Segmented<IceGearMode> label="ICE gearbox" options={['auto', 'locked-4th']} value={controls.iceGearMode}
            onChange={(v) => store.setIceGearMode(v)} />
          <Segmented<IceClutchMode> label="ICE launch" options={['auto-slip', 'locked-clutch']} value={controls.iceClutchMode}
            onChange={(v) => store.setIceClutchMode(v)} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={controls.fieldWeakening} onChange={(e) => store.setFieldWeakening(e.target.checked)} />
            EV field weakening
          </label>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2">
          <Panel title="ICE · 6-speed" accent="text-ice">
            <Row label="Gear">{ui.ice.isShifting ? 'shifting…' : controls.gearSelector === 'D' ? ui.ice.gear : controls.gearSelector}</Row>
            <Row label="Status">{ui.ice.isStalled ? <span className="text-red-400">STALLED</span> : 'running'}</Row>
            <Row label="Speed km/h"><span ref={bind('iceSpeed')} /></Row>
            <Row label="Engine rpm"><span ref={bind('iceRpm')} /></Row>
            <Row label="Engine Nm"><span ref={bind('iceTorque')} /></Row>
            <Row label="Distance m"><span ref={bind('iceDist')} /></Row>
            <Row label="Clutch"><span ref={bind('iceClutch')} /></Row>
            <Row label="Clutch °C"><span ref={bind('iceTemp')} /></Row>
          </Panel>
          <Panel title="EV · 9.0:1 single speed" accent="text-ev">
            <Row label="Speed km/h"><span ref={bind('evSpeed')} /></Row>
            <Row label="Motor rpm"><span ref={bind('evRpm')} /></Row>
            <Row label="Motor Nm"><span ref={bind('evTorque')} /></Row>
            <Row label="Distance m"><span ref={bind('evDist')} /></Row>
            <Row label="Back-EMF V"><span ref={bind('evEmf')} /></Row>
            <Row label="I_d A"><span ref={bind('evId')} /></Row>
          </Panel>
        </div>
      </section>

      <p className="text-slate-500">
        Module visualisations land here next. Physics core: <code>src/physics/</code> — fixed 60 Hz timestep, zero React imports.
      </p>
    </div>
  );
}

function Button({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded bg-slate-800 px-3 py-1.5 hover:bg-slate-700">
      {children}
    </button>
  );
}

function Panel({ title, accent = 'text-slate-300', children }: { title: string; accent?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className={`text-xs font-semibold uppercase tracking-widest ${accent}`}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between border-b border-slate-800/60 pb-1">
      <span className="text-slate-400">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-slate-300">{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

function Segmented<T extends string>(props: { label: string; options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-slate-300">{props.label}</span>
      <div className="flex gap-1">
        {props.options.map((o) => (
          <button key={o} type="button" onClick={() => props.onChange(o)}
            className={`flex-1 rounded px-2 py-1 ${props.value === o ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
