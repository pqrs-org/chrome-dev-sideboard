;(() => {
  'use strict'
  const prefix = 'json-fetch-visualizer:'
  const keyFor = (tabId) => `captures:${tabId}`
  const queues = new Map()
  const ports = new Set()
  function queue(tabId, action) {
    const next = (queues.get(tabId) || Promise.resolve())
      .then(action)
      .catch(console.error)
      .finally(() => {
        if (queues.get(tabId) === next) queues.delete(tabId)
      })
    queues.set(tabId, next)
  }
  function post(port, message) {
    try {
      port.postMessage(message)
    } catch (_) {}
  }
  function broadcast(tabId, records) {
    for (const client of ports)
      if (client.tabId === tabId)
        post(client.port, { type: 'snapshot', tabId, records })
  }
  async function read(tabId) {
    const key = keyFor(tabId)
    return (await chrome.storage.session.get(key))[key]
  }
  function cleanUrl(value) {
    try {
      const url = new URL(value)
      url.username = ''
      url.password = ''
      url.hash = ''
      return url.href
    } catch (_) {
      return ''
    }
  }
  function cleanRecord(payload, sender) {
    const raw = typeof payload.raw === 'string' ? payload.raw : ''
    const truncated = Boolean(payload.truncated) || raw.length > 100000
    return {
      id: `${sender.documentId}:${String(payload.id).slice(0, 100)}`,
      tabId: sender.tab.id,
      frameId: sender.frameId,
      url: cleanUrl(payload.url),
      method: String(payload.method || 'GET').slice(0, 32),
      transport: payload.transport === 'xhr' ? 'xhr' : 'fetch',
      status: Number(payload.status) || 0,
      statusText: String(payload.statusText || '').slice(0, 200),
      ok: Boolean(payload.ok),
      durationMs: Math.max(0, Number(payload.durationMs) || 0),
      timestamp: Number(payload.timestamp) || Date.now(),
      raw: raw.slice(0, 100000),
      truncated,
      parseError: truncated
        ? 'Payload truncated for session history.'
        : String(payload.parseError || '').slice(0, 300),
    }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      ![prefix + 'record', prefix + 'reset'].includes(message?.type) ||
      !Number.isInteger(sender.tab?.id) ||
      !sender.documentId ||
      !message.payload
    )
      return
    const tabId = sender.tab.id
    queue(tabId, async () => {
      // Check Chrome's document identities, not identities supplied by page scripts.
      const [top, frame] = await Promise.all([
        chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
        chrome.webNavigation.getFrame({ tabId, frameId: sender.frameId }),
      ])
      if (!top || frame?.documentId !== sender.documentId) return
      let state = await read(tabId)
      if (state?.documentId !== top.documentId)
        state = { documentId: top.documentId, records: [] }
      if (message.type === prefix + 'record') {
        state.records.push(cleanRecord(message.payload, sender))
        state.records = state.records.slice(-80)
        let size = state.records.reduce(
          (total, record) => total + JSON.stringify(record).length,
          0,
        )
        while (size > 512000 && state.records.length)
          size -= JSON.stringify(state.records.shift()).length
      }
      await chrome.storage.session.set({ [keyFor(tabId)]: state })
      broadcast(tabId, state.records)
    })
  })
  async function storageSnapshot(tabId, frame) {
    const snapshot = await chrome.tabs.sendMessage(
      tabId,
      { type: prefix + 'get-storage' },
      { documentId: frame.documentId },
    )
    try {
      const cookies = await CookieStore.read(tabId)
      if (cookies.documentId !== frame.documentId)
        throw new Error('Page changed. Refresh again.')
      return { ...snapshot, cookies: cookies.cookies }
    } catch (error) {
      return { ...snapshot, cookies: [], cookieError: error.message }
    }
  }
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== prefix + 'panel' || port.sender?.tab) return
    const client = { port, tabId: null, version: 0 }
    ports.add(client)
    port.onDisconnect.addListener(() => {
      ports.delete(client)
      client.version++
    })
    port.onMessage.addListener((message) => {
      if (message?.type === 'init' && Number.isInteger(message.tabId)) {
        client.tabId = message.tabId
        const version = ++client.version
        queue(client.tabId, async () => {
          const state = await read(message.tabId)
          if (ports.has(client) && client.version === version)
            post(port, {
              type: 'snapshot',
              tabId: message.tabId,
              records: state?.records || [],
            })
        })
      } else if (
        message?.type === 'getStorage' &&
        Number.isInteger(client.tabId)
      ) {
        const tabId = client.tabId
        const version = client.version
        chrome.webNavigation
          .getFrame({ tabId, frameId: 0 })
          .then(async (frame) => {
            if (!frame?.documentId)
              throw new Error('Page unavailable. Reload the page.')
            const snapshot = await storageSnapshot(tabId, frame)
            if (ports.has(client) && version === client.version)
              post(port, {
                type: 'storageSnapshot',
                requestId: message.requestId,
                tabId,
                snapshot: { ...snapshot, documentId: frame.documentId },
              })
          })
          .catch((error) => {
            if (ports.has(client) && version === client.version)
              post(port, {
                type: 'storageSnapshot',
                requestId: message.requestId,
                tabId,
                snapshot: { error: error.message },
              })
          })
      } else if (
        ['setStorage', 'deleteStorage'].includes(message?.type) &&
        Number.isInteger(client.tabId)
      ) {
        const tabId = client.tabId
        const version = client.version
        chrome.webNavigation
          .getFrame({ tabId, frameId: 0 })
          .then(async (frame) => {
            if (!message.documentId || frame?.documentId !== message.documentId)
              throw new Error(
                'The page changed. Refresh storage and edit it again.',
              )
            let result
            if (message.area === 'cookie') {
              await CookieStore.write(
                tabId,
                message,
                message.type === 'deleteStorage',
              )
              result = {
                ok: true,
                snapshot: await storageSnapshot(tabId, frame),
              }
            } else
              result = await chrome.tabs.sendMessage(
                tabId,
                {
                  type:
                    prefix +
                    (message.type === 'deleteStorage'
                      ? 'delete-storage'
                      : 'set-storage'),
                  area: message.area,
                  key: message.key,
                  value: message.value,
                  expectedValue: message.expectedValue,
                },
                { documentId: message.documentId },
              )
            if (ports.has(client) && version === client.version)
              post(port, {
                type: 'storageSaved',
                tabId,
                requestId: message.requestId,
                ...result,
                snapshot: result.snapshot
                  ? { ...result.snapshot, documentId: message.documentId }
                  : undefined,
              })
          })
          .catch((error) => {
            if (ports.has(client) && version === client.version)
              post(port, {
                type: 'storageSaved',
                tabId,
                requestId: message.requestId,
                ok: false,
                error: error.message,
              })
          })
      }
    })
  })
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return
    queue(details.tabId, async () => {
      const state = await read(details.tabId)
      if (state?.documentId === details.documentId) return
      await chrome.storage.session.remove(keyFor(details.tabId))
      broadcast(details.tabId, [])
    })
  })
  function remove(tabId) {
    queue(tabId, async () => {
      await chrome.storage.session.remove(keyFor(tabId))
      broadcast(tabId, [])
    })
  }
  chrome.tabs.onRemoved.addListener(remove)
  chrome.tabs.onReplaced.addListener((added, removed) => {
    remove(added)
    remove(removed)
  })
})()
