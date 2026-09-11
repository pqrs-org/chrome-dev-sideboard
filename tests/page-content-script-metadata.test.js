'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { runModule } = require('./helpers/run-module.js')

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
  runModule(
    require.resolve('../.test-build/src/page-content-script-metadata.js'),
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
  assert.equal(snapshot.description, undefined)
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
