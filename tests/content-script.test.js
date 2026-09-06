"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function createPage(url, stored = {}) {
  const nodes = [];
  const writes = [];
  let onChanged;
  function createElement() {
    const node = {
      style: { setProperty() {} },
      listeners: {},
      setAttribute() {},
      append() {},
      attachShadow: () => ({ append() {} }),
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
      classList: { add() {}, remove() {} },
      setPointerCapture() {},
      getBoundingClientRect() {
        return {
          left: parseFloat(this.style.left) || 8,
          top: parseFloat(this.style.top) || 8,
          width: 100,
          height: 32,
        };
      },
    };
    nodes.push(node);
    return node;
  }
  const window = { innerWidth: 1000, innerHeight: 800, addEventListener() {} };
  window.top = window;
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../src/content-script.js"), "utf8"),
    {
      window,
      location: new URL(url),
      document: {
        title: "Test",
        documentElement: { append() {} },
        head: {},
        getElementById: () => null,
        createElement,
      },
      requestAnimationFrame: (callback) => callback(),
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      chrome: {
        runtime: { onMessage: { addListener() {} } },
        storage: {
          sync: {
            get: async (defaults) => ({ ...defaults, ...stored }),
            set: async (values) =>
              writes.push(JSON.parse(JSON.stringify(values))),
          },
          onChanged: {
            addListener(callback) {
              onChanged = callback;
            },
          },
        },
      },
      console,
    },
  );
  await new Promise(setImmediate);
  return { host: nodes[0], chip: nodes[2], writes, onChanged };
}

test("restores positions by origin across paths and keeps other origins separate", async () => {
  const stored = {
    "chipPosition:https://example.com": { x: 1, y: 1 },
    "chipPosition:https://other.com": { x: 0, y: 0 },
  };
  const first = await createPage("https://example.com/one", stored);
  const second = await createPage("https://example.com/two", stored);
  const other = await createPage("https://other.com/", stored);
  assert.equal(first.host.style.left, "892px");
  assert.equal(second.host.style.left, first.host.style.left);
  assert.equal(other.host.style.left, "8px");
});

test("uses the previous global position when no site position is saved", async () => {
  const page = await createPage("https://example.com/", {
    chipPosition: { x: 1, y: 0 },
  });
  assert.equal(page.host.style.left, "892px");
  const fresh = await createPage("https://example.com/");
  assert.equal(fresh.host.style.left, "450px");
});

test("dragging writes only the current site's position", async () => {
  const page = await createPage("https://example.com/path");
  page.chip.listeners.pointerdown({
    button: 0,
    pointerId: 1,
    clientX: 450,
    clientY: 8,
    preventDefault() {},
  });
  page.host.style.left = "892px";
  page.host.style.top = "760px";
  page.chip.listeners.pointerup({ pointerId: 1 });
  assert.deepEqual(page.writes, [
    { "chipPosition:https://example.com": { x: 1, y: 1 } },
  ]);
});

test("only position changes for the current site move the title", async () => {
  const page = await createPage("https://example.com/");
  page.onChanged(
    { "chipPosition:https://other.com": { newValue: { x: 0, y: 1 } } },
    "sync",
  );
  assert.equal(page.host.style.left, "450px");
  page.onChanged(
    { "chipPosition:https://example.com": { newValue: { x: 1, y: 1 } } },
    "sync",
  );
  assert.equal(page.host.style.left, "892px");
  page.onChanged({ "chipPosition:https://example.com": {} }, "sync");
  assert.equal(page.host.style.left, "450px");
});
