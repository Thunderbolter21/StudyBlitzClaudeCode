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

// Keys whose writes should trigger a background cloud push
const _SYNC_KEYS = new Set(['sb_decks_v1', 'sb_memory_v1', 'sb_classes_v1', 'sb_highscores_v1']);
export function save(k, v) { lsSave(k, v); if (_SYNC_KEYS.has(k)) _onSync?.(); }

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
  const localMem = lsLoad(KEYS.memory) || {};
  const mem = {};
  data.forEach(r => {
    const existing = localMem[r.question_id] || {};
    mem[r.question_id] = {
      correct: r.correct, total: r.total,
      everWrong: r.ever_wrong, lastResult: r.last_result,
      interval: r.interval || 1, ease: r.ease || 2.5,
      due: r.due || 0, reps: r.reps || 0,
      responseTimes: existing.responseTimes || []
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

// ── Supabase Storage: deck source files ────────────────────────────────────
// Files are stored at `${user_id}/${deck_id}/${uuid}` in the `deck-sources`
// bucket. RLS restricts each user to their own folder.
const DECK_SOURCES_BUCKET = 'deck-sources';

// Upload a gzip-compressed base64 payload to Storage.
// Returns the storage path on success, null on failure.
export async function uploadDeckSource(path, compressedBase64, mediaType) {
  if (!db || !_supaUser) return null;
  try {
    const blob = _base64ToBlob(compressedBase64, mediaType || 'application/octet-stream');
    const { error } = await db.storage
      .from(DECK_SOURCES_BUCKET)
      .upload(path, blob, { upsert: true, contentType: 'application/gzip' });
    if (error) {
      console.warn('uploadDeckSource error:', error.message);
      return null;
    }
    return path;
  } catch (err) {
    console.warn('uploadDeckSource exception:', err.message);
    return null;
  }
}

// Fetch a stored gzip payload and return as base64 string —
// byte-identical to what was originally passed to uploadDeckSource.
export async function downloadDeckSource(path) {
  if (!db) return null;
  try {
    const { data, error } = await db.storage
      .from(DECK_SOURCES_BUCKET)
      .download(path);
    if (error || !data) {
      console.warn('downloadDeckSource error:', error?.message);
      return null;
    }
    return await _blobToBase64(data);
  } catch (err) {
    console.warn('downloadDeckSource exception:', err.message);
    return null;
  }
}

// Remove all Storage objects for a deck. Best-effort: logs warnings,
// never throws — orphans are not catastrophic, just wasted space.
export async function deleteDeckSourcesForDeck(deckId) {
  if (!db || !_supaUser) return;
  try {
    const prefix = `${_supaUser.id}/${deckId}`;
    const { data: files, error: listErr } = await db.storage
      .from(DECK_SOURCES_BUCKET)
      .list(prefix);
    if (listErr) {
      console.warn('deleteDeckSourcesForDeck list error:', listErr.message);
      return;
    }
    if (!files?.length) return;
    const paths = files.map(f => `${prefix}/${f.name}`);
    const { error: rmErr } = await db.storage
      .from(DECK_SOURCES_BUCKET)
      .remove(paths);
    if (rmErr) console.warn('deleteDeckSourcesForDeck remove error:', rmErr.message);
  } catch (err) {
    console.warn('deleteDeckSourcesForDeck exception:', err.message);
  }
}

// internals — chunked conversions to handle multi-MB payloads without
// O(n²) string concat or apply() stack overflow.
function _base64ToBlob(b64, mediaType) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}

async function _blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    );
  }
  return btoa(binary);
}

// ── Clear all StudyBlitz user data from localStorage ──
// Targets only sb_ (underscore) keys — never sb- (hyphen) Supabase auth keys.
export function clearUserData() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('sb_')) keysToRemove.push(key);
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  console.log(`[StudyBlitz] Cleared ${keysToRemove.length} user data keys:`, keysToRemove);
}
