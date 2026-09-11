const test = require('node:test')
const assert = require('node:assert/strict')
const { runModule } = require('./helpers/run-module.js')
const tick = () => new Promise(setImmediate)

const setup = (windowError) => {
  const events = {}
  const registrations = {}
  let windowQueries = 0
  let tabQueries = 0
  let query = async () => [{ id: 1, windowId: 7, active: true, title: 'First' }]
  const tabs = {
    query: (options) => {
      assert.equal(options.windowId, 7)
      assert.equal(options.active, true)
      tabQueries++
      return query()
    },
  }
  for (const event of ['onActivated', 'onUpdated', 'onRemoved', 'onReplaced']) {
    tabs[event] = {
      addListener: (listener) => {
        registrations[event] = (registrations[event] || 0) + 1
        events[event] = listener
      },
    }
  }
  const { SidepanelActiveTab } = runModule(
    require.resolve('../.test-build/src/sidepanel-active-tab.js'),
    {
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
    },
  )
  return {
    api: SidepanelActiveTab,
    events,
    registrations,
    counts: () => ({ windows: windowQueries, tabs: tabQueries }),
    setQuery: (next) => {
      query = next
    },
  }
}

test('active tab observation shares one query and event subscription between consumers', async () => {
  const s = setup()
  const overview = []
  const tabs = []
  s.api.observe((update) => overview.push(update))
  s.api.observe((update) => tabs.push(update))
  await tick()
  assert.deepEqual(s.counts(), { windows: 1, tabs: 1 })
  assert.ok(Object.values(s.registrations).every((count) => count === 1))
  assert.equal(overview[0], tabs[0])
  const late = []
  s.api.observe((update) => late.push(update))
  assert.equal(late[0], overview[0])
  assert.equal(s.counts().tabs, 1)
  s.events.onActivated({ windowId: 8 })
  s.events.onUpdated(2, { title: 'Background' }, { windowId: 7, active: false })
  s.events.onRemoved(2, { windowId: 8 })
  assert.equal(s.counts().tabs, 1)
  s.events.onActivated({ windowId: 7 })
  await tick()
  assert.equal(s.counts().tabs, 2)
  assert.equal(overview[1], tabs[1])
})

test('overlapping title updates retain navigation invalidation and discard old query results', async () => {
  const s = setup()
  const updates = []
  s.api.observe((update) => updates.push(update))
  await tick()
  let finishOld
  s.setQuery(
    () =>
      new Promise((resolve) => {
        finishOld = resolve
      }),
  )
  s.events.onUpdated(
    1,
    { url: 'https://example.com/new' },
    { windowId: 7, active: true },
  )
  s.setQuery(async () => [{ id: 1, title: 'New title' }])
  s.events.onUpdated(1, { title: 'New title' }, { windowId: 7, active: true })
  await tick()
  assert.equal(updates.at(-1).pageChanged, true)
  assert.equal(updates.at(-1).tab.title, 'New title')
  finishOld([{ id: 1, title: 'Old title' }])
  await tick()
  assert.equal(updates.length, 2)
  s.events.onUpdated(1, { title: 'New title' }, { windowId: 7, active: true })
  await tick()
  assert.equal(updates.at(-1).pageChanged, false)
  s.events.onUpdated(1, { status: 'complete' }, { windowId: 7, active: true })
  await tick()
  assert.equal(updates.at(-1).pageChanged, true)
})

test('active tab query failures clear both consumers and recover on the next event', async () => {
  const s = setup()
  const first = []
  const second = []
  s.api.observe((update) => first.push(update))
  s.api.observe((update) => second.push(update))
  await tick()
  s.setQuery(async () => {
    throw new Error('Tab closed')
  })
  s.events.onActivated({ windowId: 7 })
  await tick()
  assert.equal(first.at(-1).error, 'Tab closed')
  assert.equal(first.at(-1).tab, undefined)
  assert.equal(first.at(-1), second.at(-1))
  s.setQuery(async () => [{ id: 2 }])
  s.events.onReplaced(2, 1)
  await tick()
  assert.equal(first.at(-1).tab.id, 2)
  assert.equal(first.at(-1).error, undefined)
  s.setQuery(async () => [])
  s.events.onRemoved(2, { windowId: 7 })
  await tick()
  assert.equal(first.at(-1).tab, undefined)
})

test('window lookup failures are shared without starting unscoped tab queries', async () => {
  const s = setup(new Error('Window closed'))
  const updates = []
  s.api.observe((update) => updates.push(update))
  s.api.observe((update) => updates.push(update))
  await tick()
  assert.equal(updates.length, 2)
  assert.equal(updates[0].error, 'Window closed')
  assert.deepEqual(s.counts(), { windows: 1, tabs: 0 })
})
