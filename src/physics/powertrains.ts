/**
 * Powertrain torque sources: ICE full-load curve and PMSM traction motor.
 * Pure TypeScript — no React, no DOM.
 */
import { clamp01, lerp, rpmToRadPerS, smoothstep } from './math';

// ---------------------------------------------------------------------------
// Internal Combustion Engine
// ---------------------------------------------------------------------------

/** Below this speed volumetric airflow collapses: torque is strictly 0 Nm. */
export const ICE_STALL_RPM = 750;
export const ICE_IDLE_RPM = 800;
export const ICE_PEAK_TORQUE_RPM = 3_800;
export const ICE_REDLINE_RPM = 6_500;
/** Fuel cut-off. Torque fades from the redline value to 0 between redline and here. */
export const ICE_REV_LIMIT_RPM = 6_800;

export const ICE_IDLE_TORQUE_NM = 180;
export const ICE_PEAK_TORQUE_NM = 360;
export const ICE_REDLINE_TORQUE_NM = 275;

/**
 * Wide-open-throttle torque envelope of the ICE.
 *
 *  - rpm < 750           → 0 Nm (stall)
 *  - 750 … 800           → smooth catch from 0 to 180 Nm (combustion stabilises)
 *  - 800 … 3,800         → smooth rise 180 → 360 Nm (zero slope at the peak)
 *  - 3,800 … 6,500       → smooth taper 360 → 275 Nm
 *  - 6,500 … 6,800       → rev-limiter fuel cut 275 → 0 Nm
 *  - rpm ≥ 6,800 / NaN   → 0 Nm
 */
export function getIceFullLoadTorque(rpm: number): number {
  if (!Number.isFinite(rpm) || rpm < ICE_STALL_RPM) return 0;
  if (rpm < ICE_IDLE_RPM) {
    return ICE_IDLE_TORQUE_NM * smoothstep(ICE_STALL_RPM, ICE_IDLE_RPM, rpm);
  }
  if (rpm <= ICE_PEAK_TORQUE_RPM) {
    return lerp(ICE_IDLE_TORQUE_NM, ICE_PEAK_TORQUE_NM, smoothstep(ICE_IDLE_RPM, ICE_PEAK_TORQUE_RPM, rpm));
  }
  if (rpm <= ICE_REDLINE_RPM) {
    return lerp(ICE_PEAK_TORQUE_NM, ICE_REDLINE_TORQUE_NM, smoothstep(ICE_PEAK_TORQUE_RPM, ICE_REDLINE_RPM, rpm));
  }
  if (rpm < ICE_REV_LIMIT_RPM) {
    return lerp(ICE_REDLINE_TORQUE_NM, 0, smoothstep(ICE_REDLINE_RPM, ICE_REV_LIMIT_RPM, rpm));
  }
  return 0;
}

/** ICE brake torque (Nm) at a given crank speed and throttle position (0–1). */
export function getIceTorque(rpm: number, throttle: number): number {
  return getIceFullLoadTorque(rpm) * clamp01(throttle);
}

// ---------------------------------------------------------------------------
// Electric traction motor (interior PMSM)
// ---------------------------------------------------------------------------

export const EV_STALL_TORQUE_NM = 400;
/** Base (corner) speed: end of the constant-torque region. */
export const EV_BASE_RPM = 4_500;
export const EV_MAX_RPM = 18_000;
export const EV_DC_BUS_VOLTAGE_V = 800;
export const EV_POLE_PAIRS = 4;
/** Peak stator current magnitudes used for the d/q current readouts. */
export const EV_MAX_IQ_A = 600;
export const EV_MAX_ID_A = 450;

/** Constant power available above base speed: P = τ_stall · ω_base (≈188.5 kW). */
export const EV_BASE_POWER_W = EV_STALL_TORQUE_NM * rpmToRadPerS(EV_BASE_RPM);

/** Torque envelope (Nm) at full throttle. Uses |rpm| so it is valid in reverse. */
export function getEvFullLoadTorque(rpm: number, fieldWeakening: boolean): number {
  if (!Number.isFinite(rpm)) return 0;
  const speed = Math.abs(rpm);
  if (speed <= EV_BASE_RPM) return EV_STALL_TORQUE_NM;
  if (!fieldWeakening) {
    // Back-EMF has reached the DC bus ceiling: the inverter can no longer
    // push stator current against it, so torque collapses to zero.
    return 0;
  }
  if (speed > EV_MAX_RPM) return 0;
  // Constant power: τ = P_base / ω. Continuous with 400 Nm at base speed.
  return EV_BASE_POWER_W / rpmToRadPerS(speed);
}

/** EV motor shaft torque (Nm) at a given rotor speed, throttle (0–1) and FW mode. */
export function getEvTorque(rpm: number, throttle: number, fieldWeakening: boolean): number {
  return getEvFullLoadTorque(rpm, fieldWeakening) * clamp01(throttle);
}

export interface EvElectromagneticState {
  /** Back-EMF the inverter sees after any flux weakening (V). */
  backEmfV: number;
  /** Back-EMF the magnets alone would generate at this speed (V). */
  unweakenedBackEmfV: number;
  /** Net rotor flux as a fraction of magnet flux (1 = no weakening). */
  netFluxRatio: number;
  /** d-axis (flux) current; negative when weakening the field (A). */
  idA: number;
  /** q-axis (torque-producing) current (A). */
  iqA: number;
  /** Shaft torque delivered (Nm). */
  torqueNm: number;
  /** True when the motor operates above base speed with active field weakening. */
  isFieldWeakeningActive: boolean;
}

/**
 * Electromagnetic operating point of the PMSM for visualisation (Module 3).
 * Back-EMF scales linearly with speed and reaches the 800 V bus at base speed.
 */
export function getEvElectromagnetics(
  rpm: number,
  throttle: number,
  fieldWeakening: boolean,
): EvElectromagneticState {
  const speed = Number.isFinite(rpm) ? Math.abs(rpm) : 0;
  const t = clamp01(throttle);
  const unweakenedBackEmfV = (EV_DC_BUS_VOLTAGE_V * speed) / EV_BASE_RPM;
  const torqueNm = getEvTorque(speed, t, fieldWeakening);
  const aboveBase = speed > EV_BASE_RPM;

  if (aboveBase && fieldWeakening && speed <= EV_MAX_RPM) {
    const netFluxRatio = EV_BASE_RPM / speed;
    return {
      backEmfV: EV_DC_BUS_VOLTAGE_V,
      unweakenedBackEmfV,
      netFluxRatio,
      idA: -EV_MAX_ID_A * (1 - netFluxRatio),
      // τ ∝ λ·iq → iq = (τ/τ_max)/λ_ratio · Iq_max, which stays within Iq_max at full throttle.
      iqA: ((torqueNm / EV_STALL_TORQUE_NM) / netFluxRatio) * EV_MAX_IQ_A,
      torqueNm,
      isFieldWeakeningActive: true,
    };
  }

  return {
    backEmfV: unweakenedBackEmfV,
    unweakenedBackEmfV,
    netFluxRatio: 1,
    idA: 0,
    iqA: (torqueNm / EV_STALL_TORQUE_NM) * EV_MAX_IQ_A,
    torqueNm,
    isFieldWeakeningActive: false,
  };
}
