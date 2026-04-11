// Classes.js — classes page rendering: class cards, quiz panels, drill actions

import { getMem, getRec, isWeak } from '../engine/memory.js';
import { getDecks, getDeckById, getDeckColor } from '../engine/decks.js';
import { getClasses } from '../engine/classes.js';
import { makeDeckCard } from '../components/DeckCard.js';

let _toast, _nav, _refreshAll, _refreshClasses;
export function initClassesCallbacks({ toast, nav, refreshAll, refreshClasses }) {
  _toast = toast; _nav = nav; _refreshAll = refreshAll; _refreshClasses = refreshClasses;
}

/* ── refreshClasses ────────────────────────────────────────── */
export function refreshClasses() {
  const classes = getClasses();
  const decks = getDecks();
  const mem = getMem();

  const summary = document.getElementById('classes-summary');
  const totalDecks = decks.filter(d => d.classId).length;
  if (summary) {
    summary.textContent = `${classes.length} class${classes.length !== 1 ? 'es' : ''} \u00B7 ${totalDecks} deck${totalDecks !== 1 ? 's' : ''} assigned`;
  }

  const content = document.getElementById('classes-content');
  if (!content) return;
  content.innerHTML = '';

  if (!classes.length) {
    content.innerHTML = '<div class="no-classes"><div class="nc-icon">\uD83C\uDF93</div><p>No classes yet.<br>Click <strong>+ New Class</strong> to create one.</p></div>';
    return;
  }

  classes.forEach(cls => {
    const classDecks = decks.filter(d => d.classId === cls.id);
    const weakQs = classDecks.flatMap(d => d.questions.filter(q => isWeak(getRec(mem, q.id))));

    const card = document.createElement('div');
    card.className = 'class-card';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'class-card-header';
    hdr.innerHTML = `
      <div class="class-left">
        <div class="class-dot" style="background:${cls.color}"></div>
        <div class="class-name">${cls.name}</div>
        <div class="class-deck-count">${classDecks.length} deck${classDecks.length !== 1 ? 's' : ''}${weakQs.length ? ' \u00B7 ' + weakQs.length + ' weak' : ''}</div>
      </div>
      <div class="class-right">
        <button class="btn btn-ghost btn-sm" style="font-size:0.72rem;padding:0.3rem 0.7rem;"
          id="cls-menu-${cls.id}">\u22EF</button>
        <span class="class-chevron">\u25BC</span>
      </div>`;

    // Body
    const body = document.createElement('div');
    body.className = 'class-body';

    // Quiz action
    const quizAction = document.createElement('button');
    quizAction.className = 'class-action';
    quizAction.innerHTML = '<span class="ca-icon">\uD83C\uDFAE</span> Take a Quiz';
    const quizSub = document.createElement('div');
    quizSub.className = 'class-action-sub';

    if (classDecks.length === 0) {
      quizSub.innerHTML = '<div style="font-size:0.8rem;color:var(--muted);padding:0.4rem 0.8rem;">No decks assigned to this class yet.</div>';
    } else {
      const cardGrid = document.createElement('div');
      cardGrid.className = 'class-deck-grid';
      classDecks.forEach(deck => {
        const deckCard = makeDeckCard(deck, cls);
        const quizBtn = deckCard.querySelector('.btn-primary');
        if (quizBtn) {
          quizBtn.textContent = '\u25B6 Quiz';
          quizBtn.onclick = (e) => { e.stopPropagation(); openClassQuizPanel(deck, cls); };
        }
        cardGrid.appendChild(deckCard);
      });
      quizSub.appendChild(cardGrid);
    }

    // Drill action
    const drillAction = document.createElement('button');
    drillAction.className = 'class-action';
    drillAction.innerHTML = '<span class="ca-icon">\uD83C\uDFAF</span> Drill Weak Spots' +
      (weakQs.length ? ` <span style="margin-left:auto;color:var(--accent);font-size:0.75rem;">${weakQs.length} weak</span>` : '');
    const drillSub = document.createElement('div');
    drillSub.className = 'class-action-sub';
    const drillOptsDiv = document.createElement('div');
    drillOptsDiv.className = 'class-drill-opts';

    if (weakQs.length === 0) {
      drillSub.innerHTML = '<div style="font-size:0.8rem;color:var(--muted);padding:0.4rem 0.8rem;">No weak spots in this class yet!</div>';
    } else {
      const mixBtn = document.createElement('button');
      mixBtn.className = 'btn btn-primary btn-sm';
      mixBtn.style.fontSize = '0.75rem';
      mixBtn.textContent = '\uD83D\uDD00 Mix All (' + weakQs.length + ')';
      mixBtn.onclick = () => drillClassMixed(cls.id);
      drillOptsDiv.appendChild(mixBtn);

      const decksWithWeak = classDecks.filter(d => d.questions.some(q => isWeak(getRec(mem, q.id))));
      decksWithWeak.forEach(deck => {
        const dw = deck.questions.filter(q => isWeak(getRec(mem, q.id))).length;
        const db = document.createElement('button');
        db.className = 'btn btn-ghost btn-sm';
        db.style.fontSize = '0.75rem';
        db.textContent = (deck.name.length > 22 ? deck.name.substring(0, 20) + '\u2026' : deck.name) + ' (' + dw + ')';
        db.onclick = () => drillClassMixed(cls.id, deck.id);
        drillOptsDiv.appendChild(db);
      });
      drillSub.appendChild(drillOptsDiv);
    }

    // Toggle handlers
    quizAction.onclick = () => {
      quizSub.classList.toggle('open');
      drillSub.classList.remove('open');
      drillOptsDiv.classList.remove('open');
    };
    drillAction.onclick = () => {
      drillSub.classList.toggle('open');
      drillOptsDiv.classList.toggle('open');
      quizSub.classList.remove('open');
    };

    hdr.addEventListener('click', (e) => {
      if (e.target.closest('.btn')) return;
      hdr.classList.toggle('open');
      body.classList.toggle('open');
    });

    // Wire up the class menu button
    const menuBtn = hdr.querySelector(`#cls-menu-${cls.id}`);
    if (menuBtn) {
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        window.openClassMenu(cls.id);
      };
    }

    body.appendChild(quizAction);
    body.appendChild(quizSub);
    body.appendChild(drillAction);
    body.appendChild(drillSub);
    card.appendChild(hdr);
    card.appendChild(body);
    content.appendChild(card);
  });
}

