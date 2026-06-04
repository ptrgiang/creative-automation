// Creative Automation - Side Panel UI

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  authed: false,
  notebooks: [],
  selectedNotebookId: null,
  sources: [],
  conversationId: null,
  sending: false,
  addingSource: false,
};

const LOCAL_AUTOMATION_STORAGE_PREFIX = 'creativeAutomation:actions:';
let localAutomationSequence = 0;
const localAutomationWriteQueues = new Map();

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const authError      = $('auth-error');
const mainScreen     = $('main-screen');
const nbSelect       = $('notebook-select');
const nbContent      = $('notebook-content');
const noNotebook     = $('no-notebook');
const messages       = $('messages');
const queryInput     = $('query-input');
const sendBtn        = $('send-btn');
const clearChat      = $('clear-chat');
const confirmDialog  = $('confirm-dialog');
const confirmOk      = $('confirm-ok');
const confirmCancel  = $('confirm-cancel');
const sourcesList    = $('sources-list');
const sourceUrl      = $('source-url');
const addSourceBtn   = $('add-source-btn');
const fileInput      = $('file-input');
const uploadFileBtn  = $('upload-file-btn');
const uploadStatus   = $('upload-status');
const loading        = $('loading');
const loadingLabel   = $('loading-label');
const retryAuth      = $('retry-auth');
const refreshNbs     = $('refresh-notebooks');
const createNbBtn    = $('create-notebook');
const renameNbBtn    = $('rename-notebook');
const notebookPickerButton = $('notebook-picker-button');
const notebookPickerLabel = $('notebook-picker-label');
const notebookPickerCount = $('notebook-picker-count');
const notebookPickerMenu = $('notebook-picker-menu');
const notebookDisplay = $('notebook-display');
const renameInline = $('rename-inline');
const renameInlineInput = $('rename-inline-input');
const renameInlineConfirm = $('rename-inline-confirm');
const renameInlineCancel = $('rename-inline-cancel');
let inlineNotebookMode = 'rename';
let notebookSearchQuery = '';

// ─── Messaging ────────────────────────────────────────────────────────────────

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp && resp.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, result => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(result?.[key]);
    });
  });
}

function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
}

function storageRemove(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
}

function localAutomationKey(notebookId) {
  return `${LOCAL_AUTOMATION_STORAGE_PREFIX}${notebookId}`;
}

function makeLocalAutomationId() {
  localAutomationSequence += 1;
  return `${Date.now()}-${localAutomationSequence}-${Math.random().toString(16).slice(2)}`;
}

function queueLocalAutomationWrite(notebookId, operation) {
  const previous = localAutomationWriteQueues.get(notebookId) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  const queued = next.finally(() => {
    if (localAutomationWriteQueues.get(notebookId) === queued) {
      localAutomationWriteQueues.delete(notebookId);
    }
  });
  localAutomationWriteQueues.set(notebookId, queued);
  return next;
}

function normalizeLocalAutomationItem(item) {
  const notebookId = item.notebookId || state.selectedNotebookId;
  const createdAt = item.createdAt || Date.now();
  return {
    id: item.id || makeLocalAutomationId(),
    notebookId,
    createdAt,
    role: item.role,
    kind: item.kind || '',
    status: item.status || 'ok',
    text: item.text || '',
    html: item.html || '',
    copyText: item.copyText || item.text || '',
    rawText: item.rawText || '',
  };
}

async function loadLocalAutomationHistory(notebookId) {
  if (!notebookId) return [];
  const items = await storageGet(localAutomationKey(notebookId));
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && item.notebookId === notebookId)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

async function saveLocalAutomationItem(item) {
  const normalized = normalizeLocalAutomationItem(item);
  if (!normalized.notebookId || !normalized.role) return null;

  return queueLocalAutomationWrite(normalized.notebookId, async () => {
    const key = localAutomationKey(normalized.notebookId);
    const items = await loadLocalAutomationHistory(normalized.notebookId);
    const existingIndex = items.findIndex(saved => saved.id === normalized.id);
    if (existingIndex >= 0) items[existingIndex] = { ...items[existingIndex], ...normalized };
    else items.push(normalized);
    await storageSet({ [key]: items });
    return normalized;
  });
}

async function updateLocalAutomationItem(notebookId, itemId, patch) {
  if (!notebookId || !itemId) return;
  return queueLocalAutomationWrite(notebookId, async () => {
    const key = localAutomationKey(notebookId);
    const items = await loadLocalAutomationHistory(notebookId);
    const index = items.findIndex(item => item.id === itemId);
    if (index < 0) return;
    items[index] = { ...items[index], ...patch };
    await storageSet({ [key]: items });
  });
}

async function clearLocalAutomationHistory(notebookId) {
  if (!notebookId) return;
  return queueLocalAutomationWrite(notebookId, () => storageRemove(localAutomationKey(notebookId)));
}

function showLocalAutomationStorageError(error) {
  appendMessage('error', `Could not save local automation history: ${error.message || error}`);
}

