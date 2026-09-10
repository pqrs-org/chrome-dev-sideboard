'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { runModule } = require('./helpers/run-module.js')
const tick = () => new Promise(setImmediate)
class Element {
  constructor() {
    this.children = []
    this.textContent = ''
    this.style = {}
    this.listeners = {}
    this.classList = { toggle() {} }
  }
  setAttribute(name, value) {
    this[name] = value
  }
  showModal() {
    this.open = true
  }
  close() {
    this.open = false
  }
  focus() {}
  addEventListener(name, fn) {
    this.listeners[name] = fn
  }
  append(...nodes) {
    this.children.push(...nodes)
  }
  replaceChildren(...nodes) {
    this.children = nodes
  }
  querySelector() {
    return null
  }
  querySelectorAll() {
    return []
  }
}
test('side panel tabs open Page, reject stale metadata, refresh scoped data, filter values, and edit Storage and Cookies', async () => {
  const elements = new Map()
  const sent = []
  let activated
  let activeTabId = 1
  let metadataChanged
  const pending = []
  const queueOperation = (tabId, request) => {
    sent.push(request)
    return new Promise((resolve) => pending.push({ tabId, request, resolve }))
  }
  const queries = []
  let poll
  runModule(
    require.resolve('../.test-build/src/sidepanel-tabs.js'),
    {
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      URL,
      console,
      document: {
        getElementById: (id) => {
          const e = new Element()
          elements.set(id, e)
          return e
        },
        createElement: () => new Element(),
        createTextNode: (text) => ({ textContent: text }),
      },
      window: {
        addEventListener() {},
        setInterval: (fn) => {
          poll = fn
        },
        setTimeout: (fn) => {
          fn()
        },
        clearTimeout() {},
      },
      chrome: {
        webNavigation: { getFrame: async () => ({ documentId: 'doc-1' }) },
        windows: { getCurrent: async () => ({ id: 7 }) },
        tabs: {
          sendMessage: (tabId, message, target) =>
            queueOperation(tabId, {
              ...message,
              documentId: target.documentId,
              type:
                message.type === 'dev-sideboard:set-storage'
                  ? 'setStorage'
                  : 'deleteStorage',
            }),
          query: async (q) => {
            queries.push(q)
            return [{ id: activeTabId }]
          },
          onActivated: {
            addListener: (fn) => {
              activated = fn
            },
          },
          onUpdated: { addListener() {} },
          onRemoved: { addListener() {} },
          onReplaced: { addListener() {} },
        },
      },
    },
    {
      './sidepanel-page-access.js': {
        SidepanelPageAccess: {
          readMetadata: (tabId) =>
            queueOperation(tabId, { type: 'getMetadata' }),
          readStorage: (tabId) => queueOperation(tabId, { type: 'getStorage' }),
          observeMetadataChanges(callback) {
            metadataChanged = callback
            return () => {}
          },
        },
      },
      './cookie-store.js': {
        ExtensionCookies: {
          ...require('../.test-build/src/cookie-store.js').ExtensionCookies,
          write: async (tabId, edit, deleting) => {
            const result = await queueOperation(tabId, {
              ...edit,
              type: deleting ? 'deleteStorage' : 'setStorage',
            })
            if (!result.ok) {
              throw new Error(result.error)
            }
          },
        },
      },
      './image-previews.js': {
        ImagePreviews: {
          createBatch: () => ({
            dispose() {},
            load(url, ready) {
              ready('blob:preview')
            },
          }),
        },
      },
    },
  )
  const receive = async (message) => {
    await tick()
    if (message.type === 'metadataChanged') {
      metadataChanged(message.tabId)
    } else {
      const expectedType =
        message.type === 'metadataSnapshot'
          ? 'getMetadata'
          : message.type === 'storageSnapshot'
            ? 'getStorage'
            : sent.at(-1).type
      let index = pending.findLastIndex(
        (item) => item.request.type === expectedType,
      )
      if (index < 0) {
        if (expectedType === 'getMetadata') {
          metadataChanged(activeTabId)
        } else {
          poll()
        }
        index = pending.findLastIndex(
          (item) => item.request.type === expectedType,
        )
      }
      assert.ok(index >= 0, 'a request is pending for the simulated result')
      const item = pending.splice(index, 1)[0]
      item.resolve(
        message.type === 'storageSaved'
          ? { ok: message.ok, error: message.error }
          : message.snapshot,
      )
    }
    await tick()
    if (message.type === 'storageSaved' && message.ok) {
      // A write only closes the editor; the next periodic read updates the view.
      poll()
      await receive({ type: 'storageSnapshot', snapshot: message.snapshot })
    }
  }
  await tick()
  assert.equal(sent.at(-1).type, 'getMetadata')
  await receive({
    type: 'metadataSnapshot',
    tabId: 1,
    snapshot: {
      canonical: [
        { key: 'Canonical URL', value: 'https://example.com/' },
        { key: 'Canonical URL', value: 'javascript:alert(1)' },
        { key: 'Canonical URL', value: 'file:///private/data' },
        { key: 'Canonical URL', value: 'http://example.com/' },
      ],
      openGraph: [
        { key: 'og:title', value: '<script>example</script>' },
        { key: 'og:video:tag', value: 'Music' },
        { key: 'og:video:tag', value: '<b>Live</b>' },
        { key: 'og:video:tag', value: 'Music' },
      ],
      twitter: [{ key: 'twitter:title', value: 'Twitter title' }],
    },
  })
  assert.equal(
    elements.get('metadataView').children[1].children[0].children[0]
      .textContent,
    'https://example.com/',
  )
  const canonicalUrls = elements.get('metadataView').children[1].children
  assert.equal(canonicalUrls[0].children[0].href, 'https://example.com/')
  assert.equal(canonicalUrls[1].children.length, 0)
  assert.equal(canonicalUrls[2].children.length, 0)
  assert.equal(canonicalUrls[3].children[0].href, 'http://example.com/')
  assert.equal(
    elements.get('metadataView').children[3].children[1].textContent,
    '<script>example</script>',
  )
  assert.equal(elements.get('metadataView').children[3].children.length, 4)
  assert.deepEqual(
    JSON.parse(
      elements.get('metadataView').children[3].children[3].textContent,
    ),
    ['Music', '<b>Live</b>', 'Music'],
  )
  assert.equal(elements.get('metadataView').children.length, 4)
  assert.equal(
    elements.get('metadataView').children[2].textContent,
    'Open Graph',
  )
  await receive({
    type: 'metadataSnapshot',
    tabId: 1,
    snapshot: {
      openGraph: [],
      twitter: [{ key: 'twitter:title', value: 'Twitter title' }],
    },
  })
  assert.equal(
    elements.get('metadataView').children[2].textContent,
    'Twitter Card',
  )
  assert.equal(
    elements.get('metadataView').children[3].children[1].textContent,
    'Twitter title',
  )
  assert.equal(elements.get('storageWorkspace').hidden, true)
  const beforeMetadataPoll = sent.length
  poll()
  assert.equal(sent.length, beforeMetadataPoll, 'Page does not poll')
  await receive({ type: 'metadataChanged', tabId: 2 })
  assert.equal(sent.length, beforeMetadataPoll)
  await receive({ type: 'metadataChanged', tabId: 1 })
  assert.equal(sent.at(-1).type, 'getMetadata')
  await receive({
    type: 'metadataSnapshot',
    tabId: 1,
    snapshot: {
      baseUrl: 'https://example.com/base/',
      openGraph: [
        { key: 'og:image', value: 'preview.png' },
        { key: 'og:image:width', value: '1200' },
        { key: 'og:image', value: 'javascript:alert(1)' },
        { key: 'og:image', value: 'https://user:secret@example.com/a' },
      ],
    },
  })
  const imageEntries = elements.get('metadataView').children[3].children
  const link = imageEntries[1].children[0]
  assert.equal(link.href, 'https://example.com/base/preview.png')
  assert.equal(link.target, '_blank')
  assert.equal(link.rel, 'noopener noreferrer')
  const image = imageEntries[1].children[2]
  assert.equal(image.src, 'blob:preview')
  assert.equal(imageEntries[3].children.length, 0)
  assert.equal(imageEntries[5].children.length, 0)
  assert.equal(imageEntries[7].children.length, 0)
  await receive({
    type: 'metadataSnapshot',
    snapshot: {
      openGraph: [
        { key: 'og:z', value: 'last' },
        { key: 'og:description', value: 'Long description' },
        { key: 'og:title', value: 'Title' },
        { key: 'og:image', value: 'first.png' },
        { key: 'og:image:width', value: '100' },
        { key: 'og:image:height', value: '200' },
        { key: 'og:image', value: 'second.png' },
        { key: 'og:a', value: 'first' },
      ],
    },
  })
  assert.deepEqual(
    elements
      .get('metadataView')
      .children[3].children.filter((_, index) => index % 2 === 0)
      .map((node) => node.textContent),
    [
      'og:image',
      'og:image',
      'og:title',
      'og:description',
      'og:a',
      'og:image:height',
      'og:image:width',
      'og:z',
    ],
  )
  elements.get('storageModeButton').listeners.click()
  assert.equal(elements.get('metadataView').hidden, true)
  assert.equal(queries[0].windowId, 7)
  assert.equal(
    sent.some((m) => m.type === 'getStorage'),
    true,
  )
  activated({ windowId: 8 })
  assert.equal(queries.length, 1)
  await receive({
    type: 'storageSnapshot',
    tabId: 1,
    snapshot: {
      documentId: 'doc-1',
      local: [{ key: 'hello', value: '{"hello":"world"}' }],
      session: [],
    },
  })
  assert.equal(elements.get('entryList').children.length, 1)
  const nodes = [{ open: true }, { open: true }]
  const treeView = elements.get('treeView')
  treeView.querySelectorAll = () => nodes
  treeView.listeners.toggle()
  assert.equal(elements.get('toggleTreeButton').textContent, 'Collapse')
  elements.get('toggleTreeButton').listeners.click()
  assert.equal(
    nodes.every((node) => !node.open),
    true,
  )
  assert.equal(elements.get('toggleTreeButton').textContent, 'Expand')
  elements.get('toggleTreeButton').listeners.click()
  assert.equal(
    nodes.every((node) => node.open),
    true,
  )
  nodes[1].open = false
  treeView.listeners.toggle()
  assert.equal(elements.get('toggleTreeButton').textContent, 'Expand')
  treeView.querySelectorAll = () => []
  treeView.listeners.toggle()
  assert.equal(elements.get('toggleTreeButton').disabled, true)

  if (elements.get('rawButton')['aria-pressed'] !== 'true') {
    elements.get('rawButton').listeners.click()
  }
  assert.equal(
    elements.get('treeView').children[0].textContent,
    '{"hello":"world"}',
  )
  elements.get('filterInput').value = 'missing'
  elements.get('filterInput').listeners.input()
  assert.equal(elements.get('entryList').children.length, 0)
  elements.get('filterInput').value = ''
  elements.get('filterInput').listeners.input()
  await receive({
    type: 'storageSnapshot',
    tabId: 1,
    snapshot: {
      documentId: 'doc-1',
      local: [{ key: 'x', value: 'test' }],
      session: [],
    },
  })
  if (elements.get('rawButton')['aria-pressed'] !== 'true') {
    elements.get('rawButton').listeners.click()
  }
  assert.equal(elements.get('treeView').children[0].textContent, 'test')
  assert.equal(elements.get('editStorageButton').disabled, false)
  elements.get('editStorageButton').listeners.click()
  elements.get('storageValueInput').value = ' text\nvalue '
  elements.get('saveStorageEdit').listeners.click()
  await tick()
  assert.equal(sent.at(-1).value, ' text\nvalue ')
  await receive({
    type: 'storageSaved',
    tabId: 1,
    ok: true,
    snapshot: {
      documentId: 'doc-1',
      local: [{ key: 'x', value: ' text\nvalue ' }],
      session: [],
    },
  })
  const beforePoll = sent.length
  poll()
  assert.equal(sent.length, beforePoll + 1)
  assert.equal(sent.at(-1).type, 'getStorage')
  poll()
  assert.equal(sent.length, beforePoll + 1)
  await receive({
    type: 'storageSnapshot',
    tabId: 1,
    snapshot: {
      documentId: 'doc-1',
      local: [{ key: 'settings', value: '{"enabled":false}' }],
      session: [],
    },
  })
  elements.get('editStorageButton').listeners.click()
  assert.equal(elements.get('storageEditor').open, true)
  const beforeEditPoll = sent.length
  poll()
  assert.equal(sent.length, beforeEditPoll)
  elements.get('storageValueInput').value = '{'
  elements.get('saveStorageEdit').listeners.click()
  await tick()
  assert.match(elements.get('storageEditStatus').textContent, /Invalid JSON/)
  assert.notEqual(sent.at(-1).type, 'setStorage')
  elements.get('storageValueInput').value = '{"enabled":true}'
  elements.get('saveStorageEdit').listeners.click()
  await tick()
  assert.equal(sent.at(-1).type, 'setStorage')
  assert.equal(sent.at(-1).documentId, 'doc-1')
  assert.equal(sent.at(-1).expectedValue, '{"enabled":false}')
  await receive({
    type: 'storageSaved',
    tabId: 1,
    ok: false,
    error: 'Value changed',
  })
  assert.equal(elements.get('storageEditor').open, true)
  assert.equal(elements.get('storageValueInput').value, '{"enabled":true}')
  assert.equal(elements.get('saveStorageEdit').disabled, false)
  elements.get('saveStorageEdit').listeners.click()
  await tick()
  await receive({
    type: 'storageSaved',
    tabId: 1,
    ok: true,
    snapshot: {
      documentId: 'doc-1',
      local: [{ key: 'settings', value: '{"enabled":true}' }],
      session: [],
    },
  })
  assert.equal(elements.get('storageEditor').open, false)
  if (elements.get('rawButton')['aria-pressed'] !== 'true') {
    elements.get('rawButton').listeners.click()
  }
  assert.equal(
    JSON.parse(elements.get('treeView').children[0].textContent).enabled,
    true,
  )
  const cookie = {
    name: 'sid',
    value: 'raw-token',
    domain: 'example.com',
    path: '/',
    storeId: '0',
    hostOnly: true,
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: true,
  }
  await receive({
    type: 'storageSnapshot',
    tabId: 1,
    snapshot: {
      documentId: 'doc-1',
      local: [],
      session: [],
      cookies: [cookie],
    },
  })
  assert.equal(elements.get('editStorageButton').disabled, true)
  elements.get('cookiesModeButton').listeners.click()
  assert.equal(elements.get('editStorageButton').disabled, false)
  assert.match(elements.get('detailMeta').textContent, /HttpOnly/)
  elements.get('editStorageButton').listeners.click()
  assert.equal(elements.get('storageValueInput').value, 'raw-token')
  elements.get('storageValueInput').value = 'new-token'
  elements.get('saveStorageEdit').listeners.click()
  await tick()
  assert.equal(sent.at(-1).area, 'cookie')
  assert.equal(sent.at(-1).value, 'new-token')
  assert.equal(
    sent.at(-1).expectedCookie,
    require('../.test-build/src/cookie-store.js').ExtensionCookies.fingerprint(
      cookie,
    ),
  )
  await receive({
    type: 'storageSaved',
    tabId: 1,
    ok: true,
    snapshot: {
      documentId: 'doc-1',
      local: [],
      session: [],
      cookies: [cookie],
    },
  })
  elements.get('deleteStorageButton').listeners.click()
  await tick()
  assert.equal(sent.at(-1).type, 'deleteStorage')
  assert.equal(sent.at(-1).area, 'cookie')
  assert.equal(elements.get('deleteStorageButton').disabled, true)
  await receive({
    type: 'storageSaved',
    tabId: 1,
    ok: false,
    error: 'Cookie changed',
  })
  assert.equal(elements.get('deleteStorageButton').disabled, false)
  assert.equal(elements.get('detailMeta').textContent, 'Cookie changed')
  elements.get('deleteStorageButton').listeners.click()
  await tick()
  await receive({
    type: 'storageSaved',
    tabId: 1,
    ok: true,
    snapshot: { documentId: 'doc-1', local: [], session: [], cookies: [] },
  })
  assert.equal(elements.get('deleteStorageButton').disabled, true)
  assert.equal(elements.get('entryList').children.length, 0)
  elements.get('storageModeButton').listeners.click()
  const previous = pending.pop()
  activeTabId = 2
  activated({ windowId: 7 })
  await tick()
  activeTabId = 1
  activated({ windowId: 7 })
  await tick()
  previous.resolve({
    documentId: 'old-doc',
    local: [{ key: 'stale', value: 'private' }],
  })
  await tick()
  assert.equal(elements.get('entryList').children.length, 0)
})
