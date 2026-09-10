import { PageNetworkStats } from './network-stats.js'

const titleElement = document.querySelector<HTMLElement>('#pageTitle')!
const statusElement = document.querySelector<HTMLElement>('#status')!
const networkFields = Object.fromEntries(
  [
    'requests',
    'pending',
    'httpErrors',
    'networkErrors',
    'averageDuration',
    'maxDuration',
    'responseSize',
    'unknownSizes',
    'cached',
    'networkScope',
  ].map((id) => [id, document.querySelector<HTMLElement>(`#${id}`)!]),
)
let currentTabId: number | undefined
let networkAvailable = false
let networkVersion = 0

const failureDialog =
  document.querySelector<HTMLDialogElement>('#failureDialog')!
const failureTitle = document.querySelector<HTMLElement>('#failureTitle')!
const failureSummary = document.querySelector<HTMLElement>('#failureSummary')!
const failureList = document.querySelector<HTMLElement>('#failureList')!
let displayedState: NetworkState | null | undefined
let failureKind: FailureDetail['kind'] = 'httpErrors'

const renderFailures = () => {
  const items = (displayedState?.failureDetails || [])
    .filter((item) => item.kind === failureKind)
    .reverse()
  failureTitle.textContent =
    failureKind === 'httpErrors' ? 'HTTP errors' : 'Request failures'
  failureSummary.textContent = `${items.length} of ${displayedState?.[failureKind] || 0} shown. Latest 100 failures retained across both categories.`
  failureList.textContent = items.length
    ? items
        .map(
          (item) =>
            `${new Date(item.timeStamp).toLocaleTimeString()} · ${item.method} · ${item.reason}\n${item.url}`,
        )
        .join('\n\n')
    : 'No details available. Reload the page to record new failures.'
}

for (const kind of ['httpErrors', 'networkErrors'] as const) {
  networkFields[kind].addEventListener('click', () => {
    failureKind = kind
    renderFailures()
    failureDialog.showModal()
  })
}
document
  .querySelector<HTMLButtonElement>('#closeFailures')!
  .addEventListener('click', () => failureDialog.close())

const renderNetwork = (state: NetworkState | null | undefined) => {
  if (
    !state ||
    (displayedState && displayedState.startedAt !== state.startedAt)
  ) {
    failureDialog.close()
  }
  displayedState = state
  for (const kind of ['httpErrors', 'networkErrors'] as const) {
    ;(networkFields[kind] as HTMLButtonElement).disabled = !state?.[kind]
  }
  if (failureDialog.open) {
    renderFailures()
  }
  const values = {
    requests: state?.requests ?? '—',
    pending: state ? Object.keys(state.pending).length : '—',
    httpErrors: state?.httpErrors ?? '—',
    networkErrors: state?.networkErrors ?? '—',
    averageDuration: state?.durationCount
      ? `${Math.round(state.durationTotal / state.durationCount)} ms`
      : '—',
    maxDuration: state?.durationCount
      ? `${Math.round(state.durationMax)} ms`
      : '—',
    responseSize: state?.knownSizes
      ? PageNetworkStats.formatBytes(state.knownBytes)
      : '—',
    unknownSizes: state?.unknownSizes ?? '—',
    cached: state?.cached ?? '—',
    networkScope: !state
      ? 'Reload the page to measure requests.'
      : `${state.scope === 'navigation' ? 'Since navigation' : 'Partial observation'} · ${new Date(state.startedAt).toLocaleTimeString()} · ${state.completed} completed` +
        (state.omitted
          ? ` · ${state.omitted} requests omitted from detailed measurement`
          : ''),
  }
  for (const [key, value] of Object.entries(values)) {
    networkFields[key].textContent = String(value)
  }
}

const refreshNetwork = async (tab: chrome.tabs.Tab | undefined) => {
  currentTabId = tab?.id
  const version = ++networkVersion
  renderNetwork(null)
  networkAvailable =
    Number.isInteger(currentTabId) && /^https?:/.test(tab?.url || '')
  if (!networkAvailable || currentTabId === undefined) {
    networkFields.networkScope.textContent =
      'Network measurements are unavailable on this page.'
    return
  }
  const key = PageNetworkStats.keyForTab(currentTabId)
  try {
    const stored =
      await chrome.storage.session.get<Record<string, NetworkState>>(key)
    if (version === networkVersion) {
      renderNetwork(stored[key])
    }
  } catch (error) {
    if (version === networkVersion) {
      networkFields.networkScope.textContent = String(
        (error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error)) || error,
      )
    }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !networkAvailable || currentTabId === undefined) {
    return
  }
  const key = PageNetworkStats.keyForTab(currentTabId)
  if (key in changes) {
    networkVersion++
    renderNetwork(changes[key].newValue as NetworkState | undefined)
  }
})

let panelWindowId: number | undefined
let refreshVersion = 0

const refreshPage = async () => {
  if (panelWindowId === undefined) {
    return
  }
  const version = ++refreshVersion
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      windowId: panelWindowId,
    })
    if (version !== refreshVersion) {
      return
    }
    titleElement.textContent = tab
      ? tab.title ||
        (tab.url ? 'Untitled page' : 'Page information unavailable')
      : 'No active tab'
    statusElement.textContent = ''
    refreshNetwork(tab)
  } catch (error) {
    if (version !== refreshVersion) {
      return
    }
    titleElement.textContent = 'Page information unavailable'
    refreshNetwork(undefined)
    statusElement.textContent = String(
      (error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error)) || error,
    )
    statusElement.classList.add('error')
  }
}

chrome.tabs.onActivated.addListener(({ windowId }) => {
  if (windowId === panelWindowId) {
    refreshPage()
  }
})

chrome.tabs.onUpdated.addListener((_tabId, changes, tab) => {
  if (
    tab.windowId === panelWindowId &&
    tab.active &&
    ('title' in changes || 'url' in changes || 'status' in changes)
  ) {
    refreshPage()
  }
})

chrome.tabs.onRemoved.addListener((_tabId, { windowId }) => {
  if (windowId === panelWindowId) {
    refreshPage()
  }
})

chrome.tabs.onReplaced.addListener(() => refreshPage())

chrome.windows
  .getCurrent()
  .then((window) => {
    panelWindowId = window.id
    return refreshPage()
  })
  .catch((error) => {
    titleElement.textContent = 'Page information unavailable'
    refreshNetwork(undefined)
    statusElement.textContent = String(
      (error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error)) || error,
    )
    statusElement.classList.add('error')
  })
