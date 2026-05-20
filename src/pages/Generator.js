// Generator.js — quiz builder page: prompt generation, API calls, JSON import, file uploads

import { KEYS, DECK_COLORS } from '../config.js';
import { getDecks, saveDecks, getDeckColor } from '../engine/decks.js';
import { getClasses, saveClasses } from '../engine/classes.js';
import { supaSaveDeck } from '../engine/storage.js';

let _toast, _nav, _refreshAll;
export function initGeneratorCallbacks({ toast, nav, refreshAll }) {
  _toast = toast; _nav = nav; _refreshAll = refreshAll;
}

// ── Module state ──
export let currentMethod = 'claudeai';
export let attachedFiles = [];
export let generatedQuestions = [];
export let generatedDeckMeta = {};

/* ══════════════════════════════════════════════════════════════
   METHOD / TAB SWITCHING
   ══════════════════════════════════════════════════════════ */

export function switchMethod(method) {
  currentMethod = method;
  document.querySelectorAll('.method-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.method === method);
  });

  const claudeBtns = document.getElementById('method-claudeai-btns');
  const apiBtns = document.getElementById('method-api-btns');
  const workflow = document.getElementById('claudeai-workflow');
  const importCard = document.getElementById('json-import-card');

  if (claudeBtns) claudeBtns.style.display = method === 'claudeai' ? '' : 'none';
  if (apiBtns) apiBtns.style.display = method === 'api' ? '' : 'none';
  if (workflow) workflow.style.display = method === 'claudeai' ? '' : 'none';
  // Import card always visible for claudeai, hidden for api unless we need fallback
  if (importCard) importCard.style.display = method === 'claudeai' ? '' : 'none';

  if (method === 'api') updateKeyBadge();
}

