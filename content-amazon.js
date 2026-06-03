// Content script for amazon-crawler.netlify.app
// Reads compare state from localStorage and responds to extension messages

function readState() {
  return {
    asins:       JSON.parse(localStorage.getItem('nlmCompareAsins')   || '[]'),
    domain:      localStorage.getItem('nlmCompareDomain')              || localStorage.getItem('amazonDomain') || 'com',
    brandMap:    JSON.parse(localStorage.getItem('nlmCompareBrandMap') || '{}'),
    titleMap:    JSON.parse(localStorage.getItem('nlmCompareTitleMap') || '{}'),
    searchQuery: localStorage.getItem('searchQuery')                   || 'Amazon Search',
    prefs:       JSON.parse(localStorage.getItem('downloadListingsPreferences') || '{}'),
  };
}

// Respond to on-demand queries from the sidepanel
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'GET_AMAZON_COMPARE_STATE') return;
  try { sendResponse(readState()); }
  catch { sendResponse({ asins: [], domain: 'com', brandMap: {}, titleMap: {}, searchQuery: 'Amazon Search', prefs: {} }); }
  return true;
});

// Poll for nlmCompareAsins appearing/changing — fires as soon as the compare modal opens
let _lastRaw = undefined;
setInterval(() => {
  try {
    const raw = localStorage.getItem('nlmCompareAsins');
    if (raw === _lastRaw) return;
    _lastRaw = raw;
    if (!raw) return;
    chrome.runtime.sendMessage({ type: 'AMAZON_COMPARE_UPDATED', ...readState() });
  } catch {}
}, 500);
