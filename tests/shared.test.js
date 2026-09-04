"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULTS,
  isValidPattern,
  normalizePatterns,
  patternForUrl,
  patternMatchesUrl,
} = require("../src/shared.js");

test("uses a normalized top-center position for the title chip", () => {
  assert.deepEqual(DEFAULTS.chipPosition, { x: 0.5, y: 0 });
});

test("normalizes pattern input", () => {
  assert.deepEqual(
    normalizePatterns(" https://example.com/*\n\nhttps://example.com/* "),
    ["https://example.com/*"],
  );
});

test("validates supported Chrome match patterns", () => {
  assert.equal(isValidPattern("https://*.office.com/*"), true);
  assert.equal(isValidPattern("file:///*"), false);
  assert.equal(isValidPattern("https://example.com"), false);
});

test("matches exact and wildcard hosts", () => {
  assert.equal(
    patternMatchesUrl("https://example.com/*", "https://example.com/book/1"),
    true,
  );
  assert.equal(
    patternMatchesUrl("https://*.office.com/*", "https://excel.office.com/a"),
    true,
  );
  assert.equal(
    patternMatchesUrl("https://*.office.com/*", "https://office.com/a"),
    true,
  );
  assert.equal(
    patternMatchesUrl("https://*.office.com/*", "https://example.com/a"),
    false,
  );
});

test("builds a site pattern from a URL", () => {
  assert.equal(
    patternForUrl("https://example.com:8443/path"),
    "https://example.com/*",
  );
  assert.equal(patternForUrl("chrome://extensions"), null);
});
