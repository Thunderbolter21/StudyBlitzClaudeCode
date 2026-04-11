// Modals.js — dynamic modal creation for rename, assign class, create class, class menu

import { getDecks, saveDecks, getDeckById, getDeckColor } from '../engine/decks.js';
import { getClasses, saveClasses } from '../engine/classes.js';
import { DECK_COLORS } from '../config.js';
import { supaSaveDeck } from '../engine/storage.js';

let _toast, _refreshAll, _deleteDeck;
export function initModalCallbacks({ toast, refreshAll, deleteDeck }) {
  _toast = toast; _refreshAll = refreshAll; _deleteDeck = deleteDeck;
}

// ── Shared modal factory ──
function makeModal(id) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const ov = document.createElement('div');
  ov.id = id;
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
  return ov;
}

// ── Deck dropdown menu ──
export function toggleDeckMenu(e, deckId) {
  document.querySelectorAll('.deck-dropdown.open').forEach(m => {
    if (m.id !== 'ddm-' + deckId) m.classList.remove('open');
  });
  const menu = document.getElementById('ddm-' + deckId);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  document.querySelectorAll('.deck-dropdown.open').forEach(m => {
    m.classList.remove('open');
    const info = m.querySelector('.dd-info');
    if (info) info.classList.remove('open');
  });
  if (!isOpen) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 210, mh = 180;
    let x = e.clientX, y = e.clientY;
    if (x + mw > vw) x = vw - mw - 10;
    if (y + mh > vh) y = vh - mh - 10;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('open');

    const renameBtn = menu.querySelector('[data-action="rename"]');
    const assignBtn = menu.querySelector('[data-action="assign"]');
    const infoBtn = menu.querySelector('[data-action="info"]');
    const deleteBtn = menu.querySelector('[data-action="delete"]');

    if (renameBtn) renameBtn.onclick = () => renameDeck(deckId);
    if (assignBtn) assignBtn.onclick = () => openAssignClassModal(deckId);
    if (infoBtn) infoBtn.onclick = () => toggleDeckInfo(deckId);
    if (deleteBtn) deleteBtn.onclick = () => _deleteDeck?.(deckId);
  }
  e.stopPropagation();
}

export function toggleDeckInfo(deckId) {
  const info = document.getElementById('ddi-' + deckId);
  if (info) info.classList.toggle('open');
}

// ── Rename deck ──
export function renameDeck(deckId) {
  document.querySelectorAll('.deck-dropdown.open').forEach(m => m.classList.remove('open'));
  const decks = getDecks();
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;
  const ov = makeModal('rename-modal');
  ov.innerHTML = `
    <div class="modal-box">
      <h2>✏️ Rename Deck</h2>
      <p>Enter a new name for "${deck.name}"</p>
      <input type="text" id="rename-input" value="${deck.name}" style="margin-bottom:0.5rem;" />
      <div id="rename-err" style="font-size:0.78rem;color:var(--accent);margin-bottom:0.8rem;display:none;"></div>
      <div style="display:flex;gap:0.8rem;">
        <button class="btn btn-primary" id="rename-confirm-btn">Rename</button>
        <button class="btn btn-ghost" id="rename-cancel-btn">Cancel</button>
      </div>
    </div>`;
  ov.querySelector('#rename-cancel-btn').onclick = () => ov.remove();
  ov.querySelector('#rename-confirm-btn').onclick = () => confirmRename(deckId);
  setTimeout(() => document.getElementById('rename-input')?.focus(), 100);
}

function confirmRename(deckId) {
  const inp = document.getElementById('rename-input');
  const err = document.getElementById('rename-err');
  if (!inp) return;
  const newName = inp.value.trim();
  if (!newName) { err.textContent = 'Name cannot be empty'; err.style.display = 'block'; return; }
  const decks = getDecks();
  const deck = decks.find(d => d.id === deckId);
  if (deck) {
    deck.name = newName;
    saveDecks(decks);
    supaSaveDeck(deck);
    _refreshAll?.();
    _toast?.('Deck renamed to "' + newName + '"');
  }
  const modal = document.getElementById('rename-modal');
  if (modal) modal.remove();
}

// ── Assign deck to class ──
export function openAssignClassModal(deckId) {
  document.querySelectorAll('.deck-dropdown.open').forEach(m => m.classList.remove('open'));
  const deck = getDeckById(deckId);
  if (!deck) return;
  const classes = getClasses();
  const opts = classes.map(cls =>
    `<button class="class-sub-item" data-class="${cls.id}" style="padding:0.7rem 1rem;border-radius:10px;border:1px solid var(--border);background:var(--surface);margin-bottom:0.4rem;width:100%;text-align:left;font-family:'Sora',sans-serif;font-size:0.85rem;cursor:pointer;color:var(--text);display:flex;align-items:center;gap:0.6rem;">
      <span class="class-sub-dot" style="background:${cls.color}"></span>${cls.name}
    </button>`
  ).join('');
  const ov = makeModal('assign-class-modal');
  ov.innerHTML = `
    <div class="modal-box">
      <h2>🎓 Assign to Class</h2>
      <p>Choose a class for "${deck.name}"</p>
      ${opts}
      <div style="margin-top:0.8rem;display:flex;gap:0.6rem;">
        <button class="btn btn-ghost btn-sm" id="unassign-btn" ${deck.classId ? '' : 'style="display:none"'}>Remove from class</button>
        <button class="btn btn-ghost btn-sm" id="assign-cancel">Cancel</button>
      </div>
    </div>`;
  ov.querySelectorAll('[data-class]').forEach(b => {
    b.onclick = () => { assignDeckToClass(deckId, b.dataset.class); ov.remove(); };
  });
  ov.querySelector('#unassign-btn').onclick = () => { assignDeckToClass(deckId, null); ov.remove(); };
  ov.querySelector('#assign-cancel').onclick = () => ov.remove();
}

