import {
  SidepanelActiveTab,
  type ActiveTabUpdate,
} from './sidepanel-active-tab.js'
import { SidepanelPageData } from './sidepanel-page-data.js'
import { SidepanelState } from './sidepanel-state.js'
import { SidepanelJson } from './sidepanel-json.js'
import { SidepanelStorage } from './sidepanel-storage.js'
import { SidepanelEditor } from './sidepanel-editor.js'
import { SidepanelMetadata } from './sidepanel-metadata.js'

const { panelState, snapshotState, panelElements, editState } = SidepanelState

const selectMode = (mode: typeof panelState.mode) => {
  if (panelState.mode === mode) {
    return
  }
  panelState.mode = mode
  panelState.storage = SidepanelStorage.normalizeStorageSnapshot(null)
  snapshotState.pendingUntil = 0
  snapshotState.requestId++
  panelState.selectedStorageId =
    SidepanelStorage.getStorageEntries().at(0)?.id || null
  requestSnapshot()
  renderTabs()
}

const updateActiveTab = ({ tab, error, pageChanged }: ActiveTabUpdate) => {
  const tabId = tab?.id ?? null
  const switched = tabId !== panelState.tabId
  if (!switched && !pageChanged && tabId !== null) {
    return
  }
  snapshotState.pendingUntil = 0
  snapshotState.requestId++
  panelState.tabId = tabId
  if (switched || tabId === null) {
    panelState.selectedStorageId = null
  }
  panelState.metadata = error === undefined ? null : { error }
  panelState.storage = SidepanelStorage.normalizeStorageSnapshot(
    error === undefined ? null : { error },
  )
  // Clear an edit for the previous document before requesting its replacement.
  renderTabs()
  if (tabId !== null) {
    requestSnapshot()
  } else {
    panelElements.detailTitle.textContent =
      error === undefined ? 'No active tab' : 'Page information unavailable'
    panelElements.detailTitle.title = ''
    panelElements.detailMeta.textContent =
      error ?? 'Select a normal page tab to inspect storage and cookies.'
  }
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
    const snapshot = await SidepanelPageData.readMetadata(tabId)
    if (!isCurrent()) {
      return
    }
    snapshotState.pendingUntil = 0
    if (JSON.stringify(panelState.metadata) !== JSON.stringify(snapshot)) {
      panelState.metadata = snapshot
      SidepanelMetadata.renderMetadata()
    }
  } else {
    const snapshot =
      panelState.mode === 'cookies'
        ? await SidepanelPageData.readCookies(tabId)
        : await SidepanelPageData.readStorage(tabId)
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
  SidepanelEditor.initializeStorageEditor()
  const stopObserving = SidepanelPageData.observeMetadataChanges((tabId) => {
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

  SidepanelActiveTab.observe(updateActiveTab)

  window.setInterval(() => {
    if (
      panelState.mode !== 'metadata' &&
      document.visibilityState !== 'hidden'
    ) {
      requestSnapshot()
    }
  }, 1000)
}

start()
