import { required, type MessageListener } from './helpers/mocks.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'

type TestRoot = {
  querySelector?: (selector: string) => unknown
  querySelectorAll: (selector: string) => unknown[]
}

const metadataRoot = ({
  canonical,
  title,
  image,
  base,
}: {
  canonical?: () => string
  title?: string
  image?: string
  base?: string
}): TestRoot => ({
  querySelector: (selector) =>
    selector === 'base[href]' && base ? { getAttribute: () => base } : null,
  querySelectorAll: (selector) => {
    if (selector === 'link[rel]') {
      return canonical ? [{ rel: 'canonical', getAttribute: canonical }] : []
    }
    return [
      ...(title === undefined
        ? []
        : [
            {
              getAttribute: (key: string) =>
                ({ property: 'og:title', content: title })[key] ?? null,
            },
          ]),
      ...(image === undefined
        ? []
        : [
            {
              getAttribute: (key: string) =>
                ({ property: 'og:image', content: image })[key] ?? null,
            },
          ]),
    ]
  },
})

const htmlResponse = (url: string, html: string, contentLength?: string) => {
  let read = false
  return {
    ok: true,
    url,
    headers: {
      get: (name: string) =>
        name === 'content-length' ? (contentLength ?? null) : null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (read) {
            return { done: true }
          }
          read = true
          return { done: false, value: new TextEncoder().encode(html) }
        },
        cancel: async () => {},
        releaseLock() {},
      }),
    },
  }
}

const setupMetadata = ({
  initialUrl,
  root,
  parse,
  fetch,
  timers,
}: {
  initialUrl: string
  root: TestRoot
  parse?: (html: string) => TestRoot
  fetch?: (url: string, options: RequestInit) => Promise<unknown>
  timers?: {
    setTimeout: (callback: () => void) => unknown
    clearTimeout: () => void
  }
}) => {
  let listener!: MessageListener<MetadataSnapshot>
  const location = { href: initialUrl }
  runModule('../src/page-content-script-metadata.js', {
    URL,
    AbortController,
    TextDecoder,
    setTimeout: timers?.setTimeout ?? setTimeout,
    clearTimeout: timers?.clearTimeout ?? clearTimeout,
    chrome: {
      runtime: {
        onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
      },
    },
    document: {
      ...root,
      baseURI: initialUrl,
      location,
      readyState: 'complete',
    },
    ...(parse
      ? {
          DOMParser: class {
            parseFromString(html: string) {
              return parse(html)
            }
          },
        }
      : {}),
    ...(fetch ? { fetch } : {}),
  })
  return {
    location,
    read: () =>
      new Promise<MetadataSnapshot>((resolve) =>
        listener({ type: 'dev-sideboard:get-metadata' }, {}, resolve),
      ),
  }
}

const firstOpenGraphValue = (snapshot: MetadataSnapshot) =>
  required(snapshot.openGraph)[0].value

test('page metadata preserves duplicates and keeps one snapshot per URL', async () => {
  const tags: Record<string, string>[] = [
    { property: 'og:image', content: 'one.png' },
    { property: 'og:image', content: 'two.png' },
    { name: 'description', content: '<b>literal</b>' },
    { name: 'twitter:card', content: 'summary' },
    { property: 'og:title', content: '' },
  ]
  const { read } = setupMetadata({
    initialUrl: 'https://example.com/resolved?view=full',
    root: {
      querySelectorAll: (selector) =>
        selector === 'link[rel]'
          ? [
              {
                rel: 'alternate CANONICAL',
                getAttribute: () => '/resolved',
              },
            ]
          : tags.map((tag) => ({
              getAttribute: (key: string) => tag[key] ?? null,
            })),
    },
  })
  const snapshot = await read()
  assert.equal(
    required(snapshot.canonical)[0].value,
    'https://example.com/resolved',
  )
  assert.deepEqual(
    Array.from(required(snapshot.openGraph), (entry) => entry.value),
    ['one.png', 'two.png', ''],
  )
  assert.equal(
    'description' in snapshot ? snapshot.description : undefined,
    undefined,
  )
  assert.equal(required(snapshot.twitter)[0].value, 'summary')
  tags[0].content = 'changed.png'
  assert.equal(firstOpenGraphValue(await read()), 'one.png')
})

test('stale SPA metadata falls back to the current page response', async () => {
  let fetches = 0
  let canonical = '/watch?v=old'
  const { read } = setupMetadata({
    initialUrl: 'https://www.youtube.com/watch?v=new&list=playlist',
    root: metadataRoot({
      canonical: () => canonical,
      title: 'Old title',
      image: 'old.jpg',
    }),
    parse: () =>
      metadataRoot({
        canonical: () => '/watch?v=new',
        title: 'New title',
        image: 'new.jpg',
        base: 'http://[',
      }),
    fetch: async (url, options) => {
      fetches++
      assert.ok(options.signal)
      return htmlResponse(url, '<html></html>')
    },
  })
  const snapshot = await read()
  assert.equal(fetches, 1)
  assert.deepEqual(
    Array.from(required(snapshot.openGraph), ({ key, value }) => ({
      key,
      value,
    })),
    [
      { key: 'og:title', value: 'New title' },
      { key: 'og:image', value: 'new.jpg' },
    ],
  )
  assert.equal(
    snapshot.baseUrl,
    'https://www.youtube.com/watch?v=new&list=playlist',
  )
  canonical = '/watch?v=new'
  assert.equal(firstOpenGraphValue(await read()), 'New title')
  assert.equal(fetches, 1)
})

