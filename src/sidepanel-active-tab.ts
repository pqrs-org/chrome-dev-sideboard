import { errorMessage } from './error-message.js'

export interface ActiveTabUpdate {
  tab?: chrome.tabs.Tab
  error?: string
  pageChanged: boolean
}

const listeners = new Set<(update: ActiveTabUpdate) => void>()
let started = false
let panelWindowId: number | undefined
let querySequence = 0
let pageChangePending = false
let latest: ActiveTabUpdate | undefined

const publish = (update: ActiveTabUpdate) => {
  latest = update
  for (const listener of listeners) {
    listener(update)
  }
}

const refresh = async (pageChanged = false) => {
  if (panelWindowId === undefined) {
    return
  }
  // Preserve navigation invalidation if a later title update supersedes its query.
  pageChangePending ||= pageChanged
  const sequence = ++querySequence
  let update: ActiveTabUpdate
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      windowId: panelWindowId,
    })
    if (sequence !== querySequence) {
      return
    }
    update = { tab, pageChanged: pageChangePending }
  } catch (error) {
    if (sequence !== querySequence) {
      return
    }
    update = { error: errorMessage(error), pageChanged: pageChangePending }
  }
  pageChangePending = false
  publish(update)
}

const start = () => {
  chrome.tabs.onActivated.addListener(({ windowId }) => {
    if (windowId === panelWindowId) {
      refresh()
    }
  })
  chrome.tabs.onUpdated.addListener((_tabId, changes, tab) => {
    if (
      tab.windowId === panelWindowId &&
      tab.active &&
      ('title' in changes || 'url' in changes || 'status' in changes)
    ) {
      refresh(Boolean(changes.url) || changes.status === 'complete')
    }
  })
  chrome.tabs.onRemoved.addListener((_tabId, { windowId }) => {
    if (windowId === panelWindowId) {
      refresh()
    }
  })
  chrome.tabs.onReplaced.addListener(() => refresh())
  chrome.windows
    .getCurrent()
    .then((window) => {
      panelWindowId = window.id
      return refresh()
    })
    .catch((error) =>
      publish({ error: errorMessage(error), pageChanged: false }),
    )
}

// One observer/query stream per panel, shared by Overview and the feature tabs.
// Chrome removes these API listeners when the side panel context is destroyed.
const observe = (listener: (update: ActiveTabUpdate) => void) => {
  listeners.add(listener)
  if (latest) {
    listener(latest)
  }
  if (!started) {
    started = true
    start()
  }
}

export const SidepanelActiveTab = { observe }
