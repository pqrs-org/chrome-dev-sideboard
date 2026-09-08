"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeEvent,
  reduce,
  formatBytes,
} = require("../src/network-stats.js");

function tracker() {
  let state;
  return {
    get state() {
      return state;
    },
    send(kind, values = {}) {
      state = reduce(
        state,
        normalizeEvent(kind, {
          tabId: 1,
          requestId: "1",
          type: "main_frame",
          method: "GET",
          url: "https://example.com/",
          timeStamp: 1000,
          ...values,
        }),
      );
      return state;
    },
  };
}
const header = (name, value) => ({ name, value });

test("measures completed request chains and keeps HTTP and connection errors separate", () => {
  const t = tracker();
  t.send("start");
  t.send("headers", {
    statusCode: 200,
    responseHeaders: [header("Content-Length", "1024")],
  });
  t.send("complete", { statusCode: 200, timeStamp: 1200 });
  t.send("start", { requestId: "2", type: "xmlhttprequest", timeStamp: 1300 });
  t.send("headers", { requestId: "2", statusCode: 404 });
  t.send("complete", { requestId: "2", statusCode: 404, timeStamp: 1400 });
  t.send("start", { requestId: "3", type: "image" });
  t.send("error", { requestId: "3", timeStamp: 1500 });
  assert.equal(t.state.requests, 3);
  assert.equal(t.state.completed, 2);
  assert.equal(t.state.httpErrors, 1);
  assert.equal(t.state.networkErrors, 1);
  assert.equal(t.state.durationTotal / t.state.durationCount, 150);
  assert.equal(t.state.durationMax, 200);
  assert.equal(t.state.knownBytes, 1024);
  assert.equal(t.state.unknownSizes, 1);
  assert.deepEqual(t.state.pending, {});
});

test("redirects count once, retain chain timing, and exclude intermediate sizes", () => {
  const t = tracker();
  t.send("start");
  t.send("headers", {
    statusCode: 302,
    responseHeaders: [header("Content-Length", "999")],
  });
  t.send("redirect");
  t.send("start", { url: "https://example.com/final", timeStamp: 1100 });
  t.send("headers", {
    statusCode: 200,
    responseHeaders: [header("Content-Length", "20")],
  });
  t.send("complete", { statusCode: 200, timeStamp: 1300 });
  assert.equal(t.state.requests, 1);
  assert.equal(t.state.durationTotal, 300);
  assert.equal(t.state.knownBytes, 20);
});

test("cache, missing lengths, and HEAD responses are not treated as transferred bytes", () => {
  const t = tracker();
  t.send("start");
  t.send("headers", {
    statusCode: 200,
    responseHeaders: [header("Content-Length", "500")],
  });
  t.send("complete", { statusCode: 200, fromCache: true });
  t.send("start", { requestId: "2", type: "xmlhttprequest", method: "HEAD" });
  t.send("headers", {
    requestId: "2",
    statusCode: 200,
    responseHeaders: [header("Content-Length", "1000")],
  });
  t.send("complete", { requestId: "2", statusCode: 200 });
  t.send("start", { requestId: "3", type: "image" });
  t.send("headers", {
    requestId: "3",
    statusCode: 200,
    responseHeaders: [header("Content-Length", "invalid")],
  });
  t.send("complete", { requestId: "3", statusCode: 200 });
  assert.equal(t.state.knownBytes, 0);
  assert.equal(t.state.knownSizes, 1);
  assert.equal(t.state.cached, 1);
  assert.equal(t.state.unknownSizes, 1);
});

test("new documents reset totals and old completions do not contaminate them", () => {
  const t = tracker();
  t.send("start");
  t.send("start", { requestId: "old", type: "image" });
  t.send("start", {
    requestId: "new",
    url: "https://example.com/next",
    timeStamp: 2000,
  });
  t.send("complete", { requestId: "old", statusCode: 200, timeStamp: 2200 });
  assert.equal(t.state.requests, 1);
  assert.equal(t.state.completed, 0);
  t.send("commit", {
    url: "https://example.com/next",
    documentId: "new-doc",
    timeStamp: 2300,
  });
  assert.equal(t.state.requests, 1);
  t.send("commit", {
    url: "https://example.com/",
    documentId: "restored-doc",
    timeStamp: 3000,
  });
  assert.equal(t.state.requests, 0);
  assert.equal(t.state.scope, "partial");
});

test("observation can begin mid-page and survives JSON session serialization", () => {
  const t = tracker();
  t.send("start", { type: "xmlhttprequest" });
  assert.equal(t.state.scope, "partial");
  const state = JSON.parse(JSON.stringify(t.state));
  reduce(
    state,
    normalizeEvent("complete", {
      requestId: "1",
      timeStamp: 1100,
      statusCode: 200,
    }),
  );
  assert.equal(state.completed, 1);
  assert.equal(state.durationTotal, 100);
});

test("normalized measurements omit credentials and raw header data", () => {
  const normalized = normalizeEvent("headers", {
    type: "main_frame",
    url: "https://user:password@example.com/path#fragment",
    statusCode: 401,
    responseHeaders: [
      header("WWW-Authenticate", 'Basic realm="private realm"'),
      header("Set-Cookie", "private-cookie"),
    ],
  });
  assert.equal(normalized.url, "https://example.com/path");
  assert.equal(Object.hasOwn(normalized, "auth"), false);
  assert.equal(JSON.stringify(normalized).includes("private"), false);
  assert.equal(formatBytes(1024), "1.0 KiB");
});

test("failure details retain sanitized final URLs and codes, cap history, and reset on navigation", () => {
  const t = tracker();
  t.send("start");
  t.send("complete", { statusCode: 200 });
  for (let i = 0; i < 102; i++) {
    const details = {
      requestId: String(i + 2),
      type: "image",
      url: `https://user:secret@example.com/${i}#fragment`,
    };
    t.send("start", details);
    t.send(i % 2 ? "error" : "complete", {
      ...details,
      error: "net::ERR_CONNECTION_REFUSED",
      statusCode: 404,
    });
  }
  assert.equal(t.state.networkErrors, 51);
  assert.equal(t.state.httpErrors, 51);
  assert.equal(t.state.failureDetails.length, 100);
  assert.equal(t.state.failureDetails[0].url, "https://example.com/2");
  assert.equal(t.state.failureDetails[0].reason, "HTTP 404");
  assert.equal(
    t.state.failureDetails[99].reason,
    "net::ERR_CONNECTION_REFUSED",
  );
  assert.equal(JSON.stringify(t.state).includes("secret"), false);
  t.send("start", { requestId: "new-page" });
  assert.deepEqual(t.state.failureDetails, []);
});
