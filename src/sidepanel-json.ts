import { SidepanelState } from './sidepanel-state.js'

const { panelElements, panelState, FILTER_DEBOUNCE_MS } = SidepanelState

let jsonFilterTimer = 0

const renderTreeActionButtons = () => {
  const nodes = [...panelElements.treeView.querySelectorAll('details')]
  panelElements.toggleTreeButton.disabled = nodes.length === 0
  panelElements.toggleTreeButton.textContent = nodes.some((node) => !node.open)
    ? 'Expand'
    : 'Collapse'
}

const setTreeOpen = (open: boolean) => {
  for (const details of panelElements.treeView.querySelectorAll('details')) {
    details.open = open
  }
}

const renderFilteredJson = (value: unknown, key: string) => {
  const tree = renderJsonTree(
    value,
    key,
    panelState.jsonFilter,
    false,
    { remaining: 5000 },
    0,
  )
  panelElements.treeView.replaceChildren(
    tree || emptyState('No matching JSON keys or values.'),
  )
}

const renderJsonTree = (
  value: unknown,
  key: string,
  filter = '',
  matchKey = true,
  budget = { remaining: 5000 },
  depth = 0,
): HTMLElement | null => {
  if (--budget.remaining < 0 || depth > 100) {
    return emptyState(
      'Tree display limit reached. Use Raw to view the complete value.',
    )
  }
  const keyMatches = matchKey && normalizeSearchText(key).includes(filter)

  if (value === null || typeof value !== 'object') {
    const valueMatches = normalizeSearchText(
      typeof value === 'string' ? value : String(value),
    ).includes(filter)
    if (filter && !keyMatches && !valueMatches) {
      return null
    }

    return renderPrimitiveStorage(value, key)
  }

  const children = []
  for (const [childKey, childValue] of Object.entries(value)) {
    if (budget.remaining < 0) {
      break
    }
    const child = renderJsonTree(
      childValue,
      childKey,
      keyMatches ? '' : filter,
      true,
      budget,
      depth + 1,
    )
    if (child) {
      children.push(child)
    }
  }

  if (filter && !keyMatches && children.length === 0) {
    return null
  }

  const details = document.createElement('details')
  details.open = true

  const summary = document.createElement('summary')
  summary.append(
    renderKey(key),
    document.createTextNode(
      Array.isArray(value)
        ? `: Array(${value.length})`
        : `: Object(${Object.keys(value).length})`,
    ),
  )
  details.append(summary)

  const container = document.createElement('div')
  container.style.paddingLeft = '1.125rem'

  container.append(...children)

  details.append(container)
  return details
}

const renderKey = (key: string) => {
  const span = document.createElement('span')
  span.className = 'key'
  span.textContent = key
  return span
}

const renderPrimitive = (value: unknown) => {
  const span = document.createElement('span')
  span.className = value === null ? 'null' : typeof value
  span.textContent =
    typeof value === 'string' ? JSON.stringify(value) : String(value)
  return span
}

const emptyState = (text: string) => {
  const node = document.createElement('div')
  node.className = 'empty-state'
  node.textContent = text
  return node
}

const renderRaw = (text: string) => {
  const pre = document.createElement('pre')
  pre.className = 'raw-value'
  pre.textContent = text
  panelElements.treeView.replaceChildren(pre)
}

const normalizeSearchText = (value: unknown) => {
  return String(value || '').toLocaleLowerCase()
}

const parseMaybeJson = (value: unknown) => {
  const trimmed = String(value || '').trim()
  if (!trimmed || !(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return { ok: false }
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false }
  }
}

const renderPrimitiveStorage = (value: unknown, key: string) => {
  const row = document.createElement('div')
  row.className = 'tree-row'
  row.append(
    renderKey(key),
    document.createTextNode(': '),
    renderPrimitive(value),
  )
  return row
}

const initializeJsonViewer = (renderDetail: () => void) => {
  panelElements.jsonFilterInput.addEventListener('input', () => {
    window.clearTimeout(jsonFilterTimer)
    jsonFilterTimer = window.setTimeout(() => {
      panelState.jsonFilter = normalizeSearchText(
        panelElements.jsonFilterInput.value.trim(),
      )
      renderDetail()
    }, FILTER_DEBOUNCE_MS)
  })

  panelElements.toggleTreeButton.addEventListener('click', () => {
    const nodes = [...panelElements.treeView.querySelectorAll('details')]
    setTreeOpen(nodes.some((node) => !node.open))
    renderTreeActionButtons()
  })

  panelElements.treeView.addEventListener(
    'toggle',
    renderTreeActionButtons,
    true,
  )

  panelElements.rawButton.addEventListener('click', () => {
    panelState.rawView = !panelState.rawView
    renderDetail()
  })
}

export const SidepanelJson = {
  renderTreeActionButtons,
  emptyState,
  parseMaybeJson,
  renderRaw,
  renderFilteredJson,
  renderPrimitiveStorage,
  normalizeSearchText,
  initializeJsonViewer,
}
