import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'
import { TestElement, RequiredMap } from './helpers/mocks.js'
import type { ActiveTabUpdate } from '../src/sidepanel-active-tab.js'

const historyStore = (savedHistory: unknown = {}) => ({
  stored: { viewportSizeHistory: savedHistory } as Record<string, unknown>,
  listeners: [] as ((
    changes: Record<string, { newValue: unknown }>,
    area: string,
  ) => void)[],
  locks: new Map<string, Promise<unknown>>(),
})
const panel = async ({
  zoom = 1,
  limited = false,
  history = {},
  shared = historyStore(history),
}: {
  zoom?: number
  limited?: boolean
  history?: unknown
  shared?: ReturnType<typeof historyStore>
} = {}) => {
  const { stored } = shared
  let focused: TestElement | undefined
  const setFocused = (element: TestElement) => {
    focused = element
  }
  class HistoryElement extends TestElement {
    getBoundingClientRect() {
      return { left: 100, top: 100, bottom: 125 }
    }
    showPopover() {
      const before = this.listeners.beforetoggle as unknown as (
        event: object,
      ) => void
      before?.({ newState: 'open' })
      this.open = true
      this.listeners.toggle?.()
    }
    matches() {
      return this.open
    }
    hidePopover() {
      this.open = false
      this.listeners.toggle?.()
    }
    override focus() {
      setFocused(this)
    }
    contains(node: TestElement): boolean {
      return (
        node === this ||
        this.children.some((child) => (child as HistoryElement).contains(node))
      )
    }
  }
  const documentEvents: Record<string, ((event: unknown) => void)[]> = {}
  const elements = new RequiredMap<string, TestElement>()
  let observe!: (update: ActiveTabUpdate) => void
  const polls: (() => void)[] = []
  let current = { id: 7, width: 1200, height: 900, state: 'maximized' }
  let bounds!: (window: Partial<chrome.windows.Window>) => void
  let sidebar = 400
  const updates: [number, chrome.windows.UpdateInfo][] = []
  let failHistorySave = false
  let fail = false
  let unavailable = false
  const reads: number[] = []
  runModule(
    '../src/sidepanel-window.js',
    {
      setInterval: (fn: () => void) => {
        polls.push(fn)
      },
      setTimeout: (fn: () => void) => {
        fn()
      },
      navigator: {
        locks: {
          request: (key: string, callback: () => Promise<unknown>) => {
            const next = (shared.locks.get(key) || Promise.resolve())
              .catch(() => {})
              .then(callback)
            shared.locks.set(key, next)
            return next
          },
        },
      },
      Node: HistoryElement,
      window: { innerWidth: 320, innerHeight: 600, addEventListener() {} },
      document: {
        addEventListener: (name: string, fn: (event: unknown) => void) => {
          ;(documentEvents[name] ||= []).push(fn)
        },
        createElement: () => new HistoryElement(),
        querySelector: (selector: string) => {
          const element = new HistoryElement()
          elements.set(selector, element)
          return element
        },
      },
      chrome: {
        storage: {
          onChanged: {
            addListener: (fn: (typeof shared.listeners)[number]) =>
              shared.listeners.push(fn),
          },
          local: {
            get: async () => JSON.parse(JSON.stringify(stored)),
            set: async (values: Record<string, unknown>) => {
              if (failHistorySave) {
                throw new Error('Storage unavailable')
              }
              Object.assign(stored, JSON.parse(JSON.stringify(values)))
              const changes = Object.fromEntries(
                Object.keys(values).map((key) => [
                  key,
                  { newValue: stored[key] },
                ]),
              )
              shared.listeners.forEach((fn) => fn(changes, 'local'))
            },
          },
        },
        webNavigation: { getFrame: async () => ({ documentId: 'doc' }) },
        tabs: {
          getZoom: async () => zoom,
          sendMessage: async (
            id: number,
            message: ContentRequest,
            options: { documentId: string },
          ) => {
            reads.push(id)
            assert.equal(message.type, 'dev-sideboard:get-viewport')
            assert.equal(options.documentId, 'doc')
            if (unavailable) {
              throw new Error('No content script')
            }
            return {
              width: (current.width - sidebar) / zoom,
              height: (current.height - 100) / zoom,
            }
          },
        },
        windows: {
          getCurrent: async () => current,
          onBoundsChanged: {
            addListener: (fn: typeof bounds) => {
              bounds = fn
            },
          },
          get: async () => current,
          update: async (id: number, info: chrome.windows.UpdateInfo) => {
            if (fail) {
              throw new Error('Window closed')
            }
            updates.push([id, structuredClone(info)])
            current = { ...current, ...info }
            if (limited) {
              current.width = Math.min(current.width, 1400)
            }
            return current
          },
        },
      },
    },
    {
      './sidepanel-active-tab.js': {
        SidepanelActiveTab: {
          observe: (fn) => {
            observe = fn
          },
        },
      },
    },
  )
  const activate = (id: number, url = 'https://example.com') =>
    observe({
      tab: { id, windowId: 7, url } as chrome.tabs.Tab,
      pageChanged: true,
    })
  activate(1)
  await new Promise(setImmediate)
  return {
    elements,
    stored,
    input: (selector: string, value: string) => {
      const input = elements.get(selector)
      input.value = value
      input.listeners.input()
    },
    history: (selector: string) =>
      elements
        .get(`${selector}HistoryMenu`)
        .children.map((row) => Number(row.children[0].textContent)),
    selectHistory: (selector: string, index = 0) =>
      elements
        .get(`${selector}HistoryMenu`)
        .children[index].children[0].listeners.click(),
    deleteHistory: async (selector: string, index = 0) => {
      await elements
        .get(`${selector}HistoryMenu`)
        .children[index].children[1].listeners.click()
    },
    focused: () => focused,
    key: (element: TestElement, key: string, target = element) => {
      ;(element.listeners.keydown as unknown as (event: object) => void)({
        key,
        target,
        preventDefault() {},
      })
    },
    documentEvent: (name: string, event: unknown) => {
      documentEvents[name]?.forEach((fn) => fn(event))
    },
    bounds: (window: Partial<chrome.windows.Window>) => bounds(window),
    updates,
    reads,
    activate,
    poll: async () => {
      polls.forEach((poll) => poll())
      await new Promise(setImmediate)
    },
    sidebar: (value: number) => {
      sidebar = value
    },
    failHistorySave: () => {
      failHistorySave = true
    },
    fail: () => {
      fail = true
    },
    unavailable: (value = true) => {
      unavailable = value
    },
    submit: async (form = '#windowResize') => {
      const submit = elements.get(form).listeners.submit as unknown as (event: {
        preventDefault(): void
      }) => Promise<void>
      await submit({ preventDefault() {} })
    },
  }
}
test('preserves viewport edits until the actual size changes', async () => {
  const p = await panel()
  assert.equal(p.elements.get('#windowWidth').value, '800')
  assert.equal(p.elements.get('#applyWindowSize').hidden, false)
  await p.submit()
  assert.equal(p.updates.length, 0)
  assert.equal(p.elements.get('#applyWindowSize').disabled, true)
  assert.equal(p.elements.get('#outerWidth').value, '1200')
  p.bounds({ id: 8, width: 1, height: 1 })
  assert.equal(p.elements.get('#outerWidth').value, '1200')
  p.bounds({ id: 7, width: 1300, height: 1000 })
  assert.equal(p.elements.get('#outerWidth').value, '1300')
  p.sidebar(500)
  await p.poll()
  assert.equal(p.elements.get('#windowWidth').value, '700')
  p.input('#windowWidth', '900')
  assert.equal(p.elements.get('#applyWindowSize').disabled, false)
  await p.poll()
  assert.equal(p.elements.get('#windowWidth').value, '900')
  p.sidebar(600)
  await p.poll()
  assert.equal(p.elements.get('#windowWidth').value, '600')
  assert.equal(p.elements.get('#applyWindowSize').disabled, true)
  p.activate(2)
  await new Promise(setImmediate)
  assert.equal(p.reads.at(-1), 2)
  p.activate(3, 'chrome://extensions')
  await p.poll()
  assert.equal(p.elements.get('#windowWidth').value, '')
  assert.equal(p.elements.get('#windowWidth').disabled, true)
  assert.equal(p.elements.get('#applyWindowSize').disabled, true)
})
test('history selection targets the viewport and accounts for browser chrome and page zoom', async () => {
  const p = await panel({
    zoom: 1.5,
    history: { width: [1280], height: [720] },
  })
  assert.equal(p.elements.get('#windowWidth').value, String(800 / 1.5))
  assert.equal(p.history('#windowWidth')[0], 1280)
  p.selectHistory('#windowWidth')
  p.selectHistory('#windowHeight')
  assert.equal(p.updates.length, 0)
  assert.equal(p.elements.get('#applyWindowSize').disabled, false)
  await p.submit()
  assert.deepEqual(p.updates, [
    [7, { state: 'normal' }],
    [7, { width: 2320, height: 1180 }],
  ])
  assert.equal(p.elements.get('#windowWidth').value, '1280')
  assert.equal(p.elements.get('#windowHeight').value, '720')
  assert.equal(p.elements.get('#applyWindowSize').disabled, true)
  assert.equal(p.elements.get('#windowStatus').textContent, '')
})
test('invalid input does not resize, errors re-enable Apply, unavailable pages disable it', async () => {
  const p = await panel()
  for (const value of ['', '0', '-1', '1.5', 'Infinity', '32768']) {
    p.input('#windowWidth', value)
    assert.equal(p.elements.get('#applyWindowSize').disabled, true)
    await p.submit()
    assert.equal(p.updates.length, 0)
  }
  p.input('#windowWidth', '1000')
  assert.equal(p.elements.get('#applyWindowSize').disabled, false)
  p.fail()
  await p.submit()
  assert.equal(p.elements.get('#windowStatus').textContent, 'Window closed')
  assert.equal(p.elements.get('#applyWindowSize').disabled, false)
  await new Promise(setImmediate)
  p.unavailable()
  await p.poll()
  assert.equal(p.elements.get('#applyWindowSize').disabled, true)
})
test('bounded correction reports actual viewport when the OS limits window size', async () => {
  const p = await panel({ limited: true })
  p.input('#windowWidth', '1280')
  p.input('#windowHeight', '720')
  await p.submit()
  assert.equal(p.updates.length, 5)
  assert.deepEqual(p.stored.viewportSizeHistory, {
    width: [1280],
    height: [720],
  })
  assert.equal(p.elements.get('#windowWidth').value, '1000')
  assert.equal(p.elements.get('#applyWindowSize').disabled, true)
  assert.match(
    p.elements.get('#windowStatus').textContent,
    /actual 1000 × 720 px/,
  )
})
test('history persists applied values, deduplicates them, and caps each dimension at 20', async () => {
  const p = await panel({
    history: {
      width: [
        900,
        800,
        900,
        'bad',
        0,
        ...Array.from({ length: 25 }, (_, i) => 1000 + i),
      ],
      height: [700, 800],
    },
  })
  assert.equal(p.history('#windowWidth').length, 20)
  assert.deepEqual(p.history('#windowWidth').slice(0, 3), [900, 800, 1000])
  p.input('#windowWidth', '800')
  p.input('#windowHeight', '700')
  await p.submit()
  assert.deepEqual(p.history('#windowWidth').slice(0, 3), [800, 900, 1000])
  assert.equal(p.history('#windowWidth').length, 20)
  assert.deepEqual(p.stored.viewportSizeHistory, {
    width: p.history('#windowWidth'),
    height: [700, 800],
  })
  const reopened = await panel({ history: p.stored.viewportSizeHistory })
  assert.equal(reopened.history('#windowWidth')[0], 800)
})
test('failed resizing does not add history', async () => {
  const p = await panel()
  p.input('#windowWidth', '1280')
  p.fail()
  await p.submit()
  assert.equal(p.history('#windowWidth').length, 0)
  assert.deepEqual(p.stored.viewportSizeHistory, {})
})
test('history save failures are visible without adding unsaved entries', async () => {
  const p = await panel()
  p.failHistorySave()
  p.input('#windowWidth', '900')
  await p.submit()
  assert.match(
    p.elements.get('#windowStatus').textContent,
    /history could not be saved/,
  )
  assert.equal(p.history('#windowWidth').length, 0)
  assert.equal(p.elements.get('#windowWidthHistory').disabled, true)
})
test('outer window sizing works on restricted tabs and preserves independent histories', async () => {
  const p = await panel()
  p.activate(2, 'chrome://extensions')
  await p.poll()
  assert.equal(p.elements.get('#windowWidth').disabled, true)
  assert.equal(p.elements.get('#outerWidth').disabled, false)
  p.input('#outerWidth', '1000')
  p.input('#outerHeight', '700')
  assert.equal(p.elements.get('#applyOuterSize').disabled, false)
  await p.submit('#outerResize')
  assert.deepEqual(p.updates, [
    [7, { state: 'normal' }],
    [7, { width: 1000, height: 700 }],
  ])
  assert.equal(p.elements.get('#outerWidth').value, '1000')
  assert.equal(p.elements.get('#applyOuterSize').disabled, true)
  assert.deepEqual(p.stored.windowSizeHistory, { width: [1000], height: [700] })
  assert.deepEqual(p.stored.viewportSizeHistory, {})
})
test('outer edits reset on size changes and OS limits show the actual result', async () => {
  const p = await panel({ limited: true })
  p.input('#outerWidth', '1800')
  p.bounds({ id: 7, width: 1200, height: 900 })
  assert.equal(p.elements.get('#outerWidth').value, '1800')
  p.bounds({ id: 7, width: 1300, height: 900 })
  assert.equal(p.elements.get('#outerWidth').value, '1300')
  assert.equal(p.elements.get('#applyOuterSize').disabled, true)
  p.input('#outerWidth', '1800')
  await p.submit('#outerResize')
  assert.equal(p.elements.get('#outerWidth').value, '1400')
  assert.match(p.elements.get('#outerStatus').textContent, /actual 1400 × 900/)
  assert.deepEqual(p.stored.windowSizeHistory, { width: [1800], height: [900] })
})
test('resizing replaces blank width and height fields with the current dimensions', async () => {
  const p = await panel()
  for (const prefix of ['outer', 'window']) {
    p.input(`#${prefix}Width`, '')
    p.input(`#${prefix}Height`, '')
  }
  await p.poll()
  assert.equal(p.elements.get('#outerWidth').value, '')
  assert.equal(p.elements.get('#windowHeight').value, '')
  p.bounds({ id: 7, width: 1100, height: 850 })
  assert.equal(p.elements.get('#outerWidth').value, '1100')
  assert.equal(p.elements.get('#outerHeight').value, '850')
  assert.equal(p.elements.get('#applyOuterSize').disabled, true)
  p.sidebar(500)
  await p.poll()
  assert.equal(p.elements.get('#windowWidth').value, '700')
  assert.equal(p.elements.get('#windowHeight').value, '800')
  assert.equal(p.elements.get('#applyWindowSize').disabled, true)
})
test('deleting an individual history item persists without changing input or resizing', async () => {
  const p = await panel({ history: { width: [900, 800], height: [700] } })
  const menu = p.elements.get('#windowWidthHistoryMenu')
  await p.deleteHistory('#windowWidth')
  assert.deepEqual(p.stored.viewportSizeHistory, {
    width: [800],
    height: [700],
  })
  assert.equal(p.elements.get('#windowWidth').value, '800')
  assert.equal(p.updates.length, 0)
  const reopened = await panel({ history: p.stored.viewportSizeHistory })
  assert.equal(reopened.history('#windowWidth')[0], 800)
  p.failHistorySave()
  await p.deleteHistory('#windowWidth')
  assert.equal(menu.children[0].children[0].textContent, '800')
  assert.match(
    p.elements.get('#windowStatus').textContent,
    /could not be deleted/,
  )
})
test('outer history deletion is independent of viewport history', async () => {
  const p = await panel({ history: { width: [900], height: [700] } })
  p.input('#outerWidth', '1000')
  await p.submit('#outerResize')
  await p.deleteHistory('#outerWidth')
  assert.deepEqual(p.stored.windowSizeHistory, { width: [], height: [900] })
  assert.deepEqual(p.stored.viewportSizeHistory, {
    width: [900],
    height: [700],
  })
  assert.equal(p.elements.get('#outerWidthHistory').disabled, true)
})
test('history popover supports keyboard navigation, selection, deletion and dismissal', async () => {
  const p = await panel({ history: { width: [900, 1000], height: [700] } })
  const trigger = p.elements.get('#windowWidthHistory')
  const menu = p.elements.get('#windowWidthHistoryMenu')
  p.key(trigger, 'ArrowDown')
  assert.equal(menu.open, true)
  assert.equal(trigger.attributes['aria-expanded'], 'true')
  assert.equal(p.focused(), menu.children[0].children[0])
  p.key(menu, 'ArrowDown', menu.children[0].children[0])
  assert.equal(p.focused(), menu.children[1].children[0])
  p.key(menu, 'ArrowRight', menu.children[1].children[0])
  assert.equal(p.focused(), menu.children[1].children[1])
  await p.deleteHistory('#windowWidth', 1)
  assert.equal(menu.open, true)
  assert.equal(p.focused(), menu.children[0].children[1])
  assert.equal(p.elements.get('#windowWidth').value, '800')
  assert.equal(p.updates.length, 0)
  p.key(menu, 'Escape')
  assert.equal(menu.open, false)
  assert.equal(p.focused(), trigger)
  p.key(trigger, 'ArrowDown')
  menu.children[0].children[0].listeners.click()
  assert.equal(p.elements.get('#windowWidth').value, '900')
  assert.equal(menu.open, false)
  assert.equal(p.focused(), p.elements.get('#windowWidth'))
  p.key(trigger, 'ArrowDown')
  p.documentEvent('scroll', { target: menu })
  assert.equal(menu.open, true)
  p.documentEvent('scroll', { target: new TestElement() })
  assert.equal(menu.open, false)
})
test('multiple panels preserve concurrent history updates and do not restore deleted entries', async () => {
  const shared = historyStore({ width: [900], height: [800] })
  const first = await panel({ shared })
  const second = await panel({ shared })
  await first.deleteHistory('#windowWidth')
  assert.equal(second.history('#windowWidth').length, 0)
  for (const [p, value] of [
    [first, '1000'],
    [second, '1100'],
  ] as const) {
    p.input('#windowWidth', value)
  }
  await Promise.all([first.submit(), second.submit()])
  const saved = shared.stored.viewportSizeHistory as { width: number[] }
  assert.deepEqual([...saved.width].sort(), [1000, 1100])
  assert.equal(first.history('#windowWidth').length, 2)
  assert.equal(second.history('#windowWidth').length, 2)
})
test('unavailable polling silently disables inputs and recovers without rebuilding history', async () => {
  const p = await panel({ history: { width: [900] } })
  const entry = p.elements.get('#windowWidthHistoryMenu').children[0]
  p.unavailable()
  await p.poll()
  await p.poll()
  assert.equal(p.elements.get('#windowWidthHistoryMenu').children[0], entry)
  assert.equal(p.elements.get('#windowStatus').textContent, '')
  assert.equal(p.elements.get('#windowWidth').disabled, true)
  assert.equal(p.elements.get('#windowHeight').disabled, true)
  assert.equal(p.elements.get('#applyWindowSize').disabled, true)
  p.unavailable(false)
  await p.poll()
  assert.equal(p.elements.get('#windowStatus').textContent, '')
  assert.equal(p.elements.get('#windowWidth').disabled, false)
  assert.equal(p.elements.get('#windowHeight').disabled, false)
  assert.equal(p.elements.get('#windowWidthHistoryMenu').children[0], entry)
})
test('content script returns inner dimensions, not the browser outer dimensions', () => {
  let listener!: (
    message: ContentRequest,
    sender: object,
    reply: (value: unknown) => void,
  ) => boolean
  runModule('../src/page-content-script-viewport.js', {
    window: {
      innerWidth: 800,
      innerHeight: 600,
      outerWidth: 1200,
      outerHeight: 900,
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener: (fn: typeof listener) => {
            listener = fn
          },
        },
      },
    },
  })
  let reply: unknown
  listener({ type: 'dev-sideboard:get-viewport' }, {}, (value) => {
    reply = value
  })
  assert.deepEqual(structuredClone(reply), { width: 800, height: 600 })
  reply = undefined
  listener({ type: 'dev-sideboard:get-storage' }, {}, (value) => {
    reply = value
  })
  assert.equal(reply, undefined)
})
