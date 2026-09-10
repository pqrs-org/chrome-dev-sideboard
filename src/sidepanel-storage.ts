import { SidepanelState } from './sidepanel-state.js'
import { SidepanelJson } from './sidepanel-json.js'
import { ExtensionCookies } from './cookie-store.js'

const { panelState, editState, panelElements, FILTER_DEBOUNCE_MS } =
  SidepanelState

let renderPanel: () => void

const SEARCH_TEXT_LIMIT = 12000

let filterTimer = 0

const getStorageEntries = () => {
  return panelState.mode === 'cookies'
    ? panelState.storage.cookies || []
    : [...panelState.storage.local, ...panelState.storage.session]
}

const getSelectedStorageEntry = () => {
  return getStorageEntries().find(
    (entry) => entry.id === panelState.selectedStorageId,
  )
}

const getVisibleStorageEntries = () => {
  return getStorageEntries().filter((entry) => {
    if (!panelState.filter) {
      return true
    }

    return entry.searchText.includes(panelState.filter)
  })
}

const renderModeChrome = () => {
  if (
    editState.current &&
    (editState.current.tabId !== panelState.tabId ||
      editState.current.documentId !== panelState.storage.documentId)
  ) {
    editState.current = null
    panelElements.storageEditor.close()
  }
  const entry = getSelectedStorageEntry()
  panelElements.deleteStorageButton.disabled =
    !entry ||
    !panelState.storage.documentId ||
    Boolean(panelState.storage.error) ||
    Boolean(editState.current)
  panelElements.editStorageButton.disabled =
    Boolean(editState.current) ||
    !entry ||
    !panelState.storage.documentId ||
    Boolean(panelState.storage.error)
  panelElements.storageModeButton.classList.toggle(
    'active',
    panelState.mode === 'storage',
  )
  panelElements.cookiesModeButton.classList.toggle(
    'active',
    panelState.mode === 'cookies',
  )
  panelElements.rawButton.disabled = !entry
  SidepanelJson.renderTreeActionButtons()
}

const renderEmptyDetail = (
  title: string,
  message: string,
  emptyText: string,
) => {
  panelElements.detailTitle.textContent = title
  panelElements.detailTitle.title = ''
  panelElements.detailMeta.textContent = message
  panelElements.treeView.replaceChildren(SidepanelJson.emptyState(emptyText))
  panelElements.rawButton.disabled = true
  SidepanelJson.renderTreeActionButtons()
}

const renderList = () => {
  const entries = getVisibleStorageEntries()
  const total = getStorageEntries().length
  panelElements.countLabel.textContent = `${entries.length} of ${total} ${panelState.mode === 'cookies' ? 'cookies' : 'storage items'}`
  panelElements.entryList.replaceChildren(...entries.map(renderStorageItem))
  panelElements.entryList.setAttribute(
    'aria-label',
    panelState.mode === 'cookies' ? 'Cookies' : 'Storage entries',
  )
  const selectedIndex = entries.findIndex(
    (entry) => entry.id === panelState.selectedStorageId,
  )
  panelElements.entryList.setAttribute(
    'aria-activedescendant',
    selectedIndex < 0 ? '' : `storage-entry-${selectedIndex}`,
  )
}

