# Chrome Web Store listing

Draft for Page Title Bar 1.1.0. Review before submission.

## Name

Page Title Bar

## Summary

Displays the page title, request counts, response times, and response sizes in the side panel.

## Detailed description

Keep the page title and network activity visible while you work.

Click the extension icon to open a side panel that follows the active tab in its window. Long page titles wrap across lines.

- Track requests, requests in progress, final HTTP errors, and connection failures.
- Compare average and longest completed request durations.
- View known final response sizes, with unknown sizes and cache hits counted separately.

Measurement starts automatically for HTTP and HTTPS traffic. Reload an existing page to measure it from the beginning. Reloading or opening a new document resets totals; switching tabs preserves each tab's totals. SPA navigation continues the same measurement.

Durations include downloads, redirects, and authentication waits. Sizes use available Content-Length response headers and are not total network usage. Some browser, cache, and worker traffic cannot be observed.

The extension passively observes traffic without injecting page scripts, changing requests, or connecting a debugger. It processes titles, URLs, request metadata, and response headers to provide the display. Measurements and temporary tracking information stay in Chrome session memory and clear when the tab closes or Chrome restarts. They are not sent to the developer. There are no analytics or advertising services.

Requires Chrome 116 or later.

## Category and language

Use the closest available productivity/tools category. Default listing language: English (matches the current interface).

## URLs

- Homepage: https://github.com/pqrs-org/chrome-page-title-bar
- Support: https://github.com/pqrs-org/chrome-page-title-bar/issues
- Privacy policy: https://github.com/pqrs-org/chrome-page-title-bar/blob/main/PRIVACY.md

The privacy URL is a proposed location. Publish PRIVACY.md and verify that it is publicly accessible without signing in before entering it in the dashboard.
