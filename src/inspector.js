const PANEL_PORT_NAME = 'dev-sideboard:panel'
const SEARCH_TEXT_LIMIT = 12000
const FILTER_DEBOUNCE_MS = 120

let port
function connectPanel() {
  port = chrome.runtime.connect({ name: PANEL_PORT_NAME })
  port.onMessage.addListener(handlePanelMessage)
  port.onDisconnect.addListener(() =>
    window.setTimeout(() => {
      connectPanel()
      if (typeof state.tabId === 'number') {
        port.postMessage({ type: 'init', tabId: state.tabId })
        storagePendingUntil = 0
        requestStorageSnapshot()
      }
    }, 250),
  )
}
let filterTimer = 0
let jsonFilterTimer = 0
let storageRequestId = 0
let storagePendingUntil = 0

const state = {
  tabId: null,
  mode: 'metadata',
  metadata: null,
  filter: '',
  jsonFilter: '',
  rawView: false,
  storage: {
    url: '',
    origin: '',
    timestamp: null,
    local: [],
    session: [],
    error: '',
  },
  selectedStorageId: null,
}

let storageEdit = null
let saveSequence = 0
const elements = {
  metadataModeButton: document.getElementById('metadataModeButton'),
  metadataView: document.getElementById('metadataView'),
  storageWorkspace: document.getElementById('storageWorkspace'),
  deleteStorageButton: document.getElementById('deleteStorageButton'),
  editStorageButton: document.getElementById('editStorageButton'),
  storageEditor: document.getElementById('storageEditor'),
  storageEditorTitle: document.getElementById('storageEditorTitle'),
  storageJsonInput: document.getElementById('storageJsonInput'),
  storageEditStatus: document.getElementById('storageEditStatus'),
  cancelStorageEdit: document.getElementById('cancelStorageEdit'),
  saveStorageEdit: document.getElementById('saveStorageEdit'),
  storageModeButton: document.getElementById('storageModeButton'),
  cookiesModeButton: document.getElementById('cookiesModeButton'),
  filterInput: document.getElementById('filterInput'),
  countLabel: document.getElementById('countLabel'),
  entryList: document.getElementById('entryList'),
  detailTitle: document.getElementById('detailTitle'),
  detailMeta: document.getElementById('detailMeta'),
  jsonFilterInput: document.getElementById('jsonFilterInput'),
  toggleTreeButton: document.getElementById('toggleTreeButton'),
  rawButton: document.getElementById('rawButton'),
  treeView: document.getElementById('treeView'),
}

function handlePanelMessage(message) {
  if (message.type === 'metadataChanged') {
    if (message.tabId === state.tabId && state.mode === 'metadata') {
      storagePendingUntil = 0
      requestStorageSnapshot()
    }
    return
  }
  if (message.type === 'metadataSnapshot') {
    if (message.tabId !== state.tabId || message.requestId !== storageRequestId)
      return
    storagePendingUntil = 0
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
    )
      return
    elements.saveStorageEdit.disabled = false
    elements.cancelStorageEdit.disabled = false
    elements.storageJsonInput.disabled = false
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
    if (!getSelectedStorageEntry())
      state.selectedStorageId = getStorageEntries().at(0)?.id || null
    render()
    return
  }
  if (message.type === 'storageSnapshot') {
    if (message.tabId !== state.tabId) {
      return
    }

    if (
      message.requestId !== undefined &&
      message.requestId !== storageRequestId
    )
      return
    storagePendingUntil = 0
    if (storageEdit) return
    const nextStorage = normalizeStorageSnapshot(message.snapshot)
    const { timestamp: oldTime, ...oldValues } = state.storage
    const { timestamp: newTime, ...newValues } = nextStorage
    if (JSON.stringify(oldValues) === JSON.stringify(newValues)) return
    state.storage = nextStorage
    if (
      !getStorageEntries().some((entry) => entry.id === state.selectedStorageId)
    ) {
      state.selectedStorageId = getStorageEntries().at(0)?.id || null
    }
    render()
  }
}
connectPanel()