function persistLocalAutomationItem(item) {
  return saveLocalAutomationItem(item).catch(showLocalAutomationStorageError);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showLoading(on, label = 'Loading workspace...') {
  if (loadingLabel) loadingLabel.textContent = label;
  loading.classList.toggle('hidden', !on);
}

function requestClearLocalHistoryConfirmation() {
  const previousFocus = document.activeElement;
  confirmDialog.classList.remove('hidden');
  confirmCancel.focus();

  return new Promise(resolve => {
    let settled = false;

    function close(confirmed) {
      if (settled) return;
      settled = true;
      confirmDialog.classList.add('hidden');
      confirmOk.removeEventListener('click', onConfirm);
      confirmCancel.removeEventListener('click', onCancel);
      confirmDialog.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(confirmed);
    }

    function onConfirm() { close(true); }
    function onCancel() { close(false); }
    function onOverlayClick(e) {
      if (e.target === confirmDialog) close(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') close(false);
    }

    confirmOk.addEventListener('click', onConfirm);
    confirmCancel.addEventListener('click', onCancel);
    confirmDialog.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeyDown);
  });
}

function messageBody(el) {
  let body = el.querySelector('.msg-body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'msg-body';
    el.prepend(body);
  }
  return body;
}

function responseActionsRow(el) {
  let row = el.nextElementSibling;
  if (row?.classList.contains('msg-actions-row') && row.dataset.forMessage === el.dataset.messageId) {
    return row;
  }

  row = document.createElement('div');
  row.className = 'msg-actions-row';
  row.dataset.forMessage = el.dataset.messageId;
  el.insertAdjacentElement('afterend', row);
  return row;
}

function removeResponseControls(el) {
  const row = el.nextElementSibling;
  if (row?.classList.contains('msg-actions-row') && row.dataset.forMessage === el.dataset.messageId) {
    row.remove();
  }
  el.classList.remove('msg-copyable');
  delete el.dataset.editing;
  delete el.dataset.copyText;
}

function setIconButtonState(btn, stateName) {
  if (stateName === 'save') {
    btn.setAttribute('aria-label', 'Save response');
    btn.title = 'Save response';
    btn.classList.add('editing');
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
    return;
  }

  btn.setAttribute('aria-label', 'Edit response');
  btn.title = 'Edit response';
  btn.classList.remove('editing');
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 5l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
    </svg>
  `;
}

function startResponseEdit(el) {
  const body = messageBody(el);
  const btn = responseActionsRow(el).querySelector('.msg-edit-btn');
  body.contentEditable = 'true';
  body.classList.add('msg-body-editing');
  el.dataset.editing = 'true';
  setIconButtonState(btn, 'save');
  body.focus();

  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function saveResponseEdit(el) {
  const body = messageBody(el);
  const nextText = body.innerText.trim() || el.dataset.copyText || '';
  const nextHtml = body.innerHTML || renderMarkdown(nextText);
  const btn = responseActionsRow(el).querySelector('.msg-edit-btn');
  body.contentEditable = 'false';
  body.classList.remove('msg-body-editing');
  delete el.dataset.editing;
  setIconButtonState(btn, 'edit');
  setResponseHtml(el, nextHtml, nextText, el._responseOnSave);
  if (el.dataset.localAutomationId && el.dataset.localAutomationNotebookId) {
    updateLocalAutomationItem(el.dataset.localAutomationNotebookId, el.dataset.localAutomationId, {
      text: nextText,
      html: nextHtml,
      copyText: nextText,
      rawText: nextText,
    }).catch(showLocalAutomationStorageError);
  }
  el._responseOnSave?.(nextText, nextHtml);
}

function ensureEditButton(el) {
  const row = responseActionsRow(el);
  let btn = row.querySelector('.msg-edit-btn');
  if (btn) return btn;

  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-edit-btn';
  setIconButtonState(btn, 'edit');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (el.dataset.editing === 'true') saveResponseEdit(el);
    else startResponseEdit(el);
  });
  row.prepend(btn);
  return btn;
}

function ensureCopyButton(el) {
  const row = responseActionsRow(el);
  let btn = row.querySelector('.msg-copy-btn');
  if (btn) return btn;

  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-copy-btn';
  btn.setAttribute('aria-label', 'Copy response');
  btn.title = 'Copy response';
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"></path>
    </svg>
  `;
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    const text = el.dataset.copyText || messageBody(el).innerText || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 900);
    } catch {
      btn.classList.add('copy-error');
      setTimeout(() => btn.classList.remove('copy-error'), 900);
    }
  });
  row.appendChild(btn);
  return btn;
}

function setTransientResponse(el, html) {
  messageBody(el).innerHTML = html;
  removeResponseControls(el);
}

