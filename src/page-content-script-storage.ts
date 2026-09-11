import { errorMessage } from './error-message.js'
// Website storage is accessed through internal extension messages.
chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (
      message?.type === 'dev-sideboard:set-storage' ||
      message?.type === 'dev-sideboard:delete-storage'
    ) {
      const deleting = message.type === 'dev-sideboard:delete-storage'
      try {
        if (
          (message.area !== 'local' && message.area !== 'session') ||
          typeof message.key !== 'string' ||
          (!deleting && typeof message.value !== 'string') ||
          typeof message.expectedValue !== 'string'
        ) {
          throw new Error('Invalid storage edit.')
        }
        if (!deleting && typeof message.value === 'string') {
          let json = false
          try {
            JSON.parse(message.expectedValue)
            json = true
          } catch {}
          if (json) {
            JSON.parse(message.value)
          }
        }
        const storage =
          window[message.area === 'local' ? 'localStorage' : 'sessionStorage']
        if (storage.getItem(message.key) !== message.expectedValue) {
          throw new Error(
            'This value changed on the page. Refresh storage and edit it again.',
          )
        }
        if (deleting) {
          storage.removeItem(message.key)
        } else if (typeof message.value === 'string') {
          storage.setItem(message.key, message.value)
        }
        sendResponse({ ok: true })
      } catch (error) {
        sendResponse({
          ok: false,
          error: errorMessage(error),
        })
      }
      return false
    }
    if (!message || message.type !== 'dev-sideboard:get-storage') {
      return false
    }

    // Storage APIs must be read in the page's content-script context for the
    // active tab; the side panel sends its request directly here.
    sendResponse(readStorageSnapshot())
    return false
  },
)

const readStorageSnapshot = () => {
  return {
    url: location.href,
    origin: location.origin,
    timestamp: Date.now(),
    local: readStorageArea('localStorage'),
    session: readStorageArea('sessionStorage'),
  }
}

const readStorageArea = (
  name: 'localStorage' | 'sessionStorage',
): StorageValue[] => {
  const entries: StorageValue[] = []
  let storage

  try {
    storage = window[name]
  } catch {
    return entries
  }

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key === null) {
        continue
      }
      entries.push({
        key,
        value: storage.getItem(key) || '',
      })
    }
  } catch {
    return entries
  }

  entries.sort((a, b) => a.key.localeCompare(b.key))
  return entries
}
