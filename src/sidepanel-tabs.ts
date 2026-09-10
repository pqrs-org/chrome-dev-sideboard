import { SidepanelState } from './sidepanel-state.js'
import { SidepanelJson } from './sidepanel-json.js'
import { SidepanelStorage } from './sidepanel-storage.js'
import { SidepanelEditor } from './sidepanel-editor.js'
import { SidepanelMetadata } from './sidepanel-metadata.js'

const { panelState, snapshotState, panelElements, editState } = SidepanelState

const PANEL_PORT_NAME = 'dev-sideboard:panel'

let port: chrome.runtime.Port

const postPanelRequest = (message: PanelRequest) => port.postMessage(message)

const connectPanel = () => {
  port = chrome.runtime.connect({ name: PANEL_PORT_NAME })
  port.onMessage.addListener(handlePanelMessage)
  port.onDisconnect.addListener(() =>
    window.setTimeout(() => {
      connectPanel()
      if (typeof panelState.tabId === 'number') {
        postPanelRequest({
          type: 'init',
          tabId: panelState.tabId,
        })
        snapshotState.pendingUntil = 0
        requestSnapshot()
      }
    }, 250),
  )
}

const handlePanelMessage = (message: PanelMessage) => {
  if (message.type === 'metadataChanged') {
    if (message.tabId === panelState.tabId && panelState.mode === 'metadata') {
      snapshotState.pendingUntil = 0
      requestSnapshot()
    }
    return
  }
  if (message.type === 'metadataSnapshot') {
    if (
      message.tabId !== panelState.tabId ||
      message.requestId !== snapshotState.requestId
    ) {
      return
    }
    snapshotState.pendingUntil = 0
    if (
      JSON.stringify(panelState.metadata) !== JSON.stringify(message.snapshot)
    ) {
      panelState.metadata = message.snapshot
      SidepanelMetadata.renderMetadata()
    }
    return
  }
  if (message.type === 'storageSaved') {
    SidepanelEditor.handleStorageSaved(message)
  } else if (message.type === 'storageSnapshot') {
    SidepanelStorage.handleStorageSnapshot(message)
  }
}

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
  postPanelRequest({ type: 'init', tabId })
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

const requestSnapshot = () => {
  if (
    typeof panelState.tabId === 'number' &&
    !editState.current &&
    Date.now() >= snapshotState.pendingUntil
  ) {
    snapshotState.pendingUntil = Date.now() + 5000
    try {
      postPanelRequest({
        type: panelState.mode === 'metadata' ? 'getMetadata' : 'getStorage',
        requestId: ++snapshotState.requestId,
      })
    } catch {
      snapshotState.pendingUntil = 0
    }
  }
}

const start = () => {
  // Connect feature callbacks before registering handlers or requesting data.
  SidepanelMetadata.initializeMetadata()
  SidepanelJson.initializeJsonViewer(SidepanelStorage.renderDetail)
  SidepanelStorage.initializeStorageList(renderTabs)
  SidepanelEditor.initializeStorageEditor({
    render: renderTabs,
    postRequest: postPanelRequest,
  })
  connectPanel()

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

export const SidepanelTabs = { renderTabs, postPanelRequest, start }

SidepanelTabs.start()
