// Creative Automation - Background Service Worker
// Handles all API calls to notebooklm.google.com

// Open side panel when toolbar icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});


const BASE_URL = 'https://notebooklm.google.com';
const BATCHEXECUTE_URL = `${BASE_URL}/_/LabsTailwindUi/data/batchexecute`;
const QUERY_URL = `${BASE_URL}/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed`;
const BL_FALLBACK = 'boq_labs-tailwind-frontend_20260108.06_p0';

// RPC IDs
const RPC = {
  LIST_NOTEBOOKS:   'wXbhsf',
  GET_NOTEBOOK:     'rLM1Ne',
  CREATE_NOTEBOOK:  'CCqFvf',
  RENAME_NOTEBOOK:  's0tc2d',
  DELETE_NOTEBOOK:  'WWINqb',
  GET_CONVERSATIONS:'hPTbtc',
  ADD_SOURCE_V1:    'izAoDd',
  ADD_SOURCE_V2:    'ozz5Z',
  ADD_SOURCE_FILE:  'o4cbdc',
  DELETE_SOURCE:    'tGMBJ',
};

// In-memory auth state (lost on service worker restart, re-fetched on demand)
let authState = {
  csrfToken: '',
  sessionId: '',
  buildLabel: '',
  lastFetched: 0,
};

// In-memory conversation cache: { conversationId: [{query, answer}] }
let conversationCache = {};

// ─── Auth ───────────────────────────────────────────────────────────────────

async function fetchAuthFromPage() {
  const resp = await fetch(`${BASE_URL}/`, {
    credentials: 'include',
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!resp.ok) {
    throw new Error(`Page fetch failed: ${resp.status}`);
  }

  const html = await resp.text();

  // Redirect to accounts.google.com = not logged in
  if (resp.url.includes('accounts.google.com')) {
    throw new Error('NOT_LOGGED_IN');
  }

  const csrfMatch    = html.match(/"SNlM0e":"([^"]+)"/);
  const sessionMatch = html.match(/"FdrFJe":"([^"]+)"/);
  const blMatch      = html.match(/["']bl["']\s*[:,]\s*["']([^"']+)["']/) ||
                       html.match(/boq_labs-tailwind-frontend_[\d.]+_p\d+/);

  // Extract current account email from page
  const emailPatterns = [
    /"Bkn9E":"([^"@]+@[^"]+)"/,
    /"accountEmail":"([^"@]+@[^"]+)"/,
    /"([^"@\\]+@[^"\\]+\.[^"\\]{2,})" *,? *"[^"]*" *,? *(?:true|1)/,
  ];
  let email = '';
  for (const pat of emailPatterns) {
    const m = html.match(pat);
    if (m && m[1].includes('@')) { email = m[1]; break; }
  }

  authState = {
    csrfToken:  csrfMatch    ? csrfMatch[1]              : '',
    sessionId:  sessionMatch ? sessionMatch[1]            : '',
    buildLabel: blMatch      ? (blMatch[1] || blMatch[0]) : BL_FALLBACK,
    email,
    lastFetched: Date.now(),
  };

  return authState;
}

async function fetchGoogleAccounts() {
  try {
    const resp = await fetch(
      'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard',
      { credentials: 'include' }
    );
    if (!resp.ok) return [];
    let text = await resp.text();
    if (text.startsWith(")]}'")) text = text.slice(4);
    const data = JSON.parse(text.trim());
    // data[1] = array of account entries
    const raw = Array.isArray(data[1]) ? data[1] : [];
    return raw.map((acc, idx) => ({
      index: idx,
      name:     (Array.isArray(acc) && acc[2]) ? acc[2] : '',
      email:    (Array.isArray(acc) && acc[3]) ? acc[3] : '',
      photoUrl: (Array.isArray(acc) && acc[4]) ? acc[4] : '',
    })).filter(a => a.email);
  } catch {
    return [];
  }
}

async function getAuth() {
  // Refresh if stale (> 30 min) or missing CSRF
  const stale = Date.now() - authState.lastFetched > 30 * 60 * 1000;
  if (!authState.csrfToken || stale) {
    await fetchAuthFromPage();
  }
  return authState;
}

// ─── batchexecute protocol ───────────────────────────────────────────────────

function buildBatchBody(rpcId, params, csrfToken) {
  const paramsJson = JSON.stringify(params);
  const fReq = [[[rpcId, paramsJson, null, 'generic']]];
  const fReqEncoded = encodeURIComponent(JSON.stringify(fReq));
  let body = `f.req=${fReqEncoded}`;
  if (csrfToken) body += `&at=${encodeURIComponent(csrfToken)}`;
  body += '&';
  return body;
}

function buildBatchUrl(rpcId, auth, sourcePath = '/') {
  const params = new URLSearchParams({
    rpcids: rpcId,
    'source-path': sourcePath,
    bl: auth.buildLabel || BL_FALLBACK,
    hl: 'en',
    rt: 'c',
  });
  if (auth.sessionId) params.set('f.sid', auth.sessionId);
  return `${BATCHEXECUTE_URL}?${params}`;
}

function parseBatchResponse(text, rpcId) {
  // Strip anti-XSSI prefix
  if (text.startsWith(")]}'")) text = text.slice(4);

  const lines = text.trim().split('\n');
  const chunks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (/^\d+$/.test(line)) {
      i++;
      if (i < lines.length) {
        try { chunks.push(JSON.parse(lines[i])); } catch {}
        i++;
      }
    } else {
      try { chunks.push(JSON.parse(line)); } catch {}
      i++;
    }
  }

  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue;
    for (const item of chunk) {
      if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcId) {
        // Check for API errors in item[5]
        if (Array.isArray(item[5]) && item[5].length > 0 && typeof item[5][0] === 'number') {
          const code = item[5][0];
          if (code === 16) throw new Error('AUTH_EXPIRED');
          throw new Error(`API_ERROR:${code}`);
        }
        const resultStr = item[2];
        if (typeof resultStr === 'string') {
          try { return JSON.parse(resultStr); } catch { return resultStr; }
        }
        return resultStr;
      }
    }
  }
  return null;
}

