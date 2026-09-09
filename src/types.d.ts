// Classic scripts share these types; no declarations are emitted into the extension.
declare const module: { exports: unknown } | undefined
declare const importScripts: (...urls: string[]) => void

// Chrome 142's public-network restriction is not yet in TypeScript's DOM library.
interface RequestInit {
  targetAddressSpace?: 'public'
}

type NetworkKind =
  'start' | 'headers' | 'redirect' | 'complete' | 'error' | 'commit'
interface NetworkDetails {
  tabId: number
  timeStamp: number
  url: string
  requestId?: string
  type?: string
  method?: string
  documentId?: string
  statusCode?: number
  fromCache?: boolean
  error?: string
  responseHeaders?: chrome.webRequest.HttpHeader[]
}
interface FailureDetail {
  kind: 'networkErrors' | 'httpErrors'
  url: string
  method: string
  timeStamp: number
  reason: string
}
interface NetworkState {
  startedAt: number
  scope: string
  pageUrl: string
  pageRequestId: string | null
  documentId: string | null | undefined
  awaitingCommit: boolean
  requests: number
  completed: number
  httpErrors: number
  networkErrors: number
  failureDetails: FailureDetail[]
  durationCount: number
  durationTotal: number
  durationMax: number
  knownBytes: number
  knownSizes: number
  unknownSizes: number
  cached: number
  omitted: number
  pending: Record<
    string,
    {
      startedAt: number
      method: string
      bodySize: number | null
      statusCode?: number
    }
  >
}
interface StorageValue {
  key: string
  value: string
}
type StorageArea = 'local' | 'session' | 'cookie'
interface StorageEdit {
  tabId: number | null
  documentId: string
  area: StorageArea
  key: string
  expectedValue: string
  expectedCookie?: string
  value?: string
  requestId?: number
  json?: boolean
  deleting?: boolean
}
interface StorageSnapshot {
  documentId?: string
  url?: string
  origin?: string
  timestamp?: number | null
  local?: StorageValue[]
  session?: StorageValue[]
  cookies?: chrome.cookies.Cookie[]
  error?: string
  cookieError?: string
}
interface MetadataEntry {
  key: string
  value: string
  values?: string[]
}
interface MetadataSnapshot {
  documentId?: string
  canonical?: MetadataEntry[]
  description?: MetadataEntry[]
  openGraph?: MetadataEntry[]
  twitter?: MetadataEntry[]
  baseUrl?: string
  error?: string
}
type PanelMessage =
  | { type: 'metadataChanged'; tabId: number }
  | {
      type: 'metadataSnapshot'
      tabId: number
      requestId: number
      snapshot: MetadataSnapshot
    }
  | {
      type: 'storageSnapshot'
      tabId: number
      requestId?: number
      snapshot: StorageSnapshot
    }
  | {
      type: 'storageSaved'
      tabId: number
      requestId?: number
      ok: boolean
      error?: string
      snapshot?: StorageSnapshot
    }
type PanelRequest =
  | { type: 'init'; tabId: number }
  | { type: 'getStorage' | 'getMetadata'; requestId: number }
  | (StorageEdit & { type: 'setStorage' | 'deleteStorage' })
interface ImageJob {
  url: string
  ready: (url: string) => void
  failed: (message: string) => void
}
type DisplayStorageEntry =
  | (StorageValue & {
      area: 'local' | 'session'
      id: string
      searchText: string
    })
  | (chrome.cookies.Cookie & {
      area: 'cookie'
      key: string
      id: string
      searchText: string
      expectedCookie: string
    })
interface PanelClient {
  port: chrome.runtime.Port
  tabId: number | null
  version: number
}
interface StorageResult {
  ok: boolean
  error?: string
  snapshot?: StorageSnapshot
}
// Storage edit fields are checked at runtime before accessing website storage.
type ContentRequest =
  | { type: 'dev-sideboard:get-metadata' | 'dev-sideboard:get-storage' }
  | {
      type: 'dev-sideboard:set-storage' | 'dev-sideboard:delete-storage'
      area?: unknown
      key?: unknown
      value?: unknown
      expectedValue?: unknown
    }
