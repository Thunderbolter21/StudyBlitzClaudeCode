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

  const showCount = ['standard', 'exam'].includes(mode);
  const showTime  = mode === 'timechallenge';

  if (qcWrap) qcWrap.style.display = showCount ? 'block' : 'none';
  if (tcWrap) tcWrap.style.display = showTime  ? 'block' : 'none';
  if (tcSel)  tcSel.disabled       = !showTime;

  refreshQuizSelect();
}

/* ── initQuizSelectListeners ───────────────────────────────── */
// Called once on boot. Syncs .selected on mode cards (:has() JS fallback).
// onModeChange() fires via event bubbling to #qs-modes.
export function initQuizSelectListeners() {
  const allModeRadios = document.querySelectorAll('input[name="quiz-mode"]');

  const syncSelected = () => {
    allModeRadios.forEach(r => {
      r.closest('.mode-card')?.classList.toggle('selected', r.checked);
    });
  };

  allModeRadios.forEach(r => r.addEventListener('change', syncSelected));
  syncSelected();
}

/* ── getSelectedMode(prefix) ───────────────────────────────── */
export function getSelectedMode(prefix) {
  const radio = document.querySelector(`input[name="${prefix}-quiz-mode"]:checked`);
  return radio?.value || 'standard';
}

/* ── renderModeSelector(container, prefix, deck) ──── */
// Builds the mode-selector DOM into container, namespaced by prefix.
// All IDs and radio names are prefixed — no conflicts with Quick Quiz page IDs.
export function renderModeSelector(container, prefix, deck) {
  const maxQ     = deck.questions.length;
  const defaultQ = Math.min(20, maxQ);

  container.innerHTML = `
    <div class="mode-cards" id="${prefix}-mode-cards">
      <label class="mode-card" id="${prefix}-mc-practice">
        <input type="radio" name="${prefix}-quiz-mode" value="standard" checked>
        <div class="mode-card-inner">
          <div class="mode-card-icon">📚</div>
          <div class="mode-card-label">Practice</div>
          <div class="mode-card-sub">Adaptive MC · feedback after each answer</div>
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
      <label class="mode-card" id="${prefix}-mc-timechallenge">
        <input type="radio" name="${prefix}-quiz-mode" value="timechallenge">
        <div class="mode-card-inner">
          <div class="mode-card-icon">⏱️</div>
          <div class="mode-card-label">Time Challenge</div>
          <div class="mode-card-sub">Race the clock · high scores</div>
        </div>
      </label>
    </div>
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

  const _onChange = () => {
    const mode      = document.querySelector(`input[name="${prefix}-quiz-mode"]:checked`)?.value || 'standard';
    const showCount = ['standard', 'exam'].includes(mode);
    const showTime  = mode === 'timechallenge';
    const qcWrap    = document.getElementById(`${prefix}-count-wrap`);
    const tcWrap    = document.getElementById(`${prefix}-tc-wrap`);
    const tcSel     = document.getElementById(`${prefix}-tc-sel`);
    if (qcWrap) qcWrap.style.display = showCount ? 'block' : 'none';
    if (tcWrap) tcWrap.style.display = showTime  ? 'block' : 'none';
    if (tcSel)  tcSel.disabled = !showTime;
  };

  const allRadios = container.querySelectorAll(`input[name="${prefix}-quiz-mode"]`);

  const _syncSelected = () => {
    allRadios.forEach(r => r.closest('.mode-card')?.classList.toggle('selected', r.checked));
  };

  allRadios.forEach(r => r.addEventListener('change', () => { _onChange(); _syncSelected(); }));

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
