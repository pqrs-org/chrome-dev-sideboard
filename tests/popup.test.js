"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const config = require("../src/shared.js");

async function createPopup(set = async () => {}) {
  const elements = new Map();
  const writes = [];
  const messages = [];
  let registrations = 0;
  const context = vm.createContext({
    PageTitleBarConfig: config,
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) {
          elements.set(selector, {
            value: "",
            listeners: {},
            addEventListener(type, listener) {
              this.listeners[type] = listener;
            },
            reportValidity: () => true,
            classList: { toggle() {} },
          });
        }
        return elements.get(selector);
      },
    },
    chrome: {
      tabs: {
        query: async () => [
          { id: 1, url: "https://example.com/", title: "Test" },
        ],
        sendMessage: async (tabId, message) => {
          messages.push({ tabId, ...JSON.parse(JSON.stringify(message)) });
        },
      },
      storage: {
        sync: {
          get: async () => ({ ...config.DEFAULTS }),
          set: async (settings) => {
            writes.push(JSON.parse(JSON.stringify(settings)));
            await set(settings);
          },
        },
      },
      runtime: {
        sendMessage: async () => {
          registrations++;
          return { ok: true };
        },
      },
      scripting: { executeScript: async () => {} },
    },
  });
  vm.runInContext(
    fs.readFileSync(require.resolve("../src/popup.js"), "utf8"),
    context,
  );
  await new Promise(setImmediate);
  return {
    elements,
    writes,
    messages,
    registrations: () => registrations,
    save: () => vm.runInContext("saveSettings(); saveQueue", context),
  };
}

test("automatically saves appearance without re-registering scripts or duplicate writes", async () => {
  const popup = await createPopup();
  popup.elements.get("#borderColor").value = "#123456";
  await popup.save();
  await popup.save();
  assert.equal(popup.writes.length, 1);
  assert.equal(popup.writes[0].borderColor, "#123456");
  assert.equal(popup.registrations(), 0);
});

test("does not save invalid URL patterns or invalid appearance values", async () => {
  const popup = await createPopup();
  popup.elements.get("#patterns").value = "https://";
  await popup.save();
  assert.equal(popup.writes.length, 0);
  assert.match(
    popup.elements.get("#status").textContent,
    /Invalid URL pattern/,
  );
  popup.elements.get("#patterns").value = "";
  popup.elements.get("#form").reportValidity = () => false;
  await popup.save();
  assert.equal(popup.writes.length, 0);
});

test("saves valid URL changes and updates script registration", async () => {
  const popup = await createPopup();
  popup.elements.get("#patterns").value = "https://example.com/*";
  await popup.save();
  assert.deepEqual(popup.writes[0].patterns, ["https://example.com/*"]);
  assert.equal(popup.registrations(), 1);
});

test("serializes rapid changes and preserves newer input while saving", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const popup = await createPopup(() => pending);
  popup.elements.get("#fontSize").value = "20";
  const first = popup.save();
  await new Promise(setImmediate);
  popup.elements.get("#fontSize").value = "24";
  const second = popup.save();
  assert.equal(popup.writes.length, 1);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(
    popup.writes.map((settings) => settings.fontSize),
    [20, 24],
  );
  assert.equal(popup.elements.get("#fontSize").value, "24");
});

test("previews all picker colors immediately without saving until change", async () => {
  const popup = await createPopup();
  for (const key of ["backgroundColor", "textColor", "borderColor"]) {
    const picker = popup.elements.get(`#${key}`);
    picker.value = "#123456";
    picker.listeners.input();
    picker.value = "#abcdef";
    picker.listeners.input();
    assert.deepEqual(popup.messages.at(-1), {
      tabId: 1,
      type: "preview-title-bar-color",
      key,
      value: "#abcdef",
    });
  }
  assert.equal(popup.messages.length, 6);
  assert.equal(popup.writes.length, 0);
  popup.elements.get("#form").listeners.change();
  await new Promise(setImmediate);
  assert.equal(popup.writes.length, 1);
  assert.equal(popup.writes[0].borderColor, "#abcdef");
});