async function callRpc(rpcId, params, sourcePath = '/') {
  const auth = await getAuth();
  const url = buildBatchUrl(rpcId, auth, sourcePath);
  const body = buildBatchBody(rpcId, params, auth.csrfToken);

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      // Force re-auth on next call
      authState.csrfToken = '';
      authState.lastFetched = 0;
      throw new Error('AUTH_EXPIRED');
    }
    throw new Error(`HTTP ${resp.status}`);
  }

  return parseBatchResponse(await resp.text(), rpcId);
}

// ─── Notebooks ───────────────────────────────────────────────────────────────

async function listNotebooks() {
  const result = await callRpc(RPC.LIST_NOTEBOOKS, [null, 1, null, [2]]);
  if (!result || !Array.isArray(result)) return [];

  const nbList = Array.isArray(result[0]) ? result[0] : result;
  return nbList
    .filter(nb => Array.isArray(nb) && nb.length >= 3)
    .map(nb => {
      const meta = Array.isArray(nb[5]) ? nb[5] : [];
      return {
        id: nb[2] || '',
        title: nb[0] || 'Untitled',
        sourceCount: Array.isArray(nb[1]) ? nb[1].length : 0,
        isOwned: meta[0] !== 2,
      };
    })
    .filter(nb => nb.id);
}

async function getNotebook(notebookId) {
  const result = await callRpc(
    RPC.GET_NOTEBOOK,
    [notebookId, null, [2], null, 0],
    `/notebook/${notebookId}`
  );
  return result;
}

function extractSourceIds(notebookData) {
  const ids = [];
  if (!Array.isArray(notebookData)) return ids;
  try {
    const info = notebookData[0];
    if (!Array.isArray(info) || !Array.isArray(info[1])) return ids;
    for (const src of info[1]) {
      if (Array.isArray(src) && Array.isArray(src[0]) && typeof src[0][0] === 'string') {
        ids.push(src[0][0]);
      }
    }
  } catch {}
  return ids;
}

function extractSources(notebookData) {
  const sources = [];
  if (!Array.isArray(notebookData)) return sources;
  try {
    const info = notebookData[0];
    if (!Array.isArray(info) || !Array.isArray(info[1])) return sources;
    for (const src of info[1]) {
      if (!Array.isArray(src)) continue;
      const id = Array.isArray(src[0]) ? src[0][0] : null;
      const title = src[1] || 'Untitled';
      // src[2] metadata might contain URL etc.
      sources.push({ id, title });
    }
  } catch {}
  return sources;
}

// ─── Query / Chat ────────────────────────────────────────────────────────────

function buildConversationHistory(conversationId) {
  const turns = conversationCache[conversationId];
  if (!turns || turns.length === 0) return null;
  const history = [];
  for (const turn of turns) {
    history.push([turn.answer, null, 2]);
    history.push([turn.query, null, 1]);
  }
  return history;
}

