// WeakSpots.js — weak spots page: collapsible deck sections, heat pips, missed counts

import { getMem, getRec, isWeak } from '../engine/memory.js';
import { getDecks, getDeckColor } from '../engine/decks.js';

let _toast, _nav, _refreshAll;
export function initWeakSpotsCallbacks({ toast, nav, refreshAll }) {
  _toast = toast; _nav = nav; _refreshAll = refreshAll;
}

// Track which deck sections are expanded (all open by default)
const expandedSections = new Set();
let _initialized = false;

/* ── refreshWeakSpots ──────────────────────────────────────── */
export function refreshWeakSpots() {
  const decks = getDecks();
  const mem = getMem();

  // Initialize all sections as expanded on first call
  if (!_initialized) {
    decks.forEach(d => expandedSections.add(d.id));
    _initialized = true;
  }

  // Collect all weak questions across decks
  let totalWeak = 0;
  const deckWeakMap = [];

  decks.forEach(deck => {
    const weakQs = [];
    deck.questions.forEach(q => {
      const rec = getRec(mem, q.id);
      if (isWeak(rec)) {
        weakQs.push({ q, rec });
        totalWeak++;
      }
    });
    if (weakQs.length > 0) {
      // Sort by weight descending (highest urgency first)
      weakQs.sort((a, b) => a.rec.reps - b.rec.reps);
      deckWeakMap.push({ deck, weakQs });
    }
  });

  // Summary
  const summaryEl = document.getElementById('weak-summary');
  if (summaryEl) {
    summaryEl.textContent = totalWeak > 0
      ? `${totalWeak} weak question${totalWeak !== 1 ? 's' : ''} across ${deckWeakMap.length} deck${deckWeakMap.length !== 1 ? 's' : ''}`
      : 'No weak spots \u2014 keep it up!';
  }

  // Content
  const container = document.getElementById('weak-content');
  if (!container) return;
  container.innerHTML = '';

  if (totalWeak === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:var(--muted);">
        <div style="font-size:2.5rem;margin-bottom:0.8rem;">\uD83C\uDFC6</div>
        <div style="font-size:1rem;font-weight:600;margin-bottom:0.5rem;">No weak spots!</div>
        <div style="font-size:0.85rem;">You've cleared all your problem questions. Take a quiz to find more.</div>
      </div>
    `;
    return;
  }

  deckWeakMap.forEach(({ deck, weakQs }) => {
    const color = getDeckColor(deck);
    const isExpanded = expandedSections.has(deck.id);

    const section = document.createElement('div');
    section.className = 'weak-section';

    // Section header (collapsible)
    const header = document.createElement('div');
    header.className = 'weak-section-header';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.7rem;">
        <span style="color:${color};font-size:1.1rem;">\u25CF</span>
        <span style="font-weight:700;font-size:0.95rem;">${deck.name}</span>
        <span style="font-size:0.75rem;color:var(--accent);font-weight:600;">${weakQs.length} weak</span>
      </div>
      <span class="class-chevron">${isExpanded ? '\u25B2' : '\u25BC'}</span>
    `;
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.8rem 1rem;cursor:pointer;border-radius:var(--radius);transition:background 0.15s;';
    header.onmouseenter = () => { header.style.background = 'rgba(255,255,255,0.03)'; };
    header.onmouseleave = () => { header.style.background = 'transparent'; };
    header.onclick = () => {
      if (expandedSections.has(deck.id)) expandedSections.delete(deck.id);
      else expandedSections.add(deck.id);
      refreshWeakSpots();
    };
    section.appendChild(header);

    // Question list (only if expanded)
    if (isExpanded) {
      const list = document.createElement('div');
      list.className = 'weak-q-list';
      list.style.cssText = 'padding:0 1rem 0.8rem 1rem;';

      weakQs.forEach(({ q, rec }) => {
        const missed = rec.total - rec.correct;
        const urgency = rec.reps === 0 ? 2 : 1;

        const row = document.createElement('div');
        row.className = 'weak-q-row';
        row.style.cssText = 'display:flex;align-items:flex-start;gap:0.8rem;padding:0.6rem 0;border-bottom:1px solid var(--border);';

        // Heat pips (2 pips, colored by urgency)
        let pipsHtml = '';
        for (let i = 0; i < 2; i++) {
          const active = i < urgency;
          const pipColor = active
            ? (urgency >= 2 ? 'var(--accent)' : 'var(--gold)')
            : 'rgba(255,255,255,0.08)';
          pipsHtml += `<div style="width:6px;height:6px;border-radius:50%;background:${pipColor};"></div>`;
        }

        row.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:3px;padding-top:0.35rem;" title="Reps: ${rec.reps}">
            ${pipsHtml}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;line-height:1.4;color:var(--text);">${q.q}</div>
            ${q.cat ? `<div style="font-size:0.68rem;color:var(--muted);margin-top:0.2rem;">${q.cat}</div>` : ''}
          </div>
          <div style="flex-shrink:0;text-align:right;">
            <div style="font-size:0.78rem;color:var(--accent);font-weight:600;">${missed} missed</div>
            <div style="font-size:0.65rem;color:var(--muted);">${rec.correct}/${rec.total} correct</div>
          </div>
        `;

        list.appendChild(row);
      });

      section.appendChild(list);
    }

    container.appendChild(section);
  });
}
