;(() => {
  'use strict'
  const prefix = 'dev-sideboard:'
  const ports = new Set()
  const post = (port, message) => {
    try {
      port.postMessage(message)
    } catch (_) {}
  }
  const storageSnapshot = async (tabId, frame) => {
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
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      message?.type !== prefix + 'metadata-changed' ||
      sender.id !== chrome.runtime.id ||
      !sender.tab ||
      sender.frameId !== 0 ||
      !sender.documentId
    )
      return
    chrome.webNavigation
      .getFrame({ tabId: sender.tab.id, frameId: 0 })
      .then((frame) => {
        if (frame?.documentId !== sender.documentId) return
        for (const client of ports) {
          if (client.tabId === sender.tab.id)
            post(client.port, { type: 'metadataChanged', tabId: sender.tab.id })
        }
      })
      .catch(() => {})
  })
  chrome.runtime.onConnect.addListener((port) => {
    if (
      port.name !== prefix + 'panel' ||
      port.sender?.tab ||
      port.sender?.id !== chrome.runtime.id ||
      port.sender?.url !== chrome.runtime.getURL('src/inspector.html')
    )
      return
    const client = { port, tabId: null, version: 0 }
    ports.add(client)
    port.onDisconnect.addListener(() => {
      ports.delete(client)
      client.version++
    })
    port.onMessage.addListener((message) => {
      if (message?.type === 'init' && Number.isInteger(message.tabId)) {
        client.tabId = message.tabId
        client.version++
      } else if (
        ['getStorage', 'getMetadata'].includes(message?.type) &&
        Number.isInteger(client.tabId)
      ) {
        const tabId = client.tabId
        const version = client.version
        const metadata = message.type === 'getMetadata'
        chrome.webNavigation
          .getFrame({ tabId, frameId: 0 })
          .then(async (frame) => {
            if (!frame?.documentId)
              throw new Error('Page unavailable. Reload the page.')
            const snapshot = metadata
              ? await chrome.tabs.sendMessage(
                  tabId,
                  { type: prefix + 'get-metadata' },
                  { documentId: frame.documentId },
                )
              : await storageSnapshot(tabId, frame)
            if (ports.has(client) && version === client.version)
              post(port, {
                type: metadata ? 'metadataSnapshot' : 'storageSnapshot',
                requestId: message.requestId,
                tabId,
                snapshot: { ...snapshot, documentId: frame.documentId },
              })
          })
          .catch((error) => {
            if (ports.has(client) && version === client.version)
              post(port, {
                type: metadata ? 'metadataSnapshot' : 'storageSnapshot',
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
})()
