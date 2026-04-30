// auth.js — email+password auth, Supabase blob sync, session restore

import { db, lsLoad, lsSave, getSupaUser, setSupaUser } from './storage.js';
import { KEYS } from '../config.js';
import { invalidateMemCache } from './memory.js';
import { invalidateDecksCache } from './decks.js';

let _toast, _refreshAll;
export function initAuthCallbacks({ toast, refreshAll }) {
  _toast = toast;
  _refreshAll = refreshAll;
}

// ── Sync state ──────────────────────────────────────────────────────────────
let _syncTimer = null;
let _heartbeat = null;

// ── Public state ────────────────────────────────────────────────────────────
export function getCurrentUser() { return getSupaUser(); }
export function isLoggedIn()     { return !!getSupaUser(); }

// ── Sign Up ─────────────────────────────────────────────────────────────────
export async function signUp(email, password) {
  if (!db) return 'Supabase not configured — running in local mode';
  const { data, error } = await db.auth.signUp({ email, password });
  if (error) return error.message;
  if (data.session) {
    // Email confirmation OFF — immediate session
    await handlePostAuth(data.session, 'new');
    return null; // null = close modal
  }
  // Email confirmation ON — account created, awaiting email click
  return '__confirm_email__';
}

// ── Sign In ─────────────────────────────────────────────────────────────────
export async function signIn(email, password) {
  if (!db) return 'Supabase not configured — running in local mode';
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  if (data.session) await handlePostAuth(data.session, 'existing');
  return null;
}

// ── Sign Out ────────────────────────────────────────────────────────────────
export async function signOut() {
  if (db) await db.auth.signOut().catch(() => {});
  setSupaUser(null);
  _stopSync();
  updateAuthUI();
  _refreshAll?.();
  _toast?.('Signed out. Your data is still saved locally.');
}

// ── Post-auth handler ───────────────────────────────────────────────────────
async function handlePostAuth(session, type) {
  setSupaUser(session.user);
  updateAuthUI();

  const localDecks = (lsLoad(KEYS.decks) || []).filter(d => d.id !== 'builtin-mkt300');
  if (localDecks.length > 0) {
    await _showMergePrompt();
  } else {
    await pullFromCloud();
  }

  startBackgroundSync();
  _refreshAll?.();
  _toast?.(type === 'new'
    ? 'Account created! Welcome to StudyBlitz.'
    : 'Signed in! Your data is synced.');
}

