// memory.js — SM-2 spaced repetition memory engine

import { KEYS } from '../config.js';
import { lsLoad, saveMem } from './storage.js';

let _memCache = null;
export function getMem() {
  if (_memCache !== null) return _memCache;
  _memCache = lsLoad(KEYS.memory) || {};
  return _memCache;
}
export function setMem(m) { _memCache = m; saveMem(m); }
export function invalidateMemCache() { _memCache = null; }

const DAY_MS = 86400000;

export function getRec(mem, id) {
  const r = mem[id];
  if (!r) return { correct: 0, total: 0, everWrong: false, lastResult: null, interval: 1, ease: 2.5, due: 0, reps: 0 };
  // Migrate old weight-based records
  if (r.interval === undefined) {
    r.interval = 1;
    r.ease = 2.5;
    r.due = 0;
    r.reps = r.correct >= 3 && r.everWrong && r.weight === 1 ? 3 : 0;
    delete r.weight;
  }
  return r;
}

export function updateRec(mem, id, wasCorrect) {
  const r = getRec(mem, id);
  r.total++;
  r.lastResult = wasCorrect ? 'correct' : 'wrong';

  if (wasCorrect) {
    r.correct++;
    const quality = 5;
    r.reps++;
    if (r.reps === 1) r.interval = 1;
    else if (r.reps === 2) r.interval = 6;
    else r.interval = Math.round(r.interval * r.ease);
    r.ease = r.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (r.ease < 1.3) r.ease = 1.3;
  } else {
    r.everWrong = true;
    r.reps = 0;
    r.interval = 1;
    r.ease = Math.max(1.3, r.ease - 0.2);
  }

  r.due = Date.now() + r.interval * DAY_MS;
  mem[id] = r;
  return mem;
}

export const isMastered = r => r.reps >= 3;
export const drillCleared = r => r.everWrong && r.reps >= 2;
export const isWeak = r => r.everWrong && r.reps < 2;

export function getDueCount() {
  const mem = getMem();
  const now = Date.now();
  let count = 0;
  for (const r of Object.values(mem)) {
    if (r.total > 0 && (r.due || 0) <= now) count++;
  }
  return count;
}

export function weightedSample(pool, mem, n) {
  const now = Date.now();
  const overdue = [];
  const rest = [];
  pool.forEach(q => {
    const r = getRec(mem, q.id);
    if (r.total === 0 || (r.due || 0) <= now) overdue.push(q);
    else rest.push(q);
  });
  overdue.sort(() => Math.random() - 0.5);
  rest.sort(() => Math.random() - 0.5);
  const out = [...overdue, ...rest];
  return out.slice(0, n);
}
