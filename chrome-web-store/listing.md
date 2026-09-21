# Chrome Web Store listing

## Name

Dev Sideboard

## Summary

Inspect network activity, storage, and cookies in the side panel.

## Detailed description

Inspect the active page without leaving your workspace. Dev Sideboard keeps the full page title and useful development tools in Chrome's side panel.

- Overview: the full page title, network activity, window and viewport dimensions, and page metadata in one tab.
- Network: request counts, HTTP errors, failure details, request durations, and response size estimates.
- Resizing: edit window or viewport dimensions and click Apply. Reuse previously applied widths and heights from separate history menus, or remove individual entries with ×. Size history stays in your browser across sessions.
- Metadata: Canonical URL and Open Graph metadata, including image previews. Image, title, and description appear first, with other Open Graph properties in an expandable section. Twitter Card metadata is shown when Open Graph tags are absent.
- Storage: browse, search, edit, and delete Local Storage and Session Storage values.
- Cookies: inspect cookie values and attributes, edit values, and delete individual cookies.

Requires Chrome 142 or later. Click the extension icon to open the side panel.

## What's new in v1.5.0

- Added window and viewport resizing with persistent, individually removable size history.
- Moved tabs to the top and grouped page title, network activity, dimensions, and metadata in Overview.
- Made Open Graph metadata more compact, with additional properties collapsed by default.
- Prevented metadata observers from raising errors after an extension update invalidates the content script.
- Updated the extension icon.

## Category and language

Choose the closest available developer tools category. Default listing language: English (matches the interface).

## URLs

- Homepage: https://github.com/pqrs-org/chrome-dev-sideboard
- Privacy policy: https://github.com/pqrs-org/chrome-dev-sideboard/blob/main/PRIVACY.md

The repository is public. Publish the updated PRIVACY.md to the main branch before submission so the public policy describes the current image fetching behavior.
