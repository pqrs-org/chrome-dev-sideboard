'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const tick = () => new Promise(setImmediate)
function event() {
  const listeners = []
  return {
    addListener: (fn) => listeners.push(fn),
    get size() {
      return listeners.length
    },
    emit: (...args) => listeners.forEach((fn) => fn(...args)),
  }
}
function worker(stored = {}) {
  let documentId = 'doc-1'
  const runtime = {
    id: 'extension',
    getURL: (path) => 'chrome-extension://extension/' + path,
    onMessage: event(),
    onConnect: event(),
  }
  const tabs = { onRemoved: event(), onReplaced: event() }
  const navigation = {
    onCommitted: event(),
    getFrame: async () => ({ documentId }),
  }
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/storage-background.js'), 'utf8'),
    {
      URL,
      console,
      chrome: {
        runtime,
        tabs,
        webNavigation: navigation,
        storage: {
          session: {
            get: async (key) => ({ [key]: structuredClone(stored[key]) }),
            set: async (value) => Object.assign(stored, structuredClone(value)),
            remove: async (key) => {
              delete stored[key]
            },
          },
        },
      },
    },
  )
  return {
    runtime,
    tabs,
    navigation,
    setDocument: (id) => {
      documentId = id
    },
  }
}
test('storage edits update only the selected key and reject invalid JSON or stale values', () => {
  const local = new Map([
    ['settings', '{"enabled":false}'],
    ['other', 'keep'],
  ])
  const session = new Map([['settings', '{"count":1}']])
  const storage = (values) => ({
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  })
  let listener
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/storage-content.js'), 'utf8'),
    {
      window: {
        addEventListener() {
          throw new Error('Storage must not listen to page messages')
        },
        localStorage: storage(local),
        sessionStorage: storage(session),
      },
      location: { href: 'https://example.com/', origin: 'https://example.com' },
      chrome: {
        runtime: {
          onMessage: {
            addListener: (fn) => {
              listener = fn
            },
          },
        },
      },
    },
  )
  const send = (message) => {
    let result
    listener(message, {}, (value) => {
      result = value
    })
    return result
  }
  const edit = {
    type: 'dev-sideboard:set-storage',
    area: 'local',
    key: 'settings',
    expectedValue: '{"enabled":false}',
    value: '{"enabled":true}',
  }
  assert.equal(send({ ...edit, value: '{' }).ok, false)
  assert.equal(local.get('settings'), edit.expectedValue)
  assert.equal(send(edit).ok, true)
  assert.equal(local.get('settings'), edit.value)
  assert.equal(local.get('other'), 'keep')
  assert.equal(session.get('settings'), '{"count":1}')
  assert.equal(send(edit).ok, false)
  assert.equal(
    send({
      ...edit,
      area: 'session',
      expectedValue: '{"count":1}',
      value: '{"count":2}',
    }).ok,
    true,
  )
  assert.equal(session.get('settings'), '{"count":2}')
  const textEdit = {
    type: 'dev-sideboard:set-storage',
    area: 'local',
    key: 'other',
    expectedValue: 'keep',
    value: '  plain text\nnext line  ',
  }
  assert.equal(send(textEdit).ok, true)
  assert.equal(local.get('other'), textEdit.value)
  assert.equal(
    send({ ...textEdit, expectedValue: textEdit.value, value: '' }).ok,
    true,
  )
  assert.equal(local.get('other'), '')
  local.set('other', 'keep')
  const deletion = {
    type: 'dev-sideboard:delete-storage',
    area: 'local',
    key: 'other',
    expectedValue: 'keep',
  }
  assert.equal(send({ ...deletion, expectedValue: 'stale' }).ok, false)
  assert.equal(local.get('other'), 'keep')
  assert.equal(send(deletion).ok, true)
  assert.equal(local.has('other'), false)
  assert.equal(local.get('settings'), edit.value)
  assert.equal(
    send({
      ...deletion,
      area: 'session',
      key: 'settings',
      expectedValue: '{"count":2}',
    }).ok,
    true,
  )
  assert.equal(session.has('settings'), false)

  local.delete('settings')
  assert.equal(send(edit).ok, false)
  assert.equal(local.has('settings'), false)
})

