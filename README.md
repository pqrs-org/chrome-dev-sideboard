# chrome-page-title-bar

A Chrome extension that displays the page title and passive network measurements in the side panel.

## Features

- Open the side panel directly from the extension icon
- Read the full page title, with automatic line wrapping
- Follow the active tab in each window
- Track request counts, requests in progress, HTTP errors, and connection failures
- Click HTTP error or connection failure counts to inspect URLs and error codes (latest 100 failures per tab)
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
No debugger connection or start button is needed. The extension does not inject scripts into pages,
modify requests, or send additional requests to probe a site.

## Measurement scope

A new main-document request starts a fresh measurement, including on reload. Tab switching preserves each tab's measurements. SPA history changes keep the same totals. Restored documents without a newly observed main request start a partial measurement; requests from before observation are not reconstructed.

Each request ID counts once, including its redirects and authentication retries. Average and longest durations run from the first observed request start to successful completion (including HTTP error responses), with failed connections excluded. They include download time, redirects, and authentication waits; they are not server-only response time or total page load time. HTTP errors count final 4xx/5xx responses; connection failures include cancellations.

Known response size sums available Content-Length values from final completed responses, excluding cache hits, 304 responses, and bodies that were not downloaded. Headers, intermediate redirect responses, failed downloads, upload traffic, and WebSocket messages are excluded. Missing lengths are counted separately. This is not total network usage.

Only requests Chrome exposes and associates with a tab can be counted. Some cache, worker, internal, and preflight activity may be absent. These figures are not guaranteed to match DevTools. If more than 1,000 requests are simultaneously pending per tab, the oldest detailed measurements are omitted and the panel reports the omission count.

Measurements use in-memory Chrome session storage. They survive background worker suspension and closing the panel, but are cleared when the tab closes, the browser restarts, or the extension reloads.

When upgrading from the title chip version, reload pages that still show the old chip.

## Development

There are no runtime dependencies. Run the tests with:

```sh
make test
```

## Publishing

Run `make package` to check the source and build the upload ZIP in `dist/`.
See [store listing](store/listing.md), [submission notes](store/submission.md),
and the [privacy policy](PRIVACY.md) for the publication materials.
