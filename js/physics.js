import { LEVELS } from './levels.js?v=18';
import { sampleMotion } from './motion.js?v=18';

// The simulation and renderer consume the same immutable course geometry.
export const layout = LEVELS[0].layout;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

const STEP = 1 / 120;
const MAX_FRAME = 0.1;
const MAX_SPEED = 3.4;
const GRAVITY = 7.8;
const DAMPING = 1.25;
const RESTITUTION = 0.24;
const GOAL_HOLD = 0.25;
const FALL_DURATION = 0.4;
const EPSILON = 1e-6;

// Capture the first hole crossed by the marble center, including fast passes
// whose endpoints are both outside its inner opening.
function crossedHazard(from, to, hazards) {
  if (!hazards?.length) return null;
  const dx = to.x - from.x, dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  let first = null, firstTime = Infinity;
  for (const hole of hazards) {
    const radius = hole.radius * 0.65;
    const x = from.x - hole.x, z = from.z - hole.z;
    const outside = x * x + z * z - radius * radius;
    let time = 0;
    if (outside > 0) {
      if (lengthSquared <= EPSILON * EPSILON) continue;
      const projection = x * dx + z * dz;
      const discriminant = projection * projection - lengthSquared * outside;
      if (discriminant < 0) continue;
      time = (-projection - Math.sqrt(discriminant)) / lengthSquared;
      if (time < 0 || time > 1) continue;
    }
    if (time < firstTime) { firstTime = time; first = hole; }
  }
  return first ? {hole: first, x: from.x + dx * firstTime, z: from.z + dz * firstTime} : null;
}

function reflect(state, nx, nz, restitution = RESTITUTION, vx = 0, vz = 0) {
  const speed = (state.vx - vx) * nx + (state.vz - vz) * nz;
  if (speed < 0) {
    state.vx -= (1 + restitution) * speed * nx;
    state.vz -= (1 + restitution) * speed * nz;
  }
}

// Project the ball center into the rounded rectangle inset by the marble radius.
function constrainOuterWall(state, layout) {
  const limit = layout.half - layout.radius;
  if (state.x < -limit) { state.x = -limit; reflect(state, 1, 0); }
  if (state.x > limit) { state.x = limit; reflect(state, -1, 0); }
  if (state.z < -limit) { state.z = -limit; reflect(state, 0, 1); }
  if (state.z > limit) { state.z = limit; reflect(state, 0, -1); }

  const core = layout.half - layout.corner;
  const radius = layout.corner - layout.radius;
  const dx = Math.abs(state.x) - core;
  const dz = Math.abs(state.z) - core;
  if (dx <= 0 || dz <= 0) return;
  const distance = Math.hypot(dx, dz);
  if (distance <= radius) return;
  const sx = Math.sign(state.x);
  const sz = Math.sign(state.z);
  const nx = (dx / distance) * sx;
  const nz = (dz / distance) * sz;
  state.x = sx * core + nx * radius;
  state.z = sz * core + nz * radius;
  reflect(state, -nx, -nz);
}

function constrainBarriers(state, layout, motions) {
  for (const [index, barrier] of layout.barriers.entries()) {
    const motion = motions[index];
    const required = barrier.radius + layout.radius;
    for (let i = 1; i < barrier.points.length; i++) {
      const a = barrier.points[i - 1];
      const b = barrier.points[i];
      const sx = b.x - a.x;
      const sz = b.z - a.z;
      const t = clamp(((state.x - a.x - motion.x) * sx + (state.z - a.z - motion.z) * sz) / (sx * sx + sz * sz), 0, 1);
      const px = a.x + motion.x + sx * t;
      const pz = a.z + motion.z + sz * t;
      const dx = state.x - px;
      const dz = state.z - pz;
      const distance = Math.hypot(dx, dz);
      if (distance >= required) continue;
      // A deterministic normal handles an exact centerline overlap on reset/debug input.
      const length = Math.hypot(sx, sz);
      const nx = distance > EPSILON ? dx / distance : -sz / length;
      const nz = distance > EPSILON ? dz / distance : sx / length;
      state.x = px + nx * (required + EPSILON);
      state.z = pz + nz * (required + EPSILON);
      reflect(state, nx, nz, RESTITUTION, motion.vx, motion.vz);
    }
  }
}

function constrainBumpers(state, layout, motions) {
  let touched = false;
  for (const [index, bumper] of layout.bumpers.entries()) {
    const motion = motions[index];
    const x = bumper.x + motion.x, z = bumper.z + motion.z;
    const dx = state.x - x;
    const dz = state.z - z;
    const distance = Math.hypot(dx, dz);
    const required = bumper.radius + layout.radius;
    if (distance >= required) continue;
    touched = true;
    // The velocity supplies a stable escape direction for an exact center overlap.
    const vx = state.vx - motion.vx, vz = state.vz - motion.vz;
    const speed = Math.hypot(vx, vz);
    const nx = distance > EPSILON ? dx / distance : speed > EPSILON ? -vx / speed : 1;
    const nz = distance > EPSILON ? dz / distance : speed > EPSILON ? -vz / speed : 0;
    state.x = x + nx * (required + EPSILON);
    state.z = z + nz * (required + EPSILON);
    reflect(state, nx, nz, 0.38, motion.vx, motion.vz);
  }
  return touched;
}