function parseQueryResponse(text) {
  if (text.startsWith(")]}'")) text = text.slice(4);

  const lines = text.trim().split('\n');
  let longestAnswer = '';
  let longestThinking = '';
  let serverConvId = null;

  function processChunk(jsonStr) {
    let data;
    try { data = JSON.parse(jsonStr); } catch { return; }
    if (!Array.isArray(data)) return;

    for (const item of data) {
      if (!Array.isArray(item) || item[0] !== 'wrb.fr' || item[2] == null) continue;
      let nested;
      try { nested = JSON.parse(item[2]); } catch { continue; }
      if (!Array.isArray(nested) || !Array.isArray(nested[0])) continue;

      const first = nested[0];
      const text = typeof first[0] === 'string' ? first[0] : null;
      if (!text) continue;

      // type code at first[4][4]: 1 = answer, 2 = thinking
      let isAnswer = true;
      try { isAnswer = first[4][4] !== 2; } catch {}

      // Extract server conversation ID from first[2][0]
      try {
        if (Array.isArray(first[2]) && typeof first[2][0] === 'string') {
          serverConvId = first[2][0];
        }
      } catch {}

      if (isAnswer && text.length > longestAnswer.length) {
        longestAnswer = text;
      } else if (!isAnswer && text.length > longestThinking.length) {
        longestThinking = text;
      }
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (/^\d+$/.test(line)) {
      i++;
      if (i < lines.length) { processChunk(lines[i]); i++; }
    } else {
      processChunk(line);
      i++;
    }
  }

  return {
    answer: longestAnswer || longestThinking,
    serverConvId,
  };
}

async function getConversationId(notebookId) {
  try {
    const result = await callRpc(
      RPC.GET_CONVERSATIONS,
      [[], null, notebookId, 20],
      `/notebook/${notebookId}`
    );
    if (Array.isArray(result) && Array.isArray(result[0])) {
      const l1 = result[0][0];
      if (typeof l1 === 'string') return l1;
      if (Array.isArray(l1) && typeof l1[0] === 'string') return l1[0];
    }
  } catch {}
  return null;
}

async function queryNotebook(notebookId, queryText, conversationId) {
  const auth = await getAuth();

  // Get notebook sources
  const nbData = await getNotebook(notebookId);
  const sourceIds = extractSourceIds(nbData);
  const sourcesArray = sourceIds.map(id => [[id]]);

  // Resolve conversation ID
  let convId = conversationId;
  let isNew = false;
  if (!convId) {
    convId = await getConversationId(notebookId);
    isNew = true;
    if (!convId) {
      convId = crypto.randomUUID();
      isNew = true;
    }
  }

  const history = buildConversationHistory(convId);

  const params = [
    sourcesArray,
    queryText,
    history,
    [2, null, [1]],
    convId,
  ];

  const paramsJson = JSON.stringify(params);
  const fReq = [null, paramsJson];
  let body = `f.req=${encodeURIComponent(JSON.stringify(fReq))}`;
  if (auth.csrfToken) body += `&at=${encodeURIComponent(auth.csrfToken)}`;
  body += '&';

  const reqid = Math.floor(Math.random() * 900000) + 100000;
  const urlParams = new URLSearchParams({
    bl: auth.buildLabel || BL_FALLBACK,
    hl: 'en',
    _reqid: String(reqid),
    rt: 'c',
  });
  if (auth.sessionId) urlParams.set('f.sid', auth.sessionId);

  const resp = await fetch(`${QUERY_URL}?${urlParams}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });

  if (!resp.ok) throw new Error(`Query failed: ${resp.status}`);

  const { answer, serverConvId } = parseQueryResponse(await resp.text());

  // Update conversation cache
  const finalConvId = serverConvId || convId;
  if (answer) {
    if (!conversationCache[finalConvId]) conversationCache[finalConvId] = [];
    conversationCache[finalConvId].push({ query: queryText, answer });
    // Keep last 20 turns
    if (conversationCache[finalConvId].length > 20) {
      conversationCache[finalConvId] = conversationCache[finalConvId].slice(-20);
    }
  }

  return { answer, conversationId: finalConvId };
}

// ─── Sources ─────────────────────────────────────────────────────────────────

async function addUrlSource(notebookId, url) {
  const isYoutube = /youtube\.com|youtu\.be/i.test(url);
  const sourceData = isYoutube
    ? [null, null, null, null, null, null, null, [url], null, null, 1]
    : [null, null, [url], null, null, null, null, null, null, null, 1];

  const params = [
    [sourceData],
    notebookId,
    [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];

  const result = await callRpc(RPC.ADD_SOURCE_V1, params, `/notebook/${notebookId}`);
  return result;
}

// ─── Gemini Integration ──────────────────────────────────────────────────────

const GEMINI_BASE = 'https://gemini.google.com';
const GEMINI_STREAM = `${GEMINI_BASE}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`;
const GEMS = {
  bullets: '9e495ec3e447',
  image:   '6a7373766848',
};
const GEM_ID  = GEMS.bullets;   // used for auth page fetch
const GEM_URL = `${GEMINI_BASE}/gem/${GEM_ID}`;

let geminiAuth = {
  SNlM0e: '', bl: '',
  conversationId: '', responseId: '', choiceId: '',
  lastFetched: 0,
};

async function fetchGeminiPage() {
  const resp = await fetch(GEM_URL, {
    credentials: 'include',
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  if (!resp.ok) throw new Error(`Gemini page fetch failed: ${resp.status}`);
  if (resp.url.includes('accounts.google.com')) throw new Error('NOT_LOGGED_IN_GEMINI');

  const html = await resp.text();

  const snlm0e = html.match(/"SNlM0e":"([^"]+)"/)?.[1] || '';
  if (!snlm0e) throw new Error('Could not extract Gemini SNlM0e');

  const blMatch = html.match(/"bl"\s*:\s*"([^"]+)"/) || html.match(/boq_assistant-bard-web-server_[\d.]+_p\d+/);
  const bl = blMatch ? (blMatch[1] || blMatch[0]) : 'boq_assistant-bard-web-server_20240625.13_p0';

  geminiAuth = { ...geminiAuth, SNlM0e: snlm0e, bl, lastFetched: Date.now() };
  return geminiAuth;
}

async function getGeminiAuth() {
  if (!geminiAuth.SNlM0e || Date.now() - geminiAuth.lastFetched > 25 * 60 * 1000) {
    await fetchGeminiPage();
  }
  return geminiAuth;
}

function stripForGemini(text) {
  return text
    .replace(/\[[\d,\s–\-]+\]/g, '')        // remove [10] [1,2] citations
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')     // **bold** → plain
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)/g, '$1') // *italic* → plain
    .replace(/^#{1,6}\s+/gm, '')             // ## headings → plain
    .replace(/ {2,}/g, ' ')
    .trim();
}

function cleanGeminiResponse(text) {
  if (!text) return '';
  // Only strip lines that are clearly boilerplate intro labels (end with ":" and mention
  // analysis/summary/sources/listing — never strip actual content sentences)
  text = text.replace(
    /^(?:Here is|Here are|Below is|The following is)\s[^:\n]{0,120}(?:analysis|summary|breakdown|listing|provided sources|exclusively)[^:\n]{0,80}:\s*/i,
    ''
  );
  // Strip [N] citations
  text = text.replace(/\[[\d,\s–\-]+\]/g, '');
  return text.trim();
}

function makeUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16).toUpperCase();
  });
}

async function sendToGemini(rawText, gemId = GEMS.bullets) {
  const auth = await getGeminiAuth();
  const text = stripForGemini(rawText);
  const sid = makeUUID();
  const gemUrl = `${GEMINI_BASE}/gem/${gemId}`;

  // Conversation context: 10-element array (positions 0,1,9 hold IDs for continuation)
  const convCtx = geminiAuth.conversationId
    ? [geminiAuth.conversationId, geminiAuth.responseId || '', geminiAuth.choiceId || '',
       null, null, null, null, null, null, '']
    : ['', '', '', null, null, null, null, null, null, ''];

  // Inner array structure reverse-engineered from real curl.
  // Gem ID sits at index 19; session UUID at index 59.
  // Indices 0-80 = 81 elements total.
  const inner = [
    [text, 0, null, null, null, null, 0],                              // [0]  message
    ['en'],                                                             // [1]  language
    convCtx,                                                            // [2]  conversation (10-elem)
    null, null, null,                                                   // [3-5]
    [1], 1, null, null, 1, 0,                                         // [6-11]
    null, null, null, null, null,                                       // [12-16]
    [[0]], 0,                                                           // [17-18]
    gemId,                                                              // [19] ← gem ID
    null, null, null, null, null, null, null,                          // [20-26]
    1, null, null,                                                      // [27-29]
    [4],                                                                // [30]
    null, null, null, null, null, null, null, null, null, null,        // [31-40]
    [1],                                                                // [41]
    null, null, null, null, null, null, null, null, null, null, null,  // [42-52]
    0,                                                                  // [53]
    null, null, null, null, null,                                       // [54-58]
    sid,                                                                // [59] session UUID
    null, [],                                                           // [60-61]
    null, null, null, null, null,                                       // [62-66]
    0, 2,                                                               // [67-68]
    null, null, null, null, null, null, null, null, null, null,        // [69-78]
    1, 1,                                                               // [79-80]
  ];

  const params = new URLSearchParams({
    bl:     auth.bl,
    _reqid: String(Math.floor(Math.random() * 900000) + 100000),
    rt:     'c',
  });

  const body = new URLSearchParams({
    'f.req': JSON.stringify([null, JSON.stringify(inner)]),
    'at':    auth.SNlM0e,
  });

  const resp = await fetch(`${GEMINI_STREAM}?${params}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type':               'application/x-www-form-urlencoded;charset=utf-8',
      'Origin':                     GEMINI_BASE,
      'Referer':                    gemUrl,
      'X-Same-Domain':              '1',
      'x-goog-ext-525001261-jspb':  `[1,null,null,null,"56fdd199312815e2",null,null,0,[4,5,6,8],null,null,2,null,null,1,1,"${sid}"]`,
      'x-goog-ext-525005358-jspb':  `["${sid}",1]`,
      'x-goog-ext-73010989-jspb':   '[0]',
      'x-goog-ext-73010990-jspb':   '[0,0,0]',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      geminiAuth.SNlM0e = '';
      throw new Error('GEMINI_AUTH_EXPIRED');
    }
    throw new Error(`Gemini HTTP ${resp.status}`);
  }

  const raw = await resp.text();
  const content = parseGeminiResponse(raw);
  if (!content) {
    throw new Error(`Parse failed. Raw[0..300]: ${raw.slice(0, 300)}`);
  }
  return cleanGeminiResponse(content);
}

