// Dashboard.js — dashboard page rendering: stats, recent deck, knowledge breakdown

import { getMem, getRec, isWeak, isMastered, isDue, getDueCards, getOverdueByClass, weightedSample, getDueCount } from '../engine/memory.js';
import { isLoggedIn } from '../engine/auth.js';
import { getDecks, getDeckById, getDeckColor } from '../engine/decks.js';
import { getClasses } from '../engine/classes.js';
import { load } from '../engine/storage.js';
import { KEYS } from '../config.js';
import { QS, quickStartDeck, drillDeck, startQS, launchExam, launchReviewAll, launchReviewClass } from '../engine/quiz.js';
import { makeModal } from '../components/Modals.js';

let _nav;
export function initDashboardCallbacks({ nav }) {
  _nav = nav;
}

const MODE_LABELS = {
  standard: 'Standard',
  speed: 'Speed Bonus',
  streak: 'Streak Mode',
  drill: 'Drill',
  timechallenge: 'Time Challenge',
  exam: 'Exam Mode'
};

/* ── _restoreDashboardShell ───────────────────────────────── */
// Rebuilds the static returning-user HTML if onboarding previously wiped it.
function _restoreDashboardShell(el) {
  el.innerHTML = `
    <div class="page-header">
      <h1>DASHBOARD</h1>
      <p>Your adaptive study command center</p>
    </div>
    <div id="sb-auth-banner" style="display:none;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;padding:0.65rem 1.1rem;background:rgba(56,178,255,0.07);border:1px solid rgba(56,178,255,0.18);border-radius:var(--radius);margin-bottom:1.4rem;">
      <span style="font-size:0.82rem;color:var(--muted);">☁️ Sign in to sync your decks across devices</span>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" id="sb-banner-signin">Sign In</button>
        <button class="btn btn-primary btn-sm" id="sb-banner-signup">Create Account</button>
        <button class="btn btn-ghost btn-sm" id="sb-banner-dismiss" style="padding:0.2rem 0.5rem;opacity:0.5;" title="Dismiss">✕</button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card clickable" style="--c:var(--accent)" onclick="openKnowledgeBreakdown()" title="Click to see your knowledge breakdown"><div class="stat-num" id="dash-total-q">0</div><div class="stat-lbl">Total Questions ↗</div></div>
      <div class="stat-card" style="--c:var(--green)"><div class="stat-num" id="dash-mastered">0</div><div class="stat-lbl">Mastered</div></div>
      <div class="stat-card" style="--c:var(--gold)"><div class="stat-num" id="dash-weak">0</div><div class="stat-lbl">Weak Spots</div></div>
      <div class="stat-card" style="--c:var(--blue)"><div class="stat-num" id="dash-decks">0</div><div class="stat-lbl">Test Decks</div></div>
    </div>
    <div id="dash-due-banner" style="display:none;margin-bottom:1.5rem;padding:1rem 1.3rem;background:rgba(255,201,74,0.08);border:1px solid var(--gold);border-radius:var(--radius);cursor:pointer;" onclick="nav('quiz-select')">
      <span style="font-size:1.1rem;margin-right:0.5rem;">📅</span>
      <span style="font-weight:600;color:var(--gold);" id="dash-due-count">0</span>
      <span style="color:var(--muted);font-size:0.88rem;"> questions due for review today</span>
    </div>
    <div id="dash-recent"></div>
    <div id="dash-review-callout"></div>
    <div class="dash-tiles">
      <div class="dash-tile" style="--tc:var(--accent)" onclick="nav('classes')"><div class="tile-icon">🎓</div><div class="tile-label">Classes</div></div>
      <div class="dash-tile" style="--tc:var(--green)" onclick="nav('quiz-select')"><div class="tile-icon">🎮</div><div class="tile-label">Quick Quiz</div></div>
      <div class="dash-tile" style="--tc:var(--blue)" onclick="nav('generator')"><div class="tile-icon">🛠️</div><div class="tile-label">Quiz Builder</div></div>
      <div class="dash-tile" style="--tc:var(--purple)" onclick="nav('saved-tests')"><div class="tile-icon">📁</div><div class="tile-label">Saved Tests</div></div>
      <div class="dash-tile" style="--tc:var(--gold)" onclick="nav('weak-spots')"><div class="tile-icon">🎯</div><div class="tile-label">Weak Spots</div></div>
    </div>`;
}

