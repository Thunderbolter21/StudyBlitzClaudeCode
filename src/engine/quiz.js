// quiz.js — Quiz engine: QS state, EX exam state, high scores, all quiz/exam functions

import { KEYS } from '../config.js';
import { load, save } from './storage.js';
import { getMem, setMem, getRec, updateRec, isWeak, isMastered, drillCleared, isDue, weightedSample, interleaveQuestions } from './memory.js';
import { getDecks, getDeckById, getDeckColor, saveDecks } from './decks.js';
import { getClasses } from './classes.js';

// ── Callback injection for DOM/nav helpers ──
let _toast, _refreshAll, _nav, _refreshDashboard, _refreshQuizSelect, _refreshWeakSpots;
export function initQuizCallbacks({ toast, refreshAll, nav, refreshDashboard, refreshQuizSelect, refreshWeakSpots }) {
  _toast = toast;
  _refreshAll = refreshAll;
  _nav = nav;
  _refreshDashboard = refreshDashboard;
  _refreshQuizSelect = refreshQuizSelect;
  _refreshWeakSpots = refreshWeakSpots;
}

// ── Question type helpers ──
function getQType(q) {
  const t = (q.type || '').toLowerCase().replace(/[\s_]/g, '-').trim();
  if (t === 'free-response' || t === 'freeresponse') return 'free-response';
  if (t === 'multi-select'  || t === 'multiselect')  return 'multi-select';
  return 'mc';
}