function parseGeminiResponse(raw) {
  // Scan every line that starts with '[' — handles plain and length-prefixed formats.
  // Each such line is: [["wrb.fr","StreamGenerate","{innerJson}",...], ["di",...], ...]
  // The wrb.fr ENTRY is `chunk` itself (not nested inside it).
  let bestContent = null;

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('[')) continue;
    let outer;
    try { outer = JSON.parse(t); } catch { continue; }
    if (!Array.isArray(outer)) continue;

    for (const chunk of outer) {
      if (!Array.isArray(chunk) || chunk[0] !== 'wrb.fr') continue;
      const jsonStr = chunk[2];
      if (typeof jsonStr !== 'string') continue;
      let inner;
      try { inner = JSON.parse(jsonStr); } catch { continue; }

      // Try multiple content paths for forward compatibility
      const content =
        inner?.[4]?.[0]?.[1]?.[0] ??   // classic Bard path
        inner?.[4]?.[0]?.[1] ??          // without trailing index
        inner?.[2]?.[0]?.[0]?.[0] ??    // alternate newer path
        null;

      if (typeof content === 'string' && content.length > (bestContent?.length ?? 0)) {
        bestContent = content;
        if (inner[1]?.[0]) geminiAuth.conversationId = inner[1][0];
        if (inner[1]?.[1]) geminiAuth.responseId     = inner[1][1];
        if (inner[4]?.[0]?.[0]) geminiAuth.choiceId  = inner[4][0][0];
      }
    }
  }

  return bestContent;
}

