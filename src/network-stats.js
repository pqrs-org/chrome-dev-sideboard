;((root) => {
  'use strict'

  const keyForTab = (tabId) => `network:${tabId}`
  const withoutHash = (url) => {
    try {
      const parsed = new URL(url)
      parsed.hash = ''
      parsed.username = ''
      parsed.password = ''
      return parsed.href
    } catch {
      return ''
    }
  }

  const normalizeEvent = (kind, details) => {
    const headers = details.responseHeaders || []
    const length = headers.find(
      (h) => h.name.toLowerCase() === 'content-length',
    )?.value
    const number = /^\d+$/.test(String(length ?? '')) ? Number(length) : null
    return {
      kind,
      requestId: details.requestId,
      type: details.type,
      method: details.method,
      timeStamp: details.timeStamp,
      // Keep document URLs for navigation and failed request URLs for details.
      url:
        details.type === 'main_frame' ||
        kind === 'commit' ||
        kind === 'error' ||
        (kind === 'complete' && details.statusCode >= 400)
          ? withoutHash(details.url)
          : undefined,
      documentId: details.documentId,
      statusCode: details.statusCode,
      fromCache: Boolean(details.fromCache),
      error:
        kind === 'error' ? String(details.error || 'Unknown error') : undefined,
      bodySize:
        Number.isSafeInteger(number) &&
        !headers.some((h) => h.name.toLowerCase() === 'transfer-encoding')
          ? number
          : null,
    }
  }

  const createState = (event, scope = 'partial') => {
    return {
      startedAt: event.timeStamp,
      scope,
      pageUrl: event.url || '',
      pageRequestId: null,
      documentId: null,
      awaitingCommit: false,
      requests: 0,
      completed: 0,
      httpErrors: 0,
      networkErrors: 0,
      failureDetails: [],
      durationCount: 0,
      durationTotal: 0,
      durationMax: 0,
      knownBytes: 0,
      knownSizes: 0,
      unknownSizes: 0,
      cached: 0,
      omitted: 0,
      pending: {},
    }
  }

  const reduce = (previous, event) => {
    let state = previous
    if (event.kind === 'commit') {
      if (!/^https?:/.test(event.url)) return null
      if (state?.awaitingCommit && state.pageUrl === event.url) {
        state.awaitingCommit = false
        state.documentId = event.documentId
        return state
      }
      if (state?.documentId === event.documentId && event.documentId)
        return state
      state = createState(event, 'partial')
      state.documentId = event.documentId
      return state
    }
    if (event.kind === 'start') {
      if (
        event.type === 'main_frame' &&
        state?.pageRequestId !== event.requestId
      ) {
        state = createState(event, 'navigation')
        state.pageRequestId = event.requestId
        state.awaitingCommit = true
      }
      state ||= createState(event)
      if (event.type === 'main_frame') state.pageUrl = event.url
      // Redirects and auth retries retain the request ID and count as one chain.
      if (Object.hasOwn(state.pending, event.requestId)) {
        state.pending[event.requestId].bodySize = null
        state.pending[event.requestId].statusCode = undefined
        return state
      }
      state.requests++
      const ids = Object.keys(state.pending)
      if (ids.length >= 1000) {
        delete state.pending[ids[0]]
        state.omitted++
      }
      state.pending[event.requestId] = {
        startedAt: event.timeStamp,
        method: event.method,
        bodySize: null,
      }
      return state
    }
    if (!state || !Object.hasOwn(state.pending, event.requestId)) return state
    const request = state.pending[event.requestId]
    if (event.kind === 'headers') {
      request.bodySize = event.bodySize
      request.statusCode = event.statusCode
    } else if (event.kind === 'redirect') {
      // Only the final response size is counted. Intermediate hops are excluded.
      request.bodySize = null
      request.statusCode = undefined
    } else if (event.kind === 'complete' || event.kind === 'error') {
      delete state.pending[event.requestId]
      const statusCode = event.statusCode ?? request.statusCode
      if (event.kind === 'error' || statusCode >= 400) {
        state.failureDetails ||= []
        state.failureDetails.push({
          kind: event.kind === 'error' ? 'networkErrors' : 'httpErrors',
          url: event.url || 'URL unavailable',
          method: event.method || request.method || 'GET',
          timeStamp: event.timeStamp,
          reason: event.kind === 'error' ? event.error : `HTTP ${statusCode}`,
        })
        if (state.failureDetails.length > 100) state.failureDetails.shift()
      }
      if (event.kind === 'error') {
        state.networkErrors++
        return state
      }
      state.completed++
      if ((event.statusCode ?? request.statusCode) >= 400) state.httpErrors++
      const duration = event.timeStamp - request.startedAt
      if (Number.isFinite(duration) && duration >= 0) {
        state.durationCount++
        state.durationTotal += duration
        state.durationMax = Math.max(state.durationMax, duration)
      }
      const code = event.statusCode ?? request.statusCode
      if (event.fromCache || code === 304) state.cached++
      else if (request.method === 'HEAD' || code === 204 || code === 205) {
        state.knownSizes++
      } else if (request.bodySize !== null) {
        state.knownBytes += request.bodySize
        state.knownSizes++
      } else state.unknownSizes++
    }
    return state
  }

  const formatBytes = (value) => {
    const units = ['B', 'KiB', 'MiB', 'GiB']
    let index = 0
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024
      index++
    }
    return `${index ? value.toFixed(1) : value} ${units[index]}`
  }

  const api = { keyForTab, normalizeEvent, reduce, formatBytes }
  root.PageNetworkStats = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(globalThis)