function setResponseHtml(el, html, rawText, onSave) {
  if (!el.dataset.messageId) {
    el.dataset.messageId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  messageBody(el).innerHTML = html;
  el.dataset.copyText = rawText || '';
  if (onSave) el._responseOnSave = onSave;
  el.classList.add('msg-copyable');
  ensureEditButton(el);
  ensureCopyButton(el);
}

function scrollResponseIntoView(el) {
  requestAnimationFrame(() => {
    const row = el.nextElementSibling;
    const target = row?.classList.contains('msg-actions-row') ? row : el;
    target.scrollIntoView({ block: 'end', behavior: 'smooth' });
  });
}

async function sendProductDesc(sourceText, gptBtn) {
  if (gptBtn) {
    gptBtn.disabled = true;
    setActionIconState(gptBtn, 'loading', 'Opening Product Description');
  }
  appendLocalAutomationUser('product', 'Product Description');
  const result = document.createElement('div');
  result.className = 'msg msg-gemini';
  messages.appendChild(result);
  const fallbackUrl = 'https://chatgpt.com/g/g-69080c3e90808191a324742811037c96-product-description';
  setTransientResponse(result, '<em class="msg-thinking msg-thinking-inline"><span class="action-spinner" aria-hidden="true"></span>Sending...</em>');
  messages.scrollTop = messages.scrollHeight;

  try {
    const response = await send({ type: 'SEND_TO_CHATGPT', text: sourceText });
    const url = response?.url || fallbackUrl;
    setResponseHtml(
      result,
      `Sent: <a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">Product Description</a>`,
      `Sent: ${url}`
    );
    scrollResponseIntoView(result);
    saveLocalAutomationResponse(
      result,
      'product',
      `Sent: ${url}`,
      `Sent: <a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">Product Description</a>`,
      { rawText: sourceText }
    );
    if (gptBtn) {
      setActionIconState(gptBtn, 'done', 'Product Description sent');
      setTimeout(() => { setActionIconState(gptBtn, 'product', 'Product Description'); gptBtn.disabled = false; }, 3000);
    }
  } catch (e) {
    result.className = 'msg msg-error';
    setTransientResponse(result, `Product Description error: ${escHtml(e.message)}`);
    scrollResponseIntoView(result);
    saveLocalAutomationResponse(
      result,
      'product',
      `Product Description error: ${e.message}`,
      `Product Description error: ${escHtml(e.message)}`,
      { rawText: sourceText, status: 'error' }
    );
    if (gptBtn) {
      setActionIconState(gptBtn, 'error', 'Product Description error');
      setTimeout(() => { setActionIconState(gptBtn, 'product', 'Product Description'); gptBtn.disabled = false; }, 3000);
    }
  }
}

function actionIconSvg(kind) {
  if (kind === 'bullets') {
    return `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      </svg>
    `;
  }
  if (kind === 'image') {
    return `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="18" height="15" rx="2" stroke="currentColor" stroke-width="2"/>
        <path d="M7 16l3.2-3.2a1.5 1.5 0 0 1 2.1 0L16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"/>
      </svg>
    `;
  }
  if (kind === 'product') {
    return `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 3h8l5 5v13H6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
  }
  if (kind === 'combo') {
    return `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 6h5l2 3M4 18h5l2-3M13 9l2 3-2 3M15 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }
  if (kind === 'loading') return '<span class="action-spinner" aria-hidden="true"></span>';
  if (kind === 'done') {
    return `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }
  return `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
    </svg>
  `;
}

function setActionIconState(btn, kind, label) {
  btn.innerHTML = actionIconSvg(kind);
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function createActionIconButton(kind, label, extraClass = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `action-icon-btn ${extraClass}`.trim();
  setActionIconState(btn, kind, label);
  return btn;
}

function tagLocalAutomationElement(el, item) {
  if (!el || !item) return;
  el.dataset.localAutomationId = item.id;
  el.dataset.localAutomationNotebookId = item.notebookId;
  el.dataset.localAutomationKind = item.kind || '';
}

function appendLocalAutomationUser(kind, text) {
  const notebookId = state.selectedNotebookId;
  const item = normalizeLocalAutomationItem({
    notebookId,
    role: 'user',
    kind,
    text,
    copyText: text,
  });
  const el = appendMessage('user', text);
  tagLocalAutomationElement(el, item);
  persistLocalAutomationItem(item);
  return { el, item };
}

function saveLocalAutomationResponse(el, kind, text, html, options = {}) {
  const notebookId = options.notebookId || state.selectedNotebookId;
  const item = normalizeLocalAutomationItem({
    id: options.id,
    notebookId,
    role: 'response',
    kind,
    status: options.status || 'ok',
    text,
    html,
    copyText: options.copyText || text,
    rawText: options.rawText || text,
  });
  tagLocalAutomationElement(el, item);
  persistLocalAutomationItem(item);
  return item;
}

function attachProductDescriptionAction(result, sourceText, sendFn = sendProductDesc) {
  const gptActions = responseActionsRow(result);
  gptActions.querySelector('.btn-gpt')?.remove();
  const gptBtn = createActionIconButton('product', 'Product Description', 'btn-gpt');
  gptBtn.addEventListener('click', () => sendFn(result.dataset.rawText || sourceText, gptBtn));
  gptActions.insertBefore(gptBtn, gptActions.querySelector('.msg-edit-btn'));
  return gptBtn;
}

function addGeminiActionsToResponse(msgEl, getText) {
  const msgActions = responseActionsRow(msgEl);
  if (msgActions.querySelector('.notebook-gemini-action')) return;

  const bulletsBtn = createActionIconButton('bullets', 'Bullet Points', 'btn-gem notebook-gemini-action');
  const imageBtn = createActionIconButton('image', 'Image Prompt', 'btn-gem notebook-gemini-action');
  const comboBtn = createActionIconButton('combo', 'Run: Bullet Points → Image Prompt → Product Description', 'btn-gem notebook-gemini-action');

  const msgEditBtn = msgActions.querySelector('.msg-edit-btn');
  msgActions.insertBefore(bulletsBtn, msgEditBtn);
  msgActions.insertBefore(imageBtn, msgEditBtn);
  msgActions.insertBefore(comboBtn, msgEditBtn);

  const analysisId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function createResultBlock(kind) {
    const wrap = document.createElement('div');
    wrap.className = 'analysis-result-group';
    wrap.dataset.kind = kind;
    wrap.dataset.analysisId = analysisId;

    const result = document.createElement('div');
    result.className = 'msg msg-gemini';
    wrap.appendChild(result);

    messages.appendChild(wrap);
    return { wrap, result };
  }

  async function fireGemini(btn, kind, gemId, label, thinking) {
    if (msgEl.dataset.editing === 'true') saveResponseEdit(msgEl);
    const actionLabel = kind === 'bullets' ? 'Bullet Points' : kind === 'image' ? 'Image Prompt' : label;
    const text = (getText() || '').trim();
    if (!text) return '';

    appendLocalAutomationUser(kind, actionLabel);
    const { wrap, result } = createResultBlock(kind);
    messages.appendChild(wrap);
    btn.disabled = true;
    result.className = 'msg msg-gemini';
    setTransientResponse(result, `<em class="msg-thinking msg-thinking-inline"><span class="action-spinner" aria-hidden="true"></span>${escHtml(thinking)}</em>`);
    messages.scrollTop = messages.scrollHeight;

    try {
      const { content } = await send({ type: 'SEND_TO_GEMINI', text, gemId });
      const responseText = content || '';
      result.dataset.rawText = content || '';
      setResponseHtml(
        result,
        content ? renderMarkdown(content) : '<em>No response received.</em>',
        content || 'No response received.',
        savedText => { result.dataset.rawText = savedText; }
      );
      saveLocalAutomationResponse(
        result,
        kind,
        content || 'No response received.',
        content ? renderMarkdown(content) : '<em>No response received.</em>',
        { rawText: content || '' }
      );

      if (kind === 'bullets' && content) {
        attachProductDescriptionAction(result, content);
      }
      return responseText;
    } catch (e) {
      result.className = 'msg msg-error';
      setTransientResponse(result, `Gemini error: ${escHtml(e.message)}`);
      saveLocalAutomationResponse(
        result,
        kind,
        `Gemini error: ${e.message}`,
        `Gemini error: ${escHtml(e.message)}`,
        { status: 'error' }
      );
      return '';
    } finally {
      btn.disabled = false;
      setActionIconState(btn, kind, actionLabel);
      messages.scrollTop = messages.scrollHeight;
    }
  }

  bulletsBtn.addEventListener('click', () =>
    fireGemini(bulletsBtn, 'bullets', '9e495ec3e447', 'Bullet Points', 'Creating bullet points...'));

  imageBtn.addEventListener('click', () =>
    fireGemini(imageBtn, 'image', '6a7373766848', 'Image Prompt', 'Generating image prompt...'));
  comboBtn.addEventListener('click', async () => {
    comboBtn.disabled = true;
    setActionIconState(comboBtn, 'loading', 'Running combination flow');
    try {
      const bulletText = await fireGemini(bulletsBtn, 'bullets', '9e495ec3e447', 'Bullet Points', 'Creating bullet points...');
      await fireGemini(imageBtn, 'image', '6a7373766848', 'Image Prompt', 'Generating image prompt...');
      if (bulletText) await sendProductDesc(bulletText);
    } finally {
      comboBtn.disabled = false;
      setActionIconState(comboBtn, 'combo', 'Run: Bullet Points → Image Prompt → Product Description');
    }
  });
}

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg msg-${role}`;
  if (role === 'ai') {
    let currentText = text;
    messages.appendChild(el);
    setResponseHtml(el, renderMarkdown(text), text, savedText => { currentText = savedText; });
    addGeminiActionsToResponse(el, () => currentText);
  } else {
    el.textContent = text;
    messages.appendChild(el);
  }
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function renderConversationTurns(turns) {
  messages.innerHTML = '';
  if (!Array.isArray(turns) || turns.length === 0) return;

  for (const turn of turns) {
    if (!turn.text) continue;
    const role = turn.role === 'user' ? 'user' : 'ai';
    appendMessage(role, turn.text);
  }
}

function appendSavedLocalAutomationItem(item) {
  if (item.role === 'user') {
    const el = appendMessage('user', item.text || '');
    tagLocalAutomationElement(el, item);
    return el;
  }

  if (item.role !== 'response') return null;

  const el = document.createElement('div');
  el.className = item.status === 'error' ? 'msg msg-error' : 'msg msg-gemini';
  messages.appendChild(el);
  tagLocalAutomationElement(el, item);

  if (item.status === 'error') {
    messageBody(el).innerHTML = item.html || escHtml(item.text || '');
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  el.dataset.rawText = item.rawText || item.copyText || item.text || '';
  setResponseHtml(
    el,
    item.html || renderMarkdown(item.text || ''),
    item.copyText || item.text || '',
    savedText => { el.dataset.rawText = savedText; }
  );
  tagLocalAutomationElement(el, item);

  if (item.kind === 'bullets') {
    attachProductDescriptionAction(el, item.rawText || item.copyText || item.text || '');
  }
  messages.scrollTop = messages.scrollHeight;
  return el;
}

async function renderLocalAutomationHistory(notebookId) {
  try {
    const items = await loadLocalAutomationHistory(notebookId);
    if (state.selectedNotebookId !== notebookId) return;
    for (const item of items) appendSavedLocalAutomationItem(item);
  } catch (e) {
    appendMessage('error', `Could not load local automation history: ${e.message}`);
  }
}

function appendAnalysisMessage(rawText) {
  const msgEl = document.createElement('div');
  msgEl.className = 'msg msg-ai';
  let currentText = rawText;
  messages.appendChild(msgEl);
  setResponseHtml(msgEl, renderMarkdown(rawText), rawText, text => { currentText = text; });

  const bulletsBtn = createActionIconButton('bullets', 'Bullet Points', 'btn-gem');
  const imageBtn = createActionIconButton('image', 'Image Prompt', 'btn-gem');
  const comboBtn = createActionIconButton('combo', 'Run: Bullet Points → Image Prompt → Product Description', 'btn-gem');

  const msgActions = responseActionsRow(msgEl);
  const msgEditBtn = msgActions.querySelector('.msg-edit-btn');
  msgActions.insertBefore(bulletsBtn, msgEditBtn);
  msgActions.insertBefore(imageBtn, msgEditBtn);
  msgActions.insertBefore(comboBtn, msgEditBtn);

  const analysisId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function appendSelection(label) {
    const kind = label === 'Bullet Points' ? 'bullets' : label === 'Image Prompt' ? 'image' : 'automation';
    appendLocalAutomationUser(kind, label);
  }

  function createResultBlock(kind) {
    const wrap = document.createElement('div');
    wrap.className = 'analysis-result-group';
    wrap.dataset.kind = kind;
    wrap.dataset.analysisId = analysisId;

    const result = document.createElement('div');
    result.className = 'msg msg-gemini';
    wrap.appendChild(result);

    messages.appendChild(wrap);
    return { wrap, result };
  }

  async function sendProductDesc(sourceText, gptBtn) {
    if (gptBtn) {
      gptBtn.disabled = true;
      setActionIconState(gptBtn, 'loading', 'Opening Product Description');
    }
    appendLocalAutomationUser('product', 'Product Description');
    const result = document.createElement('div');
    result.className = 'msg msg-gemini';
    messages.appendChild(result);
    const fallbackUrl = 'https://chatgpt.com/g/g-69080c3e90808191a324742811037c96-product-description';
    setTransientResponse(result, '<em class="msg-thinking msg-thinking-inline"><span class="action-spinner" aria-hidden="true"></span>Sending...</em>');
    messages.scrollTop = messages.scrollHeight;

    try {
      const response = await send({ type: 'SEND_TO_CHATGPT', text: sourceText });
      const url = response?.url || fallbackUrl;
      setResponseHtml(
        result,
        `Sent: <a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">Product Description</a>`,
        `Sent: ${url}`
      );
      scrollResponseIntoView(result);
      saveLocalAutomationResponse(
        result,
        'product',
        `Sent: ${url}`,
        `Sent: <a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">Product Description</a>`,
        { rawText: sourceText }
      );
      if (gptBtn) {
        setActionIconState(gptBtn, 'done', 'Product Description sent');
        setTimeout(() => { setActionIconState(gptBtn, 'product', 'Product Description'); gptBtn.disabled = false; }, 3000);
      }
    } catch (e) {
      result.className = 'msg msg-error';
      setTransientResponse(result, `Product Description error: ${escHtml(e.message)}`);
      scrollResponseIntoView(result);
      saveLocalAutomationResponse(
        result,
        'product',
        `Product Description error: ${e.message}`,
        `Product Description error: ${escHtml(e.message)}`,
        { rawText: sourceText, status: 'error' }
      );
      if (gptBtn) {
        setActionIconState(gptBtn, 'error', 'Product Description error');
        setTimeout(() => { setActionIconState(gptBtn, 'product', 'Product Description'); gptBtn.disabled = false; }, 3000);
      }
    }
  }

  async function fireGemini(btn, kind, gemId, label, thinking) {
    if (msgEl.dataset.editing === 'true') saveResponseEdit(msgEl);
    const actionLabel = kind === 'bullets' ? 'Bullet Points' : kind === 'image' ? 'Image Prompt' : label;
    const text = currentText.trim();
    if (!text) return '';
    appendSelection(actionLabel);
    const { wrap, result } = createResultBlock(kind);
    messages.appendChild(wrap);
    btn.disabled = true;
    result.className = 'msg msg-gemini';
    setTransientResponse(result, `<em class="msg-thinking msg-thinking-inline"><span class="action-spinner" aria-hidden="true"></span>${escHtml(thinking)}</em>`);
    messages.scrollTop = messages.scrollHeight;
    try {
      const { content } = await send({ type: 'SEND_TO_GEMINI', text, gemId });
      const responseText = content || '';
      result.dataset.rawText = content || '';
      setResponseHtml(
        result,
        content ? renderMarkdown(content) : '<em>No response received.</em>',
        content || 'No response received.',
        savedText => { result.dataset.rawText = savedText; }
      );
      saveLocalAutomationResponse(
        result,
        kind,
        content || 'No response received.',
        content ? renderMarkdown(content) : '<em>No response received.</em>',
        { rawText: content || '' }
      );

      if (kind === 'bullets' && content) {
        attachProductDescriptionAction(result, content, sendProductDesc);
      }
      return responseText;
    } catch (e) {
      result.className = 'msg msg-error';
      setTransientResponse(result, `Gemini error: ${escHtml(e.message)}`);
      saveLocalAutomationResponse(
        result,
        kind,
        `Gemini error: ${e.message}`,
        `Gemini error: ${escHtml(e.message)}`,
        { status: 'error' }
      );
      return '';
    } finally {
      btn.disabled = false;
      setActionIconState(btn, kind, actionLabel);
      messages.scrollTop = messages.scrollHeight;
    }
  }

  bulletsBtn.addEventListener('click', () =>
    fireGemini(bulletsBtn, 'bullets', '9e495ec3e447', 'Bullet Points', 'Creating bullet points...'));

  imageBtn.addEventListener('click', () =>
    fireGemini(imageBtn, 'image', '6a7373766848', 'Image Prompt', 'Generating image prompt...'));

  comboBtn.addEventListener('click', async () => {
    comboBtn.disabled = true;
    setActionIconState(comboBtn, 'loading', 'Running combination flow');
    try {
      const bulletText = await fireGemini(bulletsBtn, 'bullets', '9e495ec3e447', 'Bullet Points', 'Creating bullet points...');
      await fireGemini(imageBtn, 'image', '6a7373766848', 'Image Prompt', 'Generating image prompt...');
      if (bulletText) await sendProductDesc(bulletText);
    } finally {
      comboBtn.disabled = false;
      setActionIconState(comboBtn, 'combo', 'Run: Bullet Points → Image Prompt → Product Description');
    }
  });

  messages.scrollTop = messages.scrollHeight;
}

function appendThinking() {
  const el = document.createElement('div');
  el.className = 'msg msg-ai msg-skeleton';
  el.innerHTML = `
    <div class="skeleton-line"></div>
    <div class="skeleton-line"></div>
    <div class="skeleton-line skeleton-line-short"></div>
  `;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function removeEl(el) {
  el?.parentNode?.removeChild(el);
}

function removeLocalAutomationElements() {
  const localEls = Array.from(messages.querySelectorAll('[data-local-automation-id]'));
  const removedGroups = new Set();
  for (const el of localEls) {
    const group = el.closest('.analysis-result-group');
    if (group) {
      if (removedGroups.has(group)) continue;
      removedGroups.add(group);
      const actionRow = group.nextElementSibling;
      if (actionRow?.classList.contains('msg-actions-row')) actionRow.remove();
      group.remove();
      continue;
    }

    const actionRow = el.nextElementSibling;
    if (actionRow?.classList.contains('msg-actions-row') && actionRow.dataset.forMessage === el.dataset.messageId) {
      actionRow.remove();
    }
    el.remove();
  }
}

function showTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${tabId}`));
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderInline(raw) {
  let s = escHtml(raw);
  // Source-doc citation markers can leak from NotebookLM-backed prompts.
  s = s.replace(/\[\s*cite:\s*[\d,\s–\-]+\]/gi, '');
  // Bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic (single *, not part of **)
  s = s.replace(/(?<!\*)\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Citations: [1], [1-3], [1, 2], [1,2,3]
  s = s.replace(/\[(\d[\d,\s–\-]*)\]/g, '<cite>$1</cite>');
  return s;
}

function renderMarkdown(text) {
  const lines = text.split('\n');
  let html = '';
  // Stack: [{type:'ul'|'ol', indent:N, items:[string]}]
  const stack = [];
  let paraBuf = [];

  // Close all stack entries with indent > maxIndent, nesting their HTML into parent
  function closeDeeper(maxIndent) {
    while (stack.length && stack[stack.length - 1].indent > maxIndent) {
      const top = stack.pop();
      const inner = top.items.map(i => `<li>${i}</li>`).join('');
      const listHtml = `<${top.type}>${inner}</${top.type}>`;
      if (stack.length) {
        const p = stack[stack.length - 1];
        if (p.items.length) p.items[p.items.length - 1] += listHtml;
        else p.items.push(listHtml);
      } else {
        html += listHtml;
      }
    }
  }

  function closeAllLists() { closeDeeper(-1); }

  function flushPara() {
    if (paraBuf.length) { html += `<p>${paraBuf.join('<br>')}</p>`; paraBuf = []; }
  }

  function addListItem(type, indent, content) {
    closeDeeper(indent);
    const top = stack.length ? stack[stack.length - 1] : null;
    if (top && top.indent === indent && top.type === type) {
      top.items.push(content);
    } else {
      stack.push({ type, indent, items: [content] });
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    // Preserve leading spaces for indent detection (use trimEnd only)
    const indent = line.length - line.trimStart().length;

    if (!trimmed) {
      closeAllLists(); flushPara();
      continue;
    }

    // Heading: # / ## / ###
    const hm = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      closeAllLists(); flushPara();
      html += `<div class="md-h md-h${hm[1].length}">${renderInline(hm[2])}</div>`;
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^[-*_]{2,}\s*$/.test(trimmed)) {
      closeAllLists(); flushPara();
      html += '<hr class="md-hr">';
      continue;
    }

    // Unordered list item
    const bm = trimmed.match(/^[-*•]\s+(.*)/);
    if (bm) { flushPara(); addListItem('ul', indent, renderInline(bm[1])); continue; }

    // Ordered list item
    const nm = trimmed.match(/^\d+[.)]\s+(.*)/);
    if (nm) { flushPara(); addListItem('ol', indent, renderInline(nm[1])); continue; }

    // Paragraph
    closeAllLists();
    paraBuf.push(renderInline(trimmed));
  }

  closeAllLists();
  flushPara();
  return html || `<p>${escHtml(text)}</p>`;
}

function renderSources(sources) {
  if (!sources.length) {
    sourcesList.innerHTML = '<div class="empty-state" style="padding:20px"><p>No sources yet</p></div>';
    return;
  }
  sourcesList.innerHTML = sources.map(src => `
    <div class="source-item">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5"/>
        <polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <span class="source-title" title="${escHtml(src.title)}">${escHtml(src.title)}</span>
    </div>
  `).join('');
}

function updateAddSourceButton() {
  addSourceBtn.disabled = state.addingSource || !sourceUrl.value.trim() || !state.selectedNotebookId;
}

function setAddSourceLoading(isLoading) {
  state.addingSource = isLoading;
  updateAddSourceButton();
  addSourceBtn.classList.toggle('is-loading', isLoading);
  addSourceBtn.setAttribute('aria-label', isLoading ? 'Adding URL' : 'Add URL');
  addSourceBtn.title = isLoading ? 'Adding URL' : 'Add URL';
  addSourceBtn.innerHTML = isLoading
    ? '<span class="btn-spinner" aria-hidden="true"></span>'
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      </svg>`;
}

function renderSourcesSkeleton(count = 4) {
  sourcesList.innerHTML = Array.from({ length: count }, (_, idx) => `
    <div class="source-item source-item-skeleton" aria-hidden="true">
      <span class="skeleton-box"></span>
      <span class="skeleton-line${idx % 3 === 2 ? ' skeleton-line-short' : ''}"></span>
    </div>
  `).join('');
}

function formatSourceCount(count) {
  return `${count} source${count !== 1 ? 's' : ''}`;
}

function updateNotebookPickerLabel() {
  const selected = state.notebooks.find(n => n.id === state.selectedNotebookId);
  if (!selected) {
    notebookPickerLabel.textContent = 'Select a notebook...';
    notebookPickerCount.textContent = '';
    return;
  }
  notebookPickerLabel.textContent = selected.title;
  notebookPickerCount.textContent = formatSourceCount(selected.sourceCount);
}

function applyNotebookPickerFilter() {
  const query = notebookSearchQuery.trim().toLowerCase();
  let visibleCount = 0;
  notebookPickerMenu.querySelectorAll('.notebook-picker-option').forEach(btn => {
    const isEmptyOption = btn.dataset.notebookId === '';
    const matches = !query || (!isEmptyOption && btn.dataset.searchText.includes(query));
    btn.classList.toggle('hidden', !matches);
    if (matches && !isEmptyOption) visibleCount += 1;
  });
  const noResults = notebookPickerMenu.querySelector('.notebook-picker-empty');
  if (noResults) noResults.classList.toggle('hidden', !query || visibleCount > 0);
}

function renderNotebookPicker() {
  const emptyActive = !state.selectedNotebookId ? ' notebook-picker-option-active' : '';
  const rows = [
    `<button class="notebook-picker-option${emptyActive}" type="button" data-notebook-id="">
      <span class="notebook-picker-option-title">Select a notebook...</span>
      <span class="notebook-picker-option-count"></span>
    </button>`,
    ...state.notebooks.map(nb => `
      <button class="notebook-picker-option${nb.id === state.selectedNotebookId ? ' notebook-picker-option-active' : ''}" type="button" data-notebook-id="${escHtml(nb.id)}" data-search-text="${escHtml(nb.title.toLowerCase())}">
        <span class="notebook-picker-option-title">${escHtml(nb.title)}</span>
        <span class="notebook-picker-option-count">${escHtml(formatSourceCount(nb.sourceCount))}</span>
      </button>
    `),
  ];

  notebookPickerMenu.innerHTML = `
    <div class="notebook-picker-search-wrap">
      <input id="notebook-picker-search" class="notebook-picker-search" type="search" placeholder="Search notebooks..." value="${escHtml(notebookSearchQuery)}" autocomplete="off">
    </div>
    <div class="notebook-picker-options">
      ${rows.join('')}
      <div class="notebook-picker-empty hidden">No notebooks found</div>
    </div>
  `;
  const searchInput = $('notebook-picker-search');
  searchInput.addEventListener('input', () => {
    notebookSearchQuery = searchInput.value;
    applyNotebookPickerFilter();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const firstMatch = notebookPickerMenu.querySelector('.notebook-picker-option:not(.hidden)');
      if (firstMatch) firstMatch.click();
    }
  });
  notebookPickerMenu.querySelectorAll('.notebook-picker-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.notebookId || '';
      notebookSearchQuery = '';
      closeNotebookPicker();
      nbSelect.value = id;
      await selectNotebook(id);
    });
  });
  applyNotebookPickerFilter();
  updateNotebookPickerLabel();
}

