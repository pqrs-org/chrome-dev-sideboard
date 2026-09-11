# Chrome Web Store submission notes

Prepared for version 1.2.0. These are draft answers based on the current code; they have not been submitted.

## Publication settings

- Publisher declaration: non-trader (confirmed by the publisher).
- Visibility: Public (confirmed by the publisher).
- Distribution regions: leave the dashboard default as a draft; the publisher has not specified regions.

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

Select “No, I am not using remote code.” All executable JavaScript and styles are packaged with the extension.

## Data usage

Disclose locally handled data as required by Chrome's policy:

- Web history / web browsing activity: tab URLs and network activity are processed. The current main document URL and request metadata are retained temporarily in session memory.
- Authentication information: inspected cookies and website storage may contain authentication cookies or tokens. They are handled locally, are not sent to the developer, and are changed only by explicit edit/delete actions.
- Website content: the page title, page metadata, and response metadata are processed. Page metadata updates when relevant tags change. Image previews load from page-specified image hosts without browser credentials. Local Storage and Session Storage values refresh about once per second while the Storage view is visible; polling pauses while editing. These snapshots are not persisted by the extension. Such content can include personal information or authentication tokens; review applicable dashboard categories.

Review the current dashboard category definitions against PRIVACY.md. Raw response headers can contain sensitive information even though they are not retained. Do not claim that this extension handles no user data or only operates while its panel is open.

The implementation does not sell data, use it for unrelated purposes, or use it for creditworthiness/lending. The publisher should review the policy before accepting the corresponding certifications.

## Reviewer test instructions

No login or paid account is required for the basic panel. Use Chrome 142 or later.

1. Install the extension and open https://example.com/.
2. Click the extension icon and reload the page. Verify the page title, request counts, and duration statistics.
3. Switch between tabs and windows. Each panel follows its own window and each tab retains separate totals.
4. On a test site, load a missing resource and a resource from an unreachable endpoint. Check HTTP errors and request failures respectively. Click their counts to inspect URLs and error codes.
5. Observe a response with Content-Length, a response without it, and cached responses. Verify that known sizes and unknown/cache counts remain separate.
6. Reload or navigate to another document and verify reset. SPA history changes retain totals.
7. Close and reopen the panel. Network measurements remain in this session. Restart Chrome and reload a page to begin a new measurement.
8. Open Page on a site with metadata and verify Canonical URL and Open Graph fields. Verify image previews and the per-image reload icon. Change a tag in the page and verify automatic updates.
9. Open Storage and verify Local Storage and Session Storage values, automatic refresh, filtering, JSON tree expansion/collapse, and Raw. Edit JSON and plain-text values, and delete an item; verify only the selected key changes.
10. Open Cookies and verify values, attributes, and automatic refresh. Edit and delete a test cookie and verify only the selected cookie changes.

## Release checklist

- Run `make package`; upload `dist/dev-sideboard-1.2.0.zip` as a new item.
- Complete publisher registration, verified contact information, and two-step verification. Declare non-trader as specified by the publisher.
- Use the public PRIVACY.md URL in listing.md. Publish the updated policy to the main branch before submission and verify that the public URL matches the local file.
- Paste the listing, single purpose, permission explanations, and test instructions.
- Upload the existing 128x128 icon.
- Upload `store/screenshot-page.png`, `store/screenshot-storage.png`, and `store/screenshot-cookies.png` (1280x800). Capture your own images using the demo and instructions in `store/sample/README.md`.
- Review and upload `store/promo-440x280.png`, a 440x280 promotional illustration. Its editable source is `store/promo.svg`; it is not a product screenshot.
- Select Public visibility. Review distribution regions and the account/data disclosures before submission.
- Review all fields, then submit for review. Approval and public availability depend on Chrome Web Store review.

## Official references

- https://developer.chrome.com/docs/webstore/prepare
- https://developer.chrome.com/docs/webstore/publish/
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/images
