import assert from 'node:assert/strict'

export type TestTab = Partial<chrome.tabs.Tab>
export type TabQuery = () => Promise<TestTab[]>
export type TabEvents = {
  onActivated: (info: { windowId: number }) => void
  onUpdated: (
    id: number,
    change: Parameters<
      Parameters<typeof chrome.tabs.onUpdated.addListener>[0]
    >[1],
    tab: TestTab,
  ) => void
  onRemoved: (id: number, info: { windowId: number }) => void
  onReplaced: (id: number, removedId: number) => void
}
export const tabEvents = (
  listeners: Partial<TabEvents>,
  registrations: Record<string, number> = {},
) => {
  const register = <K extends keyof TabEvents>(name: K) => ({
    addListener: (fn: TabEvents[K]) => {
      listeners[name] = fn
      registrations[name] = (registrations[name] || 0) + 1
    },
  })
  return {
    onActivated: register('onActivated'),
    onUpdated: register('onUpdated'),
    onRemoved: register('onRemoved'),
    onReplaced: register('onReplaced'),
  }
}
export const required = <T>(value: T | null | undefined): T => {
  assert.ok(value != null, 'expected a test value to be available')
  return value
}
export class RequiredMap<K, V> extends Map<K, V> {
  override get(key: K): V {
    return required(super.get(key))
  }
}
export type FetchOptions = RequestInit & { signal: AbortSignal }
export type TestFetch = (
  url: string,
  options: FetchOptions,
) => Promise<Response>
export type SendArgs = [
  tabId: number,
  message: ContentRequest,
  options: { documentId: string },
]
export type MessageSender = Omit<chrome.runtime.MessageSender, 'tab'> & {
  tab?: TestTab
}
export type MessageListener<T> = (
  message: ContentRequest,
  sender: MessageSender,
  reply: (value: T) => void,
) => void

// Deliberately small DOM surface exercised by the side panel tests.
export class TestElement {
  children: TestElement[] = []
  textContent = ''
  value = ''
  open = false
  hidden = false
  disabled = false
  href = ''
  src = ''
  target = ''
  rel = ''
  style: Partial<CSSStyleDeclaration> = {}
  listeners: Record<string, () => void> = {}
  attributes: Record<string, string> = {}
  classList = { toggle() {}, add() {}, remove() {} }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
  showModal() {
    this.open = true
  }
  close() {
    this.open = false
  }
  focus() {}
  remove() {}
  addEventListener(name: string, fn: () => void) {
    this.listeners[name] = fn
  }
  append(...nodes: TestElement[]) {
    this.children.push(...nodes)
  }
  replaceChildren(...nodes: TestElement[]) {
    this.children = nodes
  }
  querySelector(): { open: boolean } | null {
    return null
  }
  querySelectorAll(): TestElement[] {
    return []
  }
}