function openNotebookPicker() {
  notebookPickerMenu.classList.remove('hidden');
  const searchInput = $('notebook-picker-search');
  if (searchInput) {
    searchInput.focus();
    searchInput.select();
  }
}

function closeNotebookPicker() {
  notebookPickerMenu.classList.add('hidden');
}

// Auto-resize textarea (up to 120px for side panel)
queryInput.addEventListener('input', () => {
  queryInput.style.height = 'auto';
  queryInput.style.height = Math.min(queryInput.scrollHeight, 120) + 'px';
  const hasText = !!queryInput.value.trim();
  sendBtn.disabled          = !hasText || state.sending;
});

// ─── Notebooks ────────────────────────────────────────────────────────────────

async function loadNotebooks() {
  notebookPickerLabel.textContent = 'Loading notebooks...';
  notebookPickerCount.textContent = '';
  notebookPickerMenu.innerHTML = Array.from({ length: 4 }, () => `
    <div class="notebook-picker-option" aria-hidden="true">
      <span class="skeleton-line"></span>
      <span class="skeleton-line skeleton-line-short"></span>
    </div>
  `).join('');

  const { notebooks } = await send({ type: 'LIST_NOTEBOOKS' });
  state.notebooks = notebooks;

  const savedId = state.selectedNotebookId;
  nbSelect.innerHTML = '<option value="">Select a notebook…</option>';
  for (const nb of notebooks) {
    const opt = document.createElement('option');
    opt.value = nb.id;
    opt.textContent = `${nb.title} (${formatSourceCount(nb.sourceCount)})`;
    nbSelect.appendChild(opt);
  }

  if (savedId && notebooks.find(n => n.id === savedId)) {
    nbSelect.value = savedId;
  } else if (savedId) {
    state.selectedNotebookId = null;
    nbSelect.value = '';
  }
  renderNotebookPicker();
}

