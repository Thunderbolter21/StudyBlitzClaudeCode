// Dashboard.js — dashboard page rendering: stats, recent deck, knowledge breakdown

import { getMem, getRec, isWeak, isMastered, weightedSample, getDueCount } from '../engine/memory.js';
import { getDecks, getDeckById, getDeckColor } from '../engine/decks.js';
import { load } from '../engine/storage.js';
import { KEYS } from '../config.js';
import { QS, quickStartDeck, drillDeck, startQS, launchExam } from '../engine/quiz.js';

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

/* ── refreshDashboard ────────────────────────────────────── */
export function refreshDashboard() {
  const decks = getDecks();
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

  // Due-for-review banner
  const dueBanner = document.getElementById('dash-due-banner');
  const dueCountEl = document.getElementById('dash-due-count');
  if (dueBanner) {
    const due = getDueCount();
    if (due > 0) {
      if (dueCountEl) dueCountEl.textContent = due;
      dueBanner.style.display = '';
    } else {
      dueBanner.style.display = 'none';
    }
  }
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