/* ── drillClassMixed ──────────────────────────────────────── */
export function drillClassMixed(classId, singleDeckId) {
  const decks = getDecks();
  const mem = getMem();
  const classDecks = singleDeckId
    ? decks.filter(d => d.id === singleDeckId)
    : decks.filter(d => d.classId === classId);

  const seen = new Set();
  const weakQs = [];
  classDecks.forEach(d => {
    d.questions.forEach(q => {
      if (!seen.has(q.id) && isWeak(getRec(mem, q.id))) {
        seen.add(q.id);
        weakQs.push(q);
      }
    });
  });

  if (weakQs.length === 0) {
    if (_toast) _toast('No weak spots to drill!');
    return;
  }

  window.dispatchEvent(new CustomEvent('sb-start-drill', {
    detail: { questions: weakQs, mode: 'drill', source: 'class', classId }
  }));
}

/* ── Class quiz panel ─────────────────────────────────────── */
let _cqDeck = null;
let _cqCount = 20;

export function openClassQuizPanel(deck, cls) {
  _cqDeck = deck;
  _cqCount = Math.min(20, deck.questions.length);

  let modal = document.getElementById('class-quiz-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'class-quiz-modal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }

  const color = getDeckColor(deck);
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <h2 style="margin-bottom:0.3rem;">${deck.name}</h2>
      <div style="font-size:0.78rem;color:${cls.color};margin-bottom:1rem;">\u25CF ${cls.name}</div>
      <div style="margin-bottom:1rem;">
        <label>Questions</label>
        <div class="num-input">
          <button id="cq-minus">\u2212</button>
          <input type="text" id="cq-count" value="${_cqCount}" style="width:70px;text-align:center;" readonly>
          <button id="cq-plus">+</button>
        </div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:0.3rem;">${deck.questions.length} available</div>
      </div>
      <div style="display:flex;gap:0.8rem;flex-wrap:wrap;">
        <button class="btn btn-primary" id="cq-launch">\u25B6 Start Quiz</button>
        <button class="btn btn-ghost" id="cq-cancel">Cancel</button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  document.getElementById('cq-minus').onclick = () => adjCQCount(-5);
  document.getElementById('cq-plus').onclick = () => adjCQCount(5);
  document.getElementById('cq-launch').onclick = () => launchClassQuiz(deck.id);
  document.getElementById('cq-cancel').onclick = () => { modal.style.display = 'none'; };
}

/* ── adjCQCount ───────────────────────────────────────────── */
export function adjCQCount(d) {
  if (!_cqDeck) return;
  _cqCount = Math.max(5, Math.min(_cqDeck.questions.length, _cqCount + d));
  const el = document.getElementById('cq-count');
  if (el) el.value = _cqCount;
}

/* ── launchClassQuiz ──────────────────────────────────────── */
export function launchClassQuiz(deckId) {
  const modal = document.getElementById('class-quiz-modal');
  if (modal) modal.style.display = 'none';

  window.dispatchEvent(new CustomEvent('sb-start-quiz', {
    detail: { deckId, mode: 'standard', count: _cqCount, source: 'class' }
  }));
}