async function selectNotebook(id) {
  if (!id) {
    state.selectedNotebookId = null;
    state.conversationId = null;
    state.sources = [];
    noNotebook.classList.remove('hidden');
    nbContent.classList.add('hidden');
    renameNbBtn.classList.add('hidden');
    updateNotebookPickerLabel();
    renderNotebookPicker();
    updateAddSourceButton();
    return;
  }

  state.selectedNotebookId = id;
  state.conversationId = null;
  noNotebook.classList.add('hidden');
  nbContent.classList.remove('hidden');
  renameNbBtn.classList.remove('hidden');
  messages.innerHTML = '';
  updateNotebookPickerLabel();
  renderNotebookPicker();
  updateAddSourceButton();
  renderSourcesSkeleton();

  showLoading(true, 'Loading notebook...');
  try {
    const [{ sources }, conversationResult] = await Promise.all([
      send({ type: 'GET_NOTEBOOK', notebookId: id }),
      send({ type: 'GET_NOTEBOOK_CONVERSATIONS', notebookId: id, limit: 100 }).catch(() => ({ conversations: [] })),
    ]);
    if (state.selectedNotebookId !== id) return;

    state.sources = sources;
    renderSources(sources);

    const conversations = conversationResult.conversations || [];
    const latestConversation = conversations.find(conv => conv.turns?.length) || conversations[0];
    state.conversationId = latestConversation?.id || null;
    renderConversationTurns(latestConversation?.turns || []);
    await renderLocalAutomationHistory(id);
  } catch (e) {
    console.error('Failed to load notebook:', e);
  } finally {
    showLoading(false);
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

async function sendQuery() {
  const text = queryInput.value.trim();
  if (!text || state.sending || !state.selectedNotebookId) return;

  state.sending = true;
  sendBtn.disabled = true;
  queryInput.value = '';
  queryInput.style.height = 'auto';

  appendMessage('user', text);
  const thinkingEl = appendThinking();

  try {
    const { answer, conversationId } = await send({
      type: 'QUERY',
      notebookId: state.selectedNotebookId,
      query: text,
      conversationId: state.conversationId,
    });

    removeEl(thinkingEl);
    state.conversationId = conversationId;

    if (answer) {
      appendMessage('ai', answer);
    } else {
      appendMessage('error', 'No response. The notebook may have no sources yet.');
    }
  } catch (e) {
    removeEl(thinkingEl);
    const errMsg = e.message.includes('AUTH_EXPIRED')
      ? 'Session expired. Please visit NotebookLM and try again.'
      : `Error: ${e.message}`;
    appendMessage('error', errMsg);
  } finally {
    state.sending = false;
    sendBtn.disabled = !queryInput.value.trim();
  }
}

// ─── Sources ──────────────────────────────────────────────────────────────────

async function addSource() {
  const url = sourceUrl.value.trim();
  if (!url || !state.selectedNotebookId || state.addingSource) return;

  setAddSourceLoading(true);

  try {
    await send({ type: 'ADD_URL_SOURCE', notebookId: state.selectedNotebookId, url });
    sourceUrl.value = '';
    const { sources } = await send({ type: 'GET_NOTEBOOK', notebookId: state.selectedNotebookId });
    state.sources = sources;
    renderSources(sources);
  } catch (e) {
    alert(`Failed to add source: ${e.message}`);
  } finally {
    setAddSourceLoading(false);
  }
}

// ─── Inline notebook create / rename ─────────────────────────────────────────

function openInlineCreate() {
  inlineNotebookMode = 'create';
  closeNotebookPicker();
  notebookDisplay.classList.add('hidden');
  renameInline.classList.remove('hidden');
  renameInlineInput.value = '';
  renameInlineInput.placeholder = 'Name the new notebook';
  renameInlineConfirm.title = 'Create notebook';
  renameInlineCancel.title = 'Cancel create';
  renameInlineInput.focus();
}

function openInlineRename() {
  const current = state.notebooks.find(n => n.id === state.selectedNotebookId);
  if (!current) return;
  inlineNotebookMode = 'rename';
  closeNotebookPicker();
  notebookDisplay.classList.add('hidden');
  renameInline.classList.remove('hidden');
  renameInlineInput.value = current.title;
  renameInlineInput.placeholder = 'Name this notebook';
  renameInlineConfirm.title = 'Save name';
  renameInlineCancel.title = 'Cancel rename';
  renameInlineInput.focus();
  renameInlineInput.select();
}

function closeInlineRename() {
  renameInline.classList.add('hidden');
  notebookDisplay.classList.remove('hidden');
  renameInlineInput.value = '';
  renameInlineInput.placeholder = 'Name this notebook';
}

async function confirmInlineNotebook() {
  const name = renameInlineInput.value.trim();
  if (!name) return;

  renameInlineConfirm.disabled = true;
  try {
    if (inlineNotebookMode === 'create') {
      const { id } = await send({ type: 'CREATE_NOTEBOOK', title: name });
      closeInlineRename();
      await loadNotebooks();
      nbSelect.value = id;
      await selectNotebook(id);
      return;
    }

    if (!state.selectedNotebookId) return;
    await send({ type: 'RENAME_NOTEBOOK', notebookId: state.selectedNotebookId, newTitle: name });
    const nb = state.notebooks.find(n => n.id === state.selectedNotebookId);
    if (nb) nb.title = name;
    const opt = nbSelect.querySelector(`option[value="${state.selectedNotebookId}"]`);
    if (opt) opt.textContent = `${name} (${formatSourceCount(nb?.sourceCount ?? 0)})`;
    closeInlineRename();
    renderNotebookPicker();
  } catch (e) {
    alert(`Failed: ${e.message}`);
  } finally {
    renameInlineConfirm.disabled = false;
  }
}

createNbBtn.addEventListener('click', openInlineCreate);
renameNbBtn.addEventListener('click', openInlineRename);
renameInlineConfirm.addEventListener('click', confirmInlineNotebook);
renameInlineCancel.addEventListener('click', closeInlineRename);
renameInlineInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmInlineNotebook();
  if (e.key === 'Escape') closeInlineRename();
});

