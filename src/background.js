importScripts("shared.js");

const SCRIPT_ID = "page-title-bar";
const { DEFAULTS, normalizePatterns } = PageTitleBarConfig;

async function registeredScriptExists() {
  const scripts = await chrome.scripting.getRegisteredContentScripts({
    ids: [SCRIPT_ID],
  });
  return scripts.length > 0;
}

async function syncContentScript() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const patterns = normalizePatterns(stored.patterns);

  if (await registeredScriptExists()) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  if (patterns.length === 0) return;

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: patterns,
      js: ["src/content-script.js"],
      runAt: "document_start",
      persistAcrossSessions: true,
    },
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  syncContentScript().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  syncContentScript().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "sync-content-script") return false;
  syncContentScript()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
