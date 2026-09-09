'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
function setup() {
  let documentId = 'doc'
  let cookies = [
    {
      name: 'session',
      value: 'old',
      domain: 'example.com',
      path: '/',
      storeId: 'private',
      hostOnly: true,
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      session: true,
    },
  ]
  const writes = []
  const queries = []
  const context = {
    URL,
    module: { exports: {} },
    chrome: {
      webNavigation: {
        getFrame: async () => ({ documentId, url: 'https://example.com/path' }),
      },
      cookies: {
        getAllCookieStores: async () => [
          { id: 'normal', tabIds: [2] },
          { id: 'private', tabIds: [1] },
        ],
        getAll: async (query) => {
          queries.push(query)
          return cookies.filter(
            (c) => Boolean(c.partitionKey) === Boolean(query.partitionKey),
          )
        },
        getPartitionKey: async () => ({
          partitionKey: {
            topLevelSite: 'https://example.com',
            hasCrossSiteAncestor: false,
          },
        }),
        set: async (details) => {
          writes.push(details)
          return details
        },
      },
    },
  }
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/cookie-store.js'), 'utf8'),
    context,
  )
  const api = context.module.exports
  return {
    api,
    queries,
    writes,
    get cookies() {
      return cookies
    },
    setDocument: (value) => {
      documentId = value
    },
    setCookies: (value) => {
      cookies = value
    },
    edit: (cookie = cookies[0]) => ({
      documentId: 'doc',
      key: api.identity(cookie),
      expectedCookie: api.fingerprint(cookie),
      expectedValue: cookie.value,
      value: 'new',
    }),
  }
}
test('cookie edits retain host-only, session, HttpOnly and SameSite attributes in the correct store', async () => {
  const t = setup()
  await t.api.write(1, t.edit())
  const saved = t.writes[0]
  assert.equal(saved.storeId, 'private')
  assert.equal(saved.value, 'new')
  assert.equal(saved.httpOnly, true)
  assert.equal(saved.secure, true)
  assert.equal(saved.sameSite, 'lax')
  assert.equal(Object.hasOwn(saved, 'domain'), false)
  assert.equal(Object.hasOwn(saved, 'expirationDate'), false)
  assert.equal(t.queries[0].url, 'https://example.com/path')
})
test('same-name cookies are distinguished by path and partition and keep expiry', async () => {
  const t = setup()
  const partitioned = {
    ...t.cookies[0],
    domain: '.example.com',
    hostOnly: false,
    path: '/path',
    session: false,
    expirationDate: 2000000000,
    partitionKey: {
      topLevelSite: 'https://example.com',
      hasCrossSiteAncestor: false,
    },
  }
  t.setCookies([...t.cookies, partitioned])
  const snapshot = await t.api.read(1)
  assert.equal(snapshot.cookies.length, 2)
  await t.api.write(1, t.edit(partitioned))
  assert.equal(t.writes[0].domain, '.example.com')
  assert.equal(t.writes[0].path, '/path')
  assert.equal(t.writes[0].expirationDate, 2000000000)
  assert.equal(t.writes[0].partitionKey.topLevelSite, 'https://example.com')
})
test('cookie edits reject changed, expired and navigated state', async () => {
  const t = setup()
  const edit = t.edit()
  t.cookies[0].value = 'changed'
  await assert.rejects(t.api.write(1, edit), /changed or expired/)
  t.setCookies([])
  await assert.rejects(t.api.write(1, edit), /changed or expired/)
  t.setDocument('new-doc')
  await assert.rejects(t.api.write(1, edit), /page changed/)
  assert.equal(t.writes.length, 0)
})

test('cookie deletion expires only the selected domain/path/partition tuple', async () => {
  const t = setup()
  const target = {
    ...t.cookies[0],
    name: 'duplicate',
    domain: '.example.com',
    hostOnly: false,
    path: '/path',
    partitionKey: {
      topLevelSite: 'https://example.com',
      hasCrossSiteAncestor: false,
    },
  }
  t.setCookies([...t.cookies, target])
  const edit = t.edit(target)
  delete edit.value
  await t.api.write(1, edit, true)
  assert.equal(t.writes.length, 1)
  assert.equal(t.writes[0].name, 'duplicate')
  assert.equal(t.writes[0].domain, '.example.com')
  assert.equal(t.writes[0].path, '/path')
  assert.equal(t.writes[0].storeId, 'private')
  assert.equal(t.writes[0].partitionKey.topLevelSite, 'https://example.com')
  assert.equal(t.writes[0].expirationDate, 1)
  target.value = 'updated'
  await assert.rejects(t.api.write(1, edit, true), /changed or expired/)
  assert.equal(t.writes.length, 1)
})
