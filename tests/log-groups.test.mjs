import assert from "node:assert/strict";
import test from "node:test";

import { groupLogEvents, technicalRecordForGroup } from "../src/log-groups.js";

function event(id, downloadId, eventType, timestamp, snapshot = {}) {
  return {
    id,
    downloadId,
    eventType,
    timestamp,
    severity: eventType === "completed" ? "success" : "info",
    natural: `${eventType} message`,
    isExtensionInitiated: true,
    extension: { id: "extension-id", name: "Downloader" },
    technical: {
      apiEvent: `chrome.downloads.${eventType}`,
      snapshot
    }
  };
}

test("combines a multipart download lifecycle into one record", () => {
  const groups = groupLogEvents([
    event("complete", 42, "completed", "2026-06-14T10:03:00Z", {
      filename: "C:\\Downloads\\archive.zip",
      state: "complete"
    }),
    event("progress-2", 42, "progress", "2026-06-14T10:02:00Z", {
      filename: "C:\\Downloads\\archive.zip",
      bytesReceived: 200
    }),
    event("progress-1", 42, "progress", "2026-06-14T10:01:00Z", {
      filename: "C:\\Downloads\\archive.zip",
      bytesReceived: 100
    }),
    event("start", 42, "started", "2026-06-14T10:00:00Z", {
      filename: "C:\\Downloads\\archive.zip"
    })
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "download:42");
  assert.equal(groups[0].eventCount, 4);
  assert.equal(groups[0].fileName, "archive.zip");
  assert.deepEqual(
    groups[0].events.map((entry) => entry.eventType),
    ["started", "progress", "progress", "completed"]
  );
});

test("keeps distinct Chrome download IDs separate", () => {
  const groups = groupLogEvents([
    event("one", 1, "started", "2026-06-14T10:00:00Z"),
    event("two", 2, "started", "2026-06-14T10:00:01Z")
  ]);

  assert.deepEqual(
    groups.map((group) => group.id),
    ["download:2", "download:1"]
  );
});

test("technical output contains one chronological lifecycle array", () => {
  const [group] = groupLogEvents([
    event("progress", 7, "progress", "2026-06-14T10:01:00Z"),
    event("start", 7, "started", "2026-06-14T10:00:00Z")
  ]);
  const technical = technicalRecordForGroup(group);

  assert.equal(technical.recordType, "download_lifecycle");
  assert.equal(technical.downloadId, 7);
  assert.equal(technical.eventCount, 2);
  assert.deepEqual(
    technical.lifecycle.map((entry) => entry.eventType),
    ["started", "progress"]
  );
});
