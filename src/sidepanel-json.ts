import { SidepanelState } from './sidepanel-state.js'

const { panelElements, panelState, FILTER_DEBOUNCE_MS } = SidepanelState

// Timeout ID for the pending JSON filter update. Each keystroke cancels the
// previous timeout, so filtering and rendering run only after input pauses
// for FILTER_DEBOUNCE_MS instead of rebuilding the tree on every keystroke.
let jsonFilterTimer = 0

const selectedTreeNode = () =>
  panelElements.treeView.querySelector<HTMLDetailsElement>(
    'details.tree-selected',
  )

const renderTreeActionButtons = () => {
  const selected = selectedTreeNode()
  panelElements.toggleTreeButton.disabled = !selected
  panelElements.toggleTreeButton.textContent =
    selected && !selected.open ? 'Expand' : 'Collapse'
}

const selectTreeNode = (selected: HTMLElement) => {
  const previous = panelElements.treeView.querySelector('.tree-selected')
  previous?.classList.toggle('tree-selected', false)
  if (previous) {
    const label = previous.querySelector('summary') || previous
    label.setAttribute('aria-current', 'false')
  }
  selected.classList.toggle('tree-selected', true)
  const label = selected.querySelector('summary') || selected
  label.setAttribute('aria-current', 'true')
  renderTreeActionButtons()
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
  const root = panelElements.treeView.querySelector('details')
  if (root) {
    selectTreeNode(root)
  } else {
    renderTreeActionButtons()
  }
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
  const arrow = document.createElement('span')
  arrow.className = 'tree-toggle'
  arrow.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.className = 'tree-summary-label'
  label.append(
    renderKey(key),
    document.createTextNode(
      Array.isArray(value)
        ? `: Array(${value.length})`
        : `: Object(${Object.keys(value).length})`,
    ),
  )
  summary.append(arrow, label)
  // Keep native keyboard toggling, but reserve pointer toggling for the arrow
  // so clicking or selecting the label does not collapse the node.
  summary.addEventListener('focus', () => selectTreeNode(details))
  summary.addEventListener('click', (event) => {
    selectTreeNode(details)
    if (event.detail !== 0 && event.target !== arrow) {
      event.preventDefault()
    }
  })
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
  row.addEventListener('click', () => selectTreeNode(row))
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
    const selected = selectedTreeNode()
    if (selected) {
      selected.open = !selected.open
    }
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
