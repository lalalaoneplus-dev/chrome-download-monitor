import assert from "node:assert/strict";
import test from "node:test";

import {
  activeDownloadsQuery,
  isTrackedDownloadId,
  nonIncognitoDownloads,
  TRACKING_PROVENANCE
} from "../src/downloads.js";

test("filters Incognito downloads without changing ordinary items", () => {
  const regular = { id: 1, incognito: false };
  const unknown = { id: 3 };

  assert.deepEqual(
    nonIncognitoDownloads([regular, { id: 2, incognito: true }, unknown]),
    [regular, unknown]
  );
});

test("tracks lifecycle IDs from events or an in-progress baseline only", () => {
  const events = [
    {
      downloadId: 7,
      eventType: "started",
      technical: {
        apiEvent: "chrome.downloads.onCreated",
        snapshot: { incognito: false }
      }
    }
  ];

  assert.equal(isTrackedDownloadId(7, events, {}), true);
  assert.equal(isTrackedDownloadId(8, events, {}), false);
  assert.equal(
    isTrackedDownloadId(9, [], {
      9: { bytesReceived: 20, provenance: TRACKING_PROVENANCE.LIFECYCLE }
    }),
    true
  );
  assert.equal(isTrackedDownloadId(10, [], { 10: { bytesReceived: 20 } }), false);
  assert.equal(
    isTrackedDownloadId(
      11,
      [{ downloadId: 11, eventType: "updated", technical: { snapshot: {} } }]
    ),
    false
  );
  assert.equal(
    isTrackedDownloadId(
      12,
      [{
        downloadId: 12,
        eventType: "completed",
        technical: { apiEvent: "chrome.downloads.onChanged", snapshot: { incognito: false } }
      }]
    ),
    false
  );
  assert.equal(
    isTrackedDownloadId(
      13,
      [{
        downloadId: 13,
        eventType: "started",
        technical: { apiEvent: "chrome.downloads.onCreated", snapshot: { incognito: true } }
      }]
    ),
    false
  );
  assert.equal(
    isTrackedDownloadId(
      14,
      [{
        downloadId: 14,
        eventType: "started",
        technical: { apiEvent: "fake.source", snapshot: { incognito: false } }
      }]
    ),
    false
  );
});

test("requests only in-progress downloads for the live panel", () => {
  assert.deepEqual(activeDownloadsQuery(), {
    state: "in_progress",
    orderBy: ["-startTime"],
    limit: 50
  });
});