function gradeFreeResponse(typed, answerVariants) {
  const normalize = s => s.toLowerCase().trim().replace(/[.,!?;:'"()[\]{}]/g, '').replace(/\s+/g, ' ');
  const n = normalize(typed);
  if (!n) return false;
  return (answerVariants || []).some(v => normalize(v) === n);
}

function gradeMultiSelect(selectedIndices, correctIndices) {
  if (!Array.isArray(selectedIndices) || !Array.isArray(correctIndices)) return false;
  if (selectedIndices.length !== correctIndices.length) return false;
  const sel = [...selectedIndices].sort((a, b) => a - b);
  const cor = [...correctIndices].sort((a, b) => a - b);
  return sel.every((v, i) => v === cor[i]);
}

function shuffleAnswerPositions(question) {
  const type = getQType(question);
  if (type === 'free-response') return { ...question };
  const q = { ...question };
  const len = (q.opts || []).length;
  if (!len) return q;
  const indices = Array.from({ length: len }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOpts = indices.map(i => q.opts[i]);
  if (type === 'mc') return { ...q, opts: newOpts, ans: indices.indexOf(q.ans) };
  if (type === 'multi-select') return { ...q, opts: newOpts, ans: (q.ans || []).map(ci => indices.indexOf(ci)) };
  return { ...q, opts: newOpts };
}

// ── High Scores ──
const HS_KEY = KEYS.highscores;
export function getHS() { return load(HS_KEY) || {}; }
export function saveHS(hs) { save(HS_KEY, hs); }
export function hsKey(deckId, secs) { return deckId + '|' + secs; }
export function getBestHS(deckId) {
  const hs = getHS();
  let best = null;
  for (const [k, v] of Object.entries(hs)) {
    if (k.startsWith(deckId + '|') && (!best || v.correct > best.correct))
      best = { ...v, secs: parseInt(k.split('|')[1]) };
  }
  return best;
}

// ── QS state object ──
export let QS = {
  deck: null, questions: [], current: 0, correct: 0, wrong: 0, score: 0,
  mode: 'standard', streak: 0, bestStreak: 0, catStats: {},
  timer: null, tcSecs: 60, tcTimer: null, sessionMastered: [], missed: []
};

// ── EX state object ──
export let EX = { deck: null, questions: [], answers: {}, graded: false };

// ── Selected deck for quiz-select page ──
export let selectedDeckId = null;
export function setSelectedDeckId(id) { selectedDeckId = id; }

// ── Response-time timer ──
let _questionStartTime = null;

// ══════════════════════════════════════════════
//  QUIZ LAUNCH FUNCTIONS
// ══════════════════════════════════════════════

export function quickStartDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;
  const mem = getMem();
  const n = Math.min(20, deck.questions.length);
  QS.deck = deck;
  QS.questions = weightedSample(deck.questions, mem, n);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode = 'standard';
  startQS();
}

export function drillDeck(deckId) {
  const deck = getDeckById(deckId);
  if (!deck) return;
  const mem = getMem();
  const weak = deck.questions.filter(q => isWeak(getRec(mem, q.id)));
  if (!weak.length) {
    _toast('No weak spots! 🎉');
    return;
  }
  QS.deck = deck;
  QS.questions = weak.sort(() => Math.random() - 0.5);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode = 'drill';
  startQS();
}

export function launchQuiz() {
  if (!selectedDeckId) return;
  const deck = getDeckById(selectedDeckId);
  if (!deck) return;
  const mem = getMem();
  const modeEl = document.querySelector('input[name="quiz-mode"]:checked');
  let mode = modeEl ? modeEl.value : 'standard';

  if (mode === 'exam') {
    const countEl = document.getElementById('qs-count');
    const n = countEl ? Math.min(parseInt(countEl.value) || deck.questions.length, deck.questions.length) : undefined;
    launchExam(selectedDeckId, n);
    return;
  }

  if (mode === 'drill') {
    const weak = deck.questions.filter(q => isWeak(getRec(mem, q.id)));
    if (!weak.length) {
      _toast('No weak spots in this deck!');
      return;
    }
    QS.deck = deck;
    QS.questions = weak.sort(() => Math.random() - 0.5);
    QS.questions = interleaveQuestions(QS.questions, mem);
    QS.mode = 'drill';
    startQS();
    return;
  }

  if (mode === 'timechallenge') {
    const tcSel = document.getElementById('tc-time-sel');
    QS.tcSecs = tcSel ? parseInt(tcSel.value) : 60;
    const n = deck.questions.length;
    QS.deck = deck;
    QS.questions = weightedSample(deck.questions, mem, n);
    QS.mode = 'timechallenge';
    startQS();
    return;
  }

  const countEl = document.getElementById('qs-count');
  const n = countEl ? Math.min(parseInt(countEl.value) || 20, deck.questions.length) : Math.min(20, deck.questions.length);
  QS.deck = deck;
  QS.questions = weightedSample(deck.questions, mem, n);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode = mode;
  startQS();
}

export function launchDrillAll() {
  const decks = getDecks();
  const mem = getMem();
  const seen = new Set();
  const weak = [];
  decks.forEach(d => {
    (d.questions || []).forEach(q => {
      if (!seen.has(q.id) && isWeak(getRec(mem, q.id))) {
        seen.add(q.id);
        weak.push(q);
      }
    });
  });
  if (!weak.length) {
    _toast('No weak spots! 🎉');
    return;
  }
  QS.deck = { id: 'all-weak', name: 'All Weak Spots' };
  QS.questions = weak.sort(() => Math.random() - 0.5);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode = 'drill';
  startQS();
}

export function launchDrillDeck(deckId) {
  const deck = getDecks().find(d => d.id === deckId);
  if (!deck) return;
  const mem  = getMem();
  const weak = deck.questions.filter(q => isWeak(getRec(mem, q.id)));
  if (!weak.length) {
    if (_toast) _toast('No weak spots in this deck! 🎉');
    return;
  }
  QS.deck      = deck;
  QS.questions = weak.sort(() => Math.random() - 0.5);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode      = 'drill';
  startQS();
}

export function launchDrillFromResults() {
  const resultsEl = document.getElementById('quiz-results');
  if (resultsEl) resultsEl.style.display = 'none';
  launchDrillAll();
}

export function launchReviewAll() {
  const decks = getDecks();
  const mem = getMem();
  const seen = new Set();
  const cards = [];
  decks.forEach(d => {
    (d.questions || []).forEach(q => {
      if (!seen.has(q.id) && isDue(getRec(mem, q.id))) {
        seen.add(q.id);
        cards.push(q);
      }
    });
  });
  if (!cards.length) { _toast?.('No cards due for review! 🎉'); return; }
  QS.deck = { id: 'review-all', name: 'SM-2 Review' };
  QS.questions = cards.sort(() => Math.random() - 0.5);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode = 'drill';
  startQS();
}

export function launchReviewClass(classId) {
  const decks = getDecks().filter(d => d.classId === classId);
  const mem = getMem();
  const seen = new Set();
  const cards = [];
  decks.forEach(d => {
    (d.questions || []).forEach(q => {
      if (!seen.has(q.id) && isDue(getRec(mem, q.id))) {
        seen.add(q.id);
        cards.push(q);
      }
    });
  });
  if (!cards.length) { _toast?.('No cards due in this class! 🎉'); return; }
  const cls = getClasses().find(c => c.id === classId);
  QS.deck = { id: `review-class-${classId}`, name: cls ? `${cls.name} — Review` : 'Class Review' };
  QS.questions = cards.sort(() => Math.random() - 0.5);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode = 'drill';
  startQS();
}

// ══════════════════════════════════════════════
//  QUIZ SESSION
// ══════════════════════════════════════════════

export function startQS() {
  QS.current = 0;
  QS.correct = 0;
  QS.wrong = 0;
  QS.score = 0;
  QS.streak = 0;
  QS.bestStreak = 0;
  QS.catStats = {};
  QS.sessionMastered = [];
  QS.missed = [];
  QS.answered = false;

  const elCC = document.getElementById('q-correct-count');
  const elWC = document.getElementById('q-wrong-count');
  if (elCC) elCC.textContent = '0';
  if (elWC) elWC.textContent = '0';
  const fb = document.getElementById('q-feedback');
  if (fb) fb.className = 'feedback';
  const nextBtn = document.getElementById('q-next');
  if (nextBtn) nextBtn.className = 'quiz-next';
  const fixArea = document.getElementById('q-fix-area');
  if (fixArea) fixArea.innerHTML = '';

  // Shuffle answer positions each session so correct option varies
  QS.questions = QS.questions.map(shuffleAnswerPositions);
  QS.msSelected = new Set();

  if (QS.deck && QS.deck.id && QS.deck.id !== 'drill-all' && !QS.deck.id.startsWith('drill-class-') && !QS.deck.id.startsWith('review-')) {
    save(KEYS.recentDeck, { id: QS.deck.id, deckId: QS.deck.id, mode: QS.mode, tcSecs: QS.tcSecs || 60 });
  }

  const screen = document.getElementById('quiz-screen');
  if (screen) screen.classList.add('open');

  const isTC = QS.mode === 'timechallenge';
  const timerBox = document.getElementById('q-timer-box');
  if (timerBox) timerBox.style.display = isTC ? 'block' : 'none';

  const qNumStat = document.getElementById('q-num')?.closest('.hud-stat');
  if (qNumStat) qNumStat.style.display = isTC ? 'none' : '';
  const qProg = document.querySelector('.q-progress');
  if (qProg) qProg.style.display = isTC ? 'none' : '';

  if (isTC) startTCTimer();
  renderQ();
}

export function renderQ() {
  _questionStartTime = Date.now();
  const q = QS.questions[QS.current];
  if (!q) return;
  QS.answered = false;

  if (QS.mode !== 'timechallenge') {
    const qNum = document.getElementById('q-num');
    if (qNum) qNum.textContent = `Q${QS.current + 1} of ${QS.questions.length}`;
    const prog = document.getElementById('q-prog');
    if (prog) prog.style.width = ((QS.current / QS.questions.length) * 100) + '%';
  }

  const qText = document.getElementById('q-text');
  if (qText) qText.textContent = q.q;

  const catBadge = document.getElementById('q-cat-badge');
  if (catBadge) catBadge.textContent = q.cat || 'General';

  // Adaptive badge
  const adaptBadge = document.getElementById('q-adapt-badge');
  if (adaptBadge) {
    const mem = getMem();
    const rec = getRec(mem, q.id);
    if (isWeak(rec)) {
      adaptBadge.style.display = 'inline-flex';
      adaptBadge.className = 'tag tag-red';
      adaptBadge.textContent = `Revisiting · ${rec.total - rec.correct}x missed`;
    } else {
      adaptBadge.style.display = 'none';
    }
  }

  // Reset feedback + next
  const fb = document.getElementById('q-feedback');
  if (fb) fb.className = 'feedback';
  const nextBtn = document.getElementById('q-next');
  if (nextBtn) nextBtn.className = 'quiz-next';
  const fixArea = document.getElementById('q-fix-area');
  if (fixArea) fixArea.innerHTML = '';

  // Render options — branched by question type
  const optsEl = document.getElementById('q-opts');
  if (!optsEl) return;
  optsEl.innerHTML = '';

  const type = getQType(q);
  if (type === 'free-response') {
    _renderFreeResponseInput(q, optsEl);
  } else if (type === 'multi-select') {
    _renderMultiSelectInput(q, optsEl);
  } else {
    const letters = ['A', 'B', 'C', 'D'];
    (q.opts || []).forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'opt-btn';
      btn.innerHTML = `<span class="opt-key">${letters[i] || ''}</span>${opt}`;
      btn.addEventListener('click', () => answerQ(i));
      optsEl.appendChild(btn);
    });
  }
}

function _renderFreeResponseInput(q, container) {
  const badge = document.createElement('div');
  badge.className = 'q-type-badge fr-badge';
  badge.textContent = '📝 Free Response';
  container.appendChild(badge);

  const wrap = document.createElement('div');
  wrap.className = 'fr-input-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fr-input';
  input.id = 'fr-input';
  input.placeholder = 'Type your answer…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _submitFreeResponse(); }
  });

  const submitBtn = document.createElement('button');
  submitBtn.className = 'q-submit-btn';
  submitBtn.id = 'fr-submit-btn';
  submitBtn.textContent = 'Submit';
  submitBtn.addEventListener('click', _submitFreeResponse);

  wrap.appendChild(input);
  wrap.appendChild(submitBtn);
  container.appendChild(wrap);
  setTimeout(() => input.focus(), 80);
}

