const test = require('node:test')
const assert = require('node:assert/strict')
const { runModule } = require('./helpers/run-module.js')
const tick = () => new Promise(setImmediate)

const setup = () => {
  let documentId = 'doc-1'
  const listeners = new Set()
  const runtime = {
    id: 'extension',
    onMessage: {
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
    },
  }
  const sent = []
  const tabs = {
    sendMessage: async (...args) => {
      sent.push(args)
      return { ok: true, snapshot: { local: [], session: [] } }
    },
  }
  const writes = []
  const cookies = {
    read: async () => ({ documentId, cookies: [] }),
    write: async (...args) => writes.push(args),
  }
  const { SidepanelPageAccess: api } = runModule(
    require.resolve('../.test-build/src/sidepanel-page-access.js'),
    {
      chrome: {
        runtime,
        tabs,
        webNavigation: { getFrame: async () => ({ documentId }) },
      },
    },
    { './cookie-store.js': { ExtensionCookies: cookies } },
  )
  return {
    api,
    sent,
    tabs,
    writes,
    cookies,
    listeners,
    setDocument: (id) => {
      documentId = id
    },
  }
}

test('side panel rejects a snapshot that finishes after navigation', async () => {
  const s = setup()
  let finish
  s.tabs.sendMessage = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const read = s.api.readMetadata(1)
  await tick()
  s.setDocument('doc-2')
  finish({ openGraph: [{ key: 'og:description', value: 'old page' }] })
  const result = await read
  assert.match(result.error, /page changed/)
  assert.equal(result.openGraph, undefined)
})

test('metadata notifications require the extension, main frame and current document; commands are not accepted', async () => {
  const s = setup()
  const changed = []
  const stop = s.api.observeMetadataChanges((tabId) => changed.push(tabId))
  const listener = [...s.listeners][0]
  const sender = {
    id: 'extension',
    tab: { id: 1 },
    frameId: 0,
    documentId: 'doc-1',
  }
  for (const invalid of [
    { ...sender, id: 'other' },
    { ...sender, frameId: 1 },
    { ...sender, documentId: 'old' },
    { ...sender, tab: undefined },
  ]) {
    listener({ type: 'dev-sideboard:metadata-changed' }, invalid)
  }
  listener({ type: 'setStorage' }, sender)
  await tick()
  assert.deepEqual(changed, [])
  assert.equal(s.sent.length, 0)
  listener({ type: 'dev-sideboard:metadata-changed' }, sender)
  await tick()
  assert.deepEqual(changed, [1])
  stop()
  assert.equal(s.listeners.size, 0)
})
