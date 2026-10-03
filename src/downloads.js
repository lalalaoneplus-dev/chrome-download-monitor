export const TRACKING_PROVENANCE = Object.freeze({
  CREATED: "created",
  LIFECYCLE: "lifecycle"
});

export function nonIncognitoDownloads(items = []) {
  return items.filter((item) => item?.incognito !== true);
}

export function activeDownloadsQuery() {
  return {
    state: "in_progress",
    orderBy: ["-startTime"],
    limit: 50
  };
}

export function migrateStoredDownloadState(events = []) {
  const incognitoIds = new Set(
    (Array.isArray(events) ? events : [])
      .filter((event) => event?.technical?.snapshot?.incognito === true)
      .map((event) => event?.downloadId ?? event?.technical?.downloadId)
      .filter((downloadId) => downloadId !== null && downloadId !== undefined)
      .map((downloadId) => String(downloadId))
  );

  return {
    events: Array.isArray(events)
      ? events.filter((event) => {
          if (event?.technical?.snapshot?.incognito === true) {
            return false;
          }
          const downloadId = event?.downloadId ?? event?.technical?.downloadId;
          return (
            downloadId === null ||
            downloadId === undefined ||
            !incognitoIds.has(String(downloadId))
          );
        })
      : [],
    progress: {}
  };
}

export function isTrackedDownloadId(downloadId, events = [], progress = {}) {
  if (downloadId === null || downloadId === undefined) {
    return false;
  }

  const id = String(downloadId);
  if (
    progress &&
    typeof progress === "object" &&
    Object.prototype.hasOwnProperty.call(progress, id) &&
    [TRACKING_PROVENANCE.CREATED, TRACKING_PROVENANCE.LIFECYCLE].includes(
      progress[id]?.provenance
    )
  ) {
    return true;
  }

  return (
    Array.isArray(events) &&
    events.some(
      (event) =>
        event?.eventType === "started" &&
        event?.technical?.apiEvent === "chrome.downloads.onCreated" &&
        event?.technical?.snapshot?.incognito === false &&
        event?.downloadId !== null &&
        event?.downloadId !== undefined &&
        String(event.downloadId) === id
    )
  );
}

export function extensionEvidenceForDownload(downloadId, events = []) {
  if (downloadId === null || downloadId === undefined || !Array.isArray(events)) {
    return null;
  }

  const id = String(downloadId);
  const match = events.find(
    (event) =>
      event?.eventType === "started" &&
      event?.technical?.apiEvent === "chrome.downloads.onCreated" &&
      event?.technical?.snapshot?.incognito === false &&
      event?.downloadId !== null &&
      event?.downloadId !== undefined &&
      String(event.downloadId) === id &&
      event.isExtensionInitiated === true &&
      event.extension
  );
  return match?.extension || null;
}
