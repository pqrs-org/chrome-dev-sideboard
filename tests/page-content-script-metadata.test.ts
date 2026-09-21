import { required, type MessageListener } from './helpers/mocks.js'
type TestMutation = {
  type: string
  target?: { matches: () => boolean }
  addedNodes?: unknown[]
  removedNodes?: { nodeType: number; matches: () => boolean }[]
}
import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'

test('page metadata preserves duplicates and reads current DOM without accessing storage', () => {
  let listener!: MessageListener<MetadataSnapshot>
  const tags: Record<string, string>[] = [
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
  let mutationCallback!: (records: TestMutation[]) => void
  const notifications: { type: string }[] = []
  const context = {
    MutationObserver: class {
      constructor(callback: typeof mutationCallback) {
        mutationCallback = callback
      }
      observe() {}
    },
    clearTimeout() {},
    setTimeout(fn: () => void) {
      fn()
    },
    chrome: {
      runtime: {
        id: 'extension',
        onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
        sendMessage: async (message: { type: string }) =>
          notifications.push(message),
      },
    },
    document: {
      querySelectorAll: (selector: string) =>
        selector === 'link[rel]'
          ? [link]
          : tags.map((tag) => ({
              getAttribute: (key: string) => tag[key] ?? null,
            })),
    },
  }
  runModule('../src/page-content-script-metadata.js', context)
  let snapshot!: MetadataSnapshot
  const read = () =>
    listener(
      { type: 'dev-sideboard:get-metadata' },
      {},
      (value) => (snapshot = value),
    )
  read()
  assert.equal(
    required(snapshot.canonical)[0].value,
    'https://example.com/resolved',
  )
  assert.deepEqual(
    Array.from(required(snapshot.openGraph), (e) => e.value),
    ['one.png', 'two.png', ''],
  )
  assert.equal(
    'description' in snapshot ? snapshot.description : undefined,
    undefined,
  )
  assert.equal(required(snapshot.twitter)[0].value, 'summary')
  tags[0].content = 'changed.png'
  read()
  assert.equal(required(snapshot.openGraph)[0].value, 'changed.png')
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

for (const failure of [
  'missing runtime',
  'missing id',
  'synchronous invalidation',
  'asynchronous invalidation',
  'closed panel',
] as const) {
  test(`metadata notifications handle ${failure} without uncaught errors`, async () => {
    let listener!: MessageListener<MetadataSnapshot>
    let mutation!: (records: TestMutation[]) => void
    let timer: (() => void) | undefined
    let disconnected = false
    let sends = 0
    const runtime = {
      id: 'extension' as string | undefined,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn
        },
      },
      sendMessage: () => {
        sends++
        if (failure === 'synchronous invalidation') {
          throw new Error('Extension context invalidated.')
        }
        if (failure === 'asynchronous invalidation') {
          runtime.id = undefined
          return Promise.reject(new Error('Extension context invalidated.'))
        }
        return Promise.reject(new Error('Receiving end does not exist.'))
      },
    }
    const chrome: { runtime: typeof runtime | undefined } = { runtime }
    runModule('../src/page-content-script-metadata.js', {
      chrome,
      document: { querySelectorAll: () => [] },
      MutationObserver: class {
        constructor(callback: typeof mutation) {
          mutation = callback
        }
        observe() {}
        disconnect() {
          disconnected = true
        }
      },
      setTimeout: (callback: () => void) => {
        timer = callback
        return 1
      },
      clearTimeout: () => {
        timer = undefined
      },
    })
    listener({ type: 'dev-sideboard:get-metadata' }, {}, () => {})
    mutation([{ type: 'attributes', target: { matches: () => true } }])
    if (failure === 'missing runtime') {
      chrome.runtime = undefined
    }
    if (failure === 'missing id') {
      runtime.id = undefined
    }
    assert.doesNotThrow(() => required(timer)())
    await new Promise(setImmediate)
    assert.equal(disconnected, failure !== 'closed panel')
    assert.equal(
      sends,
      failure === 'missing runtime' || failure === 'missing id' ? 0 : 1,
    )
    if (failure === 'closed panel') {
      mutation([{ type: 'attributes', target: { matches: () => true } }])
      required(timer)()
      await new Promise(setImmediate)
      assert.equal(sends, 2)
      assert.equal(disconnected, false)
    }
  })
}