elements.deleteStorageButton.addEventListener('click', () => {
  const entry = getSelectedStorageEntry()
  if (!entry || !state.storage.documentId || storageEdit) return
  storageEdit = {
    deleting: true,
    tabId: state.tabId,
    documentId: state.storage.documentId,
    area: entry.area,
    key: entry.key,
    expectedValue: entry.value,
    expectedCookie: entry.expectedCookie,
    requestId: ++saveSequence,
  }
  renderModeChrome()
  elements.detailMeta.textContent = 'Deleting…'
  port.postMessage({ type: 'deleteStorage', ...storageEdit })
})

elements.editStorageButton.addEventListener('click', () => {
  const entry = getSelectedStorageEntry()
  if (!entry || !state.storage.documentId) return
  let parsed
  let json = false
  if (entry.area !== 'cookie') {
    try {
      parsed = JSON.parse(entry.value)
      json = true
    } catch (_) {}
  }
  storageEdit = {
    json,
    tabId: state.tabId,
    documentId: state.storage.documentId,
    area: entry.area,
    key: entry.key,
    expectedValue: entry.value,
    expectedCookie: entry.expectedCookie,
  }
  elements.storageEditorTitle.textContent =
    entry.area === 'cookie'
      ? `Edit Cookie: ${entry.name}`
      : `Edit ${entry.area === 'local' ? 'Local' : 'Session'} Storage: ${entry.key}`
  elements.storageJsonInput.value = json
    ? JSON.stringify(parsed, null, 2)
    : entry.value
  elements.storageEditStatus.textContent = ''
  elements.saveStorageEdit.disabled = false
  elements.cancelStorageEdit.disabled = false
  elements.storageJsonInput.disabled = false
  elements.storageEditor.showModal()
  elements.storageJsonInput.focus()
})
elements.cancelStorageEdit.addEventListener('click', () => {
  storageEdit = null
  elements.storageEditor.close()
})
elements.storageEditor.addEventListener('cancel', (event) => {
  if (elements.saveStorageEdit.disabled) event.preventDefault()
  else storageEdit = null
})
elements.saveStorageEdit.addEventListener('click', () => {
  if (!storageEdit) return
  const value = elements.storageJsonInput.value
  try {
    if (storageEdit.json) JSON.parse(value)
  } catch (error) {
    elements.storageEditStatus.textContent = `Invalid JSON: ${error.message}`
    return
  }
  storageEdit.requestId = ++saveSequence
  elements.saveStorageEdit.disabled = true
  elements.cancelStorageEdit.disabled = true
  elements.storageJsonInput.disabled = true
  elements.storageEditStatus.textContent = 'Saving…'
  port.postMessage({ type: 'setStorage', ...storageEdit, value })
})

function selectStorageMode(mode) {
  state.mode = mode
  storagePendingUntil = 0
  storageRequestId++
  state.selectedStorageId = getStorageEntries().at(0)?.id || null
  requestStorageSnapshot()
  render()
}
elements.metadataModeButton.addEventListener('click', () =>
  selectStorageMode('metadata'),
)
elements.storageModeButton.addEventListener('click', () =>
  selectStorageMode('storage'),
)
elements.cookiesModeButton.addEventListener('click', () =>
  selectStorageMode('cookies'),
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

let inspectorWindowId
let tabQueryVersion = 0
initialize().catch((error) => {
  elements.detailMeta.textContent = error.message
})
async function initialize() {
  inspectorWindowId = (await chrome.windows.getCurrent()).id
  await selectCurrentTab()

  if (chrome.tabs) {
    chrome.tabs.onActivated.addListener(({ windowId }) => {
      if (windowId === inspectorWindowId) selectCurrentTab()
    })

    chrome.tabs.onUpdated.addListener((tabId, changes) => {
      if (
        tabId === state.tabId &&
        (changes.url || changes.status === 'complete')
      ) {
        storageRequestId++
        storagePendingUntil = 0
        state.metadata = null
        state.storage = normalizeStorageSnapshot(null)
        requestStorageSnapshot()
        render()
      }
    })
    chrome.tabs.onRemoved.addListener(() => selectCurrentTab())
    chrome.tabs.onReplaced.addListener(() => selectCurrentTab())
  }
}

async function selectCurrentTab() {
  const version = ++tabQueryVersion
  const tabId = await getCurrentTabId()
  if (version !== tabQueryVersion) return
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

  storagePendingUntil = 0
  storageRequestId++
  state.tabId = tabId

  state.selectedStorageId = null
  state.metadata = null
  state.storage = normalizeStorageSnapshot(null)
  render()
  port.postMessage({ type: 'init', tabId })
  requestStorageSnapshot()
}

async function getCurrentTabId() {
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId: inspectorWindowId,
  })
  return tab?.id
}

