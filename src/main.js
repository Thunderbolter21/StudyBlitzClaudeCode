// main.js — boot sequence, callback wiring, window globals, event listeners

import './styles/main.css';
import './styles/quiz.css';
import './styles/exam.css';
import './styles/classes.css';

import { nav, openNav, closeNav, initNavCallbacks, initNavListeners } from './components/Navigation.js';
import { initDeckCardCallbacks } from './components/DeckCard.js';
import { toggleDeckMenu, openAssignClassModal, openCreateClassModal, openClassMenu, initModalCallbacks, openGuestSignupModal, closeGuestSignupModal } from './components/Modals.js';
import { initDeckCallbacks, getDecks, getDeckById, deleteDeck, initBuiltins } from './engine/decks.js';
import { initAuth, syncOnBoot, scheduleSync, openAuthModal, updateAuthStatus, initAuthCallbacks } from './engine/auth.js';
import { registerSyncCallback } from './engine/storage.js';
import {
  QS, EX, getHS, hsKey, getBestHS, saveHS,
  quickStartDeck, drillDeck, launchQuiz, launchDrillAll, launchDrillFromResults,
  startQS, renderQ, answerQ, quizNext, exitQuiz, showResults,
  replayQuiz, closeResults, reviewExam,
  showTCResults, replayTC, closeTCResults,
  launchExam, renderExam, submitExam, exitExam,
  getAllWeakCount, renderFixButton, launchConfetti,
  initQuizCallbacks
} from './engine/quiz.js';
import { refreshDashboard, openKnowledgeBreakdown, closeKB, relaunchRecent, openReviewModal, initDashboardCallbacks, showGettingStarted } from './pages/Dashboard.js';
import { refreshClasses, drillClassMixed, openClassQuizPanel, adjCQCount, launchClassQuiz, initClassesCallbacks } from './pages/Classes.js';
import { refreshQuizSelect, onModeChange, adjQCount, initQuizSelectCallbacks, toggleGameModes, initQuizSelectListeners } from './pages/QuizSelect.js';
import { refreshSavedTests, initSavedTestsCallbacks } from './pages/SavedTests.js';
import { refreshWeakSpots, initWeakSpotsCallbacks } from './pages/WeakSpots.js';
import {
  switchMethod, copyPromptForClaude, importFromJson, clearImport, generateDeck, saveDeck,
  adjGenCount, switchTab, setupDropZone, handleFiles,
  openApiModal, closeApiModal, toggleKeyVis, saveApiKey, removeApiKey, updateKeyBadge,
  promptClassAssignment, initGeneratorCallbacks
} from './pages/Generator.js';

// ── Global error boundary ──
window.onerror = (msg, src, line, col, err) => {
  console.error('[StudyBlitz] Uncaught error:', err || msg, src ? `${src}:${line}:${col}` : '');
};
window.onunhandledrejection = (e) => {
  console.error('[StudyBlitz] Unhandled promise rejection:', e.reason);
};