function _renderMultiSelectInput(q, container) {
  const badge = document.createElement('div');
  badge.className = 'q-type-badge ms-badge';
  badge.textContent = '☑️ Select All That Apply';
  container.appendChild(badge);

  QS.msSelected = new Set();
  const letters = ['A', 'B', 'C', 'D'];

  (q.opts || []).forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'ms-opt-btn';
    btn.dataset.idx = i;
    btn.innerHTML = `<div class="ms-checkbox"></div><span class="opt-key">${letters[i]}</span><span>${opt}</span>`;
    btn.addEventListener('click', () => {
      if (QS.answered) return;
      const cb = btn.querySelector('.ms-checkbox');
      if (QS.msSelected.has(i)) {
        QS.msSelected.delete(i);
        btn.classList.remove('ms-selected');
        cb.textContent = '';
      } else {
        QS.msSelected.add(i);
        btn.classList.add('ms-selected');
        cb.textContent = '✓';
      }
    });
    container.appendChild(btn);
  });

  const submitBtn = document.createElement('button');
  submitBtn.className = 'q-submit-btn';
  submitBtn.id = 'ms-submit-btn';
  submitBtn.textContent = 'Submit';
  submitBtn.addEventListener('click', _submitMultiSelect);
  container.appendChild(submitBtn);
}

function _submitFreeResponse() {
  if (QS.answered) return;
  const input = document.getElementById('fr-input');
  if (!input) return;
  const typed = input.value.trim();
  if (!typed) { input.focus(); return; }

  const q = QS.questions[QS.current];
  const correct = gradeFreeResponse(typed, q.ans);
  input.disabled = true;
  const btn = document.getElementById('fr-submit-btn');
  if (btn) btn.disabled = true;
  input.classList.add(correct ? 'fr-correct' : 'fr-wrong');
  answerQ(null, { correct });
}

function _submitMultiSelect() {
  if (QS.answered) return;
  const q = QS.questions[QS.current];
  const selected = [...(QS.msSelected || new Set())];
  const correct = gradeMultiSelect(selected, q.ans);

  document.querySelectorAll('.ms-opt-btn').forEach(b => { b.disabled = true; });
  const btn = document.getElementById('ms-submit-btn');
  if (btn) btn.disabled = true;

  document.querySelectorAll('.ms-opt-btn').forEach(b => {
    const idx = parseInt(b.dataset.idx);
    const isCorrectAns = (q.ans || []).includes(idx);
    const wasSelected = selected.includes(idx);
    const cb = b.querySelector('.ms-checkbox');
    if (isCorrectAns) {
      b.classList.add('ms-correct');
      if (cb) cb.textContent = '✓';
    } else if (wasSelected) {
      b.classList.add('ms-wrong-pick');
      if (cb) cb.textContent = '✗';
    }
  });

  answerQ(null, { correct });
}

export function startTCTimer() {
  clearInterval(QS.tcTimer);
  let remaining = QS.tcSecs;
  const timerEl = document.getElementById('q-timer');
  if (timerEl) timerEl.textContent = remaining;
  const timerBox = document.getElementById('q-timer-box');

  QS.tcTimer = setInterval(() => {
    remaining--;
    if (timerEl) timerEl.textContent = remaining;
    if (timerBox) {
      if (remaining < 10) {
        timerBox.classList.add('tc-urgent');
      } else {
        timerBox.classList.remove('tc-urgent');
      }
    }
    if (remaining <= 0) {
      clearInterval(QS.tcTimer);
      QS.tcTimer = null;
      if (timerBox) timerBox.classList.remove('tc-urgent');
      setTimeout(() => showTCResults(), 300);
    }
  }, 1000);
}

// ══════════════════════════════════════════════
//  ANSWER & SCORING
// ══════════════════════════════════════════════

export function answerQ(idx, _override = null) {
  if (QS.answered) return;
  const answerTimeMs = _questionStartTime ? Date.now() - _questionStartTime : null;
  _questionStartTime = null;
  QS.answered = true;
  if (QS.mode !== 'timechallenge') clearInterval(QS.timer);
  const q = QS.questions[QS.current];
  if (!q) return;

  const type = getQType(q);
  // FR and MS pass _override.correct; MC uses index comparison
  const correct = _override !== null ? _override.correct : (idx === q.ans);

  const mem = getMem();
  const prevRec = getRec(mem, q.id);
  const wasWeak = isWeak(prevRec);
  updateRec(mem, q.id, correct, answerTimeMs);
  setMem(mem);
  const newRec = getRec(mem, q.id);

  // MC only: disable option buttons
  if (type === 'mc') {
    const btns = document.querySelectorAll('#q-opts .opt-btn');
    btns.forEach(b => { b.disabled = true; });
  }

  // Category stats
  const cat = q.cat || 'General';
  if (!QS.catStats[cat]) QS.catStats[cat] = { correct: 0, total: 0 };
  QS.catStats[cat].total++;

  const fb = document.getElementById('q-feedback');
  const fbTitle = document.getElementById('q-fb-title');
  const fbExplain = document.getElementById('q-fb-explain');

  if (correct) {
    QS.correct++;
    QS.streak++;
    QS.bestStreak = Math.max(QS.bestStreak, QS.streak);
    QS.catStats[cat].correct++;

    if (type === 'mc') {
      const btns = document.querySelectorAll('#q-opts .opt-btn');
      if (btns[idx]) btns[idx].classList.add('correct');
    }

    let msg = 'Correct!';
    const nowCleared = drillCleared(newRec);
    if (wasWeak && nowCleared) { msg += ' Cleared from weak spots!'; QS.sessionMastered.push(q); }
    else if (isMastered(newRec) && !QS.sessionMastered.includes(q.id)) { msg += ' Mastered!'; QS.sessionMastered.push(q.id); }

    if (fb) fb.className = 'feedback fb-correct show';
    if (fbTitle) fbTitle.textContent = msg;
    if (fbExplain) fbExplain.textContent = q.explain || '';
  } else {
    QS.wrong++;
    QS.streak = 0;
    QS.missed.push(q);

    if (type === 'mc') {
      const btns = document.querySelectorAll('#q-opts .opt-btn');
      if (idx >= 0 && btns[idx]) btns[idx].classList.add('wrong');
      if (btns[q.ans]) btns[q.ans].classList.add('correct');
    }

    if (fb) fb.className = 'feedback fb-wrong show';

    let wrongMsg;
    if (type === 'free-response') {
      wrongMsg = `Not quite. Correct: ${(q.ans || [])[0] || '—'}`;
    } else if (type === 'multi-select') {
      const keys = ['A', 'B', 'C', 'D'];
      wrongMsg = `Not quite. Correct: ${(q.ans || []).map(i => keys[i]).join(', ')}`;
    } else {
      const pre = idx === -1 ? "Time's up! " : 'Not quite. ';
      wrongMsg = `${pre}Answer: ${q.opts[q.ans]}`;
    }
    if (fbTitle) fbTitle.textContent = wrongMsg;
    if (fbExplain) fbExplain.textContent = (q.explain || '') + ' — Added to weak spots.';
  }

  const hudCC = document.getElementById('q-correct-count');
  const hudWC = document.getElementById('q-wrong-count');
  if (hudCC) hudCC.textContent = QS.correct;
  if (hudWC) hudWC.textContent = QS.wrong;

  renderFixButton(q);

  if (QS.mode !== 'timechallenge') {
    const nextBtn = document.getElementById('q-next');
    if (nextBtn) nextBtn.className = 'quiz-next show';
  } else {
    setTimeout(() => { if (QS.tcTimer) quizNext(); }, 400);
  }
}