function segmentDistanceSquared(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > EPSILON * EPSILON ? clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared, 0, 1) : 0;
  return (point.x - a.x - t * dx) ** 2 + (point.z - a.z - t * dz) ** 2;
}

function hasClearPosition(point, course, barrierMotions, bumperMotions) {
  const core = course.half - course.corner, limit = course.half - course.radius;
  if (Math.abs(point.x) > limit + EPSILON || Math.abs(point.z) > limit + EPSILON) return false;
  if (Math.hypot(Math.max(0, Math.abs(point.x) - core), Math.max(0, Math.abs(point.z) - core)) > course.corner - course.radius + EPSILON) return false;
  for (const [index, wall] of course.barriers.entries()) {
    const offset = barrierMotions[index], relative = {x: point.x - offset.x, z: point.z - offset.z};
    const required = wall.radius + course.radius - EPSILON;
    for (let segment = 1; segment < wall.points.length; segment++) {
      if (segmentDistanceSquared(relative, wall.points[segment - 1], wall.points[segment]) < required * required) return false;
    }
  }
  for (const [index, bumper] of course.bumpers.entries()) {
    const offset = bumperMotions[index];
    if (Math.hypot(point.x - bumper.x - offset.x, point.z - bumper.z - offset.z) < course.radius + bumper.radius - EPSILON) return false;
  }
  return true;
}

function segmentsDistanceSquared(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 &&
      Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
      Math.max(a.z, b.z) >= Math.min(c.z, d.z) && Math.max(c.z, d.z) >= Math.min(a.z, b.z)) return 0;
  return Math.min(segmentDistanceSquared(a, c, d), segmentDistanceSquared(b, c, d), segmentDistanceSquared(c, a, b), segmentDistanceSquared(d, a, b));
}

function clearEscapePath(from, to, course, barrierMotions) {
  for (const [index, wall] of course.barriers.entries()) {
    const offset = barrierMotions[index];
    const a = {x: from.x - offset.x, z: from.z - offset.z}, b = {x: to.x - offset.x, z: to.z - offset.z};
    const required = wall.radius + course.radius - EPSILON;
    for (let segment = 1; segment < wall.points.length; segment++) {
      if (segmentsDistanceSquared(a, b, wall.points[segment - 1], wall.points[segment]) < required * required) return false;
    }
  }
  return true;
}

// A patrol can close a side gap to less than one marble width. Slide around its
// circular contact instead of alternating projections into the puck and wall.
// Every escape segment is checked against the fixed maze, preventing shortcuts.
function escapePuckContact(state, previous, course, barrierMotions, bumperMotions, dt) {
  if (hasClearPosition(state, course, barrierMotions, bumperMotions)) return;
  let best = null, bestDistance = Infinity;
  for (const [index, bumper] of course.bumpers.entries()) {
    const offset = bumperMotions[index], x = bumper.x + offset.x, z = bumper.z + offset.z;
    const radius = bumper.radius + course.radius + EPSILON * 8;
    if (Math.hypot(state.x - x, state.z - z) > radius + 0.15) continue;
    const angle = Math.atan2(previous.z - z, previous.x - x);
    for (let sample = 0; sample < 96; sample++) {
      const rotation = Math.ceil(sample / 2) * (sample % 2 ? 1 : -1) * 2 * Math.PI / 96;
      const point = {x: x + Math.cos(angle + rotation) * radius, z: z + Math.sin(angle + rotation) * radius};
      const distance = (point.x - previous.x) ** 2 + (point.z - previous.z) ** 2;
      if (distance >= bestDistance || !hasClearPosition(point, course, barrierMotions, bumperMotions)) continue;
      if (!clearEscapePath(previous, point, course, barrierMotions)) continue;
      best = point; bestDistance = distance;
    }
  }
  if (!best) return;
  state.x = best.x; state.z = best.z;
  state.vx = (best.x - previous.x) / dt;
  state.vz = (best.z - previous.z) / dt;
  const speed = Math.hypot(state.vx, state.vz);
  if (speed > MAX_SPEED) { state.vx *= MAX_SPEED / speed; state.vz *= MAX_SPEED / speed; }
}

