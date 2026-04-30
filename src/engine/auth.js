// auth.js — Supabase auth: magic link, sign-in/out, auth state, status UI

import { db, setSupaUser, getSupaUser, lsLoad, lsSave, supaLoadDecks, supaSaveDeck, supaLoadMemory, supaSyncMemory } from './storage.js';
import { KEYS } from '../config.js';
import { getMem, setMem, invalidateMemCache } from './memory.js';
import { saveDecks, invalidateDecksCache } from './decks.js';

let _toast, _refreshAll;
export function initAuthCallbacks({ toast, refreshAll }) {
  _toast = toast; _refreshAll = refreshAll;
}

export async function initAuth() {
  if (!db) { console.warn('Supabase not configured — auth disabled'); return; }
  try {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      setSupaUser(session.user);
    }
  } catch (e) {
    console.warn('Auth init failed:', e);
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      const current = getSupaUser();
      if (!current || current.id !== session.user.id) {
        await onSignIn(session.user);
      }
    } else if (event === 'SIGNED_OUT') {
      setSupaUser(null);
      updateAuthStatus();
    }
  });
}

async function onSignIn(user) {
  setSupaUser(user);
  updateAuthStatus();
  _toast?.('Signed in as ' + user.email + ' — syncing...', 3500);

  const cloudDecks = await supaLoadDecks();
  if (cloudDecks && cloudDecks.length > 0) {
    const localDecks = lsLoad(KEYS.decks) || [];
    const cloudIds = new Set(cloudDecks.map(d => d.id));
    const localOnly = localDecks.filter(d => !cloudIds.has(d.id) && d.id !== 'builtin-mkt300');
    for (const d of localOnly) await supaSaveDeck(d);
    const merged = cloudDecks.filter(d => d.id !== 'builtin-mkt300');
    const localBuiltin = localDecks.find(d => d.id === 'builtin-mkt300');
    const allDecks = localBuiltin ? [localBuiltin, ...merged, ...localOnly] : [...merged, ...localOnly];
    saveDecks(allDecks);
    _refreshAll?.();
    _toast?.('Decks synced across devices', 3000);
  } else {
    const localDecks = lsLoad(KEYS.decks) || [];
    for (const d of localDecks) {
      if (d.id !== 'builtin-mkt300') await supaSaveDeck(d);
    }
  }

  const cloudMem = await supaLoadMemory();
  if (cloudMem && Object.keys(cloudMem).length > 0) {
    const localMem = getMem();
    const mergedMem = { ...localMem };
    for (const [qid, cr] of Object.entries(cloudMem)) {
      const lr = localMem[qid];
      if (!lr || cr.total >= lr.total) mergedMem[qid] = cr;
    }
    lsSave(KEYS.memory, mergedMem);
    invalidateMemCache();
    _refreshAll?.();
  } else {
    await supaSyncMemory(getMem());
  }
}

export function updateAuthStatus() {
  const statusEl = document.getElementById('auth-status');
  const btnEl = document.getElementById('link-account-btn');
  if (!statusEl) return;
  const user = getSupaUser();
  if (user) {
    const email = user.email || 'Signed in';
    const short = email.length > 22 ? email.substring(0, 19) + '...' : email;
    statusEl.innerHTML = '<span style="color:var(--green)">&#9679;</span> ' + short;
    if (btnEl) {
      btnEl.querySelector('span:last-child').textContent = 'Sign Out';
      btnEl.onclick = signOut;
    }
  } else {
    statusEl.textContent = 'Not signed in — data is local only';
    if (btnEl) {
      btnEl.querySelector('span:last-child').textContent = 'Link Account';
      btnEl.onclick = openAuthModal;
    }
  }
}

async function signOut() {
  if (db) await db.auth.signOut();
  setSupaUser(null);
  updateAuthStatus();
  _toast?.('Signed out. Data saved locally.');
}

