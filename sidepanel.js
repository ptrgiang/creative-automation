// NotebookLM Assistant - Side Panel UI

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  authed: false,
  notebooks: [],
  selectedNotebookId: null,
  sources: [],
  conversationId: null,
  sending: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const authDot        = $('auth-dot');
const authLabel      = $('auth-label');
const accountEmail   = $('account-email');
const accountAvatar  = $('account-avatar');
const accountChevron = $('account-chevron');
const accountBtn     = $('account-btn');
const accountDropdown = $('account-dropdown');
const accountsList   = $('accounts-list');
const authError      = $('auth-error');
const mainScreen     = $('main-screen');
const nbSelect       = $('notebook-select');
const nbContent      = $('notebook-content');
const noNotebook     = $('no-notebook');
const messages       = $('messages');
const queryInput     = $('query-input');
const sendBtn        = $('send-btn');
const clearChat      = $('clear-chat');
const geminiBulletsBtn = $('gemini-bullets-btn');
const geminiImageBtn   = $('gemini-image-btn');
const chatgptBtn       = $('chatgpt-btn');
const sourcesList    = $('sources-list');
const sourceUrl      = $('source-url');
const addSourceBtn   = $('add-source-btn');
const fileInput      = $('file-input');
const uploadFileBtn  = $('upload-file-btn');
const uploadStatus   = $('upload-status');
const loading        = $('loading');
const retryAuth      = $('retry-auth');
const refreshNbs     = $('refresh-notebooks');
const createNbBtn    = $('create-notebook');
const renameNbBtn    = $('rename-notebook');
const nbModal        = $('nb-modal');
const nbModalTitle   = $('nb-modal-title');
const nbModalInput   = $('nb-modal-input');
const nbModalCancel  = $('nb-modal-cancel');
const nbModalConfirm = $('nb-modal-confirm');

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

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showLoading(on) {
  loading.classList.toggle('hidden', !on);
}

function setAuthStatus(status, label) {
  authDot.className = `dot dot-${status}`;
  authLabel.textContent = label;
}

// ─── Account UI ───────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#4285F4','#EA4335','#34A853','#FBBC04','#9C27B0','#FF7043','#0097A7'];

function avatarColor(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h)];
}

function makeAvatarEl(name, email, size = 28) {
  const initial = (name || email || '?')[0].toUpperCase();
  const color   = avatarColor(email || name || '');
  const el = document.createElement('div');
  el.className = 'avatar';
  el.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size*0.42)}px;background:${color}`;
  el.textContent = initial;
  return el;
}

function showAccountDropdown(accounts, currentEmail) {
  accountsList.innerHTML = '';

  if (!accounts.length) {
    accountsList.innerHTML = '<div class="dropdown-empty">No accounts found</div>';
  } else {
    for (const acc of accounts) {
      const isCurrent = acc.email.toLowerCase() === (currentEmail || '').toLowerCase();
      const row = document.createElement('div');
      row.className = `account-row${isCurrent ? ' account-row-active' : ''}`;

      const av = makeAvatarEl(acc.name, acc.email, 32);
      const info = document.createElement('div');
      info.className = 'account-row-info';
      info.innerHTML = `
        <span class="account-row-name">${escHtml(acc.name || acc.email)}</span>
        <span class="account-row-email">${escHtml(acc.email)}</span>
      `;

      row.appendChild(av);
      row.appendChild(info);

      if (isCurrent) {
        const badge = document.createElement('span');
        badge.className = 'account-row-badge';
        badge.textContent = 'Active';
        row.appendChild(badge);
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-sm';
        btn.textContent = 'Switch';
        btn.addEventListener('click', () => {
          chrome.tabs.create({ url: `https://notebooklm.google.com/?authuser=${acc.index}` });
          closeDropdown();
        });
        row.appendChild(btn);
      }

      accountsList.appendChild(row);
    }
  }

  accountDropdown.classList.remove('hidden');
}

function closeDropdown() {
  accountDropdown.classList.add('hidden');
}

