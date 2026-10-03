# Privacy Statement

Download Monitor by The Nexus Pivot is a local diagnostic extension.

## Data handled

The extension records download metadata supplied by the browser, which can include URLs, referrers,
local destination paths, filenames, file sizes, download status, error codes, safety
classifications, and the name or ID of an extension the browser identifies as the initiator.

## Storage and transmission

All records are stored in the current browser profile through `chrome.storage.local`. The extension
does not contain analytics, advertisements, telemetry, remote code, or network upload logic. Its
Content Security Policy blocks outbound connections from extension pages and the service worker.
No records are transmitted; JSON and CSV exports are local files created only when the user asks.

## Access

The extension requests the `downloads`, `storage`, `alarms`, and `unlimitedStorage` permissions.
It does not request access to website contents and does not inject content scripts.

## Chrome Web Store Limited Use

Download Monitor by The Nexus Pivot's use and transfer of information received from Chrome APIs
will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

Stored URLs, referrers, and local destination paths are redacted by default. The user can enable
**Store full technical details** in the dashboard to retain those values in future records;
existing records are not rewritten when the setting changes.

The manifest prevents the extension from being enabled in Incognito. The code also rejects any
download marked as Incognito from records, progress samples, badge counts, and the live dashboard.

## Retention and deletion

The user chooses a retention limit of 500, 1,000, 2,000, or 5,000 events. Older events are removed
when that limit is exceeded. The dashboard's **Clear logs** button immediately removes all recorded
events.
