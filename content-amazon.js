// Content script for amazon-crawler.netlify.app
// Reads compare state from localStorage and responds to extension messages.

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); }
  catch { return fallback; }
}

function readState() {
  return {
    asins:       parseJson(localStorage.getItem('nlmCompareAsins'), []),
    domain:      localStorage.getItem('nlmCompareDomain') || localStorage.getItem('amazonDomain') || 'com',
    brandMap:    parseJson(localStorage.getItem('nlmCompareBrandMap'), {}),
    titleMap:    parseJson(localStorage.getItem('nlmCompareTitleMap'), {}),
    searchQuery: localStorage.getItem('searchQuery') || 'Amazon Search',
    prefs:       parseJson(localStorage.getItem('downloadListingsPreferences'), {}),
  };
}

// Respond to on-demand queries from the sidepanel
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'GET_AMAZON_COMPARE_STATE') return;
  try { sendResponse(readState()); }
  catch { sendResponse({ asins: [], domain: 'com', brandMap: {}, titleMap: {}, searchQuery: 'Amazon Search', prefs: {} }); }
  return true;
});

// Poll localStorage and update the extension when the compare modal opens/closes or changes.
let _lastSignature = undefined;
setInterval(() => {
  try {
    const state = readState();
    const signature = JSON.stringify({
      asins: state.asins,
      domain: state.domain,
      brandMap: state.brandMap,
      titleMap: state.titleMap,
      searchQuery: state.searchQuery,
      prefs: state.prefs,
    });
    if (signature === _lastSignature) return;
    _lastSignature = signature;
    chrome.runtime.sendMessage({ type: 'AMAZON_COMPARE_UPDATED', ...state });
  } catch {}
}, 500);
