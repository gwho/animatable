import { useMemo, useRef, type ReactNode } from 'react';
import {
  EV_DRIVETRAIN_EFFICIENCY,
  EV_POLE_PAIRS,
  EV_REDUCTION_RATIO,
  ICE_DRIVETRAIN_EFFICIENCY,
  ICE_FINAL_DRIVE,
  ICE_REVERSE_RATIO,
  getIceGearRatio,
  type UiSnapshot,
} from '../../../physics';
import { formatInt, setAttr, setText } from '../../shared/format';
import { useFrameRenderer } from './frameContext';
import { EV_STAGE_TEETH, gearPath, meshedAngle, moduleForCentreDistance, pitchRadius, toDeg } from './gearGeometry';

type FlowKey =
  | 'iceEngine' | 'iceClutch' | 'iceGearbox' | 'iceFinal' | 'iceWheel' | 'iceClutchNote'
  | 'evMotor' | 'evReduction' | 'evWheel';

/** Torque path, stage by stage, so learners see where multiplication happens. */
export function TorqueFlow({ ui }: { ui: UiSnapshot }) {
  const fields = useRef<Partial<Record<FlowKey, HTMLElement | null>>>({});
  const bind = (k: FlowKey) => (el: HTMLElement | null) => {
    fields.current[k] = el;
  };
  const selector = ui.controls.gearSelector;
  const gearRatio = selector === 'R' ? ICE_REVERSE_RATIO : getIceGearRatio(ui.ice.gear);
  const engaged = selector === 'D' || selector === 'R';
  const ratioRef = useRef({ gearRatio, engaged });
  ratioRef.current = { gearRatio, engaged };

  useFrameRenderer((state) => {
    const { ice, ev } = state;
    const f = fields.current;
    const { gearRatio: g, engaged: on } = ratioRef.current;
    const transmitting = on && !ice.isStalled && (ice.clutchState === 'locked' || ice.clutchState === 'slipping');
    const clutchNm = transmitting ? ice.engineTorqueNm : 0;
    setText(f.iceEngine, formatInt(ice.engineTorqueNm));
    setText(f.iceClutch, formatInt(clutchNm));
    setText(f.iceClutchNote, ice.isStalled ? 'stalled' : ice.isShifting ? 'open · shift' : on ? ice.clutchState : 'neutral');
    setText(f.iceGearbox, formatInt(clutchNm * g));
    setText(f.iceFinal, formatInt(clutchNm * g * ICE_FINAL_DRIVE));
    setText(f.iceWheel, formatInt(Math.abs(ice.wheelTorqueNm)));
    setText(f.evMotor, formatInt(ev.motorTorqueNm));
    setText(f.evReduction, formatInt(ev.motorTorqueNm * EV_REDUCTION_RATIO));
    setText(f.evWheel, formatInt(Math.abs(ev.wheelTorqueNm)));
  });

  const gearLabel = selector === 'R' ? 'R' : ui.ice.gear;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FlowRow accent="ice" label="ICE">
        <Stage title="Engine" unit="Nm" bind={bind('iceEngine')} />
        <Arrow />
        <Stage title="Clutch" unit="Nm" bind={bind('iceClutch')} note={<span ref={bind('iceClutchNote')} />} />
        <Arrow op={`× ${gearRatio.toFixed(1)}`} sub={`gear ${gearLabel}`} />
        <Stage title="Gearbox out" unit="Nm" bind={bind('iceGearbox')} />
        <Arrow op={`× ${ICE_FINAL_DRIVE}`} sub="final drive" />
        <Stage title="Diff" unit="Nm" bind={bind('iceFinal')} />
        <Arrow op={`× ${ICE_DRIVETRAIN_EFFICIENCY}`} sub="η losses" />
        <Stage title="Wheels" unit="Nm" bind={bind('iceWheel')} strong />
      </FlowRow>
      <FlowRow accent="ev" label="EV">
        <Stage title="Motor" unit="Nm" bind={bind('evMotor')} note="no clutch" />
        <Arrow op={`× ${EV_REDUCTION_RATIO.toFixed(1)}`} sub="2-stage helical" />
        <Stage title="Reduction out" unit="Nm" bind={bind('evReduction')} />
        <Arrow op={`× ${EV_DRIVETRAIN_EFFICIENCY}`} sub="η losses" />
        <Stage title="Wheels" unit="Nm" bind={bind('evWheel')} strong />
      </FlowRow>
    </div>
  );
}

