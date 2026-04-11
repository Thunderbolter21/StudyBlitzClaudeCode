// DeckCard.js — shared deck card builder used in Dashboard, SavedTests, and Classes pages

import { getMem, getRec, isWeak, isMastered } from '../engine/memory.js';
import { getDeckColor } from '../engine/decks.js';
import { getClasses } from '../engine/classes.js';
import { getBestHS } from '../engine/quiz.js';

let _quickStartDeck, _drillDeck, _toggleDeckMenu, _openAssignClassModal;

export function initDeckCardCallbacks({ quickStartDeck, drillDeck, toggleDeckMenu, openAssignClassModal }) {
  _quickStartDeck = quickStartDeck;
  _drillDeck = drillDeck;
  _toggleDeckMenu = toggleDeckMenu;
  _openAssignClassModal = openAssignClassModal;
}

export function makeDeckCard(deck, overrideCls) {
  const mem = getMem();
  const masteredN = deck.questions.filter(q => isMastered(getRec(mem, q.id))).length;
  const pct = deck.questions.length > 0 ? masteredN / deck.questions.length : 0;
  const weakN = deck.questions.filter(q => isWeak(getRec(mem, q.id))).length;
  const createdStr = deck.created ? new Date(deck.created).toLocaleDateString() : 'Unknown';
  const bestTC = getBestHS(deck.id);
  const bestTCStr = bestTC ? bestTC.correct + ' correct / ' + bestTC.secs + 's' : '—';
  const deckColor = getDeckColor(deck);
  const cls = overrideCls || (deck.classId ? getClasses().find(c => c.id === deck.classId) : null);

  const card = document.createElement('div');
  card.className = 'deck-card';
  card.style.setProperty('--dc', deckColor);
  card.innerHTML = `
    <button class="deck-ellipsis" title="Options">⋯</button>
    <div class="deck-name">${deck.name}</div>
    <div class="deck-meta">${deck.questions.length} questions · Created ${createdStr}</div>
    ${cls ? `<div style="font-size:0.7rem;color:${cls.color};margin-top:0.2rem;">● ${cls.name}</div>` : ''}
    <div class="deck-progress"><div class="deck-progress-fill" style="width:${Math.round(pct*100)}%"></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.5rem;">
      <div style="font-size:0.7rem;color:var(--muted);">
        ${masteredN} mastered${weakN > 0 ? ` · <span style="color:var(--accent)">${weakN} weak</span>` : ''}
      </div>
      <div style="font-size:0.65rem;color:var(--muted);">⏱ Best: ${bestTCStr}</div>
    </div>
    <div class="deck-actions">
      <button class="btn btn-primary btn-sm" data-action="quiz">▶ Quiz</button>
      <button class="btn btn-ghost btn-sm" data-action="drill">🎯 Drill</button>
    </div>
  `;

  card.querySelector('[data-action="quiz"]').onclick = () => _quickStartDeck?.(deck.id);
  card.querySelector('[data-action="drill"]').onclick = () => _drillDeck?.(deck.id);
  card.querySelector('.deck-ellipsis').onclick = (e) => _toggleDeckMenu?.(e, deck.id);

  return card;
}