// ─── File upload ──────────────────────────────────────────────────────────────

uploadFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file || !state.selectedNotebookId) return;

  fileInput.value = '';
  uploadFileBtn.disabled = true;
  uploadStatus.textContent = 'Preparing…';
  uploadStatus.className = 'upload-status upload-progress';

  try {
    // Steps 1 & 2 run in background (need auth/RPC). Returns the upload URL.
    const { uploadUrl } = await send({
      type: 'PREPARE_FILE_UPLOAD',
      notebookId: state.selectedNotebookId,
      filename: file.name,
      fileSize: file.size,
    });

    // Step 3: upload the file bytes directly from here — the File object
    // stays in this page so it never crosses the message channel.
    uploadStatus.textContent = `Uploading ${file.name}…`;
    const uploadResp = await fetch(uploadUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Origin': 'https://notebooklm.google.com',
        'Referer': 'https://notebooklm.google.com/',
        'x-goog-authuser': '0',
        'x-goog-upload-command': 'upload, finalize',
        'x-goog-upload-offset': '0',
      },
      body: file,
    });

    if (!uploadResp.ok) {
      const errBody = await uploadResp.text().catch(() => '');
      throw new Error(`Step 3 failed ${uploadResp.status}: ${errBody.slice(0, 120)}`);
    }

    uploadStatus.textContent = `✓ ${file.name} added`;
    uploadStatus.className = 'upload-status upload-ok';
    const { sources } = await send({ type: 'GET_NOTEBOOK', notebookId: state.selectedNotebookId });
    state.sources = sources;
    renderSources(sources);
  } catch (e) {
    uploadStatus.textContent = `✗ ${e.message}`;
    uploadStatus.className = 'upload-status upload-error';
  } finally {
    uploadFileBtn.disabled = false;
    setTimeout(() => { uploadStatus.textContent = ''; uploadStatus.className = 'upload-status'; }, 5000);
  }
});

