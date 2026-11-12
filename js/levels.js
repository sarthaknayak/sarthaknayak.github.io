// Deterministic courses share the same tray and handling; only the route changes.
function bezier(a, b, c, d, samples = 24) {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples, u = 1 - t;
    return {
      x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
      z: u ** 3 * a.z + 3 * u * u * t * b.z + 3 * u * t * t * c.z + t ** 3 * d.z,
    };
  });
}

const wall = (a, b, c, d, height = 0.3, radius = 0.13) => ({ radius, height, points: bezier(a, b, c, d) });
function sweep(side, tip, z, amplitude, height, radius) {
  const from = side === 'left' ? -2.9 : -tip, to = side === 'left' ? tip : 2.9;
  return {
    radius, height,
    points: Array.from({ length: 49 }, (_, index) => {
      const x = from + (to - from) * index / 48;
      return { x, z: z + amplitude * Math.sin(x * Math.PI / 2.9) };
    }),
  };
}

// Fillet only the interior of a wall chain; endpoints meet boundary walls and
// junctions exactly, so rounding cannot open a shortcut through a closed passage.
function roundedChain(corners) {
  const points = [corners[0]], radius = 0.30, k = 0.5522847498;
  for (let index = 1; index < corners.length - 1; index++) {
    const before = corners[index - 1], corner = corners[index], after = corners[index + 1];
    const inLength = Math.hypot(corner.x - before.x, corner.z - before.z);
    const outLength = Math.hypot(after.x - corner.x, after.z - corner.z);
    const incoming = { x: (corner.x - before.x) / inLength, z: (corner.z - before.z) / inLength };
    const outgoing = { x: (after.x - corner.x) / outLength, z: (after.z - corner.z) / outLength };
    if (Math.abs(incoming.x * outgoing.z - incoming.z * outgoing.x) < 1e-8) {
      points.push(corner);
      continue;
    }
    const entry = { x: corner.x - incoming.x * radius, z: corner.z - incoming.z * radius };
    const exit = { x: corner.x + outgoing.x * radius, z: corner.z + outgoing.z * radius };
    points.push(entry, ...bezier(entry,
      { x: entry.x + incoming.x * radius * k, z: entry.z + incoming.z * radius * k },
      { x: exit.x - outgoing.x * radius * k, z: exit.z - outgoing.z * radius * k }, exit, 12).slice(1));
  }
  points.push(corners.at(-1));
  return { radius: 0.10, height: 0.30, points };
}

function mazeWalls(passages = [
  [20, 15, 10, 5, 0, 1, 2, 7, 8, 13, 18, 23, 22, 21, 16, 17, 12],
  [5, 6, 11], [2, 3, 4, 9], [13, 14, 19, 24],
]) {
  const edgeKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const open = new Set();
  for (const path of passages) for (let index = 1; index < path.length; index++) open.add(edgeKey(path[index - 1], path[index]));
  const neighbors = new Map();
  const addWall = (a, b) => {
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(b); neighbors.get(b).push(a);
  };
  for (let row = 0; row < 5; row++) for (let column = 0; column < 5; column++) {
    const cell = row * 5 + column;
    if (column < 4 && !open.has(edgeKey(cell, cell + 1))) addWall(row * 6 + column + 1, (row + 1) * 6 + column + 1);
    if (row < 4 && !open.has(edgeKey(cell, cell + 5))) addWall((row + 1) * 6 + column, (row + 1) * 6 + column + 1);
  }
  const point = vertex => ({ x: -2.9 + vertex % 6 * 1.16, z: -2.9 + Math.floor(vertex / 6) * 1.16 });
  const visited = new Set(), walls = [];
  for (const [start, exits] of neighbors) {
    if (exits.length === 2) continue;
    for (let next of exits) {
      if (visited.has(edgeKey(start, next))) continue;
      const chain = [point(start)];
      let previous = start;
      while (true) {
        visited.add(edgeKey(previous, next)); chain.push(point(next));
        const onward = neighbors.get(next);
        if (onward.length !== 2) break;
        const following = onward.find(vertex => vertex !== previous);
        previous = next; next = following;
      }
      walls.push(roundedChain(chain));
    }
  }
  return walls;
}

