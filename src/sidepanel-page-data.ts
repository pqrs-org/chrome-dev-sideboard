import { errorMessage } from './error-message.js'
import { ExtensionCookies } from './cookie-store.js'

const prefix = 'dev-sideboard:'
const getFrame = async (tabId: number, expectedDocumentId?: string) => {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 })
  if (!frame?.documentId) {
    throw new Error('Page unavailable. Reload the page.')
  }
  if (expectedDocumentId && frame.documentId !== expectedDocumentId) {
    throw new Error('The page changed. Refresh storage and edit it again.')
  }
  return frame
}

const readMetadata = async (tabId: number): Promise<MetadataSnapshot> => {
  try {
    const frame = await getFrame(tabId)
    const snapshot = await chrome.tabs.sendMessage<unknown, MetadataSnapshot>(
      tabId,
      { type: prefix + 'get-metadata' },
      { documentId: frame.documentId },
    )
    await getFrame(tabId, frame.documentId)
    return { ...snapshot, documentId: frame.documentId, pageUrl: frame.url }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

const readStorage = async (tabId: number): Promise<StorageSnapshot> => {
  try {
    const frame = await getFrame(tabId)
    const snapshot = await chrome.tabs.sendMessage<unknown, StorageSnapshot>(
      tabId,
      { type: prefix + 'get-storage' },
      { documentId: frame.documentId },
    )
    await getFrame(tabId, frame.documentId)
    return { ...snapshot, documentId: frame.documentId }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

const readCookies = async (tabId: number): Promise<StorageSnapshot> => {
  try {
    const snapshot = await ExtensionCookies.read(tabId)
    await getFrame(tabId, snapshot.documentId)
    return {
      ...snapshot,
      origin: new URL(snapshot.url).origin,
      timestamp: Date.now(),
    }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

const observeMetadataChanges = (onChange: (tabId: number) => void) => {
  const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== prefix + 'metadata-changed' ||
      sender.id !== chrome.runtime.id ||
      typeof sender.tab?.id !== 'number' ||
      sender.frameId !== 0 ||
      !sender.documentId
    ) {
      return
    }
    const tabId = sender.tab.id
    getFrame(tabId, sender.documentId)
      .then(() => onChange(tabId))
      .catch(() => {})
  }
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}

export const SidepanelPageData = {
  readMetadata,
  readStorage,
  readCookies,
  observeMetadataChanges,
}