export function quizNext() {
  if (QS.mode === 'timechallenge' && !QS.tcTimer) return;
  QS.current++;
  if (QS.mode === 'timechallenge') {
    QS.current = QS.current % QS.questions.length;
    renderQ();
    return;
  }
  if (QS.mode === 'drill') {
    const mem = getMem();
    QS.questions = QS.questions.filter(q => isWeak(getRec(mem, q.id)));
    if (!QS.questions.length) { drillFinished(); return; }
    QS.current = QS.current % QS.questions.length;
    renderQ();
    return;
  }
  if (QS.current >= QS.questions.length) {
    showResults();
  } else {
    renderQ();
  }
}

export function drillFinished() {
  const mem = getMem();
  let cleared = 0;
  QS.questions.forEach(q => {
    if (drillCleared(getRec(mem, q.id))) cleared++;
  });

  const screen = document.getElementById('quiz-screen');
  if (screen) screen.classList.remove('open');

  const results = document.getElementById('quiz-results');
  if (results) results.style.display = 'flex';

  const gradeEl = document.getElementById('res-grade');
  if (gradeEl) gradeEl.textContent = '🎯';

  const lblEl = document.getElementById('res-lbl');
  if (lblEl) lblEl.textContent = 'Drill Complete';

  const scoreEl = document.getElementById('res-score');
  if (scoreEl) scoreEl.textContent = `${QS.correct}/${QS.questions.length}`;

  const correctEl = document.getElementById('res-correct');
  if (correctEl) {
    const pct = QS.questions.length ? Math.round((QS.correct / QS.questions.length) * 100) : 0;
    correctEl.textContent = pct + '%';
  }

  // Show cleared count
  const missedPanel = document.getElementById('res-missed-panel');
  const masteredPanel = document.getElementById('res-mastered-panel');
  if (missedPanel) missedPanel.style.display = 'none';
  if (masteredPanel) {
    if (cleared > 0) {
      masteredPanel.style.display = '';
      const masteredList = document.getElementById('res-mastered-list');
      if (masteredList) masteredList.innerHTML = `<div style="color:var(--green);font-size:0.9rem;">${cleared} weak spot${cleared !== 1 ? 's' : ''} cleared!</div>`;
    } else {
      masteredPanel.style.display = 'none';
    }
  }

  // Streak stat
  const streakStat = document.getElementById('res-streak-stat');
  if (streakStat) streakStat.style.display = 'none';

  // Cat breakdown
  const catBd = document.getElementById('res-cat-bd');
  if (catBd) catBd.innerHTML = '';

  // Buttons
  const drillBtn = document.getElementById('res-drill-btn');
  if (drillBtn) drillBtn.style.display = getAllWeakCount() > 0 ? '' : 'none';
  const reviewBtn = document.getElementById('res-review-btn');
  if (reviewBtn) reviewBtn.style.display = 'none';

  _refreshDashboard?.();
  _refreshWeakSpots?.();
}

export function exitQuiz() {
  clearInterval(QS.timer);
  clearInterval(QS.tcTimer);
  const screen = document.getElementById('quiz-screen');
  if (screen) screen.classList.remove('open');
  _refreshDashboard?.();
  _refreshWeakSpots?.();
}

// ══════════════════════════════════════════════
//  RESULTS
// ══════════════════════════════════════════════

export function showResults() {
  const screen = document.getElementById('quiz-screen');
  if (screen) screen.classList.remove('open');

  const results = document.getElementById('quiz-results');
  if (results) results.style.display = 'flex';

  const total = QS.questions.length;
  const pct = total ? Math.round((QS.correct / total) * 100) : 0;

  // Grade
  let grade, label;
  if (pct >= 97) { grade = 'A+'; label = 'Perfect!'; }
  else if (pct >= 93) { grade = 'A'; label = 'Excellent!'; }
  else if (pct >= 90) { grade = 'A-'; label = 'Great job!'; }
  else if (pct >= 87) { grade = 'B+'; label = 'Good work!'; }
  else if (pct >= 83) { grade = 'B'; label = 'Solid effort'; }
  else if (pct >= 80) { grade = 'B-'; label = 'Not bad!'; }
  else if (pct >= 77) { grade = 'C+'; label = 'Getting there'; }
  else if (pct >= 73) { grade = 'C'; label = 'Keep studying'; }
  else if (pct >= 70) { grade = 'C-'; label = 'Needs work'; }
  else if (pct >= 67) { grade = 'D+'; label = 'Below average'; }
  else if (pct >= 60) { grade = 'D'; label = 'Study harder'; }
  else { grade = 'F'; label = 'Try again'; }

  const gradeEl = document.getElementById('res-grade');
  if (gradeEl) gradeEl.textContent = grade;

  const lblEl = document.getElementById('res-lbl');
  if (lblEl) lblEl.textContent = label;

  const scoreEl = document.getElementById('res-score');
  if (scoreEl) scoreEl.textContent = `${QS.correct}/${total}`;

  const correctEl = document.getElementById('res-correct');
  if (correctEl) correctEl.textContent = pct + '%';

  const streakStat = document.getElementById('res-streak-stat');
  if (streakStat) streakStat.style.display = 'none';

  // Missed panel
  const missedPanel = document.getElementById('res-missed-panel');
  const missedList = document.getElementById('res-missed-list');
  if (QS.missed.length > 0) {
    if (missedPanel) missedPanel.style.display = '';
    if (missedList) {
      missedList.innerHTML = '';
      QS.missed.forEach(q => {
        const div = document.createElement('div');
        div.className = 'res-q-item';
        const qtype = getQType(q);
        let ansDisplay = '';
        if (qtype === 'free-response') ansDisplay = (q.ans || [])[0] || '';
        else if (qtype === 'multi-select') {
          const keys = ['A', 'B', 'C', 'D'];
          ansDisplay = (q.ans || []).map(i => `${keys[i]}) ${(q.opts || [])[i] || ''}`).join(', ');
        } else {
          ansDisplay = (q.opts || [])[q.ans] || '';
        }
        div.innerHTML = `<span class="res-q-text">${q.q}</span><span class="res-q-ans" style="color:var(--green);font-size:0.8rem;">Answer: ${ansDisplay}</span>`;
        missedList.appendChild(div);
      });
    }
  } else {
    if (missedPanel) missedPanel.style.display = 'none';
  }

  // Mastered panel
  const masteredPanel = document.getElementById('res-mastered-panel');
  const masteredList = document.getElementById('res-mastered-list');
  if (QS.sessionMastered.length > 0) {
    if (masteredPanel) masteredPanel.style.display = '';
    if (masteredList) {
      masteredList.innerHTML = '';
      QS.sessionMastered.forEach(id => {
        const q = QS.questions.find(qq => qq.id === id);
        if (q) {
          const div = document.createElement('div');
          div.className = 'res-q-item';
          div.innerHTML = `<span class="res-q-text">${q.q}</span>`;
          masteredList.appendChild(div);
        }
      });
    }
  } else {
    if (masteredPanel) masteredPanel.style.display = 'none';
  }

  // Category breakdown
  const catBd = document.getElementById('res-cat-bd');
  if (catBd) {
    catBd.innerHTML = '';
    const cats = Object.entries(QS.catStats);
    if (cats.length > 0) {
      const h = document.createElement('h4');
      h.textContent = 'Category Breakdown';
      h.style.cssText = 'font-size:0.78rem;text-transform:uppercase;letter-spacing:0.15em;color:var(--muted);margin-bottom:0.5rem;';
      catBd.appendChild(h);
      cats.forEach(([cat, st]) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:0.6rem;margin-bottom:0.4rem;font-size:0.82rem;';
        const catPct = st.total ? Math.round((st.correct / st.total) * 100) : 0;
        row.innerHTML = `
          <span style="min-width:100px;color:var(--text);font-weight:500;">${cat}</span>
          <div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;">
            <div style="width:${catPct}%;height:100%;border-radius:3px;background:${catPct >= 80 ? 'var(--green)' : catPct >= 50 ? 'var(--gold)' : 'var(--accent)'};"></div>
          </div>
          <span style="min-width:40px;text-align:right;color:var(--muted);font-size:0.75rem;">${st.correct}/${st.total}</span>`;
        catBd.appendChild(row);
      });
    }
  }

  // Drill button
  const drillBtn = document.getElementById('res-drill-btn');
  if (drillBtn) drillBtn.style.display = getAllWeakCount() > 0 ? '' : 'none';

  // Review button (exam mode)
  const reviewBtn = document.getElementById('res-review-btn');
  if (reviewBtn) reviewBtn.style.display = EX.graded ? '' : 'none';

  // Save high scores for time challenge
  if (QS.mode === 'timechallenge' && QS.deck) {
    const hs = getHS();
    const key = hsKey(QS.deck.id, QS.tcSecs);
    const prev = hs[key];
    if (!prev || QS.correct > prev.correct) {
      hs[key] = { correct: QS.correct, total: total, date: new Date().toISOString() };
      saveHS(hs);
    }
  }

  // Confetti for good scores
  if (pct >= 80) launchConfetti();
}

