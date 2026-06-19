// Navigation.js — nav panel open/close and page navigation

import { getClasses } from '../engine/classes.js';
import { getDecks, getDeckColor } from '../engine/decks.js';

let _refreshDashboard, _refreshClasses, _refreshQuizSelect, _refreshSavedTests, _refreshWeakSpots, _openClassQuizPanel;

// Hash route names → nav() page keys
export const ROUTES = {
  'dashboard':    'dashboard',
  'classes':      'classes',
  'quiz':         'quiz-select',
  'quiz-builder': 'generator',
  'your-decks':   'saved-tests',
  'weak-spots':   'weak-spots',
};

// nav() page key → hash route name
const PAGE_TO_ROUTE = {
  'dashboard':   'dashboard',
  'classes':     'classes',
  'quiz-select': 'quiz',
  'generator':   'quiz-builder',
  'saved-tests': 'your-decks',
  'weak-spots':  'weak-spots',
};

// Shared object so main.js can read the flag by reference
export const _routing = { navInProgress: false };

export function initNavCallbacks({ refreshDashboard, refreshClasses, refreshQuizSelect, refreshSavedTests, refreshWeakSpots, openClassQuizPanel }) {
  _refreshDashboard = refreshDashboard;
  _refreshClasses = refreshClasses;
  _refreshQuizSelect = refreshQuizSelect;
  _refreshSavedTests = refreshSavedTests;
  _refreshWeakSpots = refreshWeakSpots;
  _openClassQuizPanel = openClassQuizPanel;
}

function _prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// The actual page swap + routing. Logic is unchanged from the original nav().
function _applyNav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-'+page);
  const useVT = !!document.startViewTransition && !_prefersReducedMotion();
  if (pg) {
    pg.classList.add('active');
    // View Transitions handle the cross-fade; legacy fade-up is only the fallback.
    if (!useVT) { pg.classList.add('fade-up'); setTimeout(()=>pg.classList.remove('fade-up'),400); }
  }
  document.querySelectorAll(`.nav-item[data-page="${page}"]`).forEach(n => n.classList.add('active'));
  closeNav();
  if (page === 'dashboard') _refreshDashboard?.();
  if (page === 'classes') _refreshClasses?.();
  if (page === 'quiz-select') _refreshQuizSelect?.();
  if (page === 'saved-tests') _refreshSavedTests?.();
  if (page === 'weak-spots') _refreshWeakSpots?.();

  // Update URL hash — flag prevents the hashchange listener from re-firing
  const route = PAGE_TO_ROUTE[page] || page;
  _routing.navInProgress = true;
  window.location.hash = route;
  setTimeout(() => { _routing.navInProgress = false; }, 50);
}

// Section changes morph via the View Transitions API; falls back to instant.
export function nav(page) {
  if (!document.startViewTransition || _prefersReducedMotion()) { _applyNav(page); return; }
  document.startViewTransition(() => _applyNav(page));
}

export function openNav() {
  renderNavTree();
  document.getElementById('nav-panel').classList.add('open');
  document.getElementById('nav-overlay').classList.add('open');
}

export function closeNav() {
  document.getElementById('nav-panel').classList.remove('open');
  document.getElementById('nav-overlay').classList.remove('open');
}

/* ── File-tree menu (Step 2) ─────────────────────────────────── */
// Top-level destinations (Classes is injected between Dashboard and Quick Quiz).
const TREE_TOP = [
  { page: 'dashboard',   icon: '📊', label: 'Dashboard' },
  { page: 'quiz-select', icon: '🎮', label: 'Quick Quiz' },
  { page: 'generator',   icon: '🛠️', label: 'Quiz Builder' },
  { page: 'saved-tests', icon: '📁', label: 'Saved Tests' },
  { page: 'weak-spots',  icon: '🎯', label: 'Weak Spots' },
];

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function _currentPage() {
  const route = (window.location.hash.slice(1).split('?')[0]) || 'dashboard';
  return ROUTES[route] || 'dashboard';
}

