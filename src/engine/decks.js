// decks.js — deck CRUD operations and built-in deck bootstrapping

import { KEYS, DECK_COLORS } from '../config.js';
import { load, save, supaDeleteDeck } from './storage.js';
import { getClasses } from './classes.js';

// ── Injected callbacks (set via initDeckCallbacks to avoid circular imports) ──
let _toast, _refreshAll;
export function initDeckCallbacks(toastFn, refreshAllFn) {
  _toast = toastFn;
  _refreshAll = refreshAllFn;
}

// ── CRUD ──

let _decksCache = null;

export async function initBuiltins() {
  const decks = load(KEYS.decks) || [];
  const { MKT300 } = await import('./mkt300.js');
  const storedIdx = decks.findIndex(d => d.id === 'builtin-mkt300');
  if (storedIdx === -1) {
    decks.unshift({ ...MKT300 });
  } else if ((decks[storedIdx].version || 0) < (MKT300.version || 1)) {
    // Built-in updated — replace stored copy, preserving lastScore
    decks[storedIdx] = { ...MKT300, lastScore: decks[storedIdx].lastScore };
  } else {
    return; // already up to date
  }
  save(KEYS.decks, decks);
  _decksCache = decks;
}

export function getDecks() {
  if (_decksCache !== null) return _decksCache;
  const raw = load(KEYS.decks) || [];
  _decksCache = raw.filter(d => d && typeof d.id === 'string' && typeof d.name === 'string' && Array.isArray(d.questions));
  return _decksCache;
}

export function saveDecks(decks) {
  _decksCache = decks;
  save(KEYS.decks, decks);
}

export function invalidateDecksCache() { _decksCache = null; }

export function getDeckById(id) {
  return getDecks().find(d => d.id === id) || null;
}

export async function deleteDeck(id) {
  const decks = getDecks();
  const deck = decks.find(d => d.id === id);
  if (!deck) return;
  if (deck.builtIn) return;
  const updated = decks.filter(d => d.id !== id);
  saveDecks(updated);
  await supaDeleteDeck(id);
  if (_toast) _toast('Deck deleted');
  if (_refreshAll) _refreshAll();
}

export function getDeckColor(deck) {
  // If deck is assigned to a class, use the class color
  if (deck.classId) {
    const classes = getClasses();
    const cls = classes.find(c => c.id === deck.classId);
    if (cls && cls.color) return cls.color;
  }
  return deck.color || DECK_COLORS[0];
}
