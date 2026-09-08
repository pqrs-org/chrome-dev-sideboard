(function () {
  if (window.__jsonFetchVisualizerInstalled) {
    return;
  }
  window.__jsonFetchVisualizerInstalled = true;

  const MAX_TEXT_LENGTH = 1024 * 1024;
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  let sequence = 0;
  // Identifies this document/frame generation so late responses from a previous
  // reload can be ignored after the top frame sends a new startup reset.
  const pageSessionId = createPageSessionId();

  window.postMessage(
    {
      type: "json-fetch-visualizer:reset",
      payload: {
        pageSessionId,
        pageUrl: location.href,
        timestamp: Date.now(),
      },
    },
    "*",
  );

  function now() {
    return performance && performance.now ? performance.now() : Date.now();
  }

  function createPageSessionId() {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function getAbsoluteUrl(input) {
    try {
      if (typeof input === "string") {
        return new URL(input, location.href).href;
      }
      if (input instanceof URL) {
        return input.href;
      }
      if (input && typeof input.url === "string") {
        return new URL(input.url, location.href).href;
      }
    } catch (_) {
      return String(input);
    }
    return String(input);
  }

  function getFetchMethod(input, init) {
    if (init && init.method) {
      return String(init.method).toUpperCase();
    }
    if (input && typeof input.method === "string") {
      return input.method.toUpperCase();
    }
    return "GET";
  }

  function isProbablyJson(contentType, text) {
    if (contentType && /\bjson\b/i.test(contentType)) {
      return true;
    }

    const trimmed = text.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }

  function parseJsonPayload(text) {
    if (!text || text.length > MAX_TEXT_LENGTH) {
      return {
        json: null,
        raw: (text || "").slice(0, MAX_TEXT_LENGTH),
        truncated: text.length > MAX_TEXT_LENGTH,
      };
    }

    try {
      return { json: JSON.parse(text), raw: text, truncated: false };
    } catch (error) {
      return {
        json: null,
        raw: text,
        truncated: false,
        parseError: error.message,
      };
    }
  }

  function emit(record) {
    window.postMessage(
      {
        type: "json-fetch-visualizer:record",
        payload: {
          id: `${Date.now()}-${++sequence}`,
          pageSessionId,
          pageUrl: location.href,
          timestamp: Date.now(),
          ...record,
        },
      },
      "*",
    );
  }

  async function readFetchResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    // Read a clone so the original Response can still be returned to the page.
    const clone = response.clone();
    if (!clone.body) return null;
    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_TEXT_LENGTH) {
          reader.cancel().catch(() => {});
          return {
            contentType,
            json: null,
            raw: text,
            truncated: true,
            parseError: "Response exceeds 1 MiB capture limit.",
          };
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }

    if (!isProbablyJson(contentType, text)) {
      return null;
    }

    return {
      contentType,
      ...parseJsonPayload(text),
    };
  }

  if (typeof originalFetch === "function") {
    window.fetch = async function visualizedFetch(input, init) {
      const startedAt = now();
      const url = getAbsoluteUrl(input);
      const method = getFetchMethod(input, init);

      try {
        const response = await originalFetch.apply(this, arguments);
        const durationMs = Math.round(now() - startedAt);

        readFetchResponse(response)
          .then((payload) => {
            if (!payload) {
              return;
            }

            emit({
              transport: "fetch",
              method,
              url,
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              durationMs,
              ...payload,
            });
          })
          .catch((error) => {
            emit({
              transport: "fetch",
              method,
              url,
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              durationMs,
              json: null,
              raw: "",
              parseError: error.message,
            });
          });

        return response;
      } catch (error) {
        emit({
          transport: "fetch",
          method,
          url,
          status: 0,
          statusText: "Request failed",
          ok: false,
          durationMs: Math.round(now() - startedAt),
          json: null,
          raw: "",
          parseError: error.message,
        });
        throw error;
      }
    };
  }

  XMLHttpRequest.prototype.open = function visualizedOpen(method, url) {
    this.__jsonFetchVisualizer = {
      method: String(method || "GET").toUpperCase(),
      url: getAbsoluteUrl(url),
      startedAt: 0,
    };
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function visualizedSend() {
    const metadata = this.__jsonFetchVisualizer;
    if (metadata) {
      metadata.startedAt = now();
      this.addEventListener(
        "loadend",
        () => {
          const contentType = this.getResponseHeader("content-type") || "";
          const responseType = this.responseType || "text";

          if (
            responseType !== "" &&
            responseType !== "text" &&
            responseType !== "json"
          ) {
            return;
          }

          let raw = "";
          if (responseType === "json") {
            raw = JSON.stringify(this.response);
          } else {
            raw = this.responseText || "";
          }

          if (!isProbablyJson(contentType, raw)) {
            return;
          }

          emit({
            transport: "xhr",
            method: metadata.method,
            url: metadata.url,
            status: this.status,
            statusText: this.statusText,
            ok: this.status >= 200 && this.status < 300,
            durationMs: Math.round(now() - metadata.startedAt),
            contentType,
            ...parseJsonPayload(raw),
          });
        },
        { once: true },
      );
    }

    return originalXHRSend.apply(this, arguments);
  };
})();
