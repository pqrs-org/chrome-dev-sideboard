const PANEL_PORT_NAME = "json-fetch-visualizer:panel";
const SEARCH_TEXT_LIMIT = 12000;
const FILTER_DEBOUNCE_MS = 120;
const LIST_URL_MAX_LENGTH = 140;
const DETAIL_URL_MAX_LENGTH = 240;
const WRITE_METHODS = ["POST", "PUT", "PATCH"];

let port;
function connectPanel() {
  port = chrome.runtime.connect({ name: PANEL_PORT_NAME });
  port.onMessage.addListener(handlePanelMessage);
  port.onDisconnect.addListener(() =>
    window.setTimeout(() => {
      connectPanel();
      if (typeof state.tabId === "number")
        port.postMessage({ type: "init", tabId: state.tabId });
    }, 250),
  );
}
let filterTimer = 0;
let payloadFilterTimer = 0;

const state = {
  tabId: null,
  mode: "fetch",
  records: [],
  selectedId: null,
  filter: "",
  payloadFilter: "",
  methodFilter: "get",
  errorsOnly: false,
  storage: {
    url: "",
    origin: "",
    timestamp: null,
    local: [],
    session: [],
    error: "",
  },
  selectedStorageId: null,
};

const elements = {
  fetchModeButton: document.getElementById("fetchModeButton"),
  storageModeButton: document.getElementById("storageModeButton"),
  filterInput: document.getElementById("filterInput"),
  methodFilterGroup: document.getElementById("methodFilterGroup"),
  errorsOnlyLabel: document.getElementById("errorsOnlyLabel"),
  errorsOnlyInput: document.getElementById("errorsOnlyInput"),
  reloadButton: document.getElementById("reloadButton"),
  refreshStorageButton: document.getElementById("refreshStorageButton"),
  countLabel: document.getElementById("countLabel"),
  requestList: document.getElementById("requestList"),
  detailTitle: document.getElementById("detailTitle"),
  detailMeta: document.getElementById("detailMeta"),
  payloadFilterInput: document.getElementById("payloadFilterInput"),
  expandTreeButton: document.getElementById("expandTreeButton"),
  collapseTreeButton: document.getElementById("collapseTreeButton"),
  copyButton: document.getElementById("copyButton"),
  treeView: document.getElementById("treeView"),
};

function handlePanelMessage(message) {
  if (message.type === "snapshot") {
    if (typeof message.tabId === "number" && message.tabId !== state.tabId) {
      return;
    }

    state.records = message.records.map(prepareRecord);
    if (!state.records.some((record) => record.id === state.selectedId)) {
      state.selectedId = state.records.at(-1)?.id || null;
    }
    render();
  }

  if (message.type === "record") {
    if (message.record.tabId !== state.tabId) {
      return;
    }

    state.records = [...state.records, prepareRecord(message.record)].slice(
      -80,
    );
    if (!state.selectedId) {
      state.selectedId = message.record.id;
    }
    render();
  }

  if (message.type === "storageSnapshot") {
    if (message.tabId !== state.tabId) {
      return;
    }

    state.storage = normalizeStorageSnapshot(message.snapshot);
    if (
      !getStorageEntries().some((entry) => entry.id === state.selectedStorageId)
    ) {
      state.selectedStorageId = getStorageEntries().at(0)?.id || null;
    }
    render();
  }
}
connectPanel();

elements.fetchModeButton.addEventListener("click", () => {
  state.mode = "fetch";
  render();
});

elements.storageModeButton.addEventListener("click", () => {
  state.mode = "storage";
  requestStorageSnapshot();
  render();
});

elements.filterInput.addEventListener("input", () => {
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    state.filter = normalizeSearchText(elements.filterInput.value.trim());
    render();
  }, FILTER_DEBOUNCE_MS);
});

