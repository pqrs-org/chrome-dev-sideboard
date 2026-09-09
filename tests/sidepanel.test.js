'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const createPanel = async () => {
  const elements = new Map()
  const listeners = {}
  const queries = []
  const stored = {}
  let storageListener

  let query = async () => [
    { id: 1, title: 'First page', url: 'https://example.com/' },
  ]
  const tabs = {
    query: (options) => {
      queries.push(options)
      return query()
    },
  }
  for (const event of ['onActivated', 'onUpdated', 'onRemoved', 'onReplaced']) {
    tabs[event] = {
      addListener: (listener) => {
        listeners[event] = listener
      },
    }
  }
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/sidepanel.js'), 'utf8'),
    {
      PageNetworkStats: require('../src/network-stats.js'),
      document: {
        querySelector: (selector) => {
          const element = {
            textContent: '',
            open: false,
            showModal() {
              this.open = true
            },
            close() {
              this.open = false
            },
            classList: { add() {} },
            listeners: {},
            addEventListener(type, fn) {
              this.listeners[type] = fn
            },
          }
          elements.set(selector, element)
          return element
        },
      },
      chrome: {
        tabs,
        storage: {
          session: { get: async () => stored },
          onChanged: {
            addListener: (fn) => {
              storageListener = fn
            },
          },
        },
        windows: { getCurrent: async () => ({ id: 7 }) },
      },
    },
  )
  await new Promise(setImmediate)
  return {
    elements,
    stored,
    storageChanged: (...args) => storageListener(...args),
    listeners,
    queries,
    setQuery: (value) => {
      query = value
    },
  }
}

test('panel displays full title scoped to its own window', async () => {
  const panel = await createPanel()
  assert.equal(panel.queries[0].windowId, 7)
  assert.equal(panel.queries[0].active, true)
  const title = 'A long title '.repeat(40)
  panel.setQuery(async () => [{ title, url: 'https://example.com/next' }])
  panel.listeners.onActivated({ windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#pageTitle').textContent, title)
  assert.equal(panel.elements.has('#pageUrl'), false)
})

test('panel ignores other windows and background tab updates', async () => {
  const panel = await createPanel()
  panel.listeners.onActivated({ windowId: 8 })
  panel.listeners.onUpdated(
    1,
    { title: 'Other' },
    { windowId: 8, active: true },
  )
  panel.listeners.onUpdated(
    1,
    { title: 'Background' },
    { windowId: 7, active: false },
  )
  assert.equal(panel.queries.length, 1)
  panel.setQuery(async () => [
    { title: 'Updated', url: 'https://example.com/' },
  ])
  panel.listeners.onUpdated(
    1,
    { title: 'Updated' },
    { windowId: 7, active: true },
  )
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#pageTitle').textContent, 'Updated')
})

test('a slower old query cannot overwrite the new active tab', async () => {
  const panel = await createPanel()
  let resolve
  panel.setQuery(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  panel.listeners.onActivated({ windowId: 7 })
  panel.setQuery(async () => [
    { title: 'Latest', url: 'https://latest.example/' },
  ])
  panel.listeners.onActivated({ windowId: 7 })
  await new Promise(setImmediate)
  resolve([{ title: 'Old', url: 'https://old.example/' }])
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#pageTitle').textContent, 'Latest')
})

test('unreadable tabs and errors clear stale page details', async () => {
  const panel = await createPanel()
  panel.setQuery(async () => [{ id: 2 }])
  panel.listeners.onActivated({ windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(
    panel.elements.get('#pageTitle').textContent,
    'Page information unavailable',
  )
  assert.equal(panel.elements.has('#pageUrl'), false)
  panel.setQuery(async () => {
    throw new Error('Tab closed')
  })
  panel.listeners.onRemoved(2, { windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#status').textContent, 'Tab closed')
})

test('network updates only apply to the active tab and clear on tab switch', async () => {
  const panel = await createPanel()
  const stats = require('../src/network-stats.js')
  const state = stats.reduce(
    undefined,
    stats.normalizeEvent('start', {
      tabId: 1,
      requestId: '1',
      type: 'main_frame',
      url: 'https://example.com/',
      timeStamp: 1000,
    }),
  )
  panel.storageChanged({ 'network:2': { newValue: state } }, 'session')
  assert.equal(panel.elements.get('#requests').textContent, '—')
  panel.storageChanged({ 'network:1': { newValue: state } }, 'session')
  assert.equal(panel.elements.get('#requests').textContent, '1')
  panel.setQuery(async () => [
    { id: 2, title: 'Next', url: 'https://next.example/' },
  ])
  panel.listeners.onActivated({ windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#requests').textContent, '—')
  panel.storageChanged({ 'network:1': { newValue: state } }, 'session')
  assert.equal(panel.elements.get('#requests').textContent, '—')
})

test('network updates do not appear on unsupported pages', async () => {
  const panel = await createPanel()
  panel.setQuery(async () => [
    { id: 1, title: 'Extensions', url: 'chrome://extensions/' },
  ])
  panel.listeners.onActivated({ windowId: 7 })
  await new Promise(setImmediate)
  panel.storageChanged({ 'network:1': { newValue: {} } }, 'session')
  assert.equal(panel.elements.get('#requests').textContent, '—')
  assert.match(panel.elements.get('#networkScope').textContent, /unavailable/)
})

test('failure dialog filters categories, updates live, and closes on tab switch', async () => {
  const panel = await createPanel()
  const stats = require('../src/network-stats.js')
  const state = stats.reduce(
    undefined,
    stats.normalizeEvent('start', {
      tabId: 1,
      requestId: '1',
      type: 'main_frame',
      url: 'https://example.com/',
      timeStamp: 1000,
    }),
  )
  state.networkErrors = 1
  state.httpErrors = 1
  state.failureDetails = [
    {
      kind: 'networkErrors',
      url: 'https://example.com/fail',
      method: 'GET',
      reason: 'net::ERR_ABORTED',
      timeStamp: 1100,
    },
    {
      kind: 'httpErrors',
      url: 'https://example.com/missing',
      method: 'GET',
      reason: 'HTTP 404',
      timeStamp: 1200,
    },
  ]
  panel.storageChanged({ 'network:1': { newValue: state } }, 'session')
  panel.elements.get('#networkErrors').listeners.click()
  assert.equal(panel.elements.get('#failureDialog').open, true)
  assert.match(
    panel.elements.get('#failureList').textContent,
    /net::ERR_ABORTED/,
  )
  assert.doesNotMatch(
    panel.elements.get('#failureList').textContent,
    /HTTP 404/,
  )
  state.networkErrors++
  panel.storageChanged({ 'network:1': { newValue: state } }, 'session')
  assert.match(panel.elements.get('#failureSummary').textContent, /1 of 2/)
  panel.elements.get('#closeFailures').listeners.click()
  assert.equal(panel.elements.get('#failureDialog').open, false)
  panel.elements.get('#httpErrors').listeners.click()
  assert.match(panel.elements.get('#failureList').textContent, /HTTP 404/)
  panel.setQuery(async () => [
    { id: 2, title: 'Next', url: 'https://example.com/next' },
  ])
  panel.listeners.onActivated({ windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#failureDialog').open, false)
  assert.equal(panel.elements.get('#networkErrors').disabled, true)
})
