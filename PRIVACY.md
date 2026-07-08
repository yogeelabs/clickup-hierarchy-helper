# Privacy Policy

ClickUp Sidebar Hierarchy Helper is a DOM-only browser extension for `https://app.clickup.com/*`.

## Data Collection

The extension does not collect, sell, share, transmit, or remotely store user data.

It does not:

- Call the ClickUp API.
- Store ClickUp API tokens, cookies, credentials, task data, comments, attachments, or exports.
- Send analytics, telemetry, or page content to any external service.
- Modify ClickUp data.

## Local Storage

The extension uses `chrome.storage.local` for local settings only:

```json
{
  "enabled": true,
  "openFirstListOnCollapsedFolderClick": true
}
```

## Permissions

The extension requests:

- `storage`: to save the local extension settings above.
- `https://app.clickup.com/*` content script access: to read sidebar rows and intercept folder-row clicks inside ClickUp.

## Contact

For issues or privacy questions, use the support channel listed on the extension's distribution page.
