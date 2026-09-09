const PANEL_PORT_NAME = 'dev-sideboard:panel'
const SEARCH_TEXT_LIMIT = 12000
const FILTER_DEBOUNCE_MS = 120

let previewBatch = ImagePreviews.createBatch()

let port: chrome.runtime.Port
const postPanelRequest = (message: PanelRequest) => port.postMessage(message)
const connectPanel = () => {
  port = chrome.runtime.connect({ name: PANEL_PORT_NAME })
  port.onMessage.addListener(handlePanelMessage)
  port.onDisconnect.addListener(() =>
    window.setTimeout(() => {
      connectPanel()
      if (typeof state.tabId === 'number') {
        postPanelRequest({ type: 'init', tabId: state.tabId })
        snapshotPendingUntil = 0
        requestSnapshot()
      }
    }, 250),
  )
}
let filterTimer = 0
let jsonFilterTimer = 0
let snapshotRequestId = 0
let snapshotPendingUntil = 0

const state: {
  tabId: number | null
  mode: 'metadata' | 'storage' | 'cookies'
  metadata: MetadataSnapshot | null
  filter: string
  jsonFilter: string
  rawView: boolean
  storage: ReturnType<typeof normalizeStorageSnapshot>
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

let storageEdit: StorageEdit | null = null
let saveSequence = 0
const elements = {
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

const handlePanelMessage = (message: PanelMessage) => {
  if (message.type === 'metadataChanged') {
    if (message.tabId === state.tabId && state.mode === 'metadata') {
      snapshotPendingUntil = 0
      requestSnapshot()
    }
    return
  }
  if (message.type === 'metadataSnapshot') {
    if (
      message.tabId !== state.tabId ||
      message.requestId !== snapshotRequestId
    ) {
      return
    }
    snapshotPendingUntil = 0
    if (JSON.stringify(state.metadata) !== JSON.stringify(message.snapshot)) {
      state.metadata = message.snapshot
      renderMetadata()
    }
    return
  }
  if (message.type === 'storageSaved') {
    if (
      !storageEdit ||
      message.tabId !== storageEdit.tabId ||
      message.requestId !== storageEdit.requestId
    ) {
      return
    }
    elements.saveStorageEdit.disabled = false
    elements.cancelStorageEdit.disabled = false
    elements.storageValueInput.disabled = false
    if (!message.ok && storageEdit.deleting) {
      storageEdit = null
      render()
      elements.detailMeta.textContent = message.error || 'Unable to delete.'
      return
    }
    if (!message.ok) {
      elements.storageEditStatus.textContent =
        message.error || 'Unable to save.'
      return
    }
    state.storage = normalizeStorageSnapshot(message.snapshot)
    storageEdit = null
    elements.storageEditor.close()
    if (!getSelectedStorageEntry()) {
      state.selectedStorageId = getStorageEntries().at(0)?.id || null
    }
    render()
    return
  }
  if (message.type === 'storageSnapshot') {
    if (message.tabId !== state.tabId) {
      return
    }

    if (
      message.requestId !== undefined &&
      message.requestId !== snapshotRequestId
    ) {
      return
    }
    snapshotPendingUntil = 0
    if (storageEdit) {
      return
    }
    const nextStorage = normalizeStorageSnapshot(message.snapshot)
    const { timestamp: _oldTime, ...oldValues } = state.storage
    const { timestamp: _newTime, ...newValues } = nextStorage
    if (JSON.stringify(oldValues) === JSON.stringify(newValues)) {
      return
    }
    state.storage = nextStorage
    if (
      !getStorageEntries().some((entry) => entry.id === state.selectedStorageId)
    ) {
      state.selectedStorageId = getStorageEntries().at(0)?.id || null
    }
    render()
  }
}

const selectMode = (mode: typeof state.mode) => {
  state.mode = mode
  snapshotPendingUntil = 0
  snapshotRequestId++
  state.selectedStorageId = getStorageEntries().at(0)?.id || null
  requestSnapshot()
  render()
}

let inspectorWindowId: number | undefined
let tabQueryVersion = 0

const initialize = async () => {
  inspectorWindowId = (await chrome.windows.getCurrent()).id
  await selectCurrentTab()

  chrome.tabs.onActivated.addListener(({ windowId }) => {
    if (windowId === inspectorWindowId) {
      selectCurrentTab()
    }
  })

  chrome.tabs.onUpdated.addListener((tabId, changes) => {
    if (
      tabId === state.tabId &&
      (changes.url || changes.status === 'complete')
    ) {
      snapshotRequestId++
      snapshotPendingUntil = 0
      state.metadata = null
      state.storage = normalizeStorageSnapshot(null)
      requestSnapshot()
      render()
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
    state.tabId = null

    state.selectedStorageId = null
    state.metadata = null
    state.storage = normalizeStorageSnapshot(null)
    render()
    elements.detailTitle.textContent = 'No active tab'
    elements.detailTitle.title = ''
    elements.detailMeta.textContent =
      'Select a normal page tab to inspect storage and cookies.'
    return
  }

  if (tabId === state.tabId) {
    return
  }

  snapshotPendingUntil = 0
  snapshotRequestId++
  state.tabId = tabId

  state.selectedStorageId = null
  state.metadata = null
  state.storage = normalizeStorageSnapshot(null)
  render()
  postPanelRequest({ type: 'init', tabId })
  requestSnapshot()
}

const getCurrentTabId = async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId: inspectorWindowId,
  })
  return tab?.id
}

const getStorageEntries = () => {
  return state.mode === 'cookies'
    ? state.storage.cookies || []
    : [...state.storage.local, ...state.storage.session]
}

const getSelectedStorageEntry = () => {
  return getStorageEntries().find(
    (entry) => entry.id === state.selectedStorageId,
  )
}

const getVisibleStorageEntries = () => {
  return getStorageEntries().filter((entry) => {
    if (!state.filter) {
      return true
    }

    return entry.searchText.includes(state.filter)
  })
}

const render = () => {
  const metadata = state.mode === 'metadata'
  elements.metadataModeButton.classList.toggle('active', metadata)
  elements.metadataView.hidden = !metadata
  elements.storageWorkspace.hidden = metadata
  renderMetadata()
  renderModeChrome()
  renderList()
  renderDetail()
}

const renderModeChrome = () => {
  if (
    storageEdit &&
    (storageEdit.tabId !== state.tabId ||
      storageEdit.documentId !== state.storage.documentId)
  ) {
    storageEdit = null
    elements.storageEditor.close()
  }
  const entry = getSelectedStorageEntry()
  elements.deleteStorageButton.disabled =
    !entry ||
    !state.storage.documentId ||
    Boolean(state.storage.error) ||
    Boolean(storageEdit)
  elements.editStorageButton.disabled =
    Boolean(storageEdit) ||
    !entry ||
    !state.storage.documentId ||
    Boolean(state.storage.error)
  elements.storageModeButton.classList.toggle(
    'active',
    state.mode === 'storage',
  )
  elements.cookiesModeButton.classList.toggle(
    'active',
    state.mode === 'cookies',
  )
  elements.rawButton.disabled = !entry
  renderTreeActionButtons()
}

const renderTreeActionButtons = () => {
  const nodes = [...elements.treeView.querySelectorAll('details')]
  elements.toggleTreeButton.disabled = nodes.length === 0
  elements.toggleTreeButton.textContent = nodes.some((node) => !node.open)
    ? 'Expand'
    : 'Collapse'
}

const renderEmptyDetail = (
  title: string,
  message: string,
  emptyText: string,
) => {
  elements.detailTitle.textContent = title
  elements.detailTitle.title = ''
  elements.detailMeta.textContent = message
  elements.treeView.replaceChildren(emptyState(emptyText))
  elements.rawButton.disabled = true
  renderTreeActionButtons()
}

const renderList = () => {
  const entries = getVisibleStorageEntries()
  const total = getStorageEntries().length
  elements.countLabel.textContent = `${entries.length} of ${total} ${state.mode === 'cookies' ? 'cookies' : 'storage items'}`
  elements.entryList.replaceChildren(...entries.map(renderStorageItem))
}

const renderStorageItem = (entry: DisplayStorageEntry) => {
  const item = document.createElement('li')
  item.className = `entry-item${entry.id === state.selectedStorageId ? ' selected' : ''}`
  item.addEventListener('click', () => {
    if (state.selectedStorageId === entry.id) {
      return
    }

    state.selectedStorageId = entry.id
    render()
  })

  const area = document.createElement('span')
  area.className = 'area'
  area.textContent =
    entry.area === 'cookie' ? 'C' : entry.area === 'local' ? 'L' : 'S'
  area.title =
    entry.area === 'cookie'
      ? 'Cookie'
      : entry.area === 'local'
        ? 'Local Storage'
        : 'Session Storage'

  const key = document.createElement('div')
  key.className = 'entry-key'
  key.title =
    entry.area === 'cookie'
      ? `${entry.name} · ${entry.domain}${entry.path}`
      : entry.key
  key.textContent =
    entry.area === 'cookie'
      ? `${entry.name} · ${entry.domain}${entry.path}`
      : entry.key

  const preview = document.createElement('span')
  preview.className = 'value-preview'
  preview.title = entry.value
  preview.textContent = compactValue(entry.value)

  item.append(area, key, preview)
  return item
}

const renderDetail = () => {
  elements.rawButton.setAttribute('aria-pressed', String(state.rawView))
  elements.rawButton.classList.toggle('active', state.rawView)
  elements.jsonFilterInput.disabled = state.rawView
  const entry = getSelectedStorageEntry()
  if (state.storage.error) {
    renderEmptyDetail(
      'Storage unavailable',
      state.storage.error,
      'Storage cannot be read on this page.',
    )
    return
  }

  if (!entry) {
    renderEmptyDetail(
      state.mode === 'cookies'
        ? 'No cookie selected'
        : 'No storage item selected',
      state.storage.origin || 'Select a normal page tab to view storage.',
      state.mode === 'cookies'
        ? state.storage.cookieError || 'No cookies for this page.'
        : 'No Local Storage or Session Storage items.',
    )
    return
  }

  const parsed = parseMaybeJson(entry.value)
  elements.detailTitle.textContent =
    entry.area === 'cookie'
      ? `Cookie: ${entry.name}`
      : `${entry.area === 'local' ? 'Local Storage' : 'Session Storage'}: ${entry.key}`
  elements.detailTitle.title = entry.key
  elements.detailMeta.textContent = [
    state.storage.origin || state.storage.url,
    state.storage.timestamp
      ? new Date(state.storage.timestamp).toLocaleTimeString()
      : '',
  ]
    .filter(Boolean)
    .join(' · ')

  if (entry.area === 'cookie') {
    elements.detailMeta.textContent += ` · ${entry.domain}${entry.path} · ${entry.hostOnly ? 'Host-only' : 'Domain'} · ${entry.secure ? 'Secure' : 'Not Secure'} · ${entry.httpOnly ? 'HttpOnly' : 'Not HttpOnly'} · SameSite: ${entry.sameSite} · ${entry.session ? 'Session' : new Date((entry.expirationDate ?? 0) * 1000).toLocaleString()}${entry.partitionKey ? ` · Partition: ${entry.partitionKey.topLevelSite}` : ''}`
  }
  if (state.rawView) {
    renderRaw(entry.value)
  } else if (parsed.ok) {
    renderFilteredJson(
      parsed.value,
      entry.area === 'cookie' ? entry.name : entry.key,
    )
  } else {
    elements.treeView.replaceChildren(
      renderPrimitiveStorage(
        entry.value,
        entry.area === 'cookie' ? entry.name : entry.key,
      ),
    )
  }
  elements.rawButton.disabled = false
  renderTreeActionButtons()
}

const setTreeOpen = (open: boolean) => {
  for (const details of elements.treeView.querySelectorAll('details')) {
    details.open = open
  }
}

const renderFilteredJson = (value: unknown, key: string) => {
  const tree = renderJsonTree(
    value,
    key,
    state.jsonFilter,
    false,
    { remaining: 5000 },
    0,
  )
  elements.treeView.replaceChildren(
    tree || emptyState('No matching JSON keys or values.'),
  )
}

const renderJsonTree = (
  value: unknown,
  key: string,
  filter = '',
  matchKey = true,
  budget = { remaining: 5000 },
  depth = 0,
): HTMLElement | null => {
  if (--budget.remaining < 0 || depth > 100) {
    return emptyState(
      'Tree display limit reached. Use Raw to view the complete value.',
    )
  }
  const keyMatches = matchKey && normalizeSearchText(key).includes(filter)

  if (value === null || typeof value !== 'object') {
    const valueMatches = normalizeSearchText(
      typeof value === 'string' ? value : String(value),
    ).includes(filter)
    if (filter && !keyMatches && !valueMatches) {
      return null
    }

    return renderPrimitiveStorage(value, key)
  }

  const children = []
  for (const [childKey, childValue] of Object.entries(value)) {
    if (budget.remaining < 0) {
      break
    }
    const child = renderJsonTree(
      childValue,
      childKey,
      keyMatches ? '' : filter,
      true,
      budget,
      depth + 1,
    )
    if (child) {
      children.push(child)
    }
  }

  if (filter && !keyMatches && children.length === 0) {
    return null
  }

  const details = document.createElement('details')
  details.open = true

  const summary = document.createElement('summary')
  summary.append(
    renderKey(key),
    document.createTextNode(
      Array.isArray(value)
        ? `: Array(${value.length})`
        : `: Object(${Object.keys(value).length})`,
    ),
  )
  details.append(summary)

  const container = document.createElement('div')
  container.style.paddingLeft = '1.125rem'

  container.append(...children)

  details.append(container)
  return details
}

const renderKey = (key: string) => {
  const span = document.createElement('span')
  span.className = 'key'
  span.textContent = key
  return span
}

const renderPrimitive = (value: unknown) => {
  const span = document.createElement('span')
  span.className = value === null ? 'null' : typeof value
  span.textContent =
    typeof value === 'string' ? JSON.stringify(value) : String(value)
  return span
}

const emptyState = (text: string) => {
  const node = document.createElement('div')
  node.className = 'empty-state'
  node.textContent = text
  return node
}

const requestSnapshot = () => {
  if (
    typeof state.tabId === 'number' &&
    !storageEdit &&
    Date.now() >= snapshotPendingUntil
  ) {
    snapshotPendingUntil = Date.now() + 5000
    try {
      postPanelRequest({
        type: state.mode === 'metadata' ? 'getMetadata' : 'getStorage',
        requestId: ++snapshotRequestId,
      })
    } catch {
      snapshotPendingUntil = 0
    }
  }
}

const renderRaw = (text: string) => {
  const pre = document.createElement('pre')
  pre.className = 'raw-value'
  pre.textContent = text
  elements.treeView.replaceChildren(pre)
}

const normalizeStorageSnapshot = (
  snapshot: StorageSnapshot | null | undefined,
) => {
  return {
    documentId: snapshot?.documentId || '',
    url: snapshot?.url || '',
    origin: snapshot?.origin || '',
    timestamp: snapshot?.timestamp || null,
    cookieError: snapshot?.cookieError || '',
    cookies: (snapshot?.cookies || []).map((cookie) => ({
      ...cookie,
      area: 'cookie' as const,
      key: ExtensionCookies.identity(cookie),
      id: `cookie:${ExtensionCookies.identity(cookie)}`,
      expectedCookie: ExtensionCookies.fingerprint(cookie),
      searchText: buildSearchText([
        cookie.name,
        cookie.value,
        cookie.domain,
        cookie.path,
      ]),
    })),
    local: prepareStorageEntries(snapshot?.local, 'local'),
    session: prepareStorageEntries(snapshot?.session, 'session'),
    error: snapshot?.error || '',
  }
}

const prepareStorageEntries = (
  entries: StorageValue[] | undefined,
  area: 'local' | 'session',
) => {
  if (!Array.isArray(entries)) {
    return []
  }

  return entries.map((entry) => ({
    ...entry,
    area,
    id: `${area}:${entry.key}`,
    searchText: buildSearchText([area, entry.key, entry.value]),
  }))
}

const buildSearchText = (values: unknown[]) => {
  return normalizeSearchText(
    values
      .map((value) => String(value || '').slice(0, SEARCH_TEXT_LIMIT))
      .join('\n'),
  )
}

const normalizeSearchText = (value: unknown) => {
  return String(value || '').toLocaleLowerCase()
}

const parseMaybeJson = (value: unknown) => {
  const trimmed = String(value || '').trim()
  if (!trimmed || !(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return { ok: false }
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false }
  }
}

const renderPrimitiveStorage = (value: unknown, key: string) => {
  const row = document.createElement('div')
  row.className = 'tree-row'
  row.append(
    renderKey(key),
    document.createTextNode(': '),
    renderPrimitive(value),
  )
  return row
}

const compactValue = (value: unknown) => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 48 ? `${text.slice(0, 48)}...` : text
}

