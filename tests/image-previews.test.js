'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
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
    module: { exports: {} },
    setTimeout(fn) {
      timers.add(fn)
      return fn
    },
    clearTimeout(fn) {
      timers.delete(fn)
    },
  }
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/image-previews.js'), 'utf8'),
    context,
  )
  return {
    batch: context.module.exports.createBatch(),
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
test('images reject HTTP, URL credentials, SVG and oversized streamed bodies', async () => {
  let fetches = 0
  const s = setup(async () => {
    fetches++
    return response()
  })
  for (const url of [
    'http://example.com/a',
    'https://user:pass@example.com/a',
    'file:///a',
  ])
    s.batch.load(
      url,
      () => assert.fail('unexpected image'),
      () => {},
    )
  await tick()
  assert.equal(fetches, 0)
  for (const result of [
    response('<svg/>', { 'content-type': 'image/svg+xml' }),
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
  for (let i = 0; i < 8; i++)
    s.batch.load(
      `https://example.com/${i}`,
      () => assert.fail('unexpected image'),
      (e) => errors.push(e),
    )
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
  for (const fn of t.timers) fn()
  await tick()
  assert.equal(errors.at(-1), 'Image request timed out')
  assert.equal(t.timers.size, 0)
})
