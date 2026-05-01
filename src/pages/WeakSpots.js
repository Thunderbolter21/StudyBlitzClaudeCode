// WeakSpots.js — weak spots page: drill launcher panel + collapsible deck sections

import { getMem, getRec, isWeak } from '../engine/memory.js';
import { getDecks, getDeckColor } from '../engine/decks.js';
import { getClasses } from '../engine/classes.js';
import { launchDrillAll, launchDrillDeck } from '../engine/quiz.js';
import { drillClassMixed } from './Classes.js';

let _toast, _nav, _refreshAll;
export function initWeakSpotsCallbacks({ toast, nav, refreshAll }) {
  _toast = toast; _nav = nav; _refreshAll = refreshAll;
}

// Track which deck sections are expanded (all open by default)
const expandedSections = new Set();
let _initialized = false;

// Collapse state for drill panel rows
let classRowOpen = false;
let deckRowOpen  = false;

/* ── refreshWeakSpots ──────────────────────────────────────── */
export function refreshWeakSpots() {
  const decks = getDecks();
  const mem   = getMem();

  if (!_initialized) {
    decks.forEach(d => expandedSections.add(d.id));
    _initialized = true;
  }

  // Collect all weak questions grouped by deck
  let totalWeak = 0;
  const deckWeakMap = [];
  decks.forEach(deck => {
    const weakQs = [];
    deck.questions.forEach(q => {
      const rec = getRec(mem, q.id);
      if (isWeak(rec)) { weakQs.push({ q, rec }); totalWeak++; }
    });
    if (weakQs.length > 0) {
      weakQs.sort((a, b) => a.rec.reps - b.rec.reps);
      deckWeakMap.push({ deck, weakQs });
    }
  });

  // Build class weak map (classId → { cls, count })
  const classes       = getClasses();
  const classWeakMap  = new Map();
  deckWeakMap.forEach(({ deck, weakQs }) => {
    if (!deck.classId) return;
    const entry = classWeakMap.get(deck.classId);
    if (entry) { entry.count += weakQs.length; }
    else {
      const cls = classes.find(c => c.id === deck.classId);
      if (cls) classWeakMap.set(deck.classId, { cls, count: weakQs.length });
    }
  });

  // Summary line
  const summaryEl = document.getElementById('weak-summary');
  if (summaryEl) {
    summaryEl.textContent = totalWeak > 0
      ? `${totalWeak} weak question${totalWeak !== 1 ? 's' : ''} across ${deckWeakMap.length} deck${deckWeakMap.length !== 1 ? 's' : ''}`
      : 'No weak spots — keep it up!';
  }

  const container = document.getElementById('weak-content');
  if (!container) return;

  // ── Drill launcher panel ────────────────────────────────────
  const existingPanel = document.getElementById('weak-drill-panel');
  if (existingPanel) existingPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'weak-drill-panel';
  panel.style.cssText = [
    'background:var(--card)',
    'border:1px solid var(--border)',
    'border-radius:var(--radius)',
    'padding:1rem',
    'margin-bottom:1.5rem',
    'display:flex',
    'flex-direction:column',
    'gap:0.5rem',
  ].join(';');

  // ── Row 1: Drill All ──────────────────────────────────────
  const drillAllBtn = document.createElement('button');
  drillAllBtn.className = 'btn btn-ghost btn-sm';
  drillAllBtn.style.cssText = 'width:100%;text-align:left;justify-content:flex-start;font-size:0.88rem;padding:0.55rem 0.8rem;';
  drillAllBtn.textContent = `🎯 Drill All Weak Spots (${totalWeak})`;
  drillAllBtn.disabled = totalWeak === 0;
  if (totalWeak > 0) drillAllBtn.onclick = () => launchDrillAll();
  panel.appendChild(drillAllBtn);

  // ── Row 2: By Class ───────────────────────────────────────
  const classSection = document.createElement('div');

  const classHeaderEl = document.createElement('div');
  classHeaderEl.style.cssText = 'font-size:0.78rem;color:var(--muted);cursor:pointer;user-select:none;padding:0.2rem 0.1rem;display:flex;align-items:center;gap:0.35rem;';
  const classChevron = `<span style="display:inline-block;transition:transform 0.2s;transform:rotate(${classRowOpen ? '180' : '0'}deg);">▼</span>`;
  classHeaderEl.innerHTML = `By Class ${classChevron}`;
  classHeaderEl.onclick = () => { classRowOpen = !classRowOpen; refreshWeakSpots(); };
  classSection.appendChild(classHeaderEl);

  if (classRowOpen) {
    const classBody = document.createElement('div');
    classBody.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;margin-top:0.3rem;';

    if (classWeakMap.size === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'font-size:0.78rem;color:var(--muted);padding:0.25rem 0.5rem;';
      msg.textContent = 'No class weak spots yet';
      classBody.appendChild(msg);
    } else {
      classWeakMap.forEach(({ cls, count }) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-sm';
        btn.style.cssText = 'width:100%;text-align:left;justify-content:flex-start;font-size:0.82rem;padding:0.4rem 0.7rem;display:flex;align-items:center;gap:0.5rem;';
        btn.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${cls.color};flex-shrink:0;"></span><span style="flex:1;">${cls.name}</span><span style="color:var(--muted);font-size:0.72rem;">${count} weak</span>`;
        btn.onclick = () => drillClassMixed(cls.id);
        classBody.appendChild(btn);
      });
    }

    classSection.appendChild(classBody);
  }

  panel.appendChild(classSection);

  // ── Row 3: By Deck ────────────────────────────────────────
  const deckSection = document.createElement('div');

  const deckHeaderEl = document.createElement('div');
  deckHeaderEl.style.cssText = 'font-size:0.78rem;color:var(--muted);cursor:pointer;user-select:none;padding:0.2rem 0.1rem;display:flex;align-items:center;gap:0.35rem;';
  const deckChevron = `<span style="display:inline-block;transition:transform 0.2s;transform:rotate(${deckRowOpen ? '180' : '0'}deg);">▼</span>`;
  deckHeaderEl.innerHTML = `By Deck ${deckChevron}`;
  deckHeaderEl.onclick = () => { deckRowOpen = !deckRowOpen; refreshWeakSpots(); };
  deckSection.appendChild(deckHeaderEl);

  if (deckRowOpen) {
    const deckBody = document.createElement('div');
    deckBody.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;margin-top:0.3rem;';

    deckWeakMap.forEach(({ deck, weakQs }) => {
      const color  = getDeckColor(deck);
      const btn    = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm';
      btn.style.cssText = 'width:100%;text-align:left;justify-content:flex-start;font-size:0.82rem;padding:0.4rem 0.7rem;display:flex;align-items:center;gap:0.5rem;';
      btn.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span><span style="flex:1;">${deck.name}</span><span style="color:var(--muted);font-size:0.72rem;">${weakQs.length} weak</span>`;
      btn.onclick = () => launchDrillDeck(deck.id);
      deckBody.appendChild(btn);
    });

    deckSection.appendChild(deckBody);
  }

  panel.appendChild(deckSection);

  // Inject panel before weak-content
  container.parentNode.insertBefore(panel, container);

  // ── Question list (unchanged) ────────────────────────────
  container.innerHTML = '';

  if (totalWeak === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:var(--muted);">
        <div style="font-size:2.5rem;margin-bottom:0.8rem;">🏆</div>
        <div style="font-size:1rem;font-weight:600;margin-bottom:0.5rem;">No weak spots!</div>
        <div style="font-size:0.85rem;">You've cleared all your problem questions. Take a quiz to find more.</div>
      </div>`;
    return;
  }

  deckWeakMap.forEach(({ deck, weakQs }) => {
    const color      = getDeckColor(deck);
    const isExpanded = expandedSections.has(deck.id);

    const section = document.createElement('div');
    section.className = 'weak-section';

    const header = document.createElement('div');
    header.className = 'weak-section-header';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.7rem;">
        <span style="color:${color};font-size:1.1rem;">●</span>
        <span style="font-weight:700;font-size:0.95rem;">${deck.name}</span>
        <span style="font-size:0.75rem;color:var(--accent);font-weight:600;">${weakQs.length} weak</span>
      </div>
      <span class="class-chevron">${isExpanded ? '▲' : '▼'}</span>`;
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.8rem 1rem;cursor:pointer;border-radius:var(--radius);transition:background 0.15s;';
    header.onmouseenter = () => { header.style.background = 'rgba(255,255,255,0.03)'; };
    header.onmouseleave = () => { header.style.background = 'transparent'; };
    header.onclick = () => {
      if (expandedSections.has(deck.id)) expandedSections.delete(deck.id);
      else expandedSections.add(deck.id);
      refreshWeakSpots();
    };
    section.appendChild(header);

    if (isExpanded) {
      const list = document.createElement('div');
      list.className = 'weak-q-list';
      list.style.cssText = 'padding:0 1rem 0.8rem 1rem;';

      weakQs.forEach(({ q, rec }) => {
        const missed  = rec.total - rec.correct;
        const urgency = rec.reps === 0 ? 2 : 1;
        const row     = document.createElement('div');
        row.className = 'weak-q-row';
        row.style.cssText = 'display:flex;align-items:flex-start;gap:0.8rem;padding:0.6rem 0;border-bottom:1px solid var(--border);';

        let pipsHtml = '';
        for (let i = 0; i < 2; i++) {
          const active   = i < urgency;
          const pipColor = active ? (urgency >= 2 ? 'var(--accent)' : 'var(--gold)') : 'rgba(255,255,255,0.08)';
          pipsHtml += `<div style="width:6px;height:6px;border-radius:50%;background:${pipColor};"></div>`;
        }

        row.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:3px;padding-top:0.35rem;" title="Reps: ${rec.reps}">${pipsHtml}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;line-height:1.4;color:var(--text);">${q.q}</div>
            ${q.cat ? `<div style="font-size:0.68rem;color:var(--muted);margin-top:0.2rem;">${q.cat}</div>` : ''}
          </div>
          <div style="flex-shrink:0;text-align:right;">
            <div style="font-size:0.78rem;color:var(--accent);font-weight:600;">${missed} missed</div>
            <div style="font-size:0.65rem;color:var(--muted);">${rec.correct}/${rec.total} correct</div>
          </div>`;
        list.appendChild(row);
      });

      section.appendChild(list);
    }

    container.appendChild(section);
  });
}
