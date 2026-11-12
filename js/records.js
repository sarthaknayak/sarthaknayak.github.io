export const RECORDS_KEY = 'marble-records-v9';

const VERSION = 9;
const PREVIOUS_KEY = 'marble-records-v8';
const LEVEL_COUNT = 5;
const BOARD_SIZE = 5;
let fallbackSequence = 0;

function levelNumber(value) {
  const level = typeof value === 'string' && /^[1-5]$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(level) || level < 1 || level > LEVEL_COUNT) {
    throw new RangeError('Level must be an integer from 1 to 5.');
  }
  return level;
}

function validSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function newId() {
  // Browser crypto is optional: local previews and Node tests need no DOM.
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const words = new Uint32Array(4);
      globalThis.crypto.getRandomValues(words);
      return Array.from(words, word => word.toString(16).padStart(8, '0')).join('-');
    }
  } catch { /* Restricted crypto still permits local-only records. */ }
  fallbackSequence += 1;
  return `${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function ordered(runs) {
  // Preserve insertion order for equal times, including after a storage reload.
  return runs.map((run, index) => ({run, index}))
    .sort((a, b) => a.run.seconds - b.run.seconds || a.index - b.index)
    .map(item => item.run);
}

const emptyBoards = () => Array.from({length: LEVEL_COUNT}, () => []);

function unlockedFromBoards(levels) {
  let level = 1;
  while (level < LEVEL_COUNT && levels[level - 1].length > 0) level++;
  return level;
}

function readBoards(sourceBoards, ids) {
  const levels = emptyBoards();
  if (!sourceBoards || typeof sourceBoards !== 'object' || Array.isArray(sourceBoards)) return levels;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const source = sourceBoards[level];
    if (!Array.isArray(source)) continue;
    const runs = [];
    for (const run of source) {
      if (!run || typeof run !== 'object'
        || typeof run.id !== 'string' || run.id.length === 0 || ids.has(run.id)
        || !validSeconds(run.seconds)
        || !Number.isSafeInteger(run.at) || run.at < 0) continue;
      ids.add(run.id);
      runs.push({id: run.id, seconds: run.seconds, at: run.at});
    }
    levels[level - 1] = ordered(runs).slice(0, BOARD_SIZE);
  }
  return levels;
}

function readSaved(raw, version = VERSION) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let saved;
  try { saved = JSON.parse(raw); } catch { return null; }
  if (!saved || saved.version !== version || !saved.levels || typeof saved.levels !== 'object' || Array.isArray(saved.levels)) return null;
  const levels = readBoards(saved.levels, new Set());
  const savedUnlock = (version === VERSION || version === 8) && Number.isInteger(saved.unlocked)
    && saved.unlocked >= 1 && saved.unlocked <= LEVEL_COUNT ? saved.unlocked : 1;
  return {levels, unlocked: Math.max(unlockedFromBoards(levels), savedUnlock)};
}

/**
 * Browser-local top-five times and sequential progression.
 * `at` is a Unix timestamp in milliseconds. `persisted` reports whether the
 * current top-five boards were written; a slower run can rank sixth and is
 * intentionally omitted from the saved board. Nothing leaves this browser.
 */
export function createRecords(storage = null) {
  let levels = emptyBoards();
  let unlocked = 1;
  let writable = false;
  let migrated = false;
  try {
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
      const current = storage.getItem(RECORDS_KEY);
      if (current === null) {
        // The former second course is now first; courses three through five
        // are unchanged, while the new second course needs a fresh board.
        const previous = readSaved(storage.getItem(PREVIOUS_KEY), 8);
        if (previous) {
          levels[0] = previous.levels[1];
          for (let index = 2; index < LEVEL_COUNT; index++) levels[index] = previous.levels[index];
          unlocked = Math.max(previous.unlocked >= 3 ? previous.unlocked : 1, levels[0].length ? 2 : 1);
          migrated = true;
        }
      } else {
        // An existing but corrupt current record must not resurrect older data.
        const saved = readSaved(current);
        if (saved) ({levels, unlocked} = saved);
      }
      writable = true;
    }
  } catch {
    // A failed read must not lead to overwriting records we could not inspect.
    writable = false;
  }

  const completed = index => levels[index].length > 0;

  function highestUnlocked() {
    return Math.max(unlocked, unlockedFromBoards(levels));
  }

  function persist() {
    if (!writable) return false;
    const savedLevels = {};
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      savedLevels[level] = levels[level - 1];
    }
    try {
      storage.setItem(RECORDS_KEY, JSON.stringify({version: VERSION, unlocked: highestUnlocked(), levels: savedLevels}));
      return true;
    } catch {
      // Keep the run in memory; a later write may succeed if storage recovers.
      return false;
    }
  }

  if (migrated) persist();

  return {
    readLevel(levelId) {
      return levels[levelNumber(levelId) - 1].map(run => ({...run}));
    },
    addRun(levelId, seconds) {
      const level = levelNumber(levelId);
      if (!validSeconds(seconds)) throw new TypeError('Run time must be a positive finite number of seconds.');
      if (level > highestUnlocked()) throw new RangeError('Complete the preceding levels before saving this level.');
      const existingIds = new Set(levels.flat().map(run => run.id));
      let id = newId();
      // Also handles a mocked or faulty crypto provider returning the same ID.
      if (existingIds.has(id)) id += `-${Date.now().toString(36)}-${(++fallbackSequence).toString(36)}`;
      const run = {id, seconds, at: Date.now()};
      const ranked = ordered([...levels[level - 1], run]);
      const rank = ranked.indexOf(run) + 1;
      levels[level - 1] = ranked.slice(0, BOARD_SIZE);
      // Earned access survives redesigned boards without inventing score rows.
      unlocked = Math.max(highestUnlocked(), Math.min(level + 1, LEVEL_COUNT));
      const persisted = persist();
      return {run: {...run}, rank, isBest: rank === 1, persisted};
    },
    best(levelId) {
      return levels[levelNumber(levelId) - 1][0]?.seconds ?? Infinity;
    },
    isComplete(levelId) {
      return completed(levelNumber(levelId) - 1);
    },
    get highestUnlocked() { return highestUnlocked(); },
    get completedCount() { return levels.reduce((count, _, index) => count + Number(completed(index)), 0); },
  };
}
