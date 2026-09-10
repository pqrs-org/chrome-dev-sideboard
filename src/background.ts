'use strict'

importScripts('network-stats.js', 'cookie-store.js', 'storage-background.js')

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error)

const { keyForTab, normalizeEvent, reduce } = PageNetworkStats
const tabActionQueue = new Map<number, Promise<void>>()

// tabId is Chrome's integer identifier for a tab, not its position in the window.
// It is unique within a browser session and stays the same across reordering,
// ordinary navigation, and reloads; do not treat it as persistent across restarts.
const enqueueTabAction = (tabId: number, action: () => Promise<void>) => {
  // webRequest uses -1 for requests not associated with a tab; skip those.
  if (tabId < 0) {
    return
  }
  const next = (tabActionQueue.get(tabId) || Promise.resolve())
    .then(action)
    .catch(console.error)
    .finally(() => {
      if (tabActionQueue.get(tabId) === next) {
        tabActionQueue.delete(tabId)
      }
    })
  tabActionQueue.set(tabId, next)
}

const recordNetworkEvent = (
  kind: NetworkKind,
  details: NetworkDetails,
): undefined => {
  if (details.tabId < 0) {
    return
  }
  // Extract only measurements before queuing; do not retain header contents.
  const event = normalizeEvent(kind, details)
  enqueueTabAction(details.tabId, async () => {
    const key = keyForTab(details.tabId)
    // storage.session keeps data in Chrome-managed memory across service worker
    // shutdowns; ordinary variables would lose the accumulated measurements.
    // After about 30 seconds without events or extension API calls, Chrome can
    // stop the worker. A later matching webRequest event wakes it, reruns this
    // script, and reaches this handler, which resumes from the saved measurements.
    // It is cleared on browser restart, not persisted to disk like storage.local.
    // The side panel reads this state and receives updates via storage.onChanged.
    const stored =
      await chrome.storage.session.get<Record<string, NetworkState>>(key)
    const state = reduce(stored[key], event)
    if (state) {
      await chrome.storage.session.set({ [key]: state })
    } else if (stored[key]) {
      await chrome.storage.session.remove(key)
    }
  })
}

// Register listeners synchronously so Chrome can dispatch the event that wakes
// the worker after it has been stopped.
const filter = { urls: ['http://*/*', 'https://*/*'] }
chrome.webRequest.onBeforeRequest.addListener(
  (d) => recordNetworkEvent('start', d),
  filter,
)
chrome.webRequest.onHeadersReceived.addListener(
  (d) => recordNetworkEvent('headers', d),
  filter,
  ['responseHeaders'],
)
// Invalidate intermediate response metadata already recorded by the headers event.
chrome.webRequest.onBeforeRedirect.addListener(
  (d) => recordNetworkEvent('redirect', d),
  filter,
)
chrome.webRequest.onCompleted.addListener(
  (d) => recordNetworkEvent('complete', d),
  filter,
)
chrome.webRequest.onErrorOccurred.addListener(
  (d) => recordNetworkEvent('error', d),
  filter,
)

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    recordNetworkEvent('commit', details)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueueTabAction(tabId, () => chrome.storage.session.remove(keyForTab(tabId)))
})

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  enqueueTabAction(removedTabId, () =>
    chrome.storage.session.remove(keyForTab(removedTabId)),
  )
  enqueueTabAction(addedTabId, () =>
    chrome.storage.session.remove(keyForTab(addedTabId)),
  )
})
