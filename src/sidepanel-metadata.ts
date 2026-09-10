import { SidepanelState } from './sidepanel-state.js'
import { SidepanelJson } from './sidepanel-json.js'
import { ImagePreviews } from './image-previews.js'

const { panelState, panelElements } = SidepanelState

let previewBatch = ImagePreviews.createBatch()

const renderMetadata = () => {
  previewBatch.dispose()
  previewBatch = ImagePreviews.createBatch()
  if (panelState.mode !== 'metadata') {
    return
  }
  const data = panelState.metadata
  if (!data || data.error) {
    panelElements.metadataView.replaceChildren(
      SidepanelJson.emptyState(
        data?.error ||
          (panelState.tabId === null
            ? 'Select a normal page tab to view page metadata.'
            : 'Loading page metadata…'),
      ),
    )
    return
  }
  const nodes = []
  for (const [key, title] of [
    ['canonical', 'Canonical URL'],
    ['description', 'Description'],
    data.openGraph?.length
      ? (['openGraph', 'Open Graph'] as const)
      : (['twitter', 'Twitter Card'] as const),
  ] as const) {
    const heading = document.createElement('h2')
    heading.textContent = title
    nodes.push(heading)
    const entries = data[key] || []
    if (!entries.length) {
      nodes.push(SidepanelJson.emptyState('Not specified'))
      continue
    }
    const list = document.createElement('dl')
    for (const entry of groupMetadataTags(entries)) {
      const name = document.createElement('dt')
      name.textContent = entry.key
      const value = document.createElement('dd')
      value.textContent = entry.values
        ? JSON.stringify(entry.values, null, 2)
        : entry.value || '(empty)'
      const imageUrl = metadataImageUrl(entry, data.baseUrl)
      if (imageUrl) {
        const status = document.createElement('span')
        status.className = 'metadata-image-error'
        status.textContent = 'Loading image…'
        value.append(status)
        previewBatch.load(
          imageUrl,
          (blobUrl) => {
            const image = document.createElement('img')
            image.className = 'metadata-image'
            image.alt = entry.key
            image.addEventListener('load', () => {
              status.hidden = true
            })
            image.addEventListener('error', () => {
              image.remove()
              status.textContent = 'Image unavailable'
            })
            image.src = blobUrl
            value.append(image)
          },
          (message) => {
            status.textContent = message
          },
        )
      }
      list.append(name, value)
    }
    nodes.push(list)
  }
  panelElements.metadataView.replaceChildren(...nodes)
}

const metadataImageUrl = (
  entry: MetadataEntry,
  baseUrl: string | undefined,
) => {
  if (
    ![
      'og:image',
      'og:image:url',
      'og:image:secure_url',
      'twitter:image',
      'twitter:image:src',
    ].includes(entry.key.toLowerCase()) ||
    !entry.value.trim()
  ) {
    return null
  }
  try {
    const url = new URL(entry.value, baseUrl)
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

const groupMetadataTags = (entries: MetadataEntry[]) => {
  const grouped: MetadataEntry[] = []
  const tags = new Map<string, MetadataEntry & { values: string[] }>()
  for (const entry of entries) {
    const key = entry.key.toLowerCase()
    if (!key.endsWith(':tag')) {
      grouped.push(entry)
      continue
    }
    let group = tags.get(key)
    if (!group) {
      group = { ...entry, values: [] }
      tags.set(key, group)
      grouped.push(group)
    }
    group.values.push(entry.value)
  }
  return grouped
}

const initializeMetadata = () => {
  window.addEventListener('pagehide', () => previewBatch.dispose())
}

export const SidepanelMetadata = { renderMetadata, initializeMetadata }