const renderMetadata = () => {
  previewBatch.dispose()
  previewBatch = ImagePreviews.createBatch()
  if (state.mode !== 'metadata') {
    return
  }
  const data = state.metadata
  if (!data || data.error) {
    elements.metadataView.replaceChildren(
      emptyState(
        data?.error ||
          (state.tabId === null
            ? 'Select a normal page tab to view page metadata.'
            : 'Loading page metadata…'),
      ),
    )
    return
  }
  const nodes = []
  for (const [key, title] of [
    ['canonical', 'Canonical URL'],
    ['description', 'Description'],
    data.openGraph?.length
      ? (['openGraph', 'Open Graph'] as const)
      : (['twitter', 'Twitter Card'] as const),
  ] as const) {
    const heading = document.createElement('h2')
    heading.textContent = title
    nodes.push(heading)
    const entries = data[key] || []
    if (!entries.length) {
      nodes.push(emptyState('Not specified'))
      continue
    }
    const list = document.createElement('dl')
    for (const entry of groupMetadataTags(entries)) {
      const name = document.createElement('dt')
      name.textContent = entry.key
      const value = document.createElement('dd')
      value.textContent = entry.values
        ? JSON.stringify(entry.values, null, 2)
        : entry.value || '(empty)'
      const imageUrl = metadataImageUrl(entry, data.baseUrl)
      if (imageUrl) {
        const status = document.createElement('span')
        status.className = 'metadata-image-error'
        status.textContent = 'Loading image…'
        value.append(status)
        previewBatch.load(
          imageUrl,
          (blobUrl) => {
            const image = document.createElement('img')
            image.className = 'metadata-image'
            image.alt = entry.key
            image.addEventListener('load', () => {
              status.hidden = true
            })
            image.addEventListener('error', () => {
              image.remove()
              status.textContent = 'Image unavailable'
            })
            image.src = blobUrl
            value.append(image)
          },
          (message) => {
            status.textContent = message
          },
        )
      }
      list.append(name, value)
    }
    nodes.push(list)
  }
  elements.metadataView.replaceChildren(...nodes)
}

