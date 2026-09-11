import type { SidepanelActiveTab } from '../src/sidepanel-active-tab.js'
type Update = Parameters<Parameters<typeof SidepanelActiveTab.observe>[0]>[0]
import {
  tabEvents,
  required,
  type TabEvents,
  type TabQuery,
  type TestTab,
} from './helpers/mocks.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'
const tick = () => new Promise(setImmediate)

const setup = (windowError?: Error) => {
  const events: Partial<TabEvents> = {}
  const registrations: Record<string, number> = {}
  let windowQueries = 0
  let tabQueries = 0
  let query: TabQuery = async () => [
    { id: 1, windowId: 7, active: true, title: 'First' },
  ]
  const tabs = {
    ...tabEvents(events, registrations),
    query: (options: chrome.tabs.QueryInfo) => {
      assert.equal(options.windowId, 7)
      assert.equal(options.active, true)
      tabQueries++
      return query()
    },
  }

  const { SidepanelActiveTab } = runModule('../src/sidepanel-active-tab.js', {
    chrome: {
      tabs,
      windows: {
        getCurrent: async () => {
          windowQueries++
          if (windowError) {
            throw windowError
          }
          return { id: 7 }
        },
      },
    },
  })
  return {
    api: SidepanelActiveTab,
    events,
    registrations,
    counts: () => ({ windows: windowQueries, tabs: tabQueries }),
    setQuery: (next: TabQuery) => {
      query = next
    },
  }
}

test('active tab observation shares one query and event subscription between consumers', async () => {
  const s = setup()
  const overview: Update[] = []
  const tabs: Update[] = []
  s.api.observe((update) => overview.push(update))
  s.api.observe((update) => tabs.push(update))
  await tick()
  assert.deepEqual(s.counts(), { windows: 1, tabs: 1 })
  assert.ok(Object.values(s.registrations).every((count) => count === 1))
  assert.equal(overview[0], tabs[0])
  const late: Update[] = []
  s.api.observe((update) => late.push(update))
  assert.equal(late[0], overview[0])
  assert.equal(s.counts().tabs, 1)
  required(s.events.onActivated)({ windowId: 8 })
  required(s.events.onUpdated)(
    2,
    { title: 'Background' },
    { windowId: 7, active: false },
  )
  required(s.events.onRemoved)(2, { windowId: 8 })
  assert.equal(s.counts().tabs, 1)
  required(s.events.onActivated)({ windowId: 7 })
  await tick()
  assert.equal(s.counts().tabs, 2)
  assert.equal(overview[1], tabs[1])
})

test('overlapping title updates retain navigation invalidation and discard old query results', async () => {
  const s = setup()
  const updates: Update[] = []
  s.api.observe((update) => updates.push(update))
  await tick()
  let finishOld!: (tabs: TestTab[]) => void
  s.setQuery(
    () =>
      new Promise((resolve) => {
        finishOld = resolve
      }),
  )
  required(s.events.onUpdated)(
    1,
    { url: 'https://example.com/new' },
    { windowId: 7, active: true },
  )
  s.setQuery(async () => [{ id: 1, title: 'New title' }])
  required(s.events.onUpdated)(
    1,
    { title: 'New title' },
    { windowId: 7, active: true },
  )
  await tick()
  assert.equal(required(updates.at(-1)).pageChanged, true)
  assert.equal(required(updates.at(-1)).tab?.title, 'New title')
  finishOld([{ id: 1, title: 'Old title' }])
  await tick()
  assert.equal(updates.length, 2)
  required(s.events.onUpdated)(
    1,
    { title: 'New title' },
    { windowId: 7, active: true },
  )
  await tick()
  assert.equal(required(updates.at(-1)).pageChanged, false)
  required(s.events.onUpdated)(
    1,
    { status: 'complete' },
    { windowId: 7, active: true },
  )
  await tick()
  assert.equal(required(updates.at(-1)).pageChanged, true)
})

test('active tab query failures clear both consumers and recover on the next event', async () => {
  const s = setup()
  const first: Update[] = []
  const second: Update[] = []
  s.api.observe((update) => first.push(update))
  s.api.observe((update) => second.push(update))
  await tick()
  s.setQuery(async () => {
    throw new Error('Tab closed')
  })
  required(s.events.onActivated)({ windowId: 7 })
  await tick()
  assert.equal(required(first.at(-1)).error, 'Tab closed')
  assert.equal(required(first.at(-1)).tab, undefined)
  assert.equal(first.at(-1), second.at(-1))
  s.setQuery(async () => [{ id: 2 }])
  required(s.events.onReplaced)(2, 1)
  await tick()
  assert.equal(required(first.at(-1)).tab?.id, 2)
  assert.equal(required(first.at(-1)).error, undefined)
  s.setQuery(async () => [])
  required(s.events.onRemoved)(2, { windowId: 7 })
  await tick()
  assert.equal(required(first.at(-1)).tab, undefined)
})

test('window lookup failures are shared without starting unscoped tab queries', async () => {
  const s = setup(new Error('Window closed'))
  const updates: Update[] = []
  s.api.observe((update) => updates.push(update))
  s.api.observe((update) => updates.push(update))
  await tick()
  assert.equal(updates.length, 2)
  assert.equal(updates[0].error, 'Window closed')
  assert.deepEqual(s.counts(), { windows: 1, tabs: 0 })
})