// ─── Amazon Search section ────────────────────────────────────────────────────

const amazonSection   = $('amazon-section');
const amazonInfo      = $('amazon-info');
const amazonUploadBtn = $('amazon-upload-btn');
const amazonProgress  = $('amazon-progress');

let uploadPollingInterval = null;
const AMAZON_SEARCH_HELP = 'Open Compare Listings';
const AMAZON_SEARCH_NAV_HELP = 'Navigate back to Amazon Search and open Compare Listings.';

// Read compare state from localStorage directly via scripting (works even without content script)
async function readAmazonStateViaScript(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      asins:       JSON.parse(localStorage.getItem('nlmCompareAsins')   || '[]'),
      domain:      localStorage.getItem('nlmCompareDomain')              || localStorage.getItem('amazonDomain') || 'com',
      brandMap:    JSON.parse(localStorage.getItem('nlmCompareBrandMap') || '{}'),
      titleMap:    JSON.parse(localStorage.getItem('nlmCompareTitleMap') || '{}'),
      searchQuery: localStorage.getItem('searchQuery')                   || 'Amazon Search',
      prefs:       JSON.parse(localStorage.getItem('downloadListingsPreferences') || '{}'),
    }),
  });
  return res?.result ?? null;
}

function applyAmazonState(s) {
  if (s?.asins?.length) {
    const q = s.searchQuery ? `"${s.searchQuery}"` : 'unknown query';
    amazonInfo.textContent = `${s.asins.length} product${s.asins.length !== 1 ? 's' : ''} · ${q}`;
    amazonSection.classList.add('amazon-section-ready');
    amazonUploadBtn.disabled = false;
  } else {
    amazonInfo.textContent = AMAZON_SEARCH_HELP;
    amazonSection.classList.remove('amazon-section-ready');
    amazonUploadBtn.disabled = true;
  }
}

