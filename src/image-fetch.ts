// Shared limits and validation for content-script and panel image requests.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const IMAGE_TIMEOUT_MS = 8000

export const fetchImageBlob = async (url: string, options: RequestInit) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('HTTPS image URL required')
  }
  const response = await fetch(parsed.href, { ...options, credentials: 'omit' })
  if (!response.ok) {
    throw new Error('Image request failed')
  }
  // Preserve MIME types for decoding, but only embed the resulting Blob as <img>.
  const type = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
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
      if (size > MAX_IMAGE_BYTES) {
        throw new Error('Image is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new Blob(chunks, { type })
}
