import { required, type MessageListener } from './helpers/mocks.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runModule } from './helpers/run-module.js'
test('storage edits update only the selected key and reject invalid JSON or stale values', () => {
  const local = new Map([
    ['settings', '{"enabled":false}'],
    ['other', 'keep'],
  ])
  const session = new Map([['settings', '{"count":1}']])
  const storage = (values: Map<string, string>) => ({
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index],
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  let listener!: MessageListener<StorageResult>
  runModule('../src/page-content-script-storage.js', {
    window: {
      addEventListener() {
        throw new Error('Storage must not listen to page messages')
      },
      localStorage: storage(local),
      sessionStorage: storage(session),
    },
    location: { href: 'https://example.com/', origin: 'https://example.com' },
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
  const send = (message: ContentRequest) => {
    let result: StorageResult | undefined
    listener(message, {}, (value) => {
      result = value
    })
    return required(result)
  }
  const edit: ContentRequest = {
    type: 'dev-sideboard:set-storage',
    area: 'local',
    key: 'settings',
    expectedValue: '{"enabled":false}',
    value: '{"enabled":true}',
  }
  assert.equal(send({ ...edit, value: '{' }).ok, false)
  assert.equal(local.get('settings'), edit.expectedValue)
  assert.equal(send(edit).ok, true)
  assert.equal(local.get('settings'), edit.value)
  assert.equal(local.get('other'), 'keep')
  assert.equal(session.get('settings'), '{"count":1}')
  assert.equal(send(edit).ok, false)
  assert.equal(
    send({
      ...edit,
      area: 'session',
      expectedValue: '{"count":1}',
      value: '{"count":2}',
    }).ok,
    true,
  )
  assert.equal(session.get('settings'), '{"count":2}')
  const textEdit: ContentRequest = {
    type: 'dev-sideboard:set-storage',
    area: 'local',
    key: 'other',
    expectedValue: 'keep',
    value: '  plain text\nnext line  ',
  }
  assert.equal(send(textEdit).ok, true)
  assert.equal(local.get('other'), textEdit.value)
  assert.equal(
    send({ ...textEdit, expectedValue: textEdit.value, value: '' }).ok,
    true,
  )
  assert.equal(local.get('other'), '')
  local.set('other', 'keep')
  const deletion: ContentRequest = {
    type: 'dev-sideboard:delete-storage',
    area: 'local',
    key: 'other',
    expectedValue: 'keep',
  }
  assert.equal(send({ ...deletion, expectedValue: 'stale' }).ok, false)
  assert.equal(local.get('other'), 'keep')
  assert.equal(send(deletion).ok, true)
  assert.equal(local.has('other'), false)
  assert.equal(local.get('settings'), edit.value)
  assert.equal(
    send({
      ...deletion,
      area: 'session',
      key: 'settings',
      expectedValue: '{"count":2}',
    }).ok,
    true,
  )
  assert.equal(session.has('settings'), false)

  local.delete('settings')
  assert.equal(send(edit).ok, false)
  assert.equal(local.has('settings'), false)
})