const renderStorageItem = (entry: DisplayStorageEntry, index: number) => {
  const item = document.createElement('li')
  item.id = `storage-entry-${index}`
  item.setAttribute('role', 'option')
  item.setAttribute(
    'aria-selected',
    String(entry.id === panelState.selectedStorageId),
  )
  item.className = `entry-item${entry.id === panelState.selectedStorageId ? ' selected' : ''}`
  item.addEventListener('click', () => {
    if (editState.current) {
      return
    }
    panelElements.entryList.focus({ preventScroll: true })
    if (panelState.selectedStorageId === entry.id) {
      return
    }

    panelState.selectedStorageId = entry.id
    renderPanel()
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
  panelElements.rawButton.textContent = panelState.rawView ? 'Tree' : 'Raw'
  panelElements.rawButton.setAttribute(
    'aria-pressed',
    String(panelState.rawView),
  )
  panelElements.rawButton.classList.toggle('active', panelState.rawView)
  panelElements.jsonFilterInput.disabled = panelState.rawView
  const entry = getSelectedStorageEntry()
  if (panelState.storage.error) {
    renderEmptyDetail(
      'Storage unavailable',
      panelState.storage.error,
      'Storage cannot be read on this page.',
    )
    return
  }

  if (!entry) {
    renderEmptyDetail(
      panelState.mode === 'cookies'
        ? 'No cookie selected'
        : 'No storage item selected',
      panelState.storage.origin || 'Select a normal page tab to view storage.',
      panelState.mode === 'cookies'
        ? panelState.storage.cookieError || 'No cookies for this page.'
        : 'No Local Storage or Session Storage items.',
    )
    return
  }

  const parsed = SidepanelJson.parseMaybeJson(entry.value)
  panelElements.detailTitle.textContent =
    entry.area === 'cookie'
      ? `Cookie: ${entry.name}`
      : `${entry.area === 'local' ? 'Local Storage' : 'Session Storage'}: ${entry.key}`
  panelElements.detailTitle.title = entry.key
  panelElements.detailMeta.textContent = [
    panelState.storage.origin || panelState.storage.url,
    panelState.storage.timestamp
      ? new Date(panelState.storage.timestamp).toLocaleTimeString()
      : '',
  ]
    .filter(Boolean)
    .join(' · ')

  if (entry.area === 'cookie') {
    panelElements.detailMeta.textContent += ` · ${entry.domain}${entry.path} · ${entry.hostOnly ? 'Host-only' : 'Domain'} · ${entry.secure ? 'Secure' : 'Not Secure'} · ${entry.httpOnly ? 'HttpOnly' : 'Not HttpOnly'} · SameSite: ${entry.sameSite} · ${entry.session ? 'Session' : new Date((entry.expirationDate ?? 0) * 1000).toLocaleString()}${entry.partitionKey ? ` · Partition: ${entry.partitionKey.topLevelSite}` : ''}`
  }
  if (panelState.rawView) {
    SidepanelJson.renderRaw(entry.value)
  } else if (parsed.ok) {
    SidepanelJson.renderFilteredJson(
      parsed.value,
      entry.area === 'cookie' ? entry.name : entry.key,
    )
  } else {
    panelElements.treeView.replaceChildren(
      SidepanelJson.renderPrimitiveStorage(
        entry.value,
        entry.area === 'cookie' ? entry.name : entry.key,
      ),
    )
  }
  panelElements.rawButton.disabled = false
  SidepanelJson.renderTreeActionButtons()
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
  return SidepanelJson.normalizeSearchText(
    values
      .map((value) => String(value || '').slice(0, SEARCH_TEXT_LIMIT))
      .join('\n'),
  )
}

const compactValue = (value: unknown) => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 48 ? `${text.slice(0, 48)}...` : text
}

const applyStorageSnapshot = (snapshot: StorageSnapshot) => {
  if (editState.current) {
    return
  }
  const nextStorage = normalizeStorageSnapshot(snapshot)
  const { timestamp: _oldTime, ...oldValues } = panelState.storage
  const { timestamp: _newTime, ...newValues } = nextStorage
  if (JSON.stringify(oldValues) === JSON.stringify(newValues)) {
    return
  }
  panelState.storage = nextStorage
  if (
    !getStorageEntries().some(
      (entry) => entry.id === panelState.selectedStorageId,
    )
  ) {
    panelState.selectedStorageId = getStorageEntries().at(0)?.id || null
  }
  renderPanel()
}

const initializeStorageList = (onChange: () => void) => {
  renderPanel = onChange
  panelElements.entryList.addEventListener('keydown', (event) => {
    if (
      editState.current ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
    ) {
      return
    }
    event.preventDefault()
    const entries = getVisibleStorageEntries()
    if (!entries.length) {
      return
    }
    const current = entries.findIndex(
      (entry) => entry.id === panelState.selectedStorageId,
    )
    const next =
      current < 0
        ? event.key === 'ArrowDown'
          ? 0
          : entries.length - 1
        : Math.max(
            0,
            Math.min(
              entries.length - 1,
              current + (event.key === 'ArrowDown' ? 1 : -1),
            ),
          )
    if (current !== next) {
      panelState.selectedStorageId = entries[next].id
      renderPanel()
    }
    panelElements.entryList
      .querySelector('.selected')
      ?.scrollIntoView({ block: 'nearest' })
  })
  panelElements.filterInput.addEventListener('input', () => {
    window.clearTimeout(filterTimer)
    filterTimer = window.setTimeout(() => {
      panelState.filter = SidepanelJson.normalizeSearchText(
        panelElements.filterInput.value.trim(),
      )
      renderPanel()
    }, FILTER_DEBOUNCE_MS)
  })
}

export const SidepanelStorage = {
  normalizeStorageSnapshot,
  renderDetail,
  getSelectedStorageEntry,
  getStorageEntries,
  renderModeChrome,
  applyStorageSnapshot,
  renderList,
  initializeStorageList,
}
