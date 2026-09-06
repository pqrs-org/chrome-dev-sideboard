# chrome-page-title-bar

A Chrome extension that shows the current page title in a draggable chip on selected websites.

## Features

- Shows the title chip only on sites you select
- Tracks page title changes made by SPAs and other dynamic pages
- Drag the chip anywhere in the viewport and save its position per site (origin)
- Uses Shadow DOM to isolate the title chip from page styles
- Saves settings with Chrome Sync

## Installation

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this directory.
4. Open the extension panel on a target page and select **Show on this site**.

To configure multiple URLs, enter one Chrome [match pattern](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns) per line in the extension panel.

```text
https://excel.cloud.microsoft/*
https://*.office.com/*
https://example.sharepoint.com/*
```

The extension requests access to all HTTP and HTTPS sites at installation. URL patterns control where the title chip appears, so adding a site does not require an additional permission prompt. After changing the settings, reload any other target pages that are already open.

## Development

There are no runtime dependencies. Run the shared-logic tests with:

```sh
make test
```

## Limitations

- The chip is overlaid on the web page rather than added to Chrome's own interface.
- It cannot appear on pages where extension scripts are prohibited, such as `chrome://` pages and the Chrome Web Store.
- It may overlap page content.