export function openAuthModal() {
  const existing = document.getElementById('auth-modal');
  if (existing) { existing.style.display = 'flex'; return; }
  const ov = document.createElement('div');
  ov.id = 'auth-modal';
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.innerHTML = `
    <div class="modal-box">
      <h2>Sign In to StudyBlitz</h2>
      <p style="color:var(--muted);font-size:.88rem;margin-bottom:1.2rem;line-height:1.6;">
        Enter your email and we'll send you a magic link — no password needed.
        Your decks and progress sync automatically across all your devices.
      </p>
      <div id="auth-sent" style="display:none;background:rgba(0,229,160,.1);border:1px solid var(--green);border-radius:10px;padding:1rem;font-size:.88rem;color:var(--green);margin-bottom:1rem;">
        Magic link sent! Check your email and click the link to sign in.
      </div>
      <label class="lbl-s">Your Email</label>
      <input type="email" id="auth-email-input" placeholder="you@example.com" style="margin-bottom:1rem;" />
      <div id="auth-err" style="font-size:.82rem;color:var(--accent);min-height:1rem;margin-bottom:.8rem;"></div>
      <div style="display:flex;gap:.8rem;flex-wrap:wrap;">
        <button class="btn btn-primary" id="auth-send-btn">Send Magic Link</button>
        <button class="btn btn-ghost" id="auth-cancel-btn">Cancel</button>
      </div>
      <p style="font-size:.72rem;color:var(--muted);margin-top:1rem;">
        First time? Just enter your email — an account is created automatically.
      </p>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#auth-send-btn').onclick = sendMagicLink;
  ov.querySelector('#auth-cancel-btn').onclick = () => { ov.style.display = 'none'; };
  ov.onclick = (e) => { if (e.target === ov) ov.style.display = 'none'; };
  const inp = ov.querySelector('#auth-email-input');
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMagicLink(); });
  setTimeout(() => inp.focus(), 100);
}

async function sendMagicLink() {
  const email = document.getElementById('auth-email-input')?.value?.trim();
  const errEl = document.getElementById('auth-err');
  if (!email || !email.includes('@')) {
    if (errEl) errEl.textContent = 'Please enter a valid email';
    return;
  }
  if (errEl) errEl.textContent = '';
  if (!db) {
    if (errEl) errEl.textContent = 'Supabase not configured — sign-in unavailable';
    return;
  }
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });
  if (error) {
    if (errEl) errEl.textContent = error.message;
    return;
  }
  const sentEl = document.getElementById('auth-sent');
  if (sentEl) sentEl.style.display = 'block';
  const inp = document.getElementById('auth-email-input');
  if (inp) inp.disabled = true;
}

export async function syncOnBoot() {
  const user = getSupaUser();
  if (!user) return;
  try {
    const cloudDecks = await supaLoadDecks();
    if (cloudDecks) {
      const localDecks = lsLoad(KEYS.decks) || [];
      const cloudIds = new Set(cloudDecks.map(d => d.id));
      const localOnly = localDecks.filter(d => !cloudIds.has(d.id) && d.id !== 'builtin-mkt300');
      const merged = cloudDecks.filter(d => d.id !== 'builtin-mkt300');
      const localBuiltin = localDecks.find(d => d.id === 'builtin-mkt300');
      const allDecks = localBuiltin ? [localBuiltin, ...merged, ...localOnly] : [...merged, ...localOnly];
      saveDecks(allDecks);
    }
    const cloudMem = await supaLoadMemory();
    if (cloudMem) {
      const localMem = getMem();
      const mergedMem = { ...localMem };
      for (const [qid, cr] of Object.entries(cloudMem)) {
        const lr = localMem[qid];
        if (!lr || cr.total > lr.total) mergedMem[qid] = cr;
      }
      lsSave(KEYS.memory, mergedMem);
      invalidateMemCache();
    }
  } catch (e) {
    console.warn('Boot sync failed:', e);
  }
}
