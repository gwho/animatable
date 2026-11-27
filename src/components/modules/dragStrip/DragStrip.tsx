import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UiSnapshot } from '../../../physics';
import { simulationStore as store } from '../../../app/simulation';
import { useAnimationFrame } from '../../../hooks/useAnimationFrame';
import { MPS_TO_KMH, MPS_TO_MPH, formatFixed, formatInt, setAttr, setText } from './format';

export const QUARTER_MILE_M = 400;
const TRACK_HEIGHT = 168;
const LANES = { ice: { y: 30, h: 60 }, ev: { y: 98, h: 60 } } as const;
const CAR_LEN_PX = 56;
const MARKER_MIN_M = -50;
const MARKER_MAX_M = 1_000;
/** Leading car sits at this fraction of the viewport width. */
const CAMERA_LEAD_FRACTION = 0.7;

type Kind = 'ice' | 'ev';

function viewWindowMeters(widthPx: number): number {
  if (widthPx < 640) return 50;
  if (widthPx < 1_000) return 80;
  return 110;
}

interface FinishRecord {
  timeS: number;
  trapKmh: number;
}

/** Imperatively-updated element handles for one lane. */
interface LaneRefs {
  car: SVGGElement | null;
  wheels: (SVGGElement | null)[];
  behind: SVGTextElement | null;
  kmh: HTMLElement | null;
  mph: HTMLElement | null;
  wheelTorque: HTMLElement | null;
  rpm: HTMLElement | null;
  gap: HTMLElement | null;
  et: HTMLElement | null;
  miniDot: HTMLElement | null;
  distance: HTMLElement | null;
}

function emptyLane(): LaneRefs {
  return {
    car: null, wheels: [], behind: null, kmh: null, mph: null, wheelTorque: null,
    rpm: null, gap: null, et: null, miniDot: null, distance: null,
  };
}

