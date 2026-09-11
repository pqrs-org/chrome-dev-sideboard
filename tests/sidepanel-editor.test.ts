import { TestElement, type SendArgs } from './helpers/mocks.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'
const tick = () => new Promise(setImmediate)

const setup = (area: StorageArea = 'local') => {
  let documentId = 'doc-1'
  const elements = new Proxy<Record<string, TestElement>>(
    {},
    {
      get: (target, key: string) => (target[key] ||= new TestElement()),
    },
  )
  const state = {
    editState: { current: null as StorageEdit | null },
    snapshotState: { requestId: 0, pendingUntil: 0 },
    panelElements: elements,
    panelState: { tabId: 1, storage: { documentId: 'doc-1', local: [] } },
  }
  const sent: SendArgs[] = []
  const writes: Parameters<
    typeof import('../src/cookie-store.js').ExtensionCookies.write
  >[] = []
  const cookies = {
    write: async (...args: (typeof writes)[number]) => {
      writes.push(args)
      return null
    },
  }
  const tabs = {
    sendMessage: async (...args: SendArgs): Promise<StorageResult> => {
      sent.push(args)
      return { ok: true }
    },
  }
  const { SidepanelEditor } = runModule(
    '../src/sidepanel-editor.js',
    {
      chrome: {
        tabs,
        webNavigation: { getFrame: async () => ({ documentId }) },
      },
    },
    {
      './cookie-store.js': { ExtensionCookies: cookies },
      './sidepanel-state.js': { SidepanelState: state },
      './sidepanel-storage.js': {
        SidepanelStorage: {
          getSelectedStorageEntry: (): DisplayStorageEntry => {
            const entry = {
              id: 'key',
              key: 'key',
              value: 'old',
              searchText: 'key old',
            }
            return area === 'cookie'
              ? {
                  ...entry,
                  area,
                  expectedCookie: 'fingerprint',
                  name: 'key',
                  domain: 'example.com',
                  path: '/',
                  storeId: '0',
                  hostOnly: true,
                  secure: true,
                  httpOnly: false,
                  sameSite: 'lax',
                  session: true,
                }
              : { ...entry, area }
          },
          renderModeChrome() {},
        },
      },
    },
  )
  SidepanelEditor.initializeStorageEditor()
  return {
    elements,
    state,
    sent,
    writes,
    cookies,
    tabs,
    setDocument: (id: string) => {
      documentId = id
    },
  }
}

test('editor pins storage writes to the inspected document and rejects navigation before saving', async () => {
  const s = setup()
  s.elements.editStorageButton.listeners.click()
  s.elements.storageValueInput.value = 'new'
  s.elements.saveStorageEdit.listeners.click()
  await tick()
  assert.equal(s.state.snapshotState.requestId, 1)
  assert.equal(s.state.panelState.storage.local.length, 0)
  assert.equal(s.sent[0][0], 1)
  assert.equal(s.sent[0][2].documentId, 'doc-1')
  assert.equal(s.sent[0][1].type, 'dev-sideboard:set-storage')
  assert.equal(
    'expectedValue' in s.sent[0][1] ? s.sent[0][1].expectedValue : undefined,
    'old',
  )
  assert.equal('value' in s.sent[0][1] ? s.sent[0][1].value : undefined, 'new')
  s.elements.editStorageButton.listeners.click()
  s.setDocument('doc-2')
  s.elements.saveStorageEdit.listeners.click()
  await tick()
  assert.match(s.elements.storageEditStatus.textContent, /page changed/)
  assert.equal(s.sent.length, 1)
})

test('editor rejects a save result that finishes after navigation', async () => {
  const s = setup()
  let finish!: (value: StorageResult) => void
  s.tabs.sendMessage = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  s.elements.editStorageButton.listeners.click()
  s.elements.storageValueInput.value = 'new'
  s.elements.saveStorageEdit.listeners.click()
  await tick()
  s.setDocument('doc-2')
  finish({ ok: true })
  await tick()
  assert.match(s.elements.storageEditStatus.textContent, /page changed/)
  assert.equal(s.state.panelState.storage.local.length, 0)
})

test('editor deletes cookies directly with the original fingerprint and displays stale-value errors', async () => {
  const s = setup('cookie')
  s.elements.deleteStorageButton.listeners.click()
  await tick()
  assert.equal(s.writes[0][0], 1)
  assert.equal(s.writes[0][1].documentId, 'doc-1')
  assert.equal(s.writes[0][1].expectedCookie, 'fingerprint')
  assert.equal(s.writes[0][2], true)
  assert.equal(s.state.panelState.storage.documentId, 'doc-1')
  s.cookies.write = async () => {
    throw new Error('Cookie changed')
  }
  s.elements.deleteStorageButton.listeners.click()
  await tick()
  assert.equal(s.elements.detailMeta.textContent, 'Cookie changed')
})
