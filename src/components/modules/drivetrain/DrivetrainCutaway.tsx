import { useMemo, useRef } from 'react';
import { ICE_FINAL_DRIVE, type GearSelector, type UiSnapshot } from '../../../physics';
import { formatInt, setAttr, setText } from '../../shared/format';
import { useFrameRenderer } from './frameContext';
import {
  ICE_GEAR_TEETH,
  ICE_REVERSE_TEETH,
  gearPath,
  meshedAngle,
  moduleForCentreDistance,
  pitchRadius,
  toDeg,
  type GearPair,
} from './gearGeometry';
import { heatColor } from './heatColor';

// --- Layout (viewBox units) -------------------------------------------------
const VB_W = 800;
const VB_H = 384;
/** Crankshaft / clutch / gearbox-input axis. */
const AXIS_Y = 240;
const CYL_X = [55, 115, 175, 235] as const;
const BORE = 46;
const CRANK_R = 24;
const ROD_L = 80;
const HEAD_Y = 96;
const PISTON_H = 26;
const PIN_FROM_TOP = 17;
/** Firing order 1-3-4-2: delay of each cylinder's power stroke in the 4π cycle. */
const FIRING_DELAY = [0, 3 * Math.PI, Math.PI, 2 * Math.PI] as const;
const STROKES = ['POWER', 'EXHAUST', 'INTAKE', 'COMPRESS'] as const;
const FLYWHEEL_X = 284;
const DISC_X = 304;
const PLATE_X = 316;
const GEAR_IN_X = 520;
const CENTRE_DISTANCE = 140;
const GEAR_OUT_X = GEAR_IN_X + CENTRE_DISTANCE;
const PEAK_TORQUE = 360;

function mod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

interface CylinderRefs {
  piston: SVGGElement | null;
  rod: SVGLineElement | null;
  throw: SVGLineElement | null;
  pin: SVGCircleElement | null;
  chamber: SVGRectElement | null;
  stroke: SVGTextElement | null;
}

function pairFor(selector: GearSelector, gear: number): GearPair {
  if (selector === 'R') return ICE_REVERSE_TEETH;
  return ICE_GEAR_TEETH[Math.min(Math.max(gear, 1), 6) - 1] ?? ICE_GEAR_TEETH[0]!;
}

