// Fab.js — floating action menu (Account / Settings / Logout)
// Pure presentation: it only CALLS existing auth/settings functions, never
// changes auth, routing, or data logic.

import { isLoggedIn, getCurrentUser, signOut, openAuthModal } from '../engine/auth.js';

let _toast, _openApiModal;
export function initFab({ toast, openApiModal }) {
  _toast = toast;
  _openApiModal = openApiModal;
}

function _prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

let _open = false;

export function initFabUI() {
  if (document.getElementById('sb-fab')) return;

  const fab = document.createElement('div');
  fab.id = 'sb-fab';
  fab.innerHTML = `
    <div class="fab-pills" id="fab-pills" aria-hidden="true"></div>
    <button class="fab-trigger" id="fab-trigger" aria-label="Account menu" aria-expanded="false" aria-haspopup="menu">
      <svg class="fab-ico fab-ico-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3.1"/>
        <path d="M12 3.4v3.1M12 17.5v3.1M3.4 12h3.1M17.5 12h3.1"/>
      </svg>
      <svg class="fab-ico fab-ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18"/>
      </svg>
    </button>`;
  document.body.appendChild(fab);

  const trigger = fab.querySelector('#fab-trigger');
  trigger.addEventListener('click', (e) => { e.stopPropagation(); _toggle(); });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (_open && !e.target.closest('#sb-fab')) _close();
  });
  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _open) { _close(); trigger.focus(); }
  });
}

function _toggle() { _open ? _close() : _openMenu(); }

function _openMenu() {
  const pills   = document.getElementById('fab-pills');
  const fab     = document.getElementById('sb-fab');
  const trigger = document.getElementById('fab-trigger');
  if (!pills || !fab) return;

  pills.innerHTML = '';
  const built = _buildPills();
  // Stagger from the bottom up so pills nearest the trigger appear first.
  built.forEach((p, i) => {
    if (!_prefersReducedMotion()) p.style.animationDelay = `${(built.length - 1 - i) * 55}ms`;
    pills.appendChild(p);
  });

  fab.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  pills.setAttribute('aria-hidden', 'false');
  _open = true;
}

function _close() {
  const fab     = document.getElementById('sb-fab');
  const trigger = document.getElementById('fab-trigger');
  const pills   = document.getElementById('fab-pills');
  if (fab) fab.classList.remove('open');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (pills) pills.setAttribute('aria-hidden', 'true');
  _open = false;
}

function _pill({ icon, label, danger, onClick }) {
  const b = document.createElement('button');
  b.className = 'fab-pill btn-glass' + (danger ? ' fab-pill-danger' : '');
  b.setAttribute('role', 'menuitem');
  b.innerHTML = `<span class="fab-pill-ico" aria-hidden="true">${icon}</span><span>${label}</span>`;
  b.addEventListener('click', () => { _close(); onClick(); });
  return b;
}

// Pills adapt to auth state — a guest has no session to log out of.
function _buildPills() {
  if (isLoggedIn()) {
    const user  = getCurrentUser();
    const email = (user && user.email) ? user.email : 'your account';
    return [
      _pill({ icon: '👤', label: 'Account',  onClick: () => _toast?.('Signed in as ' + email) }),
      _pill({ icon: '⚙️', label: 'Settings', onClick: () => _openApiModal?.() }),
      _pill({ icon: '🚪', label: 'Logout',   danger: true, onClick: () => signOut() }),
    ];
  }
  return [
    _pill({ icon: '🔑', label: 'Sign In',  onClick: () => openAuthModal('signin') }),
    _pill({ icon: '⚙️', label: 'Settings', onClick: () => _openApiModal?.() }),
  ];
}
