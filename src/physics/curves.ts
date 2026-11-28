/**
 * Full-load torque / power curve sampling for plotting.
 * Pure TypeScript — no React, no DOM.
 */
import { rpmToRadPerS } from './math';
import {
  EV_BASE_RPM,
  EV_MAX_RPM,
  ICE_IDLE_RPM,
  ICE_PEAK_TORQUE_RPM,
  ICE_REDLINE_RPM,
  ICE_REV_LIMIT_RPM,
  ICE_STALL_RPM,
  getEvFullLoadTorque,
  getIceFullLoadTorque,
} from './powertrains';

export interface CurveSample {
  rpm: number;
  torqueNm: number;
  powerKw: number;
}

/** Mechanical shaft power in kW. Sign-safe: uses |rpm|. */
export function shaftPowerKw(torqueNm: number, rpm: number): number {
  const p = (torqueNm * rpmToRadPerS(Math.abs(rpm))) / 1000;
  return Number.isFinite(p) ? p : 0;
}

function buildCurve(
  start: number,
  end: number,
  stepRpm: number,
  breakpoints: readonly number[],
  torqueAt: (rpm: number) => number,
): CurveSample[] {
  const rpms = new Set<number>(breakpoints.filter((b) => b >= start && b <= end));
  for (let rpm = start; rpm < end; rpm += stepRpm) rpms.add(rpm);
  rpms.add(end);
  return [...rpms]
    .sort((a, b) => a - b)
    .map((rpm) => {
      const torqueNm = torqueAt(rpm);
      return { rpm, torqueNm, powerKw: shaftPowerKw(torqueNm, rpm) };
    });
}

/** ICE wide-open-throttle envelope from the stall threshold to `endRpm`. */
export function sampleIceCurve(endRpm = 7_000, stepRpm = 25): CurveSample[] {
  return buildCurve(
    ICE_STALL_RPM,
    endRpm,
    stepRpm,
    [ICE_IDLE_RPM, ICE_PEAK_TORQUE_RPM, ICE_REDLINE_RPM, ICE_REV_LIMIT_RPM],
    getIceFullLoadTorque,
  );
}

/**
 * EV full-load envelope from 0 rpm. Includes points either side of base
 * speed so the field-weakening-off cliff renders as a vertical drop.
 */
export function sampleEvCurve(fieldWeakening: boolean, endRpm = EV_MAX_RPM, stepRpm = 50): CurveSample[] {
  return buildCurve(
    0,
    endRpm,
    stepRpm,
    [EV_BASE_RPM, EV_BASE_RPM + 1e-3, EV_MAX_RPM],
    (rpm) => getEvFullLoadTorque(rpm, fieldWeakening),
  );
}