export function showTCResults() {
  clearInterval(QS.tcTimer);
  clearInterval(QS.timer);

  const screen = document.getElementById('quiz-screen');
  if (screen) screen.classList.remove('open');

  const tcRes = document.getElementById('tc-results');
  if (tcRes) tcRes.style.display = 'flex';

  const total = QS.correct + QS.wrong;
  const pct = total ? Math.round((QS.correct / total) * 100) : 0;

  document.getElementById('tc-res-correct').textContent = QS.correct;
  document.getElementById('tc-res-total').textContent = total;
  document.getElementById('tc-res-pct').textContent = pct + '%';
  document.getElementById('tc-res-wrong').textContent = QS.wrong;
  document.getElementById('tc-res-streak').textContent = QS.bestStreak;

  const deckNameEl = document.getElementById('tc-res-deck-name');
  if (deckNameEl) deckNameEl.textContent = QS.deck ? QS.deck.name : '';
  const timeLabelEl = document.getElementById('tc-res-time-label');
  if (timeLabelEl) timeLabelEl.textContent = QS.tcSecs + ' second challenge';

  // High score
  const hs = getHS();
  const key = QS.deck ? hsKey(QS.deck.id, QS.tcSecs) : null;
  const prev = key ? hs[key] : null;
  const isNewHS = !prev || QS.correct > prev.correct;

  if (key) {
    if (isNewHS) {
      hs[key] = { correct: QS.correct, total: total, date: new Date().toISOString() };
      saveHS(hs);
    }
  }

  const hsEl = document.getElementById('tc-res-hs');
  if (hsEl) hsEl.textContent = key && hs[key] ? hs[key].correct : '—';

  const newBanner = document.getElementById('tc-hs-new-banner');
  if (newBanner) newBanner.style.display = isNewHS ? '' : 'none';

  if (isNewHS) launchConfetti();
}

export function replayQuiz() {
  const results = document.getElementById('quiz-results');
  if (results) results.style.display = 'none';

  if (QS.deck && QS.deck.id !== 'all-weak') {
    const deck = getDeckById(QS.deck.id);
    if (deck) {
      const mem = getMem();
      if (QS.mode === 'drill') {
        const weak = deck.questions.filter(q => isWeak(getRec(mem, q.id)));
        if (!weak.length) {
          _toast('No weak spots left! 🎉');
          closeResults();
          return;
        }
        QS.questions = weak.sort(() => Math.random() - 0.5);
      } else {
        const n = QS.questions.length;
        QS.questions = weightedSample(deck.questions, mem, n);
      }
      QS.questions = interleaveQuestions(QS.questions, mem);
      QS.deck = deck;
      startQS();
      return;
    }
  }
  // Fallback: drill all
  if (QS.mode === 'drill') {
    launchDrillAll();
  } else {
    closeResults();
  }
}

export function replayTC() {
  const tcRes = document.getElementById('tc-results');
  if (tcRes) tcRes.style.display = 'none';

  if (QS.deck) {
    const deck = QS.deck.id === 'all-weak' ? null : getDeckById(QS.deck.id);
    if (deck) {
      const mem = getMem();
      QS.questions = weightedSample(deck.questions, mem, deck.questions.length);
      QS.deck = deck;
      QS.mode = 'timechallenge';
      startQS();
      return;
    }
  }
  closeTCResults();
}

export function closeResults() {
  const results = document.getElementById('quiz-results');
  if (results) results.style.display = 'none';
  _refreshDashboard?.();
  _refreshWeakSpots?.();
  if (_nav) _nav('dashboard');
}

export function closeTCResults() {
  const tcRes = document.getElementById('tc-results');
  if (tcRes) tcRes.style.display = 'none';
  _refreshDashboard?.();
  _refreshQuizSelect?.();
  if (_nav) _nav('dashboard');
}

export function reviewExam() {
  const results = document.getElementById('quiz-results');
  if (results) results.style.display = 'none';

  const examScreen = document.getElementById('exam-screen');
  if (examScreen) examScreen.style.display = 'flex';

  // renderExam() rebuilds the DOM from scratch and restores EX.answers selections
  renderExam();

  // Lock all inputs — read-only review mode
  document.querySelectorAll('#exam-screen input[type="radio"], #exam-screen input[type="text"]')
    .forEach(el => { el.disabled = true; });

  const submitBtn = document.getElementById('exam-submit-btn');
  if (submitBtn) submitBtn.style.display = 'none';

  if (EX.graded) applyExamReview();
}

function applyExamReview() {
  EX.questions.forEach((q, i) => {
    const qDiv = document.getElementById('exam-q-' + i);
    if (!qDiv) return;

    const type = getQType(q);
    const userAnswer = EX.answers[i];
    let isCorrect = false;

    if (type === 'free-response') {
      isCorrect = gradeFreeResponse(typeof userAnswer === 'string' ? userAnswer : '', q.ans);
      const input = qDiv.querySelector('.exam-fr-input');
      if (input) { input.disabled = true; input.classList.add(isCorrect ? 'fr-correct' : 'fr-wrong'); }
      if (!isCorrect) _appendExamExplain(qDiv, `Correct: ${(q.ans || [])[0] || '—'}`, q.explain);
    } else if (type === 'multi-select') {
      const selected = Array.isArray(userAnswer) ? userAnswer : [];
      isCorrect = gradeMultiSelect(selected, q.ans);
      qDiv.querySelectorAll('.exam-ms-opt').forEach(label => {
        const idx = parseInt(label.dataset.idx);
        const cb = label.querySelector('.ms-checkbox');
        if ((q.ans || []).includes(idx)) {
          label.classList.add('ms-correct');
          if (cb) cb.textContent = '✓';
        } else if (selected.includes(idx)) {
          label.classList.add('ms-wrong-pick');
          if (cb) cb.textContent = '✗';
        }
        label.disabled = true;
      });
      if (!isCorrect) {
        const keys = ['A', 'B', 'C', 'D'];
        _appendExamExplain(qDiv, `Correct: ${(q.ans || []).map(i => keys[i]).join(', ')}`, q.explain);
      }
    } else {
      // MC — existing highlight behavior
      isCorrect = userAnswer === q.ans;
      qDiv.querySelectorAll('.exam-opt-label').forEach((lbl, j) => {
        if (j === q.ans)                    lbl.classList.add('is-correct-answer');
        if (!isCorrect && j === userAnswer) lbl.classList.add('is-wrong-pick');
      });
      if (!isCorrect && q.explain) _appendExamExplain(qDiv, null, q.explain);
    }

    qDiv.classList.add(isCorrect ? 'review-correct' : 'review-wrong');
  });
}