function course(barriers, bumpers = [], goalRadius = 0.38, startZ = 2.1, goalZ = -2.15) {
  return {
    radius: 0.22, half: 2.9, corner: 0.65,
    start: { x: -1.9, z: startZ },
    goal: { x: 1.9, z: goalZ, radius: goalRadius },
    barriers, bumpers,
  };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

const cellPoint = cell => ({x: (cell % 5 - 2) * 1.16, z: (Math.floor(cell / 5) - 2) * 1.16});
const patrol = (cell, axis, period, phase = 0) => ({
  ...cellPoint(cell), radius: 0.12, height: 0.28,
  motion: {kind: 'patrol', axis, amplitude: 0.26, period, phase},
});
const mazeCourse = (paths, start, goal, bumpers, hazards, radius = 0.31) => ({
  ...course(mazeWalls(paths), bumpers, radius),
  start: cellPoint(start), goal: {...cellPoint(goal), radius}, hazards,
});

export const LEVELS = freeze([
  {
    id: 1, name: 'The Labyrinth',
    layout: {
      ...course(mazeWalls(), [], 0.31),
      bumpers: [
        { x: -2.32, z: 0, radius: 0.12, height: 0.28, motion: { kind: 'patrol', axis: 'x', amplitude: 0.26, period: 3.8, phase: 0 } },
        { x: 1.16, z: 1.16, radius: 0.12, height: 0.28, motion: { kind: 'patrol', axis: 'x', amplitude: 0.26, period: 3.2, phase: Math.PI } },
      ],
      start: { x: -2.32, z: 2.32 },
      goal: { x: 0, z: 0, radius: 0.31, motion: { axis: 'x', amplitude: 0.12, period: 7.5, phase: 0 } },
    },
  },
  {
    id: 2, name: 'North Loop',
    layout: mazeCourse([
      [20, 21, 22, 23, 18, 13, 14, 9, 4, 3, 2, 1, 6, 11, 12, 7, 8],
      [22, 17, 16, 15, 10], [14, 19, 24], [6, 5, 0],
    ], 20, 8, [patrol(21, 'z', 3.8), patrol(18, 'x', 3.6, Math.PI), patrol(3, 'z', 3.4, Math.PI / 2)], []),
  },
  {
    id: 3, name: 'Crossroads',
    layout: mazeCourse([
      [20, 21, 22, 23, 18, 13, 12, 17, 16, 15, 10, 11, 6, 1, 2, 3, 4],
      [23, 24, 19, 14], [10, 5, 0], [2, 7, 8, 9],
    ], 20, 4, [patrol(21, 'z', 3.9), patrol(18, 'x', 3.5, Math.PI), patrol(6, 'x', 3.2, Math.PI / 2)], [
      {x: -1.16, z: 1.26, radius: 0.25},
    ]),
  },
  {
    id: 4, name: 'Switchyard',
    layout: mazeCourse([
      [24, 19, 14, 9, 8, 13, 18, 23, 22, 17, 16, 15, 10, 11, 12, 7, 2, 1, 0],
      [9, 4, 3], [22, 21, 20], [10, 5, 6],
    ], 24, 0, [patrol(19, 'x', 3.5), patrol(13, 'x', 3.2, Math.PI), patrol(11, 'z', 3.0, Math.PI / 2)], [
      {x: -1.16, z: 1.26, radius: 0.25},
      {x: 0.10, z: -1.16, radius: 0.25},
    ], 0.30),
  },
  {
    id: 5, name: 'The Citadel',
    layout: {
      ...mazeCourse([
        [20, 15, 10, 5, 0, 1, 6, 11, 16, 21, 22, 23, 18, 13, 14, 9, 8, 7, 2],
        [11, 12, 17], [23, 24, 19], [9, 4, 3],
      ], 20, 2, [patrol(15, 'x', 3.4), patrol(6, 'x', 3.1, Math.PI), patrol(22, 'z', 2.9, Math.PI / 2), patrol(18, 'x', 2.8)], [
        {x: -2.22, z: 0, radius: 0.25},
        {x: -1.06, z: 1.16, radius: 0.25},
        {x: 1.16, z: -1.06, radius: 0.25},
      ], 0.29),
      goal: {x: 0, z: -2.32, radius: 0.29, motion: {axis: 'x', amplitude: 0.10, period: 6.5, phase: 0}},
    },
  },
]);

export function getLevel(id) {
  return LEVELS.find(level => level.id === Number(id)) || LEVELS[0];
}