/* ── refreshDashboard ────────────────────────────────────── */
export function refreshDashboard() {
  const decks = getDecks();
  const userDecks = decks.filter(d => !d.builtIn);
  const isNewUser = userDecks.length === 0;

  if (isNewUser && !isLoggedIn()) {
    renderOnboardingDashboard(document.getElementById('page-dashboard'));
    return;
  }

  // Restore static shell if onboarding previously replaced it
  if (!document.getElementById('dash-total-q')) {
    _restoreDashboardShell(document.getElementById('page-dashboard'));
  }

  const mem = getMem();

  // Unique question set across all decks
  const allIds = new Set();
  decks.forEach(d => d.questions.forEach(q => allIds.add(q.id)));

  let masteredCount = 0;
  let weakCount = 0;
  allIds.forEach(id => {
    const rec = getRec(mem, id);
    if (isMastered(rec)) masteredCount++;
    if (isWeak(rec)) weakCount++;
  });

  // Stat cards
  const elTotal = document.getElementById('dash-total-q');
  const elMastered = document.getElementById('dash-mastered');
  const elWeak = document.getElementById('dash-weak');
  const elDecks = document.getElementById('dash-decks');
  if (elTotal) elTotal.textContent = allIds.size;
  if (elMastered) elMastered.textContent = masteredCount;
  if (elWeak) elWeak.textContent = weakCount;
  if (elDecks) elDecks.textContent = decks.length;

  // Recent deck card
  const recentBox = document.getElementById('dash-recent');
  if (recentBox) {
    const recent = load(KEYS.recentDeck);
    if (recent && recent.deckId) {
      const deck = getDeckById(recent.deckId);
      if (deck) {
        const modeLabel = MODE_LABELS[recent.mode] || recent.mode || 'Standard';
        const color = getDeckColor(deck);
        recentBox.innerHTML = `
          <div class="card" style="border-left:3px solid ${color};margin-bottom:1.5rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.8rem;">
              <div>
                <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);margin-bottom:0.3rem;">Resume Recent</div>
                <div style="font-weight:700;font-size:1.05rem;">${deck.name}</div>
                <div style="font-size:0.78rem;color:var(--muted);margin-top:0.2rem;">${modeLabel} · ${deck.questions.length} questions</div>
              </div>
              <button class="btn btn-primary btn-sm" id="dash-resume-btn">&#9654; Resume</button>
            </div>
          </div>`;
        const resumeBtn = document.getElementById('dash-resume-btn');
        if (resumeBtn) resumeBtn.onclick = () => relaunchRecent();
      } else {
        recentBox.innerHTML = '';
      }
    } else {
      recentBox.innerHTML = '';
    }
  }

  // SM-2 review callout (between dash-recent and dash-tiles)
  const dueCards = getDueCards(decks);
  const byClass  = getOverdueByClass(decks, getClasses());
  _renderReviewCallout(dueCards, byClass);

  // Legacy due-for-review banner — only show when the callout is empty
  const dueBanner = document.getElementById('dash-due-banner');
  const dueCountEl = document.getElementById('dash-due-count');
  if (dueBanner) {
    if (dueCards.length > 0) {
      dueBanner.style.display = 'none';
    } else {
      const due = getDueCount();
      if (due > 0) {
        if (dueCountEl) dueCountEl.textContent = due;
        dueBanner.style.display = '';
      } else {
        dueBanner.style.display = 'none';
      }
    }
  }
}