function _appendExamExplain(qDiv, wrongMsg, explain) {
  const wrap = document.createElement('div');
  wrap.className = 'exam-review-explain';
  const labelEl = document.createElement('div');
  labelEl.className = 'explain-label';
  labelEl.textContent = 'Why this was wrong';
  const textEl = document.createElement('div');
  textEl.className = 'explain-text';
  textEl.textContent = [wrongMsg, explain].filter(Boolean).join(' — ');
  wrap.appendChild(labelEl);
  wrap.appendChild(textEl);
  qDiv.appendChild(wrap);
}

// ══════════════════════════════════════════════
//  EXAM MODE
// ══════════════════════════════════════════════

export function launchExam(overrideDeckId, overrideCount) {
  const deckId = overrideDeckId || selectedDeckId;
  if (!deckId) return;
  const deck = getDeckById(deckId);
  if (!deck) return;

  const n = overrideCount != null
    ? Math.min(Math.max(5, overrideCount), deck.questions.length)
    : deck.questions.length;

  EX.deck = deck;
  EX.questions = [...deck.questions].sort(() => Math.random() - 0.5).slice(0, n).map(shuffleAnswerPositions);
  EX.answers = {};
  EX.graded = false;

  const examScreen = document.getElementById('exam-screen');
  if (examScreen) examScreen.style.display = 'flex';

  const titleEl = document.getElementById('exam-title');
  if (titleEl) titleEl.textContent = deck.name + ' — Exam';

  const subEl = document.getElementById('exam-sub');
  if (subEl) subEl.textContent = `${EX.questions.length} questions — answer all, then submit`;

  const submitBtn = document.getElementById('exam-submit-btn');
  if (submitBtn) submitBtn.style.display = '';

  renderExam();
}

export function renderExam() {
  const container = document.getElementById('exam-questions');
  if (!container) return;
  container.innerHTML = '';

  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  EX.questions.forEach((q, i) => {
    const type = getQType(q);
    const qDiv = document.createElement('div');
    qDiv.className = 'exam-q';
    qDiv.id = 'exam-q-' + i;

    const numSpan = document.createElement('span');
    numSpan.className = 'exam-q-num';
    numSpan.textContent = (i + 1) + '.';

    const textDiv = document.createElement('div');
    textDiv.className = 'exam-q-text';
    textDiv.textContent = q.q;

    const catSpan = document.createElement('span');
    catSpan.className = 'tag tag-blue';
    catSpan.style.cssText = 'font-size:0.65rem;margin-left:0.5rem;';
    catSpan.textContent = q.cat || '';

    const header = document.createElement('div');
    header.className = 'exam-q-header';
    header.style.cssText = 'display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:0.8rem;';
    header.appendChild(numSpan);
    header.appendChild(textDiv);
    header.appendChild(catSpan);
    qDiv.appendChild(header);

    if (type === 'free-response') {
      const badge = document.createElement('div');
      badge.className = 'q-type-badge fr-badge';
      badge.style.marginBottom = '0.6rem';
      badge.textContent = '📝 Free Response';
      qDiv.appendChild(badge);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'fr-input exam-fr-input';
      input.placeholder = 'Type your answer…';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = typeof EX.answers[i] === 'string' ? EX.answers[i] : '';
      input.addEventListener('input', () => { EX.answers[i] = input.value.trim(); updateUnanswered(); });
      qDiv.appendChild(input);

    } else if (type === 'multi-select') {
      const badge = document.createElement('div');
      badge.className = 'q-type-badge ms-badge';
      badge.style.marginBottom = '0.6rem';
      badge.textContent = '☑️ Select All That Apply';
      qDiv.appendChild(badge);

      if (!Array.isArray(EX.answers[i])) EX.answers[i] = [];

      (q.opts || []).forEach((opt, j) => {
        const label = document.createElement('button');
        label.className = 'ms-opt-btn exam-ms-opt';
        label.dataset.qi = i;
        label.dataset.idx = j;
        const isSelected = EX.answers[i].includes(j);
        if (isSelected) label.classList.add('ms-selected');
        label.innerHTML = `<div class="ms-checkbox" id="exam-ms-cb-${i}-${j}">${isSelected ? '✓' : ''}</div><span class="opt-key">${letters[j]}</span><span>${opt}</span>`;
        label.addEventListener('click', () => {
          if (!Array.isArray(EX.answers[i])) EX.answers[i] = [];
          const cb = document.getElementById(`exam-ms-cb-${i}-${j}`);
          if (EX.answers[i].includes(j)) {
            EX.answers[i] = EX.answers[i].filter(x => x !== j);
            label.classList.remove('ms-selected');
            if (cb) cb.textContent = '';
          } else {
            EX.answers[i] = [...EX.answers[i], j];
            label.classList.add('ms-selected');
            if (cb) cb.textContent = '✓';
          }
          updateUnanswered();
        });
        qDiv.appendChild(label);
      });

    } else {
      // MC — radio buttons (unchanged)
      const optsDiv = document.createElement('div');
      optsDiv.className = 'exam-opts';
      (q.opts || []).forEach((opt, j) => {
        const label = document.createElement('label');
        label.className = 'exam-opt-label';
        label.style.cssText = 'display:flex;align-items:center;gap:0.6rem;cursor:pointer;padding:0.5rem 0.7rem;border-radius:8px;font-size:0.88rem;transition:background 0.15s;';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'exam-q-' + i;
        radio.value = j;
        if (EX.answers[i] === j) radio.checked = true;
        radio.onchange = () => { EX.answers[i] = j; updateUnanswered(); };

        const letterSpan = document.createElement('span');
        letterSpan.className = 'exam-opt-letter';
        letterSpan.style.cssText = 'font-weight:700;min-width:1.2em;';
        letterSpan.textContent = letters[j] || '';

        const textSpan = document.createElement('span');
        textSpan.textContent = opt;

        label.appendChild(radio);
        label.appendChild(letterSpan);
        label.appendChild(textSpan);
        optsDiv.appendChild(label);
      });
      qDiv.appendChild(optsDiv);
    }

    container.appendChild(qDiv);
  });

  updateUnanswered();
}

function updateUnanswered() {
  const warn = document.getElementById('exam-unanswered');
  if (!warn) return;
  const unanswered = EX.questions.filter((q, i) => {
    const type = getQType(q);
    const ans = EX.answers[i];
    if (type === 'multi-select') return !Array.isArray(ans) || ans.length === 0;
    return ans === undefined || ans === '';
  }).length;
  if (unanswered > 0) {
    warn.textContent = `${unanswered} question${unanswered !== 1 ? 's' : ''} unanswered`;
    warn.style.display = '';
  } else {
    warn.style.display = 'none';
  }
}