async function loadAccountInfo(currentEmail) {
  // Show avatar in header once we have an email
  if (currentEmail) {
    authDot.classList.add('hidden');
    accountAvatar.innerHTML = '';
    accountAvatar.appendChild(makeAvatarEl('', currentEmail, 22));
    accountAvatar.classList.remove('hidden');
    accountEmail.textContent = currentEmail;
    accountChevron.classList.remove('hidden');
  }
}

accountBtn.addEventListener('click', async () => {
  if (accountDropdown.classList.contains('hidden')) {
    const { accounts, currentEmail } = await send({ type: 'GET_ACCOUNTS' }).catch(() => ({ accounts: [], currentEmail: '' }));
    showAccountDropdown(accounts, currentEmail);
  } else {
    closeDropdown();
  }
});

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!accountBtn.contains(e.target) && !accountDropdown.contains(e.target)) {
    closeDropdown();
  }
});

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg msg-${role}`;
  if (role === 'ai') {
    el.innerHTML = renderMarkdown(text);
  } else {
    el.textContent = text;
  }
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function appendAnalysisMessage(rawText) {
  // AI message
  const msgEl = document.createElement('div');
  msgEl.className = 'msg msg-ai';
  msgEl.innerHTML = renderMarkdown(rawText);
  messages.appendChild(msgEl);

  // Edit area (hidden by default, populated with raw text)
  const editWrap = document.createElement('div');
  editWrap.className = 'analysis-edit hidden';
  const editTA = document.createElement('textarea');
  editTA.className = 'analysis-textarea';
  editTA.value = rawText;
  editWrap.appendChild(editTA);
  messages.appendChild(editWrap);

  // Action buttons row
  const actEl = document.createElement('div');
  actEl.className = 'analysis-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost btn-sm';
  editBtn.textContent = 'Edit';

  const bulletsBtn = document.createElement('button');
  bulletsBtn.className = 'btn btn-gem btn-sm';
  bulletsBtn.textContent = '✦ Bullet Points';

  const imageBtn = document.createElement('button');
  imageBtn.className = 'btn btn-gem btn-sm';
  imageBtn.textContent = '✦ Image Prompt';

  const gptBtn = document.createElement('button');
  gptBtn.className = 'btn btn-gpt btn-sm';
  gptBtn.textContent = '⬡ Product Desc';

  actEl.appendChild(editBtn);
  actEl.appendChild(bulletsBtn);
  actEl.appendChild(imageBtn);
  actEl.appendChild(gptBtn);
  messages.appendChild(actEl);

  // Shared Gemini response area
  const gemEl = document.createElement('div');
  gemEl.className = 'msg msg-gemini hidden';
  messages.appendChild(gemEl);

  editBtn.addEventListener('click', () => {
    const nowHidden = editWrap.classList.toggle('hidden');
    editBtn.textContent = nowHidden ? 'Edit' : 'Close Edit';
    messages.scrollTop = messages.scrollHeight;
  });

  async function fireGemini(btn, gemId, label, thinking) {
    const text = editTA.value.trim() || rawText;
    btn.disabled = true;
    btn.textContent = '✦ Sending…';
    gemEl.className = 'msg msg-gemini';
    gemEl.innerHTML = `<em class="msg-thinking">${thinking}</em>`;
    messages.scrollTop = messages.scrollHeight;
    try {
      const { content } = await send({ type: 'SEND_TO_GEMINI', text, gemId });
      gemEl.innerHTML = content ? renderMarkdown(content) : '<em>No response received.</em>';
    } catch (e) {
      gemEl.className = 'msg msg-error';
      gemEl.textContent = `Gemini error: ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
      messages.scrollTop = messages.scrollHeight;
    }
  }

  bulletsBtn.addEventListener('click', () =>
    fireGemini(bulletsBtn, '9e495ec3e447', '✦ Bullet Points', 'Creating bullet points…'));

  imageBtn.addEventListener('click', () =>
    fireGemini(imageBtn, '6a7373766848', '✦ Image Prompt', 'Generating image prompt…'));

  gptBtn.addEventListener('click', async () => {
    const text = editTA.value.trim() || rawText;
    gptBtn.disabled = true;
    gptBtn.textContent = '⬡ Opening…';
    try {
      await send({ type: 'SEND_TO_CHATGPT', text });
      gptBtn.textContent = '⬡ Sent ✓';
      setTimeout(() => { gptBtn.textContent = '⬡ Product Desc'; gptBtn.disabled = false; }, 3000);
    } catch (e) {
      gptBtn.textContent = '⬡ Error';
      setTimeout(() => { gptBtn.textContent = '⬡ Product Desc'; gptBtn.disabled = false; }, 3000);
    }
  });

  messages.scrollTop = messages.scrollHeight;
}

