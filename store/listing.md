# Chrome Web Store listing

Draft for Dev Sideboard 1.1.0. Review before submission.

## Name

Dev Sideboard

## Summary

Inspect network activity, storage, and cookies in the side panel.

## Detailed description

Keep the page title and network activity visible while you work.

Click the extension icon to open a side panel that follows the active tab in its window. Long page titles wrap across lines.

- Track requests, requests in progress, final HTTP errors, and request failures.
- Compare average and longest completed request durations.
- View known final response sizes, with unknown sizes and cache hits counted separately.

Measurement starts automatically for HTTP and HTTPS traffic. Reload an existing page to measure it from the beginning. Reloading or opening a new document resets totals; switching tabs preserves each tab's totals. SPA navigation continues the same measurement.

Durations include downloads, redirects, and authentication waits. Sizes use available Content-Length response headers and are not total network usage. Some browser, cache, and worker traffic cannot be observed.

The Page tab displays Canonical URLs, descriptions, Open Graph, and Twitter Card tags, with updates when tags change and image previews.

The Storage and Cookies tabs provide filtering, JSON tree expansion, raw text viewing, editing, and deletion. Values refresh automatically while the inspector is visible.

The extension processes page titles, URLs, page metadata, network metadata, and inspected storage and cookie values. It does not capture response bodies. Network measurements stay in Chrome session memory and clear when the tab closes or Chrome restarts. Storage and cookie snapshots are not persisted by the extension. No inspection data is sent to the developer. Image previews make ordinary image requests to the hosts specified by the page, without a Referer header.

Requires Chrome 116 or later.

## Category and language

Use the closest available productivity/tools category. Default listing language: English (matches the current interface).

## URLs

- Homepage: https://github.com/pqrs-org/chrome-dev-sideboard
- Support: https://github.com/pqrs-org/chrome-dev-sideboard/issues
- Privacy policy: https://github.com/pqrs-org/chrome-dev-sideboard/blob/main/PRIVACY.md

The privacy URL is a proposed location. Publish PRIVACY.md and verify that it is publicly accessible without signing in before entering it in the dashboard.
