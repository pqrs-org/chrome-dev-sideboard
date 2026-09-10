'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { runModule } = require('./helpers/run-module.js')
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
  runModule(require.resolve('../.test-build/src/storage-content.js'), {
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
  })
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
  runModule(require.resolve('../.test-build/src/storage-content.js'), context)
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
