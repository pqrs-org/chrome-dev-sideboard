const test = require('node:test')
const assert = require('node:assert/strict')
const { runModule } = require('./helpers/run-module.js')
const tick = () => new Promise(setImmediate)

const setup = (area = 'local') => {
  let documentId = 'doc-1'
  const elements = new Proxy(
    {},
    {
      get: (target, key) =>
        (target[key] ||= {
          addEventListener(name, fn) {
            this[name] = fn
          },
          close() {},
          showModal() {},
          focus() {},
        }),
    },
  )
  const state = {
    editState: { current: null },
    snapshotState: { requestId: 0, pendingUntil: 0 },
    panelElements: elements,
    panelState: { tabId: 1, storage: { documentId: 'doc-1', local: [] } },
  }
  const sent = []
  const writes = []
  const cookies = {
    read: async () => ({ documentId, cookies: [] }),
    write: async (...args) => writes.push(args),
  }
  const tabs = {
    sendMessage: async (...args) => {
      sent.push(args)
      return { ok: true, snapshot: { local: [] } }
    },
  }
  const { SidepanelEditor } = runModule(
    require.resolve('../.test-build/src/sidepanel-editor.js'),
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
          normalizeStorageSnapshot: (snapshot) => snapshot,
          getSelectedStorageEntry: () => ({
            area,
            key: 'key',
            value: 'old',
            expectedCookie: 'fingerprint',
          }),
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
    setDocument: (id) => {
      documentId = id
    },
  }
}

test('editor pins storage writes to the inspected document and rejects navigation before saving', async () => {
  const s = setup()
  s.elements.editStorageButton.click()
  s.elements.storageValueInput.value = 'new'
  s.elements.saveStorageEdit.click()
  await tick()
  assert.equal(s.state.snapshotState.requestId, 1)
  assert.equal(s.state.panelState.storage.local.length, 0)
  assert.equal(s.sent[0][0], 1)
  assert.equal(s.sent[0][2].documentId, 'doc-1')
  assert.equal(s.sent[0][1].type, 'dev-sideboard:set-storage')
  assert.equal(s.sent[0][1].expectedValue, 'old')
  assert.equal(s.sent[0][1].value, 'new')
  s.elements.editStorageButton.click()
  s.setDocument('doc-2')
  s.elements.saveStorageEdit.click()
  await tick()
  assert.match(s.elements.storageEditStatus.textContent, /page changed/)
  assert.equal(s.sent.length, 1)
})

test('editor ignores a storage save snapshot that finishes after navigation', async () => {
  const s = setup()
  let finish
  s.tabs.sendMessage = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  s.elements.editStorageButton.click()
  s.elements.storageValueInput.value = 'new'
  s.elements.saveStorageEdit.click()
  await tick()
  s.setDocument('doc-2')
  finish({ ok: true, snapshot: { local: [{ key: 'stale', value: 'old' }] } })
  await tick()
  assert.match(s.elements.storageEditStatus.textContent, /page changed/)
  assert.equal(s.state.panelState.storage.local.length, 0)
})

test('editor deletes cookies directly with the original fingerprint and displays stale-value errors', async () => {
  const s = setup('cookie')
  s.elements.deleteStorageButton.click()
  await tick()
  assert.equal(s.writes[0][0], 1)
  assert.equal(s.writes[0][1].documentId, 'doc-1')
  assert.equal(s.writes[0][1].expectedCookie, 'fingerprint')
  assert.equal(s.writes[0][2], true)
  assert.equal(s.state.panelState.storage.documentId, 'doc-1')
  s.cookies.write = async () => {
    throw new Error('Cookie changed')
  }
  s.elements.deleteStorageButton.click()
  await tick()
  assert.equal(s.elements.detailMeta.textContent, 'Cookie changed')
})