// ── Merge / replace prompt ──────────────────────────────────────────────────
function _showMergePrompt() {
  return new Promise(resolve => {
    let modal = document.getElementById('sb-merge-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sb-merge-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="modal-box" style="max-width:440px;">
        <h2>You have existing data</h2>
        <p style="color:var(--muted);font-size:0.88rem;line-height:1.6;margin-bottom:1.5rem;">
          This device has local decks and progress.<br>
          What would you like to do?
        </p>
        <div style="display:flex;flex-direction:column;gap:0.8rem;">
          <button class="btn btn-primary" id="sb-merge-btn" style="justify-content:center;">
            Merge Everything — keep both
          </button>
          <button class="btn btn-ghost" id="sb-replace-btn" style="justify-content:center;">
            Use My Account Data — replace local
          </button>
        </div>
      </div>`;
    modal.style.display = 'flex';
    document.getElementById('sb-merge-btn').onclick = async () => {
      modal.style.display = 'none'; await mergeData(); resolve();
    };
    document.getElementById('sb-replace-btn').onclick = async () => {
      modal.style.display = 'none'; await pullFromCloud(); resolve();
    };
  });
}

// ── Cloud fetch helper ──────────────────────────────────────────────────────
async function _fetchCloud() {
  const uid = getSupaUser().id;
  const [d, m, c, h] = await Promise.all([
    db.from('user_decks').select('data').eq('user_id', uid).maybeSingle(),
    db.from('user_memory').select('data').eq('user_id', uid).maybeSingle(),
    db.from('user_classes').select('data').eq('user_id', uid).maybeSingle(),
    db.from('user_highscores').select('data').eq('user_id', uid).maybeSingle(),
  ]);
  return {
    decks:       d.data?.data  ?? null,
    memory:      m.data?.data  ?? null,
    classes:     c.data?.data  ?? null,
    highscores:  h.data?.data  ?? null,
  };
}

// ── Pull from cloud (replaces local) ───────────────────────────────────────
export async function pullFromCloud() {
  if (!db || !getSupaUser()) return;
  try {
    const cloud = await _fetchCloud();
    const localDecks = lsLoad(KEYS.decks) || [];
    const builtin    = localDecks.find(d => d.id === 'builtin-mkt300');

    if (cloud.decks !== null) {
      lsSave(KEYS.decks, builtin ? [builtin, ...cloud.decks] : cloud.decks);
      invalidateDecksCache();
    }
    if (cloud.memory     !== null) { lsSave(KEYS.memory,     cloud.memory);     invalidateMemCache(); }
    if (cloud.classes    !== null)   lsSave(KEYS.classes,    cloud.classes);
    if (cloud.highscores !== null)   lsSave(KEYS.highscores, cloud.highscores);
  } catch (e) { console.warn('pullFromCloud error:', e); }
}

// ── Merge local + cloud ─────────────────────────────────────────────────────
export async function mergeData() {
  if (!db || !getSupaUser()) return;
  try {
    const cloud = await _fetchCloud();
    _applyMerge(cloud);
    await pushToCloud();
  } catch (e) { console.warn('mergeData error:', e); }
}

// Shared merge logic (used by mergeData and restoreSession)
function _applyMerge(cloud) {
  const localDecks = lsLoad(KEYS.decks) || [];

  // Decks — dedupe by id, prefer newer by created date
  if (cloud.decks !== null) {
    const map = new Map();
    [...(cloud.decks || []), ...localDecks].forEach(d => {
      if (d.id === 'builtin-mkt300') return;
      const ex = map.get(d.id);
      if (!ex || new Date(d.created || 0) >= new Date(ex.created || 0)) map.set(d.id, d);
    });
    const builtin = localDecks.find(d => d.id === 'builtin-mkt300');
    lsSave(KEYS.decks, builtin ? [builtin, ...map.values()] : [...map.values()]);
    invalidateDecksCache();
  }

  // Memory — keep record with higher total answers
  const localMem = lsLoad(KEYS.memory) || {};
  if (cloud.memory !== null) {
    const merged = { ...(cloud.memory || {}) };
    for (const [qid, lr] of Object.entries(localMem)) {
      if (!merged[qid] || lr.total >= merged[qid].total) merged[qid] = lr;
    }
    lsSave(KEYS.memory, merged);
    invalidateMemCache();
  }

  // Classes — dedupe by id
  if (cloud.classes !== null) {
    const map = new Map();
    [...(cloud.classes || []), ...(lsLoad(KEYS.classes) || [])].forEach(c => map.set(c.id, c));
    lsSave(KEYS.classes, [...map.values()]);
  }

  // Highscores — keep higher score per key
  if (cloud.highscores !== null) {
    const localHS = lsLoad(KEYS.highscores) || {};
    const merged  = { ...(cloud.highscores || {}) };
    for (const [k, v] of Object.entries(localHS)) {
      if (merged[k] === undefined || v > merged[k]) merged[k] = v;
    }
    lsSave(KEYS.highscores, merged);
  }
}

// ── Push to cloud ───────────────────────────────────────────────────────────
export async function pushToCloud() {
  if (!db || !getSupaUser()) return;
  _updateSyncStatus('syncing');
  const uid = getSupaUser().id;
  const now = new Date().toISOString();
  try {
    await Promise.all([
      db.from('user_decks').upsert(
        { user_id: uid, data: (lsLoad(KEYS.decks) || []).filter(d => d.id !== 'builtin-mkt300'), updated_at: now },
        { onConflict: 'user_id' }
      ),
      db.from('user_memory').upsert(
        { user_id: uid, data: lsLoad(KEYS.memory) || {}, updated_at: now },
        { onConflict: 'user_id' }
      ),
      db.from('user_classes').upsert(
        { user_id: uid, data: lsLoad(KEYS.classes) || [], updated_at: now },
        { onConflict: 'user_id' }
      ),
      db.from('user_highscores').upsert(
        { user_id: uid, data: lsLoad(KEYS.highscores) || {}, updated_at: now },
        { onConflict: 'user_id' }
      ),
    ]);
    _updateSyncStatus('synced');
  } catch (e) {
    console.warn('pushToCloud error:', e);
    _updateSyncStatus('error');
  }
}

// ── Background sync ─────────────────────────────────────────────────────────
export function scheduleSync() {
  if (!isLoggedIn()) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(pushToCloud, 2000);
}

// Bidirectional heartbeat — pushes local changes then pulls cloud
// so a second device picks up changes within 60 s (Scenario E)
async function _heartbeatSync() {
  if (!isLoggedIn() || !db) return;
  try {
    await pushToCloud();
    const cloud = await _fetchCloud();
    _applyMerge(cloud);
    _refreshAll?.();
  } catch (e) { console.warn('Heartbeat sync error:', e); }
}

export function startBackgroundSync() {
  _stopSync();
  if (!isLoggedIn()) return;
  _heartbeat = setInterval(_heartbeatSync, 60_000);
  window.addEventListener('beforeunload', pushToCloud);
}

function _stopSync() {
  clearTimeout(_syncTimer);
  clearInterval(_heartbeat);
  _heartbeat = null;
  window.removeEventListener('beforeunload', pushToCloud);
}

// ── Restore session on boot ─────────────────────────────────────────────────
export async function restoreSession() {
  if (!db) return;
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session?.user) return;
    setSupaUser(session.user);
    const cloud = await _fetchCloud();
    _applyMerge(cloud);   // silent — no modal, no immediate push
    startBackgroundSync();
    updateAuthUI();
  } catch (e) {
    console.warn('restoreSession error:', e);
  }
}

// Backward-compat alias — main.js calls syncOnBoot() in its boot sequence
export const syncOnBoot = restoreSession;

// ── Auth state listener ─────────────────────────────────────────────────────
export function initAuth() {
  if (!db) return;
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      setSupaUser(null);
      _stopSync();
      updateAuthUI();
    }
  });
}

// ── UI helpers ──────────────────────────────────────────────────────────────
export function updateAuthUI() {
  _updateNavAuth();
  _updateBanner();
}

// Backward-compat alias — main.js calls updateAuthStatus()
export const updateAuthStatus = updateAuthUI;

function _updateNavAuth() {
  const statusEl = document.getElementById('auth-status');
  const btnEl    = document.getElementById('link-account-btn');
  if (!statusEl) return;
  const user = getSupaUser();
  if (user) {
    const email = user.email || 'Signed in';
    const short = email.length > 24 ? email.slice(0, 21) + '…' : email;
    statusEl.innerHTML = `<span style="color:var(--green)">●</span> ${short}`;
    if (btnEl) {
      btnEl.innerHTML = `<span class="icon">🔓</span><span>Sign Out</span>`;
      btnEl.onclick = signOut;
    }
  } else {
    statusEl.textContent = 'Not signed in — data is local only';
    if (btnEl) {
      btnEl.innerHTML = `<span class="icon">🔗</span><span>Sign In / Create Account</span>`;
      btnEl.onclick = () => openAuthModal();
    }
  }
  // Show/hide sync status (element now lives in HTML)
  const syncEl = document.getElementById('sb-sync-status');
  if (syncEl) syncEl.style.display = user ? '' : 'none';
}

function _updateBanner() {
  const banner = document.getElementById('sb-auth-banner');
  if (!banner) return;

  const dismissed = sessionStorage.getItem('sb-banner-dismissed');
  banner.style.display = (isLoggedIn() || dismissed) ? 'none' : 'flex';

  // Wire buttons once (use onclick so re-calling never stacks listeners)
  const signinBtn  = document.getElementById('sb-banner-signin');
  const signupBtn  = document.getElementById('sb-banner-signup');
  const dismissBtn = document.getElementById('sb-banner-dismiss');
  if (signinBtn)  signinBtn.onclick  = () => openAuthModal('signin');
  if (signupBtn)  signupBtn.onclick  = () => openAuthModal('signup');
  if (dismissBtn) dismissBtn.onclick = () => {
    sessionStorage.setItem('sb-banner-dismissed', '1');
    banner.style.display = 'none';
  };
}

function _updateSyncStatus(state) {
  const el = document.getElementById('sb-sync-status');
  if (!el) return;
  if      (state === 'syncing') el.innerHTML = `<span style="color:var(--muted)">⟳ Syncing…</span>`;
  else if (state === 'synced')  el.innerHTML = `<span style="color:var(--green)">● Synced</span>`;
  else if (state === 'error')   el.innerHTML = `<span style="color:var(--accent)">⚠ Sync error</span>`;
}

// ── Auth modal ──────────────────────────────────────────────────────────────
export function openAuthModal(mode = 'signin') {
  let modal = document.getElementById('sb-auth-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sb-auth-modal';
    modal.className = 'modal-overlay';
    modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }
  _renderAuthModal(modal, mode);
  modal.style.display = 'flex';
}

function _renderAuthModal(modal, mode) {
  const isSignUp = mode === 'signup';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;">
        <h2 style="margin:0;">${isSignUp ? 'Create Account' : 'Welcome Back'}</h2>
        <button class="btn btn-ghost" id="sb-ac" style="padding:0.3rem 0.6rem;font-size:1rem;">✕</button>
      </div>
      <label class="lbl-s">Email</label>
      <input type="email" id="sb-ae" placeholder="you@example.com" style="margin-bottom:0.8rem;" />
      <label class="lbl-s">Password</label>
      <input type="password" id="sb-ap" placeholder="Password (min 6 chars)" style="margin-bottom:${isSignUp ? '0.8rem' : '0.3rem'};" />
      ${isSignUp ? `<label class="lbl-s">Confirm Password</label>
      <input type="password" id="sb-ap2" placeholder="Confirm password" style="margin-bottom:0.3rem;" />` : ''}
      <div id="sb-aerr" style="font-size:0.82rem;color:var(--accent);min-height:1.2rem;margin-bottom:0.8rem;"></div>
      <button class="btn btn-primary" id="sb-asub" style="width:100%;justify-content:center;margin-bottom:1rem;">
        ${isSignUp ? 'Create Account' : 'Sign In'}
      </button>
      <p style="font-size:0.78rem;color:var(--muted);text-align:center;margin:0;">
        ${isSignUp
          ? `Already have an account? <a href="#" id="sb-atog" style="color:var(--blue);">Sign in</a>`
          : `Don't have an account? <a href="#" id="sb-atog" style="color:var(--blue);">Sign up</a>`}
      </p>
    </div>`;

  const g = id => document.getElementById(id);
  g('sb-ac').onclick   = () => { modal.style.display = 'none'; };
  g('sb-atog').onclick = e  => { e.preventDefault(); _renderAuthModal(modal, isSignUp ? 'signin' : 'signup'); };

  const submit = async () => {
    const email = g('sb-ae').value.trim();
    const pw    = g('sb-ap').value;
    const errEl = g('sb-aerr');
    errEl.textContent = '';

    if (!email.includes('@'))  { errEl.textContent = 'Please enter a valid email address'; return; }
    if (pw.length < 6)         { errEl.textContent = 'Password must be at least 6 characters'; return; }
    if (isSignUp && pw !== g('sb-ap2')?.value) { errEl.textContent = 'Passwords do not match'; return; }

    const btn = g('sb-asub');
    btn.disabled    = true;
    btn.textContent = isSignUp ? 'Creating account…' : 'Signing in…';

    const err = isSignUp ? await signUp(email, pw) : await signIn(email, pw);
    if (err === '__confirm_email__') {
      // Account created but email confirmation is required
      const box = modal.querySelector('.modal-box');
      if (box) box.innerHTML = `
        <div style="text-align:center;padding:0.5rem 0;">
          <div style="font-size:2rem;margin-bottom:0.8rem;">📬</div>
          <h2 style="margin-bottom:0.6rem;">Check your email</h2>
          <p style="color:var(--muted);font-size:0.88rem;line-height:1.6;margin-bottom:1.4rem;">
            We sent a confirmation link to<br>
            <strong style="color:var(--text);">${email}</strong><br><br>
            Click it to activate your account, then sign in here.
          </p>
          <button class="btn btn-primary" style="width:100%;justify-content:center;"
            onclick="document.getElementById('sb-auth-modal').style.display='none'">Got it</button>
        </div>`;
    } else if (err) {
      // Friendlier message for the most common sign-in failure
      const friendly = err.toLowerCase().includes('not confirmed')
        ? 'Email not confirmed yet — check your inbox for the confirmation link.'
        : err;
      errEl.textContent = friendly;
      btn.disabled    = false;
      btn.textContent = isSignUp ? 'Create Account' : 'Sign In';
    } else {
      modal.style.display = 'none';
    }
  };

  g('sb-asub').onclick = submit;
  [g('sb-ae'), g('sb-ap'), g('sb-ap2')].forEach(el => {
    el?.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  });

  // Escape closes modal
  const onEsc = e => { if (e.key === 'Escape') { modal.style.display = 'none'; document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);

  setTimeout(() => g('sb-ae')?.focus(), 80);
}