test('storage writes are routed to the inspected document and rejected after navigation', async () => {
  const w = worker()
  const sent = []
  w.tabs.sendMessage = async (...args) => {
    sent.push(args)
    return { ok: true, snapshot: { local: [], session: [] } }
  }
  const replies = []
  const port = {
    name: 'dev-sideboard:panel',
    sender: {
      id: 'extension',
      url: 'chrome-extension://extension/src/inspector.html',
    },
    postMessage: (m) => replies.push(m),
    onMessage: event(),
    onDisconnect: event(),
  }
  w.runtime.onConnect.emit(port)
  port.onMessage.emit({ type: 'init', tabId: 1 })
  await tick()
  const edit = {
    type: 'setStorage',
    documentId: 'doc-1',
    requestId: 1,
    area: 'local',
    key: 'settings',
    expectedValue: '{}',
    value: '{"a":1}',
  }
  port.onMessage.emit(edit)
  await tick()
  assert.equal(sent[0][2].documentId, 'doc-1')
  assert.equal(sent[0][1].key, 'settings')
  assert.equal(replies.at(-1).ok, true)
  w.setDocument('doc-2')
  port.onMessage.emit({ ...edit, requestId: 2 })
  await tick()
  assert.equal(sent.length, 1)
  assert.equal(replies.at(-1).ok, false)
  assert.match(replies.at(-1).error, /page changed/)
})

test('storage access rejects page ports and does not deliver a stale snapshot after switching tabs', async () => {
  const w = worker()
  let reads = 0
  let finishRead
  w.tabs.sendMessage = async () => {
    reads++
    return new Promise((resolve) => {
      finishRead = resolve
    })
  }
  const makePort = (sender) => ({
    name: 'dev-sideboard:panel',
    sender,
    replies: [],
    postMessage(message) {
      this.replies.push(message)
    },
    onMessage: event(),
    onDisconnect: event(),
  })
  for (const sender of [
    { id: 'extension', url: 'https://example.com/', tab: { id: 1 } },
    {
      id: 'another-extension',
      url: 'chrome-extension://extension/src/inspector.html',
    },
    { id: 'extension', url: 'chrome-extension://extension/other.html' },
  ]) {
    const port = makePort(sender)
    w.runtime.onConnect.emit(port)
    assert.equal(port.onMessage.size, 0)
  }
  assert.equal(w.runtime.onMessage.size, 1)
  const port = makePort({
    id: 'extension',
    url: 'chrome-extension://extension/src/inspector.html',
  })
  w.runtime.onConnect.emit(port)
  port.onMessage.emit({ type: 'init', tabId: 1 })
  port.onMessage.emit({ type: 'getStorage', requestId: 1 })
  await tick()
  assert.equal(reads, 1)
  port.onMessage.emit({ type: 'init', tabId: 2 })
  finishRead({ local: [{ key: 'private', value: 'old-tab' }], session: [] })
  await tick()
  assert.equal(port.replies.length, 0)
})

test('page metadata preserves duplicates and reads current DOM without accessing storage', () => {
  let listener
  const tags = [
    { property: 'og:image', content: 'one.png' },
    { property: 'og:image', content: 'two.png' },
    { name: 'description', content: '<b>literal</b>' },
    { name: 'twitter:card', content: 'summary' },
    { property: 'og:title', content: '' },
  ]
  const link = {
    rel: 'alternate CANONICAL',
    href: 'https://example.com/resolved',
    getAttribute: () => '/resolved',
  }
  let mutationCallback
  const notifications = []
  const context = {
    MutationObserver: class {
      constructor(callback) {
        mutationCallback = callback
      }
      observe() {}
    },
    clearTimeout() {},
    setTimeout(fn) {
      fn()
    },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => (listener = fn) },
        sendMessage: async (message) => notifications.push(message),
      },
    },
    document: {
      querySelectorAll: (selector) =>
        selector === 'link[rel]'
          ? [link]
          : tags.map((tag) => ({ getAttribute: (key) => tag[key] ?? null })),
    },
  }
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/storage-content.js'), 'utf8'),
    context,
  )
  let snapshot
  const read = () =>
    listener(
      { type: 'dev-sideboard:get-metadata' },
      {},
      (value) => (snapshot = value),
    )
  read()
  assert.equal(snapshot.canonical[0].value, 'https://example.com/resolved')
  assert.deepEqual(
    Array.from(snapshot.openGraph, (e) => e.value),
    ['one.png', 'two.png', ''],
  )
  assert.equal(snapshot.description[0].value, '<b>literal</b>')
  assert.equal(snapshot.twitter[0].value, 'summary')
  tags[0].content = 'changed.png'
  read()
  assert.equal(snapshot.openGraph[0].value, 'changed.png')
  mutationCallback([{ type: 'attributes', target: { matches: () => false } }])
  assert.equal(notifications.length, 0)
  mutationCallback([{ type: 'attributes', target: { matches: () => true } }])
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].type, 'dev-sideboard:metadata-changed')
  mutationCallback([
    {
      type: 'childList',
      addedNodes: [],
      removedNodes: [{ nodeType: 1, matches: () => true }],
    },
  ])
  assert.equal(notifications.length, 2)
})
