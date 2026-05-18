// QuizSelect.js — quiz selection page: deck picker, mode, question count, high scores

import { getDecks, getDeckById, getDeckColor } from '../engine/decks.js';
import { getHS, hsKey, getBestHS, setSelectedDeckId } from '../engine/quiz.js';

let _toast, _nav;
export function initQuizSelectCallbacks({ toast, nav }) {
  _toast = toast; _nav = nav;
}

let selectedDeckId = null;

/* ── refreshQuizSelect ─────────────────────────────────────── */
export function refreshQuizSelect() {
  const decks = getDecks();
  const mode = document.querySelector('input[name="quiz-mode"]:checked')?.value || 'standard';
  const tcSecs = parseInt(document.getElementById('tc-time-sel')?.value || '60');
  const hs = getHS();

  const list = document.getElementById('qs-deck-list');
  if (!list) return;
  list.innerHTML = '';

  decks.forEach(deck => {
    const wrap = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'justify-content:flex-start;border-radius:10px;width:100%;';
    btn.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:${deck.color};flex-shrink:0;"></span> ${deck.name} <span style="margin-left:auto;color:var(--muted);font-size:0.75rem;">${deck.questions.length}q</span>`;
    btn.onclick = () => {
      selectedDeckId = deck.id;
      setSelectedDeckId(deck.id);
      document.querySelectorAll('#qs-deck-list .btn').forEach(b => { b.style.background = ''; b.style.borderColor = ''; b.style.color = ''; });
      btn.style.background = 'rgba(255,63,108,0.12)';
      btn.style.borderColor = 'var(--accent)';
      btn.style.color = 'var(--accent)';
      document.getElementById('qs-start-btn').disabled = false;
      const countEl = document.getElementById('qs-count');
      const hint = document.getElementById('qs-count-hint');
      if (countEl) { countEl.max = deck.questions.length; if (parseInt(countEl.value) > deck.questions.length) countEl.value = deck.questions.length; }
      if (hint) hint.textContent = '5 – ' + deck.questions.length + ' questions · steps of 5';
    };
    if (deck.id === selectedDeckId) {
      btn.style.background = 'rgba(255,63,108,0.12)';
      btn.style.borderColor = 'var(--accent)';
      btn.style.color = 'var(--accent)';
    }
    wrap.appendChild(btn);

    if (mode === 'timechallenge') {
      const rec = hs[hsKey(deck.id, tcSecs)];
      const hsDiv = document.createElement('div');
      hsDiv.className = 'hs-row';
      hsDiv.textContent = rec ? 'Best: ' + rec.correct + ' correct in ' + tcSecs + 's' : 'Best: —';
      wrap.appendChild(hsDiv);
    }
    list.appendChild(wrap);
  });

  if (!decks.some(d => !d.builtIn)) {
    const nudge = document.createElement('div');
    nudge.style.cssText = 'text-align:center;padding:1rem 0.5rem;';
    nudge.innerHTML = `
      <p style="font-size:0.82rem;color:var(--muted);margin-bottom:0.6rem;">No custom decks yet</p>
      <button class="btn btn-primary btn-sm" onclick="nav('generator')">🛠️ Build your first deck</button>`;
    list.appendChild(nudge);
  }

  const hint = document.getElementById('qs-count-hint');
  if (hint) {
    const selDeck = selectedDeckId ? getDeckById(selectedDeckId) : null;
    hint.textContent = selDeck
      ? '5 – ' + selDeck.questions.length + ' questions · steps of 5'
      : '5 – ? questions · steps of 5';
  }

  const startBtn = document.getElementById('qs-start-btn');
  if (startBtn) startBtn.disabled = !selectedDeckId;
}

/* ── onModeChange ──────────────────────────────────────────── */
export function onModeChange() {
  const mode = document.querySelector('input[name="quiz-mode"]:checked')?.value || 'standard';

  const qcWrap = document.getElementById('qs-count-wrap');
  const tcWrap = document.getElementById('tc-time-wrap');
  const tcSel  = document.getElementById('tc-time-sel');

  // Show count for Practice/Speed/Streak/Exam; show time only for TC; hide count for Drill+TC
  const showCount = ['standard', 'speed', 'streak', 'exam'].includes(mode);
  const showTime  = mode === 'timechallenge';

  if (qcWrap) qcWrap.style.display = showCount ? 'block' : 'none';
  if (tcWrap) tcWrap.style.display = showTime  ? 'block' : 'none';
  if (tcSel)  tcSel.disabled       = !showTime;

  // Clear Practice sub-settings when switching away from the Practice card
  if (mode !== 'standard') {
    const speedChk  = document.getElementById('opt-speed');
    const streakChk = document.getElementById('opt-streak');
    if (speedChk)  speedChk.checked  = false;
    if (streakChk) streakChk.checked = false;
  }

  refreshQuizSelect();
}

/* ── toggleGameModes ───────────────────────────────────────── */
export function toggleGameModes(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('qs-game-modes')?.classList.toggle('open');
}

/* ── initQuizSelectListeners ───────────────────────────────── */
// Called once on boot. Wires two behaviours:
//   1. JS :has() fallback — syncs .selected on mode cards and .gm-active on
//      the disclosure for browsers that don't support :has() yet.
//   2. Game-mode radios auto-open the disclosure panel when selected.
// onModeChange() is NOT called here — it fires via event bubbling to #qs-modes.
export function initQuizSelectListeners() {
  const allModeRadios = document.querySelectorAll('input[name="quiz-mode"]');
  const disc = document.getElementById('qs-game-modes');

  const syncSelected = () => {
    allModeRadios.forEach(r => {
      r.closest('.mode-card')?.classList.toggle('selected', r.checked);
    });
    const gameModeActive = !!document.querySelector('#gm-panel input[type="radio"]:checked');
    disc?.classList.toggle('gm-active', gameModeActive);
  };

  allModeRadios.forEach(r => r.addEventListener('change', syncSelected));

  document.querySelectorAll('#gm-panel input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => disc?.classList.add('open'));
  });

  syncSelected(); // set initial state — Practice card is checked by default
}

/* ── adjQCount ─────────────────────────────────────────────── */
export function adjQCount(d) {
  const countEl = document.getElementById('qs-count');
  if (!countEl) return;
  let c = parseInt(countEl.value) || 20;
  c += d;
  c = Math.max(5, c);
  if (selectedDeckId) {
    const deck = getDeckById(selectedDeckId);
    if (deck) c = Math.min(deck.questions.length, c);
  }
  countEl.value = c;
}
