import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage before importing memory module
const store = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn(k => store[k] ?? null),
  setItem: vi.fn((k, v) => { store[k] = v; }),
  removeItem: vi.fn(k => { delete store[k]; }),
  clear: vi.fn(() => { for (const k in store) delete store[k]; }),
});

const { getRec, updateRec, isMastered, isWeak, drillCleared, getDueCount, weightedSample } = await import('../src/engine/memory.js');

function freshMem() { return {}; }

describe('getRec', () => {
  it('returns default record for unknown id', () => {
    const rec = getRec({}, 'unknown');
    expect(rec).toEqual({
      correct: 0, total: 0, everWrong: false, lastResult: null,
      interval: 1, ease: 2.5, due: 0, reps: 0,
    });
  });

  it('migrates old weight-based records', () => {
    const mem = { q1: { correct: 4, total: 6, weight: 1, everWrong: true, lastResult: 'correct' } };
    const rec = getRec(mem, 'q1');
    expect(rec.interval).toBe(1);
    expect(rec.ease).toBe(2.5);
    expect(rec.reps).toBe(3);
    expect(rec.weight).toBeUndefined();
  });

  it('migrates old records without mastery to reps=0', () => {
    const mem = { q1: { correct: 1, total: 3, weight: 4, everWrong: true, lastResult: 'wrong' } };
    const rec = getRec(mem, 'q1');
    expect(rec.reps).toBe(0);
  });
});

describe('updateRec — correct answers', () => {
  it('increments correct/total and sets lastResult', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    expect(mem.q1.correct).toBe(1);
    expect(mem.q1.total).toBe(1);
    expect(mem.q1.lastResult).toBe('correct');
  });

  it('sets interval=1 on first correct', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    expect(mem.q1.interval).toBe(1);
    expect(mem.q1.reps).toBe(1);
  });

  it('sets interval=6 on second correct', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    updateRec(mem, 'q1', true);
    expect(mem.q1.interval).toBe(6);
    expect(mem.q1.reps).toBe(2);
  });

  it('multiplies interval by ease on third correct', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    updateRec(mem, 'q1', true);
    const easeBeforeThird = mem.q1.ease;
    updateRec(mem, 'q1', true);
    expect(mem.q1.reps).toBe(3);
    // interval uses ease from BEFORE the update, then ease is adjusted
    expect(mem.q1.interval).toBe(Math.round(6 * easeBeforeThird));
  });

  it('sets due to future timestamp', () => {
    const before = Date.now();
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    const after = Date.now();
    const DAY_MS = 86400000;
    expect(mem.q1.due).toBeGreaterThanOrEqual(before + 1 * DAY_MS);
    expect(mem.q1.due).toBeLessThanOrEqual(after + 1 * DAY_MS);
  });
});

describe('updateRec — wrong answers', () => {
  it('resets reps to 0 and interval to 1', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    updateRec(mem, 'q1', true);
    updateRec(mem, 'q1', false);
    expect(mem.q1.reps).toBe(0);
    expect(mem.q1.interval).toBe(1);
    expect(mem.q1.everWrong).toBe(true);
  });

  it('decreases ease by 0.2 but not below 1.3', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    const easeBefore = mem.q1.ease;
    updateRec(mem, 'q1', false);
    expect(mem.q1.ease).toBeCloseTo(easeBefore - 0.2, 5);

    // Hammer ease down to floor
    for (let i = 0; i < 20; i++) updateRec(mem, 'q1', false);
    expect(mem.q1.ease).toBe(1.3);
  });

  it('sets lastResult to wrong', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', false);
    expect(mem.q1.lastResult).toBe('wrong');
  });
});

describe('predicates', () => {
  it('isMastered when reps >= 3', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    updateRec(mem, 'q1', true);
    expect(isMastered(mem.q1)).toBe(false);
    updateRec(mem, 'q1', true);
    expect(isMastered(mem.q1)).toBe(true);
  });

  it('isWeak when everWrong and reps < 2', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', false);
    expect(isWeak(mem.q1)).toBe(true);
    updateRec(mem, 'q1', true);
    expect(isWeak(mem.q1)).toBe(true); // reps=1 < 2
    updateRec(mem, 'q1', true);
    expect(isWeak(mem.q1)).toBe(false); // reps=2
  });

  it('not isWeak if never wrong', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', true);
    expect(isWeak(mem.q1)).toBe(false);
  });

  it('drillCleared when everWrong and reps >= 2', () => {
    const mem = freshMem();
    updateRec(mem, 'q1', false);
    expect(drillCleared(mem.q1)).toBe(false);
    updateRec(mem, 'q1', true);
    expect(drillCleared(mem.q1)).toBe(false);
    updateRec(mem, 'q1', true);
    expect(drillCleared(mem.q1)).toBe(true);
  });
});

describe('getDueCount', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('counts records where due <= now', () => {
    const mem = {
      q1: { total: 3, due: Date.now() - 1000 },
      q2: { total: 2, due: Date.now() + 999999 },
      q3: { total: 1, due: 0 },
    };
    localStorage.setItem('sb_memory_v1', JSON.stringify(mem));
    expect(getDueCount()).toBe(2);
  });

  it('ignores records with total=0', () => {
    const mem = { q1: { total: 0, due: 0 } };
    localStorage.setItem('sb_memory_v1', JSON.stringify(mem));
    expect(getDueCount()).toBe(0);
  });
});

describe('weightedSample', () => {
  it('prioritizes overdue and unseen questions', () => {
    const pool = [
      { id: 'overdue' },
      { id: 'future' },
      { id: 'unseen' },
    ];
    const mem = {
      overdue: { correct: 1, total: 2, due: Date.now() - 86400000, interval: 1, ease: 2.5, reps: 0, everWrong: true, lastResult: 'wrong' },
      future: { correct: 3, total: 3, due: Date.now() + 86400000 * 30, interval: 30, ease: 2.5, reps: 3, everWrong: false, lastResult: 'correct' },
    };
    const sample = weightedSample(pool, mem, 2);
    const ids = sample.map(q => q.id);
    expect(ids).toContain('overdue');
    expect(ids).toContain('unseen');
    expect(ids).not.toContain('future');
  });

  it('returns at most n items', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = weightedSample(pool, {}, 2);
    expect(result).toHaveLength(2);
  });

  it('returns all if n >= pool size', () => {
    const pool = [{ id: 'a' }, { id: 'b' }];
    const result = weightedSample(pool, {}, 5);
    expect(result).toHaveLength(2);
  });
});
