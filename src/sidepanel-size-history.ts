// A non-modal popover keeps history above the scrollable overview panel.
export const createSizeHistory = (
  trigger: HTMLButtonElement,
  popup: HTMLElement,
  input: HTMLInputElement,
  select: (value: number) => void,
  remove: (value: number) => Promise<void>,
) => {
  let rows: { select: HTMLButtonElement; remove: HTMLButtonElement }[] = []
  let openAtEnd = false
  trigger.popoverTargetElement = popup
  const close = () => {
    popup.hidePopover()
    trigger.setAttribute('aria-expanded', 'false')
  }
  const focusRow = (index: number, deletion = false) => {
    const row = rows[index]
    if (row) {
      const button = deletion || row.select.disabled ? row.remove : row.select
      button.focus()
    }
  }
  popup.addEventListener('beforetoggle', (event) => {
    if ((event as ToggleEvent).newState !== 'open') {
      return
    }
    const rect = trigger.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const upward = below < 160 && above > below
    const room = Math.max(0, upward ? above : below)
    popup.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 148))}px`
    popup.style.top = upward ? 'auto' : `${rect.bottom + 4}px`
    popup.style.bottom = upward
      ? `${window.innerHeight - rect.top + 4}px`
      : 'auto'
    popup.style.maxHeight = `${Math.min(240, room)}px`
  })
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (trigger.disabled) {
        return
      }
      openAtEnd = event.key === 'ArrowUp'
      popup.showPopover()
    }
  })
  popup.addEventListener('toggle', () => {
    const opened = popup.matches(':popover-open')
    trigger.setAttribute('aria-expanded', String(opened))
    if (opened) {
      focusRow(openAtEnd ? rows.length - 1 : 0)
    }
    openAtEnd = false
  })
  popup.addEventListener('focusout', (event) => {
    const next = event.relatedTarget
    if (next instanceof Node && !popup.contains(next) && next !== trigger) {
      close()
    }
  })
  popup.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      trigger.focus()
      return
    }
    const index = rows.findIndex(
      (row) => row.select === event.target || row.remove === event.target,
    )
    if (index < 0) {
      return
    }
    const deletion = rows[index].remove === event.target
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % rows.length
        break
      case 'ArrowUp':
        next = (index + rows.length - 1) % rows.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = rows.length - 1
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusRow(index)
        return
      case 'ArrowRight':
        event.preventDefault()
        focusRow(index, true)
        return
      default:
        return
    }
    event.preventDefault()
    focusRow(next, deletion)
  })
  // Close rather than detach the menu from its input after scrolling or resizing.
  window.addEventListener('resize', close)
  document.addEventListener(
    'scroll',
    (event) => {
      if (event.target !== popup) {
        close()
      }
    },
    true,
  )
  return {
    render(values: number[]) {
      rows = []
      popup.replaceChildren(
        ...values.map((value) => {
          const row = document.createElement('span')
          row.className = 'size-history-row'
          const choose = document.createElement('button')
          choose.type = 'button'
          choose.textContent = String(value)
          choose.className = 'size-history-value'
          choose.addEventListener('click', () => {
            if (choose.disabled) {
              return
            }
            select(value)
            close()
            input.focus()
          })
          const deletion = document.createElement('button')
          deletion.type = 'button'
          deletion.textContent = '×'
          deletion.className = 'size-history-delete'
          deletion.setAttribute('aria-label', `Delete ${value} from history`)
          deletion.title = `Delete ${value}`
          deletion.addEventListener('click', async () => {
            if (deletion.disabled) {
              return
            }
            const index = rows.findIndex((entry) => entry.remove === deletion)
            await remove(value)
            if (!popup.matches(':popover-open')) {
              return
            }
            if (rows.length) {
              focusRow(Math.min(index, rows.length - 1), true)
            }
          })
          rows.push({ select: choose, remove: deletion })
          row.append(choose, deletion)
          return row
        }),
      )
    },
    update(busy: boolean, available: boolean) {
      trigger.disabled = busy || !rows.length
      for (const row of rows) {
        row.select.disabled = busy || !available
        row.remove.disabled = busy
      }
      if (popup.matches(':popover-open') && !rows.length) {
        close()
        input.focus()
      }
    },
  }
}