test('page snapshots use a 20-entry LRU cache', async () => {
  let fetches = 0
  const { location, read } = setupMetadata({
    initialUrl: 'https://example.com/page/0',
    root: metadataRoot({ title: 'DOM' }),
    parse: (html) => metadataRoot({ title: html }),
    fetch: async (url) => {
      fetches++
      return htmlResponse(url, new URL(url).pathname.split('/').at(-1) || '')
    },
  })
  for (let i = 1; i <= 21; i++) {
    location.href = `https://example.com/page/${i}`
    await read()
  }
  assert.equal(fetches, 21)
  location.href = 'https://example.com/page/2'
  assert.equal(firstOpenGraphValue(await read()), '2')
  assert.equal(fetches, 21, 'a recent URL remains cached')
  location.href = 'https://example.com/page/1'
  assert.equal(firstOpenGraphValue(await read()), '1')
  assert.equal(fetches, 22, 'the oldest URL is evicted')
})

test('concurrent reads for one URL share the in-flight request', async () => {
  let finishFetch!: () => void
  let fetches = 0
  let canonical = '/old'
  const { location, read } = setupMetadata({
    initialUrl: 'https://example.com/old',
    root: metadataRoot({ canonical: () => canonical, title: 'DOM' }),
    parse: () => metadataRoot({ title: 'Fetched' }),
    fetch: async (url) => {
      fetches++
      await new Promise<void>((resolve) => {
        finishFetch = resolve
      })
      return htmlResponse(url, '<html></html>')
    },
  })
  location.href = 'https://example.com/new'
  const first = read()
  canonical = '/new'
  const second = read()
  assert.equal(fetches, 1)
  finishFetch()
  assert.equal(firstOpenGraphValue(await first), 'Fetched')
  assert.equal(firstOpenGraphValue(await second), 'Fetched')
  assert.equal(fetches, 1)
})

test('returning to an URL restarts its aborted request', async () => {
  const deferred: {
    reject: (error: Error) => void
    signal: AbortSignal
  }[] = []
  const requested: string[] = []
  const { location, read } = setupMetadata({
    initialUrl: 'https://example.com/initial',
    root: metadataRoot({ title: 'DOM fallback' }),
    parse: () => metadataRoot({ title: 'Fetched again' }),
    fetch: (url, options) => {
      requested.push(url)
      if (requested.filter((value) => value === url).length > 1) {
        return Promise.resolve(htmlResponse(url, '<html></html>'))
      }
      return new Promise((_resolve, reject) =>
        deferred.push({ reject, signal: required(options.signal) }),
      )
    },
  })
  location.href = 'https://example.com/a'
  const oldA = read()
  location.href = 'https://example.com/b'
  const oldB = read()
  location.href = 'https://example.com/a'
  const newA = read()
  assert.deepEqual(requested, [
    'https://example.com/a',
    'https://example.com/b',
    'https://example.com/a',
  ])
  assert.equal(deferred[0].signal.aborted, true)
  assert.equal(deferred[1].signal.aborted, true)
  for (const request of deferred) {
    request.reject(new Error('abort'))
  }
  assert.equal(firstOpenGraphValue(await oldA), 'DOM fallback')
  assert.equal(firstOpenGraphValue(await oldB), 'DOM fallback')
  assert.equal(firstOpenGraphValue(await newA), 'Fetched again')
})

for (const failure of ['timeout', 'oversized response'] as const) {
  test(`${failure} returns DOM metadata without caching the failure`, async () => {
    let fetches = 0
    const immediateTimeout = failure === 'timeout'
    const { location, read } = setupMetadata({
      initialUrl: 'https://example.com/old',
      root: metadataRoot({ title: 'DOM fallback' }),
      timers: immediateTimeout
        ? {
            setTimeout: (callback) => callback(),
            clearTimeout: () => {},
          }
        : undefined,
      fetch: async (url, options) => {
        fetches++
        if (options.signal?.aborted) {
          throw new Error('aborted')
        }
        return htmlResponse(url, '', String(5 * 1024 * 1024 + 1))
      },
    })
    location.href = 'https://example.com/new'
    assert.equal(firstOpenGraphValue(await read()), 'DOM fallback')
    assert.equal(firstOpenGraphValue(await read()), 'DOM fallback')
    assert.equal(fetches, 2)
  })
}
