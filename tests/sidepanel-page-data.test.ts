import { required, type SendArgs, type MessageSender } from './helpers/mocks.js'
type Listener = (message: { type: string }, sender: MessageSender) => void
type CookieSnapshot = Awaited<
  ReturnType<typeof import('../src/cookie-store.js').ExtensionCookies.read>
>
import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'
const tick = () => new Promise(setImmediate)

const setup = () => {
  let documentId = 'doc-1'
  const listeners = new Set<Listener>()
  const runtime = {
    id: 'extension',
    onMessage: {
      addListener: (fn: Listener) => listeners.add(fn),
      removeListener: (fn: Listener) => listeners.delete(fn),
    },
  }
  const sent: SendArgs[] = []
  const tabs = {
    sendMessage: async (
      ...args: SendArgs
    ): Promise<MetadataSnapshot | StorageSnapshot> => {
      sent.push(args)
      return { local: [], session: [] }
    },
  }
  const cookies = {
    read: async (): Promise<CookieSnapshot> => ({
      documentId,
      url: 'https://example.com/',
      cookies: [],
    }),
  }
  const { SidepanelPageData: api } = runModule(
    '../src/sidepanel-page-data.js',
    {
      chrome: {
        runtime,
        tabs,
        webNavigation: {
          getFrame: async () => ({
            documentId,
            url: 'https://example.com/page',
          }),
        },
      },
    },
    { './cookie-store.js': { ExtensionCookies: cookies } },
  )
  return {
    api,
    sent,
    tabs,
    cookies,
    listeners,
    setDocument: (id: string) => {
      documentId = id
    },
  }
}

test('side panel rejects a snapshot that finishes after navigation', async () => {
  const s = setup()
  let finish!: (value: MetadataSnapshot | StorageSnapshot) => void
  s.tabs.sendMessage = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const read = s.api.readMetadata(1)
  await tick()
  s.setDocument('doc-2')
  finish({ openGraph: [{ key: 'og:description', value: 'old page' }] })
  const result = await read
  assert.match(required(result.error), /page changed/)
  assert.equal(result.openGraph, undefined)
})

test('metadata notifications require the extension, main frame and current document; commands are not accepted', async () => {
  const s = setup()
  const changed: number[] = []
  const stop = s.api.observeMetadataChanges((tabId) => changed.push(tabId))
  const listener = [...s.listeners][0]
  const sender = {
    id: 'extension',
    tab: { id: 1 },
    frameId: 0,
    documentId: 'doc-1',
  }
  for (const invalid of [
    { ...sender, id: 'other' },
    { ...sender, frameId: 1 },
    { ...sender, documentId: 'old' },
    { ...sender, tab: undefined },
  ]) {
    listener({ type: 'dev-sideboard:metadata-changed' }, invalid)
  }
  listener({ type: 'setStorage' }, sender)
  await tick()
  assert.deepEqual(changed, [])
  assert.equal(s.sent.length, 0)
  listener({ type: 'dev-sideboard:metadata-changed' }, sender)
  await tick()
  assert.deepEqual(changed, [1])
  stop()
  assert.equal(s.listeners.size, 0)
})

test('Storage reads do not access cookies', async () => {
  const s = setup()
  s.cookies.read = () => {
    throw new Error('Cookie API must not be used')
  }
  const snapshot = await s.api.readStorage(1)
  assert.equal(snapshot.documentId, 'doc-1')
  assert.equal(snapshot.error, undefined)
  assert.equal(s.sent[0][1].type, 'dev-sideboard:get-storage')
  assert.equal(s.sent[0][2].documentId, 'doc-1')
})

test('Cookies remain readable without a content script and reject navigation during reads', async () => {
  const s = setup()
  s.tabs.sendMessage = () => {
    throw new Error('No content script')
  }
  const cookies: chrome.cookies.Cookie[] = [
    {
      name: 'sid',
      value: 'value',
      domain: 'example.com',
      path: '/',
      storeId: '0',
      hostOnly: true,
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
      session: true,
    },
  ]
  s.cookies.read = async () => ({
    documentId: 'doc-1',
    url: 'https://example.com/path',
    cookies,
  })
  const snapshot = await s.api.readCookies(1)
  assert.equal(snapshot.documentId, 'doc-1')
  assert.equal(snapshot.origin, 'https://example.com')
  assert.deepEqual(snapshot.cookies, cookies)
  assert.equal(snapshot.error, undefined)
  let finish!: (value: CookieSnapshot) => void
  s.cookies.read = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const read = s.api.readCookies(1)
  s.setDocument('doc-2')
  finish({ documentId: 'doc-1', url: 'https://example.com/', cookies })
  const stale = await read
  assert.match(required(stale.error), /page changed/)
  assert.equal(stale.cookies, undefined)
})

test('metadata uses Chrome document identity and URL for image routing', async () => {
  const s = setup()
  s.tabs.sendMessage = async () => ({
    documentId: 'forged',
    pageUrl: 'https://attacker.example/',
    baseUrl: 'https://cdn.example/',
  })
  const metadata = await s.api.readMetadata(1)
  assert.equal(metadata.documentId, 'doc-1')
  assert.equal(metadata.pageUrl, 'https://example.com/page')
  assert.equal(metadata.baseUrl, 'https://cdn.example/')
})
