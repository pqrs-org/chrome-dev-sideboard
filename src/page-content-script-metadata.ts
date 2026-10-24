// Observe metadata only after the panel first requests it.
chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse) => {
    if (message?.type !== 'dev-sideboard:get-metadata') {
      return false
    }
    readPageMetadata().then(sendResponse)
    return true
  },
)

const readMetadataFrom = (root: ParentNode, baseUrl: string) => {
  const canonical = [...root.querySelectorAll<HTMLLinkElement>('link[rel]')]
    .filter((link) => link.rel.toLowerCase().split(/\s+/).includes('canonical'))
    .map((link) => ({
      key: 'Canonical URL',
      value: resolveUrl(link.getAttribute('href'), baseUrl),
    }))
  const openGraph = []
  const twitter = []
  for (const meta of root.querySelectorAll('meta')) {
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
    baseUrl,
  }
}

const resolveUrl = (value: string | null, baseUrl: string) => {
  if (value === null) {
    return ''
  }
  try {
    return new URL(value, baseUrl).href
  } catch {
    return value
  }
}

// A canonical URL describes the current page when all of its identifying query
// parameters are present in the current URL. Extra parameters such as YouTube's
// playlist and timestamp parameters do not make otherwise-current metadata stale.
const canonicalDescribesPage = (canonical: string, pageUrl: string) => {
  try {
    const expected = new URL(canonical)
    const current = new URL(pageUrl)
    return (
      expected.origin === current.origin &&
      expected.pathname === current.pathname &&
      [...expected.searchParams].every(([key, value]) =>
        current.searchParams.getAll(key).includes(value),
      )
    )
  } catch {
    return true
  }
}

const pageKey = (value: string) => {
  const url = new URL(value)
  url.hash = ''
  return url.href
}

const initialPageKey = pageKey(document.location.href)
const MAX_PAGE_SNAPSHOTS = 20
const MAX_METADATA_HTML_BYTES = 5 * 1024 * 1024
const METADATA_TIMEOUT_MS = 8000
const pageSnapshots = new Map<string, ReturnType<typeof readMetadataFrom>>()
const pendingPageSnapshots = new Map<
  string,
  {
    controller: AbortController
    promise?: Promise<ReturnType<typeof readMetadataFrom>>
  }
>()

const abortPendingPageSnapshotsExcept = (key: string) => {
  for (const [pendingKey, pending] of pendingPageSnapshots) {
    if (pendingKey !== key) {
      pending.controller.abort()
      pendingPageSnapshots.delete(pendingKey)
    }
  }
}

const getOrCreatePageSnapshot = (
  key: string,
  create: (
    controller: AbortController,
  ) => Promise<ReturnType<typeof readMetadataFrom>>,
) => {
  const pending = pendingPageSnapshots.get(key)
  if (pending) {
    return pending.promise!
  }
  const controller = new AbortController()
  const entry: NonNullable<ReturnType<typeof pendingPageSnapshots.get>> = {
    controller,
  }
  const promise = create(controller).finally(() => {
    if (pendingPageSnapshots.get(key) === entry) {
      pendingPageSnapshots.delete(key)
    }
  })
  entry.promise = promise
  pendingPageSnapshots.set(key, entry)
  return promise
}

const cachedPageSnapshot = (key: string) => {
  const snapshot = pageSnapshots.get(key)
  if (snapshot) {
    // Map iteration follows insertion order. Reinsert on access so the first
    // key remains the least recently used entry.
    pageSnapshots.delete(key)
    pageSnapshots.set(key, snapshot)
  }
  return snapshot
}

const cachePageSnapshot = (
  key: string,
  snapshot: ReturnType<typeof readMetadataFrom>,
) => {
  // Reinsert an existing key so writes also refresh its LRU position.
  pageSnapshots.delete(key)
  pageSnapshots.set(key, snapshot)
  if (pageSnapshots.size > MAX_PAGE_SNAPSHOTS) {
    const oldest = pageSnapshots.keys().next().value
    if (oldest !== undefined) {
      pageSnapshots.delete(oldest)
    }
  }
}

const readHtml = async (response: Response) => {
  if (
    Number(response.headers.get('content-length')) > MAX_METADATA_HTML_BYTES
  ) {
    throw new Error('Metadata HTML is too large')
  }
  if (!response.body) {
    throw new Error('Empty metadata response')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > MAX_METADATA_HTML_BYTES) {
        await reader.cancel()
        throw new Error('Metadata HTML is too large')
      }
      html += decoder.decode(value, { stream: true })
    }
    return html + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

const fetchedDocumentBaseUrl = (document: Document, responseUrl: string) => {
  const href = document
    .querySelector<HTMLBaseElement>('base[href]')
    ?.getAttribute('href')
  if (href === null || href === undefined) {
    return responseUrl
  }
  try {
    return new URL(href, responseUrl).href
  } catch {
    return responseUrl
  }
}

const fetchPageMetadata = async (
  pageUrl: string,
  key: string,
  fallback: ReturnType<typeof readMetadataFrom>,
  controller: AbortController,
) => {
  const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS)
  try {
    const response = await fetch(pageUrl, {
      credentials: 'include',
      cache: 'no-cache',
      signal: controller.signal,
    })
    if (!response.ok) {
      return fallback
    }
    const parsed = new DOMParser().parseFromString(
      await readHtml(response),
      'text/html',
    )
    const responseUrl = response.url || pageUrl
    const fetched = readMetadataFrom(
      parsed,
      fetchedDocumentBaseUrl(parsed, responseUrl),
    )
    cachePageSnapshot(key, fetched)
    return fetched
  } catch {
    return fallback
  } finally {
    clearTimeout(timeout)
  }
}

const createPageSnapshot = async (
  pageUrl: string,
  key: string,
  controller: AbortController,
) => {
  const snapshot = readMetadataFrom(document, document.baseURI)

  // Do not freeze an incomplete initial DOM. Chrome reports loading completion
  // to the panel, which requests the snapshot again once metadata is available.
  if (document.readyState !== 'complete') {
    return snapshot
  }

  const fetchCurrentPage =
    key !== initialPageKey ||
    (snapshot.canonical.length > 0 &&
      !snapshot.canonical.some((entry) =>
        canonicalDescribesPage(entry.value, pageUrl),
      ))
  if (!fetchCurrentPage) {
    cachePageSnapshot(key, snapshot)
    return snapshot
  }

  // A new URL inside the same document can retain metadata from the initial
  // page. Read the response once and keep that URL's snapshot until reload.
  return fetchPageMetadata(pageUrl, key, snapshot, controller)
}

const readPageMetadata = async () => {
  const pageUrl = document.location.href
  const key = pageKey(pageUrl)
  abortPendingPageSnapshotsExcept(key)
  const cached = cachedPageSnapshot(key)
  if (cached) {
    return cached
  }
  return getOrCreatePageSnapshot(key, (controller) =>
    createPageSnapshot(pageUrl, key, controller),
  )
}
