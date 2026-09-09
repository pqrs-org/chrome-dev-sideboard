'use strict'

importScripts('network-stats.js', 'cookie-store.js', 'storage-background.js')

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error)

const { keyForTab, normalizeEvent, reduce } = PageNetworkStats
const queues = new Map<number, Promise<void>>()

const enqueue = (tabId: number, action: () => Promise<void>) => {
  if (tabId < 0) {
    return
  }
  const next = (queues.get(tabId) || Promise.resolve())
    .then(action)
    .catch(console.error)
    .finally(() => {
      if (queues.get(tabId) === next) {
        queues.delete(tabId)
      }
    })
  queues.set(tabId, next)
}

const record = (kind: NetworkKind, details: NetworkDetails): undefined => {
  if (details.tabId < 0) {
    return
  }
  // Extract only measurements before queuing; do not retain header contents.
  const event = normalizeEvent(kind, details)
  enqueue(details.tabId, async () => {
    const key = keyForTab(details.tabId)
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

const filter = { urls: ['http://*/*', 'https://*/*'] }
chrome.webRequest.onBeforeRequest.addListener((d) => record('start', d), filter)
chrome.webRequest.onHeadersReceived.addListener(
  (d) => record('headers', d),
  filter,
  ['responseHeaders'],
)
chrome.webRequest.onBeforeRedirect.addListener(
  (d) => record('redirect', d),
  filter,
)
chrome.webRequest.onCompleted.addListener((d) => record('complete', d), filter)
chrome.webRequest.onErrorOccurred.addListener((d) => record('error', d), filter)

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    record('commit', details)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(tabId, () => chrome.storage.session.remove(keyForTab(tabId)))
})

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  enqueue(removedTabId, () =>
    chrome.storage.session.remove(keyForTab(removedTabId)),
  )
  enqueue(addedTabId, () =>
    chrome.storage.session.remove(keyForTab(addedTabId)),
  )
})
