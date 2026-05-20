// Classes.js — classes page rendering: class cards, quiz panels, drill actions

import { getMem, getRec, isWeak, weightedSample, interleaveQuestions } from '../engine/memory.js';
import { getDecks, getDeckById, getDeckColor } from '../engine/decks.js';
import { getClasses } from '../engine/classes.js';
import { makeDeckCard } from '../components/DeckCard.js';
import { QS, startQS, launchExam } from '../engine/quiz.js';
import { renderModeSelector, getSelectedMode } from '../pages/QuizSelect.js';

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

  QS.deck      = { id: 'class-drill-' + classId, name: 'Class Drill' };
  QS.questions = weakQs.sort(() => Math.random() - 0.5);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode      = 'drill';
  startQS();
}

/* ── Class quiz panel ─────────────────────────────────────── */
/* ── openClassQuizPanel ───────────────────────────────────── */
export function openClassQuizPanel(deck, cls) {
  document.getElementById('cq-modal')?.remove();

  const ov = document.createElement('div');
  ov.id = 'cq-modal';
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

  const box = document.createElement('div');
  box.className = 'modal-box';
  box.style.cssText = 'max-width:480px;width:100%;max-height:90vh;overflow-y:auto;';

  box.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1.2rem;padding-bottom:1rem;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:0.05em;">${deck.name}</div>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:0.15rem;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cls.color};margin-right:0.4rem;vertical-align:middle;"></span>${cls.name} · ${deck.questions.length} questions
        </div>
      </div>
      <button id="cq-close-btn" style="background:transparent;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;padding:0.2rem 0.4rem;line-height:1;border-radius:6px;flex-shrink:0;" title="Close">✕</button>
    </div>
    <div id="cq-selector-wrap"></div>
    <button class="btn btn-primary" id="cq-start-btn" style="width:100%;justify-content:center;margin-top:1.2rem;font-size:1rem;padding:0.85rem;">▶ Start Quiz</button>`;

  ov.appendChild(box);
  document.body.appendChild(ov);

  box.querySelector('#cq-close-btn').onclick = () => ov.remove();
  box.querySelector('#cq-start-btn').onclick = () => _launchClassQuizFromModal(deck, cls);

  renderModeSelector(
    document.getElementById('cq-selector-wrap'),
    'cq',
    deck
  );
}

/* ── _launchClassQuizFromModal ────────────────────────────── */
function _launchClassQuizFromModal(deck, cls) {
  const mode = getSelectedMode('cq');
  const mem  = getMem();

  // Read DOM values before removing the modal — after removal getElementById returns null
  const rawCount = parseInt(document.getElementById('cq-count')?.value);
  const tcSecs   = parseInt(document.getElementById('cq-tc-sel')?.value || '60');

  document.getElementById('cq-modal')?.remove();

  QS.deck = deck;
  QS.mode = mode;

  if (mode === 'exam') {
    const n = Math.min(
      Math.max(5, isNaN(rawCount) ? deck.questions.length : rawCount),
      deck.questions.length
    );
    launchExam(deck.id, n);
    return;
  }

  if (mode === 'timechallenge') {
    QS.tcSecs    = tcSecs;
    QS.questions = [...deck.questions].sort(() => Math.random() - 0.5);
    startQS();
    return;
  }

  const n = Math.min(
    Math.max(5, isNaN(rawCount) ? deck.questions.length : rawCount),
    deck.questions.length
  );

  QS.questions = weightedSample(deck.questions, mem, n);
  QS.questions = interleaveQuestions(QS.questions, mem);
  startQS();
}