export function submitExam() {
  const unanswered = EX.questions.filter((q, i) => {
    const type = getQType(q);
    const ans = EX.answers[i];
    if (type === 'multi-select') return !Array.isArray(ans) || ans.length === 0;
    return ans === undefined || ans === '';
  }).length;
  if (unanswered > 0) {
    const proceed = confirm(`You have ${unanswered} unanswered question${unanswered !== 1 ? 's' : ''}. Submit anyway?`);
    if (!proceed) return;
  }

  const mem = getMem();
  QS.correct = 0; QS.wrong = 0; QS.score = 0; QS.streak = 0; QS.bestStreak = 0;
  QS.catStats = {}; QS.sessionMastered = []; QS.missed = [];
  QS.questions = EX.questions;
  QS.deck = EX.deck;
  QS.mode = 'exam';

  EX.questions.forEach((q, i) => {
    const type = getQType(q);
    const answer = EX.answers[i];
    let correct = false;

    if (type === 'free-response') {
      correct = gradeFreeResponse(typeof answer === 'string' ? answer : '', q.ans);
    } else if (type === 'multi-select') {
      correct = gradeMultiSelect(Array.isArray(answer) ? answer : [], q.ans);
    } else {
      correct = answer === q.ans;
    }

    updateRec(mem, q.id, correct);
    const cat = q.cat || 'General';
    if (!QS.catStats[cat]) QS.catStats[cat] = { correct: 0, total: 0 };
    QS.catStats[cat].total++;

    if (correct) {
      QS.correct++; QS.score += 10; QS.streak++;
      if (QS.streak > QS.bestStreak) QS.bestStreak = QS.streak;
      QS.catStats[cat].correct++;
      if (isMastered(getRec(mem, q.id)) && !QS.sessionMastered.includes(q.id)) QS.sessionMastered.push(q.id);
    } else {
      QS.wrong++; QS.streak = 0; QS.missed.push(q);
    }
  });

  setMem(mem);
  EX.graded = true;

  const examScreen = document.getElementById('exam-screen');
  if (examScreen) examScreen.style.display = 'none';
  showResults();
}

export function exitExam() {
  const examScreen = document.getElementById('exam-screen');
  if (examScreen) examScreen.style.display = 'none';
  _refreshDashboard?.();
  _refreshWeakSpots?.();
}

// ══════════════════════════════════════════════
//  UTILITY
// ══════════════════════════════════════════════

export function getAllWeakCount() {
  const decks = getDecks();
  const mem = getMem();
  const seen = new Set();
  let count = 0;
  decks.forEach(d => {
    (d.questions || []).forEach(q => {
      if (!seen.has(q.id)) {
        seen.add(q.id);
        if (isWeak(getRec(mem, q.id))) count++;
      }
    });
  });
  return count;
}

// ══════════════════════════════════════════════
//  FIX ANSWER
// ══════════════════════════════════════════════

export function renderFixButton(q, area) {
  if (!area) area = document.getElementById('q-fix-area');
  if (!area) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem;';

  const ansBtn = document.createElement('button');
  ansBtn.className = 'btn btn-ghost btn-sm';
  ansBtn.style.cssText = 'font-size:0.72rem;padding:0.3rem 0.7rem;';
  ansBtn.textContent = '✏️ Fix Answer';
  ansBtn.onclick = () => showFixPicker(q, area, ansBtn);
  wrap.appendChild(ansBtn);

  const phraseBtn = document.createElement('button');
  phraseBtn.className = 'btn btn-ghost btn-sm';
  phraseBtn.style.cssText = 'font-size:0.72rem;padding:0.3rem 0.7rem;';
  phraseBtn.textContent = '✏️ Fix question phrasing';
  phraseBtn.onclick = () => openPhrasingModal(q, null, null);
  wrap.appendChild(phraseBtn);

  area.appendChild(wrap);
}

export function showFixPicker(q, area, triggerBtn) {
  const existing = area.querySelector('.fix-picker');
  if (existing) { existing.remove(); return; }

  const type = getQType(q);
  const picker = document.createElement('div');
  picker.className = 'fix-picker';
  picker.style.cssText = 'margin-top:0.5rem;padding:0.6rem;background:rgba(255,255,255,0.04);border-radius:8px;display:flex;flex-direction:column;gap:0.3rem;';

  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:0.72rem;color:var(--muted);margin-bottom:0.3rem;';

  if (type === 'free-response') {
    lbl.textContent = 'Accepted answers (comma-separated):';
    picker.appendChild(lbl);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = (q.ans || []).join(', ');
    input.style.cssText = 'width:100%;padding:0.4rem 0.6rem;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:#fff;font-family:Sora,sans-serif;font-size:0.78rem;margin-bottom:0.3rem;box-sizing:border-box;';
    picker.appendChild(input);
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.style.fontSize = '0.78rem';
    saveBtn.textContent = 'Save Answers';
    saveBtn.onclick = () => _fixFRAnswer(q, input.value, area);
    picker.appendChild(saveBtn);

  } else if (type === 'multi-select') {
    lbl.textContent = 'Select all correct answers:';
    picker.appendChild(lbl);
    const letters = ['A', 'B', 'C', 'D'];
    (q.opts || []).forEach((opt, i) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;font-size:0.78rem;padding:0.3rem 0.4rem;cursor:pointer;color:var(--text);';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = (q.ans || []).includes(i);
      cb.dataset.idx = i;
      row.appendChild(cb);
      row.appendChild(document.createTextNode(`${letters[i]}) ${opt}`));
      picker.appendChild(row);
    });
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.style.cssText = 'font-size:0.78rem;margin-top:0.3rem;';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = () => {
      const newAns = [...picker.querySelectorAll('input[type=checkbox]')].filter(c => c.checked).map(c => parseInt(c.dataset.idx));
      if (!newAns.length) { if (_toast) _toast('Select at least one correct answer'); return; }
      _fixMSAnswer(q, newAns, area);
    };
    picker.appendChild(saveBtn);

  } else {
    // MC — existing behavior
    lbl.textContent = 'Select the correct answer:';
    picker.appendChild(lbl);
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    (q.opts || []).forEach((opt, i) => {
      const optBtn = document.createElement('button');
      optBtn.className = 'btn btn-ghost btn-sm';
      optBtn.style.cssText = `font-size:0.78rem;text-align:left;padding:0.35rem 0.6rem;${i === q.ans ? 'color:var(--green);font-weight:600;' : ''}`;
      optBtn.textContent = `${letters[i]}) ${opt}${i === q.ans ? ' ✓ (current)' : ''}`;
      optBtn.onclick = () => fixAnswer(q, i, area);
      picker.appendChild(optBtn);
    });
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost btn-sm';
  cancelBtn.style.cssText = 'font-size:0.7rem;color:var(--muted);margin-top:0.2rem;';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => picker.remove();
  picker.appendChild(cancelBtn);

  area.appendChild(picker);
}

