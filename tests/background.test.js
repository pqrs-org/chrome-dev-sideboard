'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { runModule } = require('./helpers/run-module.js')

const event = () => {
  let callback
  return {
    addListener(fn) {
      callback = fn
    },
    emit(...args) {
      callback(...args)
    },
  }
}
const worker = (stored) => {
  const api = {
    sidePanel: { setPanelBehavior: async () => {} },
    storage: {
      session: {
        get: async (key) => ({ [key]: structuredClone(stored[key]) }),
        set: async (values) => Object.assign(stored, structuredClone(values)),
        remove: async (key) => {
          delete stored[key]
        },
      },
    },
    tabs: { onRemoved: event(), onReplaced: event() },
    webNavigation: { onCommitted: event() },
    webRequest: Object.fromEntries(
      [
        'onBeforeRequest',
        'onHeadersReceived',
        'onBeforeRedirect',
        'onCompleted',
        'onErrorOccurred',
      ].map((name) => [name, event()]),
    ),
  }
  runModule(require.resolve('../.test-build/src/background.js'), {
    chrome: api,
    console,
  })
  return api
}

test('manifest uses passive network permissions and opens a side panel', () => {
  const manifest = require('../build/manifest.json')
  assert.equal(manifest.minimum_chrome_version, '142')
  assert.deepEqual(manifest.permissions, [
    'tabs',
    'sidePanel',
    'webRequest',
    'webNavigation',
    'storage',
    'cookies',
  ])
  assert.equal(manifest.action.default_popup, undefined)
  assert.equal(manifest.content_scripts.length, 1)
  assert.equal(manifest.content_scripts[0].world, 'ISOLATED')
  assert.notEqual(manifest.content_scripts[0].all_frames, true)
  assert.deepEqual(manifest.content_scripts[0].js, ['src/storage-content.js'])
  assert.ok(
    fs.existsSync(
      require.resolve(`../build/${manifest.side_panel.default_path}`),
    ),
  )
})

test('worker serializes network events, restores session totals, and cleans up closed tabs', async () => {
  const stored = {}
  let api = worker(stored)
  const d = {
    tabId: 1,
    type: 'main_frame',
    requestId: '1',
    timeStamp: 1000,
    url: 'https://example.com/',
  }
  api.webRequest.onBeforeRequest.emit(d)
  api.webRequest.onHeadersReceived.emit({
    ...d,
    statusCode: 200,
    responseHeaders: [{ name: 'Content-Length', value: '100' }],
  })
  api.webRequest.onCompleted.emit({ ...d, statusCode: 200, timeStamp: 1200 })
  await new Promise(setImmediate)
  assert.equal(stored['network:1'].completed, 1)
  assert.equal(stored['network:1'].knownBytes, 100)
  api = worker(stored)
  api.webRequest.onBeforeRequest.emit({ ...d, type: 'image', requestId: '2' })
  api.webRequest.onErrorOccurred.emit({ ...d, requestId: '2' })
  await new Promise(setImmediate)
  assert.equal(stored['network:1'].requests, 2)
  assert.equal(stored['network:1'].networkErrors, 1)
  api.tabs.onRemoved.emit(1)
  await new Promise(setImmediate)
  assert.equal(stored['network:1'], undefined)
})
