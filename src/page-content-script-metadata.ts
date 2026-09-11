// Observe metadata only after the panel first requests it.
chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message?.type !== 'dev-sideboard:get-metadata') {
      return false
    }
    observePageMetadata()
    sendResponse(readPageMetadata())
    return false
  },
)

const readPageMetadata = () => {
  const canonical = [...document.querySelectorAll<HTMLLinkElement>('link[rel]')]
    .filter((link) => link.rel.toLowerCase().split(/\s+/).includes('canonical'))
    .map((link) => ({
      key: 'Canonical URL',
      value: link.getAttribute('href') === null ? '' : link.href,
    }))
  const openGraph = []
  const twitter = []
  for (const meta of document.querySelectorAll('meta')) {
    const key = meta.getAttribute('property') || meta.getAttribute('name') || ''
    const normalized = key.toLowerCase()
    const entry = { key, value: meta.getAttribute('content') || '' }
    if (normalized.startsWith('og:')) {
      openGraph.push(entry)
    } else if (normalized.startsWith('twitter:')) {
      twitter.push(entry)
    }
  }
  return {
    canonical,
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