async function checkAmazonTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const onAmazon = tab?.url?.includes('amazon-crawler.netlify.app') ?? false;
    amazonSection.classList.remove('hidden');
    if (!onAmazon) {
      amazonInfo.textContent = AMAZON_SEARCH_NAV_HELP;
      amazonSection.classList.remove('amazon-section-ready');
      amazonUploadBtn.disabled = true;
      return;
    }

    // Try content script first; fall back to direct scripting if not injected
    let s = null;
    try {
      s = await chrome.tabs.sendMessage(tab.id, { type: 'GET_AMAZON_COMPARE_STATE' });
    } catch {
      try { s = await readAmazonStateViaScript(tab.id); } catch {}
    }
    applyAmazonState(s);
  } catch {}
}

amazonUploadBtn.addEventListener('click', async () => {
  amazonUploadBtn.disabled = true;
  amazonProgress.classList.remove('hidden');
  amazonProgress.className = 'amazon-progress amazon-progress-running';
  amazonProgress.textContent = 'Reading compare state…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let compareState = null;
    try {
      compareState = await chrome.tabs.sendMessage(tab.id, { type: 'GET_AMAZON_COMPARE_STATE' });
    } catch {
      try { compareState = await readAmazonStateViaScript(tab.id); } catch {}
    }

    if (!compareState?.asins?.length) {
      throw new Error('No products found. Open Compare Listings.');
    }

    amazonProgress.textContent = 'Starting upload…';
    const { error: startErr } = await send({ type: 'AMAZON_UPLOAD', ...compareState });
    if (startErr) throw new Error(startErr);

    clearInterval(uploadPollingInterval);
    uploadPollingInterval = setInterval(async () => {
      try {
        const { job } = await send({ type: 'GET_UPLOAD_PROGRESS' });
        if (job.status === 'running') {
          const { step, done, total } = job.progress;
          amazonProgress.textContent = total > 0 ? `[${done}/${total}] ${step}` : step;
        } else if (job.status === 'done') {
          clearInterval(uploadPollingInterval);
          amazonProgress.className = 'amazon-progress amazon-progress-ok';
          amazonProgress.textContent = job.result?.answer ? '✓ Analysis ready' : `✓ Created "${job.result.title}"`;
          amazonUploadBtn.disabled = false;
          try {
            await loadNotebooks();
            nbSelect.value = job.result.notebookId;
            await selectNotebook(job.result.notebookId);
            if (job.result.answer) {
              showTab('chat');
              appendAnalysisMessage(job.result.answer);
              if (job.result.conversationId) state.conversationId = job.result.conversationId;
            }
          } catch {}
        } else if (job.status === 'error') {
          clearInterval(uploadPollingInterval);
          amazonProgress.className = 'amazon-progress amazon-progress-error';
          amazonProgress.textContent = `✗ ${job.error}`;
          amazonUploadBtn.disabled = false;
        }
      } catch {}
    }, 500);

  } catch (e) {
    clearInterval(uploadPollingInterval);
    amazonProgress.className = 'amazon-progress amazon-progress-error';
    amazonProgress.textContent = `✗ ${e.message}`;
    amazonUploadBtn.disabled = false;
  }
});

chrome.tabs.onActivated.addListener(() => checkAmazonTab());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') checkAmazonTab();
});

// Auto-update when compare modal opens (content script polls localStorage)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'AMAZON_COMPARE_UPDATED') return;
  amazonSection.classList.remove('hidden');
  applyAmazonState(msg);
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    authError.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    state.authed = true;

    await loadNotebooks();
    checkAmazonTab().catch(() => {});
  } catch (e) {
    authError.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

nbSelect.addEventListener('change', () => selectNotebook(nbSelect.value));

notebookPickerButton.addEventListener('click', e => {
  e.stopPropagation();
  if (notebookPickerMenu.classList.contains('hidden')) openNotebookPicker();
  else closeNotebookPicker();
});

notebookDisplay.addEventListener('click', e => {
  if (e.target.closest('#rename-notebook') || e.target.closest('#notebook-picker-button')) return;
  e.stopPropagation();
  if (notebookPickerMenu.classList.contains('hidden')) openNotebookPicker();
  else closeNotebookPicker();
});

notebookPickerMenu.addEventListener('click', e => {
  e.stopPropagation();
});

document.addEventListener('click', () => closeNotebookPicker());

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeNotebookPicker();
});

refreshNbs.addEventListener('click', async () => {
  refreshNbs.disabled = true;
  refreshNbs.classList.add('is-refreshing');

  try {
    await send({ type: 'REFRESH_SESSIONS' });
    await loadNotebooks();

    if (state.selectedNotebookId) {
      await selectNotebook(state.selectedNotebookId);
    } else {
      await selectNotebook('');
    }
  } catch {
    authError.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  } finally {
    refreshNbs.disabled = false;
    refreshNbs.classList.remove('is-refreshing');
  }
});

sendBtn.addEventListener('click', sendQuery);
queryInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendQuery();
  }
});

clearChat.addEventListener('click', async () => {
  if (!state.selectedNotebookId) return;
  const confirmed = await requestClearLocalHistoryConfirmation();
  if (!confirmed) return;

  try {
    await clearLocalAutomationHistory(state.selectedNotebookId);
    removeLocalAutomationElements();
  } catch (e) {
    appendMessage('error', `Could not clear local automation history: ${e.message}`);
  }
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

addSourceBtn.addEventListener('click', addSource);
sourceUrl.addEventListener('input', updateAddSourceButton);
sourceUrl.addEventListener('keydown', e => {
  if (e.key === 'Enter') addSource();
});

retryAuth.addEventListener('click', () => {
  authError.classList.add('hidden');
  init();
});

init();
