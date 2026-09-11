# Chrome Web Store submission notes

## Single purpose

Inspect the active page's title, metadata, network activity, website storage, and cookies in Chrome's side panel.

## Permission justifications

### tabs

Reads the active tab's title for display and URL to determine network measurement availability. Follows the active tab within the panel's own window.

### sidePanel

Displays the page title, network summary, page metadata, storage, and cookies in a panel opened from the extension icon.

### webRequest

Passively observes HTTP/HTTPS request lifecycle events to display request counts, durations, HTTP errors, and request failures. Response headers provide Content-Length estimates. No blocking options are used; network measurement does not modify requests.

### Host permissions

HTTP/HTTPS host access lets users inspect any website they visit. Network observation requires access to requested URLs and initiators, including cross-origin resources. An isolated top-frame content script reads page metadata and reads, edits, or deletes Local Storage and Session Storage entries through internal extension messages. Host access also allows the cookies API to inspect and modify cookies for the active page. Same-origin HTTPS image previews are fetched by the content script without credentials and with redirects rejected. Other-origin HTTPS previews use the extension's host permissions to fetch images without requiring the image server to allow CORS. These requests omit credentials and use targetAddressSpace: public to exclude local-network destinations, including redirects.

### webNavigation

Identifies main-document commits and restored pages so measurements reset when the document changes. SPA history updates keep the existing measurement. Resolves the current main document ID and URL to pin storage operations and image access to the inspected document.

### storage

Uses only storage.session to retain per-tab measurements and temporary pending-request metadata across service worker restarts. Current document URLs and identifiers support navigation matching. Up to 100 recent failures per tab retain URLs, methods, timestamps, and error codes for the details dialog. Data is cleared when tabs close or Chrome restarts; no measurements are persisted to disk or synchronized.

### cookies

Reads cookies matching the inspected top-level page URL, including HttpOnly and supported partitioned cookies, and updates a selected value on explicit Save or deletes the selected cookie on Delete. Snapshots are kept only in panel memory. Cookie values may contain authentication information and should be included in applicable data disclosures.

## Remote code

No, I am not using remote code.
