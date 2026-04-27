// Generator.js — quiz builder page: prompt generation, API calls, JSON import, file uploads

import { KEYS, DECK_COLORS } from '../config.js';
import { getDecks, saveDecks, getDeckColor } from '../engine/decks.js';
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

export function buildPromptText(notesText, count) {
  const deckName = document.getElementById('gen-name')?.value?.trim() || 'Study Deck';
  return `You are a quiz question generator for a study app called StudyBlitz. Generate exactly ${count} multiple-choice quiz questions based on the study material below.

SUBJECT/DECK: ${deckName}

REQUIREMENTS:
- Each question must have exactly 4 answer options
- Questions should test understanding, not just memorization
- Include a mix of difficulty levels
- Cover the material comprehensively
- Provide a brief explanation for each correct answer
- Categorize each question by topic/subtopic

IMPORTANT: Respond with ONLY a valid JSON array (no markdown, no code fences, no extra text). Each object must have exactly these fields:
- "q" (string): the question text
- "cat" (string): category/topic
- "opts" (array of 4 strings): the answer options
- "ans" (number 0-3): index of the correct answer
- "explain" (string): brief explanation of the correct answer

STUDY MATERIAL:
${notesText}

Remember: Output ONLY the JSON array, nothing else.`;
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

  const prompt = buildPromptText(notesText, count);

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

  const prompt = buildPromptText(notesText || '(see attached files)', count);
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

  generatedQuestions = valid;
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
  const maxFiles = 5;
  const maxSize = 20 * 1024 * 1024; // 20MB
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf'];

  Array.from(fileList).forEach(file => {
    if (attachedFiles.length >= maxFiles) {
      if (_toast) _toast('Maximum 5 files allowed');
      return;
    }
    if (file.size > maxSize) {
      if (_toast) _toast(`${file.name} exceeds 20MB limit`);
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
  if (textArea) textArea.style.display = '';
  itemsEl.innerHTML = '';

  attachedFiles.forEach(file => {
    const sizeStr = file.size < 1024 ? file.size + ' B'
      : file.size < 1024 * 1024 ? (file.size / 1024).toFixed(1) + ' KB'
      : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    const icon = file.type === 'application/pdf' ? '\uD83D\uDCC4' : '\uD83D\uDDBC\uFE0F';

    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.7rem;background:rgba(255,255,255,0.03);border-radius:var(--radius);';
    item.innerHTML = `
      <span style="font-size:1.1rem;">${icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${file.name}</div>
        <div style="font-size:0.68rem;color:var(--muted);">${sizeStr}</div>
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

export function openApiModal() {
  const modal = document.getElementById('api-modal');
  if (modal) {
    modal.style.display = 'flex';
    const input = document.getElementById('api-key-input');
    if (input) input.value = getApiKey();
  }
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
  if (_toast) _toast('API key saved!');
}

export function updateKeyBadge() {
  const badge = document.getElementById('api-key-badge');
  if (!badge) return;
  const hasKey = !!getApiKey();
  badge.className = 'key-badge ' + (hasKey ? 'connected' : 'missing');
  badge.innerHTML = hasKey ? '\uD83D\uDD11 Connected' : '\uD83D\uDD11 Add Key';
}

/* ══════════════════════════════════════════════════════════════
   IMAGE COMPRESSION (keeps images under Anthropic's 5 MB limit)
   ══════════════════════════════════════════════════════════ */

async function compressImage(dataUrl, mediaType) {
  const MAX_BYTES = 4.5 * 1024 * 1024;
  const base64 = dataUrl.split(",")[1];
  const byteSize = Math.ceil(base64.length * 3 / 4);
  const outType = mediaType === "image/jpg" ? "image/jpeg" : mediaType;
  if (byteSize <= MAX_BYTES) return { data: base64, media_type: outType };

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      let quality = 0.82;

      for (let attempt = 0; attempt < 8; attempt++) {
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const result = canvas.toDataURL("image/jpeg", quality);
        const data = result.split(",")[1];
        if (Math.ceil(data.length * 3 / 4) <= MAX_BYTES) {
          resolve({ data, media_type: "image/jpeg" });
          return;
        }
        if (quality > 0.5) {
          quality -= 0.12;
        } else {
          width = Math.floor(width * 0.8);
          height = Math.floor(height * 0.8);
          quality = 0.75;
        }
      }
      // Last resort
      canvas.width = width; canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ data: canvas.toDataURL("image/jpeg", 0.4).split(",")[1], media_type: "image/jpeg" });
    };
    img.src = dataUrl;
  });
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

  const prompt = buildPromptText(notesText, count);

  // Build messages array
  const messages = [{ role: 'user', content: [] }];

  // Attach files — compress images to stay under Anthropic's 5 MB limit, include PDFs
  for (const f of attachedFiles) {
    if (f.type.startsWith('image/')) {
      if (statusText) statusText.textContent = `Compressing ${f.name}…`;
      const compressed = await compressImage(f.data, f.type);
      messages[0].content.push({
        type: 'image',
        source: { type: 'base64', media_type: compressed.media_type, data: compressed.data }
      });
    } else if (f.type === 'application/pdf') {
      const base64 = f.data.split(',')[1];
      messages[0].content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 }
      });
    }
  }
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

    generatedQuestions = valid;
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

  const decks = getDecks();
  const colorIndex = decks.length % DECK_COLORS.length;
  const deckName = generatedDeckMeta.name || document.getElementById('gen-name')?.value?.trim() || 'New Deck';
  const deckId = 'deck-' + Date.now();

  const newDeck = {
    id: deckId,
    name: deckName,
    subject: deckName,
    color: DECK_COLORS[colorIndex],
    created: new Date().toISOString(),
    lastScore: null,
    questions: generatedQuestions
  };

  decks.push(newDeck);
  saveDecks(decks);

  // Also sync to Supabase
  supaSaveDeck(newDeck);

  if (_toast) _toast(`Deck "${deckName}" saved with ${generatedQuestions.length} questions!`);

  // Reset state
  generatedQuestions = [];
  generatedDeckMeta = {};
  const previewCard = document.getElementById('preview-card');
  const saveBtn = document.getElementById('gen-save-btn');
  if (previewCard) previewCard.style.display = 'none';
  if (saveBtn) saveBtn.style.display = 'none';

  // Clear inputs
  const nameEl = document.getElementById('gen-name');
  const notesEl = document.getElementById('gen-notes');
  const importBox = document.getElementById('json-import-box');
  if (nameEl) nameEl.value = '';
  if (notesEl) notesEl.value = '';
  if (importBox) importBox.value = '';
  attachedFiles = [];
  renderFileList();

  clearImport();

  if (_refreshAll) _refreshAll();

  // Prompt class assignment
  promptClassAssignment(deckId);
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
   CLASS ASSIGNMENT AFTER SAVE
   ══════════════════════════════════════════════════════════ */

export function promptClassAssignment(deckId) {
  // Dispatch event for class assignment modal
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
