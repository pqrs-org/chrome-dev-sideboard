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
    emit: (...args) => listeners.forEach((fn) => fn(...args)),
  }
}
function worker(stored = {}) {
  let documentId = 'doc-1'
  const runtime = { onMessage: event(), onConnect: event() }
  const tabs = { onRemoved: event(), onReplaced: event() }
  const navigation = {
    onCommitted: event(),
    getFrame: async () => ({ documentId }),
  }
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/capture-background.js'), 'utf8'),
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
test('capture history survives restart, rejects old documents and clears on navigation and close', async () => {
  const stored = {}
  let w = worker(stored)
  const sender = { tab: { id: 1 }, frameId: 0, documentId: 'doc-1' }
  const record = {
    type: 'json-fetch-visualizer:record',
    payload: {
      id: '1',
      url: 'https://user:pass@example.com/a#secret',
      raw: '{"ok":true}',
      status: 200,
      ok: true,
    },
  }
  w.runtime.onMessage.emit(record, sender)
  await tick()
  assert.equal(stored['captures:1'].records[0].url, 'https://example.com/a')
  w = worker(stored)
  w.runtime.onMessage.emit(
    { ...record, payload: { ...record.payload, id: '2' } },
    sender,
  )
  await tick()
  assert.equal(stored['captures:1'].records.length, 2)
  w.setDocument('doc-2')
  w.navigation.onCommitted.emit({ tabId: 1, frameId: 0, documentId: 'doc-2' })
  w.runtime.onMessage.emit(record, sender)
  await tick()
  assert.equal(stored['captures:1'], undefined)
  w.runtime.onMessage.emit(record, { ...sender, documentId: 'doc-2' })
  await tick()
  assert.equal(stored['captures:1'].records.length, 1)
  w.tabs.onRemoved.emit(1)
  await tick()
  assert.equal(stored['captures:1'], undefined)
})
test('capture bounds both individual payload and overall session history', async () => {
  const stored = {}
  const w = worker(stored)
  for (let i = 0; i < 85; i++)
    w.runtime.onMessage.emit(
      {
        type: 'json-fetch-visualizer:record',
        payload: { id: String(i), raw: 'x'.repeat(120000) },
      },
      { tab: { id: 1 }, frameId: 0, documentId: 'doc-1' },
    )
  await tick()
  const records = stored['captures:1'].records
  assert.ok(records.length <= 80)
  assert.ok(records.reduce((n, r) => n + JSON.stringify(r).length, 0) <= 512000)
  assert.equal(records.at(-1).raw.length, 100000)
  assert.equal(records.at(-1).truncated, true)
})
test('fetch capture preserves the response and limits clone reads', async () => {
  const messages = []
  let response = new Response('{"hello":"world"}', {
    headers: { 'Content-Type': 'application/json' },
  })
  const window = {
    fetch: async () => response,
    postMessage: (m) => messages.push(m),
  }
  function XHR() {}
  XHR.prototype.open = function () {}
  XHR.prototype.send = function () {}
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/capture.js'), 'utf8'),
    {
      window,
      XMLHttpRequest: XHR,
      URL,
      TextDecoder,
      performance,
      crypto: { randomUUID: () => 'session' },
      location: { href: 'https://example.com/' },
    },
  )
  const actual = await window.fetch('/api')
  assert.equal(actual, response)
  assert.deepEqual(await actual.json(), { hello: 'world' })
  for (let i = 0; i < 10 && messages.length < 2; i++) await tick()
  assert.equal(messages.at(-1).payload.raw, '{"hello":"world"}')
  assert.equal(messages.at(-1).payload.url, 'https://example.com/api')
  response = new Response('"' + 'x'.repeat(1024 * 1024) + '"', {
    headers: { 'Content-Type': 'application/json' },
  })
  const large = await window.fetch('/large')
  assert.equal((await large.text()).length, 1024 * 1024 + 2)
  for (let i = 0; i < 10 && messages.length < 3; i++) await tick()
  assert.equal(messages.at(-1).payload.truncated, true)
})

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
    fs.readFileSync(require.resolve('../src/capture-bridge.js'), 'utf8'),
    {
      window: {
        addEventListener() {},
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
    type: 'json-fetch-visualizer:set-storage',
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
    type: 'json-fetch-visualizer:set-storage',
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
    type: 'json-fetch-visualizer:delete-storage',
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
    name: 'json-fetch-visualizer:panel',
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

test('fetch observer returns the original promise and preserves rejection even if reporting fails', async () => {
  const failure = new TypeError('Failed to fetch')
  let reject
  const original = new Promise((_resolve, fail) => {
    reject = fail
  })
  let observed
  let nativeThis
  let nativeArgs
  const window = {
    fetch: function (...args) {
      nativeThis = this
      nativeArgs = args
      return original
    },
    postMessage(message) {
      if (message.type.endsWith(':record')) {
        observed = message.payload
        throw new Error('Reporting unavailable')
      }
    },
  }
  function XHR() {}
  XHR.prototype.open = function () {}
  XHR.prototype.send = function () {}
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/capture.js'), 'utf8'),
    {
      window,
      XMLHttpRequest: XHR,
      URL,
      TextDecoder,
      performance,
      crypto: { randomUUID: () => 'session' },
      location: { href: 'https://example.com/' },
    },
  )
  const options = { method: 'POST' }
  const result = window.fetch('/api', options)
  assert.equal(result, original)
  assert.equal(nativeThis, window)
  assert.equal(nativeArgs[0], '/api')
  assert.equal(nativeArgs[1], options)
  reject(failure)
  await assert.rejects(result, (error) => error === failure)
  await tick()
  assert.equal(observed.status, 0)
  assert.equal(observed.parseError, 'Failed to fetch')
})
