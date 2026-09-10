'use strict'
const ExtensionCookies = (() => {
  // Chrome exposes no per-cookie ID. Build a key for deduplication, UI selection,
  // and locating the cookie again before an edit or deletion.
  // name/domain/path distinguish same-name cookies with different scopes;
  // storeId separates browser cookie stores (e.g. regular and incognito).
  // Both partition fields distinguish cookies isolated by top-level site and
  // cross-site ancestry. Missing fields use consistent defaults for comparison.
  const identity = (c: chrome.cookies.Cookie) =>
    JSON.stringify([
      c.name,
      c.domain,
      c.path,
      c.storeId,
      c.partitionKey?.topLevelSite || '',
      c.partitionKey?.hasCrossSiteAncestor ?? false,
    ])
  // Snapshot of the selected cookie for detecting changes since editing began.
  // value detects content changes; hostOnly/secure/httpOnly/sameSite detect
  // access-policy changes; session/expirationDate detect lifetime changes.
  // This is a serialized comparison value, not a cryptographic hash or cookie ID.
  // Comparing it before writing reduces stale edits, but is not atomic:
  // Chrome has no compare-and-set API, so a later concurrent change can be overwritten.
  const fingerprint = (c: chrome.cookies.Cookie) =>
    JSON.stringify([
      identity(c),
      c.value,
      c.hostOnly,
      c.secure,
      c.httpOnly,
      c.sameSite,
      c.session,
      c.expirationDate,
    ])
  const read = async (tabId: number) => {
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 })
    if (!frame?.documentId || !/^https?:/.test(frame.url)) {
      throw new Error('Cookies are unavailable on this page.')
    }
    const stores = await chrome.cookies.getAllCookieStores()
    const store = stores.find((s) => s.tabIds.includes(tabId))
    if (!store) {
      throw new Error('Cookie store unavailable.')
    }
    const query = { url: frame.url, storeId: store.id }
    let cookies = await chrome.cookies.getAll(query)
    const { partitionKey } = await chrome.cookies.getPartitionKey({
      tabId,
      frameId: 0,
    })
    if (partitionKey) {
      cookies.push(...(await chrome.cookies.getAll({ ...query, partitionKey })))
    }
    cookies = [...new Map(cookies.map((c) => [identity(c), c])).values()]
    return { documentId: frame.documentId, url: frame.url, cookies }
  }
  const write = async (tabId: number, edit: StorageEdit, deleting = false) => {
    const snapshot = await read(tabId)
    if (snapshot.documentId !== edit.documentId) {
      throw new Error('The page changed. Refresh cookies and edit again.')
    }
    const cookie = snapshot.cookies.find((c) => identity(c) === edit.key)
    if (
      !cookie ||
      fingerprint(cookie) !== edit.expectedCookie ||
      cookie.value !== edit.expectedValue
    ) {
      throw new Error(
        'This cookie changed or expired. Refresh cookies and edit again.',
      )
    }
    if (!deleting && typeof edit.value !== 'string') {
      throw new Error('Invalid cookie value.')
    }
    const details: chrome.cookies.SetDetails = {
      url: snapshot.url,
      name: cookie.name,
      value: deleting ? cookie.value : edit.value,
      path: cookie.path,
      storeId: cookie.storeId,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
    }
    if (!cookie.hostOnly) {
      details.domain = cookie.domain
    }
    if (!cookie.session) {
      details.expirationDate = cookie.expirationDate
    }
    if (cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey
    }
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 })
    if (frame?.documentId !== edit.documentId) {
      throw new Error('The page changed. Refresh cookies and edit again.')
    }
    // Expire the exact domain/path/store/partition tuple. cookies.remove only
    // accepts URL and name and can select a different same-name cookie.
    if (deleting) {
      details.expirationDate = 1
    }
    const saved = await chrome.cookies.set(details)
    if (!saved && !deleting) {
      throw new Error('Chrome could not save this cookie.')
    }
    return saved
  }
  return { identity, fingerprint, read, write }
})()
if (typeof module !== 'undefined') {
  module.exports = ExtensionCookies
}