// ─── ChatGPT DOM injection ───────────────────────────────────────────────────

const CHATGPT_GPT_URL = 'https://chatgpt.com/g/g-69080c3e90808191a324742811037c96-product-description';

async function sendToChatGPT(text) {
  // Find existing GPT tab or open a new one
  const allTabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  const existing = allTabs.find(t => t.url?.includes('g-69080c3e90808191a324742811037c96'));

  let tabId;
  let needsLoad = false;

  if (existing) {
    tabId = existing.id;
    await chrome.tabs.update(tabId, { active: true });
    const tabInfo = await chrome.tabs.get(tabId);
    await chrome.windows.update(tabInfo.windowId, { focused: true });
  } else {
    const tab = await chrome.tabs.create({ url: CHATGPT_GPT_URL });
    tabId = tab.id;
    needsLoad = true;
  }

  if (needsLoad) {
    // Wait for page to reach 'complete'
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ChatGPT load timeout')), 30000);
      const fn = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(t);
          chrome.tabs.onUpdated.removeListener(fn);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(fn);
    });
    // Extra wait for React / ChatGPT JS to finish mounting
    await new Promise(r => setTimeout(r, 2500));
  }

  // Focus tab then inject
  await chrome.tabs.update(tabId, { active: true });

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (inputText) => {
      const editor = document.querySelector('#prompt-textarea');
      if (!editor) return { ok: false, reason: 'editor not found' };

      editor.focus();
      editor.click();

      // Clear then insert into ProseMirror via execCommand
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      const ok = document.execCommand('insertText', false, inputText);

      if (!ok) {
        // Fallback: set p content directly and fire input event
        const p = document.querySelector('#prompt-textarea > p');
        if (p) {
          p.textContent = inputText;
          p.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: inputText }));
        }
      }

      setTimeout(() => {
        const btn = document.querySelector('#composer-submit-button');
        if (btn && !btn.disabled) btn.click();
      }, 300);

      return { ok: true };
    },
    args: [text],
  });

  return result?.result ?? { ok: false };
}

