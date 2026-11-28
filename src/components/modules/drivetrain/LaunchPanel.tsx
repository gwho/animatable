import { useRef, type ReactNode } from 'react';
import { ICE_REDLINE_RPM, ICE_STALL_RPM, type UiSnapshot } from '../../../physics';
import { formatFixed, formatInt, setAttr, setText } from '../../shared/format';
import { useFrameRenderer } from './frameContext';
import { CLUTCH_FADE_C, HEAT_MAX_C, HEAT_MIN_C, heatColor, heatLegendGradient } from './heatColor';
import { toDeg } from './gearGeometry';

// --- RPM gauge ---------------------------------------------------------------
const G_CX = 120;
const G_CY = 118;
const G_R = 92;
const GAUGE_MAX_RPM = 7_000;
const SWEEP_DEG = 240;
const START_DEG = 150; // SVG degrees (clockwise from +x)

function rpmToGaugeRad(rpm: number): number {
  const f = Math.min(Math.max(rpm, 0), GAUGE_MAX_RPM) / GAUGE_MAX_RPM;
  return ((START_DEG + f * SWEEP_DEG) * Math.PI) / 180;
}

function arcPath(fromRpm: number, toRpm: number, radius: number): string {
  const a0 = rpmToGaugeRad(fromRpm);
  const a1 = rpmToGaugeRad(toRpm);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (a: number): string => `${(G_CX + radius * Math.cos(a)).toFixed(2)} ${(G_CY + radius * Math.sin(a)).toFixed(2)}`;
  return `M${p(a0)} A${radius} ${radius} 0 ${large} 1 ${p(a1)}`;
}

// --- Clutch face heatmap ------------------------------------------------------
const FACE_R_OUT = 70;
const FACE_R_IN = 30;
const RINGS = 6;
const PADS = 12;
/** Sliding speed ∝ radius, so the outer friction ring runs hotter. */
function ringTemp(tempC: number, ringIndex: number): number {
  const rFrac = (ringIndex + 0.5) / RINGS;
  return HEAT_MIN_C + (tempC - HEAT_MIN_C) * (0.6 + 0.55 * rFrac);
}

// --- Temperature trace -------------------------------------------------------
const TRACE_SAMPLES = 120;
const TRACE_INTERVAL_S = 0.25; // 120 × 0.25 s = 30 s of simulated history
const TRACE_W = 300;
const TRACE_H = 70;
const TRACE_MAX_C = 400;

