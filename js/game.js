import {createSimulation} from './physics.js?v=18';
import {getLevel, LEVELS} from './levels.js?v=18';

function levelId(value) {
  const id = typeof value === 'string' && /^[1-5]$/.test(value) ? Number(value) : value;
  return Number.isInteger(id) && id >= 1 && id <= LEVELS.length ? id : null;
}

/** A DOM-free play session: one simulation, one recorded result per attempt. */
export function createGame(records) {
  if (!records || typeof records.addRun !== 'function' || levelId(records.highestUnlocked) === null) {
    throw new TypeError('A game requires records with addRun and a valid highestUnlocked level.');
  }
  let currentLevel = getLevel(levelId(records.highestUnlocked));
  let simulation = createSimulation(currentLevel.layout);
  let currentResult = null;

  function reset() {
    simulation = createSimulation(currentLevel.layout);
    currentResult = null;
    return simulation.state;
  }

  function selectLevel(value) {
    const id = levelId(value);
    if (id === null || id > records.highestUnlocked) return false;
    currentLevel = getLevel(id);
    reset();
    return true;
  }

  return {
    get level() { return currentLevel; },
    get state() { return simulation.state; },
    get result() { return currentResult; },
    step(dt, x = 0, z = 0) {
      const state = simulation.step(dt, x, z);
      if (state.won && currentResult === null) {
        const saved = records.addRun(currentLevel.id, state.elapsed);
        currentResult = Object.freeze({...saved, levelId: currentLevel.id, seconds: state.elapsed});
      }
      return state;
    },
    reset,
    selectLevel,
    nextLevel() {
      if (currentResult === null) return false;
      return selectLevel(currentLevel.id === LEVELS.length ? 1 : currentLevel.id + 1);
    },
  };
}
