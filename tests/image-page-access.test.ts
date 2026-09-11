import { required, type TestFetch, type FetchOptions } from './helpers/mocks.js'
type ConnectOptions = { name: string; documentId: string }
type Port = {
  onMessage: ReturnType<typeof event<[unknown]>>
  onDisconnect: ReturnType<typeof event<[]>>
  name?: string
  sender?: Pick<chrome.runtime.MessageSender, 'id' | 'url'>
  disconnect: () => void
  postMessage: (message: unknown) => void
}
import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'
const tick = () => new Promise(setImmediate)
const event = <Args extends unknown[]>() => {
  const handlers = new Set<(...args: Args) => void>()
  return {
    addListener: (fn: (...args: Args) => void) => handlers.add(fn),
    removeListener: (fn: (...args: Args) => void) => handlers.delete(fn),
    fire: (...args: Args) => [...handlers].forEach((fn) => fn(...args)),
  }
}
const setup = (fetch: TestFetch) => {
  let accept!: (port: Partial<Port>) => void
  const connections: {
    tabId: number
    options: ConnectOptions
    disconnect: () => void
  }[] = []
  const origin = 'https://internal.example'
  runModule('../src/page-content-script-image.js', {
    fetch,
    Blob,
    AbortController,
    btoa,
    setTimeout,
    clearTimeout,
    location: { origin },
    chrome: {
      runtime: {
        id: 'extension',
        getURL: (path: string) => `chrome-extension://extension/${path}`,
        onConnect: {
          addListener: (fn: typeof accept) => {
            accept = fn
          },
        },
      },
    },
  })
  const { readPageImage } = runModule('../src/sidepanel-image-access.js', {
    Blob,
    atob,
    chrome: {
      runtime: {},
      tabs: {
        connect: (tabId: number, options: ConnectOptions) => {
          const panel: Port = {
            onMessage: event<[unknown]>(),
            onDisconnect: event<[]>(),
            disconnect() {},
            postMessage() {},
          }
          const content: Port = {
            disconnect() {},
            postMessage() {},
            onMessage: event<[unknown]>(),
            onDisconnect: event<[]>(),
            name: options.name,
            sender: {
              id: 'extension',
              url: 'chrome-extension://extension/src/sidepanel.html',
            },
          }
          let closed = false
          const disconnect = () => {
            if (closed) {
              return
            }
            closed = true
            panel.onDisconnect.fire()
            content.onDisconnect.fire()
          }
          for (const [from, to] of [
            [panel, content],
            [content, panel],
          ]) {
            from.disconnect = disconnect
            from.postMessage = (message) => {
              const serialized = JSON.parse(JSON.stringify(message))
              queueMicrotask(() => {
                if (!closed) {
                  to.onMessage.fire(serialized)
                }
              })
            }
          }
          connections.push({ tabId, options, disconnect })
          queueMicrotask(() => accept(content))
          return panel
        },
      },
    },
  })
  return {
    read: (
      url: string,
      signal = new AbortController().signal,
      cache?: RequestCache,
    ) =>
      readPageImage(
        { tabId: 7, documentId: 'doc-1', origin },
        url,
        cache,
        signal,
      ),
    connections,
    accept,
  }
}

test('image bytes use document-pinned extension ports without credentials', async () => {
  let options!: FetchOptions
  const s = setup(async (_url, init) => {
    options = init
    return new Response(new Uint8Array([0, 128, 255]), {
      headers: { 'content-type': 'image/png' },
    })
  })
  const blob = await s.read(
    'https://internal.example/image',
    undefined,
    'no-cache',
  )
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0, 128, 255])
  assert.equal(blob.type, 'image/png')
  assert.equal(options.mode, 'same-origin')
  assert.equal(options.redirect, 'error')
  assert.equal(options.credentials, 'omit')
  assert.equal(options.cache, 'no-cache')
  assert.equal(options.targetAddressSpace, undefined)
  assert.equal(s.connections[0].tabId, 7)
  assert.equal(s.connections[0].options.documentId, 'doc-1')
})

test('page image requests reject credentials, HTTP, and oversized images', async () => {
  let calls = 0
  const s = setup(async () => {
    calls++
    return new Response('large', {
      headers: { 'content-length': String(6 * 1024 * 1024) },
    })
  })
  for (const url of [
    'http://internal.example/image',
    'https://user:secret@internal.example/image',
  ]) {
    await assert.rejects(s.read(url), /same origin|HTTPS image URL/)
  }
  assert.equal(calls, 0)
  await assert.rejects(s.read('https://internal.example/image'), /too large/)
  assert.equal(calls, 1)
})

test('discarding a preview or disconnecting its document aborts the page fetch', async () => {
  let fetchSignal!: AbortSignal
  const s = setup(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        fetchSignal = options.signal
        options.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        )
      }),
  )
  const controller = new AbortController()
  const read = s.read('https://internal.example/image', controller.signal)
  await tick()
  controller.abort()
  await assert.rejects(read, /cancelled/)
  assert.equal(fetchSignal.aborted, true)
  const next = s.read('https://internal.example/image')
  await tick()
  required(s.connections.at(-1)).disconnect()
  await assert.rejects(next, /disconnected/)
  assert.equal(fetchSignal.aborted, true)
})

test('image content ports only accept the extension side panel', () => {
  const s = setup(() => assert.fail('unexpected fetch'))
  for (const sender of [
    undefined,
    { id: 'other', url: 'chrome-extension://extension/src/sidepanel.html' },
    { id: 'extension', url: 'https://internal.example/' },
  ]) {
    let disconnected = false
    s.accept({
      name: 'dev-sideboard:image',
      sender,
      disconnect: () => {
        disconnected = true
      },
    })
    assert.equal(disconnected, true)
  }
})

test('content image endpoint rejects other origins without making a request', async () => {
  const s = setup(() => assert.fail('unexpected fetch'))
  for (const url of [
    'https://other.example/image',
    'https://internal.example:444/image',
  ]) {
    await assert.rejects(s.read(url), /same origin/)
  }
})
