import { SidepanelActiveTab } from './sidepanel-active-tab.js'
import { createSizeHistory } from './sidepanel-size-history.js'

interface Size {
  width: number
  height: number
}
type Dimension = keyof Size
const dimensions = ['width', 'height'] as const
const validDimension = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= 32767
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 150))
let resizing = false
const controlUpdates: (() => void)[] = []
const updateAllControls = () => controlUpdates.forEach((update) => update())
const readViewport = async (target: chrome.tabs.Tab) => {
  const frame = await chrome.webNavigation.getFrame({
    tabId: target.id!,
    frameId: 0,
  })
  if (!frame?.documentId) {
    throw new Error('Page unavailable. Reload the page.')
  }
  const viewport = await chrome.tabs.sendMessage<unknown, Size>(
    target.id!,
    { type: 'dev-sideboard:get-viewport' },
    { documentId: frame.documentId },
  )
  const current = await chrome.webNavigation.getFrame({
    tabId: target.id!,
    frameId: 0,
  })
  if (current?.documentId !== frame.documentId) {
    throw new Error('The page changed. Try again.')
  }
  if (
    !viewport ||
    ![viewport.width, viewport.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error('Viewport unavailable. Reload the page.')
  }
  return viewport
}

const createSizeEditor = (mode: 'window' | 'viewport') => {
  const isViewport = mode === 'viewport'
  const prefix = isViewport ? 'window' : 'outer'
  const form = document.querySelector<HTMLFormElement>(`#${prefix}Resize`)!
  const width = document.querySelector<HTMLInputElement>(`#${prefix}Width`)!
  const height = document.querySelector<HTMLInputElement>(`#${prefix}Height`)!
  const apply = document.querySelector<HTMLButtonElement>(
    isViewport ? '#applyWindowSize' : '#applyOuterSize',
  )!
  const inputs = { width, height }
  const historyKey = isViewport ? 'viewportSizeHistory' : 'windowSizeHistory'
  const history: Record<Dimension, number[]> = { width: [], height: [] }
  let tab: chrome.tabs.Tab | undefined
  let windowId: number | undefined
  let actualSize: Size | undefined
  let generation = 0
  let polling = false
  let available = false
  let savingHistory = false
  const makeMenu = (dimension: Dimension) => {
    const suffix = dimension === 'width' ? 'Width' : 'Height'
    return createSizeHistory(
      document.querySelector<HTMLButtonElement>(`#${prefix}${suffix}History`)!,
      document.querySelector<HTMLElement>(`#${prefix}${suffix}HistoryMenu`)!,
      inputs[dimension],
      (value) => {
        if (!available || resizing || savingHistory) {
          return
        }
        inputs[dimension].value = String(value)
        updateControls()
      },
      async (value) => {
        if (resizing || savingHistory) {
          return
        }
        savingHistory = true
        updateControls()
        try {
          await changeHistory((latest) => {
            latest[dimension] = latest[dimension].filter(
              (entry) => entry !== value,
            )
          })
        } catch {
          // Keep the existing history when persistence fails.
        } finally {
          savingHistory = false
          updateControls()
        }
      },
    )
  }
  const menus = { width: makeMenu('width'), height: makeMenu('height') }
  const editedSize = () =>
    !!actualSize &&
    dimensions.some(
      (dimension) => Number(inputs[dimension].value) !== actualSize![dimension],
    )
  const updateControls = () => {
    apply.disabled =
      resizing ||
      savingHistory ||
      !available ||
      !editedSize() ||
      ![Number(width.value), Number(height.value)].every(validDimension)
    width.disabled = height.disabled = resizing || !available
    for (const dimension of dimensions) {
      menus[dimension].update(resizing || savingHistory, available)
    }
  }
  controlUpdates.push(updateControls)
  const updateHistory = (latest: typeof history) => {
    for (const dimension of dimensions) {
      if (history[dimension].join() !== latest[dimension].join()) {
        history[dimension] = latest[dimension]
        menus[dimension].render(history[dimension])
      }
    }
    updateControls()
  }
  const parseHistory = (saved: unknown) => {
    const result: Record<Dimension, number[]> = { width: [], height: [] }
    if (saved && typeof saved === 'object') {
      for (const dimension of dimensions) {
        const values = (saved as Record<string, unknown>)[dimension]
        if (Array.isArray(values)) {
          result[dimension] = [...new Set(values.filter(validDimension))].slice(
            0,
            20,
          )
        }
      }
    }
    return result
  }
  const loadHistory = async () =>
    parseHistory((await chrome.storage.local.get(historyKey))[historyKey])
  // Panels share storage. Read and write under one origin-wide lock so that
  // another window cannot restore deleted entries or overwrite newer history.
  const changeHistory = (change: (latest: typeof history) => void) =>
    navigator.locks.request(historyKey, async () => {
      const latest = await loadHistory()
      change(latest)
      await chrome.storage.local.set({ [historyKey]: latest })
      updateHistory(latest)
    })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[historyKey]) {
      updateHistory(parseHistory(changes[historyKey].newValue))
    }
  })
  void navigator.locks
    .request(historyKey, async () => {
      updateHistory(await loadHistory())
    })
    .catch(() => {})
  const rememberSize = (requested: Size) =>
    changeHistory((latest) => {
      for (const dimension of dimensions) {
        latest[dimension] = [
          requested[dimension],
          ...latest[dimension].filter(
            (value) => value !== requested[dimension],
          ),
        ].slice(0, 20)
      }
    })
  const render = (size: Size, force = false) => {
    const sizeChanged =
      actualSize?.width !== size.width || actualSize?.height !== size.height
    available = true
    if (force || !editedSize() || sizeChanged) {
      width.value = String(size.width)
      height.value = String(size.height)
    }
    actualSize = size
    updateControls()
  }
  const readWindow = async (): Promise<Size> => {
    if (windowId === undefined) {
      throw new Error('Window unavailable.')
    }
    const current = await chrome.windows.get(windowId)
    if (!validDimension(current.width) || !validDimension(current.height)) {
      throw new Error('Window dimensions unavailable.')
    }
    return { width: current.width, height: current.height }
  }
  const refresh = async () => {
    if (
      resizing ||
      polling ||
      (isViewport ? tab?.id === undefined : windowId === undefined)
    ) {
      return
    }
    const version = generation
    polling = true
    try {
      const size = isViewport ? await readViewport(tab!) : await readWindow()
      if (version === generation && !resizing) {
        render(size)
      }
    } catch {
      if (version === generation && !resizing) {
        available = false
        updateControls()
      }
    } finally {
      polling = false
    }
  }
  if (isViewport) {
    SidepanelActiveTab.observe(({ tab: next, pageChanged }) => {
      if (next?.id !== tab?.id || pageChanged) {
        generation++
        actualSize = undefined
        available = false
        width.value = height.value = ''
        updateControls()
      }
      tab =
        next?.id !== undefined && /^https?:/.test(next.url || '')
          ? next
          : undefined
      void refresh()
    })
  } else {
    chrome.windows.onBoundsChanged.addListener((current) => {
      if (
        current.id === windowId &&
        validDimension(current.width) &&
        validDimension(current.height)
      ) {
        render({ width: current.width, height: current.height })
      }
    })
    chrome.windows
      .getCurrent()
      .then((current) => {
        windowId = current.id
        return refresh()
      })
      .catch(() => {})
  }
  if (isViewport) {
    // Window bounds have an event; viewport changes from zoom/DevTools do not.
    setInterval(() => {
      void refresh()
    }, 500)
  }
  for (const input of [width, height]) {
    input.addEventListener('input', updateControls)
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (
      resizing ||
      savingHistory ||
      !available ||
      (isViewport ? tab?.id === undefined : windowId === undefined)
    ) {
      return
    }
    const w = Number(width.value)
    const h = Number(height.value)
    if (![w, h].every(validDimension)) {
      return
    }
    if (w === actualSize?.width && h === actualSize.height) {
      return
    }
    const target = tab
    const targetWindowId = isViewport ? target!.windowId : windowId!
    const version = ++generation
    const ensureCurrent = () => {
      if (version !== generation) {
        throw new Error('The active page changed. Try again.')
      }
    }
    resizing = true
    updateAllControls()
    try {
      const current = await chrome.windows.get(targetWindowId)
      ensureCurrent()
      if (current.state !== 'normal') {
        await chrome.windows.update(targetWindowId, { state: 'normal' })
        await settle()
        ensureCurrent()
      }
      let actual: Size
      if (isViewport) {
        actual = await readViewport(target!)
        for (let attempt = 0; attempt < 4; attempt++) {
          ensureCurrent()
          if (actual.width === w && actual.height === h) {
            break
          }
          const outer = await chrome.windows.get(targetWindowId)
          const zoom = await chrome.tabs.getZoom(target!.id!)
          ensureCurrent()
          if (
            !outer.width ||
            !outer.height ||
            !Number.isFinite(zoom) ||
            zoom <= 0
          ) {
            throw new Error('Window dimensions unavailable.')
          }
          await chrome.windows.update(targetWindowId, {
            width: Math.min(
              32767,
              Math.max(1, Math.round(outer.width + (w - actual.width) * zoom)),
            ),
            height: Math.min(
              32767,
              Math.max(
                1,
                Math.round(outer.height + (h - actual.height) * zoom),
              ),
            ),
          })
          await settle()
          ensureCurrent()
          actual = await readViewport(target!)
        }
      } else {
        await chrome.windows.update(targetWindowId, { width: w, height: h })
        await settle()
        actual = await readWindow()
      }
      ensureCurrent()
      render(actual, true)
      await rememberSize({ width: w, height: h })
    } catch {
      // Refresh the actual size and restore controls after a failed operation.
    } finally {
      resizing = false
      updateAllControls()
      void refresh()
    }
  })
}
createSizeEditor('window')
createSizeEditor('viewport')
