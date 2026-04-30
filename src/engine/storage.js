// storage.js — localStorage helpers + Supabase CRUD + sync layer

import { createClient } from '@supabase/supabase-js';
import { SUPA_URL, SUPA_ANON, KEYS } from '../config.js';

export let db = null;
if (SUPA_URL && SUPA_ANON) {
  db = createClient(SUPA_URL, SUPA_ANON);
} else {
  console.warn('Supabase not configured — running in localStorage-only mode');
}

let _supaUser = null;
export function getSupaUser() { return _supaUser; }
export function setSupaUser(u) { _supaUser = u; }

// ── Supabase timeout wrapper ──
const SUPA_TIMEOUT_MS = 8000;
function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise(resolve =>
      setTimeout(() => resolve({ data: null, error: new Error('Request timed out') }), SUPA_TIMEOUT_MS)
    )
  ]);
}

// ── localStorage helpers ──
export function lsLoad(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch(e) { return null; } }
export function lsSave(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} }
export function load(k) { return lsLoad(k); }
export function save(k,v) { lsSave(k,v); }

// ── Supabase: load all decks for current user ──
export async function supaLoadDecks() {
  if (!_supaUser) return null;
  const { data, error } = await withTimeout(db.from('decks').select('*').eq('user_id', _supaUser.id));
  if (error) { console.warn('supaLoadDecks error', error); return null; }
  return data.map(r => ({
    id: r.id, name: r.name, subject: r.subject, color: r.color,
    created: r.created_at, lastScore: r.last_score, questions: r.questions || [],
    builtIn: r.id === 'builtin-mkt300'
  }));
}

// ── Supabase: upsert a single deck ──
export async function supaSaveDeck(deck) {
  if (!_supaUser) return;
  const { error } = await withTimeout(db.from('decks').upsert({
    id: deck.id, user_id: _supaUser.id, name: deck.name,
    subject: deck.subject || '', color: deck.color || '#ff3f6c',
    questions: deck.questions, last_score: deck.lastScore ?? null
  }, { onConflict: 'id' }));
  if (error) console.warn('supaSaveDeck error', error);
}

// ── Supabase: delete a deck ──
export async function supaDeleteDeck(id) {
  if (!_supaUser) return;
  const { error } = await withTimeout(db.from('decks').delete().eq('id', id).eq('user_id', _supaUser.id));
  if (error) console.warn('supaDeleteDeck error', error);
}

// ── Supabase: load memory for current user ──
export async function supaLoadMemory() {
  if (!_supaUser) return null;
  const { data, error } = await withTimeout(db.from('memory').select('*').eq('user_id', _supaUser.id));
  if (error) { console.warn('supaLoadMemory error', error); return null; }
  const mem = {};
  data.forEach(r => {
    mem[r.question_id] = {
      correct: r.correct, total: r.total,
      everWrong: r.ever_wrong, lastResult: r.last_result,
      interval: r.interval || 1, ease: r.ease || 2.5,
      due: r.due || 0, reps: r.reps || 0
    };
  });
  return mem;
}

// ── Supabase: upsert memory records (batch) ──
export async function supaSyncMemory(memObj) {
  if (!_supaUser || !memObj) return;
  const rows = Object.entries(memObj).map(([qid, r]) => ({
    user_id: _supaUser.id, question_id: qid,
    correct: r.correct || 0, total: r.total || 0,
    ever_wrong: r.everWrong || false, last_result: r.lastResult || null,
    interval: r.interval || 1, ease: r.ease || 2.5,
    due: r.due || 0, reps: r.reps || 0,
    updated_at: new Date().toISOString()
  }));
  if (!rows.length) return;
  const { error } = await withTimeout(db.from('memory').upsert(rows, { onConflict: 'user_id,question_id' }));
  if (error) console.warn('supaSyncMemory error', error);
}

// ── Sync callback (registered by auth.js to trigger cloud push on writes) ──
let _onSync = null;
export function registerSyncCallback(fn) { _onSync = fn; }

// ── Debounced sync after local memory writes ──
export function saveMem(memObj) {
  lsSave(KEYS.memory, memObj);
  _onSync?.();
}

// ── Debounced generic sync (used after deck/class saves) ──
let _genericSyncTimer = null;
export function scheduleSyncAfterSave(syncFn) {
  clearTimeout(_genericSyncTimer);
  _genericSyncTimer = setTimeout(syncFn, 2000);
}
