import { useMemo, useRef } from 'react';
import {
  EV_BASE_RPM,
  EV_MAX_RPM,
  ICE_REDLINE_RPM,
  ICE_STALL_RPM,
  sampleEvCurve,
  sampleIceCurve,
  shaftPowerKw,
  type CurveSample,
  type SimulationControls,
} from '../../../physics';
import { simulationStore as store } from '../../../app/simulation';
import { useAnimationFrame } from '../../../hooks/useAnimationFrame';
import { formatInt, setAttr, setText } from './format';

// Plot geometry in viewBox units (scaled responsively by the SVG).
const W = 1_000;
const H = 430;
const M = { l: 62, r: 66, t: 30, b: 50 } as const;
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;
const RPM_MAX = EV_MAX_RPM;
const TORQUE_MAX = 450;
const POWER_MAX = 250;

const xOf = (rpm: number): number => M.l + (Math.min(Math.max(rpm, 0), RPM_MAX) / RPM_MAX) * PW;
const yTorque = (nm: number): number => M.t + (1 - Math.min(Math.max(nm, 0), TORQUE_MAX) / TORQUE_MAX) * PH;
const yPower = (kw: number): number => M.t + (1 - Math.min(Math.max(kw, 0), POWER_MAX) / POWER_MAX) * PH;

function toPath(samples: readonly CurveSample[], y: (s: CurveSample) => number): string {
  return samples.map((s, i) => `${i === 0 ? 'M' : 'L'}${xOf(s.rpm).toFixed(1)} ${y(s).toFixed(1)}`).join(' ');
}

type Kind = 'ice' | 'ev';

interface TracerRefs {
  vLine: SVGLineElement | null;
  hLine: SVGLineElement | null;
  torqueDot: SVGCircleElement | null;
  powerDot: SVGCircleElement | null;
  label: SVGGElement | null;
  labelRpm: SVGTSpanElement | null;
  labelValues: SVGTSpanElement | null;
  rpm: HTMLElement | null;
  torque: HTMLElement | null;
  power: HTMLElement | null;
  region: HTMLElement | null;
}

const emptyTracer = (): TracerRefs => ({
  vLine: null, hLine: null, torqueDot: null, powerDot: null, label: null, labelRpm: null,
  labelValues: null, rpm: null, torque: null, power: null, region: null,
});

const LABEL_W = 190;
const LABEL_H = 46;

function iceRegion(rpm: number, isShifting: boolean, isStalled: boolean): string {
  if (isStalled) return 'Stalled';
  if (isShifting) return 'Shift interrupt — 0 Nm';
  if (rpm < ICE_STALL_RPM) return 'Below stall threshold';
  if (rpm < 2_500) return 'Low-rpm (lugging)';
  if (rpm > ICE_REDLINE_RPM) return 'Over redline — fuel cut';
  return 'Power band';
}

function evRegion(rpm: number, controls: Readonly<SimulationControls>): string {
  if (rpm <= EV_BASE_RPM) return 'Constant torque';
  if (!controls.fieldWeakening) return 'Back-EMF ceiling — 0 Nm';
  if (rpm > EV_MAX_RPM) return 'Over max speed';
  return 'Field weakening (constant power)';
}