export function DragStrip({ ui, active }: { ui: UiSnapshot; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(800);
  const widthRef = useRef(widthPx);
  const markersRef = useRef<SVGGElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const lanes = useRef<Record<Kind, LaneRefs>>({ ice: emptyLane(), ev: emptyLane() });
  const finish = useRef<{ lastTimeS: number; ice: FinishRecord | null; ev: FinishRecord | null }>({
    lastTimeS: 0, ice: null, ev: null,
  });
  const lastRenderKey = useRef('');

  // Responsive width: a resize is a discrete event, so React state is fine here.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(320, Math.round(entry?.contentRect.width ?? 800));
      widthRef.current = w;
      setWidthPx(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const viewM = viewWindowMeters(widthPx);
  const ppm = widthPx / viewM;

  const markers = useMemo(() => {
    const items: { m: number; major: boolean }[] = [];
    for (let m = MARKER_MIN_M; m <= MARKER_MAX_M; m += 10) items.push({ m, major: m % 50 === 0 });
    return items;
  }, []);

  useAnimationFrame(() => {
    const s = store.getMutableState();
    const key = `${s.stepCount}|${widthRef.current}`;
    if (key === lastRenderKey.current) return;
    lastRenderKey.current = key;

    const w = widthRef.current;
    const vm = viewWindowMeters(w);
    const scale = w / vm;
    const { ice, ev } = s;

    // Finish-line bookkeeping (cleared when time runs backwards, i.e. reset).
    const f = finish.current;
    if (s.timeS < f.lastTimeS) {
      f.ice = null;
      f.ev = null;
    }
    f.lastTimeS = s.timeS;
    for (const kind of ['ice', 'ev'] as const) {
      const v = s[kind];
      if (f[kind] === null && v.distanceM >= QUARTER_MILE_M) {
        // Interpolate the crossing inside the last step.
        const overshootS = v.velocityMps > 0 ? (v.distanceM - QUARTER_MILE_M) / v.velocityMps : 0;
        f[kind] = { timeS: Math.max(0, s.timeS - overshootS), trapKmh: v.velocityMps * MPS_TO_KMH };
      }
    }

    // Camera follows the leader; markers scroll underneath.
    const lead = Math.max(ice.distanceM, ev.distanceM);
    const minCam = -(CAR_LEN_PX + 12) / scale;
    const camM = Math.max(minCam, lead - vm * CAMERA_LEAD_FRACTION);
    setAttr(markersRef.current, 'transform', `translate(${(-camM * scale).toFixed(2)} 0)`);
    setText(timeRef.current, formatFixed(s.timeS, 2));

    for (const kind of ['ice', 'ev'] as const) {
      const v = s[kind];
      const L = lanes.current[kind];
      const laneY = LANES[kind].y + LANES[kind].h / 2;
      const rawX = (v.distanceM - camM) * scale;
      const isBehind = rawX < CAR_LEN_PX;
      const x = Math.max(rawX, CAR_LEN_PX);
      setAttr(L.car, 'transform', `translate(${x.toFixed(2)} ${laneY})`);
      setAttr(L.car, 'opacity', isBehind ? '0.45' : '1');
      const wheelDeg = ((v.wheelAngleRad * 180) / Math.PI).toFixed(1);
      L.wheels.forEach((wheel, i) => {
        setAttr(wheel, 'transform', `translate(${i === 0 ? -12 : -44} 10) rotate(${wheelDeg})`);
      });
      const otherD = kind === 'ice' ? ev.distanceM : ice.distanceM;
      const gap = v.distanceM - otherD;
      setAttr(L.behind, 'visibility', isBehind ? 'visible' : 'hidden');
      if (isBehind) setText(L.behind, `◀ ${formatFixed(-gap, 1)} m`);

      setText(L.kmh, formatFixed(v.velocityMps * MPS_TO_KMH, 1));
      setText(L.mph, formatFixed(v.velocityMps * MPS_TO_MPH, 1));
      setText(L.wheelTorque, formatInt(v.wheelTorqueNm));
      setText(L.rpm, formatInt(kind === 'ice' ? s.ice.engineRpm : Math.abs(s.ev.motorRpm)));
      setText(L.distance, formatFixed(v.distanceM, 1));
      setText(L.gap, Math.abs(gap) < 0.05 ? 'level' : `${gap > 0 ? '+' : '−'}${formatFixed(Math.abs(gap), 1)} m`);
      const rec = f[kind];
      setText(L.et, rec ? `${rec.timeS.toFixed(2)} s @ ${rec.trapKmh.toFixed(0)} km/h` : '—');
      if (L.miniDot) {
        const pct = Math.min(100, Math.max(0, (v.distanceM / QUARTER_MILE_M) * 100));
        L.miniDot.style.left = `${pct.toFixed(2)}%`;
      }
    }
  }, active);

  const bindLane = <K extends keyof LaneRefs>(kind: Kind, key: K) => (el: LaneRefs[K]) => {
    lanes.current[kind][key] = el;
  };
  const bindWheel = (kind: Kind, i: number) => (el: SVGGElement | null) => {
    lanes.current[kind].wheels[i] = el;
  };

  const iceGearBadge =
    ui.controls.gearSelector !== 'D' ? ui.controls.gearSelector : ui.ice.isShifting ? 'N' : String(ui.ice.gear);
  const evGearBadge = ui.controls.gearSelector === 'D' ? 'D' : ui.controls.gearSelector;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <VehicleCard
          kind="ice"
          title="ICE · 6-speed + 3.5 FD"
          gearBadge={iceGearBadge}
          rpmLabel="Engine rpm"
          bind={bindLane}
          alerts={
            <>
              {ui.ice.isShifting && (
                <span className="animate-pulse rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
                  SHIFT INTERRUPT (0 Nm)
                </span>
              )}
              {ui.ice.isStalled && (
                <span className="rounded bg-red-900 px-2 py-0.5 text-[11px] font-bold tracking-wide text-red-200">
                  STALLED — reset or slip clutch
                </span>
              )}
              {ui.controls.iceGearMode === 'locked-4th' && !ui.ice.isStalled && (
                <span className="rounded bg-amber-900/70 px-2 py-0.5 text-[11px] text-amber-200">
                  Locked 4th: 4.55:1 overall vs 13.3:1 in 1st
                </span>
              )}
            </>
          }
        />
        <VehicleCard
          kind="ev"
          title="EV · single-speed 9.0:1"
          gearBadge={evGearBadge}
          rpmLabel="Motor rpm"
          bind={bindLane}
          alerts={
            <span className="rounded bg-cyan-950 px-2 py-0.5 text-[11px] text-cyan-200">
              No shift interrupt · 400 Nm from 0 rpm
            </span>
          }
        />
      </div>

      <div ref={containerRef} className="relative w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <svg
          width="100%"
          height={TRACK_HEIGHT}
          viewBox={`0 0 ${widthPx} ${TRACK_HEIGHT}`}
          className="block"
          role="img"
          aria-label="Drag strip: ICE lane above, EV lane below"
        >
          <defs>
            <pattern id="checker" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" className="fill-white" />
              <rect width="3" height="3" className="fill-slate-900" />
              <rect x="3" y="3" width="3" height="3" className="fill-slate-900" />
            </pattern>
          </defs>

          {/* Lanes */}
          {(['ice', 'ev'] as const).map((kind) => (
            <g key={kind}>
              <rect x={0} y={LANES[kind].y} width={widthPx} height={LANES[kind].h} className="fill-slate-900" />
              <line
                x1={0}
                x2={widthPx}
                y1={LANES[kind].y + LANES[kind].h / 2}
                y2={LANES[kind].y + LANES[kind].h / 2}
                className="stroke-slate-700"
                strokeDasharray="14 12"
              />
            </g>
          ))}
          {ui.ice.isShifting && (
            <rect x={0} y={LANES.ice.y} width={widthPx} height={LANES.ice.h} className="animate-pulse fill-red-600/25" />
          )}

          {/* Scrolling distance markers */}
          <g ref={markersRef}>
            {markers.map(({ m, major }) => {
              const x = m * ppm;
              const isStart = m === 0;
              const isFinish = m === QUARTER_MILE_M;
              return (
                <g key={m}>
                  <line
                    x1={x}
                    x2={x}
                    y1={major ? 18 : 24}
                    y2={TRACK_HEIGHT - 6}
                    className={isStart || isFinish ? 'stroke-slate-300' : major ? 'stroke-slate-600' : 'stroke-slate-800'}
                    strokeWidth={isStart ? 2 : 1}
                  />
                  {major && (
                    <text x={x + 3} y={14} className="fill-slate-400 text-[10px]" fontFamily="ui-monospace, monospace">
                      {m}m
                    </text>
                  )}
                  {isFinish && (
                    <>
                      <rect x={x} y={LANES.ice.y} width={10} height={LANES.ev.y + LANES.ev.h - LANES.ice.y} fill="url(#checker)" />
                      <text x={x + 14} y={14} className="fill-amber-300 text-[10px] font-bold" fontFamily="ui-monospace, monospace">
                        FINISH ¼ mi
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>

          {/* Lane labels (fixed) */}
          <text x={6} y={LANES.ice.y + 12} className="fill-ice text-[10px] font-bold" fontFamily="ui-monospace, monospace">ICE</text>
          <text x={6} y={LANES.ev.y + 12} className="fill-ev text-[10px] font-bold" fontFamily="ui-monospace, monospace">EV</text>

          {/* Cars */}
          {(['ice', 'ev'] as const).map((kind) => (
            <g key={kind}>
              <text
                ref={bindLane(kind, 'behind')}
                x={CAR_LEN_PX + 8}
                y={LANES[kind].y + LANES[kind].h / 2 + 4}
                visibility="hidden"
                className={`${kind === 'ice' ? 'fill-ice' : 'fill-ev'} text-[11px]`}
                fontFamily="ui-monospace, monospace"
              />
              <g ref={bindLane(kind, 'car')} transform={`translate(${CAR_LEN_PX} ${LANES[kind].y + LANES[kind].h / 2})`}>
                <CarSilhouette kind={kind} bindWheel={(i) => bindWheel(kind, i)} />
              </g>
            </g>
          ))}
        </svg>
        <div className="pointer-events-none absolute right-1 top-1 rounded bg-slate-950/90 px-1.5 text-[11px] text-slate-400">
          t = <span ref={timeRef} className="tabular-nums text-slate-200">0.00</span> s
        </div>
      </div>

      {/* Quarter-mile progress mini-map */}
      <div className="flex items-center gap-3 text-[11px] text-slate-500">
        <span>0</span>
        <div className="relative h-3 flex-1 rounded-full bg-slate-800" aria-hidden="true">
          {[25, 50, 75].map((p) => (
            <span key={p} className="absolute top-0 h-3 w-px bg-slate-700" style={{ left: `${p}%` }} />
          ))}
          <span ref={bindLane('ice', 'miniDot')} className="absolute h-2 w-2 -translate-x-1/2 rounded-full bg-ice ring-2 ring-slate-950" style={{ left: '0%', top: '-1px' }} />
          <span ref={bindLane('ev', 'miniDot')} className="absolute h-2 w-2 -translate-x-1/2 rounded-full bg-ev ring-2 ring-slate-950" style={{ left: '0%', top: '5px' }} />
        </div>
        <span>400 m</span>
      </div>
    </div>
  );
}

function VehicleCard({
  kind,
  title,
  gearBadge,
  rpmLabel,
  alerts,
  bind,
}: {
  kind: Kind;
  title: string;
  gearBadge: string;
  rpmLabel: string;
  alerts: ReactNode;
  bind: <K extends keyof LaneRefs>(kind: Kind, key: K) => (el: LaneRefs[K]) => void;
}) {
  const accent = kind === 'ice' ? 'text-ice' : 'text-ev';
  const badgeTone = kind === 'ice' ? 'border-ice text-ice' : 'border-ev text-ev';
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`text-xs font-semibold uppercase tracking-widest ${accent}`}>{title}</h3>
          <div className="mt-1 flex min-h-5 flex-wrap gap-1">{alerts}</div>
        </div>
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 text-xl font-bold ${badgeTone}`}
          aria-label="Active gear"
        >
          {gearBadge}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 tabular-nums">
        <Stat label="km/h" big><span ref={bind(kind, 'kmh')}>0.0</span></Stat>
        <Stat label="mph"><span ref={bind(kind, 'mph')}>0.0</span></Stat>
        <Stat label="Wheel Nm"><span ref={bind(kind, 'wheelTorque')}>0</span></Stat>
        <Stat label={rpmLabel}><span ref={bind(kind, 'rpm')}>0</span></Stat>
        <Stat label="Distance m"><span ref={bind(kind, 'distance')}>0.0</span></Stat>
        <Stat label="Gap"><span ref={bind(kind, 'gap')}>level</span></Stat>
      </div>
      <div className="text-[11px] text-slate-400">
        ¼-mile ET: <span ref={bind(kind, 'et')} className="tabular-nums text-slate-200">—</span>
      </div>
    </div>
  );
}

function Stat({ label, big = false, children }: { label: string; big?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={`${big ? 'text-xl' : 'text-base'} truncate font-semibold text-white`}>{children}</div>
      <div className="truncate text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

/** Side-view car drawn with its nose at local x = 0, facing +x. */
function CarSilhouette({ kind, bindWheel }: { kind: Kind; bindWheel: (i: number) => (el: SVGGElement | null) => void }) {
  const body = kind === 'ice' ? 'fill-ice' : 'fill-ev';
  return (
    <g>
      <path
        d="M0 6 L-2 0 L-12 -3 L-20 -12 L-38 -12 L-46 -3 L-54 -2 L-56 6 Z"
        className={body}
      />
      <path d="M-21 -10 L-27 -10 L-27 -3 L-15 -3 Z M-29 -10 L-37 -10 L-43 -3 L-29 -3 Z" className="fill-slate-900/70" />
      {kind === 'ice' ? (
        <rect x={-60} y={2} width={5} height={2} className="fill-slate-400" />
      ) : (
        <path d="M-6 -1 L-9 2 L-7 2 L-10 5" className="stroke-slate-900" strokeWidth={1} fill="none" />
      )}
      {[0, 1].map((i) => (
        <g key={i} ref={bindWheel(i)} transform={`translate(${i === 0 ? -12 : -44} 10)`}>
          <circle r={6} className="fill-slate-950 stroke-slate-300" strokeWidth={1.5} />
          <line x1={-5} x2={5} y1={0} y2={0} className="stroke-slate-400" strokeWidth={1} />
          <line x1={0} x2={0} y1={-5} y2={5} className="stroke-slate-400" strokeWidth={1} />
        </g>
      ))}
    </g>
  );
}