function appendThinking() {
  const el = document.createElement('div');
  el.className = 'msg msg-thinking';
  el.textContent = 'Thinking…';
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function removeEl(el) {
  el?.parentNode?.removeChild(el);
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

// Auto-resize textarea (up to 120px for side panel)
queryInput.addEventListener('input', () => {
  queryInput.style.height = 'auto';
  queryInput.style.height = Math.min(queryInput.scrollHeight, 120) + 'px';
  const hasText = !!queryInput.value.trim();
  sendBtn.disabled          = !hasText || state.sending;
  geminiBulletsBtn.disabled = !hasText;
  geminiImageBtn.disabled   = !hasText;
  chatgptBtn.disabled       = !hasText;
});

// ─── Notebooks ────────────────────────────────────────────────────────────────

async function loadNotebooks() {
  const { notebooks } = await send({ type: 'LIST_NOTEBOOKS' });
  state.notebooks = notebooks;

  const savedId = state.selectedNotebookId;
  nbSelect.innerHTML = '<option value="">Select a notebook…</option>';
  for (const nb of notebooks) {
    const opt = document.createElement('option');
    opt.value = nb.id;
    opt.textContent = `${nb.title} (${nb.sourceCount} source${nb.sourceCount !== 1 ? 's' : ''})`;
    nbSelect.appendChild(opt);
  }

  if (savedId && notebooks.find(n => n.id === savedId)) {
    nbSelect.value = savedId;
  }
}

async function selectNotebook(id) {
  if (!id) {
    state.selectedNotebookId = null;
    state.conversationId = null;
    state.sources = [];
    noNotebook.classList.remove('hidden');
    nbContent.classList.add('hidden');
    renameNbBtn.classList.add('hidden');
    return;
  }

  state.selectedNotebookId = id;
  state.conversationId = null;
  noNotebook.classList.add('hidden');
  nbContent.classList.remove('hidden');
  renameNbBtn.classList.remove('hidden');
  messages.innerHTML = '';

  showLoading(true);
  try {
    const { sources } = await send({ type: 'GET_NOTEBOOK', notebookId: id });
    state.sources = sources;
    renderSources(sources);
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
  if (!url || !state.selectedNotebookId) return;

  addSourceBtn.disabled = true;
  addSourceBtn.textContent = 'Adding…';

  try {
    await send({ type: 'ADD_URL_SOURCE', notebookId: state.selectedNotebookId, url });
    sourceUrl.value = '';
    const { sources } = await send({ type: 'GET_NOTEBOOK', notebookId: state.selectedNotebookId });
    state.sources = sources;
    renderSources(sources);
  } catch (e) {
    alert(`Failed to add source: ${e.message}`);
  } finally {
    addSourceBtn.disabled = false;
    addSourceBtn.textContent = 'Add URL';
  }
}

// ─── Notebook modal (create / rename) ────────────────────────────────────────

let modalMode = 'create'; // 'create' | 'rename'

function openModal(mode) {
  modalMode = mode;
  if (mode === 'create') {
    nbModalTitle.textContent   = 'New notebook';
    nbModalConfirm.textContent = 'Create';
    nbModalInput.value         = '';
    nbModalInput.placeholder   = 'Notebook name…';
  } else {
    nbModalTitle.textContent   = 'Rename notebook';
    nbModalConfirm.textContent = 'Rename';
    const cur = state.notebooks.find(n => n.id === state.selectedNotebookId);
    nbModalInput.value         = cur ? cur.title : '';
    nbModalInput.placeholder   = 'New name…';
  }
  nbModal.classList.remove('hidden');
  nbModalInput.focus();
  nbModalInput.select();
}

function closeModal() {
  nbModal.classList.add('hidden');
  nbModalInput.value = '';
}

async function confirmModal() {
  const name = nbModalInput.value.trim();
  if (!name) return;

  nbModalConfirm.disabled = true;
  nbModalConfirm.textContent = '…';

  try {
    if (modalMode === 'create') {
      const { id, title } = await send({ type: 'CREATE_NOTEBOOK', title: name });
      closeModal();
      await loadNotebooks();
      // Auto-select the new notebook
      nbSelect.value = id;
      await selectNotebook(id);
    } else {
      await send({ type: 'RENAME_NOTEBOOK', notebookId: state.selectedNotebookId, newTitle: name });
      closeModal();
      // Update local state + dropdown label
      const nb = state.notebooks.find(n => n.id === state.selectedNotebookId);
      if (nb) nb.title = name;
      const opt = nbSelect.querySelector(`option[value="${state.selectedNotebookId}"]`);
      if (opt) opt.textContent = `${name} (${nb?.sourceCount ?? 0} source${nb?.sourceCount !== 1 ? 's' : ''})`;
    }
  } catch (e) {
    alert(`Failed: ${e.message}`);
  } finally {
    nbModalConfirm.disabled = false;
    nbModalConfirm.textContent = modalMode === 'create' ? 'Create' : 'Rename';
  }
}

createNbBtn.addEventListener('click', () => openModal('create'));
renameNbBtn.addEventListener('click', () => openModal('rename'));
nbModalCancel.addEventListener('click', closeModal);
nbModalConfirm.addEventListener('click', confirmModal);
nbModalInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmModal();
  if (e.key === 'Escape') closeModal();
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

// ─── Amazon Research section ──────────────────────────────────────────────────

const amazonSection   = $('amazon-section');
const amazonInfo      = $('amazon-info');
const amazonUploadBtn = $('amazon-upload-btn');
const amazonProgress  = $('amazon-progress');

let uploadPollingInterval = null;

// Read compare state from localStorage directly via scripting (works even without content script)
async function readAmazonStateViaScript(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      asins:       JSON.parse(localStorage.getItem('nlmCompareAsins')   || '[]'),
      domain:      localStorage.getItem('nlmCompareDomain')              || localStorage.getItem('amazonDomain') || 'com',
      brandMap:    JSON.parse(localStorage.getItem('nlmCompareBrandMap') || '{}'),
      titleMap:    JSON.parse(localStorage.getItem('nlmCompareTitleMap') || '{}'),
      searchQuery: localStorage.getItem('searchQuery')                   || 'Amazon Research',
      prefs:       JSON.parse(localStorage.getItem('downloadListingsPreferences') || '{}'),
    }),
  });
  return res?.result ?? null;
}

