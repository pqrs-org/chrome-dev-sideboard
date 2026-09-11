import { errorMessage } from './error-message.js'
import { ExtensionCookies } from './cookie-store.js'
import { SidepanelState } from './sidepanel-state.js'
import { SidepanelStorage } from './sidepanel-storage.js'

const { editState, panelElements, panelState, snapshotState } = SidepanelState

// Assign a new requestId whenever a save or delete request is sent.
// Matching replies against the current edit prevents delayed replies from
// an earlier operation from closing or updating a newer edit.
let editRequestSequence = 0

const createStorageEdit = (entry: DisplayStorageEntry): StorageEdit => ({
  tabId: panelState.tabId,
  documentId: panelState.storage.documentId,
  area: entry.area,
  key: entry.key,
  expectedValue: entry.value,
  expectedCookie: entry.area === 'cookie' ? entry.expectedCookie : undefined,
})

const setEditorBusy = (busy: boolean) => {
  panelElements.saveStorageEdit.disabled = busy
  panelElements.cancelStorageEdit.disabled = busy
  panelElements.storageValueInput.disabled = busy
}

const handleSaveOrDeleteResult = (edit: StorageEdit, result: StorageResult) => {
  if (
    !editState.current ||
    edit.tabId !== editState.current.tabId ||
    edit.requestId !== editState.current.requestId
  ) {
    return
  }
  setEditorBusy(false)
  if (!result.ok && editState.current.deleting) {
    editState.current = null
    SidepanelStorage.renderModeChrome()
    panelElements.detailMeta.textContent = result.error || 'Unable to delete.'
    return
  }
  if (!result.ok) {
    panelElements.storageEditStatus.textContent =
      result.error || 'Unable to save.'
    return
  }
  editState.current = null
  panelElements.storageEditor.close()
  // Let the next periodic read refresh the list. Discard reads started before
  // this write so their old values cannot replace the next snapshot.
  snapshotState.requestId++
  snapshotState.pendingUntil = 0
  SidepanelStorage.renderModeChrome()
  if (edit.deleting) {
    panelElements.detailMeta.textContent = 'Deleted.'
  }
}

// Keep edits tied to the document shown when the editor opened, even if the
// tab navigates while a save is pending.
const assertEditDocument = async (tabId: number, documentId: string) => {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 })
  if (!documentId || frame?.documentId !== documentId) {
    throw new Error('The page changed. Refresh storage and edit it again.')
  }
}

const saveOrDelete = async (edit: StorageEdit, value?: string) => {
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
      result = { ok: true }
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
  } catch (error) {
    result = {
      ok: false,
      error: errorMessage(error),
    }
  }
  handleSaveOrDeleteResult(edit, result)
}

const initializeStorageEditor = () => {
  panelElements.deleteStorageButton.addEventListener('click', () => {
    const entry = SidepanelStorage.getSelectedStorageEntry()
    if (!entry || !panelState.storage.documentId || editState.current) {
      return
    }
    editState.current = {
      deleting: true,
      ...createStorageEdit(entry),
      requestId: ++editRequestSequence,
    }
    SidepanelStorage.renderModeChrome()
    panelElements.detailMeta.textContent = 'Deleting…'
    saveOrDelete({ ...editState.current })
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
      ...createStorageEdit(entry),
    }
    panelElements.storageEditorTitle.textContent =
      entry.area === 'cookie'
        ? `Edit Cookie: ${entry.name}`
        : `Edit ${entry.area === 'local' ? 'Local' : 'Session'} Storage: ${entry.key}`
    panelElements.storageValueInput.value = json
      ? JSON.stringify(parsed, null, 2)
      : entry.value
    panelElements.storageEditStatus.textContent = ''
    setEditorBusy(false)
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
      panelElements.storageEditStatus.textContent = `Invalid JSON: ${errorMessage(error)}`
      return
    }
    editState.current.requestId = ++editRequestSequence
    setEditorBusy(true)
    panelElements.storageEditStatus.textContent = 'Saving…'
    saveOrDelete({ ...editState.current }, value)
  })
}

export const SidepanelEditor = { initializeStorageEditor }
