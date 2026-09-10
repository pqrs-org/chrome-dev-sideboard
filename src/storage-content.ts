// Page metadata and website storage are accessed through internal extension messages.
chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message?.type === 'dev-sideboard:get-metadata') {
      observePageMetadata()
      sendResponse(readPageMetadata())
      return false
    }
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
        sendResponse({ ok: true, snapshot: readStorageSnapshot() })
      } catch (error) {
        sendResponse({
          ok: false,
          error:
            error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error),
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
    return true
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

const readPageMetadata = () => {
  const canonical = [...document.querySelectorAll<HTMLLinkElement>('link[rel]')]
    .filter((link) => link.rel.toLowerCase().split(/\s+/).includes('canonical'))
    .map((link) => ({
      key: 'Canonical URL',
      value: link.getAttribute('href') === null ? '' : link.href,
    }))
  const description = []
  const openGraph = []
  const twitter = []
  for (const meta of document.querySelectorAll('meta')) {
    const key = meta.getAttribute('property') || meta.getAttribute('name') || ''
    const normalized = key.toLowerCase()
    const entry = { key, value: meta.getAttribute('content') || '' }
    if (normalized === 'description') {
      description.push(entry)
    } else if (normalized.startsWith('og:')) {
      openGraph.push(entry)
    } else if (normalized.startsWith('twitter:')) {
      twitter.push(entry)
    }
  }
  return {
    canonical,
    description,
    openGraph,
    twitter,
    baseUrl: document.baseURI,
  }
}

let metadataObserver: MutationObserver | undefined
const observePageMetadata = () => {
  if (metadataObserver) {
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const relevant = (node: Node) =>
    node.nodeType === 1 &&
    ((node as Element).matches('meta, link, base') ||
      (node as Element).querySelector('meta, link, base'))
  metadataObserver = new MutationObserver((mutations) => {
    if (
      !mutations.some((mutation) =>
        mutation.type === 'attributes'
          ? (mutation.target as Element).matches('meta, link, base')
          : [...mutation.addedNodes, ...mutation.removedNodes].some(relevant),
      )
    ) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      chrome.runtime
        .sendMessage({ type: 'dev-sideboard:metadata-changed' })
        .catch(() => {})
    }, 100)
  })
  metadataObserver.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['property', 'name', 'content', 'rel', 'href'],
  })
}