function FlowRow({ accent, label, children }: { accent: 'ice' | 'ev'; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-stretch gap-2">
      <div className={`flex w-10 shrink-0 items-center justify-center rounded text-xs font-bold ${accent === 'ice' ? 'bg-ice/15 text-ice' : 'bg-ev/15 text-ev'}`}>
        {label}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Stage({ title, unit, bind, note, strong = false }: { title: string; unit: string; bind: (el: HTMLElement | null) => void; note?: ReactNode; strong?: boolean }) {
  return (
    <div className={`min-w-[84px] rounded-md border px-2 py-1 tabular-nums ${strong ? 'border-slate-500 bg-slate-800' : 'border-slate-800 bg-slate-950/60'}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{title}</div>
      <div className={`${strong ? 'text-lg' : 'text-base'} font-semibold text-white`}>
        <span ref={bind}>0</span> <span className="text-[10px] font-normal text-slate-500">{unit}</span>
      </div>
      {note !== undefined && <div className="text-[10px] text-slate-400">{note}</div>}
    </div>
  );
}

function Arrow({ op, sub }: { op?: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center px-0.5 text-center leading-tight">
      {op && <span className="text-xs font-semibold text-amber-300">{op}</span>}
      <span className="text-slate-500">→</span>
      {sub && <span className="text-[9px] text-slate-500">{sub}</span>}
    </div>
  );
}

// --- EV reduction gear train -------------------------------------------------
const EV_CENTRE = 92;
const MOTOR_X = 92;
const MOTOR_Y = 96;
const INTER_X = MOTOR_X + EV_CENTRE;
/** Stage 2 meshes straight down from the intermediate shaft. */
const STAGE2_CONTACT = Math.PI / 2;
const OUT_X = INTER_X;
const OUT_Y = MOTOR_Y + EV_CENTRE;

/** Motor + two-stage 9.0:1 reduction with exact meshing (compound intermediate shaft). */
export function EvReductionGears() {
  const [s1, s2] = EV_STAGE_TEETH;
  const geo = useMemo(() => {
    const m1 = moduleForCentreDistance(EV_CENTRE, s1);
    const m2 = moduleForCentreDistance(EV_CENTRE, s2);
    return {
      m1, m2,
      pinion1: gearPath(s1.driver, m1),
      wheel1: gearPath(s1.driven, m1),
      pinion2: gearPath(s2.driver, m2),
      wheel2: gearPath(s2.driven, m2),
    };
  }, [s1, s2]);
  const r = useRef({
    rotor: null as SVGGElement | null,
    pinion1: null as SVGGElement | null,
    inter: null as SVGGElement | null,
    wheel2: null as SVGGElement | null,
    motorRpm: null as SVGTSpanElement | null,
    outRpm: null as SVGTSpanElement | null,
    seq: null as SVGTSpanElement | null,
  });

  useFrameRenderer((state, angles) => {
    const motor = angles.evMotor;
    const inter = meshedAngle(motor, s1.driver, s1.driven, 0);
    const out = meshedAngle(inter, s2.driver, s2.driven, STAGE2_CONTACT);
    setAttr(r.current.rotor, 'transform', `rotate(${toDeg(motor)})`);
    setAttr(r.current.pinion1, 'transform', `rotate(${toDeg(motor)})`);
    setAttr(r.current.inter, 'transform', `rotate(${toDeg(inter)})`);
    setAttr(r.current.wheel2, 'transform', `rotate(${toDeg(out)})`);
    setText(r.current.motorRpm, formatInt(Math.abs(state.ev.motorRpm)));
    setText(r.current.outRpm, formatInt(Math.abs(state.ev.motorRpm) / EV_REDUCTION_RATIO));
    setText(r.current.seq, state.ev.phaseSequence);
  });

  const poles = EV_POLE_PAIRS * 2;
  const rp1 = pitchRadius(geo.m1, s1.driver);

  return (
    <svg viewBox="0 0 330 300" className="mx-auto block h-auto w-full max-w-[360px]" role="img" aria-label="EV motor and two-stage reduction gears">
      {/* Motor stator + rotor magnets (behind the stage-1 pinion) */}
      <circle cx={MOTOR_X} cy={MOTOR_Y} r={66} className="fill-slate-900 stroke-slate-700" strokeWidth={10} />
      <g transform={`translate(${MOTOR_X} ${MOTOR_Y})`}>
        <g ref={(el) => { r.current.rotor = el; }}>
          {Array.from({ length: poles }, (_, k) => {
            const a0 = (2 * Math.PI * k) / poles;
            const a1 = (2 * Math.PI * (k + 1)) / poles;
            const ro = 54;
            const ri = rp1 + 6;
            const p = (rad: number, a: number): string => `${(rad * Math.cos(a)).toFixed(2)} ${(rad * Math.sin(a)).toFixed(2)}`;
            return (
              <path
                key={k}
                d={`M${p(ri, a0)} L${p(ro, a0)} A${ro} ${ro} 0 0 1 ${p(ro, a1)} L${p(ri, a1)} A${ri} ${ri} 0 0 0 ${p(ri, a0)} Z`}
                className={k % 2 === 0 ? 'fill-red-500/70' : 'fill-blue-500/70'}
              />
            );
          })}
        </g>
        <g ref={(el) => { r.current.pinion1 = el; }}>
          <path d={geo.pinion1} className="fill-slate-400 stroke-slate-200" strokeWidth={0.8} />
          <rect x={2} y={-2} width={8} height={4} className="fill-amber-400" />
        </g>
        <circle r={4} className="fill-slate-200" />
      </g>

      {/* Compound intermediate shaft: 39T (stage 1, rear) + 13T (stage 2, front) */}
      <g transform={`translate(${INTER_X} ${MOTOR_Y})`}>
        <g ref={(el) => { r.current.inter = el; }}>
          <path d={geo.wheel1} className="fill-slate-600/35 stroke-slate-400" strokeWidth={0.8} strokeDasharray="3 2" />
          <circle r={pitchRadius(geo.m1, s1.driven) * 0.45} className="fill-slate-800" />
          <path d={geo.pinion2} className="fill-slate-400 stroke-slate-100" strokeWidth={0.8} />
        </g>
        <circle r={4} className="fill-slate-200" />
      </g>

      {/* Output gear → differential (front plane) */}
      <g transform={`translate(${OUT_X} ${OUT_Y})`}>
        <g ref={(el) => { r.current.wheel2 = el; }} opacity={0.85}>
          <path d={geo.wheel2} className="fill-ev/70 stroke-cyan-100" strokeWidth={0.8} />
          <circle r={pitchRadius(geo.m2, s2.driven) * 0.45} className="fill-slate-900" />
        </g>
        <circle r={5} className="fill-slate-200" />
      </g>

      <text x={8} y={18} className="fill-ev text-[12px] font-bold" fontFamily="ui-monospace, monospace">PMSM · 4 pole pairs</text>
      <text x={8} y={186} className="fill-slate-400 text-[11px]" fontFamily="ui-monospace, monospace">
        rotor <tspan ref={(el) => { r.current.motorRpm = el; }} className="fill-ev font-bold">0</tspan> rpm
      </text>
      <text x={8} y={202} className="fill-slate-500 text-[11px]" fontFamily="ui-monospace, monospace">
        phase seq <tspan ref={(el) => { r.current.seq = el; }} className="fill-slate-300">ABC</tspan>
      </text>
      <text x={OUT_X} y={292} textAnchor="middle" className="fill-slate-400 text-[11px]" fontFamily="ui-monospace, monospace">
        output <tspan ref={(el) => { r.current.outRpm = el; }} className="fill-ev font-bold">0</tspan> rpm
      </text>
    </svg>
  );
}
