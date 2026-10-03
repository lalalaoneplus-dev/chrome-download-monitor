import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyChange,
  formatBytes,
  naturalLanguageForEvent,
  redactUrl,
  sanitizeDelta,
  sanitizeDownloadItem
} from "../src/log-format.js";

test("formats byte counts for readable logs", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.00 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.00 MB");
});

test("explains an extension-attributed download start", () => {
  const message = naturalLanguageForEvent("started", {
    filename: "C:\\Users\\Example\\Downloads\\report.pdf",
    totalBytes: 2 * 1024 * 1024,
    byExtensionId: "abcdefghijklmnop",
    byExtensionName: "Example Downloader"
  });

  assert.match(message, /report\.pdf/);
  assert.match(message, /Example Downloader/);
  assert.match(message, /abcdefghijklmnop/);
  assert.match(message, /2\.00 MB/);
});

test("explains an interrupted download and resume capability", () => {
  const message = naturalLanguageForEvent("interrupted", {
    filename: "archive.zip",
    error: "NETWORK_FAILED",
    canResume: true
  });

  assert.match(message, /NETWORK_FAILED/);
  assert.match(message, /can be resumed/);
});

test("classifies important Chrome download deltas", () => {
  assert.equal(classifyChange({ state: { current: "complete" } }), "completed");
  assert.equal(classifyChange({ paused: { previous: false, current: true } }), "paused");
  assert.equal(classifyChange({ danger: { current: "dangerous" } }), "danger_changed");
});

test("redacts sensitive URL paths and local directories", () => {
  assert.equal(
    redactUrl("https://example.com/private/file.zip?token=secret"),
    "https://example.com/[path-redacted]"
  );
  const sanitized = sanitizeDownloadItem(
    {
      id: 7,
      url: "https://example.com/private/file.zip?token=secret",
      filename: "C:\\Users\\Example\\Downloads\\file.zip"
    },
    false
  );
  assert.equal(sanitized.url, "https://example.com/[path-redacted]");
  assert.equal(sanitized.filename, "file.zip");
});

test("redacts sensitive URL delta fields and filename paths", () => {
  const sanitized = sanitizeDelta(
    {
      url: {
        current: "https://example.com/private/file.zip?token=current",
        previous: "https://example.com/old.zip?token=previous"
      },
      finalUrl: { current: "https://cdn.example.com/file.zip?key=secret" },
      referrer: { previous: "https://origin.example/private?session=secret" },
      filename: {
        current: "C:\\Users\\Example\\Downloads\\file.zip",
        previous: "/Users/example/Downloads/old.zip"
      }
    },
    false
  );

  assert.equal(sanitized.url.current, "https://example.com/[path-redacted]");
  assert.equal(sanitized.url.previous, "https://example.com/[path-redacted]");
  assert.equal(sanitized.finalUrl.current, "https://cdn.example.com/[path-redacted]");
  assert.equal(sanitized.referrer.previous, "https://origin.example/[path-redacted]");
  assert.deepEqual(sanitized.filename, { current: "file.zip", previous: "old.zip" });
});
