import { averageDevicePoses, devicePoseToTilt, sampleDeviceGravity, sampleDevicePose } from './device-math.js?v=11';

const SENSOR_TIMEOUT = 4000;
const CALIBRATION_TIME = 400;
const STABLE_DOT = Math.cos(3 * Math.PI / 180);

/** Opt-in phone orientation input. Sensor values stay in this page. */
export function createDeviceController({
  onTilt = () => {}, onActive = () => {}, onStatus = () => {},
  host = globalThis.window, doc = globalThis.document,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let enabled = false, disposed = false, listening = false, generation = 0;
  let watchdog = null, calibrationTimer = null, neutral = null, samples = [];
  let latestReading = null, screenAngle = 0, lastStatus = '', sensorType = 'orientation', gravitySign = 1;
  const removeListeners = [];
  const supported = () => Boolean(host?.isSecureContext && (host.DeviceOrientationEvent || host.DeviceMotionEvent) && host.addEventListener);

  function status(kind, message, details = {}) {
    const key = `${kind}:${details.code || ''}:${message}`;
    if (key === lastStatus) return;
    lastStatus = key;
    onStatus({ kind, message, ...details });
  }
  function setActive(value) {
    if (enabled === value) return;
    enabled = value;
    onActive(value);
  }
  function angle() {
    const value = Number.isFinite(host?.screen?.orientation?.angle) ? host.screen.orientation.angle
      : Number.isFinite(host?.orientation) ? host.orientation : 0;
    return ((value % 360) + 360) % 360;
  }
  function listen(target, type, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    removeListeners.push(() => target.removeEventListener(type, handler));
  }
  function clearCalibration() {
    clearTimer(calibrationTimer);
    calibrationTimer = null;
    neutral = null;
    samples = [];
    onTilt(0, 0);
  }
  function stop() {
    generation += 1;
    clearTimer(watchdog);
    watchdog = null;
    for (const remove of removeListeners.splice(0)) remove();
    listening = false;
    latestReading = null;
    clearCalibration();
    setActive(false);
    status('off', 'Phone tilt off.');
  }
  function fail(message, code, recovery) {
    stop();
    status('error', message, { code, recovery });
  }
  function sensorPolicyBlocked() {
    const policy = doc?.permissionsPolicy || doc?.featurePolicy;
    if (typeof policy?.allowsFeature !== 'function') return false;
    try {
      const known = typeof policy.features === 'function' ? new Set(policy.features()) : null;
      // Motion needs only these two features. In WebKit, orientation also needs
      // magnetometer delegation; choosing motion avoids that extra requirement.
      return ['accelerometer', 'gyroscope'].some(feature => (!known || known.has(feature)) && policy.allowsFeature(feature) === false);
    } catch { return false; } // Policy introspection is absent in some browsers.
  }
  function chooseSensor() {
    const Motion = host.DeviceMotionEvent;
    const useMotion = Boolean(Motion && (typeof Motion.requestPermission === 'function' || !host.DeviceOrientationEvent));
    sensorType = useMotion ? 'motion' : 'orientation';
    const navigator = host.navigator || {};
    const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // Core Motion's gravity convention is opposite to W3C/Android. Keep this
    // choice fixed for the session so a face-down phone is not silently flipped.
    gravitySign = appleMobile ? -1 : 1;
    return useMotion ? Motion : host.DeviceOrientationEvent;
  }
  function poseFromReading(reading) {
    return sensorType === 'motion' ? sampleDeviceGravity(reading, screenAngle, gravitySign) : sampleDevicePose(reading, screenAngle);
  }
  function watch(session) {
    if (watchdog !== null) return;
    watchdog = setTimer(() => {
      if (enabled && session === generation) fail('No motion data here. Try opening this site in your browser. Drag still works.', 'no-data', 'browser');
    }, SENSOR_TIMEOUT);
  }
  function recenter() {
    if (!enabled || !listening) return false;
    screenAngle = angle();
    clearCalibration();
    status('calibrating', 'Hold your phone still for a moment…');
    // Unchanged orientation may produce no events. Reuse the last valid reading,
    // projected into the current screen orientation, to calibrate a still phone.
    if (latestReading) acceptPose(poseFromReading(latestReading));
    return true;
  }
  function onRotation() {
    if (angle() !== screenAngle) recenter();
  }
  function acceptPose(pose) {
    clearTimer(watchdog);
    watchdog = null;
    if (pose.z < 0.25) {
      clearCalibration();
      status('calibrating', 'Hold your phone a little flatter.');
      return;
    }
    if (!neutral) {
      const anchor = samples[0];
      if (!anchor || pose.x * anchor.x + pose.y * anchor.y + pose.z * anchor.z < STABLE_DOT) {
        clearTimer(calibrationTimer);
        samples = [pose];
        const batch = samples, session = generation;
        // Orientation events are change-driven, so stability is measured by a
        // timer rather than requiring more samples from a stationary phone.
        calibrationTimer = setTimer(() => {
          if (!enabled || session !== generation || samples !== batch) return;
          if (doc?.hidden) { stop(); return; }
          calibrationTimer = null;
          neutral = averageDevicePoses(batch);
          samples = [];
          onTilt(0, 0);
          if (neutral) status('tracking', 'Tilt your phone to move the marble.');
        }, CALIBRATION_TIME);
      } else samples.push(pose);
      onTilt(0, 0);
      status('calibrating', 'Hold your phone still for a moment…');
      return;
    }
    // The app smooths targets on its render loop. A single changed reading must
    // supply the full target even if the sensor stays silent at this new angle.
    const target = devicePoseToTilt(pose, neutral);
    onTilt(target.x, target.y);
  }
  function onSample(event, session) {
    if (!enabled || session !== generation) return;
    if (doc?.hidden) { stop(); return; }
    onRotation();
    const pose = poseFromReading(event);
    if (!pose) {
      latestReading = null;
      clearCalibration();
      status('calibrating', 'Waiting for motion data…');
      watch(session);
      return;
    }
    const copyVector = vector => vector ? { x: vector.x, y: vector.y, z: vector.z } : null;
    latestReading = sensorType === 'motion'
      ? { accelerationIncludingGravity: copyVector(event.accelerationIncludingGravity), acceleration: copyVector(event.acceleration) }
      : { beta: event.beta, gamma: event.gamma };
    acceptPose(pose);
  }
  async function start() {
    if (disposed) return false;
    if (enabled) return true;
    const session = ++generation;
    setActive(true);
    clearCalibration();
    try {
      if (!host?.isSecureContext) {
        fail('Phone tilt needs HTTPS. Drag still works.', 'insecure');
        return false;
      }
      if (!supported()) {
        fail('Phone tilt is unavailable here. Drag still works.', 'unsupported', 'browser');
        return false;
      }
      const Sensor = chooseSensor();
      if (sensorPolicyBlocked()) {
        fail('Phone motion is blocked in this view. Open this site in Safari or Chrome. Drag still works.', 'policy-blocked', 'browser');
        return false;
      }
      if (doc?.hidden) { stop(); return false; }
      listen(doc, 'visibilitychange', () => { if (doc.hidden) stop(); });
      listen(host, 'pagehide', stop);
      if (typeof Sensor.requestPermission === 'function') {
        status('permission', 'Allow motion access to tilt your phone.');
        // Keep this call before the first await, inside the button's activation.
        // Request one chosen API only; a denied decision never triggers another
        // permission request. Motion avoids WebKit's compass-policy requirement.
        const permission = Sensor.requestPermission();
        const result = await permission;
        if (session !== generation) return false;
        if (result !== 'granted') {
          fail('Phone motion is blocked here. Open this site in Safari or Chrome. Drag still works.', 'not-allowed', 'browser');
          return false;
        }
      }
      if (session !== generation || doc?.hidden) { if (enabled) stop(); return false; }
      listening = true;
      screenAngle = angle();
      listen(host, sensorType === 'motion' ? 'devicemotion' : 'deviceorientation', event => onSample(event, session));
      listen(host, 'orientationchange', onRotation);
      listen(host.screen?.orientation, 'change', onRotation);
      status('calibrating', 'Hold your phone still for a moment…');
      watch(session);
      return true;
    } catch {
      if (session === generation) fail('Phone motion could not start here. Open this site in Safari or Chrome. Drag still works.', 'not-allowed', 'browser');
      return false;
    }
  }
  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
  }
  return { start, stop, recenter, dispose, get active() { return enabled; }, get supported() { return supported(); } };
}