// ─── Amazon Upload ───────────────────────────────────────────────────────────

let uploadJob = { status: 'idle', progress: null, result: null, error: null };

const UPLOAD_SETTLE_MS = 1500;
const PRODUCT_SETTLE_MS = 3000;
const METADATA_SETTLE_MS = 2500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadBlobToNotebook(notebookId, filename, blob, settleMs = UPLOAD_SETTLE_MS) {
  const regParams = [
    [[filename]], notebookId, [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];
  const regResult = await callRpc(RPC.ADD_SOURCE_FILE, regParams, `/notebook/${notebookId}`);

  function extractId(data) {
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data.length > 0) return extractId(data[0]);
    return null;
  }
  const sourceId = extractId(regResult);
  if (!sourceId) throw new Error(`No source ID for ${filename}`);

  const initBody = JSON.stringify({ PROJECT_ID: notebookId, SOURCE_NAME: filename, SOURCE_ID: sourceId });
  const initResp = await fetch(`${BASE_URL}/upload/_/?authuser=0`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
      'x-goog-authuser': '0',
      'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': String(blob.size),
      'x-goog-upload-protocol': 'resumable',
    },
    body: initBody,
  });
  if (!initResp.ok) throw new Error(`Upload session failed: ${initResp.status}`);

  const uploadUrl = initResp.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('No upload URL received');

  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
      'x-goog-authuser': '0',
      'x-goog-upload-command': 'upload, finalize',
      'x-goog-upload-offset': '0',
    },
    body: blob,
  });
  if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);

  if (settleMs > 0) {
    uploadJob.progress.step = `Finalizing ${filename}...`;
    await sleep(settleMs);
  }
}

