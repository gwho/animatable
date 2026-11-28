/**
 * Module 2 — Drivetrain Cutaway & Launch Stall Simulator.
 *
 * One rAF loop for the whole module: it advances the display kinematics once
 * per frame and hands the live state to every registered imperative renderer
 * (cutaway, gauge, heatmap, torque flow, EV gears). React itself re-renders
 * only on discrete changes: controls, gear, shift, stall, display speed.
 */
import { useCallback, useRef, useState } from 'react';
import type { SimulationControls } from '../../physics';
import { simulationStore as store } from '../../app/simulation';
import { useAnimationFrame } from '../../hooks/useAnimationFrame';
import { useUiSnapshot } from '../../hooks/useUiSnapshot';
import { ControlHeader } from '../shared/ControlHeader';
import { Panel, Segmented } from '../ui/controls';
import { DisplayKinematics } from './drivetrain/displayKinematics';
import { DrivetrainCutaway } from './drivetrain/DrivetrainCutaway';
import { FrameRegistryContext, type FrameRenderer } from './drivetrain/frameContext';
import { LaunchPanel } from './drivetrain/LaunchPanel';
import { EvReductionGears, TorqueFlow } from './drivetrain/TorqueFlow';

const DISPLAY_SPEEDS = [
  { value: '1', label: 'Real' },
  { value: '0.2', label: '⅕×' },
  { value: '0.05', label: '1/20×' },
  { value: '0.0167', label: '1/60×' },
] as const;
type DisplaySpeed = (typeof DISPLAY_SPEEDS)[number]['value'];

interface Scenario {
  id: string;
  title: string;
  detail: string;
  controls: Partial<SimulationControls>;
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'dump-4th',
    title: 'Dump clutch in 4th',
    detail: 'Locked clutch at 0 km/h: wheels pin the crank at 0 rpm → instant stall.',
    controls: { iceGearMode: 'locked-4th', iceClutchMode: 'locked-clutch', throttle: 1, gradePercent: 0, gearSelector: 'D' },
  },
  {
    id: 'slip-1st',
    title: 'Slip-launch in 1st',
    detail: 'Engine held at ~2,800 rpm, clutch locks within ~1 s. Mild heating.',
    controls: { iceGearMode: 'auto', iceClutchMode: 'auto-slip', throttle: 1, gradePercent: 0, gearSelector: 'D' },
  },
  {
    id: 'slip-4th',
    title: 'Slip-launch in 4th',
    detail: '4.55:1 instead of 13.3:1: the clutch slips for many seconds and cooks.',
    controls: { iceGearMode: 'locked-4th', iceClutchMode: 'auto-slip', throttle: 1, gradePercent: 0, gearSelector: 'D' },
  },
  {
    id: 'hill-dump',
    title: 'Hill start, dump clutch (12%)',
    detail: 'Stall, then gravity rolls the ICE back. The EV just drives away.',
    controls: { iceGearMode: 'auto', iceClutchMode: 'locked-clutch', throttle: 0.6, gradePercent: 12, gearSelector: 'D' },
  },
];

export function DrivetrainSimulator() {
  const ui = useUiSnapshot();
  const active = ui.activeModule === 'drivetrain';
  const [displaySpeed, setDisplaySpeed] = useState<DisplaySpeed>('0.05');
  const speedRef = useRef(Number(displaySpeed));
  speedRef.current = Number(displaySpeed);

  const renderers = useRef(new Set<FrameRenderer>());
  const kinematics = useRef(new DisplayKinematics());
  const register = useCallback((fn: FrameRenderer) => {
    renderers.current.add(fn);
    return () => {
      renderers.current.delete(fn);
    };
  }, []);

  useAnimationFrame(() => {
    const state = store.getMutableState();
    const angles = kinematics.current.update(state, speedRef.current);
    for (const render of renderers.current) render(state, angles);
  }, active);

  const runScenario = (s: Scenario): void => {
    store.pause();
    store.reset();
    store.setControls(s.controls);
    store.play();
  };

  return (
    <FrameRegistryContext.Provider value={register}>
      <div className="flex min-w-0 flex-col gap-4">
        <ControlHeader ui={ui} />

        <section aria-label="Launch scenarios" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => runScenario(s)}
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:border-slate-600 hover:bg-slate-800/60"
            >
              <div className="text-sm font-semibold text-white">▶ {s.title}</div>
              <div className="mt-1 text-[11px] leading-snug text-slate-400">{s.detail}</div>
            </button>
          ))}
        </section>

        <Panel
          title="ICE drivetrain cutaway"
          accent="text-ice"
          aside={
            <div className="w-full max-w-xs sm:w-72">
              <Segmented
                label={<span className="text-[11px] text-slate-400">Animation speed (visual only; physics stays real-time)</span>}
                options={DISPLAY_SPEEDS}
                value={displaySpeed}
                onChange={setDisplaySpeed}
              />
            </div>
          }
        >
          <DrivetrainCutaway ui={ui} />
          <p className="text-[11px] leading-relaxed text-slate-500">
            Edge marks on the flywheel and clutch disc scroll at each part&apos;s own surface speed. When they move at
            different rates, the clutch is slipping and turning that speed difference into heat. Gear teeth stay in exact
            mesh: ω<sub>out</sub> = −ω<sub>in</sub>·N<sub>in</sub>/N<sub>out</sub>.
          </p>
        </Panel>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel title="Launch & stall · clutch thermal load" accent="text-ice">
            <LaunchPanel ui={ui} />
          </Panel>
          <Panel title="EV · motor + 9.0:1 reduction" accent="text-ev">
            <EvReductionGears />
            <p className="text-[11px] leading-relaxed text-slate-500">
              Dashed = stage-1 gear on the rear plane of the compound intermediate shaft. Two helical stages, 39:13 × 39:13 = 9.0:1. With no clutch and no shifts, the motor is coupled to the wheels from
              0 rpm, so it can&apos;t stall and the launch dumps no heat into a clutch.
            </p>
          </Panel>
        </div>

        <Panel title="Torque multiplication, stage by stage">
          <TorqueFlow ui={ui} />
        </Panel>
      </div>
    </FrameRegistryContext.Provider>
  );
}
