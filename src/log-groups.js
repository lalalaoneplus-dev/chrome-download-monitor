import { fileNameFromItem } from "./log-format.js";

function timestampValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestSnapshot(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const snapshot = events[index].technical?.snapshot;
    if (snapshot && Object.keys(snapshot).length) {
      return snapshot;
    }
  }
  return {};
}

function groupSummary(group) {
  if (group.kind === "system") {
    return group.latestEvent.natural;
  }

  const count = group.events.length;
  const linked =
    count === 1
      ? "This is the first recorded event for this download."
      : `${count} linked lifecycle events are combined in this download record.`;
  return `${group.latestEvent.natural} ${linked}`;
}

export function groupLogEvents(events = []) {
  const grouped = new Map();

  for (const event of events) {
    const hasDownloadId = event.downloadId !== null && event.downloadId !== undefined;
    const id = hasDownloadId ? `download:${event.downloadId}` : `system:${event.id}`;
    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        kind: hasDownloadId ? "download" : "system",
        downloadId: hasDownloadId ? event.downloadId : null,
        events: []
      });
    }
    grouped.get(id).events.push(event);
  }

  const groups = [...grouped.values()].map((group) => {
    const originalOrder = new Map(group.events.map((event, index) => [event, index]));

    group.events.sort((left, right) => {
      const difference = timestampValue(left.timestamp) - timestampValue(right.timestamp);
      return difference || originalOrder.get(right) - originalOrder.get(left);
    });
    const chronologicalFirstEvent = group.events[0];
    const chronologicalLatestEvent = group.events[group.events.length - 1];
    const extension =
      [...group.events].reverse().find((event) => event.extension)?.extension || null;
    const snapshot = latestSnapshot(group.events);

    return {
      ...group,
      firstEvent: chronologicalFirstEvent,
      latestEvent: chronologicalLatestEvent,
      extension,
      isExtensionInitiated: group.events.some((event) => event.isExtensionInitiated),
      snapshot,
      fileName: group.kind === "download" ? fileNameFromItem(snapshot) : "Monitor activity",
      eventTypes: [...new Set(group.events.map((event) => event.eventType))],
      eventCount: group.events.length,
      startedAt: chronologicalFirstEvent.timestamp,
      updatedAt: chronologicalLatestEvent.timestamp,
      severity: chronologicalLatestEvent.severity,
      status: chronologicalLatestEvent.eventType,
      summary: ""
    };
  });

  for (const group of groups) {
    group.summary = groupSummary(group);
  }

  return groups.sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
}

export function technicalRecordForGroup(group) {
  return {
    recordType: group.kind === "download" ? "download_lifecycle" : "monitor_event",
    downloadId: group.downloadId,
    fileName: group.fileName,
    extension: group.extension,
    isExtensionInitiated: group.isExtensionInitiated,
    startedAt: group.startedAt,
    lastUpdatedAt: group.updatedAt,
    currentStatus: group.status,
    currentSnapshot: group.snapshot,
    eventCount: group.eventCount,
    lifecycle: group.events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      eventType: event.eventType,
      severity: event.severity,
      naturalLanguage: event.natural,
      technical: event.technical
    }))
  };
}
