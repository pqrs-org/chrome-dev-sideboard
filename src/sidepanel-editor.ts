import { SidepanelState } from './sidepanel-state.js'
import { SidepanelStorage } from './sidepanel-storage.js'

const { editState, panelElements, panelState } = SidepanelState

let actions: {
  render: () => void
  postRequest: (message: PanelRequest) => void
}

let saveSequence = 0

const handleStorageSaved = (
  message: Extract<PanelMessage, { type: 'storageSaved' }>,
) => {
  if (
    !editState.current ||
    message.tabId !== editState.current.tabId ||
    message.requestId !== editState.current.requestId
  ) {
    return
  }
  panelElements.saveStorageEdit.disabled = false
  panelElements.cancelStorageEdit.disabled = false
  panelElements.storageValueInput.disabled = false
  if (!message.ok && editState.current.deleting) {
    editState.current = null
    actions.render()
    panelElements.detailMeta.textContent = message.error || 'Unable to delete.'
    return
  }
  if (!message.ok) {
    panelElements.storageEditStatus.textContent =
      message.error || 'Unable to save.'
    return
  }
  panelState.storage = SidepanelStorage.normalizeStorageSnapshot(
    message.snapshot,
  )
  editState.current = null
  panelElements.storageEditor.close()
  if (!SidepanelStorage.getSelectedStorageEntry()) {
    panelState.selectedStorageId =
      SidepanelStorage.getStorageEntries().at(0)?.id || null
  }
  actions.render()
  return
}

const initializeStorageEditor = (callbacks: typeof actions) => {
  actions = callbacks
  panelElements.deleteStorageButton.addEventListener('click', () => {
    const entry = SidepanelStorage.getSelectedStorageEntry()
    if (!entry || !panelState.storage.documentId || editState.current) {
      return
    }
    editState.current = {
      deleting: true,
      tabId: panelState.tabId,
      documentId: panelState.storage.documentId,
      area: entry.area,
      key: entry.key,
      expectedValue: entry.value,
      expectedCookie:
        entry.area === 'cookie' ? entry.expectedCookie : undefined,
      requestId: ++saveSequence,
    }
    SidepanelStorage.renderModeChrome()
    panelElements.detailMeta.textContent = 'Deleting…'
    actions.postRequest({
      type: 'deleteStorage',
      ...editState.current,
    })
  })

  panelElements.editStorageButton.addEventListener('click', () => {
    const entry = SidepanelStorage.getSelectedStorageEntry()
    if (!entry || !panelState.storage.documentId) {
      return
    }
    let parsed
    let json = false
    if (entry.area !== 'cookie') {
      try {
        parsed = JSON.parse(entry.value)
        json = true
      } catch {}
    }
    editState.current = {
      json,
      tabId: panelState.tabId,
      documentId: panelState.storage.documentId,
      area: entry.area,
      key: entry.key,
      expectedValue: entry.value,
      expectedCookie:
        entry.area === 'cookie' ? entry.expectedCookie : undefined,
    }
    panelElements.storageEditorTitle.textContent =
      entry.area === 'cookie'
        ? `Edit Cookie: ${entry.name}`
        : `Edit ${entry.area === 'local' ? 'Local' : 'Session'} Storage: ${entry.key}`
    panelElements.storageValueInput.value = json
      ? JSON.stringify(parsed, null, 2)
      : entry.value
    panelElements.storageEditStatus.textContent = ''
    panelElements.saveStorageEdit.disabled = false
    panelElements.cancelStorageEdit.disabled = false
    panelElements.storageValueInput.disabled = false
    panelElements.storageEditor.showModal()
    panelElements.storageValueInput.focus()
  })

  panelElements.cancelStorageEdit.addEventListener('click', () => {
    editState.current = null
    panelElements.storageEditor.close()
  })

  panelElements.storageEditor.addEventListener('cancel', (event) => {
    if (panelElements.saveStorageEdit.disabled) {
      event.preventDefault()
    } else {
      editState.current = null
    }
  })

  panelElements.saveStorageEdit.addEventListener('click', () => {
    if (!editState.current) {
      return
    }
    const value = panelElements.storageValueInput.value
    try {
      if (editState.current.json) {
        JSON.parse(value)
      }
    } catch (error) {
      panelElements.storageEditStatus.textContent = `Invalid JSON: ${error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)}`
      return
    }
    editState.current.requestId = ++saveSequence
    panelElements.saveStorageEdit.disabled = true
    panelElements.cancelStorageEdit.disabled = true
    panelElements.storageValueInput.disabled = true
    panelElements.storageEditStatus.textContent = 'Saving…'
    actions.postRequest({
      type: 'setStorage',
      ...editState.current,
      value,
    })
  })
}

export const SidepanelEditor = { handleStorageSaved, initializeStorageEditor }
