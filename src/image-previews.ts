import { errorMessage } from './error-message.js'
// Only this loader accesses remote preview images. The UI receives Blob URLs.
export const ImagePreviews = (() => {
  const MAX_IMAGES = 6
  const MAX_BYTES = 5 * 1024 * 1024
  const TIMEOUT_MS = 8000
  const createBatch = () => {
    let disposed = false
    let count = 0
    let active = 0
    const queue: ImageJob[] = []
    const controllers = new Set<AbortController>()
    const urls = new Set<string>()
    const run = async (job: ImageJob) => {
      const controller = new AbortController()
      controllers.add(controller)
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const parsed = new URL(job.url)
        if (
          parsed.protocol !== 'https:' ||
          parsed.username ||
          parsed.password
        ) {
          throw new Error('HTTPS image URL required')
        }
        // Page-controlled image URLs are untrusted. With broad host permissions,
        // an extension can make requests that ordinary pages cannot, including
        // requests carrying SameSite cookies. Do not turn previews into a way to
        // invoke authenticated endpoints or access local-network services.
        // Public hosts still receive the requested URL and the user's IP address.
        const response = await fetch(parsed.href, {
          // Omit browser credentials and ignore Set-Cookie responses, preventing
          // previews from using or changing the user's authenticated session.
          credentials: 'omit',
          // Manual refresh revalidates cached images; ordinary loads use defaults.
          cache: job.cache,
          // Let Chrome check the resolved address space, not just the URL text:
          // a public-looking hostname can resolve to a private or loopback IP.
          // Requires the minimum Chrome version declared in manifest.json (142).
          targetAddressSpace: 'public',
          // Bound slow responses and cancel requests when the view is discarded.
          // The streamed byte limit below also bounds oversized response bodies.
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('Image request failed')
        }
        // Preserve the response MIME type for decoding (notably SVG), but let
        // Chrome's <img> decoder decide whether the bytes are a supported image.
        // These Blob URLs must only be embedded as images, never as documents
        // or inline markup; image decoding failures are handled by the UI.
        const type = (response.headers.get('content-type') || '')
          .split(';')[0]
          .trim()
          .toLowerCase()
        if (Number(response.headers.get('content-length')) > MAX_BYTES) {
          throw new Error('Image is too large')
        }
        if (!response.body) {
          throw new Error('Empty image response')
        }
        const reader = response.body.getReader()
        const chunks = []
        let size = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }
            size += value.byteLength
            if (size > MAX_BYTES) {
              throw new Error('Image is too large')
            }
            chunks.push(value)
          }
        } finally {
          reader.releaseLock()
        }
        if (disposed || controller.signal.aborted) {
          return
        }
        const url = URL.createObjectURL(new Blob(chunks, { type }))
        urls.add(url)
        job.objectUrl = url
        job.ready(url)
      } catch (error) {
        if (!disposed) {
          job.failed(
            controller.signal.aborted
              ? 'Image request timed out'
              : errorMessage(error),
          )
        }
      } finally {
        clearTimeout(timer)
        controller.abort()
        controllers.delete(controller)
        active--
        pump()
      }
    }
    const pump = () => {
      while (!disposed && active < 2 && queue.length) {
        active++
        const job = queue.shift()
        if (job) {
          void run(job)
        }
      }
    }
    return {
      load(
        url: string,
        ready: (url: string) => void,
        failed: (message: string) => void,
      ) {
        if (disposed) {
          return
        }
        if (count++ >= MAX_IMAGES) {
          failed('Preview limit reached (6 images)')
          return
        }
        const job: ImageJob = { url, ready, failed }
        queue.push(job)
        pump()
        // Reuse the admitted image slot, releasing its old Blob on each retry.
        // The UI disables reload while a request or image decode is pending.
        return () => {
          if (disposed) {
            return
          }
          if (job.objectUrl) {
            URL.revokeObjectURL(job.objectUrl)
            urls.delete(job.objectUrl)
            job.objectUrl = undefined
          }
          job.cache = 'no-cache'
          queue.push(job)
          pump()
        }
      },
      dispose() {
        disposed = true
        queue.length = 0
        for (const controller of controllers) {
          controller.abort()
        }
        for (const url of urls) {
          URL.revokeObjectURL(url)
        }
        urls.clear()
      },
    }
  }
  return { createBatch }
})()
