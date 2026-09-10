[![Build Status](https://github.com/pqrs-org/chrome-dev-sideboard/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/pqrs-org/chrome-dev-sideboard/actions/workflows/ci.yml?query=branch%3Amain+event%3Apush)
[![License](https://img.shields.io/badge/license-Public%20Domain-blue.svg)](https://github.com/pqrs-org/chrome-dev-sideboard/blob/main/LICENSE.md)

# Dev Sideboard

Inspect page information, network activity, storage, and cookies in Chrome’s side panel.

## Features

- Full page titles, following the active tab in each window
- Canonical URLs, descriptions, and Open Graph or Twitter Card metadata with image previews
- Request counts, error details, durations, and response size estimates
- Inspect, edit, and delete Local Storage, Session Storage, and Cookies, with filtering, JSON tree navigation, and raw text viewing

## Installation

Requires Chrome 142 or later. Run `pnpm install --frozen-lockfile` and `make build` before loading from source.

1.  Open `chrome://extensions` and enable **Developer mode**.
2.  Select **Load unpacked** and choose the `build/` directory.
3.  Click the extension icon to open the side panel.
4.  Reload already open pages after installing or updating the extension.

## Usage

Network monitoring starts automatically. Measurements reset on reload or navigation to a new document; switching tabs preserves them. Durations include download time. Response sizes are estimates based on available Content-Length headers, not total network usage. Chrome’s limitations mean some requests are not counted.

The **Page** tab updates when metadata changes. Open Graph takes priority; Twitter Card is shown when Open Graph tags are absent.

**Storage** and **Cookies** refresh automatically, pausing while you edit. Both JSON and plain-text values can be edited. **Save** and **Delete** change the selected website storage item or browser cookie; changes made by the website since inspection are checked before applying an edit.

## Security and privacy

Protecting website data is a design priority. Inspecting Local Storage, Session Storage, or Cookies does not send their contents to the developer or external servers. Values are passed through internal extension messages and displayed as text, without executing embedded HTML or JavaScript.

Features are omitted when a safe implementation cannot be established within the extension’s design. Fetch/XHR response-body capture is intentionally excluded to avoid exposing captured responses to unrelated page scripts.

Image previews make requests to the public-network HTTPS URLs specified by the page. Image hosts receive the requested URL and your IP address, but preview requests omit browser credentials, including cookies. Local-network destinations are blocked, and image count, response size, and request duration are limited.

See the [privacy policy](PRIVACY.md) for data handling and retention details.

## Development and publishing

Development requires Node.js 22.13 or later, pnpm, and zip. Run `pnpm install --frozen-lockfile` to install the development dependencies. There are no runtime dependencies.

- `make build` compiles TypeScript, bundles and minifies the side panel scripts and styles, and copies extension assets into `build/`. Rebuild after source changes, then reload the extension in Chrome.
- `make check` runs type checking, ESLint, shell syntax checks, tests, and formatting checks.
- `make test` builds the extension and runs the tests.
- `make format` (or `pnpm format:write`) formats supported source files and documentation with Prettier. Formatting also runs automatically after `pnpm install` and `pnpm update`.
- `make package` runs checks and creates the upload ZIP in `dist/`.

See the [store listing](store/listing.md) and [submission notes](store/submission.md) for publication materials.