/* ── getConfidentlyWrong ──────────────────────────────────── */
// A question is "confidently wrong" if at least one wrong answer was
// answered faster than p33 of that question's correct-answer history.
// Default p33 = 2000ms when correct history has fewer than 3 entries.
function getConfidentlyWrong(decks, mem) {
  const results = [];
  decks.forEach(deck => {
    deck.questions.forEach(q => {
      const r = getRec(mem, q.id);
      if (!r.everWrong || !r.responseTimes?.length) return;

      const correctTimes = r.responseTimes
        .filter(rt => rt.correct && rt.ms > 0)
        .map(rt => rt.ms)
        .sort((a, b) => a - b);

      const p33 = correctTimes.length >= 3
        ? correctTimes[Math.floor(correctTimes.length * 0.33)]
        : 2000;

      const hasFastWrong = r.responseTimes.some(rt => !rt.correct && rt.ms <= p33);
      if (!hasFastWrong) return;

      const wrongTimes = r.responseTimes.filter(rt => !rt.correct).map(rt => rt.ms);
      results.push({
        q,
        deckName: deck.name,
        deckColor: getDeckColor(deck),
        wrongCount: r.total - r.correct,
        fastestWrong: Math.min(...wrongTimes),
      });
    });
  });
  return results.sort((a, b) => b.wrongCount - a.wrongCount);
}

