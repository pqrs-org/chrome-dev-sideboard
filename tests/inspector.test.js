"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const tick = () => new Promise(setImmediate);
class Element {
  constructor() {
    this.children = [];
    this.textContent = "";
    this.style = {};
    this.listeners = {};
    this.classList = { toggle() {} };
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  focus() {}
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}
test("inspector loads scoped snapshots, filters JSON, copies, and reads storage on demand", async () => {
  const elements = new Map();
  const sent = [];
  let receive;
  let activated;
  let copied;
  const port = {
    postMessage: (m) => sent.push(m),
    onMessage: {
      addListener: (fn) => {
        receive = fn;
      },
    },
    onDisconnect: { addListener() {} },
  };
  const queries = [];
  let poll;
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../src/inspector.js"), "utf8"),
    {
      URL,
      console,
      document: {
        getElementById: (id) => {
          const e = new Element();
          elements.set(id, e);
          return e;
        },
        createElement: () => new Element(),
        createTextNode: (text) => ({ textContent: text }),
      },
      navigator: {
        clipboard: {
          writeText: async (text) => {
            copied = text;
          },
        },
      },
      window: {
        setInterval: (fn) => {
          poll = fn;
        },
        setTimeout: (fn) => {
          fn();
        },
        clearTimeout() {},
      },
      chrome: {
        runtime: { connect: () => port },
        windows: { getCurrent: async () => ({ id: 7 }) },
        tabs: {
          query: async (q) => {
            queries.push(q);
            return [{ id: 1 }];
          },
          onActivated: {
            addListener: (fn) => {
              activated = fn;
            },
          },
          onUpdated: { addListener() {} },
          onRemoved: { addListener() {} },
          onReplaced: { addListener() {} },
        },
      },
    },
  );
  await tick();
  assert.equal(queries[0].windowId, 7);
  assert.equal(
    sent.some((m) => m.type === "getStorage"),
    false,
  );
  activated({ windowId: 8 });
  assert.equal(queries.length, 1);
  receive({
    type: "snapshot",
    tabId: 1,
    records: [
      {
        id: "r",
        method: "GET",
        status: 200,
        ok: true,
        raw: '{"hello":"world"}',
        url: "https://example.com/api",
        timestamp: 1,
      },
    ],
  });
  assert.equal(elements.get("requestList").children.length, 1);
  await elements.get("copyButton").listeners.click();
  assert.equal(copied, '{"hello":"world"}');
  elements.get("filterInput").value = "missing";
  elements.get("filterInput").listeners.input();
  assert.equal(elements.get("requestList").children.length, 0);
  elements.get("storageModeButton").listeners.click();
  assert.equal(sent.at(-1).type, "getStorage");
  receive({
    type: "storageSnapshot",
    tabId: 1,
    snapshot: { local: [{ key: "x", value: "test" }], session: [] },
  });
  await elements.get("copyButton").listeners.click();
  assert.equal(copied, "test");
  const beforePoll = sent.length;
  poll();
  assert.equal(sent.length, beforePoll + 1);
  assert.equal(sent.at(-1).type, "getStorage");
  poll();
  assert.equal(sent.length, beforePoll + 1);
  receive({
    type: "storageSnapshot",
    tabId: 1,
    snapshot: {
      documentId: "doc-1",
      local: [{ key: "settings", value: '{"enabled":false}' }],
      session: [],
    },
  });
  elements.get("editStorageButton").listeners.click();
  assert.equal(elements.get("storageEditor").open, true);
  const beforeEditPoll = sent.length;
  poll();
  assert.equal(sent.length, beforeEditPoll);
  elements.get("storageJsonInput").value = "{";
  elements.get("saveStorageEdit").listeners.click();
  assert.match(elements.get("storageEditStatus").textContent, /Invalid JSON/);
  assert.notEqual(sent.at(-1).type, "setStorage");
  elements.get("storageJsonInput").value = '{"enabled":true}';
  elements.get("saveStorageEdit").listeners.click();
  assert.equal(sent.at(-1).type, "setStorage");
  assert.equal(sent.at(-1).documentId, "doc-1");
  assert.equal(sent.at(-1).expectedValue, '{"enabled":false}');
  receive({
    type: "storageSaved",
    tabId: 1,
    requestId: sent.at(-1).requestId,
    ok: false,
    error: "Value changed",
  });
  assert.equal(elements.get("storageEditor").open, true);
  assert.equal(elements.get("storageJsonInput").value, '{"enabled":true}');
  assert.equal(elements.get("saveStorageEdit").disabled, false);
  elements.get("saveStorageEdit").listeners.click();
  receive({
    type: "storageSaved",
    tabId: 1,
    requestId: sent.at(-1).requestId,
    ok: true,
    snapshot: {
      documentId: "doc-1",
      local: [{ key: "settings", value: '{"enabled":true}' }],
      session: [],
    },
  });
  assert.equal(elements.get("storageEditor").open, false);
  await elements.get("copyButton").listeners.click();
  assert.equal(JSON.parse(copied).enabled, true);
});
