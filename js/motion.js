// Shared by rendering and fixed-step physics. Time is the motion clock;
// motion uses its own clock, independent from the scored attempt timer.
const STILL = Object.freeze({ x: 0, z: 0, vx: 0, vz: 0 });

/** Translation; amplitude in tray units, period seconds, phase radians. */
export function sampleMotion(motion, time = 0) {
  if (!motion || !['x', 'z'].includes(motion.axis) ||
      !Number.isFinite(motion.amplitude) || motion.amplitude < 0 ||
      !Number.isFinite(motion.period) || motion.period <= 0 ||
      !Number.isFinite(motion.phase ?? 0) || !Number.isFinite(time)) return STILL;
  const rate = 2 * Math.PI / motion.period;
  const angle = rate * time + (motion.phase ?? 0);
  let position, velocity;
  if (motion.kind === 'patrol') {
    // Constant-speed traversal, with a short linear acceleration/deceleration
    // at each end. The integrated position is continuous through reversals.
    const cycle = ((angle / (2 * Math.PI)) % 1 + 1) % 1;
    const forward = cycle < 0.5;
    const progress = (forward ? cycle : cycle - 0.5) * 2;
    const ease = 0.10;
    let distance, speed;
    if (progress < ease) {
      distance = progress * progress / (2 * ease * (1 - ease));
      speed = progress / (ease * (1 - ease));
    } else if (progress > 1 - ease) {
      distance = 1 - (1 - progress) ** 2 / (2 * ease * (1 - ease));
      speed = (1 - progress) / (ease * (1 - ease));
    } else {
      distance = (progress - ease / 2) / (1 - ease);
      speed = 1 / (1 - ease);
    }
    position = (forward ? -1 + 2 * distance : 1 - 2 * distance) * motion.amplitude;
    velocity = (forward ? 1 : -1) * 4 * motion.amplitude * speed / motion.period;
  } else {
    position = motion.amplitude * Math.sin(angle);
    velocity = motion.amplitude * rate * Math.cos(angle);
  }
  return motion.axis === 'x'
    ? { x: position, z: 0, vx: velocity, vz: 0 }
    : { x: 0, z: position, vx: 0, vz: velocity };
}