export function fixAnswer(q, newAns, area) {
  if (newAns === q.ans) {
    if (_toast) _toast('That is already the correct answer');
    const picker = area ? area.querySelector('.fix-picker') : null;
    if (picker) picker.remove();
    return;
  }

  // Use text lookup so storage stays correct even if live opts are reshuffled
  const correctText = (q.opts || [])[newAns];

  const decks = getDecks();
  let updated = false;
  decks.forEach(d => {
    (d.questions || []).forEach(dq => {
      if (dq.id === q.id) {
        const storageIdx = correctText != null ? (dq.opts || []).indexOf(correctText) : newAns;
        dq.ans = storageIdx >= 0 ? storageIdx : newAns;
        updated = true;
      }
    });
  });

  if (updated) {
    saveDecks(decks);
    q.ans = newAns;
    const mem = getMem();
    mem[q.id] = { correct: 0, total: 0, everWrong: false, lastResult: null, interval: 1, ease: 2.5, due: 0, reps: 0 };
    updateRec(mem, q.id, true);
    setMem(mem);
    if (_toast) _toast('Answer updated!');
  }

  if (area) {
    const picker = area.querySelector('.fix-picker');
    if (picker) picker.remove();
    area.innerHTML = '';
    renderFixButton(q, area);
  }

  const opts = document.querySelectorAll('#q-opts .opt-btn');
  opts.forEach((btn, i) => {
    btn.classList.remove('correct', 'wrong');
    if (i === newAns) btn.classList.add('correct');
  });
}

function _fixFRAnswer(q, newAnswerStr, area) {
  const variants = newAnswerStr.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
  if (!variants.length) { if (_toast) _toast('Enter at least one accepted answer'); return; }
  const decks = getDecks();
  decks.forEach(d => { (d.questions || []).forEach(dq => { if (dq.id === q.id) dq.ans = variants; }); });
  saveDecks(decks);
  q.ans = variants;
  const mem = getMem(); delete mem[q.id]; setMem(mem);
  if (_toast) _toast('✓ Accepted answers updated');
  if (area) { area.innerHTML = ''; renderFixButton(q, area); }
}

function _fixMSAnswer(q, newAns, area) {
  // newAns indices are in live (shuffled) space — map back to storage by text
  const decks = getDecks();
  decks.forEach(d => {
    (d.questions || []).forEach(dq => {
      if (dq.id === q.id) {
        const mapped = newAns.map(i => {
          const text = (q.opts || [])[i];
          const si = (dq.opts || []).indexOf(text);
          return si >= 0 ? si : i;
        });
        dq.ans = mapped;
      }
    });
  });
  saveDecks(decks);
  q.ans = newAns;
  const mem = getMem(); delete mem[q.id]; setMem(mem);
  if (_toast) _toast('✓ Correct answers updated');
  if (area) { area.innerHTML = ''; renderFixButton(q, area); }
}

// ══════════════════════════════════════════════
//  FIX QUESTION PHRASING
// ══════════════════════════════════════════════

export function openPhrasingModal(question, deckId, onSave) {
  const existing = document.getElementById('fix-phrasing-modal');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'fix-phrasing-modal';
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  document.body.appendChild(ov);

  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const ansLabel = (() => {
    const qt = getQType(question);
    if (qt === 'free-response') return (question.ans || []).join(', ') || '\u2014';
    if (qt === 'multi-select') {
      if (!question.opts || !question.ans) return '\u2014';
      return question.ans.map(i => `${letters[i] || '?'}) ${question.opts[i] || ''}`).join(', ');
    }
    return (question.opts && question.ans != null)
      ? `${letters[question.ans] || '?'} \u2014 ${question.opts[question.ans] || ''}`
      : '\u2014';
  })();

  ov.innerHTML = `
    <div class="modal-box" style="max-width:520px;">
      <h2>\u270f\ufe0f Edit Question</h2>
      <label class="lbl-s">Question Text</label>
      <textarea id="fphr-text" style="width:100%;box-sizing:border-box;min-height:80px;resize:vertical;font-family:inherit;font-size:0.88rem;padding:0.6rem 0.8rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);line-height:1.5;margin-bottom:0.5rem;"></textarea>
      <div style="font-size:0.72rem;color:var(--muted);margin-bottom:0.8rem;">
        Category: <strong>${question.cat || '\u2014'}</strong>&nbsp;&nbsp;\u00b7&nbsp;&nbsp;Answer: ${ansLabel}
      </div>
      <div id="fphr-err" style="font-size:0.78rem;color:var(--accent);min-height:1.1rem;margin-bottom:0.6rem;"></div>
      <div style="display:flex;gap:0.8rem;">
        <button class="btn btn-primary" id="fphr-save">Save Changes</button>
        <button class="btn btn-ghost" id="fphr-cancel">Cancel</button>
      </div>
    </div>`;

  const ta = document.getElementById('fphr-text');
  ta.value = question.q;

  // Auto-resize textarea to fit content
  const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', resize);
  setTimeout(resize, 0);

  document.getElementById('fphr-cancel').onclick = () => ov.remove();

  document.getElementById('fphr-save').onclick = () => {
    const newText = ta.value.trim();
    const errEl   = document.getElementById('fphr-err');
    if (!newText)              { errEl.textContent = 'Question text cannot be empty'; return; }
    if (newText === question.q){ errEl.textContent = 'No changes made'; return; }

    const oldText = question.q;
    const decks   = getDecks();
    let updated   = false;
    decks.forEach(d => {
      (d.questions || []).forEach(dq => {
        if (dq.id === question.id) { dq.q = newText; updated = true; }
      });
    });

    if (updated) {
      saveDecks(decks);
      question.q = newText;

      // Clear memory — fresh start since question text changed
      const mem = getMem();
      delete mem[question.id];
      setMem(mem);

      // Update live QS session if active
      if (QS.questions) {
        const liveQ = QS.questions.find(qq => qq.id === question.id);
        if (liveQ) liveQ.q = newText;
      }

      // Update on-screen question text if this question is currently displayed
      const qTextEl = document.getElementById('q-text');
      if (qTextEl && qTextEl.textContent.trim() === oldText.trim()) {
        qTextEl.textContent = newText;
      }

      if (_toast) _toast('\u2713 Question updated');
      onSave?.();
    }

    ov.remove();
  };

  // Escape closes the modal
  const onEsc = e => { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);

  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 80);
}

// ══════════════════════════════════════════════
//  CONFETTI
// ══════════════════════════════════════════════

export function launchConfetti() {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden;';
  document.body.appendChild(container);

  const colors = ['#ff3f6c', '#ffc94a', '#00e5a0', '#38b2ff', '#b57bee', '#ff8c42', '#ef476f', '#06d6a0'];

  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const delay = Math.random() * 0.5;
    const duration = 1.5 + Math.random() * 2;
    const size = 6 + Math.random() * 6;
    const rotation = Math.random() * 360;

    piece.style.cssText = `
      position:absolute;
      top:-10px;
      left:${left}%;
      width:${size}px;
      height:${size * 0.6}px;
      background:${color};
      border-radius:2px;
      opacity:0.9;
      transform:rotate(${rotation}deg);
      animation:confettiFall ${duration}s ease-in ${delay}s forwards;
    `;
    container.appendChild(piece);
  }

  // Add keyframes if not already present
  if (!document.getElementById('confetti-style')) {
    const style = document.createElement('style');
    style.id = 'confetti-style';
    style.textContent = `
      @keyframes confettiFall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  // Clean up after animation
  setTimeout(() => container.remove(), 4000);
}
