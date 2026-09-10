const test = require('node:test')
const assert = require('node:assert/strict')
const { runModule } = require('./helpers/run-module.js')

const setup = (mode) => {
  let keydown
  let renders = 0
  const state = {
    panelState: {
      mode,
      filter: '',
      selectedStorageId: 'a',
      storage: {
        local: [
          { id: 'a', searchText: 'match' },
          { id: 'b', searchText: 'other' },
        ],
        session: [{ id: 'c', searchText: 'match' }],
        cookies: [
          { id: 'a', searchText: 'match' },
          { id: 'b', searchText: 'other' },
          { id: 'c', searchText: 'match' },
        ],
      },
    },
    editState: { current: null },
    panelElements: {
      entryList: {
        addEventListener: (_, handler) => {
          keydown = handler
        },
        querySelector: () => ({ scrollIntoView() {} }),
      },
      filterInput: { addEventListener() {} },
    },
  }
  const { SidepanelStorage } = runModule(
    require.resolve('../.test-build/src/sidepanel-storage.js'),
    {},
    {
      './sidepanel-state.js': { SidepanelState: state },
      './sidepanel-json.js': { SidepanelJson: {} },
      './cookie-store.js': { ExtensionCookies: {} },
    },
  )
  SidepanelStorage.initializeStorageList(() => renders++)
  const press = (key, extra = {}) => {
    let prevented = false
    keydown({
      key,
      preventDefault: () => {
        prevented = true
      },
      ...extra,
    })
    return prevented
  }
  return { state, press, renders: () => renders }
}

for (const mode of ['storage', 'cookies']) {
  test(`${mode} arrow navigation follows visible entries, stops at boundaries, and pauses during edits`, () => {
    const s = setup(mode)
    assert.equal(s.press('ArrowDown'), true)
    assert.equal(s.state.panelState.selectedStorageId, 'b')
    s.press('ArrowDown')
    assert.equal(s.state.panelState.selectedStorageId, 'c')
    const count = s.renders()
    s.press('ArrowDown')
    assert.equal(s.renders(), count)
    s.state.panelState.filter = 'match'
    s.press('ArrowUp')
    assert.equal(s.state.panelState.selectedStorageId, 'a')
    s.press('ArrowUp')
    assert.equal(s.state.panelState.selectedStorageId, 'a')
    s.state.panelState.selectedStorageId = 'b'
    s.press('ArrowDown')
    assert.equal(s.state.panelState.selectedStorageId, 'a')
    assert.equal(s.press('ArrowDown', { ctrlKey: true }), false)
    assert.equal(s.press('ArrowLeft'), false)
    s.state.editState.current = {}
    assert.equal(s.press('ArrowDown'), false)
    assert.equal(s.state.panelState.selectedStorageId, 'a')
    s.state.editState.current = null
    s.state.panelState.filter = 'nothing'
    s.press('ArrowDown')
    assert.equal(s.state.panelState.selectedStorageId, 'a')
  })
}
