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

/* ── getSelectedMode(prefix) ───────────────────────────────── */
// Reads the checked radio for the given prefix and resolves Practice sub-settings.
// Speed takes priority over Streak if both are checked.
export function getSelectedMode(prefix) {
  const radio = document.querySelector(`input[name="${prefix}-quiz-mode"]:checked`);
  let mode = radio?.value || 'standard';
  if (mode === 'standard') {
    const speedOn  = document.getElementById(`${prefix}-opt-speed`)?.checked;
    const streakOn = document.getElementById(`${prefix}-opt-streak`)?.checked;
    if (speedOn)       mode = 'speed';
    else if (streakOn) mode = 'streak';
  }
  return mode;
}

/* ── renderModeSelector(container, prefix, deck, options) ──── */
// Builds the full mode-selector DOM into container, namespaced by prefix.
// All IDs and radio names are prefixed — no conflicts with Quick Quiz page IDs.
// options: { includeGameModes: true }
export function renderModeSelector(container, prefix, deck, options = {}) {
  const { includeGameModes = true } = options;
  const maxQ     = deck.questions.length;
  const defaultQ = Math.min(20, maxQ);

  const gameModeHTML = includeGameModes ? `
    <div class="game-modes-disclosure" id="${prefix}-game-modes">
      <button class="game-modes-toggle" type="button" id="${prefix}-gm-toggle">
        <span>⚡ Other Game Modes</span>
        <span class="gm-chevron">▼</span>
      </button>
      <div class="game-modes-panel" id="${prefix}-gm-panel">
        <label class="mode-card mode-card-sm">
          <input type="radio" name="${prefix}-quiz-mode" value="timechallenge">
          <div class="mode-card-inner">
            <div class="mode-card-icon">⏱️</div>
            <div class="mode-card-label">Time Challenge</div>
            <div class="mode-card-sub">Race the clock · high scores</div>
          </div>
        </label>
        <label class="mode-card mode-card-sm">
          <input type="radio" name="${prefix}-quiz-mode" value="speed">
          <div class="mode-card-inner">
            <div class="mode-card-icon">⚡</div>
            <div class="mode-card-label">Speed Bonus</div>
            <div class="mode-card-sub">Timer per question · fast = more points</div>
          </div>
        </label>
        <label class="mode-card mode-card-sm">
          <input type="radio" name="${prefix}-quiz-mode" value="streak">
          <div class="mode-card-inner">
            <div class="mode-card-icon">🔥</div>
            <div class="mode-card-label">Streak Mode</div>
            <div class="mode-card-sub">Points multiply on consecutive correct answers</div>
          </div>
        </label>
      </div>
    </div>` : '';

  container.innerHTML = `
    <div class="mode-cards" id="${prefix}-mode-cards">
      <label class="mode-card" id="${prefix}-mc-practice">
        <input type="radio" name="${prefix}-quiz-mode" value="standard" checked>
        <div class="mode-card-inner">
          <div class="mode-card-icon">📚</div>
          <div class="mode-card-label">Practice</div>
          <div class="mode-card-sub">Adaptive MC · feedback after each answer</div>
        </div>
        <div class="mode-sub-settings" id="${prefix}-practice-sub">
          <label class="sub-toggle">
            <input type="checkbox" id="${prefix}-opt-speed">
            <span>⚡ Speed Bonus</span>
            <span class="sub-hint">Timer per question</span>
          </label>
          <label class="sub-toggle">
            <input type="checkbox" id="${prefix}-opt-streak">
            <span>🔥 Streak Mode</span>
            <span class="sub-hint">Multiplier on streaks</span>
          </label>
        </div>
      </label>
      <label class="mode-card" id="${prefix}-mc-exam">
        <input type="radio" name="${prefix}-quiz-mode" value="exam">
        <div class="mode-card-inner">
          <div class="mode-card-icon">📋</div>
          <div class="mode-card-label">Exam Mode</div>
          <div class="mode-card-sub">All questions at once · graded on submit</div>
        </div>
      </label>
    </div>
    ${gameModeHTML}
    <div id="${prefix}-tc-wrap" style="display:none;margin-top:0.8rem;">
      <label>Time Limit</label>
      <select id="${prefix}-tc-sel" style="margin-bottom:0;">
        <option value="30">30 seconds</option>
        <option value="60" selected>60 seconds</option>
        <option value="90">90 seconds</option>
        <option value="120">2 minutes</option>
        <option value="300">5 minutes</option>
      </select>
    </div>
    <div id="${prefix}-count-wrap" style="margin-top:0.8rem;">
      <label>Number of Questions</label>
      <div class="num-input">
        <button type="button" id="${prefix}-count-minus">−</button>
        <input type="text" id="${prefix}-count" value="${defaultQ}" style="width:70px;text-align:center;">
        <button type="button" id="${prefix}-count-plus">+</button>
      </div>
      <div id="${prefix}-count-hint" style="font-size:0.7rem;color:var(--muted);margin-top:0.4rem;">5 – ${maxQ} questions · steps of 5</div>
    </div>`;

  // Local onModeChange — reads from prefixed elements only
  const _onChange = () => {
    const mode     = document.querySelector(`input[name="${prefix}-quiz-mode"]:checked`)?.value || 'standard';
    const showCount = ['standard', 'speed', 'streak', 'exam'].includes(mode);
    const showTime  = mode === 'timechallenge';
    const qcWrap   = document.getElementById(`${prefix}-count-wrap`);
    const tcWrap   = document.getElementById(`${prefix}-tc-wrap`);
    const tcSel    = document.getElementById(`${prefix}-tc-sel`);
    if (qcWrap) qcWrap.style.display = showCount ? 'block' : 'none';
    if (tcWrap) tcWrap.style.display = showTime  ? 'block' : 'none';
    if (tcSel)  tcSel.disabled = !showTime;
    if (mode !== 'standard') {
      const s = document.getElementById(`${prefix}-opt-speed`);
      const r = document.getElementById(`${prefix}-opt-streak`);
      if (s) s.checked = false;
      if (r) r.checked = false;
    }
  };

  // :has() JS fallback — sync .selected and .gm-active
  const allRadios = container.querySelectorAll(`input[name="${prefix}-quiz-mode"]`);
  const disc      = document.getElementById(`${prefix}-game-modes`);

  const _syncSelected = () => {
    allRadios.forEach(r => r.closest('.mode-card')?.classList.toggle('selected', r.checked));
    if (disc) {
      const gmActive = !!container.querySelector(`#${prefix}-gm-panel input[type="radio"]:checked`);
      disc.classList.toggle('gm-active', gmActive);
    }
  };

  allRadios.forEach(r => r.addEventListener('change', () => { _onChange(); _syncSelected(); }));

  // Game modes disclosure toggle (no global needed — wired directly)
  document.getElementById(`${prefix}-gm-toggle`)?.addEventListener('click', (e) => {
    e.preventDefault();
    disc?.classList.toggle('open');
  });

  // Game mode radios auto-open the disclosure
  container.querySelectorAll(`#${prefix}-gm-panel input[type="radio"]`).forEach(r => {
    r.addEventListener('change', () => disc?.classList.add('open'));
  });

  // Count stepper (addEventListener — no globals needed)
  const countEl = document.getElementById(`${prefix}-count`);
  document.getElementById(`${prefix}-count-minus`)?.addEventListener('click', () => {
    if (countEl) countEl.value = Math.max(5, parseInt(countEl.value) - 5);
  });
  document.getElementById(`${prefix}-count-plus`)?.addEventListener('click', () => {
    if (countEl) countEl.value = Math.min(maxQ, parseInt(countEl.value) + 5);
  });

  _syncSelected();
  _onChange();
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