function applyAmazonState(s) {
  if (s?.asins?.length) {
    const q = s.searchQuery ? `"${s.searchQuery}"` : 'unknown query';
    amazonInfo.textContent = `${s.asins.length} product${s.asins.length !== 1 ? 's' : ''} · ${q}`;
    amazonUploadBtn.disabled = false;
  } else {
    amazonInfo.textContent = 'Open the Compare Listings modal first';
    amazonUploadBtn.disabled = true;
  }
}

async function checkAmazonTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const onAmazon = tab?.url?.includes('amazon-crawler.netlify.app') ?? false;
    amazonSection.classList.toggle('hidden', !onAmazon);
    if (!onAmazon) return;

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
      throw new Error('No products found. Open Compare Listings modal first.');
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
  if (msg.type !== 'AMAZON_COMPARE_UPDATED' || !msg.asins?.length) return;
  amazonSection.classList.remove('hidden');
  const q = msg.searchQuery ? `"${msg.searchQuery}"` : 'unknown query';
  amazonInfo.textContent = `${msg.asins.length} product${msg.asins.length !== 1 ? 's' : ''} · ${q}`;
  amazonUploadBtn.disabled = false;
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  setAuthStatus('loading', 'Checking…');

  try {
    const { ok, email } = await send({ type: 'CHECK_AUTH' });

    if (!ok) {
      setAuthStatus('error', 'Not logged in');
      authError.classList.remove('hidden');
      mainScreen.classList.add('hidden');
      return;
    }

    setAuthStatus('ok', 'Connected');
    authError.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    state.authed = true;

    await loadAccountInfo(email);
    await loadNotebooks();
    checkAmazonTab().catch(() => {});
  } catch (e) {
    setAuthStatus('error', 'Error');
    authError.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

nbSelect.addEventListener('change', () => selectNotebook(nbSelect.value));

refreshNbs.addEventListener('click', async () => {
  refreshNbs.disabled = true;
  try { await loadNotebooks(); } catch {}
  refreshNbs.disabled = false;
});

sendBtn.addEventListener('click', sendQuery);
queryInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendQuery();
  }
});