async function runAmazonUpload({ asins, brandMap, titleMap, domain, searchQuery, prefs }) {
  const p = { amazonLink: true, brand: true, title: true, pdfListing: true, bulletPoints: true, images: true, ...prefs };
  const notebookTitle = (searchQuery || 'Amazon Search').trim();
  const CONVERT_PDF_API = 'https://amazon-api.bluestars.vn/convert-to-pdf';

  uploadJob.progress = { step: `Creating notebook "${notebookTitle}"…`, done: 0, total: asins.length };

  const createParams = [
    notebookTitle, null, null, [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];
  const createResult = await callRpc(RPC.CREATE_NOTEBOOK, createParams);
  if (!createResult || !Array.isArray(createResult) || !createResult[2]) {
    throw new Error('Failed to create notebook');
  }
  const notebookId = createResult[2];

  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  const domainName = domain.toUpperCase() === 'COM' ? 'US' : domain.toUpperCase();
  let metadataContent = `# Product Listings – ${notebookTitle}\n\n`;
  metadataContent += `**Generated:** ${timestamp}\n`;
  metadataContent += `**Amazon Domain:** amazon.${domain} (${domainName})\n`;
  metadataContent += `**Total Products:** ${asins.length}\n\n---\n\n`;

  for (let i = 0; i < asins.length; i++) {
    const asin = asins[i];
    uploadJob.progress = { step: `Processing ${i + 1}/${asins.length}: ${asin}`, done: i, total: asins.length };

    const brand = (brandMap && brandMap[asin]) || 'N/A';
    const title = (titleMap && titleMap[asin]) || 'N/A';

    let bulletPoints = [];
    if (p.bulletPoints) {
      try {
        const r = await fetch(`https://amazon-api.bluestars.vn/keepa?asin=${asin}&domain=${domain}`);
        const d = await r.json();
        bulletPoints = d?.data?.asin?.features || [];
      } catch {}
    }

    if (p.pdfListing) {
      uploadJob.progress.step = `Generating PDF for ${asin} (${i + 1}/${asins.length})…`;
      try {
        const pdfResp = await fetch(CONVERT_PDF_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: `https://www.amazon.${domain}/dp/${asin}`, domain }),
        });
        if (pdfResp.ok) {
          const pdfBlob = await pdfResp.blob();
          uploadJob.progress.step = `Uploading PDF for ${asin} (${i + 1}/${asins.length})…`;
          await uploadBlobToNotebook(notebookId, `${asin}.pdf`, pdfBlob);
        }
      } catch (e) {
        console.error(`PDF failed for ${asin}:`, e.message);
      }
    }

    if (p.images) {
      try {
        const imgResp = await fetch('https://amazon-api.bluestars.vn/batch-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
          body: JSON.stringify({ asins: [asin], domain }),
        });
        const imgData = await imgResp.json();
        const urls = (imgData?.data?.[0]?.imageUrlList || [])
          .filter(u => typeof u === 'string' && u.startsWith('http'));
        for (let j = 0; j < urls.length; j++) {
          uploadJob.progress.step = `Uploading image ${j + 1}/${urls.length} for ${asin}…`;
          try {
            const imgFetch = await fetch(urls[j]);
            if (!imgFetch.ok) continue;
            const imgBlob = await imgFetch.blob();
            await uploadBlobToNotebook(notebookId, `${asin}-${j + 1}.jpg`, imgBlob);
          } catch (e) {
            console.error(`Image ${j + 1} upload failed for ${asin}:`, e.message);
          }
        }
      } catch (e) {
        console.error(`Image fetch failed for ${asin}:`, e.message);
      }
    }

    metadataContent += `## ${asin}\n\n`;
    if (p.amazonLink)   metadataContent += `**Amazon Link:** https://www.amazon.${domain}/dp/${asin}\n\n`;
    if (p.brand)        metadataContent += `**Brand:** ${brand}\n\n`;
    if (p.title)        metadataContent += `**Title:** ${title}\n\n`;
    if (p.bulletPoints && bulletPoints.length > 0) {
      metadataContent += `**Bullet Points:**\n\n`;
      bulletPoints.forEach((pt, k) => { metadataContent += `${k + 1}. ${pt}\n`; });
      metadataContent += '\n';
    }
    metadataContent += '---\n\n';

    uploadJob.progress.done = i + 1;

    if (i < asins.length - 1) {
      uploadJob.progress.step = 'Letting uploads settle before next product...';
      await sleep(PRODUCT_SETTLE_MS);
    }
  }

  uploadJob.progress.step = 'Uploading metadata…';
  const metaBlob = new Blob([metadataContent], { type: 'text/plain' });
  await uploadBlobToNotebook(notebookId, 'metadata.md', metaBlob, METADATA_SETTLE_MS);

  uploadJob.progress.step = 'Waiting for sources to index…';
  await sleep(4000);

  uploadJob.progress.step = 'Querying AI for analysis…';
  const analysisPrompt =