export function LaunchPanel({ ui }: { ui: UiSnapshot }) {
  const r = useRef({
    engineNeedle: null as SVGLineElement | null,
    inputNeedle: null as SVGLineElement | null,
    engineRpm: null as SVGTextElement | null,
    inputRpm: null as SVGTSpanElement | null,
    face: null as SVGGElement | null,
    rings: [] as (SVGCircleElement | null)[],
    trace: null as SVGPolylineElement | null,
    state: null as HTMLElement | null,
    slipRpm: null as HTMLElement | null,
    slipKw: null as HTMLElement | null,
    energy: null as HTMLElement | null,
    temp: null as HTMLElement | null,
    tempBadge: null as HTMLElement | null,
  });
  const trace = useRef({ samples: [] as number[], nextSampleS: 0, lastTimeS: 0 });

  useFrameRenderer((state, angles) => {
    const { ice } = state;
    const R = r.current;

    setAttr(R.engineNeedle, 'transform', `rotate(${toDeg(rpmToGaugeRad(ice.engineRpm))} ${G_CX} ${G_CY})`);
    setAttr(R.inputNeedle, 'transform', `rotate(${toDeg(rpmToGaugeRad(ice.inputShaftRpm))} ${G_CX} ${G_CY})`);
    setText(R.engineRpm, formatInt(ice.engineRpm));
    setText(R.inputRpm, formatInt(ice.inputShaftRpm));

    setAttr(R.face, 'transform', `rotate(${toDeg(angles.input)})`);
    R.rings.forEach((ring, i) => setAttr(ring, 'stroke', heatColor(ringTemp(ice.clutchTempC, i))));

    const slipRpm = ice.clutchState === 'slipping' ? ice.engineRpm - ice.inputShaftRpm : 0;
    setText(R.state, ice.isStalled ? 'stalled' : ice.clutchState);
    setAttr(R.state, 'data-state', ice.isStalled ? 'stalled' : ice.clutchState);
    setText(R.slipRpm, formatInt(slipRpm));
    setText(R.slipKw, formatFixed(ice.clutchSlipPowerW / 1000, 1));
    setText(R.energy, formatFixed(ice.clutchEnergyJ / 1000, 1));
    setText(R.temp, formatInt(ice.clutchTempC));
    setText(R.tempBadge, ice.clutchTempC >= CLUTCH_FADE_C ? 'FADE — facing glazing' : ice.clutchTempC >= 150 ? 'HOT' : 'OK');
    setAttr(R.tempBadge, 'data-level', ice.clutchTempC >= CLUTCH_FADE_C ? 'fade' : ice.clutchTempC >= 150 ? 'hot' : 'ok');

    // Rolling 30 s temperature history (sampled on simulation time).
    const t = trace.current;
    if (state.timeS < t.lastTimeS || t.samples.length === 0) {
      t.samples = [ice.clutchTempC];
      t.nextSampleS = state.timeS + TRACE_INTERVAL_S;
    }
    t.lastTimeS = state.timeS;
    let changed = false;
    while (state.timeS >= t.nextSampleS) {
      t.samples.push(ice.clutchTempC);
      if (t.samples.length > TRACE_SAMPLES) t.samples.shift();
      t.nextSampleS += TRACE_INTERVAL_S;
      changed = true;
    }
    if (changed || t.samples.length === 1) {
      const step = TRACE_W / (TRACE_SAMPLES - 1);
      const pts = t.samples
        .map((c, i) => `${(i * step).toFixed(1)},${(TRACE_H - (Math.min(c, TRACE_MAX_C) / TRACE_MAX_C) * TRACE_H).toFixed(1)}`)
        .join(' ');
      setAttr(R.trace, 'points', pts);
    }
  });

  const fadeY = TRACE_H - (CLUTCH_FADE_C / TRACE_MAX_C) * TRACE_H;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {ui.ice.isStalled && (
        <div role="alert" className="rounded-md border border-red-700 bg-red-950/70 px-3 py-2 text-sm text-red-200">
          <strong className="text-red-100">ENGINE STALLED.</strong> The locked clutch tied the crank to the wheels, and road speed dragged it below{' '}
          {ICE_STALL_RPM} rpm, where combustion can&apos;t sustain itself. Reset, or switch to <em>Slip clutch</em> to restart.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* RPM gauge */}
        <figure className="flex min-w-0 flex-col items-center">
          <svg viewBox="0 0 240 190" className="h-auto w-full max-w-[280px]" role="img" aria-label="Engine and gearbox input speed gauge">
            <path d={arcPath(0, GAUGE_MAX_RPM, G_R)} fill="none" className="stroke-slate-800" strokeWidth={14} />
            <path d={arcPath(0, ICE_STALL_RPM, G_R)} fill="none" className="stroke-red-600" strokeWidth={14} />
            <path d={arcPath(ICE_REDLINE_RPM, GAUGE_MAX_RPM, G_R)} fill="none" className="stroke-red-500/70" strokeWidth={14} />
            {Array.from({ length: 8 }, (_, k) => k * 1_000).map((rpm) => {
              const a = rpmToGaugeRad(rpm);
              return (
                <g key={rpm}>
                  <line
                    x1={G_CX + (G_R - 10) * Math.cos(a)}
                    y1={G_CY + (G_R - 10) * Math.sin(a)}
                    x2={G_CX + (G_R + 7) * Math.cos(a)}
                    y2={G_CY + (G_R + 7) * Math.sin(a)}
                    className="stroke-slate-500"
                  />
                  <text
                    x={G_CX + (G_R - 24) * Math.cos(a)}
                    y={G_CY + (G_R - 24) * Math.sin(a) + 4}
                    textAnchor="middle"
                    className="fill-slate-400 text-[11px]"
                    fontFamily="ui-monospace, monospace"
                  >
                    {rpm / 1000}
                  </text>
                </g>
              );
            })}
            <text x={6} y={186} className="fill-red-400 text-[10px]" fontFamily="ui-monospace, monospace">stall &lt;750</text>
            {/* Needles drawn pointing along +x, rotated each frame */}
            <line ref={(el) => { r.current.inputNeedle = el; }} x1={G_CX} y1={G_CY} x2={G_CX + G_R - 16} y2={G_CY} className="stroke-slate-400" strokeWidth={3} strokeLinecap="round" transform={`rotate(${START_DEG} ${G_CX} ${G_CY})`} />
            <line ref={(el) => { r.current.engineNeedle = el; }} x1={G_CX} y1={G_CY} x2={G_CX + G_R - 6} y2={G_CY} className="stroke-ice" strokeWidth={4} strokeLinecap="round" transform={`rotate(${START_DEG} ${G_CX} ${G_CY})`} />
            <circle cx={G_CX} cy={G_CY} r={7} className="fill-slate-200" />
            <text ref={(el) => { r.current.engineRpm = el; }} x={G_CX} y={G_CY + 40} textAnchor="middle" className="fill-ice text-[22px] font-bold" fontFamily="ui-monospace, monospace">0</text>
            <text x={G_CX} y={G_CY + 56} textAnchor="middle" className="fill-slate-400 text-[11px]" fontFamily="ui-monospace, monospace">
              engine · input <tspan ref={(el) => { r.current.inputRpm = el; }} className="fill-slate-200">0</tspan>
            </text>
          </svg>
          <figcaption className="text-center text-[11px] text-slate-500">
            <span className="text-ice">━</span> engine &nbsp; <span className="text-slate-400">━</span> gearbox input (wheel-driven). The gap between them is clutch slip.
          </figcaption>
        </figure>

        {/* Clutch face heatmap */}
        <figure className="flex min-w-0 flex-col items-center gap-2">
          <svg viewBox="-90 -90 180 180" className="h-auto w-full max-w-[220px]" role="img" aria-label="Clutch disc friction-face temperature heatmap">
            <g ref={(el) => { r.current.face = el; }}>
              {Array.from({ length: RINGS }, (_, i) => {
                const radius = FACE_R_IN + ((FACE_R_OUT - FACE_R_IN) * (i + 0.5)) / RINGS;
                return (
                  <circle
                    key={i}
                    ref={(el) => { r.current.rings[i] = el; }}
                    r={radius}
                    fill="none"
                    stroke="rgb(30,58,138)"
                    strokeWidth={(FACE_R_OUT - FACE_R_IN) / RINGS + 0.6}
                  />
                );
              })}
              {Array.from({ length: PADS }, (_, k) => {
                const a = (2 * Math.PI * k) / PADS;
                return (
                  <line
                    key={k}
                    x1={FACE_R_IN * Math.cos(a)}
                    y1={FACE_R_IN * Math.sin(a)}
                    x2={FACE_R_OUT * Math.cos(a)}
                    y2={FACE_R_OUT * Math.sin(a)}
                    className="stroke-slate-950"
                    strokeWidth={2.5}
                  />
                );
              })}
              <circle r={FACE_R_IN - 2} className="fill-slate-600" />
              {Array.from({ length: 6 }, (_, k) => {
                const a = (2 * Math.PI * k) / 6;
                return <rect key={k} x={14} y={-3} width={12} height={6} rx={2} transform={`rotate(${(a * 180) / Math.PI})`} className="fill-slate-400" />;
              })}
              <circle r={7} className="fill-slate-900" />
            </g>
          </svg>
          <div className="w-full max-w-[240px]">
            <div className="h-2 rounded" style={{ background: heatLegendGradient() }} />
            <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
              <span>{HEAT_MIN_C}°C</span>
              <span>fade {CLUTCH_FADE_C}°C</span>
              <span>{HEAT_MAX_C}°C</span>
            </div>
          </div>
        </figure>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm tabular-nums sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Clutch">
          <span
            ref={(el) => { r.current.state = el; }}
            className="uppercase data-[state=locked]:text-emerald-400 data-[state=open]:text-slate-400 data-[state=slipping]:text-amber-300 data-[state=stalled]:text-red-400"
          >
            open
          </span>
        </Stat>
        <Stat label="Slip rpm"><span ref={(el) => { r.current.slipRpm = el; }}>0</span></Stat>
        <Stat label="Slip power kW"><span ref={(el) => { r.current.slipKw = el; }}>0.0</span></Stat>
        <Stat label="Heat dumped kJ"><span ref={(el) => { r.current.energy = el; }}>0.0</span></Stat>
        <Stat label="Disc °C"><span ref={(el) => { r.current.temp = el; }}>40</span></Stat>
        <Stat label="Facing">
          <span
            ref={(el) => { r.current.tempBadge = el; }}
            className="data-[level=fade]:animate-pulse data-[level=fade]:text-red-400 data-[level=hot]:text-amber-300 data-[level=ok]:text-emerald-400"
          >
            OK
          </span>
        </Stat>
      </dl>

      <figure className="min-w-0">
        <svg viewBox={`0 -6 ${TRACE_W} ${TRACE_H + 12}`} preserveAspectRatio="none" className="h-20 w-full" role="img" aria-label="Clutch temperature over the last 30 seconds">
          <rect x={0} y={0} width={TRACE_W} height={TRACE_H} className="fill-slate-950" />
          <line x1={0} x2={TRACE_W} y1={fadeY} y2={fadeY} className="stroke-red-500/60" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          <polyline ref={(el) => { r.current.trace = el; }} points="" fill="none" className="stroke-amber-400" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        <figcaption className="flex justify-between text-[10px] text-slate-500">
          <span>clutch °C · last 30 s</span>
          <span className="text-red-400/80">— fade threshold</span>
        </figcaption>
      </figure>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="truncate text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="truncate text-base font-semibold text-white">{children}</dd>
    </div>
  );
}