// ── Toast notification ──
export function toast(msg, duration=2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Refresh all pages ──
export function refreshAll() {
  refreshDashboard();
  refreshClasses();
  refreshQuizSelect();
  refreshSavedTests();
  refreshWeakSpots();
  updateKeyBadge();
}

// ── Wire up all callback injections ──
function wireCallbacks() {
  initAuthCallbacks({ toast, refreshAll });
  initDeckCallbacks(toast, refreshAll);
  initModalCallbacks({ toast, refreshAll, deleteDeck });
  initNavCallbacks({ refreshDashboard, refreshClasses, refreshQuizSelect, refreshSavedTests, refreshWeakSpots });
  initDeckCardCallbacks({ quickStartDeck, drillDeck, toggleDeckMenu, openAssignClassModal });
  initQuizCallbacks({ toast, refreshAll, nav, refreshDashboard, refreshQuizSelect, refreshWeakSpots });
  initDashboardCallbacks({ nav });
  initClassesCallbacks({ toast, nav, refreshAll, refreshClasses });
  initQuizSelectCallbacks({ toast, nav });
  initSavedTestsCallbacks({ toast, nav, refreshAll });
  initWeakSpotsCallbacks({ toast, nav });
  initGeneratorCallbacks({ toast, nav, refreshAll });
}

// ── Expose onclick-referenced functions to window ──
function exposeGlobals() {
  window.nav = nav;
  window.openNav = openNav;
  window.closeNav = closeNav;
  window.refreshQuizSelect = refreshQuizSelect;
  window.onModeChange = onModeChange;
  window.adjQCount = adjQCount;
  window.adjGenCount = adjGenCount;
  window.QS = QS;
  window.launchQuiz = launchQuiz;
  window.launchDrillAll = launchDrillAll;
  window.launchDrillFromResults = launchDrillFromResults;
  window.exitQuiz = exitQuiz;
  window.quizNext = quizNext;
  window.replayQuiz = replayQuiz;
  window.closeResults = closeResults;
  window.reviewExam = reviewExam;
  window.replayTC = replayTC;
  window.closeTCResults = closeTCResults;
  window.submitExam = submitExam;
  window.exitExam = exitExam;
  window.openKnowledgeBreakdown = openKnowledgeBreakdown;
  window.closeKB = closeKB;
  window.openReviewModal = openReviewModal;
  window.showGettingStarted = showGettingStarted;
  window.openCreateClassModal = openCreateClassModal;
  window.openClassMenu = openClassMenu;
  window.switchMethod = switchMethod;
  window.copyPromptForClaude = copyPromptForClaude;
  window.importFromJson = importFromJson;
  window.clearImport = clearImport;
  window.generateDeck = generateDeck;
  window.saveDeck = saveDeck;
  window.switchTab = switchTab;
  window.handleFiles = handleFiles;
  window.openApiModal = openApiModal;
  window.closeApiModal = closeApiModal;
  window.toggleKeyVis = toggleKeyVis;
  window.saveApiKey = saveApiKey;
  window.removeApiKey = removeApiKey;
  window.toast = toast;
  window.openAuthModal = openAuthModal;
  window.openGuestSignupModal = openGuestSignupModal;
  window.closeGuestSignupModal = closeGuestSignupModal;
  window.toggleGameModes = toggleGameModes;
}

// ── Keyboard handler ──
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const qs = document.getElementById('quiz-screen');
    if (!qs || !qs.classList.contains('open')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      const next = document.getElementById('q-next');
      if (next && next.classList.contains('show')) { e.preventDefault(); quizNext(); }
    }
    const map = {a:0,b:1,c:2,d:3,'1':0,'2':1,'3':2,'4':3};
    const k = e.key.toLowerCase();
    if (map[k] !== undefined) {
      const btns = document.querySelectorAll('.opt-btn');
      if (btns.length > map[k] && !btns[0].disabled) answerQ(map[k]);
    }
  });
}

// ── Close dropdown menus on outside click ──
function initClickOutside() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#deck-ctx-menu') && !e.target.closest('.deck-ellipsis')) {
      const menu = document.getElementById('deck-ctx-menu');
      if (menu) menu.remove();
    }
  });
}

// ── Boot ──
async function boot() {
  wireCallbacks();                        // must be first — wires toast/_refreshAll
  exposeGlobals();
  initNavListeners();
  initKeyboard();
  initClickOutside();
  setupDropZone();
  updateKeyBadge();
  registerSyncCallback(scheduleSync);     // auto-sync on any data save

  await syncOnBoot();                     // 4a: restore session + silent merge FIRST
  await initBuiltins();                   // ensure MKT300 built-in exists
  initAuth();                             // set up onAuthStateChange listener

  refreshAll();
  updateAuthStatus();                     // render correct auth state in nav + banner
  initQuizSelectListeners();              // wire game-mode radio auto-open once
}

boot();
