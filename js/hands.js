import { averageHandPoses, poseToTilt, sampleHandPose, smoothTilt } from './hand-math.js';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const FRAME_INTERVAL = 1000 / 20;
const CALIBRATION_FRAMES = 10;

/**
 * Optional local-only camera input. Calling start() is the only path that
 * requests camera permission. No frame, landmark, or recording is uploaded.
 */
export function createHandController({ video, canvas, onTilt = () => {}, onStatus = () => {}, onActive = () => {} }) {
  let enabled = false;
  let generation = 0;
  let mediaStream = null;
  let detector = null;
  let frame = 0;
  let lastVideoTime = -1;
  let lastDetection = 0;
  let lastStatus = '';
  let neutral = null;
  let samples = [];
  let pendingMode = null;
  let smoothed = { x: 0, y: 0 };
  const context = canvas.getContext('2d');

  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.style.transform = 'scaleX(-1)';

  function status(kind, message) {
    const key = `${kind}:${message}`;
    if (key === lastStatus) return;
    lastStatus = key;
    onStatus({ kind, message });
  }

  function setActive(value) {
    if (enabled === value) return;
    enabled = value;
    onActive(value);
  }

  function clearCalibration() {
    neutral = null;
    samples = [];
    pendingMode = null;
    smoothed = { x: 0, y: 0 };
    onTilt(0, 0);
  }

  function clearPreview() {
    context?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function releaseStream(stream) {
    for (const track of stream?.getTracks() || []) track.stop();
  }

  function stop() {
    generation += 1;
    cancelAnimationFrame(frame);
    frame = 0;
    releaseStream(mediaStream);
    mediaStream = null;
    video.pause();
    video.srcObject = null;
    if (detector) {
      try { detector.close(); } catch { /* Release the UI even after a lost graphics context. */ }
      detector = null;
    }
    clearCalibration();
    clearPreview();
    setActive(false);
    status('off', 'Camera off. Mouse controls are ready.');
  }

  function fail(error) {
    stop();
    const messages = {
      NotAllowedError: 'Camera access wasn’t allowed. You can still use your mouse.',
      SecurityError: 'Camera access is blocked here. You can still use your mouse.',
      NotFoundError: 'No camera found. You can still use your mouse.',
      NotReadableError: 'The camera is busy. Close other camera apps and try again.',
      OverconstrainedError: 'This camera couldn’t start. You can still use your mouse.',
      AbortError: 'The camera was interrupted. You can still use your mouse.',
      UnsupportedCamera: 'Camera controls need a supported browser on HTTPS or localhost.',
      VideoStartTimeout: 'The camera didn’t start. You can still use your mouse.',
      CameraEnded: 'The camera disconnected. Mouse controls are ready.',
    };
    status('error', messages[error?.name] || 'Hand tracking couldn’t load. Try again, or use your mouse.');
  }

  async function makeDetector() {
    const { FilesetResolver, HandLandmarker } = await import('../vendor/mediapipe/vision_bundle.mjs');
    const wasmDirectory = new URL('../vendor/mediapipe/wasm/', import.meta.url).href.replace(/\/$/, '');
    const vision = await FilesetResolver.forVisionTasks(wasmDirectory);
    const options = {
      baseOptions: {
        modelAssetPath: new URL('../vendor/mediapipe/hand_landmarker.task', import.meta.url).href,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    };
    try {
      return await HandLandmarker.createFromOptions(vision, options);
    } catch {
      // Devices without the required graphics support can run the same model
      // locally on CPU. Nothing is sent to a remote inference service.
      return HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      });
    }
  }

  function drawHands(landmarks) {
    if (!context) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    clearPreview();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(1.8, width / 260);
    context.strokeStyle = 'rgba(155, 180, 255, 0.95)';
    context.fillStyle = 'rgba(238, 244, 255, 0.98)';
    for (const hand of landmarks) {
      context.beginPath();
      for (const [from, to] of CONNECTIONS) {
        context.moveTo((1 - hand[from].x) * width, hand[from].y * height);
        context.lineTo((1 - hand[to].x) * width, hand[to].y * height);
      }
      context.stroke();
      for (const index of [0, 4, 8, 12, 16, 20]) {
        context.beginPath();
        context.arc((1 - hand[index].x) * width, hand[index].y * height, width / 140, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  function handleResult(result, elapsedMs) {
    const landmarks = result.landmarks || [];
    drawHands(landmarks);
    const pose = sampleHandPose(landmarks);
    if (!pose) {
      samples = [];
      smoothed = smoothTilt(smoothed, { x: 0, y: 0 }, elapsedMs);
      onTilt(smoothed.x, smoothed.y);
      status('searching', 'Bring one or both hands into view.');
      return;
    }
    if (!neutral || neutral.mode !== pose.mode) {
      if (pendingMode !== pose.mode) {
        pendingMode = pose.mode;
        samples = [];
      }
      samples.push(pose);
      smoothed = { x: 0, y: 0 };
      onTilt(0, 0);
      status('searching', 'Hold your hands still for a moment…');
      if (samples.length < CALIBRATION_FRAMES) return;
      neutral = averageHandPoses(samples);
      samples = [];
    }
    const target = poseToTilt(pose, neutral);
    smoothed = smoothTilt(smoothed, target, elapsedMs);
    onTilt(smoothed.x, smoothed.y);
    status('tracking', pose.mode === 2
      ? 'Raise or lower your hands to tilt.'
      : 'Move your hand to tilt.');
  }

  function tick(timestamp, session) {
    if (!enabled || session !== generation || !detector) return;
    if (timestamp - lastDetection >= FRAME_INTERVAL && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      const elapsed = lastDetection ? Math.min(timestamp - lastDetection, 200) : FRAME_INTERVAL;
      lastDetection = timestamp;
      lastVideoTime = video.currentTime;
      try {
        // detectForVideo is synchronous. Throttling and one RAF loop avoid
        // overlapping inference and leave time for the 3D scene to render.
        handleResult(detector.detectForVideo(video, timestamp), elapsed);
      } catch (error) {
        fail(error);
        return;
      }
    }
    frame = requestAnimationFrame((time) => tick(time, session));
  }

  async function playVideo() {
    let timeout;
    try {
      await Promise.race([
        video.play(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Object.assign(new Error('Camera did not start'), { name: 'VideoStartTimeout' })), 12000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function start() {
    if (enabled) return true;
    const session = ++generation;
    setActive(true);
    clearCalibration();
    status('loading', 'Allow camera access to use your hands.');
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('Camera unavailable'), { name: 'UnsupportedCamera' });
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      if (session !== generation) {
        releaseStream(stream);
        return false;
      }
      mediaStream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (session === generation) fail({ name: 'CameraEnded' });
        }, { once: true });
      }
      video.srcObject = stream;
      await playVideo();
      if (session !== generation) return false;
      status('loading', 'Loading hand tracking…');
      const loadedDetector = await makeDetector();
      if (session !== generation) {
        loadedDetector.close();
        return false;
      }
      detector = loadedDetector;
      lastVideoTime = -1;
      lastDetection = 0;
      status('searching', 'Bring one or both hands into view.');
      frame = requestAnimationFrame((timestamp) => tick(timestamp, session));
      return true;
    } catch (error) {
      if (session === generation) fail(error);
      return false;
    }
  }

  function recenter() {
    clearCalibration();
    if (enabled) status('searching', 'Hold your hands still for a moment…');
  }

  const onVisibilityChange = () => {
    if (document.hidden && enabled) stop();
  };
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    start,
    stop,
    recenter,
    get active() { return enabled; },
    dispose() {
      stop();
      window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
