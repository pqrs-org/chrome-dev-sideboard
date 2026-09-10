import { SidepanelPageAccess } from './sidepanel-page-access.js'
import { SidepanelState } from './sidepanel-state.js'
import { SidepanelJson } from './sidepanel-json.js'
import { SidepanelStorage } from './sidepanel-storage.js'
import { SidepanelEditor } from './sidepanel-editor.js'
import { SidepanelMetadata } from './sidepanel-metadata.js'

const { panelState, snapshotState, panelElements, editState } = SidepanelState

const selectMode = (mode: typeof panelState.mode) => {
  panelState.mode = mode
  snapshotState.pendingUntil = 0
  snapshotState.requestId++
  panelState.selectedStorageId =
    SidepanelStorage.getStorageEntries().at(0)?.id || null
  requestSnapshot()
  renderTabs()
}

let tabPanelWindowId: number | undefined

let tabQueryVersion = 0

const initializeTabs = async () => {
  tabPanelWindowId = (await chrome.windows.getCurrent()).id
  await selectCurrentTab()

  chrome.tabs.onActivated.addListener(({ windowId }) => {
    if (windowId === tabPanelWindowId) {
      selectCurrentTab()
    }
  })

  chrome.tabs.onUpdated.addListener((tabId, changes) => {
    if (
      tabId === panelState.tabId &&
      (changes.url || changes.status === 'complete')
    ) {
      snapshotState.requestId++
      snapshotState.pendingUntil = 0
      panelState.metadata = null
      panelState.storage = SidepanelStorage.normalizeStorageSnapshot(null)
      requestSnapshot()
      renderTabs()
    }
  })
  chrome.tabs.onRemoved.addListener(() => selectCurrentTab())
  chrome.tabs.onReplaced.addListener(() => selectCurrentTab())
}

const selectCurrentTab = async () => {
  const version = ++tabQueryVersion
  const tabId = await getCurrentTabId()
  if (version !== tabQueryVersion) {
    return
  }
  if (typeof tabId !== 'number') {
    panelState.tabId = null

    panelState.selectedStorageId = null
    panelState.metadata = null
    panelState.storage = SidepanelStorage.normalizeStorageSnapshot(null)
    renderTabs()
    panelElements.detailTitle.textContent = 'No active tab'
    panelElements.detailTitle.title = ''
    panelElements.detailMeta.textContent =
      'Select a normal page tab to inspect storage and cookies.'
    return
  }

  if (tabId === panelState.tabId) {
    return
  }

  snapshotState.pendingUntil = 0
  snapshotState.requestId++
  panelState.tabId = tabId

  panelState.selectedStorageId = null
  panelState.metadata = null
  panelState.storage = SidepanelStorage.normalizeStorageSnapshot(null)
  renderTabs()
  requestSnapshot()
}

const getCurrentTabId = async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId: tabPanelWindowId,
  })
  return tab?.id
}

const renderTabs = () => {
  const metadata = panelState.mode === 'metadata'
  panelElements.metadataModeButton.classList.toggle('active', metadata)
  panelElements.metadataView.hidden = !metadata
  panelElements.storageWorkspace.hidden = metadata
  SidepanelMetadata.renderMetadata()
  SidepanelStorage.renderModeChrome()
  SidepanelStorage.renderList()
  SidepanelStorage.renderDetail()
}

const requestSnapshot = async () => {
  const tabId = panelState.tabId
  if (
    typeof tabId !== 'number' ||
    editState.current ||
    Date.now() < snapshotState.pendingUntil
  ) {
    return
  }
  snapshotState.pendingUntil = Date.now() + 5000
  const requestId = ++snapshotState.requestId
  const isCurrent = () =>
    tabId === panelState.tabId && requestId === snapshotState.requestId

  if (panelState.mode === 'metadata') {
    const snapshot = await SidepanelPageAccess.readMetadata(tabId)
    if (!isCurrent()) {
      return
    }
    snapshotState.pendingUntil = 0
    if (JSON.stringify(panelState.metadata) !== JSON.stringify(snapshot)) {
      panelState.metadata = snapshot
      SidepanelMetadata.renderMetadata()
    }
  } else {
    const snapshot = await SidepanelPageAccess.readStorage(tabId)
    if (!isCurrent()) {
      return
    }
    snapshotState.pendingUntil = 0
    SidepanelStorage.applyStorageSnapshot(snapshot)
  }
}

const start = () => {
  // Connect feature callbacks before registering handlers or requesting data.
  SidepanelMetadata.initializeMetadata()
  SidepanelJson.initializeJsonViewer(SidepanelStorage.renderDetail)
  SidepanelStorage.initializeStorageList(renderTabs)
  SidepanelEditor.initializeStorageEditor({
    render: renderTabs,
  })
  const stopObserving = SidepanelPageAccess.observeMetadataChanges((tabId) => {
    if (tabId === panelState.tabId && panelState.mode === 'metadata') {
      snapshotState.pendingUntil = 0
      requestSnapshot()
    }
  })
  window.addEventListener('pagehide', stopObserving, { once: true })

  panelElements.metadataModeButton.addEventListener('click', () =>
    selectMode('metadata'),
  )

  panelElements.storageModeButton.addEventListener('click', () =>
    selectMode('storage'),
  )

  panelElements.cookiesModeButton.addEventListener('click', () =>
    selectMode('cookies'),
  )

  initializeTabs().catch((error) => {
    panelElements.detailMeta.textContent =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error)
  })

  window.setInterval(() => {
    if (
      panelState.mode !== 'metadata' &&
      document.visibilityState !== 'hidden'
    ) {
      requestSnapshot()
    }
  }, 1000)
}

export const SidepanelTabs = { start }

SidepanelTabs.start()
