import { required } from './helpers/mocks.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { PageNetworkStats } from '../src/network-stats.js'
const { normalizeEvent, reduce, formatBytes } = PageNetworkStats

const tracker = () => {
  let state: NetworkState | null | undefined
  return {
    get state() {
      return required(state)
    },
    send(kind: NetworkKind, values: Partial<NetworkDetails> = {}) {
      state = reduce(
        state,
        normalizeEvent(kind, {
          tabId: 1,
          requestId: '1',
          type: 'main_frame',
          method: 'GET',
          url: 'https://example.com/',
          timeStamp: 1000,
          ...values,
        }),
      )
      return required(state)
    },
  }
}
const header = (name: string, value: string) => ({ name, value })

test('measures completed request chains and keeps HTTP and connection errors separate', () => {
  const t = tracker()
  t.send('start')
  t.send('headers', {
    statusCode: 200,
    responseHeaders: [header('Content-Length', '1024')],
  })
  t.send('complete', { statusCode: 200, timeStamp: 1200 })
  t.send('start', { requestId: '2', type: 'xmlhttprequest', timeStamp: 1300 })
  t.send('headers', { requestId: '2', statusCode: 404 })
  t.send('complete', { requestId: '2', statusCode: 404, timeStamp: 1400 })
  t.send('start', { requestId: '3', type: 'image' })
  t.send('error', { requestId: '3', timeStamp: 1500 })
  assert.equal(t.state.requests, 3)
  assert.equal(t.state.completed, 2)
  assert.equal(t.state.httpErrors, 1)
  assert.equal(t.state.networkErrors, 1)
  assert.equal(t.state.durationTotal / t.state.durationCount, 150)
  assert.equal(t.state.durationMax, 200)
  assert.equal(t.state.knownBytes, 1024)
  assert.equal(t.state.unknownSizes, 1)
  assert.deepEqual(t.state.pending, {})
})

test('redirects count once, retain chain timing, and exclude intermediate sizes', () => {
  const t = tracker()
  t.send('start')
  t.send('headers', {
    statusCode: 302,
    responseHeaders: [header('Content-Length', '999')],
  })
  t.send('redirect')
  t.send('start', { url: 'https://example.com/final', timeStamp: 1100 })
  t.send('headers', {
    statusCode: 200,
    responseHeaders: [header('Content-Length', '20')],
  })
  t.send('complete', { statusCode: 200, timeStamp: 1300 })
  assert.equal(t.state.requests, 1)
  assert.equal(t.state.durationTotal, 300)
  assert.equal(t.state.knownBytes, 20)
})

test('cache, missing lengths, and HEAD responses are not treated as transferred bytes', () => {
  const t = tracker()
  t.send('start')
  t.send('headers', {
    statusCode: 200,
    responseHeaders: [header('Content-Length', '500')],
  })
  t.send('complete', { statusCode: 200, fromCache: true })
  t.send('start', { requestId: '2', type: 'xmlhttprequest', method: 'HEAD' })
  t.send('headers', {
    requestId: '2',
    statusCode: 200,
    responseHeaders: [header('Content-Length', '1000')],
  })
  t.send('complete', { requestId: '2', statusCode: 200 })
  t.send('start', { requestId: '3', type: 'image' })
  t.send('headers', {
    requestId: '3',
    statusCode: 200,
    responseHeaders: [header('Content-Length', 'invalid')],
  })
  t.send('complete', { requestId: '3', statusCode: 200 })
  assert.equal(t.state.knownBytes, 0)
  assert.equal(t.state.knownSizes, 1)
  assert.equal(t.state.cached, 1)
  assert.equal(t.state.unknownSizes, 1)
})

test('new documents reset totals and old completions do not contaminate them', () => {
  const t = tracker()
  t.send('start')
  t.send('start', { requestId: 'old', type: 'image' })
  t.send('start', {
    requestId: 'new',
    url: 'https://example.com/next',
    timeStamp: 2000,
  })
  t.send('complete', { requestId: 'old', statusCode: 200, timeStamp: 2200 })
  assert.equal(t.state.requests, 1)
  assert.equal(t.state.completed, 0)
  t.send('commit', {
    url: 'https://example.com/next',
    documentId: 'new-doc',
    timeStamp: 2300,
  })
  assert.equal(t.state.requests, 1)
  t.send('commit', {
    url: 'https://example.com/',
    documentId: 'restored-doc',
    timeStamp: 3000,
  })
  assert.equal(t.state.requests, 0)
  assert.equal(t.state.scope, 'partial')
})

test('observation can begin mid-page and survives JSON session serialization', () => {
  const t = tracker()
  t.send('start', { type: 'xmlhttprequest' })
  assert.equal(t.state.scope, 'partial')
  const state: NetworkState = JSON.parse(JSON.stringify(t.state))
  reduce(
    state,
    normalizeEvent('complete', {
      tabId: 1,
      url: 'https://example.com/',
      requestId: '1',
      timeStamp: 1100,
      statusCode: 200,
    }),
  )
  assert.equal(state.completed, 1)
  assert.equal(state.durationTotal, 100)
})

