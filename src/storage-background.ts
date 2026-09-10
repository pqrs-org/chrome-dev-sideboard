import { ExtensionCookies } from './cookie-store.js'

;(() => {
  const prefix = 'dev-sideboard:'
  const ports = new Set<PanelClient>()
  const post = (port: chrome.runtime.Port, message: PanelMessage) => {
    try {
      port.postMessage(message)
    } catch {}
  }
  const storageSnapshot = async (
    tabId: number,
    frame: chrome.webNavigation.GetFrameResultDetails,
  ) => {
    const snapshot = await chrome.tabs.sendMessage<unknown, StorageSnapshot>(
      tabId,
      { type: prefix + 'get-storage' },
      { documentId: frame.documentId },
    )
    try {
      const cookies = await ExtensionCookies.read(tabId)
      if (cookies.documentId !== frame.documentId) {
        throw new Error('Page changed. Refresh again.')
      }
      return { ...snapshot, cookies: cookies.cookies }
    } catch (error) {
      return {
        ...snapshot,
        cookies: [],
        cookieError:
          error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : String(error),
      }
    }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      message?.type !== prefix + 'metadata-changed' ||
      sender.id !== chrome.runtime.id ||
      typeof sender.tab?.id !== 'number' ||
      sender.frameId !== 0 ||
      !sender.documentId
    ) {
      return
    }
    const senderTabId = sender.tab.id
    chrome.webNavigation
      .getFrame({ tabId: senderTabId, frameId: 0 })
      .then((frame) => {
        if (frame?.documentId !== sender.documentId) {
          return
        }
        for (const client of ports) {
          if (client.tabId === senderTabId) {
            post(client.port, { type: 'metadataChanged', tabId: senderTabId })
          }
        }
      })
      .catch(() => {})
  })
  chrome.runtime.onConnect.addListener((port) => {
    if (
      port.name !== prefix + 'panel' ||
      port.sender?.tab ||
      port.sender?.id !== chrome.runtime.id ||
      port.sender?.url !== chrome.runtime.getURL('src/sidepanel.html')
    ) {
      return
    }
    const client: PanelClient = { port, tabId: null, version: 0 }
    ports.add(client)
    port.onDisconnect.addListener(() => {
      ports.delete(client)
      client.version++
    })
    port.onMessage.addListener((message: PanelRequest) => {
      if (message?.type === 'init' && Number.isInteger(message.tabId)) {
        client.tabId = message.tabId
        client.version++
      } else if (
        (message?.type === 'getStorage' || message?.type === 'getMetadata') &&
        typeof client.tabId === 'number'
      ) {
        const tabId = client.tabId
        const version = client.version
        const metadata = message.type === 'getMetadata'
        chrome.webNavigation
          .getFrame({ tabId, frameId: 0 })
          .then(async (frame) => {
            if (!frame?.documentId) {
              throw new Error('Page unavailable. Reload the page.')
            }
            const snapshot = metadata
              ? await chrome.tabs.sendMessage<unknown, MetadataSnapshot>(
                  tabId,
                  { type: prefix + 'get-metadata' },
                  { documentId: frame.documentId },
                )
              : await storageSnapshot(tabId, frame)
            if (ports.has(client) && version === client.version) {
              post(port, {
                type: metadata ? 'metadataSnapshot' : 'storageSnapshot',
                requestId: message.requestId,
                tabId,
                snapshot: { ...snapshot, documentId: frame.documentId },
              })
            }
          })
          .catch((error) => {
            if (ports.has(client) && version === client.version) {
              post(port, {
                type: metadata ? 'metadataSnapshot' : 'storageSnapshot',
                requestId: message.requestId,
                tabId,
                snapshot: {
                  error:
                    error && typeof error === 'object' && 'message' in error
                      ? String(error.message)
                      : String(error),
                },
              })
            }
          })
      } else if (
        (message?.type === 'setStorage' || message?.type === 'deleteStorage') &&
        typeof client.tabId === 'number'
      ) {
        const tabId = client.tabId
        const version = client.version
        chrome.webNavigation
          .getFrame({ tabId, frameId: 0 })
          .then(async (frame) => {
            if (
              !message.documentId ||
              frame?.documentId !== message.documentId
            ) {
              throw new Error(
                'The page changed. Refresh storage and edit it again.',
              )
            }
            let result: StorageResult
            if (message.area === 'cookie') {
              await ExtensionCookies.write(
                tabId,
                message,
                message.type === 'deleteStorage',
              )
              result = {
                ok: true,
                snapshot: await storageSnapshot(tabId, frame),
              }
            } else {
              result = await chrome.tabs.sendMessage<unknown, StorageResult>(
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
            }
            if (ports.has(client) && version === client.version) {
              post(port, {
                type: 'storageSaved',
                tabId,
                requestId: message.requestId,
                ...result,
                snapshot: result.snapshot
                  ? { ...result.snapshot, documentId: message.documentId }
                  : undefined,
              })
            }
          })
          .catch((error) => {
            if (ports.has(client) && version === client.version) {
              post(port, {
                type: 'storageSaved',
                tabId,
                requestId: message.requestId,
                ok: false,
                error:
                  error && typeof error === 'object' && 'message' in error
                    ? String(error.message)
                    : String(error),
              })
            }
          })
      }
    })
  })
})()
