# ClickUp Sidebar Hierarchy Helper

Chrome extension for reducing ClickUp sidebar navigation overhead.

## What It Does

- No expand-all control next to Spaces.
- Keeps Space expand/collapse under your control.
- Makes folder row clicks open the first list inside that folder instead of the folder Overview.

It does not call the ClickUp API, store API tokens, read task contents, or modify ClickUp data.

## Install Locally

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select the unpacked extension folder.

```text
clickup-hierarchy-helper
```

5. Open or refresh `https://app.clickup.com/`.

## Release Package

Run:

```sh
./scripts/package.sh
```

The script validates the manifest and JavaScript, runs fixture tests, then writes a Chrome Web Store-ready ZIP under `dist/`.

## Settings

Click the extension icon in Chrome to toggle:

- Enable helper
- Open first list from folders
- Reset extension state

Stored state:

```json
{
  "enabled": true,
  "openFirstListOnCollapsedFolderClick": true
}
```

## Privacy

See `PRIVACY.md`. In short: this extension runs only on `https://app.clickup.com/*`, stores only local settings, makes no external network requests, and does not collect or transmit ClickUp task/list/folder content.

## Notes

This extension is intentionally DOM-only for v1. ClickUp can change its sidebar markup, so the script is defensive: if it cannot confidently find hierarchy rows, it leaves native ClickUp behavior intact.

## Manual Smoke Test

- Open ClickUp and confirm no helper icon appears beside Space rows.
- Click a Space row and confirm it expands/collapses its folders.
- Click a folder row and confirm the first list opens instead of the folder Overview.
- Disable the helper in the popup and confirm native sidebar behavior returns.
