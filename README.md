# Dev Sideboard

A Chrome extension that displays the page title, metadata, network measurements, website storage, and cookies in the side panel.

## Features

- Open the side panel directly from the extension icon
- Read the full page title, with automatic line wrapping
- Follow the active tab in each window
- Inspect Canonical URLs, descriptions, Open Graph, and Twitter Card tags
- Inspect, edit, and delete Local Storage, Session Storage, and Cookie values
- Filter storage keys and values; search, expand, collapse, and switch between JSON trees and raw text
- Track request counts, requests in progress, HTTP errors, and request failures
- Click HTTP error or request failure counts to inspect URLs and error codes (latest 100 failures per tab)
- See average and longest completed request durations
- See known final response body sizes, unknown-size responses, and cached responses

## Installation

Requires Chrome 116 or later.

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this directory.
4. Pin Dev Sideboard to the toolbar and click its icon to open the side panel.
5. Reload the page to measure it from the beginning.

HTTP and HTTPS traffic is observed automatically using the requested website permissions.
No debugger connection or start button is needed. Reload already open pages after installing or updating the extension to refresh its content scripts.

## Measurement scope

A new main-document request starts a fresh measurement, including on reload. Tab switching preserves each tab's measurements. SPA history changes keep the same totals. Restored documents without a newly observed main request start a partial measurement; requests from before observation are not reconstructed.

Each request ID counts once, including its redirects and authentication retries. Average and longest durations run from the first observed request start to successful completion (including HTTP error responses), with failed requests excluded. They include download time, redirects, and authentication waits; they are not server-only response time or total page load time. HTTP errors count final 4xx/5xx responses; request failures include cancellations and cache-related errors.

Known response size sums available Content-Length values from final completed responses, excluding cache hits, 304 responses, and bodies that were not downloaded. Headers, intermediate redirect responses, failed downloads, upload traffic, and WebSocket messages are excluded. Missing lengths are counted separately. This is not total network usage.

Only requests Chrome exposes and associates with a tab can be counted. Some cache, worker, internal, and preflight activity may be absent. These figures are not guaranteed to match DevTools. If more than 1,000 requests are simultaneously pending per tab, the oldest detailed measurements are omitted and the panel reports the omission count.

Measurements use in-memory Chrome session storage. They survive background worker suspension and closing the panel, but are cleared when the tab closes, the browser restarts, or the extension reloads.

## Page metadata

The Page tab shows Canonical URLs, descriptions, Open Graph, and Twitter Card tags from the active page’s DOM. Open Graph takes priority; Twitter Card is shown only when Open Graph tags are absent. Duplicate tags are preserved and relative canonical links are resolved against the document base URL. Metadata is read when the Page tab opens and updates when relevant tags change. Open Graph and Twitter images appear as previews below their URLs; loading previews requests those images from their hosts without sending a Referer header.

## Storage and cookie inspection

Below the compact network summary, separate Storage and Cookies tabs provide inspection and editing. Local Storage and Session Storage are read from the top frame; cookies are read through Chrome’s cookie API. Values refresh about once per second while the inspector is visible and are not persisted by the extension.

Raw displays the original stored value. JSON values can be searched and expanded as trees, with a display limit of 5,000 nodes and 100 nesting levels. Storage and cookie values may contain private application data.

Auto-refresh pauses while editing a value. It reads website storage locally and does not reload the page or send network requests.

Storage values can be edited using Edit and saved explicitly. Non-JSON values, including empty strings and whitespace, are saved exactly as entered. Save updates only the selected Local Storage or Session Storage key on the inspected document; invalid JSON and values changed since inspection are rejected. Edits are saved to the website’s storage, not to extension history. The page may need to be reloaded to use the new value.

Cookies matching the active page URL are listed in Cookies, including HttpOnly cookies. Edit saves the raw value without decoding it, preserving domain, path, expiry, Secure, HttpOnly, SameSite, cookie store, and partition attributes. Cookies refresh while the Cookies tab is visible and are not retained in extension history. Partitioned cookies are included when Chrome provides `cookies.getPartitionKey` (Chrome 132+); older supported versions show unpartitioned cookies.

Delete removes only the selected Local Storage / Session Storage key or Cookie. Changes since inspection are rejected. Cookie deletion expires the exact domain, path, store, and partition, preserving other same-name cookies. Deletions apply to website/browser data and are not saved in extension history.

## Development

There are no runtime dependencies. Run the tests with:

```sh
make test
```

## Publishing

Run `make package` to check the source and build the upload ZIP in `dist/`.
See [store listing](store/listing.md), [submission notes](store/submission.md),
and the [privacy policy](PRIVACY.md) for the publication materials.
