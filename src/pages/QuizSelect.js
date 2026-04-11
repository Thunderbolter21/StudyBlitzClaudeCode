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
      if (hint) hint.textContent = 'Max: ' + deck.questions.length + ' questions in this deck';
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

  const startBtn = document.getElementById('qs-start-btn');
  if (startBtn) startBtn.disabled = !selectedDeckId;
}

/* ── onModeChange ──────────────────────────────────────────── */
export function onModeChange() {
  const mode = document.querySelector('input[name="quiz-mode"]:checked')?.value || 'standard';
  const tcWrap = document.getElementById('tc-time-wrap');
  const qcWrap = document.getElementById('qs-count-wrap');
  if (tcWrap) tcWrap.style.display = mode === 'timechallenge' ? 'block' : 'none';
  if (qcWrap) qcWrap.style.display = mode === 'timechallenge' ? 'none' : 'block';
  refreshQuizSelect();
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
