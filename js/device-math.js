// W3C Device Orientation uses intrinsic Z–X′–Y″ rotations in the device's
// natural screen orientation. Gravity removes alpha/compass dependence and
// stays continuous when the sensor chooses a different Euler representation.
// https://w3c.github.io/deviceorientation/#deviceorientation
// https://www.w3.org/TR/screen-orientation/#current-orientation-angle
const RAD = Math.PI / 180;
const MAX_TILT = 20 * RAD;
const DEADZONE = 0.9 * RAD;
const MIN_FACE_UP = 0.25;
const GRAVITY = 9.80665;
const EPSILON = 1e-10;
const clamp = (value, low = -1, high = 1) => Math.max(low, Math.min(high, value));
const angle = value => ((value % 360) + 360) % 360;
const clean = value => Math.abs(value) < EPSILON ? 0 : value;
const finite = value => typeof value === 'number' && Number.isFinite(value);

function normalizedPose(pose) {
  if (!pose || ![pose.x, pose.y, pose.z, pose.screenAngle].every(finite)) return null;
  const length = Math.hypot(pose.x, pose.y, pose.z);
  if (length < EPSILON || !Number.isFinite(length)) return null;
  return {
    x: clean(pose.x / length), y: clean(pose.y / length), z: clean(pose.z / length),
    screenAngle: angle(pose.screenAngle),
  };
}

function screenPose(naturalX, naturalY, normalZ, screenAngle) {
  const orientation = angle(screenAngle), theta = orientation * RAD;
  return normalizedPose({
    // Screen angle is counterclockwise device rotation from its natural pose.
    x: naturalX * Math.cos(theta) + naturalY * Math.sin(theta),
    y: -naturalX * Math.sin(theta) + naturalY * Math.cos(theta),
    z: normalZ,
    screenAngle: orientation,
  });
}

/** Unit gravity expressed as screen-right, screen-down, and face-up normal. */
export function sampleDevicePose(event, screenAngle = 0) {
  if (!event || !finite(event.beta) || !finite(event.gamma) || !finite(screenAngle)) return null;
  const beta = angle(event.beta) * RAD;
  const gamma = angle(event.gamma) * RAD;
  const naturalX = Math.cos(beta) * Math.sin(gamma);
  const naturalY = Math.sin(beta);
  return screenPose(naturalX, naturalY, Math.cos(beta) * Math.cos(gamma), screenAngle);
}

/**
 * Motion-event gravity in the same screen coordinates as sampleDevicePose.
 * gravitySign is +1 for W3C/Android, -1 for current iOS WebKit. The controller
 * selects it once; never infer polarity per sample, which would hide face-down
 * poses and reverse steering when crossing vertical.
 * https://w3c.github.io/deviceorientation/#devicemotion
 * https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm
 */
export function sampleDeviceGravity(event, screenAngle = 0, gravitySign = 1) {
  const total = event?.accelerationIncludingGravity;
  if (!total || ![total.x, total.y, total.z, screenAngle].every(finite)) return null;
  if (gravitySign !== 1 && gravitySign !== -1) return null;
  const credible = vector => {
    const magnitude = Math.hypot(vector.x, vector.y, vector.z);
    return magnitude >= GRAVITY * 0.75 && magnitude <= GRAVITY * 1.25;
  };
  // Free fall and large acceleration spikes are not usable tilt samples.
  if (!credible(total)) return null;
  let { x, y, z } = total;
  const linear = event.acceleration;
  if (linear && [linear.x, linear.y, linear.z].every(finite)) {
    if (Math.hypot(linear.x, linear.y, linear.z) > GRAVITY * 0.45) return null;
    x -= linear.x; y -= linear.y; z -= linear.z;
  }
  // Some browsers cannot separate user motion; ignore an incomplete vector as
  // a whole. Magnitude filtering then provides a conservative shake guard.
  if (!credible({ x, y, z })) return null;
  return screenPose(-x * gravitySign, y * gravitySign, z * gravitySign, screenAngle);
}

export function averageDevicePoses(samples) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const poses = samples.map(normalizedPose);
  if (poses.some(pose => !pose)) return null;
  const screenAngle = poses[0].screenAngle;
  if (poses.some(pose => pose.screenAngle !== screenAngle)) return null;
  return normalizedPose({
    x: poses.reduce((total, pose) => total + pose.x, 0) / poses.length,
    y: poses.reduce((total, pose) => total + pose.y, 0) / poses.length,
    z: poses.reduce((total, pose) => total + pose.z, 0) / poses.length,
    screenAngle,
  });
}

function scaledAngle(value) {
  const magnitude = Math.abs(value);
  if (magnitude <= DEADZONE) return 0;
  return Math.sign(value) * Math.min(1, (magnitude - DEADZONE) / (MAX_TILT - DEADZONE));
}

/** Calibrated angular slopes, bounded at approximately 20° per screen axis. */
export function devicePoseToTilt(pose, neutral) {
  const current = normalizedPose(pose);
  const reference = normalizedPose(neutral);
  if (!current || !reference || current.screenAngle !== reference.screenAngle) return { x: 0, y: 0 };
  // A phone held like a tray has a useful face-up normal. Near vertical, the
  // controller asks for a flatter pose; returning neutral avoids a singular jump.
  if (current.z < MIN_FACE_UP || reference.z < MIN_FACE_UP) return { x: 0, y: 0 };
  return {
    x: scaledAngle(Math.atan2(current.x, current.z) - Math.atan2(reference.x, reference.z)),
    y: scaledAngle(Math.atan2(current.y, current.z) - Math.atan2(reference.y, reference.z)),
  };
}

export function smoothDeviceTilt(previous, target, elapsedMs) {
  const elapsed = finite(elapsedMs) ? clamp(elapsedMs, 0, 200) : 0;
  const alpha = 1 - Math.exp(-elapsed / 85);
  const component = axis => {
    const before = finite(previous?.[axis]) ? clamp(previous[axis]) : 0;
    const next = finite(target?.[axis]) ? clamp(target[axis]) : 0;
    return clean(clamp(before + (next - before) * alpha));
  };
  return { x: component('x'), y: component('y') };
}
