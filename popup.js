// NotebookLM Assistant - Popup UI

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  authed: false,
  notebooks: [],
  selectedNotebookId: null,
  selectedNotebookTitle: '',
  sources: [],
  conversationId: null,
  sending: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const authDot     = $('auth-dot');
const authLabel   = $('auth-label');
const authError   = $('auth-error');
const mainScreen  = $('main-screen');
const nbSelect    = $('notebook-select');
const nbContent   = $('notebook-content');
const noNotebook  = $('no-notebook');
const messages    = $('messages');
const queryInput  = $('query-input');
const sendBtn     = $('send-btn');
const clearChat   = $('clear-chat');
const sourcesList = $('sources-list');
const sourceUrl   = $('source-url');
const addSourceBtn = $('add-source-btn');
const loading     = $('loading');
const retryAuth   = $('retry-auth');
const refreshNbs  = $('refresh-notebooks');

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

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg msg-${role}`;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
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

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Auto-resize textarea
queryInput.addEventListener('input', () => {
  queryInput.style.height = 'auto';
  queryInput.style.height = Math.min(queryInput.scrollHeight, 80) + 'px';
  sendBtn.disabled = !queryInput.value.trim() || state.sending;
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

  // Restore selection if still valid
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
    return;
  }

  state.selectedNotebookId = id;
  state.conversationId = null; // new notebook = new conversation
  noNotebook.classList.add('hidden');
  nbContent.classList.remove('hidden');

  // Clear chat
  messages.innerHTML = '';

  // Load sources
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
      appendMessage('error', 'No response received. The notebook may be empty.');
    }
  } catch (e) {
    removeEl(thinkingEl);
    const errMsg = e.message.includes('AUTH_EXPIRED')
      ? 'Session expired. Please refresh NotebookLM and try again.'
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
    // Reload sources
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

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  setAuthStatus('loading', 'Checking…');

  try {
    const { ok, reason } = await send({ type: 'CHECK_AUTH' });

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

    await loadNotebooks();
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

// Start
init();