elements.payloadFilterInput.addEventListener("input", () => {
  window.clearTimeout(payloadFilterTimer);
  payloadFilterTimer = window.setTimeout(() => {
    state.payloadFilter = normalizeSearchText(
      elements.payloadFilterInput.value.trim(),
    );
    renderDetail();
  }, FILTER_DEBOUNCE_MS);
});

elements.errorsOnlyInput.addEventListener("change", () => {
  state.errorsOnly = elements.errorsOnlyInput.checked;
  renderList();
});

elements.methodFilterGroup.addEventListener("click", (event) => {
  const button = event.target.closest("[data-method-filter]");
  if (!button) {
    return;
  }

  state.methodFilter = button.dataset.methodFilter;
  renderList();
  renderMethodFilterButtons();
});

elements.reloadButton.addEventListener("click", () => {
  port.postMessage({ type: "reloadTab" });
});

elements.refreshStorageButton.addEventListener("click", () => {
  requestStorageSnapshot();
});

elements.expandTreeButton.addEventListener("click", () => {
  setTreeOpen(true);
});

elements.collapseTreeButton.addEventListener("click", () => {
  setTreeOpen(false);
});

elements.copyButton.addEventListener("click", async () => {
  const text = getCopyText();
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    flashCopyButton();
  } catch (error) {
    elements.detailMeta.textContent = error.message;
  }
});

let inspectorWindowId;
let tabQueryVersion = 0;
initialize().catch((error) => {
  elements.detailMeta.textContent = error.message;
});
async function initialize() {
  inspectorWindowId = (await chrome.windows.getCurrent()).id;
  await selectCurrentTab();

  if (chrome.tabs) {
    chrome.tabs.onActivated.addListener(({ windowId }) => {
      if (windowId === inspectorWindowId) selectCurrentTab();
    });

    chrome.tabs.onUpdated.addListener((tabId, changes) => {
      if (
        tabId === state.tabId &&
        (changes.url || changes.status === "complete")
      ) {
        state.storage = normalizeStorageSnapshot(null);
        if (state.mode === "storage") requestStorageSnapshot();
        render();
      }
    });
    chrome.tabs.onRemoved.addListener(() => selectCurrentTab());
    chrome.tabs.onReplaced.addListener(() => selectCurrentTab());
  }
}

async function selectCurrentTab() {
  const version = ++tabQueryVersion;
  const tabId = await getCurrentTabId();
  if (version !== tabQueryVersion) return;
  if (typeof tabId !== "number") {
    state.tabId = null;
    state.records = [];
    state.selectedId = null;
    state.selectedStorageId = null;
    state.storage = normalizeStorageSnapshot(null);
    render();
    elements.detailTitle.textContent = "No active tab";
    elements.detailTitle.title = "";
    elements.detailMeta.textContent =
      "Select a normal page tab to inspect JSON fetches.";
    return;
  }

  if (tabId === state.tabId) {
    return;
  }

  state.tabId = tabId;
  state.records = [];
  state.selectedId = null;
  state.selectedStorageId = null;
  state.storage = normalizeStorageSnapshot(null);
  render();
  port.postMessage({ type: "init", tabId });
  if (state.mode === "storage") requestStorageSnapshot();
}

async function getCurrentTabId() {
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId: inspectorWindowId,
  });
  return tab?.id;
}

function getVisibleRecords() {
  return state.records.filter((record) => {
    if (state.errorsOnly && record.ok) {
      return false;
    }

    if (!matchesMethodFilter(record.method)) {
      return false;
    }

    if (!state.filter) {
      return true;
    }

    return record.searchText.includes(state.filter);
  });
}

function matchesMethodFilter(method) {
  const normalizedMethod = String(method || "").toUpperCase();

  if (state.methodFilter === "get") {
    return normalizedMethod === "GET";
  }

  if (state.methodFilter === "write") {
    return WRITE_METHODS.includes(normalizedMethod);
  }

  if (state.methodFilter === "other") {
    return (
      normalizedMethod !== "GET" && !WRITE_METHODS.includes(normalizedMethod)
    );
  }

  return true;
}