export function TorquePowerPlot({ fieldWeakening, active }: { fieldWeakening: boolean; active: boolean }) {
  const tracers = useRef<Record<Kind, TracerRefs>>({ ice: emptyTracer(), ev: emptyTracer() });
  const lastKey = useRef('');
  const lastControls = useRef<Readonly<SimulationControls> | null>(null);

  const icePaths = useMemo(() => {
    const samples = sampleIceCurve(7_000);
    return { torque: toPath(samples, (s) => yTorque(s.torqueNm)), power: toPath(samples, (s) => yPower(s.powerKw)) };
  }, []);
  const evPaths = useMemo(() => {
    const samples = sampleEvCurve(fieldWeakening);
    return { torque: toPath(samples, (s) => yTorque(s.torqueNm)), power: toPath(samples, (s) => yPower(s.powerKw)) };
  }, [fieldWeakening]);

  useAnimationFrame(() => {
    const s = store.getMutableState();
    const key = String(s.stepCount);
    if (key === lastKey.current && lastControls.current === s.controls) return;
    lastKey.current = key;
    lastControls.current = s.controls;

    const points: Record<Kind, { rpm: number; torque: number; region: string }> = {
      ice: {
        rpm: Math.max(0, s.ice.engineRpm),
        torque: s.ice.engineTorqueNm,
        region: iceRegion(s.ice.engineRpm, s.ice.isShifting, s.ice.isStalled),
      },
      ev: {
        rpm: Math.abs(s.ev.motorRpm),
        torque: s.ev.motorTorqueNm,
        region: evRegion(Math.abs(s.ev.motorRpm), s.controls),
      },
    };

    for (const kind of ['ice', 'ev'] as const) {
      const p = points[kind];
      const T = tracers.current[kind];
      const kw = shaftPowerKw(p.torque, p.rpm);
      const x = xOf(p.rpm);
      const yt = yTorque(p.torque);
      const yp = yPower(kw);
      const xs = x.toFixed(1);
      const yts = yt.toFixed(1);

      setAttr(T.vLine, 'x1', xs);
      setAttr(T.vLine, 'x2', xs);
      setAttr(T.hLine, 'y1', yts);
      setAttr(T.hLine, 'y2', yts);
      setAttr(T.hLine, 'x2', xs);
      setAttr(T.torqueDot, 'cx', xs);
      setAttr(T.torqueDot, 'cy', yts);
      setAttr(T.powerDot, 'cx', xs);
      setAttr(T.powerDot, 'cy', yp.toFixed(1));

      // Readout box beside the dot, flipped/clamped to stay inside the plot.
      const lx = x + 12 + LABEL_W > W - M.r ? x - 12 - LABEL_W : x + 12;
      const preferredY = kind === 'ice' ? yt - LABEL_H - 10 : yt + 10;
      const ly = Math.min(Math.max(preferredY, M.t), M.t + PH - LABEL_H);
      setAttr(T.label, 'transform', `translate(${lx.toFixed(1)} ${ly.toFixed(1)})`);

      const rpmText = formatInt(p.rpm);
      const nmText = formatInt(p.torque);
      const kwText = formatInt(kw);
      setText(T.labelRpm, `${kind.toUpperCase()} ${rpmText} rpm`);
      setText(T.labelValues, `${nmText} Nm · ${kwText} kW`);
      setText(T.rpm, rpmText);
      setText(T.torque, nmText);
      setText(T.power, kwText);
      setText(T.region, p.region);
    }
  }, active);

  const bind = <K extends keyof TracerRefs>(kind: Kind, key: K) => (el: TracerRefs[K]) => {
    tracers.current[kind][key] = el;
  };

  const rpmTicks = Array.from({ length: RPM_MAX / 2_000 + 1 }, (_, i) => i * 2_000);
  const torqueTicks = [0, 100, 200, 300, 400];
  const powerTicks = [0, 50, 100, 150, 200, 250];
  const baseX = xOf(EV_BASE_RPM);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-400">
        <LegendSwatch className="stroke-ice" label="ICE torque" />
        <LegendSwatch className="stroke-ice" dashed label="ICE power" />
        <LegendSwatch className="stroke-ev" label="EV torque" />
        <LegendSwatch className="stroke-ev" dashed label="EV power" />
        <span>Curves = full-load envelope · dots = live operating point (scaled by throttle)</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Torque and power versus rpm for ICE and EV">
        {/* ICE stall zone */}
        <rect x={xOf(0)} y={M.t} width={xOf(ICE_STALL_RPM) - xOf(0)} height={PH} className="fill-red-500/15" />
        <text x={xOf(0) + 4} y={M.t + PH - 6} className="fill-red-300/80 text-[14px]" fontFamily="ui-monospace, monospace">
          stall
        </text>

        {/* Grid + axes */}
        {rpmTicks.map((rpm) => (
          <g key={rpm}>
            <line x1={xOf(rpm)} x2={xOf(rpm)} y1={M.t} y2={M.t + PH} className="stroke-slate-800" />
            <text x={xOf(rpm)} y={M.t + PH + 21} textAnchor="middle" className="fill-slate-500 text-[15px]" fontFamily="ui-monospace, monospace">
              {rpm === 0 ? '0' : `${rpm / 1000}k`}
            </text>
          </g>
        ))}
        {torqueTicks.map((nm) => (
          <g key={`t${nm}`}>
            <line x1={M.l} x2={M.l + PW} y1={yTorque(nm)} y2={yTorque(nm)} className="stroke-slate-800" />
            <text x={M.l - 8} y={yTorque(nm) + 4} textAnchor="end" className="fill-slate-400 text-[15px]" fontFamily="ui-monospace, monospace">
              {nm}
            </text>
          </g>
        ))}
        {powerTicks.map((kw) => (
          <text key={`p${kw}`} x={M.l + PW + 8} y={yPower(kw) + 4} className="fill-slate-500 text-[15px]" fontFamily="ui-monospace, monospace">
            {kw}
          </text>
        ))}
        <rect x={M.l} y={M.t} width={PW} height={PH} fill="none" className="stroke-slate-700" />
        <text x={M.l + PW / 2} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[15px]" fontFamily="ui-monospace, monospace">
          Shaft speed (rpm)
        </text>
        <text transform={`translate(14 ${M.t + PH / 2}) rotate(-90)`} textAnchor="middle" className="fill-slate-400 text-[15px]" fontFamily="ui-monospace, monospace">
          Torque (Nm) — solid
        </text>
        <text transform={`translate(${W - 10} ${M.t + PH / 2}) rotate(90)`} textAnchor="middle" className="fill-slate-400 text-[15px]" fontFamily="ui-monospace, monospace">
          Power (kW) — dashed
        </text>

        {/* EV base-speed threshold */}
        <line x1={baseX} x2={baseX} y1={M.t} y2={M.t + PH} className="stroke-ev/70" strokeDasharray="6 5" strokeWidth={1.5} />
        <text x={baseX - 6} y={M.t + 14} textAnchor="end" className="fill-ev/80 text-[14px]" fontFamily="ui-monospace, monospace">
          ◀ constant torque
        </text>
        <text x={baseX + 6} y={M.t + 14} className="fill-ev/80 text-[14px]" fontFamily="ui-monospace, monospace">
          {fieldWeakening ? 'field weakening (τ = P/ω) ▶' : 'back-EMF = 800 V → 0 Nm ▶'}
        </text>
        <text x={baseX + 6} y={M.t + 32} className="fill-slate-500 text-[14px]" fontFamily="ui-monospace, monospace">
          base speed 4,500 rpm
        </text>

        {/* ICE redline */}
        <line x1={xOf(ICE_REDLINE_RPM)} x2={xOf(ICE_REDLINE_RPM)} y1={M.t + 40} y2={M.t + PH} className="stroke-ice/40" strokeDasharray="2 4" />
        <text x={xOf(ICE_REDLINE_RPM) + 4} y={M.t + PH - 6} className="fill-ice/60 text-[14px]" fontFamily="ui-monospace, monospace">
          redline
        </text>

        {/* Curves */}
        <path d={icePaths.torque} fill="none" className="stroke-ice" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={icePaths.power} fill="none" className="stroke-ice" strokeWidth={2} strokeDasharray="7 5" />
        <path d={evPaths.torque} fill="none" className="stroke-ev" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={evPaths.power} fill="none" className="stroke-ev" strokeWidth={2} strokeDasharray="7 5" />

        {/* Live tracers (mutated imperatively each frame) */}
        {(['ice', 'ev'] as const).map((kind) => {
          const stroke = kind === 'ice' ? 'stroke-ice' : 'stroke-ev';
          const fill = kind === 'ice' ? 'fill-ice' : 'fill-ev';
          return (
            <g key={kind}>
              <line ref={bind(kind, 'vLine')} x1={M.l} x2={M.l} y1={M.t} y2={M.t + PH} className={`${stroke} opacity-50`} strokeDasharray="3 3" />
              <line ref={bind(kind, 'hLine')} x1={M.l} x2={M.l} y1={M.t + PH} y2={M.t + PH} className={`${stroke} opacity-30`} strokeDasharray="3 3" />
              <circle ref={bind(kind, 'powerDot')} cx={M.l} cy={M.t + PH} r={5} className={`fill-slate-950 ${stroke}`} strokeWidth={2} />
              <circle ref={bind(kind, 'torqueDot')} cx={M.l} cy={M.t + PH} r={7} className={`${fill} stroke-slate-950`} strokeWidth={2} />
              <g ref={bind(kind, 'label')} transform={`translate(${M.l} ${M.t})`}>
                <rect width={LABEL_W} height={LABEL_H} rx={4} className={`fill-slate-950/90 ${stroke}`} strokeWidth={1} />
                <text x={9} y={19} className="fill-slate-100 text-[15px]" fontFamily="ui-monospace, monospace">
                  <tspan ref={bind(kind, 'labelRpm')} />
                </text>
                <text x={9} y={38} className="fill-slate-300 text-[15px]" fontFamily="ui-monospace, monospace">
                  <tspan ref={bind(kind, 'labelValues')} />
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        {(['ice', 'ev'] as const).map((kind) => (
          <div key={kind} className="grid grid-cols-[auto_1fr_1fr_1fr] items-baseline gap-x-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 tabular-nums">
            <span className={`text-xs font-bold ${kind === 'ice' ? 'text-ice' : 'text-ev'}`}>{kind.toUpperCase()}</span>
            <span><span ref={bind(kind, 'rpm')} className="text-white">0</span> <span className="text-[10px] text-slate-500">rpm</span></span>
            <span><span ref={bind(kind, 'torque')} className="text-white">0</span> <span className="text-[10px] text-slate-500">Nm</span></span>
            <span><span ref={bind(kind, 'power')} className="text-white">0</span> <span className="text-[10px] text-slate-500">kW</span></span>
            <span ref={bind(kind, 'region')} className="col-span-4 text-[11px] text-slate-400" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendSwatch({ className, dashed = false, label }: { className: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={26} height={8} aria-hidden="true">
        <line x1={1} x2={25} y1={4} y2={4} className={className} strokeWidth={2.5} strokeDasharray={dashed ? '5 4' : undefined} />
      </svg>
      {label}
    </span>
  );
}
