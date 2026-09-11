import { SidepanelActiveTab } from './sidepanel-active-tab.js'
import { errorMessage } from './error-message.js'
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
      networkFields.networkScope.textContent = errorMessage(error)
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

SidepanelActiveTab.observe(({ tab, error }) => {
  if (error !== undefined) {
    titleElement.textContent = 'Page information unavailable'
    statusElement.textContent = error
    statusElement.classList.add('error')
  } else {
    titleElement.textContent = tab
      ? tab.title ||
        (tab.url ? 'Untitled page' : 'Page information unavailable')
      : 'No active tab'
    statusElement.textContent = ''
    statusElement.classList.remove('error')
  }
  refreshNetwork(tab)
})