function getStorageEntries() {
  return [...state.storage.local, ...state.storage.session];
}

function getSelectedRecord() {
  return state.records.find((record) => record.id === state.selectedId);
}

function getSelectedStorageEntry() {
  return getStorageEntries().find(
    (entry) => entry.id === state.selectedStorageId,
  );
}

function getVisibleStorageEntries() {
  return getStorageEntries().filter((entry) => {
    if (!state.filter) {
      return true;
    }

    return entry.searchText.includes(state.filter);
  });
}

function render() {
  renderModeChrome();
  renderList();
  renderDetail();
}

function renderModeChrome() {
  elements.fetchModeButton.classList.toggle("active", state.mode === "fetch");
  elements.storageModeButton.classList.toggle(
    "active",
    state.mode === "storage",
  );
  elements.refreshStorageButton.classList.toggle(
    "hidden",
    state.mode !== "storage",
  );
  elements.methodFilterGroup.classList.toggle("hidden", state.mode !== "fetch");
  elements.errorsOnlyLabel.classList.toggle("hidden", state.mode !== "fetch");
  elements.filterInput.placeholder =
    state.mode === "fetch" ? "Filter URL or JSON" : "Filter key or value";
  elements.copyButton.disabled = !getCopyText();
  renderTreeActionButtons();
  renderMethodFilterButtons();
}

function renderTreeActionButtons() {
  const disabled = !elements.treeView.querySelector("details");
  elements.expandTreeButton.disabled = disabled;
  elements.collapseTreeButton.disabled = disabled;
}

function renderEmptyDetail(title, message, emptyText) {
  elements.detailTitle.textContent = title;
  elements.detailTitle.title = "";
  elements.detailMeta.textContent = message;
  elements.treeView.replaceChildren(emptyState(emptyText));
  elements.copyButton.disabled = true;
  renderTreeActionButtons();
}

function renderMethodFilterButtons() {
  for (const button of elements.methodFilterGroup.querySelectorAll(
    "[data-method-filter]",
  )) {
    button.classList.toggle(
      "active",
      button.dataset.methodFilter === state.methodFilter,
    );
  }
}

function renderList() {
  if (state.mode === "storage") {
    renderStorageList();
    return;
  }

  const records = getVisibleRecords();
  const total = state.errorsOnly
    ? state.records.filter((record) => !record.ok).length
    : state.records.length;
  elements.countLabel.textContent = `${records.length} of ${total} requests`;
  elements.requestList.replaceChildren(...records.map(renderRequestItem));
}

function renderStorageList() {
  const entries = getVisibleStorageEntries();
  const total = getStorageEntries().length;
  elements.countLabel.textContent = `${entries.length} of ${total} storage items`;
  elements.requestList.replaceChildren(...entries.map(renderStorageItem));
}

function renderRequestItem(record) {
  const item = document.createElement("li");
  item.className = `request-item${record.id === state.selectedId ? " selected" : ""}`;
  item.addEventListener("click", () => {
    if (state.selectedId === record.id) {
      return;
    }

    state.selectedId = record.id;
    render();
  });

  const method = document.createElement("span");
  method.className = "method";
  method.textContent = record.method;

  const middle = document.createElement("div");
  middle.className = "url";
  middle.title = record.url;
  middle.textContent = compactUrl(record.url);

  const status = document.createElement("span");
  status.className = `status ${record.ok ? "ok" : "error"}`;
  status.textContent = `${record.status} ${record.durationMs}ms`;

  item.append(method, middle, status);
  return item;
}

function renderStorageItem(entry) {
  const item = document.createElement("li");
  item.className = `request-item${entry.id === state.selectedStorageId ? " selected" : ""}`;
  item.addEventListener("click", () => {
    if (state.selectedStorageId === entry.id) {
      return;
    }

    state.selectedStorageId = entry.id;
    render();
  });

  const area = document.createElement("span");
  area.className = "area";
  area.textContent = entry.area === "local" ? "L" : "S";
  area.title = entry.area === "local" ? "Local Storage" : "Session Storage";

  const key = document.createElement("div");
  key.className = "url";
  key.title = entry.key;
  key.textContent = entry.key;

  const preview = document.createElement("span");
  preview.className = "value-preview";
  preview.title = entry.value;
  preview.textContent = compactValue(entry.value);

  item.append(area, key, preview);
  return item;
}