export function createSimulation(layoutArg = layout) {
  const course = layoutArg;
  const state = {};
  let remainder = 0;
  let heldInGoal = 0;

  function reset() {
    Object.assign(state, {
      x: course.start.x, z: course.start.z,
      vx: 0, vz: 0,
      elapsed: 0, motionTime: 0, started: false, won: false, goalProgress: 0,
      falling: false, fallProgress: 0, fallX: course.start.x, fallZ: course.start.z, respawns: 0,
    });
    remainder = 0;
    heldInGoal = 0;
    return state;
  }

  function integrate(dt, tiltX, tiltZ) {
    state.elapsed += dt;
    state.motionTime += dt;
    if (state.falling) {
      state.vx = state.vz = 0;
      state.fallProgress = Math.min(1, state.fallProgress + dt / FALL_DURATION);
      if (state.fallProgress + EPSILON >= 1) {
        state.x = course.start.x; state.z = course.start.z;
        state.falling = false; state.fallProgress = 0;
        state.fallX = course.start.x; state.fallZ = course.start.z;
        state.respawns++;
      }
      return;
    }
    const previous = {x: state.x, z: state.z};
    const time = state.motionTime;
    const barrierMotions = course.barriers.map(barrier => sampleMotion(barrier.motion, time));
    const bumperMotions = course.bumpers.map(bumper => sampleMotion(bumper.motion, time));
    const goalMotion = sampleMotion(course.goal.motion, time);
    const goalX = course.goal.x + goalMotion.x, goalZ = course.goal.z + goalMotion.z;
    state.vx += tiltX * GRAVITY * dt;
    state.vz += tiltZ * GRAVITY * dt;
    const friction = Math.exp(-DAMPING * dt);
    state.vx *= friction;
    state.vz *= friction;

    // A shallow pocket softly gathers a slow marble; fast passes still need correction.
    const gx = goalX - state.x;
    const gz = goalZ - state.z;
    const relativeX = state.vx - goalMotion.vx, relativeZ = state.vz - goalMotion.vz;
    if (Math.hypot(gx, gz) < course.goal.radius && Math.hypot(relativeX, relativeZ) < 1.65) {
      state.vx = goalMotion.vx + (relativeX + gx * 18 * dt) * Math.exp(-7 * dt);
      state.vz = goalMotion.vz + (relativeZ + gz * 18 * dt) * Math.exp(-7 * dt);
    }

    const speed = Math.hypot(state.vx, state.vz);
    if (speed > MAX_SPEED) {
      state.vx *= MAX_SPEED / speed;
      state.vz *= MAX_SPEED / speed;
    }
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    // Repeated projection resolves joints where a barrier meets the tray's boundary.
    let puckContact = false;
    for (let i = 0; i < 4; i++) {
      constrainBarriers(state, course, barrierMotions);
      puckContact = constrainBumpers(state, course, bumperMotions) || puckContact;
      constrainOuterWall(state, course);
    }
    if (puckContact) escapePuckContact(state, previous, course, barrierMotions, bumperMotions, dt);

    const capture = crossedHazard(previous, state, course.hazards);
    if (capture) {
      state.x = capture.x; state.z = capture.z;
      state.vx = state.vz = 0;
      state.falling = true; state.fallProgress = 0;
      state.fallX = capture.hole.x; state.fallZ = capture.hole.z;
      state.goalProgress = 0; heldInGoal = 0;
      return;
    }
    const inside = Math.hypot(state.x - goalX, state.z - goalZ) < course.goal.radius;
    const settled = Math.hypot(state.vx - goalMotion.vx, state.vz - goalMotion.vz) < 1.1;
    heldInGoal = inside && settled ? heldInGoal + dt : 0;
    state.goalProgress = Math.min(1, heldInGoal / GOAL_HOLD);
    if (heldInGoal + EPSILON >= GOAL_HOLD) {
      state.won = true;
      state.goalProgress = 1;
      state.vx = 0;
      state.vz = 0;
    }
  }

  function step(dt, tiltX = 0, tiltZ = 0) {
    if (state.won || !Number.isFinite(dt) || dt <= 0) return state;
    tiltX = Number.isFinite(tiltX) ? clamp(tiltX, -1, 1) : 0;
    tiltZ = Number.isFinite(tiltZ) ? clamp(tiltZ, -1, 1) : 0;
    if (!state.started && Math.hypot(tiltX, tiltZ) > 0.025) state.started = true;
    if (!state.started) {
      state.motionTime += Math.min(dt, MAX_FRAME);
      return state;
    }
    remainder += Math.min(dt, MAX_FRAME);
    const respawnsBefore = state.respawns;
    while (remainder + EPSILON >= STEP && !state.won) {
      // The app sees respawns after step() returns. Neutralize any remaining
      // substeps first so held input cannot launch the newly returned marble.
      const neutral = state.respawns !== respawnsBefore;
      integrate(STEP, neutral ? 0 : tiltX, neutral ? 0 : tiltZ);
      remainder = Math.max(0, remainder - STEP);
    }
    return state;
  }

  reset();
  return { state, reset, step };
}
