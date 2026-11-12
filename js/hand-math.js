// Camera coordinates are mirrored to match the preview. Positive x/y steer
// toward the right/bottom of the page, matching the pointer controls.
const PALM_POINTS = [0, 5, 9, 13, 17];

export function clamp(value, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function palmCenter(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 18) return null;
  const points = PALM_POINTS.map((index) => landmarks[index]);
  if (points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return null;
  return {
    x: 1 - points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  };
}

export function sampleHandPose(landmarks) {
  const palms = (landmarks || []).map(palmCenter).filter(Boolean).slice(0, 2);
  if (!palms.length) return null;
  if (palms.length === 1) return { mode: 1, x: palms[0].x, y: palms[0].y };
  palms.sort((a, b) => a.x - b.x);
  const [left, right] = palms;
  return {
    mode: 2,
    // Lowering the right hand lowers the tray's right edge.
    x: (right.y - left.y) / Math.max(0.28, right.x - left.x),
    y: (left.y + right.y) / 2,
  };
}

export function averageHandPoses(samples) {
  if (!samples.length) return null;
  const mode = samples[0].mode;
  if (samples.some((sample) => sample.mode !== mode)) return null;
  return {
    mode,
    x: samples.reduce((total, pose) => total + pose.x, 0) / samples.length,
    y: samples.reduce((total, pose) => total + pose.y, 0) / samples.length,
  };
}

export function applyDeadzone(value, threshold = 0.06) {
  const limited = clamp(value);
  if (Math.abs(limited) <= threshold) return 0;
  return Math.sign(limited) * (Math.abs(limited) - threshold) / (1 - threshold);
}

export function poseToTilt(pose, neutral) {
  if (!pose || !neutral || pose.mode !== neutral.mode) return { x: 0, y: 0 };
  return {
    x: applyDeadzone((pose.x - neutral.x) / (pose.mode === 2 ? 0.55 : 0.22)),
    y: applyDeadzone((pose.y - neutral.y) / 0.22),
  };
}

export function smoothTilt(previous, next, elapsedMs) {
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / 95);
  return {
    x: clamp(previous.x + (next.x - previous.x) * alpha),
    y: clamp(previous.y + (next.y - previous.y) * alpha),
  };
}