function renderDetail() {
  if (state.mode === "storage") {
    renderStorageDetail();
    return;
  }

  const record = getSelectedRecord();
  if (!record) {
    renderEmptyDetail(
      "No JSON request selected",
      "Reload the page to capture startup requests.",
      "No captured JSON payloads yet.",
    );
    return;
  }

  elements.detailTitle.textContent = `${record.method} ${compactUrl(
    record.url,
    {
      includeOrigin: true,
      maxLength: DETAIL_URL_MAX_LENGTH,
    },
  )}`;
  elements.detailTitle.title = record.url;
  elements.detailMeta.textContent = [
    record.transport,
    `${record.status} ${record.statusText}`,
    `${record.durationMs}ms`,
    new Date(record.timestamp).toLocaleTimeString(),
  ].join(" · ");

  if (record.parseError || record.truncated) {
    elements.treeView.replaceChildren(
      emptyState(record.parseError || "Payload truncated"),
      renderPrimitiveStorage(record.raw || "", "response"),
    );
  } else renderFilteredPayload(record.json, "response");
  elements.copyButton.disabled = false;
  renderTreeActionButtons();
}

function renderStorageDetail() {
  const entry = getSelectedStorageEntry();
  if (state.storage.error) {
    renderEmptyDetail(
      "Storage unavailable",
      state.storage.error,
      "Storage cannot be read on this page.",
    );
    return;
  }

  if (!entry) {
    renderEmptyDetail(
      "No storage item selected",
      state.storage.origin ||
        "Refresh storage after selecting a normal page tab.",
      "No Local Storage or Session Storage items.",
    );
    return;
  }

  const parsed = parseMaybeJson(entry.value);
  elements.detailTitle.textContent = `${entry.area === "local" ? "Local Storage" : "Session Storage"}: ${entry.key}`;
  elements.detailTitle.title = entry.key;
  elements.detailMeta.textContent = [
    state.storage.origin || state.storage.url,
    state.storage.timestamp
      ? new Date(state.storage.timestamp).toLocaleTimeString()
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (parsed.ok) {
    renderFilteredPayload(parsed.value, entry.key);
  } else {
    elements.treeView.replaceChildren(
      renderPrimitiveStorage(entry.value, entry.key),
    );
  }
  elements.copyButton.disabled = false;
  renderTreeActionButtons();
}

function setTreeOpen(open) {
  for (const details of elements.treeView.querySelectorAll("details")) {
    details.open = open;
  }
}

function renderFilteredPayload(value, key) {
  const tree = renderJsonTree(
    value,
    key,
    state.payloadFilter,
    false,
    { remaining: 5000 },
    0,
  );
  elements.treeView.replaceChildren(
    tree || emptyState("No matching JSON keys or values."),
  );
}

function renderJsonTree(
  value,
  key,
  filter = "",
  matchKey = true,
  budget = { remaining: 5000 },
  depth = 0,
) {
  if (--budget.remaining < 0 || depth > 100)
    return emptyState(
      "Tree display limit reached. Use Copy for the captured payload.",
    );
  const keyMatches = matchKey && normalizeSearchText(key).includes(filter);

  if (value === null || typeof value !== "object") {
    const valueMatches = normalizeSearchText(
      typeof value === "string" ? value : String(value),
    ).includes(filter);
    if (filter && !keyMatches && !valueMatches) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "tree-row";
    row.append(
      renderKey(key),
      document.createTextNode(": "),
      renderPrimitive(value),
    );
    return row;
  }

  const children = [];
  for (const [childKey, childValue] of Object.entries(value)) {
    if (budget.remaining < 0) break;
    const child = renderJsonTree(
      childValue,
      childKey,
      keyMatches ? "" : filter,
      true,
      budget,
      depth + 1,
    );
    if (child) {
      children.push(child);
    }
  }

  if (filter && !keyMatches && children.length === 0) {
    return null;
  }

  const details = document.createElement("details");
  details.open = true;

  const summary = document.createElement("summary");
  summary.append(
    renderKey(key),
    document.createTextNode(
      Array.isArray(value)
        ? `: Array(${value.length})`
        : `: Object(${Object.keys(value).length})`,
    ),
  );
  details.append(summary);

  const container = document.createElement("div");
  container.style.paddingLeft = "1.125rem";

  container.append(...children);

  details.append(container);
  return details;
}

function renderKey(key) {
  const span = document.createElement("span");
  span.className = "key";
  span.textContent = key;
  return span;
}

function renderPrimitive(value) {
  const span = document.createElement("span");
  span.className = value === null ? "null" : typeof value;
  span.textContent =
    typeof value === "string" ? JSON.stringify(value) : String(value);
  return span;
}

function emptyState(text) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = text;
  return node;
}

