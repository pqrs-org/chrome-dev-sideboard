# Page Title Bar Privacy Policy

Last updated: September 9, 2026

Page Title Bar displays the current page title and network measurements in Chrome's side panel.

## Information used

While the side panel is open, the extension reads the active tab's title to display it. It uses tab URL information to determine whether network measurements are available.

The extension automatically observes HTTP and HTTPS requests associated with tabs, including while the panel is closed. It processes request identifiers, types, methods, timestamps, completion and failure events, HTTP status codes, cache indicators, and response headers to calculate counts, durations, and available response body sizes.

Only derived measurements and temporary tracking information are retained: per-tab counters, durations, sizes, pending request identifiers and start times, up to 100 recent failed request URLs with methods, timestamps, and error codes per tab, main document identifiers, and the current main document URL used to detect navigation. Usernames, passwords, and fragments are stripped from stored URLs; their paths and queries may still contain private information. Raw headers, cookies, credentials, and response bodies are not stored. Page titles are displayed but not saved.

The extension does not inject scripts into websites, modify or block traffic, or send additional requests to probe a site.

## Storage and retention

Measurements and temporary tracking information use Chrome's in-memory storage.session API. They are not synchronized through Chrome Sync or saved as a persistent browsing-history log. Measurements reset for a new document and are removed when the tab closes. Chrome clears session storage when the browser restarts or the extension is disabled, reloaded, or updated. Closing the side panel does not stop automatic network measurement.

Older title chip versions saved preferences and site positions through Chrome Sync. This version does not read, update, or delete those legacy preferences. Any remaining legacy data is managed through Chrome and your Google account.

## Sharing and purpose

Information is used only to display the current page title and its network measurements. The developer does not receive this information. The extension does not use analytics, advertising, tracking services, or developer-operated servers, and does not send measurements to external services.

The extension does not sell user data or use it for advertising, creditworthiness, or lending decisions. Its use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Permissions

- `tabs`: reads the active tab's title and URL availability and follows tab changes.
- `sidePanel`: displays the title and network measurements alongside the page.
- `webRequest` and HTTP/HTTPS website access: passively observe requests and response metadata to measure traffic.
- `webNavigation`: identifies new main documents, including restored pages, so measurements do not carry over to a different document.
- `storage`: keeps temporary measurements in Chrome session memory across background worker restarts.

## Contact

For privacy questions, open an issue in the [Page Title Bar repository](https://github.com/pqrs-org/chrome-page-title-bar/issues). Issues are public; do not include private page titles, URLs, or other sensitive information.
