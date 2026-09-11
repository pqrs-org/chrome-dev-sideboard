import {
  tabEvents,
  required,
  RequiredMap,
  TestElement,
  type TabEvents,
  type TabQuery,
  type TestTab,
} from './helpers/mocks.js'
import { PageNetworkStats } from '../src/network-stats.js'

import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'

const createPanel = async () => {
  const elements = new RequiredMap<string, TestElement>()
  const listeners: Partial<TabEvents> = {}
  const queries: chrome.tabs.QueryInfo[] = []
  const stored: Record<string, NetworkState> = {}
  let storageListener!: (
    changes: Record<string, { newValue: Partial<NetworkState> }>,
    area: string,
  ) => void

  let query: TabQuery = async () => [
    { id: 1, title: 'First page', url: 'https://example.com/' },
  ]
  const tabs = {
    ...tabEvents(listeners),
    query: (options: chrome.tabs.QueryInfo) => {
      queries.push(options)
      return query()
    },
  }

  runModule('../src/sidepanel-overview.js', {
    document: {
      querySelector: (selector: string) => {
        const element = new TestElement()
        elements.set(selector, element)
        return element
      },
    },
    chrome: {
      tabs,
      storage: {
        session: { get: async () => stored },
        onChanged: {
          addListener: (fn: typeof storageListener) => {
            storageListener = fn
          },
        },
      },
      windows: { getCurrent: async () => ({ id: 7 }) },
    },
  })
  await new Promise(setImmediate)
  return {
    elements,
    stored,
    storageChanged: (...args: Parameters<typeof storageListener>) =>
      storageListener(...args),
    listeners,
    queries,
    setQuery: (value: TabQuery) => {
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
  required(panel.listeners.onActivated)({ windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#pageTitle').textContent, title)
  assert.equal(panel.elements.has('#pageUrl'), false)
})

test('panel ignores other windows and background tab updates', async () => {
  const panel = await createPanel()
  required(panel.listeners.onActivated)({ windowId: 8 })
  required(panel.listeners.onUpdated)(
    1,
    { title: 'Other' },
    { windowId: 8, active: true },
  )
  required(panel.listeners.onUpdated)(
    1,
    { title: 'Background' },
    { windowId: 7, active: false },
  )
  assert.equal(panel.queries.length, 1)
  panel.setQuery(async () => [
    { title: 'Updated', url: 'https://example.com/' },
  ])
  required(panel.listeners.onUpdated)(
    1,
    { title: 'Updated' },
    { windowId: 7, active: true },
  )
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#pageTitle').textContent, 'Updated')
})

test('a slower old query cannot overwrite the new active tab', async () => {
  const panel = await createPanel()
  let resolve!: (tabs: TestTab[]) => void
  panel.setQuery(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  required(panel.listeners.onActivated)({ windowId: 7 })
  panel.setQuery(async () => [
    { title: 'Latest', url: 'https://latest.example/' },
  ])
  required(panel.listeners.onActivated)({ windowId: 7 })
  await new Promise(setImmediate)
  resolve([{ title: 'Old', url: 'https://old.example/' }])
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#pageTitle').textContent, 'Latest')
})

test('unreadable tabs and errors clear stale page details', async () => {
  const panel = await createPanel()
  panel.setQuery(async () => [{ id: 2 }])
  required(panel.listeners.onActivated)({ windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(
    panel.elements.get('#pageTitle').textContent,
    'Page information unavailable',
  )
  assert.equal(panel.elements.has('#pageUrl'), false)
  panel.setQuery(async () => {
    throw new Error('Tab closed')
  })
  required(panel.listeners.onRemoved)(2, { windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#status').textContent, 'Tab closed')
})

test('network updates only apply to the active tab and clear on tab switch', async () => {
  const panel = await createPanel()
  const stats = PageNetworkStats
  const state = required(
    stats.reduce(
      undefined,
      stats.normalizeEvent('start', {
        tabId: 1,
        requestId: '1',
        type: 'main_frame',
        url: 'https://example.com/',
        timeStamp: 1000,
      }),
    ),
  )
  panel.storageChanged({ 'network:2': { newValue: state } }, 'session')
  assert.equal(panel.elements.get('#requests').textContent, '—')
  panel.storageChanged({ 'network:1': { newValue: state } }, 'session')
  assert.equal(panel.elements.get('#requests').textContent, '1')
  panel.setQuery(async () => [
    { id: 2, title: 'Next', url: 'https://next.example/' },
  ])
  required(panel.listeners.onActivated)({ windowId: 7 })
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
  required(panel.listeners.onActivated)({ windowId: 7 })
  await new Promise(setImmediate)
  panel.storageChanged({ 'network:1': { newValue: {} } }, 'session')
  assert.equal(panel.elements.get('#requests').textContent, '—')
  assert.match(panel.elements.get('#networkScope').textContent, /unavailable/)
})

test('failure dialog filters categories, updates live, and closes on tab switch', async () => {
  const panel = await createPanel()
  const stats = PageNetworkStats
  const state = required(
    stats.reduce(
      undefined,
      stats.normalizeEvent('start', {
        tabId: 1,
        requestId: '1',
        type: 'main_frame',
        url: 'https://example.com/',
        timeStamp: 1000,
      }),
    ),
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
  required(panel.listeners.onActivated)({ windowId: 7 })
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#failureDialog').open, false)
  assert.equal(panel.elements.get('#networkErrors').disabled, true)
})

test('title updates preserve failure details but a new navigation closes them', async () => {
  const panel = await createPanel()
  const stats = PageNetworkStats
  const state = required(
    stats.reduce(
      undefined,
      stats.normalizeEvent('start', {
        tabId: 1,
        requestId: '1',
        type: 'main_frame',
        url: 'https://example.com/',
        timeStamp: 1000,
      }),
    ),
  )
  state.networkErrors = 1
  panel.stored['network:1'] = state
  panel.storageChanged({ 'network:1': { newValue: state } }, 'session')
  panel.elements.get('#networkErrors').listeners.click()
  panel.setQuery(async () => [
    { id: 1, title: 'New title', url: 'https://example.com/' },
  ])
  required(panel.listeners.onUpdated)(
    1,
    { title: 'New title' },
    { windowId: 7, active: true },
  )
  await new Promise(setImmediate)
  assert.equal(panel.elements.get('#failureDialog').open, true)
  assert.equal(panel.elements.get('#pageTitle').textContent, 'New title')
  assert.equal(panel.elements.get('#networkErrors').textContent, '1')
  panel.storageChanged(
    { 'network:1': { newValue: { ...state, startedAt: 2000 } } },
    'session',
  )
  assert.equal(panel.elements.get('#failureDialog').open, false)
})