const metadataImageUrl = (
  entry: MetadataEntry,
  baseUrl: string | undefined,
) => {
  if (
    ![
      'og:image',
      'og:image:url',
      'og:image:secure_url',
      'twitter:image',
      'twitter:image:src',
    ].includes(entry.key.toLowerCase()) ||
    !entry.value.trim()
  ) {
    return null
  }
  try {
    const url = new URL(entry.value, baseUrl)
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

const groupMetadataTags = (entries: MetadataEntry[]) => {
  const grouped: MetadataEntry[] = []
  const tags = new Map<string, MetadataEntry & { values: string[] }>()
  for (const entry of entries) {
    const key = entry.key.toLowerCase()
    if (!key.endsWith(':tag')) {
      grouped.push(entry)
      continue
    }
    let group = tags.get(key)
    if (!group) {
      group = { ...entry, values: [] }
      tags.set(key, group)
      grouped.push(group)
    }
    group.values.push(entry.value)
  }
  return grouped
}

// Register handlers after their const bindings have been initialized.
window.addEventListener('pagehide', () => previewBatch.dispose())

connectPanel()

elements.deleteStorageButton.addEventListener('click', () => {
  const entry = getSelectedStorageEntry()
  if (!entry || !state.storage.documentId || storageEdit) {
    return
  }
  storageEdit = {
    deleting: true,
    tabId: state.tabId,
    documentId: state.storage.documentId,
    area: entry.area,
    key: entry.key,
    expectedValue: entry.value,
    expectedCookie: entry.area === 'cookie' ? entry.expectedCookie : undefined,
    requestId: ++saveSequence,
  }
  renderModeChrome()
  elements.detailMeta.textContent = 'Deleting…'
  postPanelRequest({ type: 'deleteStorage', ...storageEdit })
})

elements.editStorageButton.addEventListener('click', () => {
  const entry = getSelectedStorageEntry()
  if (!entry || !state.storage.documentId) {
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
  storageEdit = {
    json,
    tabId: state.tabId,
    documentId: state.storage.documentId,
    area: entry.area,
    key: entry.key,
    expectedValue: entry.value,
    expectedCookie: entry.area === 'cookie' ? entry.expectedCookie : undefined,
  }
  elements.storageEditorTitle.textContent =
    entry.area === 'cookie'
      ? `Edit Cookie: ${entry.name}`
      : `Edit ${entry.area === 'local' ? 'Local' : 'Session'} Storage: ${entry.key}`
  elements.storageValueInput.value = json
    ? JSON.stringify(parsed, null, 2)
    : entry.value
  elements.storageEditStatus.textContent = ''
  elements.saveStorageEdit.disabled = false
  elements.cancelStorageEdit.disabled = false
  elements.storageValueInput.disabled = false
  elements.storageEditor.showModal()
  elements.storageValueInput.focus()
})

elements.cancelStorageEdit.addEventListener('click', () => {
  storageEdit = null
  elements.storageEditor.close()
})

elements.storageEditor.addEventListener('cancel', (event) => {
  if (elements.saveStorageEdit.disabled) {
    event.preventDefault()
  } else {
    storageEdit = null
  }
})

elements.saveStorageEdit.addEventListener('click', () => {
  if (!storageEdit) {
    return
  }
  const value = elements.storageValueInput.value
  try {
    if (storageEdit.json) {
      JSON.parse(value)
    }
  } catch (error) {
    elements.storageEditStatus.textContent = `Invalid JSON: ${error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)}`
    return
  }
  storageEdit.requestId = ++saveSequence
  elements.saveStorageEdit.disabled = true
  elements.cancelStorageEdit.disabled = true
  elements.storageValueInput.disabled = true
  elements.storageEditStatus.textContent = 'Saving…'
  postPanelRequest({ type: 'setStorage', ...storageEdit, value })
})

elements.metadataModeButton.addEventListener('click', () =>
  selectMode('metadata'),
)

elements.storageModeButton.addEventListener('click', () =>
  selectMode('storage'),
)

elements.cookiesModeButton.addEventListener('click', () =>
  selectMode('cookies'),
)

elements.filterInput.addEventListener('input', () => {
  window.clearTimeout(filterTimer)
  filterTimer = window.setTimeout(() => {
    state.filter = normalizeSearchText(elements.filterInput.value.trim())
    render()
  }, FILTER_DEBOUNCE_MS)
})

elements.jsonFilterInput.addEventListener('input', () => {
  window.clearTimeout(jsonFilterTimer)
  jsonFilterTimer = window.setTimeout(() => {
    state.jsonFilter = normalizeSearchText(
      elements.jsonFilterInput.value.trim(),
    )
    renderDetail()
  }, FILTER_DEBOUNCE_MS)
})

elements.toggleTreeButton.addEventListener('click', () => {
  const nodes = [...elements.treeView.querySelectorAll('details')]
  setTreeOpen(nodes.some((node) => !node.open))
  renderTreeActionButtons()
})

elements.treeView.addEventListener('toggle', renderTreeActionButtons, true)

elements.rawButton.addEventListener('click', () => {
  state.rawView = !state.rawView
  renderDetail()
})

initialize().catch((error) => {
  elements.detailMeta.textContent =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error)
})

window.setInterval(() => {
  if (state.mode !== 'metadata' && document.visibilityState !== 'hidden') {
    requestSnapshot()
  }
}, 1000)