`You are analyzing replacement listings for ${notebookTitle}. Based ONLY on the provided sources, extract and summarize the following information in a clear and structured manner:
1. Dimensions and Electrical Specifications (if applicable and supported in the provided sources).
2. Function of the part: Describe the role and purpose of the part.
3. Customer Pain Points: Identify issues or problems customers typically face that this product resolves.
4. Common Symptoms it Fixes: List the common symptoms or issues this part addresses, based on customer complaints and product descriptions.
5. Unique Selling Proposition (USP): Highlight what makes this part stand out from competitors.
6. Material Composition: Provide details about the materials used in the part (if mentioned).
7. Compatibility: Which part numbers does it replace? Which brands and models is it compatible with? List all supported models and brands fully; do not infer compatibility with unsupported model numbers. Be as specific as possible.
8. Installation Process (4 steps): Provide a step-by-step guide for installation (based on the provided YouTube link). Each step should be ≤ 15 words and only include steps directly referenced in the video. Required tools (list any specific tools needed for installation). Safety notes (any critical safety tips or warnings during installation).`;

  let answer = null;
  let conversationId = null;
  try {
    const qResult = await queryNotebook(notebookId, analysisPrompt, null);
    answer = qResult.answer;
    conversationId = qResult.conversationId;
  } catch (e) {
    console.error('Auto-analysis query failed:', e.message);
  }

  return { notebookId, title: notebookTitle, answer, conversationId };
}

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err => {
    sendResponse({ error: err.message || String(err) });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'CHECK_AUTH': {
      try {
        await fetchAuthFromPage();
        return { ok: true, email: authState.email };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    }

    case 'GET_ACCOUNTS': {
      const [accounts, auth] = await Promise.all([
        fetchGoogleAccounts(),
        getAuth(),
      ]);
      return { accounts, currentEmail: auth.email };
    }

    case 'LIST_NOTEBOOKS': {
      const notebooks = await listNotebooks();
      return { notebooks };
    }

    case 'CREATE_NOTEBOOK': {
      const params = [
        msg.title || 'Untitled notebook',
        null, null, [2],
        [1, null, null, null, null, null, null, null, null, null, [1]],
      ];
      const result = await callRpc(RPC.CREATE_NOTEBOOK, params);
      if (result && Array.isArray(result) && result[2]) {
        return { ok: true, id: result[2], title: msg.title };
      }
      throw new Error('Failed to create notebook');
    }

    case 'RENAME_NOTEBOOK': {
      const params = [msg.notebookId, [[null, null, null, [null, msg.newTitle]]]];
      await callRpc(RPC.RENAME_NOTEBOOK, params, `/notebook/${msg.notebookId}`);
      return { ok: true };
    }

    case 'PREPARE_FILE_UPLOAD': {
      // Step 1: Register file source → get SOURCE_ID
      const regParams = [
        [[msg.filename]],
        msg.notebookId,
        [2],
        [1, null, null, null, null, null, null, null, null, null, [1]],
      ];
      const regResult = await callRpc(
        RPC.ADD_SOURCE_FILE, regParams, `/notebook/${msg.notebookId}`
      );

      function extractId(data) {
        if (typeof data === 'string') return data;
        if (Array.isArray(data) && data.length > 0) return extractId(data[0]);
        return null;
      }
      const sourceId = extractId(regResult);
      if (!sourceId) throw new Error('Step 1 (register) failed — no SOURCE_ID in response');

      // Step 2: Start resumable upload session → get upload URL
      const initBody = JSON.stringify({
        PROJECT_ID: msg.notebookId,
        SOURCE_NAME: msg.filename,
        SOURCE_ID: sourceId,
      });

      const initResp = await fetch(`${BASE_URL}/upload/_/?authuser=0`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/`,
          'x-goog-authuser': '0',
          'x-goog-upload-command': 'start',
          'x-goog-upload-header-content-length': String(msg.fileSize),
          'x-goog-upload-protocol': 'resumable',
        },
        body: initBody,
      });
      if (!initResp.ok) throw new Error(`Step 2 (session start) failed: ${initResp.status}`);

      const uploadUrl = initResp.headers.get('x-goog-upload-url');
      if (!uploadUrl) throw new Error('Step 2 — no x-goog-upload-url header');

      // Return the upload URL to the sidepanel — step 3 runs there so the
      // File object never has to cross the message channel.
      return { uploadUrl };
    }

    case 'GET_NOTEBOOK': {
      const nbData = await getNotebook(msg.notebookId);
      const sources = extractSources(nbData);
      return { sources };
    }

    case 'QUERY': {
      const { answer, conversationId } = await queryNotebook(
        msg.notebookId,
        msg.query,
        msg.conversationId || null
      );
      return { answer, conversationId };
    }

    case 'ADD_URL_SOURCE': {
      const result = await addUrlSource(msg.notebookId, msg.url);
      return { ok: true, result };
    }

    case 'GET_HISTORY': {
      const turns = conversationCache[msg.conversationId] || [];
      return { turns };
    }

    case 'CLEAR_HISTORY': {
      delete conversationCache[msg.conversationId];
      return { ok: true };
    }

    case 'AMAZON_UPLOAD': {
      if (uploadJob.status === 'running') {
        return { error: 'Upload already in progress' };
      }
      uploadJob = { status: 'running', progress: { step: 'Starting…', done: 0, total: msg.asins?.length || 0 }, result: null, error: null };
      runAmazonUpload(msg).then(result => {
        uploadJob = { status: 'done', progress: { step: 'Done', done: msg.asins?.length || 0, total: msg.asins?.length || 0 }, result, error: null };
      }).catch(err => {
        uploadJob = { status: 'error', progress: uploadJob.progress, result: null, error: err.message };
      });
      return { ok: true, started: true };
    }

    case 'GET_UPLOAD_PROGRESS': {
      return { job: uploadJob };
    }

    case 'SEND_TO_GEMINI': {
      const content = await sendToGemini(msg.text, msg.gemId || GEMS.bullets);
      return { content };
    }

    case 'SEND_TO_CHATGPT': {
      const result = await sendToChatGPT(stripForGemini(msg.text));
      return result;
    }


    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
