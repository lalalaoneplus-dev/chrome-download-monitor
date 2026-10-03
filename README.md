# Download Monitor by The Nexus Pivot

A local-only browser extension that monitors browser download lifecycle events and presents them in
two separate views:

- **Plain-language log:** readable explanations of what happened.
- **Technical log:** event names, download IDs, extension attribution, deltas, and the browser's current
  `DownloadItem` snapshot as structured JSON.

All lifecycle events with the same browser download ID are combined into one download record.
Progress samples, filename changes, pauses, resumptions, interruptions, and completion therefore
appear as one linked timeline instead of separate log rows. JSON and CSV exports use the same
grouped format.

## Where to install it

Install this app **inside Chrome as an extension**. No desktop app, server, Node.js process, or
background executable is required after installation.

An outside-browser desktop app can watch files appear in the Downloads folder, but it cannot
reliably receive the browser's `byExtensionId` and `byExtensionName` attribution. That is why this
version belongs inside the browser.

## Install

1. Open `chrome://extensions/` in Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this folder:
   the `chrome-download-monitor` project folder
5. Pin **Download Monitor by The Nexus Pivot** from Chrome's Extensions menu.
6. Click its toolbar icon to open the dashboard.

The extension starts monitoring immediately after it is loaded. Its manifest prevents it from being
enabled in Incognito, and its code also excludes any Incognito-marked download from lifecycle logs,
progress sampling, badge counts, and dashboard live state.

## What it records

- Download created, changed, paused, resumed, interrupted, completed, removed, and history-erased
  events exposed by the browser's `chrome.downloads` API.
- Periodic progress snapshots while a download is active.
- Filename, source/final URL, referrer, MIME type, byte counts, danger classification, error,
  resume capability, and the browser's other available download metadata.
- `byExtensionId` and `byExtensionName` when the browser attributes the download to an extension.

## Important boundary

The browser isolates extensions from one another. This monitor cannot inspect another extension's
private JavaScript, internal variables, request bodies, credentials, or arbitrary network traffic.
It observes the download lifecycle the browser deliberately exposes. If an extension launches a native
desktop program that writes a file outside the browser's download system, this extension will not see
that file operation.

The browser may also omit extension attribution when an extension causes a web page to initiate the
download indirectly. Those entries are clearly marked as having no extension attribution.

## Privacy

- Logs are stored only in `chrome.storage.local` for the current browser profile.
- Nothing is uploaded or sent to an external service.
- The extension Content Security Policy blocks outbound connections from its pages and service
  worker.
- The extension has no website host permissions and injects no content scripts.
- Full source URLs, referrers, and local paths are redacted by default. Enable **Store full
  technical details** only when you explicitly need those values for diagnosis; the setting applies
  to future entries, and existing entries keep the detail level they were stored with.
- JSON and CSV exports are created only when you click an export button.

See [PRIVACY.md](PRIVACY.md) for the complete privacy statement.

## Development

Requires Node.js only for local validation and tests:

```powershell
npm test
npm run validate
```

After changing extension files, click **Reload** on the extension card in
`chrome://extensions/`.

## API references

- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
