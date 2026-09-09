'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
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
test('inspector loads scoped snapshots, filters JSON, shows raw values, and reads storage on demand', async () => {
  const elements = new Map()
  const sent = []
  let receive
  let activated
  const port = {
    postMessage: (m) => sent.push(m),
    onMessage: {
      addListener: (fn) => {
        receive = fn
      },
    },
    onDisconnect: { addListener() {} },
  }
  const queries = []
  let poll
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/inspector.js'), 'utf8'),
    {
      CookieStore: require('../src/cookie-store.js'),
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
        setInterval: (fn) => {
          poll = fn
        },
        setTimeout: (fn) => {
          fn()
        },
        clearTimeout() {},
      },
      chrome: {
        runtime: { connect: () => port },
        windows: { getCurrent: async () => ({ id: 7 }) },
        tabs: {
          query: async (q) => {
            queries.push(q)
            return [{ id: 1 }]
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
  )
  await tick()
  assert.equal(queries[0].windowId, 7)
  assert.equal(
    sent.some((m) => m.type === 'getStorage'),
    false,
  )
  activated({ windowId: 8 })
  assert.equal(queries.length, 1)
  receive({
    type: 'snapshot',
    tabId: 1,
    records: [
      {
        id: 'r',
        method: 'GET',
        status: 200,
        ok: true,
        raw: '{"hello":"world"}',
        url: 'https://example.com/api',
        timestamp: 1,
      },
    ],
  })
  assert.equal(elements.get('requestList').children.length, 1)
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

  if (elements.get('rawButton')['aria-pressed'] !== 'true')
    elements.get('rawButton').listeners.click()
  assert.equal(
    elements.get('treeView').children[0].textContent,
    '{"hello":"world"}',
  )
  elements.get('filterInput').value = 'missing'
  elements.get('filterInput').listeners.input()
  assert.equal(elements.get('requestList').children.length, 0)
  elements.get('storageModeButton').listeners.click()
  assert.equal(sent.at(-1).type, 'getStorage')
  receive({
    type: 'storageSnapshot',
    tabId: 1,
    snapshot: {
      documentId: 'doc-1',
      local: [{ key: 'x', value: 'test' }],
      session: [],
    },
  })
  if (elements.get('rawButton')['aria-pressed'] !== 'true')
    elements.get('rawButton').listeners.click()
  assert.equal(elements.get('treeView').children[0].textContent, 'test')
  assert.equal(elements.get('editStorageButton').disabled, false)
  assert.equal(elements.get('editStorageButton').textContent, 'Edit')
  elements.get('editStorageButton').listeners.click()
  elements.get('storageJsonInput').value = ' text\nvalue '
  elements.get('saveStorageEdit').listeners.click()
  assert.equal(sent.at(-1).value, ' text\nvalue ')
  receive({
    type: 'storageSaved',
    tabId: 1,
    requestId: sent.at(-1).requestId,
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
  receive({
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
  elements.get('storageJsonInput').value = '{'
  elements.get('saveStorageEdit').listeners.click()
  assert.match(elements.get('storageEditStatus').textContent, /Invalid JSON/)
  assert.notEqual(sent.at(-1).type, 'setStorage')
  elements.get('storageJsonInput').value = '{"enabled":true}'
  elements.get('saveStorageEdit').listeners.click()
  assert.equal(sent.at(-1).type, 'setStorage')
  assert.equal(sent.at(-1).documentId, 'doc-1')
  assert.equal(sent.at(-1).expectedValue, '{"enabled":false}')
  receive({
    type: 'storageSaved',
    tabId: 1,
    requestId: sent.at(-1).requestId,
    ok: false,
    error: 'Value changed',
  })
  assert.equal(elements.get('storageEditor').open, true)
  assert.equal(elements.get('storageJsonInput').value, '{"enabled":true}')
  assert.equal(elements.get('saveStorageEdit').disabled, false)
  elements.get('saveStorageEdit').listeners.click()
  receive({
    type: 'storageSaved',
    tabId: 1,
    requestId: sent.at(-1).requestId,
    ok: true,
    snapshot: {
      documentId: 'doc-1',
      local: [{ key: 'settings', value: '{"enabled":true}' }],
      session: [],
    },
  })
  assert.equal(elements.get('storageEditor').open, false)
  if (elements.get('rawButton')['aria-pressed'] !== 'true')
    elements.get('rawButton').listeners.click()
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
  receive({
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
  assert.equal(elements.get('editStorageButton').textContent, 'Edit')
  assert.equal(elements.get('editStorageButton').disabled, false)
  assert.match(elements.get('detailMeta').textContent, /HttpOnly/)
  elements.get('editStorageButton').listeners.click()
  assert.equal(elements.get('storageJsonInput').value, 'raw-token')
  elements.get('storageJsonInput').value = 'new-token'
  elements.get('saveStorageEdit').listeners.click()
  assert.equal(sent.at(-1).area, 'cookie')
  assert.equal(sent.at(-1).value, 'new-token')
  assert.equal(
    sent.at(-1).expectedCookie,
    require('../src/cookie-store.js').fingerprint(cookie),
  )
  receive({
    type: 'storageSaved',
    tabId: 1,
    requestId: sent.at(-1).requestId,
    ok: true,
    snapshot: {
      documentId: 'doc-1',
      local: [],
      session: [],
      cookies: [cookie],
    },
  })
  elements.get('deleteStorageButton').listeners.click()
  assert.equal(sent.at(-1).type, 'deleteStorage')
  assert.equal(sent.at(-1).area, 'cookie')
  assert.equal(elements.get('deleteStorageButton').disabled, true)
  receive({
    type: 'storageSaved',
    tabId: 1,
    requestId: sent.at(-1).requestId,
    ok: false,
    error: 'Cookie changed',
  })
  assert.equal(elements.get('deleteStorageButton').disabled, false)
  assert.equal(elements.get('detailMeta').textContent, 'Cookie changed')
  elements.get('deleteStorageButton').listeners.click()
  receive({
    type: 'storageSaved',
    tabId: 1,
    requestId: sent.at(-1).requestId,
    ok: true,
    snapshot: { documentId: 'doc-1', local: [], session: [], cookies: [] },
  })
  assert.equal(elements.get('deleteStorageButton').disabled, true)
  assert.equal(elements.get('requestList').children.length, 0)
})