function assignDeckToClass(deckId, classId) {
  const decks = getDecks();
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;
  if (classId) {
    deck.classId = classId;
    const cls = getClasses().find(c => c.id === classId);
    if (cls) deck.color = cls.color;
    _toast?.('Assigned to ' + (cls ? cls.name : 'class'));
  } else {
    delete deck.classId;
    const idx = decks.indexOf(deck);
    deck.color = DECK_COLORS[idx % DECK_COLORS.length];
    _toast?.('Removed from class');
  }
  saveDecks(decks);
  supaSaveDeck(deck);
  _refreshAll?.();
}

// ── Create class ──
export function openCreateClassModal() {
  const colors = ['#ff3f6c','#ffc94a','#00e5a0','#38b2ff','#b57bee','#ff8c42','#06d6a0','#ef476f'];
  const swatches = colors.map(c =>
    `<span id="sw-${c.replace('#','')}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:2px solid transparent;transition:all 0.15s;" onclick="window._selectClassColor('${c}')"></span>`
  ).join('');
  const ov = makeModal('create-class-modal');
  ov.innerHTML = `
    <div class="modal-box">
      <h2>🎓 New Class</h2>
      <p>Create a new class to organize your decks</p>
      <label>Class Name</label>
      <input type="text" id="new-class-name" placeholder="e.g. Biology 101" />
      <label style="margin-top:1rem;">Color</label>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">${swatches}</div>
      <input type="hidden" id="new-class-color" value="#ff3f6c" />
      <div id="create-class-err" style="font-size:0.78rem;color:var(--accent);margin-bottom:0.8rem;display:none;"></div>
      <div style="display:flex;gap:0.8rem;">
        <button class="btn btn-primary" id="create-class-confirm">Create Class</button>
        <button class="btn btn-ghost" id="create-class-cancel">Cancel</button>
      </div>
    </div>`;
  window._selectClassColor = selectClassColor;
  ov.querySelector('#create-class-confirm').onclick = confirmCreateClass;
  ov.querySelector('#create-class-cancel').onclick = () => ov.remove();
}

function selectClassColor(color) {
  document.querySelectorAll('#create-class-modal [id^="sw-"]').forEach(s => s.style.borderColor = 'transparent');
  const sw = document.getElementById('sw-' + color.replace('#',''));
  if (sw) sw.style.borderColor = '#fff';
  const inp = document.getElementById('new-class-color');
  if (inp) inp.value = color;
}

function confirmCreateClass() {
  const nameEl = document.getElementById('new-class-name');
  const colorEl = document.getElementById('new-class-color');
  const errEl = document.getElementById('create-class-err');
  const name = nameEl?.value.trim();
  if (!name) { if (errEl) { errEl.textContent = 'Enter a class name'; errEl.style.display = 'block'; } return; }
  const color = colorEl?.value || '#ff3f6c';
  const classes = getClasses();
  const newCls = { id: 'cls-' + Date.now(), name, color };
  classes.push(newCls);
  saveClasses(classes);
  _refreshAll?.();
  _toast?.('Class "' + name + '" created');
  const modal = document.getElementById('create-class-modal');
  if (modal) modal.remove();
}

// ── Class menu (rename/delete class) ──
export function openClassMenu(classId) {
  const cls = getClasses().find(c => c.id === classId);
  if (!cls) return;
  const ov = makeModal('class-menu-modal');
  ov.innerHTML = `
    <div class="modal-box">
      <h2 style="color:${cls.color};">⚙️ ${cls.name}</h2>
      <label style="margin-top:1rem;">Rename</label>
      <input type="text" id="rename-class-input" value="${cls.name}" style="margin-bottom:0.8rem;" />
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" id="rename-class-btn">Rename</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--accent);border-color:var(--accent);" id="delete-class-btn">🗑️ Delete Class</button>
        <button class="btn btn-ghost btn-sm" id="class-menu-close">Close</button>
      </div>
    </div>`;
  ov.querySelector('#rename-class-btn').onclick = () => confirmRenameClass(classId);
  ov.querySelector('#delete-class-btn').onclick = () => { if (confirm('Delete this class? Decks won\'t be deleted.')) confirmDeleteClass(classId); };
  ov.querySelector('#class-menu-close').onclick = () => ov.remove();
}

function confirmRenameClass(classId) {
  const inp = document.getElementById('rename-class-input');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) return;
  const classes = getClasses();
  const cls = classes.find(c => c.id === classId);
  if (cls) {
    cls.name = name;
    saveClasses(classes);
    _refreshAll?.();
    _toast?.('Class renamed');
  }
  const modal = document.getElementById('class-menu-modal');
  if (modal) modal.remove();
}

function confirmDeleteClass(classId) {
  const classes = getClasses().filter(c => c.id !== classId);
  saveClasses(classes);
  // Unassign decks from this class
  const decks = getDecks();
  decks.forEach(d => { if (d.classId === classId) delete d.classId; });
  saveDecks(decks);
  _refreshAll?.();
  _toast?.('Class deleted');
  const modal = document.getElementById('class-menu-modal');
  if (modal) modal.remove();
}
