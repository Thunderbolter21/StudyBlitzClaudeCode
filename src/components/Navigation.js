// Navigation.js — nav panel open/close and page navigation

let _refreshDashboard, _refreshClasses, _refreshQuizSelect, _refreshSavedTests, _refreshWeakSpots;

export function initNavCallbacks({ refreshDashboard, refreshClasses, refreshQuizSelect, refreshSavedTests, refreshWeakSpots }) {
  _refreshDashboard = refreshDashboard;
  _refreshClasses = refreshClasses;
  _refreshQuizSelect = refreshQuizSelect;
  _refreshSavedTests = refreshSavedTests;
  _refreshWeakSpots = refreshWeakSpots;
}

export function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-'+page);
  if (pg) { pg.classList.add('active'); pg.classList.add('fade-up'); setTimeout(()=>pg.classList.remove('fade-up'),400); }
  document.querySelectorAll(`.nav-item[data-page="${page}"]`).forEach(n => n.classList.add('active'));
  closeNav();
  if (page === 'dashboard') _refreshDashboard?.();
  if (page === 'classes') _refreshClasses?.();
  if (page === 'quiz-select') _refreshQuizSelect?.();
  if (page === 'saved-tests') _refreshSavedTests?.();
  if (page === 'weak-spots') _refreshWeakSpots?.();
}

export function openNav() {
  document.getElementById('nav-panel').classList.add('open');
  document.getElementById('nav-overlay').classList.add('open');
}

export function closeNav() {
  document.getElementById('nav-panel').classList.remove('open');
  document.getElementById('nav-overlay').classList.remove('open');
}

export function initNavListeners() {
  document.querySelectorAll('.nav-item[data-page]').forEach(b => {
    b.addEventListener('click', () => nav(b.dataset.page));
  });
}