function getStorageEntries() {
  return state.mode === 'cookies'
    ? state.storage.cookies || []
    : [...state.storage.local, ...state.storage.session]
}

function getSelectedStorageEntry() {
  return getStorageEntries().find(
    (entry) => entry.id === state.selectedStorageId,
  )
}

function getVisibleStorageEntries() {
  return getStorageEntries().filter((entry) => {
    if (!state.filter) {
      return true
    }

    return entry.searchText.includes(state.filter)
  })
}

function render() {
  const metadata = state.mode === 'metadata'
  elements.metadataModeButton.classList.toggle('active', metadata)
  elements.metadataView.hidden = !metadata
  elements.storageWorkspace.hidden = metadata
  renderMetadata()
  renderModeChrome()
  renderList()
  renderDetail()
}

function renderModeChrome() {
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
  elements.editStorageButton.textContent = 'Edit'
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

function renderTreeActionButtons() {
  const nodes = [...elements.treeView.querySelectorAll('details')]
  elements.toggleTreeButton.disabled = nodes.length === 0
  elements.toggleTreeButton.textContent = nodes.some((node) => !node.open)
    ? 'Expand'
    : 'Collapse'
}

function renderEmptyDetail(title, message, emptyText) {
  elements.detailTitle.textContent = title
  elements.detailTitle.title = ''
  elements.detailMeta.textContent = message
  elements.treeView.replaceChildren(emptyState(emptyText))
  elements.rawButton.disabled = true
  renderTreeActionButtons()
}

function renderList() {
  const entries = getVisibleStorageEntries()
  const total = getStorageEntries().length
  elements.countLabel.textContent = `${entries.length} of ${total} ${state.mode === 'cookies' ? 'cookies' : 'storage items'}`
  elements.entryList.replaceChildren(...entries.map(renderStorageItem))
}

function renderStorageItem(entry) {
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

function renderDetail() {
  elements.rawButton.setAttribute('aria-pressed', String(state.rawView))
  elements.rawButton.classList.toggle('active', state.rawView)
  elements.jsonFilterInput.disabled = state.rawView
  renderStorageDetail()
}

function renderStorageDetail() {
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
    elements.detailMeta.textContent += ` · ${entry.domain}${entry.path} · ${entry.hostOnly ? 'Host-only' : 'Domain'} · ${entry.secure ? 'Secure' : 'Not Secure'} · ${entry.httpOnly ? 'HttpOnly' : 'Not HttpOnly'} · SameSite: ${entry.sameSite} · ${entry.session ? 'Session' : new Date(entry.expirationDate * 1000).toLocaleString()}${entry.partitionKey ? ` · Partition: ${entry.partitionKey.topLevelSite}` : ''}`
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

function setTreeOpen(open) {
  for (const details of elements.treeView.querySelectorAll('details')) {
    details.open = open
  }
}

function renderFilteredJson(value, key) {
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

function renderJsonTree(
  value,
  key,
  filter = '',
  matchKey = true,
  budget = { remaining: 5000 },
  depth = 0,
) {
  if (--budget.remaining < 0 || depth > 100)
    return emptyState(
      'Tree display limit reached. Use Raw to view the complete value.',
    )
  const keyMatches = matchKey && normalizeSearchText(key).includes(filter)

  if (value === null || typeof value !== 'object') {
    const valueMatches = normalizeSearchText(
      typeof value === 'string' ? value : String(value),
    ).includes(filter)
    if (filter && !keyMatches && !valueMatches) {
      return null
    }

    const row = document.createElement('div')
    row.className = 'tree-row'
    row.append(
      renderKey(key),
      document.createTextNode(': '),
      renderPrimitive(value),
    )
    return row
  }

  const children = []
  for (const [childKey, childValue] of Object.entries(value)) {
    if (budget.remaining < 0) break
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

function renderKey(key) {
  const span = document.createElement('span')
  span.className = 'key'
  span.textContent = key
  return span
}

function renderPrimitive(value) {
  const span = document.createElement('span')
  span.className = value === null ? 'null' : typeof value
  span.textContent =
    typeof value === 'string' ? JSON.stringify(value) : String(value)
  return span
}

function emptyState(text) {
  const node = document.createElement('div')
  node.className = 'empty-state'
  node.textContent = text
  return node
}

function requestStorageSnapshot() {
  if (
    typeof state.tabId === 'number' &&
    !storageEdit &&
    Date.now() >= storagePendingUntil
  ) {
    storagePendingUntil = Date.now() + 5000
    try {
      port.postMessage({
        type: state.mode === 'metadata' ? 'getMetadata' : 'getStorage',
        requestId: ++storageRequestId,
      })
    } catch (_) {
      storagePendingUntil = 0
    }
  }
}

// CSS-hidden inspector frames do not necessarily change document visibility.
window.setInterval(() => {
  if (
    state.mode !== 'metadata' &&
    document.visibilityState !== 'hidden' &&
    !window.frameElement?.hidden
  )
    requestStorageSnapshot()
}, 1000)

function renderRaw(text) {
  const pre = document.createElement('pre')
  pre.className = 'raw-value'
  pre.textContent = text
  elements.treeView.replaceChildren(pre)
}

function normalizeStorageSnapshot(snapshot) {
  return {
    documentId: snapshot?.documentId || '',
    url: snapshot?.url || '',
    origin: snapshot?.origin || '',
    timestamp: snapshot?.timestamp || null,
    cookieError: snapshot?.cookieError || '',
    cookies: (snapshot?.cookies || []).map((cookie) => ({
      ...cookie,
      area: 'cookie',
      key: CookieStore.identity(cookie),
      id: `cookie:${CookieStore.identity(cookie)}`,
      expectedCookie: CookieStore.fingerprint(cookie),
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

function prepareStorageEntries(entries, area) {
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

function buildSearchText(values) {
  return normalizeSearchText(
    values
      .map((value) => String(value || '').slice(0, SEARCH_TEXT_LIMIT))
      .join('\n'),
  )
}

function normalizeSearchText(value) {
  return String(value || '').toLocaleLowerCase()
}

function parseMaybeJson(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed || !(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return { ok: false, value }
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (_) {
    return { ok: false, value }
  }
}

function renderPrimitiveStorage(value, key) {
  const row = document.createElement('div')
  row.className = 'tree-row'
  row.append(
    renderKey(key),
    document.createTextNode(': '),
    renderPrimitive(value),
  )
  return row
}

function compactValue(value) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 48 ? `${text.slice(0, 48)}...` : text
}

function renderMetadata() {
  if (state.mode !== 'metadata') return
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
      ? ['openGraph', 'Open Graph']
      : ['twitter', 'Twitter Card'],
  ]) {
    const heading = document.createElement('h2')
    heading.textContent = title
    nodes.push(heading)
    const entries = data[key] || []
    if (!entries.length) {
      nodes.push(emptyState('Not specified'))
      continue
    }
    const list = document.createElement('dl')
    for (const entry of entries) {
      const name = document.createElement('dt')
      name.textContent = entry.key
      const value = document.createElement('dd')
      value.textContent = entry.value || '(empty)'
      const imageUrl = metadataImageUrl(entry, data.baseUrl)
      if (imageUrl) {
        const image = document.createElement('img')
        image.className = 'metadata-image'
        image.alt = entry.key
        image.loading = 'lazy'
        image.referrerPolicy = 'no-referrer'
        image.addEventListener('error', () => {
          const error = document.createElement('span')
          error.className = 'metadata-image-error'
          error.textContent = 'Image unavailable'
          image.replaceWith(error)
        })
        image.src = imageUrl
        value.append(image)
      }
      list.append(name, value)
    }
    nodes.push(list)
  }
  elements.metadataView.replaceChildren(...nodes)
}

function metadataImageUrl(entry, baseUrl) {
  if (
    ![
      'og:image',
      'og:image:url',
      'og:image:secure_url',
      'twitter:image',
      'twitter:image:src',
    ].includes(entry.key.toLowerCase()) ||
    !entry.value.trim()
  )
    return null
  try {
    const url = new URL(entry.value, baseUrl)
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null
  } catch (_) {
    return null
  }
}