test('normalized measurements omit credentials and raw header data', () => {
  const normalized = normalizeEvent('headers', {
    tabId: 1,
    timeStamp: 1000,
    type: 'main_frame',
    url: 'https://user:password@example.com/path#fragment',
    statusCode: 401,
    responseHeaders: [
      header('WWW-Authenticate', 'Basic realm="private realm"'),
      header('Set-Cookie', 'private-cookie'),
    ],
  })
  assert.equal(normalized.url, 'https://example.com/path')
  assert.equal(Object.hasOwn(normalized, 'auth'), false)
  assert.equal(JSON.stringify(normalized).includes('private'), false)
  assert.equal(formatBytes(1024), '1.0 KiB')
})

test('failure details retain sanitized final URLs and codes, cap history, and reset on navigation', () => {
  const t = tracker()
  t.send('start')
  t.send('complete', { statusCode: 200 })
  for (let i = 0; i < 102; i++) {
    const details = {
      requestId: String(i + 2),
      type: 'image',
      url: `https://user:secret@example.com/${i}#fragment`,
    }
    t.send('start', details)
    t.send(i % 2 ? 'error' : 'complete', {
      ...details,
      error: 'net::ERR_CONNECTION_REFUSED',
      statusCode: 404,
    })
  }
  assert.equal(t.state.networkErrors, 51)
  assert.equal(t.state.httpErrors, 51)
  assert.equal(t.state.failureDetails.length, 100)
  assert.equal(t.state.failureDetails[0].url, 'https://example.com/2')
  assert.equal(t.state.failureDetails[0].reason, 'HTTP 404')
  assert.equal(t.state.failureDetails[99].reason, 'net::ERR_CONNECTION_REFUSED')
  assert.equal(JSON.stringify(t.state).includes('secret'), false)
  t.send('start', { requestId: 'new-page' })
  assert.deepEqual([...t.state.failureDetails], [])
})

for (const error of [
  'net::ERR_CACHE_MISS',
  'net::ERR_ABORTED',
  'net::ERR_CONTEXT_SHUT_DOWN',
]) {
  test(`${error} finishes tracking without failure or success metrics, while retries and other errors are counted`, () => {
    const t = tracker()
    t.send('start', { type: 'font' })
    t.send('headers', { responseHeaders: [header('Content-Length', '999')] })
    t.send('error', {
      error,
      statusCode: 404,
      timeStamp: 1100,
    })
    assert.equal(t.state.requests, 1)
    assert.deepEqual(t.state.pending, {})
    assert.equal(t.state.networkErrors, 0)
    assert.equal(t.state.httpErrors, 0)
    assert.deepEqual([...t.state.failureDetails], [])
    assert.equal(t.state.completed, 0)
    assert.equal(t.state.cached, 0)
    assert.equal(t.state.durationCount, 0)
    assert.equal(t.state.knownBytes, 0)
    assert.equal(t.state.knownSizes, 0)
    assert.equal(t.state.unknownSizes, 0)

    t.send('complete', { statusCode: 200 })
    assert.equal(t.state.completed, 0)
    t.send('start', { type: 'font', requestId: 'retry', timeStamp: 1200 })
    t.send('complete', { requestId: 'retry', statusCode: 200, timeStamp: 1300 })
    assert.equal(t.state.requests, 2)
    assert.equal(t.state.completed, 1)
    assert.equal(t.state.durationTotal, 100)

    t.send('start', { type: 'font', requestId: 'failure' })
    t.send('error', {
      requestId: 'failure',
      error: 'net::ERR_CACHE_READ_FAILURE',
    })
    assert.equal(t.state.networkErrors, 1)
    assert.equal(t.state.failureDetails.length, 1)
    assert.equal(
      t.state.failureDetails[0].reason,
      'net::ERR_CACHE_READ_FAILURE',
    )
    assert.deepEqual(t.state.pending, {})
  })
}

test('connection aborts, blocking, and resource failures remain visible', () => {
  const t = tracker()
  const errors = [
    'net::ERR_CONNECTION_ABORTED',
    'net::ERR_BLOCKED_BY_CLIENT',
    'net::ERR_BLOCKED_BY_ADMINISTRATOR',
    'net::ERR_INSUFFICIENT_RESOURCES',
    'net::ERR_OUT_OF_MEMORY',
    'net::ERR_CACHE_WRITE_FAILURE',
  ]
  for (const error of errors) {
    t.send('start', { type: 'image', requestId: error })
    t.send('error', { requestId: error, error })
  }
  assert.equal(t.state.networkErrors, errors.length)
  assert.deepEqual(
    t.state.failureDetails.map((item) => item.reason),
    errors,
  )
  assert.deepEqual(t.state.pending, {})
})
