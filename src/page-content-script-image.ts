import { errorMessage } from './error-message.js'
import { fetchImageBlob, IMAGE_TIMEOUT_MS } from './image-fetch.js'

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dev-sideboard:image') {
    return
  }
  if (
    port.sender?.id !== chrome.runtime.id ||
    port.sender.url !== chrome.runtime.getURL('src/sidepanel.html')
  ) {
    port.disconnect()
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
  let connected = true
  let started = false
  port.onDisconnect.addListener(() => {
    connected = false
    clearTimeout(timer)
    controller.abort()
  })
  port.onMessage.addListener((message: { url?: unknown; cache?: unknown }) => {
    if (started) {
      return
    }
    started = true
    const read = async (): Promise<ImageReply> => {
      try {
        if (
          typeof message?.url !== 'string' ||
          (message.cache !== undefined && message.cache !== 'no-cache')
        ) {
          throw new Error('Invalid image request')
        }
        const url = new URL(message.url)
        if (url.origin !== location.origin) {
          throw new Error('Image must have the same origin as the page')
        }
        // Keep this endpoint limited to the inspected page's origin.
        // Refuse redirects and omit credentials, including cookies.
        const blob = await fetchImageBlob(url.href, {
          mode: 'same-origin',
          redirect: 'error',
          cache: message.cache,
          signal: controller.signal,
        })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 8192),
          )
        }
        // Chrome extension messaging uses JSON serialization; encode bytes to
        // base64 rather than exposing a page Blob URL or using window.postMessage.
        return { ok: true, type: blob.type, data: btoa(binary) }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      } finally {
        clearTimeout(timer)
        controller.abort()
      }
    }
    void read().then((reply) => {
      if (connected) {
        try {
          port.postMessage(reply)
        } catch {
          // The panel may have closed before Chrome delivered onDisconnect.
        }
      }
    })
  })
})