export function DrivetrainCutaway({ ui }: { ui: UiSnapshot }) {
  const selector = ui.controls.gearSelector;
  const engaged = selector === 'D' || selector === 'R';
  const pair = pairFor(selector, ui.ice.gear);
  const module = moduleForCentreDistance(CENTRE_DISTANCE, pair);
  const ratio = pair.driven / pair.driver;
  const paths = useMemo(
    () => ({ input: gearPath(pair.driver, module), output: gearPath(pair.driven, module) }),
    [pair, module],
  );

  const cyl = useRef<CylinderRefs[]>(CYL_X.map(() => ({ piston: null, rod: null, throw: null, pin: null, chamber: null, stroke: null })));
  const r = useRef({
    flyEdge: null as SVGLineElement | null,
    disc: null as SVGGElement | null,
    discFace: null as SVGRectElement | null,
    discEdge: null as SVGLineElement | null,
    sparks: null as SVGGElement | null,
    inputGear: null as SVGGElement | null,
    outputGear: null as SVGGElement | null,
    engineRpm: null as SVGTSpanElement | null,
    inputRpm: null as SVGTSpanElement | null,
    outputRpm: null as SVGTSpanElement | null,
    clutchLabel: null as SVGTSpanElement | null,
  });
  const heldOutputAngle = useRef(0);
  // Values the renderer needs from the latest React render.
  const geom = useRef({ pair, engaged, ratio });
  geom.current = { pair, engaged, ratio };

  useFrameRenderer((state, angles) => {
    const { ice } = state;
    const torqueFrac = Math.max(0, ice.engineTorqueNm) / PEAK_TORQUE;

    // Reciprocating assembly: exact slider-crank kinematics per cylinder.
    CYL_X.forEach((cx, i) => {
      const c = cyl.current[i];
      if (!c) return;
      const cycle = mod(angles.crank - FIRING_DELAY[i]!, 4 * Math.PI);
      const phi = cycle % (2 * Math.PI);
      const sin = Math.sin(phi);
      const cos = Math.cos(phi);
      const pinX = cx + CRANK_R * sin;
      const pinY = AXIS_Y - CRANK_R * cos;
      const wristY = AXIS_Y - (CRANK_R * cos + Math.sqrt(ROD_L * ROD_L - CRANK_R * CRANK_R * sin * sin));
      const pistonTop = wristY - PIN_FROM_TOP;
      setAttr(c.piston, 'transform', `translate(0 ${pistonTop.toFixed(2)})`);
      setAttr(c.rod, 'x1', pinX.toFixed(2));
      setAttr(c.rod, 'y1', pinY.toFixed(2));
      setAttr(c.rod, 'y2', wristY.toFixed(2));
      setAttr(c.throw, 'x2', pinX.toFixed(2));
      setAttr(c.throw, 'y2', pinY.toFixed(2));
      setAttr(c.pin, 'cx', pinX.toFixed(2));
      setAttr(c.pin, 'cy', pinY.toFixed(2));
      setAttr(c.chamber, 'height', Math.max(0, pistonTop - HEAD_Y).toFixed(2));
      const strokeIndex = Math.min(3, Math.floor(cycle / Math.PI));
      const glow = strokeIndex === 0 && !ice.isStalled ? torqueFrac * (1 - cycle / Math.PI) : 0;
      setAttr(c.chamber, 'opacity', (0.08 + 0.85 * glow).toFixed(3));
      setText(c.stroke, ice.engineRpm < 1 ? '—' : STROKES[strokeIndex]!);
    });

    // Flywheel (crank speed) vs clutch disc (input-shaft speed): edge marks
    // scroll at each part's own surface speed, so slip is visible.
    setAttr(r.current.flyEdge, 'stroke-dashoffset', (-angles.crank * 90).toFixed(1));
    setAttr(r.current.discEdge, 'stroke-dashoffset', (-angles.input * 70).toFixed(1));
    setAttr(r.current.disc, 'transform', ice.clutchState === 'open' ? 'translate(7 0)' : 'translate(0 0)');
    setAttr(r.current.discFace, 'fill', heatColor(ice.clutchTempC));
    const slipping = ice.clutchState === 'slipping';
    setAttr(r.current.sparks, 'opacity', slipping ? (0.45 + 0.55 * Math.abs(Math.sin(angles.crank * 7))).toFixed(2) : '0');
    setText(r.current.clutchLabel, ice.clutchState.toUpperCase());

    // Gear pair: driven angle derived from the driver — exact mesh.
    const g = geom.current;
    setAttr(r.current.inputGear, 'transform', `rotate(${toDeg(angles.input)})`);
    if (g.engaged) heldOutputAngle.current = meshedAngle(angles.input, g.pair.driver, g.pair.driven, 0);
    setAttr(r.current.outputGear, 'transform', `rotate(${toDeg(heldOutputAngle.current)})`);

    setText(r.current.engineRpm, formatInt(ice.engineRpm));
    setText(r.current.inputRpm, formatInt(ice.inputShaftRpm));
    setText(r.current.outputRpm, g.engaged ? formatInt(ice.inputShaftRpm / g.ratio) : '0');
  });

  const ri = pitchRadius(module, pair.driver);
  const ro = pitchRadius(module, pair.driven);
  const gearLabel = selector === 'R' ? 'R' : selector !== 'D' ? selector : ui.ice.isShifting ? `${ui.ice.gear}→${ui.ice.gear + 1}` : String(ui.ice.gear);

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="block h-auto w-full" role="img" aria-label="ICE drivetrain cutaway: four-cylinder engine, clutch and gearbox">
      <defs>
        <linearGradient id="dt-steel" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#475569" />
        </linearGradient>
      </defs>

      {/* ---------------- Engine block ---------------- */}
      <text x={20} y={24} className="fill-ice text-[13px] font-bold" fontFamily="ui-monospace, monospace">ENGINE · I4 · firing 1-3-4-2</text>
      <rect x={20} y={HEAD_Y - 22} width={252} height={22} rx={4} className="fill-slate-700" />
      <rect x={20} y={AXIS_Y - 14} width={252} height={110} rx={10} className="fill-slate-900 stroke-slate-700" />
      {CYL_X.map((cx, i) => (
        <g key={cx}>
          {/* Cylinder bore */}
          <rect x={cx - BORE / 2 - 4} y={HEAD_Y} width={BORE + 8} height={118} className="fill-slate-800" />
          <rect x={cx - BORE / 2} y={HEAD_Y} width={BORE} height={118} className="fill-slate-950" />
          {/* Combustion chamber glow (height follows the piston) */}
          <rect
            ref={(el) => { cyl.current[i]!.chamber = el; }}
            x={cx - BORE / 2}
            y={HEAD_Y}
            width={BORE}
            height={20}
            className="fill-orange-500"
            opacity={0.08}
          />
          {/* Spark plug */}
          <rect x={cx - 3} y={HEAD_Y - 30} width={6} height={12} rx={1} className="fill-slate-400" />
          {/* Connecting rod, crank throw, crank pin */}
          <line ref={(el) => { cyl.current[i]!.throw = el; }} x1={cx} y1={AXIS_Y} x2={cx} y2={AXIS_Y - CRANK_R} className="stroke-slate-400" strokeWidth={9} strokeLinecap="round" />
          <line ref={(el) => { cyl.current[i]!.rod = el; }} x1={cx} y1={AXIS_Y - CRANK_R} x2={cx} y2={AXIS_Y - CRANK_R - ROD_L} className="stroke-slate-300" strokeWidth={6} strokeLinecap="round" />
          <circle ref={(el) => { cyl.current[i]!.pin = el; }} cx={cx} cy={AXIS_Y - CRANK_R} r={4.5} className="fill-slate-200" />
          {/* Piston (moves via transform; drawn with its top at local y = 0) */}
          <g ref={(el) => { cyl.current[i]!.piston = el; }} transform={`translate(0 ${AXIS_Y - CRANK_R - ROD_L - PIN_FROM_TOP})`}>
            <rect x={cx - BORE / 2 + 1} y={0} width={BORE - 2} height={PISTON_H} rx={3} fill="url(#dt-steel)" />
            <line x1={cx - BORE / 2 + 1} x2={cx + BORE / 2 - 1} y1={5} y2={5} className="stroke-slate-600" />
            <line x1={cx - BORE / 2 + 1} x2={cx + BORE / 2 - 1} y1={9} y2={9} className="stroke-slate-600" />
            <circle cx={cx} cy={PIN_FROM_TOP} r={3.5} className="fill-slate-700" />
          </g>
          <text x={cx} y={HEAD_Y - 38} textAnchor="middle" className="fill-slate-500 text-[11px]" fontFamily="ui-monospace, monospace">#{i + 1}</text>
          <text
            ref={(el) => { cyl.current[i]!.stroke = el; }}
            x={cx}
            y={AXIS_Y + 82}
            textAnchor="middle"
            className="fill-slate-400 text-[10px]"
            fontFamily="ui-monospace, monospace"
          />
        </g>
      ))}
      {/* Crankshaft main journal */}
      <line x1={22} x2={FLYWHEEL_X} y1={AXIS_Y} y2={AXIS_Y} className="stroke-slate-400" strokeWidth={8} strokeLinecap="round" />
      <text x={30} y={AXIS_Y + 64} className="fill-slate-400 text-[12px]" fontFamily="ui-monospace, monospace">
        crank <tspan ref={(el) => { r.current.engineRpm = el; }} className="fill-ice font-bold">0</tspan> rpm
      </text>

      {/* ---------------- Flywheel + clutch ---------------- */}
      <text x={FLYWHEEL_X - 6} y={24} className="fill-slate-300 text-[13px] font-bold" fontFamily="ui-monospace, monospace">CLUTCH</text>
      <text x={FLYWHEEL_X - 6} y={40} className="text-[12px]" fontFamily="ui-monospace, monospace">
        <tspan ref={(el) => { r.current.clutchLabel = el; }} className="fill-amber-300">OPEN</tspan>
      </text>
      <path
        d={`M${FLYWHEEL_X - 10} ${AXIS_Y - 112} L${PLATE_X + 40} ${AXIS_Y - 100} L${PLATE_X + 40} ${AXIS_Y + 100} L${FLYWHEEL_X - 10} ${AXIS_Y + 112}`}
        fill="none"
        className="stroke-slate-700"
        strokeDasharray="4 4"
      />
      <rect x={FLYWHEEL_X} y={AXIS_Y - 92} width={18} height={184} rx={3} fill="url(#dt-steel)" />
      <line
        ref={(el) => { r.current.flyEdge = el; }}
        x1={FLYWHEEL_X + 18}
        x2={FLYWHEEL_X + 18}
        y1={AXIS_Y - 90}
        y2={AXIS_Y + 90}
        className="stroke-slate-950"
        strokeWidth={3}
        strokeDasharray="10 8"
      />
      <g ref={(el) => { r.current.disc = el; }}>
        <rect ref={(el) => { r.current.discFace = el; }} x={DISC_X} y={AXIS_Y - 72} width={9} height={144} rx={2} fill="rgb(30,58,138)" />
        <line
          ref={(el) => { r.current.discEdge = el; }}
          x1={DISC_X + 9}
          x2={DISC_X + 9}
          y1={AXIS_Y - 70}
          y2={AXIS_Y + 70}
          className="stroke-slate-950"
          strokeWidth={2}
          strokeDasharray="8 10"
        />
        <rect x={PLATE_X} y={AXIS_Y - 80} width={12} height={160} rx={2} className="fill-slate-500" />
        <path d={`M${PLATE_X + 12} ${AXIS_Y - 70} Q${PLATE_X + 30} ${AXIS_Y} ${PLATE_X + 12} ${AXIS_Y + 70}`} fill="none" className="stroke-slate-400" strokeWidth={3} />
        <g ref={(el) => { r.current.sparks = el; }} opacity={0}>
          {[-60, -30, 0, 30, 60].map((dy) => (
            <path key={dy} d={`M${DISC_X - 2} ${AXIS_Y + dy} l-6 -4 m6 4 l-7 3 m7 -3 l-5 7`} className="stroke-amber-300" strokeWidth={1.5} />
          ))}
        </g>
      </g>

      {/* Input shaft */}
      <line x1={PLATE_X + 12} x2={GEAR_IN_X} y1={AXIS_Y} y2={AXIS_Y} className="stroke-slate-400" strokeWidth={7} />
      <text x={PLATE_X + 22} y={AXIS_Y + 24} className="fill-slate-400 text-[11px]" fontFamily="ui-monospace, monospace">
        input <tspan ref={(el) => { r.current.inputRpm = el; }} className="fill-slate-100 font-bold">0</tspan> rpm
      </text>

      {/* ---------------- Gearbox ---------------- */}
      <rect x={GEAR_IN_X - 100} y={AXIS_Y - 132} width={VB_W - (GEAR_IN_X - 100) - 6} height={272} rx={14} fill="none" className="stroke-slate-700" strokeDasharray="6 5" />
      <text x={GEAR_IN_X - 90} y={24} className="fill-slate-300 text-[13px] font-bold" fontFamily="ui-monospace, monospace">
        GEARBOX · {gearLabel === 'R' ? 'reverse 34:10 (idler: Module 4)' : `gear ${gearLabel} · ${pair.driven}:${pair.driver} = ${ratio.toFixed(1)}:1`}
      </text>
      <text x={GEAR_IN_X - 90} y={40} className="fill-slate-500 text-[12px]" fontFamily="ui-monospace, monospace">
        then final drive {ICE_FINAL_DRIVE}:1 → wheels
      </text>

      <g transform={`translate(${GEAR_IN_X} ${AXIS_Y})`} opacity={ui.ice.isShifting ? 0.55 : 1}>
        <g ref={(el) => { r.current.inputGear = el; }}>
          <path d={paths.input} className="fill-slate-500 stroke-slate-300" strokeWidth={1} />
          <circle r={Math.max(6, ri * 0.35)} className="fill-slate-700" />
          {/* Keyway marker makes rotation readable */}
          <rect x={ri * 0.35 - 4} y={-2.5} width={Math.max(6, ri * 0.4)} height={5} className="fill-amber-400" />
        </g>
        <circle r={7} className="fill-slate-300" />
      </g>
      <g transform={`translate(${GEAR_OUT_X} ${AXIS_Y})`} opacity={engaged ? (ui.ice.isShifting ? 0.55 : 1) : 0.3}>
        <g ref={(el) => { r.current.outputGear = el; }}>
          <path d={paths.output} className="fill-ice/80 stroke-orange-200" strokeWidth={1} />
          <circle r={Math.max(8, ro * 0.3)} className="fill-slate-800" />
        </g>
        <circle r={7} className="fill-slate-300" />
      </g>
      <text x={GEAR_OUT_X} y={AXIS_Y + 136} textAnchor="middle" className="fill-slate-400 text-[12px]" fontFamily="ui-monospace, monospace">
        output <tspan ref={(el) => { r.current.outputRpm = el; }} className="fill-ice font-bold">0</tspan> rpm
      </text>
      {ui.ice.isShifting && (
        <text x={(GEAR_IN_X + GEAR_OUT_X) / 2} y={AXIS_Y - 118} textAnchor="middle" className="animate-pulse fill-red-400 text-[13px] font-bold" fontFamily="ui-monospace, monospace">
          SYNCHRO · CLUTCH OPEN · 0 Nm
        </text>
      )}
      {!engaged && (
        <text x={(GEAR_IN_X + GEAR_OUT_X) / 2} y={AXIS_Y - 118} textAnchor="middle" className="fill-slate-400 text-[13px]" fontFamily="ui-monospace, monospace">
          {selector === 'P' ? 'PARK — pawl locks output' : 'NEUTRAL — no gear engaged'}
        </text>
      )}
    </svg>
  );
}
