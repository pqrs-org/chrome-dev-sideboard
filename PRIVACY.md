# Dev Sideboard Privacy Policy

Last updated: September 9, 2026

Dev Sideboard helps you inspect page information, network activity, website storage, and cookies in Chrome’s side panel.

## Data and purpose

The extension uses the following data to provide its inspection features:

- Page titles, URLs, and metadata such as canonical links and Open Graph tags.
- HTTP/HTTPS request metadata, response headers, network measurements, and errors. Network monitoring operates automatically, including while the panel is closed.
- Local Storage and Session Storage keys and values, and cookies matching the active page URL, including HttpOnly cookies and cookie attributes. These views refresh automatically while visible.

URLs, storage values, and cookies may contain personal information, authentication tokens, or other sensitive data. Saving an edit or deleting an entry changes the selected website storage item or browser cookie.

## Storage and retention

All inspection data is processed locally in your browser. Network measurements are stored temporarily in browser session memory, reset on navigation to a new document, and removed when the tab closes. They are also cleared when Chrome restarts or the extension is disabled, reloaded, or updated.

## Sharing

The extension does not send inspection data to the developer. The developer does not receive any data from the extension. Image previews load from the URLs specified by the page, so those image hosts receive ordinary image requests, including your IP address. No Referer header is sent.

Its use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

For privacy questions, open an issue in the [Dev Sideboard repository](https://github.com/pqrs-org/chrome-dev-sideboard/issues). Issues are public; do not include sensitive information.
