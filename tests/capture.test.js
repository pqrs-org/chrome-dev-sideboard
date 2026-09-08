"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const tick = () => new Promise(setImmediate);
function event() {
  const listeners = [];
  return {
    addListener: (fn) => listeners.push(fn),
    emit: (...args) => listeners.forEach((fn) => fn(...args)),
  };
}
function worker(stored = {}) {
  let documentId = "doc-1";
  const runtime = { onMessage: event(), onConnect: event() };
  const tabs = { onRemoved: event(), onReplaced: event() };
  const navigation = {
    onCommitted: event(),
    getFrame: async () => ({ documentId }),
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../src/capture-background.js"), "utf8"),
    {
      URL,
      console,
      chrome: {
        runtime,
        tabs,
        webNavigation: navigation,
        storage: {
          session: {
            get: async (key) => ({ [key]: structuredClone(stored[key]) }),
            set: async (value) => Object.assign(stored, structuredClone(value)),
            remove: async (key) => {
              delete stored[key];
            },
          },
        },
      },
    },
  );
  return {
    runtime,
    tabs,
    navigation,
    setDocument: (id) => {
      documentId = id;
    },
  };
}
test("capture history survives restart, rejects old documents and clears on navigation and close", async () => {
  const stored = {};
  let w = worker(stored);
  const sender = { tab: { id: 1 }, frameId: 0, documentId: "doc-1" };
  const record = {
    type: "json-fetch-visualizer:record",
    payload: {
      id: "1",
      url: "https://user:pass@example.com/a#secret",
      raw: '{"ok":true}',
      status: 200,
      ok: true,
    },
  };
  w.runtime.onMessage.emit(record, sender);
  await tick();
  assert.equal(stored["captures:1"].records[0].url, "https://example.com/a");
  w = worker(stored);
  w.runtime.onMessage.emit(
    { ...record, payload: { ...record.payload, id: "2" } },
    sender,
  );
  await tick();
  assert.equal(stored["captures:1"].records.length, 2);
  w.setDocument("doc-2");
  w.navigation.onCommitted.emit({ tabId: 1, frameId: 0, documentId: "doc-2" });
  w.runtime.onMessage.emit(record, sender);
  await tick();
  assert.equal(stored["captures:1"], undefined);
  w.runtime.onMessage.emit(record, { ...sender, documentId: "doc-2" });
  await tick();
  assert.equal(stored["captures:1"].records.length, 1);
  w.tabs.onRemoved.emit(1);
  await tick();
  assert.equal(stored["captures:1"], undefined);
});
test("capture bounds both individual payload and overall session history", async () => {
  const stored = {};
  const w = worker(stored);
  for (let i = 0; i < 85; i++)
    w.runtime.onMessage.emit(
      {
        type: "json-fetch-visualizer:record",
        payload: { id: String(i), raw: "x".repeat(120000) },
      },
      { tab: { id: 1 }, frameId: 0, documentId: "doc-1" },
    );
  await tick();
  const records = stored["captures:1"].records;
  assert.ok(records.length <= 80);
  assert.ok(
    records.reduce((n, r) => n + JSON.stringify(r).length, 0) <= 512000,
  );
  assert.equal(records.at(-1).raw.length, 100000);
  assert.equal(records.at(-1).truncated, true);
});
test("fetch capture preserves the response and limits clone reads", async () => {
  const messages = [];
  let response = new Response('{"hello":"world"}', {
    headers: { "Content-Type": "application/json" },
  });
  const window = {
    fetch: async () => response,
    postMessage: (m) => messages.push(m),
  };
  function XHR() {}
  XHR.prototype.open = function () {};
  XHR.prototype.send = function () {};
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../src/capture.js"), "utf8"),
    {
      window,
      XMLHttpRequest: XHR,
      URL,
      TextDecoder,
      performance,
      crypto: { randomUUID: () => "session" },
      location: { href: "https://example.com/" },
    },
  );
  const actual = await window.fetch("/api");
  assert.equal(actual, response);
  assert.deepEqual(await actual.json(), { hello: "world" });
  for (let i = 0; i < 10 && messages.length < 2; i++) await tick();
  assert.equal(messages.at(-1).payload.raw, '{"hello":"world"}');
  assert.equal(messages.at(-1).payload.url, "https://example.com/api");
  response = new Response('"' + "x".repeat(1024 * 1024) + '"', {
    headers: { "Content-Type": "application/json" },
  });
  const large = await window.fetch("/large");
  assert.equal((await large.text()).length, 1024 * 1024 + 2);
  for (let i = 0; i < 10 && messages.length < 3; i++) await tick();
  assert.equal(messages.at(-1).payload.truncated, true);
});