function requestStorageSnapshot() {
  if (typeof state.tabId === "number") {
    port.postMessage({ type: "getStorage" });
  }
}

function getCopyText() {
  if (state.mode === "storage") {
    const entry = getSelectedStorageEntry();
    if (!entry) {
      return "";
    }

    const parsed = parseMaybeJson(entry.value);
    return parsed.ok ? JSON.stringify(parsed.value, null, 2) : entry.value;
  }

  const record = getSelectedRecord();
  if (!record) {
    return "";
  }

  return record.raw || JSON.stringify(record.json, null, 2);
}

function flashCopyButton() {
  const originalText = elements.copyButton.textContent;
  elements.copyButton.textContent = "Copied";
  window.setTimeout(() => {
    elements.copyButton.textContent = originalText;
  }, 900);
}

function normalizeStorageSnapshot(snapshot) {
  return {
    url: snapshot?.url || "",
    origin: snapshot?.origin || "",
    timestamp: snapshot?.timestamp || null,
    local: prepareStorageEntries(snapshot?.local, "local"),
    session: prepareStorageEntries(snapshot?.session, "session"),
    error: snapshot?.error || "",
  };
}

function prepareRecord(record) {
  let json = null;
  if (!record.truncated) {
    try {
      json = JSON.parse(record.raw);
    } catch (_) {}
  }
  return {
    ...record,
    json,
    searchText: buildSearchText([
      record.url,
      record.method,
      record.statusText,
      String(record.status || ""),
      record.raw,
    ]),
  };
}

function prepareStorageEntries(entries, area) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => ({
    ...entry,
    area,
    id: `${area}:${entry.key}`,
    searchText: buildSearchText([area, entry.key, entry.value]),
  }));
}

function buildSearchText(values) {
  return normalizeSearchText(
    values
      .map((value) => String(value || "").slice(0, SEARCH_TEXT_LIMIT))
      .join("\n"),
  );
}

function normalizeSearchText(value) {
  return String(value || "").toLocaleLowerCase();
}

function parseMaybeJson(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || !(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return { ok: false, value };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (_) {
    return { ok: false, value };
  }
}

function renderPrimitiveStorage(value, key) {
  const row = document.createElement("div");
  row.className = "tree-row";
  row.append(
    renderKey(key),
    document.createTextNode(": "),
    renderPrimitive(value),
  );
  return row;
}

function compactValue(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

function compactUrl(url, options = {}) {
  const { includeOrigin = false, maxLength = LIST_URL_MAX_LENGTH } = options;

  try {
    const parsed = new URL(url);
    const compacted = `${includeOrigin ? parsed.origin : ""}${parsed.pathname}${parsed.search}`;
    return truncateText(compacted || parsed.href, maxLength);
  } catch (_) {
    return truncateText(url, maxLength);
  }
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}
