# chrome-page-title-bar

A Chrome extension that displays the page title, network measurements, JSON responses, and website storage in the side panel.

## Features

- Open the side panel directly from the extension icon
- Read the full page title, with automatic line wrapping
- Follow the active tab in each window
- Inspect JSON fetch/XHR responses and local/session storage
- Filter requests by URL, payload, method, or errors; search, expand, collapse, and copy JSON trees
- Track request counts, requests in progress, HTTP errors, and request failures
- Click HTTP error or request failure counts to inspect URLs and error codes (latest 100 failures per tab)
- See average and longest completed request durations
- See known final response body sizes, unknown-size responses, and cached responses

## Installation

Requires Chrome 116 or later.

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this directory.
4. Pin Page Title Bar to the toolbar and click its icon to open the side panel.
5. Reload the page to measure it from the beginning.

HTTP and HTTPS traffic is observed automatically using the requested website permissions.
No debugger connection or start button is needed. JSON capture wraps page fetch/XHR APIs at document start, including HTTP/HTTPS subframes. It reads response copies without changing request parameters or sending probe requests. Reload existing pages after installing or updating.

## Measurement scope

A new main-document request starts a fresh measurement, including on reload. Tab switching preserves each tab's measurements. SPA history changes keep the same totals. Restored documents without a newly observed main request start a partial measurement; requests from before observation are not reconstructed.

Each request ID counts once, including its redirects and authentication retries. Average and longest durations run from the first observed request start to successful completion (including HTTP error responses), with failed requests excluded. They include download time, redirects, and authentication waits; they are not server-only response time or total page load time. HTTP errors count final 4xx/5xx responses; request failures include cancellations and cache-related errors.

Known response size sums available Content-Length values from final completed responses, excluding cache hits, 304 responses, and bodies that were not downloaded. Headers, intermediate redirect responses, failed downloads, upload traffic, and WebSocket messages are excluded. Missing lengths are counted separately. This is not total network usage.

Only requests Chrome exposes and associates with a tab can be counted. Some cache, worker, internal, and preflight activity may be absent. These figures are not guaranteed to match DevTools. If more than 1,000 requests are simultaneously pending per tab, the oldest detailed measurements are omitted and the panel reports the omission count.

Measurements use in-memory Chrome session storage. They survive background worker suspension and closing the panel, but are cleared when the tab closes, the browser restarts, or the extension reloads.

When upgrading from the title chip version, reload pages that still show the old chip.

## JSON and storage inspection

Below the compact network summary, the Fetch / Storage view integrates the tools from `tekezo/chrome-devtools`. JSON-like fetch/XHR responses are captured automatically, even when the panel is closed. Worker requests and requests made before the capture script starts are not included. Fetch capture stops reading at 1 MiB; saved payload text is limited to 100,000 characters per record. Each tab retains at most 80 records and 512,000 serialized characters in session memory, with older records evicted first. Chrome's shared session quota may further limit capture. Truncated payloads are shown as text. JSON trees display at most 5,000 nodes and 100 nesting levels.

History resets on a new document and is removed on tab close or browser restart. Local Storage and Session Storage are read from the top frame when opening the Storage view or using Refresh, and automatically about once per second while the Storage view is visible; these values are not persisted by the extension. Copy writes the selected payload or storage value to the clipboard. Captured data may contain private application data. Page scripts can interfere with or imitate capture events, so this is a development aid rather than a tamper-proof network trace.

Storage auto-refresh pauses while editing JSON. It reads website storage locally and does not reload the page or send network requests.

Storage JSON values can be edited using Edit JSON and saved explicitly. Save updates only the selected Local Storage or Session Storage key on the inspected document; invalid JSON and values changed since inspection are rejected. Edits are saved to the website’s storage, not to extension history. The page may need to be reloaded to use the new value.

## Development

There are no runtime dependencies. Run the tests with:

```sh
make test
```

## Publishing

Run `make package` to check the source and build the upload ZIP in `dist/`.
See [store listing](store/listing.md), [submission notes](store/submission.md),
and the [privacy policy](PRIVACY.md) for the publication materials.