/* ── Knowledge Breakdown modal ───────────────────────────── */
export function openKnowledgeBreakdown() {
  const modal = document.getElementById('kb-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  const decks = getDecks();
  const mem = getMem();

  // Global buckets
  const allIds = new Set();
  decks.forEach(d => d.questions.forEach(q => allIds.add(q.id)));

  let untouched = 0, shaky = 0, weak = 0, mastered = 0;
  allIds.forEach(id => {
    const rec = getRec(mem, id);
    if (rec.total === 0) { untouched++; }
    else if (isMastered(rec)) { mastered++; }
    else if (isWeak(rec)) { weak++; }
    else { shaky++; }
  });

  const total = allIds.size || 1;

  // Summary text
  const kbSub = document.getElementById('kb-sub');
  if (kbSub) kbSub.textContent = `${allIds.size} total questions across ${decks.length} decks`;

  // Bucket cards
  const kbBuckets = document.getElementById('kb-buckets');
  if (kbBuckets) {
    kbBuckets.innerHTML = `
      <div class="kb-bucket" style="--bc:#444466"><div class="kb-bucket-num">${untouched}</div><div class="kb-bucket-lbl">Untouched</div></div>
      <div class="kb-bucket" style="--bc:var(--blue)"><div class="kb-bucket-num">${shaky}</div><div class="kb-bucket-lbl">Seen / Shaky</div></div>
      <div class="kb-bucket" style="--bc:var(--accent)"><div class="kb-bucket-num">${weak}</div><div class="kb-bucket-lbl">Weak Spots</div></div>
      <div class="kb-bucket" style="--bc:var(--green)"><div class="kb-bucket-num">${mastered}</div><div class="kb-bucket-lbl">Mastered</div></div>
    `;
  }

  // Bar chart
  const kbBar = document.getElementById('kb-bar');
  if (kbBar) {
    const pUn = (untouched / total * 100).toFixed(1);
    const pSh = (shaky / total * 100).toFixed(1);
    const pWk = (weak / total * 100).toFixed(1);
    const pMs = (mastered / total * 100).toFixed(1);
    kbBar.innerHTML = `
      <div class="kb-bar-seg" style="width:${pUn}%;background:#444466" title="Untouched ${pUn}%"></div>
      <div class="kb-bar-seg" style="width:${pSh}%;background:var(--blue)" title="Shaky ${pSh}%"></div>
      <div class="kb-bar-seg" style="width:${pWk}%;background:var(--accent)" title="Weak ${pWk}%"></div>
      <div class="kb-bar-seg" style="width:${pMs}%;background:var(--green)" title="Mastered ${pMs}%"></div>
    `;
  }

  // Confidently wrong section
  const cwEl = document.getElementById('kb-cw');
  if (cwEl) {
    const cw = getConfidentlyWrong(decks, mem);
    if (cw.length === 0) {
      cwEl.innerHTML = '';
    } else {
      const shown = cw.slice(0, 5);
      const extra = cw.length - 5;
      const listHtml = shown.map(({ q, deckName, deckColor }) => `
        <div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="width:8px;height:8px;border-radius:50%;background:${deckColor};flex-shrink:0;margin-top:0.35rem;"></div>
          <div>
            <div style="font-size:0.65rem;color:var(--muted);">${deckName}</div>
            <div style="font-size:0.82rem;color:var(--text);">${q.q.length > 80 ? q.q.substring(0, 80) + '…' : q.q}</div>
          </div>
        </div>`).join('');
      const moreHtml = extra > 0
        ? `<div style="font-size:0.72rem;color:var(--muted);padding-top:0.5rem;">+ ${extra} more</div>`
        : '';
      cwEl.innerHTML = `
        <div style="background:rgba(255,63,108,0.08);border:1px solid rgba(255,63,108,0.3);border-left:3px solid var(--accent);border-radius:var(--radius);padding:1rem 1.2rem;margin-bottom:1.5rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.6rem;">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:0.05em;color:var(--accent);">🚨 Confidently Wrong: ${cw.length}</div>
            <div style="font-size:0.7rem;color:var(--muted);">Fast answer · Wrong result</div>
          </div>
          <div style="font-size:0.78rem;color:#f0ede8;margin-bottom:0.8rem;line-height:1.5;">These questions you answered quickly AND incorrectly. Your brain has a confident but wrong memory trace — the most dangerous kind before an exam.</div>
          ${listHtml}${moreHtml}
        </div>`;
    }
  }

  // Per-deck table
  const kbTable = document.getElementById('kb-deck-table');
  if (kbTable) {
    let rows = `<tr><th>Deck</th><th>Total</th><th>Untouched</th><th>Shaky</th><th>Weak</th><th>Mastered</th></tr>`;
    decks.forEach(deck => {
      let dUn = 0, dSh = 0, dWk = 0, dMs = 0;
      deck.questions.forEach(q => {
        const rec = getRec(mem, q.id);
        if (rec.total === 0) dUn++;
        else if (isMastered(rec)) dMs++;
        else if (isWeak(rec)) dWk++;
        else dSh++;
      });
      const color = getDeckColor(deck);
      rows += `<tr>
        <td><span style="color:${color};margin-right:0.4rem;">●</span>${deck.name}</td>
        <td>${deck.questions.length}</td>
        <td>${dUn}</td>
        <td>${dSh}</td>
        <td>${dWk}</td>
        <td>${dMs}</td>
      </tr>`;
    });
    kbTable.innerHTML = rows;
  }
}

/* ── closeKB ──────────────────────────────────────────────── */
export function closeKB() {
  const modal = document.getElementById('kb-modal');
  if (modal) modal.style.display = 'none';
}

/* ── _renderReviewCallout ─────────────────────────────────── */
function _renderReviewCallout(dueCards, byClass) {
  const el = document.getElementById('dash-review-callout');
  if (!el) return;

  if (dueCards.length === 0) { el.innerHTML = ''; return; }

  const count = dueCards.length;

  const classPillsHtml = byClass.size > 0
    ? `<div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.5rem;">${
        [...byClass.values()].map(({ cls, count: n }) =>
          `<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.18rem 0.55rem;border-radius:99px;background:rgba(255,255,255,0.06);font-size:0.71rem;color:var(--muted);">` +
          `<span style="width:6px;height:6px;border-radius:50%;background:${cls.color};flex-shrink:0;"></span>${cls.name} · ${n}</span>`
        ).join('')
      }</div>`
    : '';

  el.innerHTML = `
    <div class="card" style="border-left:3px solid var(--gold);margin-bottom:1.5rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.8rem;">
        <div>
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);margin-bottom:0.3rem;">📅 Due for Review</div>
          <div style="font-weight:700;font-size:1.05rem;">${count} card${count !== 1 ? 's' : ''} ready</div>
          ${classPillsHtml}
        </div>
        <button class="btn btn-primary btn-sm" id="dash-review-btn">&#9654; Review Now</button>
      </div>
    </div>`;

  const btn = document.getElementById('dash-review-btn');
  if (btn) btn.onclick = () => openReviewModal();
}

/* ── openReviewModal ──────────────────────────────────────── */
export function openReviewModal() {
  const decks = getDecks();
  const classes = getClasses();
  const dueCards = getDueCards(decks);
  const byClass  = getOverdueByClass(decks, classes);

  if (!dueCards.length) return;

  const count = dueCards.length;

  const classRowsHtml = byClass.size > 0
    ? `<div style="margin-top:1rem;">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:0.5rem;">Or review by class</div>
        ${[...byClass.values()].map(({ cls, count: n }) =>
          `<button class="class-sub-item" data-cls="${cls.id}"
            style="padding:0.6rem 1rem;border-radius:10px;border:1px solid var(--border);background:var(--surface);margin-bottom:0.4rem;width:100%;text-align:left;font-family:'Sora',sans-serif;font-size:0.84rem;cursor:pointer;color:var(--text);display:flex;align-items:center;gap:0.6rem;">
            <span style="width:8px;height:8px;border-radius:50%;background:${cls.color};flex-shrink:0;"></span>
            <span style="flex:1;">${cls.name}</span>
            <span style="color:var(--muted);font-size:0.73rem;">${n} card${n !== 1 ? 's' : ''}</span>
          </button>`
        ).join('')}
      </div>`
    : '';

  const ov = makeModal('review-modal');
  ov.innerHTML = `
    <div class="modal-box">
      <h2>📅 Review Now</h2>
      <p>${count} card${count !== 1 ? 's' : ''} due for review</p>
      <button class="btn btn-primary" id="review-all-btn" style="width:100%;margin-top:0.5rem;">&#9654; Review All</button>
      ${classRowsHtml}
      <div style="margin-top:1rem;">
        <button class="btn btn-ghost btn-sm" id="review-cancel-btn">Cancel</button>
      </div>
    </div>`;

  ov.querySelector('#review-all-btn').onclick = () => { ov.remove(); launchReviewAll(); };
  ov.querySelector('#review-cancel-btn').onclick = () => ov.remove();
  ov.querySelectorAll('[data-cls]').forEach(btn => {
    btn.onclick = () => { ov.remove(); launchReviewClass(btn.dataset.cls); };
  });
}

/* ── DEMO_QUESTIONS — hardcoded, never touches real engine ── */
const DEMO_QUESTIONS = [
  {
    id: 'demo-1',
    q: 'What does SM-2 stand for in spaced repetition?',
    opts: ['Study Method 2.0', 'SuperMemo Algorithm 2', 'Spaced Memory Mapping', 'Sequential Mastery Mode'],
    ans: 1,
    explain: 'SM-2 is the SuperMemo Algorithm version 2, developed by Piotr Woźniak in 1987. It calculates optimal review intervals based on how well you recalled each answer.'
  },
  {
    id: 'demo-2',
    q: 'What happens when you get a question wrong in StudyBlitz?',
    opts: ["It's removed from your deck permanently", "It's added to your Weak Spots for focused drilling", 'Your score resets to zero', 'Nothing — wrong answers are ignored'],
    ans: 1,
    explain: 'Wrong answers are tracked and added to your Weak Spots. StudyBlitz prioritizes these in future sessions so you focus where it counts.'
  },
  {
    id: 'demo-3',
    q: 'What is the spacing effect in learning science?',
    opts: ['Studying in a quiet space improves retention', 'Longer study sessions always produce better results', 'Spreading practice over time beats massed cramming', 'Taking breaks every 20 minutes maximizes focus'],
    ans: 2,
    explain: 'The spacing effect (Ebbinghaus, 1885) shows that distributing practice over time leads to far better long-term retention than cramming — even with the same total study time.'
  },
  {
    id: 'demo-4',
    q: 'In Time Challenge mode, what triggers the confetti?',
    opts: ['Getting 10 correct in a row', 'Finishing all questions before time runs out', 'The timer reaching zero', 'Beating your previous high score'],
    ans: 2,
    explain: 'When the countdown hits zero, StudyBlitz shows your results with a confetti burst. The goal is to answer as many correctly as possible before time runs out.'
  }
];

/* ── _renderDemoQ — pure presentational, no engine calls ─── */
function _renderDemoQ() {
  const el = document.getElementById('onb-demo-quiz');
  if (!el) return;
  const state = window._demoState;

  if (state.current >= DEMO_QUESTIONS.length) {
    el.innerHTML = `
      <div class="onb-q-card onb-results-card fade-up">
        <div class="onb-results-title">🎓 That's how StudyBlitz works.</div>
        <div class="onb-results-sub">Ready to build your own deck?</div>
        <div class="onb-ctas" style="margin-top:1.5rem;">
          <button class="btn btn-primary onb-cta-primary" onclick="openGuestSignupModal()">🎓 Create a Class</button>
          <button class="onb-cta-ghost" onclick="openGuestSignupModal()">🛠️ Build a Deck</button>
        </div>
      </div>`;
    return;
  }

  const q = DEMO_QUESTIONS[state.current];
  const isLast = state.current === DEMO_QUESTIONS.length - 1;

  el.innerHTML = `
    <div class="onb-q-card fade-up">
      <div class="onb-demo-badge">DEMO MODE</div>
      <div class="onb-q-num">Question ${state.current + 1} of ${DEMO_QUESTIONS.length}</div>
      <div class="onb-q-text">${q.q}</div>
      <div class="onb-q-opts" id="onb-opts">
        ${q.opts.map((opt, i) => `
          <button class="onb-opt-btn" onclick="window._demoAnswer(${i})">${opt}</button>
        `).join('')}
      </div>
      <div class="onb-q-explain" id="onb-explain"></div>
      <button class="btn btn-primary onb-next-btn" id="onb-next-btn" style="display:none;" onclick="window._demoNext()">
        ${isLast ? 'See Results →' : 'Next →'}
      </button>
    </div>`;

  window._demoAnswer = function (idx) {
    if (state.answered) return;
    state.answered = true;
    const opts = document.querySelectorAll('.onb-opt-btn');
    opts.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.ans) btn.classList.add('onb-opt-correct');
      else if (i === idx) btn.classList.add('onb-opt-wrong');
    });
    const explain = document.getElementById('onb-explain');
    if (explain) { explain.textContent = q.explain; explain.classList.add('onb-explain-visible'); }
    const nextBtn = document.getElementById('onb-next-btn');
    if (nextBtn) nextBtn.style.display = 'block';
  };

  window._demoNext = function () {
    state.current++;
    state.answered = false;
    _renderDemoQ();
  };
}

/* ── _buildStepCards ─────────────────────────────────────── */
function _buildStepCards() {
  const steps = [
    { num: 1, icon: '🎓', title: 'Create a Class',    body: 'Think of classes like folders — one per subject. Accounting 210, Macroeconomics, whatever you\'re taking. Everything is organized by class.' },
    { num: 2, icon: '🛠️', title: 'Build a Deck',      body: 'Upload your notes or PDFs to the Quiz Builder. StudyBlitz uses AI to generate multiple-choice questions automatically. Or paste them manually.' },
    { num: 3, icon: '🎮', title: 'Take a Quiz',        body: 'Choose Standard for a clean practice session, Time Challenge to race the clock, or Exam Mode for a full mock exam with graded results.' },
    { num: 4, icon: '🎯', title: 'Track Weak Spots',   body: 'Every wrong answer is remembered. StudyBlitz surfaces the questions you keep missing and prioritizes them in future sessions.' },
    { num: 5, icon: '📅', title: 'Review Due Cards',   body: 'The SM-2 algorithm schedules reviews at the optimal moment — right before you\'d forget. Your dashboard shows when cards are due.' },
  ];
  return steps.map(s => `
    <div class="onb-step-card">
      <div class="onb-step-num">STEP ${s.num}</div>
      <div class="onb-step-title">${s.icon} ${s.title}</div>
      <div class="onb-step-body">${s.body}</div>
    </div>`).join('');
}

/* ── renderOnboardingDashboard ───────────────────────────── */
export function renderOnboardingDashboard(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="onb-wrap">

      <!-- SECTION A: Hero + CTAs + Instructions -->
      <section class="onb-hero fade-up">
        <div class="onb-eyebrow">Adaptive Quiz Engine</div>
        <h1 class="onb-headline">STUDY<br>SMARTER.</h1>
        <p class="onb-sub">StudyBlitz builds adaptive quizzes from your notes and remembers which concepts trip you up — so every study session targets exactly what you need to know.</p>

        <div class="onb-ctas">
          <button class="btn btn-primary onb-cta-primary" onclick="openGuestSignupModal()">🎓 Create Your First Class</button>
          <button class="onb-cta-ghost" onclick="openGuestSignupModal()">🛠️ Build a Deck</button>
        </div>

        <p class="onb-tier1-text">Paste your notes or drop a file into the Quiz Builder. StudyBlitz turns them into a quiz, tracks what you miss, and makes sure those questions come back until you've got them.</p>

        <div class="onb-accordion">
          <button class="onb-accordion-trigger" id="onb-acc-btn" onclick="window._onbToggle()" aria-expanded="false">
            <span>Step-by-step guide</span>
            <span class="onb-chevron" id="onb-chevron">▼</span>
          </button>
          <div class="onb-accordion-body" id="onb-acc-body">
            ${_buildStepCards()}
          </div>
        </div>

        <div class="onb-scroll-hint">
          <span class="onb-bob">↓</span>&nbsp;See it in action
        </div>
      </section>

      <!-- SECTION B: Interactive Demo Quiz -->
      <section class="onb-demo-section">
        <div class="onb-demo-header fade-up-obs">
          <div class="onb-demo-eyebrow">LIVE DEMO</div>
          <h2 class="onb-demo-title">Try it yourself →</h2>
          <p class="onb-demo-sub">These aren't real questions — just a feel for how quizzes work.</p>
        </div>
        <div id="onb-demo-quiz"></div>
      </section>

    </div>`;

  window._onbToggle = function () {
    const body    = document.getElementById('onb-acc-body');
    const chevron = document.getElementById('onb-chevron');
    const btn     = document.getElementById('onb-acc-btn');
    const isOpen  = body.classList.contains('onb-acc-open');
    body.classList.toggle('onb-acc-open', !isOpen);
    chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    btn.setAttribute('aria-expanded', String(!isOpen));
  };

  // Entrance animation for demo header via IntersectionObserver
  const demoHeader = container.querySelector('.onb-demo-header');
  if (demoHeader) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in-view'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    obs.observe(demoHeader);
  }

  // Initialise demo quiz state — isolated from all real engine state
  window._demoState = { current: 0, answered: false };
  _renderDemoQ();
}

/* ── showGettingStarted ───────────────────────────────────── */
export function showGettingStarted() {
  _nav?.('dashboard');
  renderOnboardingDashboard(document.getElementById('page-dashboard'));
}

/* ── relaunchRecent ───────────────────────────────────────── */
export function relaunchRecent() {
  const recent = load(KEYS.recentDeck);
  if (!recent) return;
  const deck = getDeckById(recent.id);
  if (!deck) return;
  const mem = getMem();
  const mode = recent.mode || 'standard';
  if (mode === 'exam') { launchExam(deck.id); return; }
  if (mode === 'drill') {
    const weakQs = deck.questions.filter(q => isWeak(getRec(mem, q.id)));
    if (!weakQs.length) { _nav?.('quiz-select'); return; }
    QS.deck = deck; QS.questions = weakQs; QS.mode = 'drill'; startQS(); return;
  }
  const n = Math.min(20, deck.questions.length);
  QS.deck = deck;
  QS.questions = weightedSample(deck.questions, mem, n);
  QS.mode = mode;
  if (mode === 'timechallenge') QS.tcSecs = recent.tcSecs || 60;
  startQS();
}
