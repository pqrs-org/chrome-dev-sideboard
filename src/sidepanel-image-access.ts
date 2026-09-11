import { MAX_IMAGE_BYTES } from './image-fetch.js'

// Pin the request to the inspected document. Disconnecting cancels its fetch;
// image bytes travel only through the extension port, never through window/DOM.
export const readPageImage = (
  page: ImagePage,
  url: string,
  cache: RequestCache | undefined,
  signal: AbortSignal,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const port = chrome.tabs.connect(page.tabId, {
      name: 'dev-sideboard:image',
      documentId: page.documentId,
    })
    let settled = false
    const finish = (blob?: Blob, error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', abort)
      port.onDisconnect.removeListener(disconnected)
      port.onMessage.removeListener(received)
      port.disconnect()
      if (blob) {
        resolve(blob)
      } else {
        reject(error)
      }
    }
    const abort = () => finish(undefined, new Error('Image request cancelled'))
    const disconnected = () =>
      finish(
        undefined,
        new Error(
          chrome.runtime.lastError?.message ||
            'Page changed or image request disconnected',
        ),
      )
    const received = (message: ImageReply) => {
      try {
        if (!message?.ok) {
          throw new Error(message?.error || 'Image request failed')
        }
        if (
          typeof message.data !== 'string' ||
          typeof message.type !== 'string' ||
          message.data.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)
        ) {
          throw new Error('Invalid image response')
        }
        const bytes = Uint8Array.from(atob(message.data), (character) =>
          character.charCodeAt(0),
        )
        if (bytes.length > MAX_IMAGE_BYTES) {
          throw new Error('Image is too large')
        }
        finish(new Blob([bytes], { type: message.type }))
      } catch (error) {
        finish(
          undefined,
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    }
    port.onDisconnect.addListener(disconnected)
    port.onMessage.addListener(received)
    signal.addEventListener('abort', abort, { once: true })
    try {
      port.postMessage({ url, cache })
    } catch (error) {
      finish(
        undefined,
        error instanceof Error ? error : new Error(String(error)),
      )
    }
  })
