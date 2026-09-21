# Chrome Web Store submission notes

## Single purpose

Inspect and adjust the active page's development environment in Chrome's side panel: view its title, metadata, network activity, and dimensions; resize the window or viewport; and inspect or edit website storage and cookies.

## Permission justifications

### tabs

Reads the active tab's title for display and URL to determine network measurement availability. Follows the active tab within the panel's own window.

### sidePanel

Displays Overview, Storage, and Cookies tabs in a panel opened from the extension icon. Overview includes the page title, network summary, window and viewport sizing controls, and page metadata.

### webRequest

Passively observes HTTP/HTTPS request lifecycle events to display request counts, durations, HTTP errors, and request failures. Response headers provide Content-Length estimates. No blocking options are used; network measurement does not modify requests.

### Host permissions

HTTP/HTTPS host access lets users inspect any website they visit. Network observation requires access to requested URLs and initiators, including cross-origin resources. An isolated top-frame content script reads page metadata and viewport dimensions, and reads, edits, or deletes Local Storage and Session Storage entries through internal extension messages. Host access also allows the cookies API to inspect and modify cookies for the active page. Same-origin HTTPS image previews are fetched by the content script without credentials and with redirects rejected. Other-origin HTTPS previews use the extension's host permissions to fetch images without requiring the image server to allow CORS. These requests omit credentials and use targetAddressSpace: public to exclude local-network destinations, including redirects.

### webNavigation

Identifies main-document commits and restored pages so measurements reset when the document changes. SPA history updates keep the existing measurement. Resolves the current main document ID and URL to pin storage operations, image access, and viewport measurements to the inspected document.

### storage

Uses storage.session to retain per-tab measurements and temporary pending-request metadata across service worker restarts. Current document URLs and identifiers support navigation matching. Up to 100 recent failures per tab retain URLs, methods, timestamps, and error codes for the details dialog. These measurements are cleared when tabs close or Chrome restarts; they are not persisted to disk or synchronized.

Uses storage.local to save up to 20 recently applied values for each window and viewport width and height, without page URLs. This size history persists across browser sessions, is not synchronized, and lets users reuse dimensions or delete individual entries from the history menus. It is removed when the extension is uninstalled.

### cookies

Reads cookies matching the inspected top-level page URL, including HttpOnly and supported partitioned cookies, and updates a selected value on explicit Save or deletes the selected cookie on Delete. Snapshots are kept only in panel memory. Cookie values may contain authentication information and should be included in applicable data disclosures.

## Remote code

No, I am not using remote code.
