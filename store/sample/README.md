# Screenshot sample

A standalone demo page with synthetic Open Graph, Local Storage, Session Storage, and cookie values. It loads no external resources and is not included in the extension package.

From the repository root, run:

```sh
node store/sample/serve.mjs
```

Requires Node.js and `openssl`. Open <https://localhost:8443/>, then use Chrome's advanced option to proceed past the self-signed certificate warning for this local demo. The server listens only on the loopback interface. Its temporary certificate is removed when it exits.

Open Dev Sideboard and take screenshots of Page, Storage, and Cookies. HTTPS is needed for Open Graph image previews. A `file://` page does not support the extension's inspection features.

The sample seeds missing values on page load and preserves edits. Reloading restores any deleted sample entries. Select `workspace` in Storage to show a JSON object with nested values.

The layout targets a 1280×800 screenshot with a roughly 380px side panel, leaving 900px for the page. Compact spacing and a 3:1 cover image leave room for browser controls. Capture at 1280×800 or 640×400 for the store listing. Stop the server with Ctrl+C when finished.
