'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { runModule } = require('./helpers/run-module.js')
const tick = () => new Promise(setImmediate)
const setup = (fetch) => {
  const created = [],
    revoked = [],
    timers = new Set()
  class TestURL extends URL {
    static createObjectURL(blob) {
      created.push(blob)
      return `blob:${created.length}`
    }
    static revokeObjectURL(url) {
      revoked.push(url)
    }
  }
  const context = {
    URL: TestURL,
    Blob,
    AbortController,
    fetch,
    setTimeout(fn) {
      timers.add(fn)
      return fn
    },
    clearTimeout(fn) {
      timers.delete(fn)
    },
  }
  const { ImagePreviews } = runModule(
    require.resolve('../.test-build/src/image-previews.js'),
    context,
  )
  return {
    batch: ImagePreviews.createBatch(),
    created,
    revoked,
    timers,
  }
}
const response = (body = 'image', headers = {}) =>
  new Response(body, { headers: { 'content-type': 'image/png', ...headers } })
test('images omit credentials, allow redirects within request restrictions and only expose revocable Blob URLs', async () => {
  let options
  const s = setup(async (url, init) => {
    options = init
    return response()
  })
  const ready = [],
    failed = []
  s.batch.load(
    'https://example.com/image',
    (url) => ready.push(url),
    (e) => failed.push(e),
  )
  await tick()
  assert.equal(options.credentials, 'omit')
  assert.equal(options.targetAddressSpace, 'public')
  assert.equal(options.redirect, undefined)
  assert.equal(options.referrerPolicy, undefined)
  assert.equal(options.cache, undefined)
  assert.deepEqual(ready, ['blob:1'])
  assert.deepEqual(failed, [])
  assert.equal(s.created[0].type, 'image/png')
  s.batch.dispose()
  assert.deepEqual(s.revoked, ['blob:1'])
  assert.equal(s.timers.size, 0)
})
test('images reject HTTP, URL credentials and oversized streamed bodies', async () => {
  let fetches = 0
  const s = setup(async () => {
    fetches++
    return response()
  })
  for (const url of [
    'http://example.com/a',
    'https://user:pass@example.com/a',
    'file:///a',
  ]) {
    s.batch.load(
      url,
      () => assert.fail('unexpected image'),
      () => {},
    )
  }
  await tick()
  assert.equal(fetches, 0)
  for (const result of [
    response('a', { 'content-length': String(6 * 1024 * 1024) }),
    response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(3 * 1024 * 1024))
          c.enqueue(new Uint8Array(3 * 1024 * 1024))
          c.close()
        },
      }),
    ),
  ]) {
    const errors = []
    const limited = setup(async () => result)
    limited.batch.load(
      'https://example.com/a',
      () => assert.fail('unexpected image'),
      (e) => errors.push(e),
    )
    await tick()
    assert.equal(errors.length, 1)
    assert.equal(limited.created.length, 0)
  }
})
test('image concurrency, count, disposal and timeout are bounded', async () => {
  const pending = [],
    errors = []
  const s = setup(
    (url, options) =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, signal: options.signal })
        options.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        )
      }),
  )
  for (let i = 0; i < 8; i++) {
    s.batch.load(
      `https://example.com/${i}`,
      () => assert.fail('unexpected image'),
      (e) => errors.push(e),
    )
  }
  assert.equal(pending.length, 2)
  assert.equal(errors.length, 2)
  s.batch.dispose()
  await tick()
  assert.ok(pending.every((p) => p.signal.aborted))
  assert.equal(pending.length, 2)
  assert.equal(errors.length, 2)
  const t = setup(
    (url, options) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      ),
  )
  t.batch.load(
    'https://example.com/a',
    () => assert.fail('unexpected image'),
    (e) => errors.push(e),
  )
  for (const fn of t.timers) {
    fn()
  }
  await tick()
  assert.equal(errors.at(-1), 'Image request timed out')
  assert.equal(t.timers.size, 0)
})

test('preview loading preserves MIME types without filtering formats before image decoding', async () => {
  for (const type of [
    'image/bmp',
    'image/svg+xml; charset=utf-8',
    'application/octet-stream',
    'text/html',
    null,
  ]) {
    const payload = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    const s = setup(
      async () =>
        new Response(new Blob([payload]), {
          headers: type === null ? {} : { 'content-type': type },
        }),
    )
    const ready = await new Promise((resolve, reject) => {
      s.batch.load('https://example.com/image', resolve, reject)
    })
    assert.equal(ready, 'blob:1')
    assert.equal(s.created[0].type, (type || '').split(';')[0])
    assert.equal(await s.created[0].text(), payload)
    s.batch.dispose()
    assert.deepEqual(s.revoked, ['blob:1'])
  }
})

test('individual reloads revalidate only their image, release old blobs, and reuse the image slot', async () => {
  const requests = []
  const s = setup(async (url, init) => {
    requests.push({ url, ...init })
    return response('image')
  })
  const reload = s.batch.load(
    'https://example.com/first',
    () => {},
    assert.fail,
  )
  s.batch.load('https://example.com/second', () => {}, assert.fail)
  await tick()
  assert.ok(requests.every((request) => request.cache === undefined))
  for (let i = 0; i < 8; i++) {
    reload()
    await tick()
    assert.equal(requests.at(-1).url, 'https://example.com/first')
    assert.equal(requests.at(-1).cache, 'no-cache')
    assert.equal(requests.at(-1).credentials, 'omit')
    assert.equal(requests.at(-1).targetAddressSpace, 'public')
  }
  assert.equal(requests.length, 10)
  assert.equal(s.revoked.length, 8)
  assert.ok(!s.revoked.includes('blob:2'), 'the other image stays usable')
  s.batch.dispose()
  assert.equal(new Set(s.revoked).size, 10)
  reload()
  assert.equal(requests.length, 10)
})
