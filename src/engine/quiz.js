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

  // Render options
  const optsEl = document.getElementById('q-opts');
  if (!optsEl) return;
  optsEl.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  (q.opts || []).forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'opt-btn';
    btn.innerHTML = `<span class="opt-key">${letters[i] || ''}</span>${opt}`;
    btn.addEventListener('click', () => answerQ(i));
    optsEl.appendChild(btn);
  });

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

export function answerQ(idx) {
  if (QS.answered) return;
  const answerTimeMs = _questionStartTime ? Date.now() - _questionStartTime : null;
  _questionStartTime = null;
  QS.answered = true;
  if (QS.mode !== 'timechallenge') clearInterval(QS.timer);
  const q = QS.questions[QS.current];
  if (!q) return;

  const correct = idx === q.ans;
  const mem = getMem();
  const prevRec = getRec(mem, q.id);
  const wasWeak = isWeak(prevRec);
  updateRec(mem, q.id, correct, answerTimeMs);
  setMem(mem);
  const newRec = getRec(mem, q.id);

  // Disable option buttons & highlight
  const btns = document.querySelectorAll('#q-opts .opt-btn');
  btns.forEach(b => { b.disabled = true; });

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
    if (btns[idx]) btns[idx].classList.add('correct');
    QS.catStats[cat].correct++;

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
    if (idx >= 0 && btns[idx]) btns[idx].classList.add('wrong');
    if (btns[q.ans]) btns[q.ans].classList.add('correct');

    if (fb) fb.className = 'feedback fb-wrong show';
    const pre = idx === -1 ? "Time's up! " : "Not quite. ";
    if (fbTitle) fbTitle.textContent = `${pre}Answer: ${q.opts[q.ans]}`;
    if (fbExplain) fbExplain.textContent = (q.explain || '') + ' — Added to weak spots.';
  }

  // Update HUD
  const hudCC = document.getElementById('q-correct-count');
  const hudWC = document.getElementById('q-wrong-count');
  if (hudCC) hudCC.textContent = QS.correct;
  if (hudWC) hudWC.textContent = QS.wrong;

  // Fix answer button
  renderFixButton(q);

  // Show next button (except TC auto-advances)
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
        div.innerHTML = `<span class="res-q-text">${q.q}</span><span class="res-q-ans" style="color:var(--green);font-size:0.8rem;">Answer: ${q.opts[q.ans]}</span>`;
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

  // Re-render exam with graded state visible
  renderExam();

  // Highlight correct/wrong after grading
  if (EX.graded) {
    EX.questions.forEach((q, i) => {
      const qDiv = document.getElementById('exam-q-' + i);
      if (!qDiv) return;
      const selected = EX.answers[i];
      const isCorrect = selected === q.ans;
      qDiv.classList.add(isCorrect ? 'exam-q-correct' : 'exam-q-wrong');

      // Highlight options
      const radios = qDiv.querySelectorAll('input[type="radio"]');
      radios.forEach(r => { r.disabled = true; });
      const labels = qDiv.querySelectorAll('.exam-opt-label');
      labels.forEach((lbl, j) => {
        if (j === q.ans) lbl.classList.add('exam-opt-correct');
        if (j === selected && !isCorrect) lbl.classList.add('exam-opt-wrong');
      });

      // Show explanation
      if (q.explain) {
        const explainDiv = document.createElement('div');
        explainDiv.className = 'exam-explain';
        explainDiv.style.cssText = 'font-size:0.82rem;color:var(--muted);margin-top:0.5rem;padding:0.5rem;background:rgba(255,255,255,0.03);border-radius:6px;';
        explainDiv.textContent = q.explain;
        qDiv.appendChild(explainDiv);
      }
    });

    // Hide submit button, show exit
    const submitBtn = document.getElementById('exam-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
  }
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
  EX.questions = [...deck.questions].sort(() => Math.random() - 0.5).slice(0, n);
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

    if (q.type === 'text') {
      // Text answer input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'exam-text-input';
      input.placeholder = 'Type your answer...';
      input.dataset.qi = i;
      input.value = EX.answers[i] !== undefined ? EX.answers[i] : '';
      input.oninput = () => { EX.answers[i] = input.value.trim(); updateUnanswered(); };
      qDiv.appendChild(input);
    } else {
      // Multiple choice radio buttons
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
  const unanswered = EX.questions.filter((_, i) => EX.answers[i] === undefined || EX.answers[i] === '').length;
  if (unanswered > 0) {
    warn.textContent = `${unanswered} question${unanswered !== 1 ? 's' : ''} unanswered`;
    warn.style.display = '';
  } else {
    warn.style.display = 'none';
  }
}

export function submitExam() {
  // Check for unanswered
  const unanswered = EX.questions.filter((_, i) => EX.answers[i] === undefined || EX.answers[i] === '').length;
  if (unanswered > 0) {
    const proceed = confirm(`You have ${unanswered} unanswered question${unanswered !== 1 ? 's' : ''}. Submit anyway?`);
    if (!proceed) return;
  }

  // Grade all questions
  const mem = getMem();
  QS.correct = 0;
  QS.wrong = 0;
  QS.score = 0;
  QS.streak = 0;
  QS.bestStreak = 0;
  QS.catStats = {};
  QS.sessionMastered = [];
  QS.missed = [];
  QS.questions = EX.questions;
  QS.deck = EX.deck;
  QS.mode = 'exam';

  EX.questions.forEach((q, i) => {
    const answer = EX.answers[i];
    let correct;

    if (q.type === 'text') {
      correct = typeof answer === 'string' && answer.toLowerCase().trim() === (q.opts[q.ans] || '').toLowerCase().trim();
    } else {
      correct = answer === q.ans;
    }

    updateRec(mem, q.id, correct);

    const cat = q.cat || 'General';
    if (!QS.catStats[cat]) QS.catStats[cat] = { correct: 0, total: 0 };
    QS.catStats[cat].total++;

    if (correct) {
      QS.correct++;
      QS.score += 10;
      QS.streak++;
      if (QS.streak > QS.bestStreak) QS.bestStreak = QS.streak;
      QS.catStats[cat].correct++;
      const rec = getRec(mem, q.id);
      if (isMastered(rec) && !QS.sessionMastered.includes(q.id)) {
        QS.sessionMastered.push(q.id);
      }
    } else {
      QS.wrong++;
      QS.streak = 0;
      QS.missed.push(q);
    }
  });

  setMem(mem);
  EX.graded = true;

  // Close exam screen, show results
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
  // Remove any existing picker
  const existing = area.querySelector('.fix-picker');
  if (existing) { existing.remove(); return; }

  const picker = document.createElement('div');
  picker.className = 'fix-picker';
  picker.style.cssText = 'margin-top:0.5rem;padding:0.6rem;background:rgba(255,255,255,0.04);border-radius:8px;display:flex;flex-direction:column;gap:0.3rem;';

  const label = document.createElement('div');
  label.style.cssText = 'font-size:0.72rem;color:var(--muted);margin-bottom:0.3rem;';
  label.textContent = 'Select the correct answer:';
  picker.appendChild(label);

  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  (q.opts || []).forEach((opt, i) => {
    const optBtn = document.createElement('button');
    optBtn.className = 'btn btn-ghost btn-sm';
    optBtn.style.cssText = `font-size:0.78rem;text-align:left;padding:0.35rem 0.6rem;${i === q.ans ? 'color:var(--green);font-weight:600;' : ''}`;
    optBtn.textContent = `${letters[i]}) ${opt}${i === q.ans ? ' ✓ (current)' : ''}`;
    optBtn.onclick = () => fixAnswer(q, i, area);
    picker.appendChild(optBtn);
  });

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

  // Find and update the question in the deck
  const decks = getDecks();
  let updated = false;
  decks.forEach(d => {
    (d.questions || []).forEach(dq => {
      if (dq.id === q.id) {
        dq.ans = newAns;
        updated = true;
      }
    });
  });

  if (updated) {
    saveDecks(decks);
    q.ans = newAns;

    // Update memory - reset the record since answer changed
    const mem = getMem();
    mem[q.id] = { correct: 0, total: 0, everWrong: false, lastResult: null, interval: 1, ease: 2.5, due: 0, reps: 0 };
    updateRec(mem, q.id, true);
    setMem(mem);

    if (_toast) _toast('Answer updated!');
  }

  // Update UI
  if (area) {
    const picker = area.querySelector('.fix-picker');
    if (picker) picker.remove();
    area.innerHTML = '';
    renderFixButton(q, area);
  }

  // Re-highlight options in quiz screen
  const opts = document.querySelectorAll('#q-opts .opt-btn');
  opts.forEach((btn, i) => {
    btn.classList.remove('correct', 'wrong');
    if (i === newAns) btn.classList.add('correct');
  });
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
  const ansLabel = (question.opts && question.ans != null)
    ? `${letters[question.ans] || '?'} \u2014 ${question.opts[question.ans] || ''}`
    : '\u2014';

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