async function sendChatToGemini(btn, gemId, label) {
  const text = queryInput.value.trim();
  if (!text) return;

  queryInput.value = '';
  queryInput.style.height = 'auto';
  sendBtn.disabled = true;
  geminiBulletsBtn.disabled = true;
  geminiImageBtn.disabled   = true;

  appendMessage('user', text);

  const gemEl = document.createElement('div');
  gemEl.className = 'msg msg-gemini';
  gemEl.innerHTML = `<em class="msg-thinking">Asking ${label}…</em>`;
  messages.appendChild(gemEl);
  messages.scrollTop = messages.scrollHeight;

  try {
    const { content } = await send({ type: 'SEND_TO_GEMINI', text, gemId });
    gemEl.innerHTML = content ? renderMarkdown(content) : '<em>No response received.</em>';
  } catch (e) {
    gemEl.className = 'msg msg-error';
    gemEl.textContent = `Gemini error: ${e.message}`;
  } finally {
    geminiBulletsBtn.disabled = false;
    geminiImageBtn.disabled   = false;
    messages.scrollTop = messages.scrollHeight;
  }
}

geminiBulletsBtn.addEventListener('click', () => sendChatToGemini(geminiBulletsBtn, '9e495ec3e447', 'Bullets'));
geminiImageBtn.addEventListener('click',   () => sendChatToGemini(geminiImageBtn,   '6a7373766848', 'Image'));

chatgptBtn.addEventListener('click', async () => {
  const text = queryInput.value.trim();
  if (!text) return;
  queryInput.value = '';
  queryInput.style.height = 'auto';
  sendBtn.disabled = true;
  chatgptBtn.disabled = true;
  appendMessage('user', text);
  const statusEl = document.createElement('div');
  statusEl.className = 'msg msg-thinking';
  statusEl.textContent = 'Opening ChatGPT…';
  messages.appendChild(statusEl);
  messages.scrollTop = messages.scrollHeight;
  try {
    await send({ type: 'SEND_TO_CHATGPT', text });
    statusEl.textContent = '⬡ Sent to ChatGPT — check the tab';
    statusEl.className = 'msg msg-ai';
    statusEl.style.fontSize = '11px';
  } catch (e) {
    statusEl.textContent = `ChatGPT error: ${e.message}`;
    statusEl.className = 'msg msg-error';
  } finally {
    chatgptBtn.disabled = false;
    messages.scrollTop = messages.scrollHeight;
  }
});

clearChat.addEventListener('click', async () => {
  if (state.conversationId) {
    await send({ type: 'CLEAR_HISTORY', conversationId: state.conversationId }).catch(() => {});
  }
  state.conversationId = null;
  messages.innerHTML = '';
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

addSourceBtn.addEventListener('click', addSource);
sourceUrl.addEventListener('keydown', e => {
  if (e.key === 'Enter') addSource();
});

retryAuth.addEventListener('click', () => {
  authError.classList.add('hidden');
  init();
});

init();
