import { ExtensionCookies } from './cookie-store.js'
import { SidepanelState } from './sidepanel-state.js'
import { SidepanelStorage } from './sidepanel-storage.js'

const { editState, panelElements, panelState } = SidepanelState

// Supplied by sidepanel-tabs during initialization to avoid a circular import
// between the tab controller and this editor.
let editorCallbacks: {
  // Refresh the list and detail views after a save or delete result.
  render: () => void
}

// Assign a new requestId whenever a save or delete request is sent.
// Matching replies against the current edit prevents delayed replies from
// an earlier operation from closing or updating a newer edit.
let editRequestSequence = 0

const handleStorageSaved = (edit: StorageEdit, result: StorageResult) => {
  if (
    !editState.current ||
    edit.tabId !== editState.current.tabId ||
    edit.requestId !== editState.current.requestId
  ) {
    return
  }
  panelElements.saveStorageEdit.disabled = false
  panelElements.cancelStorageEdit.disabled = false
  panelElements.storageValueInput.disabled = false
  if (!result.ok && editState.current.deleting) {
    editState.current = null
    editorCallbacks.render()
    panelElements.detailMeta.textContent = result.error || 'Unable to delete.'
    return
  }
  if (!result.ok) {
    panelElements.storageEditStatus.textContent =
      result.error || 'Unable to save.'
    return
  }
  panelState.storage = SidepanelStorage.normalizeStorageSnapshot(
    result.snapshot,
  )
  editState.current = null
  panelElements.storageEditor.close()
  if (!SidepanelStorage.getSelectedStorageEntry()) {
    panelState.selectedStorageId =
      SidepanelStorage.getStorageEntries().at(0)?.id || null
  }
  editorCallbacks.render()
  return
}

// Keep edits tied to the document shown when the editor opened, even if the
// tab navigates while a save is pending.
const assertEditDocument = async (tabId: number, documentId: string) => {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 })
  if (!documentId || frame?.documentId !== documentId) {
    throw new Error('The page changed. Refresh storage and edit it again.')
  }
}

const executeStorageEdit = async (edit: StorageEdit, value?: string) => {
  const tabId = edit.tabId
  if (typeof tabId !== 'number') {
    return
  }
  let result: StorageResult
  try {
    await assertEditDocument(tabId, edit.documentId)
    if (edit.area === 'cookie') {
      // cookie-store checks the original value and attributes before writing.
      await ExtensionCookies.write(tabId, { ...edit, value }, edit.deleting)
      const snapshot = await ExtensionCookies.read(tabId)
      if (snapshot.documentId !== edit.documentId) {
        throw new Error('The page changed. Refresh cookies and edit again.')
      }
      result = {
        ok: true,
        snapshot: {
          ...panelState.storage,
          cookies: snapshot.cookies,
          cookieError: '',
        },
      }
    } else {
      // The content script checks expectedValue in the target page immediately
      // before writing; documentId prevents delivery to a replacement document.
      result = await chrome.tabs.sendMessage<unknown, StorageResult>(
        tabId,
        {
          type: edit.deleting
            ? 'dev-sideboard:delete-storage'
            : 'dev-sideboard:set-storage',
          area: edit.area,
          key: edit.key,
          value,
          expectedValue: edit.expectedValue,
        },
        { documentId: edit.documentId },
      )
    }
    await assertEditDocument(tabId, edit.documentId)
    if (result.snapshot) {
      result.snapshot = { ...result.snapshot, documentId: edit.documentId }
    }
  } catch (error) {
    result = {
      ok: false,
      error:
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error),
    }
  }
  handleStorageSaved(edit, result)
}

const initializeStorageEditor = (callbacks: typeof editorCallbacks) => {
  editorCallbacks = callbacks
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
      requestId: ++editRequestSequence,
    }
    SidepanelStorage.renderModeChrome()
    panelElements.detailMeta.textContent = 'Deleting…'
    executeStorageEdit({ ...editState.current })
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
    editState.current.requestId = ++editRequestSequence
    panelElements.saveStorageEdit.disabled = true
    panelElements.cancelStorageEdit.disabled = true
    panelElements.storageValueInput.disabled = true
    panelElements.storageEditStatus.textContent = 'Saving…'
    executeStorageEdit({ ...editState.current }, value)
  })
}

export const SidepanelEditor = { initializeStorageEditor }
