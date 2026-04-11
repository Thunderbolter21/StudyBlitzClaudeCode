// SavedTests.js — saved tests/decks grid page

import { getDecks, getDeckColor } from '../engine/decks.js';
import { makeDeckCard } from '../components/DeckCard.js';

let _toast, _nav, _refreshAll;
export function initSavedTestsCallbacks({ toast, nav, refreshAll }) {
  _toast = toast; _nav = nav; _refreshAll = refreshAll;
}

/* ── refreshSavedTests ────────────────────────────────────── */
export function refreshSavedTests() {
  const decks = getDecks();
  const grid = document.getElementById('saved-tests-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (decks.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--muted);">
        <div style="font-size:2rem;margin-bottom:0.8rem;">📁</div>
        <div style="font-size:0.95rem;margin-bottom:0.5rem;">No decks yet</div>
        <div style="font-size:0.82rem;">Head to the <strong>Quiz Builder</strong> to create your first deck.</div>
      </div>
    `;
    return;
  }

  decks.forEach(deck => {
    const card = makeDeckCard(deck);
    grid.appendChild(card);
  });
}
