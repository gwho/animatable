/**
 * Visual (display-rate) shaft angles for the drivetrain cutaway.
 *
 * Real shaft speeds (up to 100 rev/s) alias badly at 60 fps, so the cutaway
 * integrates *display* angles at `speedFactor` × real speed from simulation
 * time. Every meshing angle is then derived from these few integrated angles,
 * so the kinematic ratios stay exact at any display speed.
 * Pure TypeScript — no React, no DOM.
 */
import { rpmToRadPerS, type SimulationState } from '../../../physics';

const FOUR_PI = 4 * Math.PI;
/**
 * EV motor angle wraps after 9 turns: one output-gear turn of the 9:1 train.
 * Wrapping any sooner would jump the intermediate / output gears by a
 * non-integer number of teeth.
 */
const EV_MOTOR_WRAP = 18 * Math.PI;

function mod(value: number, m: number): number {
  const r = value % m;
  return r < 0 ? r + m : r;
}

export interface DisplayAngles {
  /** Crank angle over a full 4-stroke cycle, [0, 4π). */
  crank: number;
  /** Gearbox input shaft / clutch disc, [0, 2π). */
  input: number;
  /** EV rotor, [0, 18π) — see EV_MOTOR_WRAP. */
  evMotor: number;
}

export class DisplayKinematics {
  readonly angles: DisplayAngles = { crank: 0, input: 0, evMotor: 0 };
  private lastTimeS = 0;

  update(state: Readonly<SimulationState>, speedFactor: number): DisplayAngles {
    let dt = state.timeS - this.lastTimeS;
    if (dt < 0) {
      // Simulation was reset: restart from the reference pose.
      this.angles.crank = 0;
      this.angles.input = 0;
      this.angles.evMotor = 0;
      dt = 0;
    }
    this.lastTimeS = state.timeS;
    const k = dt * speedFactor;
    const a = this.angles;
    a.crank = mod(a.crank + rpmToRadPerS(state.ice.engineRpm) * k, FOUR_PI);
    a.input = mod(a.input + rpmToRadPerS(state.ice.inputShaftRpm) * k, 2 * Math.PI);
    a.evMotor = mod(a.evMotor + rpmToRadPerS(state.ev.motorRpm) * k, EV_MOTOR_WRAP);
    return a;
  }
}