export function switchTab(tab) {
  document.querySelectorAll('.source-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  const tabNotes = document.getElementById('tab-notes');
  const tabFiles = document.getElementById('tab-files');
  if (tabNotes) tabNotes.style.display = tab === 'notes' ? '' : 'none';
  if (tabFiles) tabFiles.style.display = tab === 'files' ? '' : 'none';
}

/* ══════════════════════════════════════════════════════════════
   PROMPT BUILDING
   ══════════════════════════════════════════════════════════ */

export function buildPromptText(notesText, count, instructionsText = '') {
  const deckName = document.getElementById('gen-name')?.value?.trim() || 'Study Deck';
  const instr    = instructionsText.trim();
  const instrBlock = instr ? `\n<special_instructions>\n${instr}\nThese instructions take priority where they conflict with the defaults above. Follow them precisely.\n</special_instructions>\n` : '';
  const studyMaterial = notesText.trim() || '(see attached files above)';

  return `<role>
You are an expert exam writer with 15 years of experience writing multiple-choice assessments for college courses. You write questions that test genuine understanding, not pattern recognition. Your distractors are plausible to a student who partially understands the material. Your correct answers are never identifiable by length, specificity, or phrasing alone.
</role>

<task>
Generate EXACTLY ${count} multiple-choice questions for a study deck called "${deckName}" from the material below.
Output ONLY a raw JSON array — no explanation, no markdown fences, no text before or after.
The first character of your response must be [ and the last must be ].
</task>

<critical_rules>
ANSWER POSITION — Before writing each question, mentally commit to a random position (0, 1, 2, or 3) as the correct answer slot. Write the options so the correct answer falls in that slot. Across all ${count} questions, correct answers must be distributed roughly equally across positions 0, 1, 2, and 3. Never default to position 1.

ANSWER LENGTH — All four options in a question must be within 5 words of each other in length. If your correct answer runs 10 words, every distractor must run 5–15 words. Never make the correct answer more detailed, more specific, or more qualified than the distractors.

DISTRACTOR QUALITY — Each wrong answer must be plausible to a student who partially knows the topic. Use specific terms, numbers, and concepts from the material in distractors. Never use "all of the above" or "none of the above."

COVERAGE — Spread questions across all major topics in the material. No single section should account for more than 30% of questions.
</critical_rules>

<output_format>
Each question object must have exactly these fields:
{
  "q": "Question text ending with a question mark?",
  "cat": "Short Topic Label",
  "opts": ["Option A", "Option B", "Option C", "Option D"],
  "ans": 2,
  "explain": "One sentence explaining why the correct answer is right."
}
"ans" is the 0-based index of the correct answer in "opts" — must be a NUMBER (0, 1, 2, or 3).
</output_format>

<examples>
GOOD — all four options at similar length, correct answer not identifiable by detail:
{
  "q": "What does the Federal Reserve primarily adjust to control inflation?",
  "opts": [
    "The federal funds interest rate target",
    "The maximum price ceiling on groceries",
    "The annual federal government deficit limit",
    "The reserve requirement for commercial banks"
  ],
  "ans": 0,
  "explain": "The Fed raises the federal funds rate to raise borrowing costs, reducing spending and cooling inflation."
}

BAD — correct answer is obviously longer and more detailed than the distractors:
{
  "q": "What causes inflation?",
  "opts": [
    "Too much money",
    "High taxes",
    "When the supply of money in an economy grows faster than the production of goods and services, causing prices to rise across the board",
    "Government spending"
  ],
  "ans": 2
}
</examples>

<thinking>
Before writing questions:
1. List the 4–6 main topics in the study material
2. Decide how many questions per topic to reach exactly ${count} total
3. For each question: commit to a random correct-answer position BEFORE writing any options, then write all four options at roughly equal length
</thinking>
${instrBlock}---
STUDY MATERIAL:
${studyMaterial}`;
}

/* ══════════════════════════════════════════════════════════════
   CLAUDE.AI WORKFLOW (copy prompt, import JSON)
   ══════════════════════════════════════════════════════════ */

export function copyPromptForClaude() {
  const notesText = getNotesText();
  const count = parseInt(document.getElementById('gen-count')?.value) || 20;

  if (!notesText || notesText.length < 20) {
    if (_toast) _toast('Please enter some study notes first');
    return;
  }

  const prompt = buildPromptText(notesText, count, getInstructionsText());

  // Check for attached files that need special handling
  const imageFiles = attachedFiles.filter(f => f.type.startsWith('image/'));
  const pdfFiles = attachedFiles.filter(f => f.type === 'application/pdf');

  if (imageFiles.length > 0 || pdfFiles.length > 0) {
    showFileUploadInstructions(imageFiles, pdfFiles, notesText, document.getElementById('gen-name')?.value?.trim() || 'Study Deck', count);
    return;
  }

  navigator.clipboard.writeText(prompt).then(() => {
    if (_toast) _toast('Prompt copied! Paste it into Claude.ai');
  }).catch(() => {
    showPromptModal(prompt);
  });
}

export function showPromptModal(promptText) {
  let modal = document.getElementById('prompt-copy-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'prompt-copy-modal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-box" style="max-width:600px;">
      <h2>Copy This Prompt</h2>
      <p style="font-size:0.82rem;color:var(--muted);margin-bottom:1rem;">Clipboard access was blocked. Please select all text below and copy manually (Ctrl+A, Ctrl+C).</p>
      <textarea id="prompt-text-area" style="min-height:200px;font-family:monospace;font-size:0.75rem;line-height:1.5;" readonly>${promptText}</textarea>
      <div style="display:flex;gap:0.8rem;margin-top:1rem;">
        <button class="btn btn-primary" id="prompt-select-all">Select All & Copy</button>
        <button class="btn btn-ghost" id="prompt-close">Close</button>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  document.getElementById('prompt-select-all').onclick = () => {
    const ta = document.getElementById('prompt-text-area');
    ta.select();
    document.execCommand('copy');
    if (_toast) _toast('Copied!');
  };
  document.getElementById('prompt-close').onclick = () => { modal.style.display = 'none'; };
}

export function showFileUploadInstructions(imageFiles, pdfFiles, notesText, deckName, count) {
  let modal = document.getElementById('file-instructions-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'file-instructions-modal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }

  const fileNames = attachedFiles.map(f => f.name).join(', ');

  modal.innerHTML = `
    <div class="modal-box" style="max-width:550px;">
      <h2>\uD83D\uDCCE Upload Files to Claude.ai</h2>
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:1rem;">Since you attached files, here's your workflow:</p>
      <div class="workflow-steps">
        <div class="wf-step">
          <div class="wf-num">1</div>
          <div class="wf-text">Open <a href="https://claude.ai" target="_blank" style="color:var(--blue);">claude.ai</a> and start a new chat</div>
        </div>
        <div class="wf-step">
          <div class="wf-num">2</div>
          <div class="wf-text"><strong>Upload your files</strong> using the attachment button: <em>${fileNames}</em></div>
        </div>
        <div class="wf-step">
          <div class="wf-num">3</div>
          <div class="wf-text">Paste the prompt below along with your files and send</div>
        </div>
        <div class="wf-step">
          <div class="wf-num">4</div>
          <div class="wf-text">Copy Claude's JSON response and import it here</div>
        </div>
      </div>
      <div style="margin-top:1rem;">
        <button class="btn btn-primary" id="fu-copy-prompt" style="width:100%;justify-content:center;">\uD83D\uDCCB Copy Prompt</button>
      </div>
      <div style="display:flex;gap:0.8rem;margin-top:0.8rem;">
        <button class="btn btn-ghost" id="fu-close">Close</button>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  const prompt = buildPromptText(notesText || '(see attached files)', count, getInstructionsText());
  document.getElementById('fu-copy-prompt').onclick = () => {
    navigator.clipboard.writeText(prompt).then(() => {
      if (_toast) _toast('Prompt copied!');
    }).catch(() => {
      showPromptModal(prompt);
    });
  };
  document.getElementById('fu-close').onclick = () => { modal.style.display = 'none'; };
}

/* ══════════════════════════════════════════════════════════════
   ANSWER SHUFFLE
   Randomises which slot holds the correct answer so Claude's
   systematic bias toward position 1 (B) is neutralised at import.
   ══════════════════════════════════════════════════════════ */

function shuffleAnswerPositions(question) {
  const numOpts = question.opts.length;
  const indices = Array.from({ length: numOpts }, (_, i) => i);

  // Fisher-Yates in-place shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  // newOpts[i] = original opts at indices[i]
  const newOpts = indices.map(i => question.opts[i]);
  // The correct answer moved from question.ans to wherever indices[?] === question.ans
  const newAns  = indices.indexOf(question.ans);

  return { ...question, opts: newOpts, ans: newAns };
}

/* ══════════════════════════════════════════════════════════════
   JSON IMPORT
   ══════════════════════════════════════════════════════════ */

export function importFromJson() {
  const box = document.getElementById('json-import-box');
  const statusEl = document.getElementById('import-status');
  if (!box) return;

  let raw = box.value.trim();
  if (!raw) {
    showImportStatus('Paste Claude\'s JSON response first', 'var(--accent)');
    return;
  }

  // Strip markdown code fences if present
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Try to find JSON array in the text
  const arrStart = raw.indexOf('[');
  const arrEnd = raw.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    raw = raw.substring(arrStart, arrEnd + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    showImportStatus('Invalid JSON \u2014 make sure you copied the full response', 'var(--accent)');
    return;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    showImportStatus('Expected a JSON array of questions', 'var(--accent)');
    return;
  }

  // Validate and normalize questions
  const valid = [];
  parsed.forEach((item, i) => {
    if (!item.q || !item.opts || !Array.isArray(item.opts) || item.opts.length < 2) return;
    // Ensure 4 options
    while (item.opts.length < 4) item.opts.push('(no option)');
    if (item.opts.length > 4) item.opts = item.opts.slice(0, 4);
    // Normalize ans
    let ans = parseInt(item.ans);
    if (isNaN(ans) || ans < 0 || ans > 3) ans = 0;

    valid.push({
      id: 'gen-' + Date.now() + '-' + i,
      q: String(item.q),
      cat: String(item.cat || 'General'),
      opts: item.opts.map(o => String(o)),
      ans: ans,
      explain: String(item.explain || '')
    });
  });

  if (valid.length === 0) {
    showImportStatus('No valid questions found in the JSON', 'var(--accent)');
    return;
  }

  generatedQuestions = valid.map(shuffleAnswerPositions);
  generatedDeckMeta = {
    name: document.getElementById('gen-name')?.value?.trim() || 'Imported Deck',
  };

  showImportStatus(`\u2713 ${valid.length} questions imported successfully!`, 'var(--green)');
  renderPreview();
}

function showImportStatus(msg, color) {
  const el = document.getElementById('import-status');
  if (el) {
    el.style.display = '';
    el.style.color = color || 'var(--muted)';
    el.textContent = msg;
  }
}

export function clearImport() {
  const box = document.getElementById('json-import-box');
  if (box) box.value = '';
  const statusEl = document.getElementById('import-status');
  if (statusEl) statusEl.style.display = 'none';
  generatedQuestions = [];
  const previewCard = document.getElementById('preview-card');
  if (previewCard) previewCard.style.display = 'none';
  const saveBtn = document.getElementById('gen-save-btn');
  if (saveBtn) saveBtn.style.display = 'none';
}

/* ══════════════════════════════════════════════════════════════
   FILE UPLOAD / DROP ZONE
   ══════════════════════════════════════════════════════════ */

export function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  if (!zone) return;

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  zone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') {
      document.getElementById('file-input')?.click();
    }
  });
}

export function handleFiles(fileList) {
  const maxFiles = 25;
  const maxSize = 50 * 1024 * 1024; // 50MB
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf'];

  Array.from(fileList).forEach(file => {
    if (attachedFiles.length >= maxFiles) {
      if (_toast) _toast('Maximum 25 files allowed');
      return;
    }
    if (file.size > maxSize) {
      if (_toast) _toast(`${file.name} exceeds 50 MB limit`);
      return;
    }
    if (!allowedTypes.some(t => file.type.startsWith(t.split('/')[0]) || file.type === t)) {
      if (_toast) _toast(`${file.name}: unsupported file type`);
      return;
    }
    // Check for duplicate
    if (attachedFiles.find(f => f.name === file.name)) return;

    const reader = new FileReader();
    reader.onload = () => {
      attachedFiles.push({
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result
      });
      renderFileList();
    };
    reader.readAsDataURL(file);
  });
}

export function removeFile(name) {
  attachedFiles = attachedFiles.filter(f => f.name !== name);
  renderFileList();
}

export function renderFileList() {
  const listEl = document.getElementById('file-list');
  const itemsEl = document.getElementById('file-items');
  const textArea = document.getElementById('file-text-area');

  if (!listEl || !itemsEl) return;

  if (attachedFiles.length === 0) {
    listEl.style.display = 'none';
    if (textArea) textArea.style.display = 'none';
    return;
  }

  listEl.style.display = '';
  listEl.style.maxHeight = '320px';
  listEl.style.overflowY = 'auto';
  if (textArea) textArea.style.display = '';
  itemsEl.innerHTML = '';

  attachedFiles.forEach(file => {
    const sizeStr = file.size < 1024 ? file.size + ' B'
      : file.size < 1024 * 1024 ? (file.size / 1024).toFixed(1) + ' KB'
      : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    const icon = file.type === 'application/pdf' ? '\uD83D\uDCC4' : '\uD83D\uDDBC\uFE0F';

    const needsCompress = file.type.startsWith('image/') && file.size > 5 * 1024 * 1024;
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.7rem;background:rgba(255,255,255,0.03);border-radius:var(--radius);';
    item.innerHTML = `
      <span style="font-size:1.1rem;">${icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${file.name}</div>
        <div style="font-size:0.68rem;color:var(--muted);">${sizeStr}${needsCompress ? ' &nbsp;<span style="color:#ffc94a;font-size:0.65rem;">&#9889; will compress</span>' : ''}</div>
      </div>
      <button class="btn btn-ghost btn-sm file-remove-btn" style="padding:0.2rem 0.5rem;font-size:0.75rem;">\u2715</button>
    `;
    item.querySelector('.file-remove-btn').onclick = () => removeFile(file.name);
    itemsEl.appendChild(item);
  });
}

/* ══════════════════════════════════════════════════════════════
   API KEY MANAGEMENT
   ══════════════════════════════════════════════════════════ */

export function getApiKey() {
  try { return localStorage.getItem(KEYS.apiKey) || ''; } catch (e) { return ''; }
}

export function storeApiKey(k) {
  try { localStorage.setItem(KEYS.apiKey, k); } catch (e) {}
}

function maskKey(key) {
  if (!key || key.length < 8) return '••••••••';
  return 'sk-ant-' + '•'.repeat(20) + key.slice(-4);
}

export function openApiModal() {
  const modal = document.getElementById('api-modal');
  if (!modal) return;
  const existingKey = getApiKey();
  const hasKey = !!existingKey;
  const box = modal.querySelector('.modal-box');
  if (hasKey) {
    box.innerHTML = `
      <h2>🔑 API Key Connected</h2>
      <p>Your Claude API key is saved. Paste a new key below to replace it, or remove it entirely.</p>
      <label>Current Key</label>
      <div style="font-family:monospace;font-size:0.82rem;color:var(--green);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.6rem 1rem;margin-bottom:1rem;">${maskKey(existingKey)}</div>
      <label>Replace Key</label>
      <div class="api-key-row">
        <input type="password" id="api-key-input" placeholder="Paste new key to replace..." autocomplete="off" onkeydown="if(event.key==='Enter')saveApiKey()">
        <button class="btn btn-ghost btn-sm" onclick="toggleKeyVis()" id="key-vis-btn" style="flex-shrink:0;">Show</button>
      </div>
      <div style="display:flex;gap:0.8rem;flex-wrap:wrap;margin-top:1rem;">
        <button class="btn btn-primary" onclick="saveApiKey()">Save New Key</button>
        <button class="btn btn-ghost" style="color:var(--accent);border-color:var(--accent);" onclick="removeApiKey()">Remove Key</button>
        <button class="btn btn-ghost" onclick="closeApiModal()">Cancel</button>
      </div>`;
  } else {
    box.innerHTML = `
      <h2>🔑 Connect to Claude</h2>
      <p>StudyBlitz uses the Claude API to generate quiz questions from your notes and files. You need a free Anthropic API key to use the Quiz Builder.</p>
      <div class="api-steps">
        <span><b>1</b> Go to <a href="https://console.anthropic.com" target="_blank" style="color:var(--blue);">console.anthropic.com</a> and sign up free</span>
        <span><b>2</b> Click <strong>API Keys</strong> in the left sidebar → <strong>Create Key</strong></span>
        <span><b>3</b> Copy your key (starts with <code style="color:var(--gold);font-size:0.8rem;">sk-ant-</code>) and paste it below</span>
      </div>
      <label>Your API Key</label>
      <div class="api-key-row">
        <input type="password" id="api-key-input" placeholder="sk-ant-api03-..." autocomplete="off" onkeydown="if(event.key==='Enter')saveApiKey()">
        <button class="btn btn-ghost btn-sm" onclick="toggleKeyVis()" id="key-vis-btn" style="flex-shrink:0;">Show</button>
      </div>
      <div class="modal-note" style="margin-bottom:1.2rem;">
        🔒 Your key is stored only in <strong>this browser's localStorage</strong> — it never leaves your device except to call Anthropic's API directly.<br>
        New users get free credits. Pricing: ~$0.003 per quiz deck generated. <a href="https://www.anthropic.com/pricing" target="_blank">See pricing →</a>
      </div>
      <div style="display:flex;gap:0.8rem;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="saveApiKey()">Save Key & Continue</button>
        <button class="btn btn-ghost" onclick="closeApiModal()">Cancel</button>
      </div>`;
  }
  modal.style.display = 'flex';
}

export function removeApiKey() {
  try { localStorage.removeItem(KEYS.apiKey); } catch (e) {}
  closeApiModal();
  updateKeyBadge();
  if (_toast) _toast('🗑️ API key removed');
}

export function closeApiModal() {
  const modal = document.getElementById('api-modal');
  if (modal) modal.style.display = 'none';
}

export function toggleKeyVis() {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('key-vis-btn');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = 'Show';
  }
}

export function saveApiKey() {
  const input = document.getElementById('api-key-input');
  if (!input) return;
  const key = input.value.trim();
  if (!key) {
    if (_toast) _toast('Please enter your API key');
    return;
  }
  storeApiKey(key);
  closeApiModal();
  updateKeyBadge();
  if (_toast) _toast('✅ API key saved');
}

export function updateKeyBadge() {
  const badge = document.getElementById('api-key-badge');
  if (!badge) return;
  const hasKey = !!getApiKey();
  badge.className = 'key-badge ' + (hasKey ? 'connected' : 'missing');
  badge.innerHTML = hasKey ? '\uD83D\uDD11 Connected' : '\uD83D\uDD11 Add Key';
}

/* ══════════════════════════════════════════════════════════════
   IMAGE COMPRESSION
   Guarantees output is under Anthropic’s 5 MB per-image limit.
   Fully async with requestAnimationFrame yields so the browser
   repaints between attempts — enabling the live compression modal.
   ════════════════════════════════════════════════════════ */

async function compressImage(dataUrl, mediaType, onProgress) {
  const API_MAX = 4.75 * 1024 * 1024;
  const MAX_DIM  = 2048;

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  }).catch(() => null);

  if (!img) return { data: dataUrl.split(',')[1], media_type: 'image/jpeg' };

  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > MAX_DIM || h > MAX_DIM) {
    const scale = MAX_DIM / Math.max(w, h);
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
  }

  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');
  let quality  = 0.85;

  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise(r => requestAnimationFrame(r)); // yield so modal can repaint

    canvas.width  = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const out   = canvas.toDataURL('image/jpeg', quality);
    const b64   = out.split(',')[1];
    const bytes = Math.ceil(b64.length * 3 / 4);

    if (onProgress) onProgress({ attempt, quality, w, h, bytes, done: bytes <= API_MAX, previewUrl: out });
    if (bytes <= API_MAX) return { data: b64, media_type: 'image/jpeg' };

    if (quality > 0.35) {
      quality = Math.max(0.35, quality - 0.15);
    } else {
      const shrink = Math.sqrt(API_MAX / bytes) * 0.95;
      w = Math.max(1, Math.floor(w * shrink));
      h = Math.max(1, Math.floor(h * shrink));
      quality = 0.55;
    }
  }

  // Absolute fallback
  await new Promise(r => requestAnimationFrame(r));
  canvas.width = w; canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  const fbOut = canvas.toDataURL('image/jpeg', 0.3);
  const fbB64 = fbOut.split(',')[1];
  if (onProgress) onProgress({ attempt: 12, quality: 0.3, w, h, bytes: Math.ceil(fbB64.length * 3 / 4), done: true, previewUrl: fbOut });
  return { data: fbB64, media_type: 'image/jpeg' };
}

/* ══════════════════════════════════════════════════════════════
   COMPRESSION LIVE-VIEW MODAL
   Real-time canvas preview + stats while images are compressed.
   ════════════════════════════════════════════════════════ */

function openCompressionModal() {
  let modal = document.getElementById('sb-compress-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sb-compress-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '9999';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-box" style="max-width:500px;text-align:center;">
      <div style="font-size:1.1rem;font-weight:800;letter-spacing:0.03em;margin-bottom:0.15rem;">⚙️ Compressing Image</div>
      <div id="sbcm-filename" style="font-size:0.75rem;color:var(--muted);margin-bottom:1rem;min-height:1em;"></div>
      <div style="display:flex;gap:1rem;align-items:flex-start;margin-bottom:1rem;">
        <div style="flex:1.2;background:#0d0d18;border-radius:8px;overflow:hidden;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.07);">
          <img id="sbcm-preview" style="max-width:100%;max-height:100%;object-fit:contain;display:block;" alt="preview" />
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:0.55rem;font-size:0.78rem;text-align:left;">
          <div>
            <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.1rem;">Original</div>
            <div id="sbcm-original" style="font-weight:700;color:var(--accent);">-</div>
          </div>
          <div>
            <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.1rem;">Current size</div>
            <div id="sbcm-current" style="font-weight:700;">-</div>
          </div>
          <div>
            <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.1rem;">Target</div>
            <div style="font-weight:700;color:var(--green);">&lt; 4.75 MB</div>
          </div>
          <div>
            <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.1rem;">Quality</div>
            <div id="sbcm-quality" style="font-weight:700;">-</div>
          </div>
          <div>
            <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.1rem;">Dimensions</div>
            <div id="sbcm-dims" style="font-weight:700;">-</div>
          </div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.7rem;text-align:left;">
        <div id="sbcm-status" style="font-size:0.77rem;color:var(--muted);margin-bottom:0.45rem;">Initialising…</div>
        <div style="background:rgba(255,255,255,0.08);border-radius:4px;height:5px;overflow:hidden;">
          <div id="sbcm-bar" style="height:100%;width:0%;border-radius:4px;transition:width 0.18s,background 0.3s;background:linear-gradient(90deg,var(--blue),var(--gold));"></div>
        </div>
      </div>
      <div id="sbcm-file-prog" style="font-size:0.7rem;color:var(--muted);"></div>
    </div>`;
  modal.style.display = 'flex';
}

function updateCompressionModal(filename, originalBytes, prog, fileIdx, totalImages) {
  const fmt = b => b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(2) + ' MB' : (b / 1024).toFixed(0) + ' KB';
  const g   = id => document.getElementById(id);
  if (g('sbcm-filename')) g('sbcm-filename').textContent = filename;
  if (g('sbcm-original')) g('sbcm-original').textContent = fmt(originalBytes);
  if (g('sbcm-current'))  {
    g('sbcm-current').textContent  = fmt(prog.bytes);
    g('sbcm-current').style.color  = prog.done ? 'var(--green)' : (prog.bytes <= 4.75 * 1024 * 1024 ? 'var(--green)' : 'var(--gold)');
  }
  if (g('sbcm-quality'))  g('sbcm-quality').textContent  = Math.round(prog.quality * 100) + '%';
  if (g('sbcm-dims'))     g('sbcm-dims').textContent     = prog.w + ' × ' + prog.h + ' px';
  if (g('sbcm-status'))   g('sbcm-status').textContent   = prog.done
    ? '✓ Done — ' + fmt(originalBytes) + ' → ' + fmt(prog.bytes)
    : 'Attempt ' + (prog.attempt + 1) + ' · ' + fmt(prog.bytes) + ' — still compressing…';
  if (g('sbcm-bar')) {
    g('sbcm-bar').style.width      = (prog.done ? 100 : Math.min(93, (prog.attempt / 12) * 100)) + '%';
    g('sbcm-bar').style.background = prog.done ? 'var(--green)' : 'linear-gradient(90deg,var(--blue),var(--gold))';
  }
  if (g('sbcm-preview') && prog.previewUrl) g('sbcm-preview').src = prog.previewUrl;
  if (g('sbcm-file-prog')) g('sbcm-file-prog').textContent = 'Image ' + fileIdx + ' of ' + totalImages;
}

function closeCompressionModal() {
  const m = document.getElementById('sb-compress-modal');
  if (!m) return;
  const bar = document.getElementById('sbcm-bar');
  if (bar) { bar.style.width = '100%'; bar.style.background = 'var(--green)'; }
  setTimeout(() => { if (m) m.style.display = 'none'; }, 700);
}


/* ══════════════════════════════════════════════════════════════
   DIRECT API GENERATION
   ══════════════════════════════════════════════════════════ */

export async function generateDeck() {
  const apiKey = getApiKey();
  if (!apiKey) {
    openApiModal();
    return;
  }

  const notesText = getNotesText();
  const count = parseInt(document.getElementById('gen-count')?.value) || 20;
  const deckName = document.getElementById('gen-name')?.value?.trim() || 'Generated Deck';

  const hasFiles = attachedFiles.length > 0;
  if (!hasFiles && (!notesText || notesText.length < 20)) {
    if (_toast) _toast('Please enter some study notes or attach at least one file');
    return;
  }

  // Show status
  const statusEl = document.getElementById('gen-status');
  const statusText = document.getElementById('gen-status-text');
  const genBtn = document.getElementById('gen-btn');
  if (statusEl) statusEl.style.display = 'flex';
  if (statusText) statusText.textContent = 'Generating quiz questions...';
  if (genBtn) genBtn.disabled = true;

  const prompt = buildPromptText(notesText, count, getInstructionsText());

  // Build messages array
  const messages = [{ role: 'user', content: [] }];

  // Attach files — compress images (with live modal for large ones), include PDFs
  const imageFiles  = attachedFiles.filter(f => f.type.startsWith('image/'));
  const largeImages = imageFiles.filter(f => f.size > 5 * 1024 * 1024);
  if (largeImages.length > 0) openCompressionModal();

  let imgIdx = 0;
  for (const f of attachedFiles) {
    if (f.type.startsWith('image/')) {
      imgIdx++;
      if (statusText) statusText.textContent = `Compressing ${f.name}…`;
      const onProg = largeImages.length > 0
        ? p => updateCompressionModal(f.name, f.size, p, imgIdx, imageFiles.length)
        : null;
      const compressed = await compressImage(f.data, f.type, onProg);
      messages[0].content.push({
        type: 'image',
        source: { type: 'base64', media_type: compressed.media_type, data: compressed.data }
      });
    } else if (f.type === 'application/pdf') {
      const pdfBytes = Math.ceil((f.data.split(',')[1] || '').length * 3 / 4);
      if (pdfBytes > 30 * 1024 * 1024) {
        if (_toast) _toast(`${f.name} is over 30 MB — Anthropic may reject it. Try a smaller PDF.`);
      }
      const base64 = f.data.split(',')[1];
      messages[0].content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 }
      });
    }
  }
  if (largeImages.length > 0) closeCompressionModal();
  if (statusText) statusText.textContent = 'Calling Claude API…';

  messages[0].content.push({ type: 'text', text: prompt });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: 'You are an expert exam writer. Follow these rules strictly: (1) Distribute correct answers evenly across positions 0, 1, 2, and 3 — never default to position 1. (2) Write all four options at similar length — the correct answer must not be longer, more detailed, or more qualified than the distractors. (3) Make distractors plausible to a student who partially understands the material — never use vague filler options.',
        messages: messages
      })
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`API error ${resp.status}: ${errBody}`);
    }

    const data = await resp.json();
    const textBlock = data.content?.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text in API response');

    // Parse JSON from response
    let raw = textBlock.text.trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const arrStart = raw.indexOf('[');
    const arrEnd = raw.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      raw = raw.substring(arrStart, arrEnd + 1);
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid response format');

    // Normalize questions
    const valid = [];
    parsed.forEach((item, i) => {
      if (!item.q || !item.opts || !Array.isArray(item.opts)) return;
      while (item.opts.length < 4) item.opts.push('(no option)');
      if (item.opts.length > 4) item.opts = item.opts.slice(0, 4);
      let ans = parseInt(item.ans);
      if (isNaN(ans) || ans < 0 || ans > 3) ans = 0;

      valid.push({
        id: 'gen-' + Date.now() + '-' + i,
        q: String(item.q),
        cat: String(item.cat || 'General'),
        opts: item.opts.map(o => String(o)),
        ans: ans,
        explain: String(item.explain || '')
      });
    });

    if (valid.length === 0) throw new Error('No valid questions parsed from response');

    generatedQuestions = valid.map(shuffleAnswerPositions);
    generatedDeckMeta = { name: deckName };

    if (statusText) statusText.textContent = `\u2713 Generated ${valid.length} questions!`;
    setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 3000);

    renderPreview();

  } catch (err) {
    console.error('generateDeck error:', err);
    if (statusText) statusText.textContent = 'Error: ' + err.message;
    if (statusEl) statusEl.style.display = 'flex';
    if (_toast) _toast('Generation failed \u2014 check console for details');
  } finally {
    if (genBtn) genBtn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════════
   PREVIEW RENDERING
   ══════════════════════════════════════════════════════════ */

function renderPreview() {
  const previewCard = document.getElementById('preview-card');
  const previewBox = document.getElementById('gen-preview');
  const previewCount = document.getElementById('preview-count');
  const saveBtn = document.getElementById('gen-save-btn');

  if (!previewCard || !previewBox) return;

  previewCard.style.display = '';
  if (saveBtn) saveBtn.style.display = '';
  if (previewCount) previewCount.textContent = `${generatedQuestions.length} questions`;

  previewBox.innerHTML = '';

  generatedQuestions.forEach((q, i) => {
    const qDiv = document.createElement('div');
    qDiv.style.cssText = 'padding:0.8rem 0;border-bottom:1px solid var(--border);';
    const optLabels = ['A', 'B', 'C', 'D'];
    const optsHtml = q.opts.map((o, j) =>
      `<div style="font-size:0.78rem;color:${j === q.ans ? 'var(--green)' : 'var(--muted)'};padding:0.15rem 0;">${optLabels[j]}. ${o}${j === q.ans ? ' \u2713' : ''}</div>`
    ).join('');

    qDiv.innerHTML = `
      <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.2rem;">${q.cat} \u00B7 Q${i + 1}</div>
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;">${q.q}</div>
      ${optsHtml}
      ${q.explain ? `<div style="font-size:0.72rem;color:var(--blue);margin-top:0.3rem;font-style:italic;">${q.explain}</div>` : ''}
    `;
    previewBox.appendChild(qDiv);
  });
}

/* ══════════════════════════════════════════════════════════════
   SAVE DECK
   ══════════════════════════════════════════════════════════ */

export function saveDeck() {
  if (generatedQuestions.length === 0) {
    if (_toast) _toast('No questions to save');
    return;
  }

  const decks    = getDecks();
  const deckName = generatedDeckMeta.name || document.getElementById('gen-name')?.value?.trim() || 'New Deck';

  const newDeck = {
    id:        'deck-' + Date.now(),
    name:      deckName,
    subject:   deckName,
    color:     DECK_COLORS[decks.length % DECK_COLORS.length],
    created:   new Date().toISOString(),
    lastScore: null,
    questions: generatedQuestions
  };

  // Show class assignment modal BEFORE writing to storage
  openPreSaveClassModal(newDeck, (finalDeck) => {
    const latest = getDecks();
    latest.push(finalDeck);
    saveDecks(latest);
    supaSaveDeck(finalDeck);
    _resetGeneratorUI();
    // First user-created deck — graduate to returning-user dashboard
    const userDecks = getDecks().filter(d => !d.builtIn);
    if (userDecks.length === 1) {
      if (_toast) _toast('🎉 First deck saved! Welcome to StudyBlitz.');
      setTimeout(() => _nav?.('dashboard'), 1100);
      return;
    }
    if (_toast) _toast(`✓ "${finalDeck.name}" saved to library!`);
    if (_refreshAll) _refreshAll();
  });
}

function _resetGeneratorUI() {
  generatedQuestions = [];
  generatedDeckMeta  = {};
  const previewCard = document.getElementById('preview-card');
  const saveBtn     = document.getElementById('gen-save-btn');
  if (previewCard) previewCard.style.display = 'none';
  if (saveBtn)     saveBtn.style.display     = 'none';
  const nameEl    = document.getElementById('gen-name');
  const notesEl   = document.getElementById('gen-notes');
  const importBox = document.getElementById('json-import-box');
  if (nameEl)    nameEl.value    = '';
  if (notesEl)   notesEl.value   = '';
  if (importBox) importBox.value = '';
  const instrEl = document.getElementById('gen-instructions');
  if (instrEl)   instrEl.value   = '';
  attachedFiles = [];
  renderFileList();
  clearImport();
}

/* ══════════════════════════════════════════════════════════════
   QUESTION COUNT ADJUSTER
   ══════════════════════════════════════════════════════════ */

export function adjGenCount(d) {
  const el = document.getElementById('gen-count');
  if (!el) return;
  let c = parseInt(el.value) || 20;
  c += d;
  c = Math.max(5, Math.min(100, c));
  el.value = c;
}

/* ══════════════════════════════════════════════════════════════
   PRE-SAVE CLASS ASSIGNMENT MODAL
   ══════════════════════════════════════════════════════════ */

export function openPreSaveClassModal(deckData, onComplete) {
  let selectedClassId = null;
  let resolved        = false;

  const existing = document.getElementById('presave-class-modal');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id        = 'presave-class-modal';
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  document.body.appendChild(ov);

  const doSave = () => {
    if (resolved) return;
    resolved = true;
    if (selectedClassId) {
      const cls = getClasses().find(c => c.id === selectedClassId);
      if (cls) { deckData.classId = cls.id; deckData.color = cls.color; }
    }
    ov.remove();
    document.removeEventListener('keydown', _onEsc);
    onComplete(deckData);
  };

  const _onEsc = e => { if (e.key === 'Escape') doSave(); };
  document.addEventListener('keydown', _onEsc);
  ov.onclick = e => { if (e.target === ov) doSave(); };

  const renderPicker = () => {
    const classes = getClasses();
    const decks   = getDecks();

    const cards = classes.map(cls => {
      const n   = decks.filter(d => d.classId === cls.id).length;
      const sel = cls.id === selectedClassId;
      const bg  = sel ? cls.color + '14' : 'var(--surface)';
      const bdr = sel ? cls.color : 'var(--border)';
      return `<div class="psc-card" data-cid="${cls.id}"
        style="background:${bg};border:1.5px solid ${bdr};border-radius:10px;padding:0.75rem 0.9rem;cursor:pointer;transition:all 0.15s;position:relative;">
        ${sel ? `<span style="position:absolute;top:0.4rem;right:0.55rem;color:${cls.color};font-size:0.8rem;font-weight:700;">✓</span>` : ''}
        <div style="display:flex;align-items:center;gap:0.55rem;">
          <span style="width:10px;height:10px;border-radius:50%;background:${cls.color};flex-shrink:0;"></span>
          <span style="font-size:0.86rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cls.name}</span>
        </div>
        <div style="font-size:0.68rem;color:var(--muted);margin-top:0.2rem;padding-left:1.4rem;">${n} deck${n !== 1 ? 's' : ''}</div>
      </div>`;
    }).join('');

    const selCls  = classes.find(c => c.id === selectedClassId);
    const saveLbl = selCls ? `Save to ${selCls.name}` : 'Save to Class';
    const dis     = !selectedClassId;

    ov.innerHTML = `
      <div class="modal-box" style="max-width:480px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.25rem;">
          <h2 style="margin:0;">🎓 Assign to a Class</h2>
          <button class="btn btn-ghost" id="psc-x" style="padding:0.3rem 0.6rem;font-size:1rem;">✕</button>
        </div>
        <div style="font-size:0.82rem;color:var(--muted);margin-bottom:1.1rem;">${deckData.name}</div>

        ${classes.length === 0
          ? `<div style="text-align:center;padding:1.5rem 0 0.5rem;color:var(--muted);font-size:0.85rem;">No classes yet</div>`
          : `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.55rem;max-height:300px;overflow-y:auto;margin-bottom:0.9rem;">${cards}</div>`}

        <button class="btn btn-ghost btn-sm" id="psc-new"
          style="width:100%;justify-content:center;margin-bottom:1rem;">
          + Create New Class
        </button>

        <div style="display:flex;gap:0.8rem;flex-wrap:wrap;">
          <button class="btn btn-primary" id="psc-save"
            style="flex:1;justify-content:center;min-width:120px;${dis ? 'opacity:0.4;pointer-events:none;' : ''}"
            ${dis ? 'disabled' : ''}>${saveLbl}</button>
          <button class="btn btn-ghost" id="psc-skip" style="white-space:nowrap;">Skip for now</button>
        </div>
      </div>`;

    document.getElementById('psc-x').onclick    = () => doSave();
    document.getElementById('psc-skip').onclick = () => doSave();
    document.getElementById('psc-save').onclick = () => { if (selectedClassId) doSave(); };
    document.getElementById('psc-new').onclick  = () => renderCreateForm();

    ov.querySelectorAll('.psc-card').forEach(card => {
      card.onclick = () => { selectedClassId = card.dataset.cid; renderPicker(); };
    });
  };

  const renderCreateForm = () => {
    const COLS = ['#ff3f6c','#ffc94a','#00e5a0','#38b2ff','#b57bee','#ff8c42','#06d6a0','#ef476f'];
    let picked = COLS[0];

    const swatch = COLS.map(c =>
      `<span data-c="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;
        border:2.5px solid ${c === picked ? '#fff' : 'transparent'};transition:border-color 0.15s;"></span>`
    ).join('');

    ov.innerHTML = `
      <div class="modal-box" style="max-width:480px;">
        <div style="display:flex;align-items:center;gap:0.8rem;margin-bottom:1.2rem;">
          <button class="btn btn-ghost btn-sm" id="psc-back" style="padding:0.3rem 0.65rem;">← Back</button>
          <h2 style="margin:0;font-size:1rem;">New Class</h2>
        </div>
        <label class="lbl-s">Class Name</label>
        <input type="text" id="psc-cname" placeholder="e.g. Biology 101" style="margin-bottom:1rem;" />
        <label class="lbl-s">Color</label>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">${swatch}</div>
        <div id="psc-cerr" style="font-size:0.78rem;color:var(--accent);min-height:1rem;margin-bottom:0.7rem;"></div>
        <div style="display:flex;gap:0.8rem;">
          <button class="btn btn-primary" id="psc-ccreate">Create Class</button>
          <button class="btn btn-ghost"   id="psc-ccancel">Cancel</button>
        </div>
      </div>`;

    document.getElementById('psc-back').onclick    = () => renderPicker();
    document.getElementById('psc-ccancel').onclick = () => renderPicker();

    ov.querySelectorAll('[data-c]').forEach(sw => {
      sw.onclick = () => {
        picked = sw.dataset.c;
        ov.querySelectorAll('[data-c]').forEach(s => s.style.borderColor = 'transparent');
        sw.style.borderColor = '#fff';
      };
    });

    document.getElementById('psc-ccreate').onclick = () => {
      const name  = document.getElementById('psc-cname')?.value.trim();
      const errEl = document.getElementById('psc-cerr');
      if (!name) { errEl.textContent = 'Enter a class name'; return; }
      const classes = getClasses();
      const newCls  = { id: 'cls-' + Date.now(), name, color: picked };
      classes.push(newCls);
      saveClasses(classes);
      if (_refreshAll) _refreshAll();
      selectedClassId = newCls.id;
      renderPicker();
    };

    setTimeout(() => document.getElementById('psc-cname')?.focus(), 80);
  };

  renderPicker();
}

/* ══════════════════════════════════════════════════════════════
   CLASS ASSIGNMENT (legacy — kept for external callers)
   ══════════════════════════════════════════════════════════ */

export function promptClassAssignment(deckId) {
  window.dispatchEvent(new CustomEvent('sb-assign-class', { detail: { deckId } }));
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════ */

function getNotesText() {
  const notesEl = document.getElementById('gen-notes');
  const extraNotesEl = document.getElementById('gen-notes-extra');
  let text = notesEl?.value?.trim() || '';
  const extra = extraNotesEl?.value?.trim() || '';
  if (extra) text = text ? text + '\n\n' + extra : extra;
  return text;
}

function getInstructionsText() {
  return document.getElementById('gen-instructions')?.value?.trim() || '';
}