function _goTo(page) { closeNav(); nav(page); }

function _leafRow({ icon, label, accent, active, onClick }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'nt-row nt-leaf' + (active ? ' active' : '');
  if (accent) row.style.setProperty('--nt-accent', accent);
  const glyph = accent
    ? `<span class="nt-dot"></span><span class="nt-file" aria-hidden="true">📄</span>`
    : `<span class="nt-ico" aria-hidden="true">${icon}</span>`;
  row.innerHTML = `<span class="nt-chevron-spacer" aria-hidden="true"></span>${glyph}<span class="nt-label">${_esc(label)}</span>`;
  row.addEventListener('click', onClick);
  return row;
}

function _branchRow({ icon, label, accent }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'nt-row nt-branch';
  row.setAttribute('aria-expanded', 'false');
  if (accent) row.style.setProperty('--nt-accent', accent);
  const glyph = accent
    ? `<span class="nt-dot"></span>`
    : `<span class="nt-ico" aria-hidden="true">${icon}</span>`;
  row.innerHTML = `<span class="nt-chevron" aria-hidden="true">▸</span>${glyph}<span class="nt-label">${_esc(label)}</span>`;

  const children = document.createElement('div');
  children.className = 'nt-children';

  row.addEventListener('click', () => {
    const open = row.classList.toggle('open');
    row.setAttribute('aria-expanded', String(open));
    children.classList.toggle('open', open);
  });
  return { row, children };
}

// Build the nested tree from live classes/decks. Called each time the panel
// opens so it reflects current data. Navigation still resolves via nav().
export function renderNavTree() {
  const root = document.getElementById('nav-tree-root');
  if (!root) return;
  const current = _currentPage();
  root.innerHTML = '';

  // Dashboard
  root.appendChild(_leafRow({ icon: '📊', label: 'Dashboard', active: current === 'dashboard', onClick: () => _goTo('dashboard') }));

  // Classes ▸ class ▸ deck
  const classesBranch = _branchRow({ icon: '📁', label: 'Classes' });
  // "Pegboard" tag — navigates to the Classes page without toggling the tree.
  const pegboard = document.createElement('button');
  pegboard.type = 'button';
  pegboard.className = 'nt-page-tag btn-glass';
  pegboard.textContent = 'Pegboard';
  pegboard.title = 'Open Classes page';
  pegboard.addEventListener('click', (e) => { e.stopPropagation(); _goTo('classes'); });
  classesBranch.row.appendChild(pegboard);
  root.appendChild(classesBranch.row);
  root.appendChild(classesBranch.children);

  const classes = getClasses();
  const decks   = getDecks();
  classes.forEach(cls => {
    const clsBranch = _branchRow({ label: cls.name, accent: cls.color });
    classesBranch.children.appendChild(clsBranch.row);
    classesBranch.children.appendChild(clsBranch.children);

    const clsDecks = decks.filter(d => d.classId === cls.id);
    if (clsDecks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nt-empty';
      empty.textContent = 'no decks yet';
      clsBranch.children.appendChild(empty);
    } else {
      clsDecks.forEach(deck => {
        clsBranch.children.appendChild(_leafRow({
          label: deck.name,
          accent: getDeckColor(deck),
          onClick: () => { closeNav(); _openClassQuizPanel?.(deck, cls); },
        }));
      });
    }
  });

  // Remaining top-level destinations
  TREE_TOP.filter(t => t.page !== 'dashboard').forEach(t => {
    root.appendChild(_leafRow({ icon: t.icon, label: t.label, active: current === t.page, onClick: () => _goTo(t.page) }));
  });
}

export function initNavListeners() {
  document.querySelectorAll('.nav-item[data-page]').forEach(b => {
    b.addEventListener('click', () => nav(b.dataset.page));
  });
  // Escape closes the file-tree panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('nav-panel')?.classList.contains('open')) closeNav();
  });
}
