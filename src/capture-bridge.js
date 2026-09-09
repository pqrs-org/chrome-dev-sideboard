// src/injected.js runs in the page's MAIN world so it can patch fetch/XHR early,
// but page-world scripts cannot call chrome.runtime APIs directly. This content
// script bridges its window.postMessage events into extension runtime messages.
window.addEventListener('message', (event) => {
  if (event.source !== window) {
    return
  }

  const message = event.data
  if (
    !message ||
    !['json-fetch-visualizer:record', 'json-fetch-visualizer:reset'].includes(
      message.type,
    )
  ) {
    return
  }

  sendRuntimeMessage(message)
})

function sendRuntimeMessage(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // The extension context can disappear during reload or disable.
    })
  } catch (_) {
    // Old content scripts can outlive the extension context after an extension
    // reload. In that state, calling chrome.runtime APIs throws synchronously.
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    [
      'json-fetch-visualizer:set-storage',
      'json-fetch-visualizer:delete-storage',
    ].includes(message?.type)
  ) {
    const deleting = message.type === 'json-fetch-visualizer:delete-storage'
    try {
      if (
        !['local', 'session'].includes(message.area) ||
        typeof message.key !== 'string' ||
        (!deleting && typeof message.value !== 'string') ||
        typeof message.expectedValue !== 'string'
      )
        throw new Error('Invalid storage edit.')
      if (!deleting) JSON.parse(message.value)
      const storage =
        window[message.area === 'local' ? 'localStorage' : 'sessionStorage']
      if (storage.getItem(message.key) !== message.expectedValue)
        throw new Error(
          'This value changed on the page. Refresh storage and edit it again.',
        )
      if (deleting) storage.removeItem(message.key)
      else storage.setItem(message.key, message.value)
      sendResponse({ ok: true, snapshot: readStorageSnapshot() })
    } catch (error) {
      sendResponse({ ok: false, error: error.message })
    }
    return false
  }
  if (!message || message.type !== 'json-fetch-visualizer:get-storage') {
    return false
  }

  // Storage APIs must be read in the page's content-script context for the
  // active tab; the panel asks the background worker, which forwards here.
  sendResponse(readStorageSnapshot())
  return true
})

function readStorageSnapshot() {
  return {
    url: location.href,
    origin: location.origin,
    timestamp: Date.now(),
    local: readStorageArea('localStorage'),
    session: readStorageArea('sessionStorage'),
  }
}

function readStorageArea(name) {
  const entries = []
  let storage

  try {
    storage = window[name]
  } catch (_) {
    return entries
  }

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      entries.push({
        key,
        value: storage.getItem(key) || '',
      })
    }
  } catch (_) {
    return entries
  }

  entries.sort((a, b) => a.key.localeCompare(b.key))
  return entries
}
