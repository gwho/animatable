/**
 * Shared simulation interfaces. Pure TypeScript — no React, no DOM.
 */
import type { EvElectromagneticState } from './powertrains';

export type IceGearMode = 'auto' | 'locked-4th';
export type IceClutchMode = 'auto-slip' | 'locked-clutch';
/** P = park pawl, R = reverse, N = neutral, D = drive. Shared by both vehicles. */
export type GearSelector = 'P' | 'R' | 'N' | 'D';
export type ClutchState = 'locked' | 'slipping' | 'open';
/** ABC = forward rotating field; ACB = two phases swapped → reverse rotation. */
export type PhaseSequence = 'ABC' | 'ACB';

export type ModuleId = 'drag-strip' | 'drivetrain' | 'magnetic-field' | 'reverse';

export interface SimulationControls {
  /** Accelerator pedal position, 0–1. */
  throttle: number;
  /** Road grade in percent, 0–15. */
  gradePercent: number;
  iceGearMode: IceGearMode;
  iceClutchMode: IceClutchMode;
  fieldWeakening: boolean;
  gearSelector: GearSelector;
  /** Simulation time multiplier (slow motion < 1 < fast forward). */
  timeScale: number;
}

export interface ForceBreakdown {
  /** Wheel torque / wheel radius (N, signed along the road). */
  tractiveN: number;
  /** Aerodynamic drag, always opposing motion (N). */
  aeroN: number;
  /** Gravity component along the slope, negative = pulling backwards (N). */
  gradeN: number;
  /** Rolling resistance / static friction, opposing motion or impending motion (N). */
  rollingN: number;
  netN: number;
  accelerationMps2: number;
}

export interface VehicleKinematics {
  /** Signed longitudinal velocity (m/s); negative = rolling backwards. */
  velocityMps: number;
  accelerationMps2: number;
  /** Signed position along the track (m). */
  distanceM: number;
  /** Road-wheel rotation angle, wrapped to [0, 2π). */
  wheelAngleRad: number;
  wheelTorqueNm: number;
  forces: ForceBreakdown;
}

export interface IceDrivetrainState {
  /** Currently engaged forward gear (1–6). Ignored while in R/N/P. */
  gear: number;
  /** Gear being shifted into; equals `gear` when not shifting. */
  targetGear: number;
  engineRpm: number;
  /** Brake torque produced by the engine and delivered into the clutch (Nm). */
  engineTorqueNm: number;
  isShifting: boolean;
  /** Remaining torque-interrupt time of the current upshift (s). */
  shiftTimerS: number;
  isStalled: boolean;
  clutchState: ClutchState;
  /** Heat being dissipated in the slipping clutch (W). */
  clutchSlipPowerW: number;
  clutchTempC: number;
  /** Total heat dumped into the clutch since reset (J). */
  clutchEnergyJ: number;
  /**
   * Gearbox input-shaft speed (rpm): the clutch-disc side. Equals engine rpm
   * when the clutch is locked; lower while it slips. In N/P it free-spins with
   * the engine (clutch engaged, gearbox disconnected).
   */
  inputShaftRpm: number;
}

export interface IceVehicleState extends VehicleKinematics, IceDrivetrainState {
  /** Crankshaft angle, wrapped to [0, 2π). */
  crankAngleRad: number;
}

export interface EvDrivetrainState {
  /** Signed rotor speed (rpm); negative while turning backwards. */
  motorRpm: number;
  motorTorqueNm: number;
  phaseSequence: PhaseSequence;
  em: EvElectromagneticState;
}

export interface EvVehicleState extends VehicleKinematics, EvDrivetrainState {
  /** Mechanical rotor angle, wrapped to [0, 2π). */
  rotorAngleRad: number;
  /** Electrical angle = pole pairs × mechanical angle, wrapped. */
  electricalAngleRad: number;
  /** Instantaneous electrical angles of phases A, B, C (rad). Mutated in place. */
  phaseAnglesRad: [number, number, number];
}

export interface SimulationState {
  timeS: number;
  stepCount: number;
  isPlaying: boolean;
  activeModule: ModuleId;
  controls: Readonly<SimulationControls>;
  ice: IceVehicleState;
  ev: EvVehicleState;
}

/**
 * Discrete, render-worthy slice of the simulation. A new object reference is
 * emitted only when one of these fields changes, so React re-renders stay rare.
 */
export interface UiSnapshot {
  readonly isPlaying: boolean;
  readonly activeModule: ModuleId;
  readonly controls: Readonly<SimulationControls>;
  readonly ice: {
    readonly gear: number;
    readonly isShifting: boolean;
    readonly isStalled: boolean;
  };
}
