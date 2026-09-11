import { errorMessage } from './error-message.js'
import { fetchImageBlob, IMAGE_TIMEOUT_MS } from './image-fetch.js'
import { readPageImage } from './sidepanel-image-access.js'
// The UI only receives revocable Blob URLs, never page-provided image markup.
export const ImagePreviews = (() => {
  const MAX_IMAGES = 6
  const createBatch = (page?: ImagePage) => {
    let disposed = false
    let count = 0
    let active = 0
    const queue: ImageJob[] = []
    const controllers = new Set<AbortController>()
    const urls = new Set<string>()
    const run = async (job: ImageJob) => {
      const controller = new AbortController()
      controllers.add(controller)
      const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
      try {
        const parsed = new URL(job.url)
        if (
          parsed.protocol !== 'https:' ||
          parsed.username ||
          parsed.password
        ) {
          throw new Error('HTTPS image URL required')
        }
        if (!page) {
          throw new Error('Inspected page is unavailable')
        }
        // Same-origin images use the inspected document's network context.
        // Never retry rejected page requests with extension privileges.
        const blob =
          parsed.origin === page.origin
            ? await readPageImage(
                page,
                parsed.href,
                job.cache,
                controller.signal,
              )
            : await fetchImageBlob(parsed.href, {
                cache: job.cache,
                // A page can point og:image at localhost or an internal service.
                // Require public addresses after DNS resolution and on redirects.
                targetAddressSpace: 'public',
                signal: controller.signal,
              })
        if (disposed || controller.signal.aborted) {
          return
        }
        const url = URL.createObjectURL(blob)
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
