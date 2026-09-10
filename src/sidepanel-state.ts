import type { SidepanelStorage } from './sidepanel-storage.js'

// Shared state and DOM references for the side panel feature scripts.
const FILTER_DEBOUNCE_MS = 120

const panelState: {
  tabId: number | null
  mode: 'metadata' | 'storage' | 'cookies'
  metadata: MetadataSnapshot | null
  filter: string
  jsonFilter: string
  rawView: boolean
  storage: ReturnType<typeof SidepanelStorage.normalizeStorageSnapshot>
  selectedStorageId: string | null
} = {
  tabId: null,
  mode: 'metadata',
  metadata: null,
  filter: '',
  jsonFilter: '',
  rawView: false,
  storage: {
    documentId: '',
    cookies: [],
    cookieError: '',
    url: '',
    origin: '',
    timestamp: null,
    local: [],
    session: [],
    error: '',
  },
  selectedStorageId: null,
}

const panelElements = {
  metadataModeButton: document.getElementById(
    'metadataModeButton',
  ) as HTMLButtonElement,
  metadataView: document.getElementById('metadataView') as HTMLElement,
  storageWorkspace: document.getElementById('storageWorkspace') as HTMLElement,
  deleteStorageButton: document.getElementById(
    'deleteStorageButton',
  ) as HTMLButtonElement,
  editStorageButton: document.getElementById(
    'editStorageButton',
  ) as HTMLButtonElement,
  storageEditor: document.getElementById('storageEditor') as HTMLDialogElement,
  storageEditorTitle: document.getElementById(
    'storageEditorTitle',
  ) as HTMLElement,
  storageValueInput: document.getElementById(
    'storageValueInput',
  ) as HTMLTextAreaElement,
  storageEditStatus: document.getElementById(
    'storageEditStatus',
  ) as HTMLElement,
  cancelStorageEdit: document.getElementById(
    'cancelStorageEdit',
  ) as HTMLButtonElement,
  saveStorageEdit: document.getElementById(
    'saveStorageEdit',
  ) as HTMLButtonElement,
  storageModeButton: document.getElementById(
    'storageModeButton',
  ) as HTMLButtonElement,
  cookiesModeButton: document.getElementById(
    'cookiesModeButton',
  ) as HTMLButtonElement,
  filterInput: document.getElementById('filterInput') as HTMLInputElement,
  countLabel: document.getElementById('countLabel') as HTMLElement,
  entryList: document.getElementById('entryList') as HTMLElement,
  detailTitle: document.getElementById('detailTitle') as HTMLElement,
  detailMeta: document.getElementById('detailMeta') as HTMLElement,
  jsonFilterInput: document.getElementById(
    'jsonFilterInput',
  ) as HTMLInputElement,
  toggleTreeButton: document.getElementById(
    'toggleTreeButton',
  ) as HTMLButtonElement,
  rawButton: document.getElementById('rawButton') as HTMLButtonElement,
  treeView: document.getElementById('treeView') as HTMLElement,
}

const editState: { current: StorageEdit | null } = { current: null }
const snapshotState = { requestId: 0, pendingUntil: 0 }

export const SidepanelState = {
  panelElements,
  panelState,
  FILTER_DEBOUNCE_MS,
  editState,
  snapshotState,
}
