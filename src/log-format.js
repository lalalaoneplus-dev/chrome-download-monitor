const DOWNLOAD_FIELDS = [
  "id",
  "url",
  "finalUrl",
  "referrer",
  "filename",
  "incognito",
  "danger",
  "mime",
  "startTime",
  "endTime",
  "estimatedEndTime",
  "state",
  "paused",
  "canResume",
  "error",
  "bytesReceived",
  "totalBytes",
  "fileSize",
  "exists",
  "byExtensionId",
  "byExtensionName"
];

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "unknown size";
  }
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const amount = bytes / 1024 ** unitIndex;
  const decimals = unitIndex === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
}

export function fileNameFromItem(item = {}) {
  if (item.filename) {
    return String(item.filename).split(/[\\/]/).pop() || "unnamed file";
  }

  for (const candidate of [item.finalUrl, item.url]) {
    if (!candidate) {
      continue;
    }
    try {
      const path = new URL(candidate).pathname;
      const name = decodeURIComponent(path.split("/").pop() || "");
      if (name) {
        return name;
      }
    } catch {
      // A malformed URL should not prevent a useful log entry.
    }
  }

  return "unnamed file";
}

export function hostFromUrl(value) {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

export function redactUrl(value) {
  if (!value) {
    return value;
  }
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/[path-redacted]`;
  } catch {
    return "[invalid-or-redacted-url]";
  }
}

export function sanitizeDownloadItem(item = {}, storeFullDetails = true) {
  const clean = {};
  for (const field of DOWNLOAD_FIELDS) {
    if (item[field] !== undefined) {
      clean[field] = item[field];
    }
  }

  if (!storeFullDetails) {
    clean.url = redactUrl(clean.url);
    clean.finalUrl = redactUrl(clean.finalUrl);
    clean.referrer = redactUrl(clean.referrer);
    if (clean.filename) {
      clean.filename = fileNameFromItem(clean);
    }
  }

  return clean;
}

export function sanitizeDelta(delta = {}, storeFullDetails = true) {
  const clean = structuredClone(delta);
  if (!storeFullDetails) {
    for (const field of ["url", "finalUrl", "referrer"]) {
      const value = clean[field];
      if (value && typeof value === "object") {
        for (const side of ["current", "previous"]) {
          if (value[side] !== undefined) {
            value[side] = redactUrl(value[side]);
          }
        }
      } else if (value !== undefined) {
        clean[field] = redactUrl(value);
      }
    }

    if (clean.filename && typeof clean.filename === "object") {
      for (const side of ["current", "previous"]) {
        if (clean.filename[side] !== undefined) {
          clean.filename[side] = String(clean.filename[side]).split(/[\\/]/).pop();
        }
      }
    } else if (clean.filename !== undefined) {
      clean.filename = String(clean.filename).split(/[\\/]/).pop();
    }
  }
  return clean;
}

export function extensionAttribution(item = {}) {
  if (!item.byExtensionId && !item.byExtensionName) {
    return null;
  }
  return {
    id: item.byExtensionId || "",
    name: item.byExtensionName || "Unnamed extension"
  };
}

export function classifyChange(delta = {}) {
  const state = delta.state?.current;
  if (state === "complete") {
    return "completed";
  }
  if (state === "interrupted") {
    return "interrupted";
  }
  if (delta.paused?.current === true) {
    return "paused";
  }
  if (delta.paused?.current === false && delta.paused?.previous === true) {
    return "resumed";
  }
  if (delta.danger?.current && delta.danger.current !== "safe") {
    return "danger_changed";
  }
  if (delta.filename) {
    return "filename_changed";
  }
  if (delta.exists?.current === false) {
    return "file_removed";
  }
  return "updated";
}

export function severityForEvent(eventType) {
  if (eventType === "completed") {
    return "success";
  }
  if (eventType === "interrupted") {
    return "error";
  }
  if (["danger_changed", "file_removed", "history_erased"].includes(eventType)) {
    return "warning";
  }
  return "info";
}

function sourceSentence(item) {
  const extension = extensionAttribution(item);
  if (extension) {
    const id = extension.id ? ` (ID: ${extension.id})` : "";
    return `The browser attributes it to the extension "${extension.name}"${id}.`;
  }

  const host = hostFromUrl(item.referrer) || hostFromUrl(item.finalUrl) || hostFromUrl(item.url);
  if (host) {
    return `The browser did not attribute it to an extension; the visible source is ${host}.`;
  }
  return "The browser did not provide extension attribution for this download.";
}

function progressDescription(item) {
  const received = Number(item.bytesReceived) || 0;
  const total = Number(item.totalBytes) || 0;
  if (total > 0) {
    const percent = Math.min(100, Math.round((received / total) * 100));
    return `${percent}% complete (${formatBytes(received)} of ${formatBytes(total)})`;
  }
  return `${formatBytes(received)} received; the total size is not known yet`;
}

export function naturalLanguageForEvent(eventType, item = {}, details = {}) {
  const name = fileNameFromItem(item);
  const quotedName = `"${name}"`;

  switch (eventType) {
    case "monitor_started":
      return "The download monitor is active and waiting for browser download events.";
    case "monitor_paused":
      return "Monitoring was paused. New browser download events will not be added to the log.";
    case "started": {
      const total =
        Number(item.totalBytes) > 0 ? ` Expected size: ${formatBytes(item.totalBytes)}.` : "";
      return `Download started for ${quotedName}. ${sourceSentence(item)}${total}`;
    }
    case "progress":
      return `Download progress for ${quotedName}: ${progressDescription(item)}.`;
    case "completed":
      return `Download finished for ${quotedName}. The browser received ${formatBytes(
        item.bytesReceived || item.fileSize
      )} and marked the download complete.`;
    case "interrupted": {
      const reason = item.error || details.delta?.error?.current || "an unspecified error";
      const resume = item.canResume
        ? "The browser reports that it can be resumed."
        : "The browser reports that it cannot currently be resumed.";
      return `Download stopped for ${quotedName}. The reported reason is ${reason}. ${resume}`;
    }
    case "paused":
      return `Download paused for ${quotedName} after receiving ${formatBytes(
        item.bytesReceived
      )}.`;
    case "resumed":
      return `Download resumed for ${quotedName}.`;
    case "danger_changed":
      return `The browser changed the safety classification for ${quotedName} to "${
        item.danger || details.delta?.danger?.current || "unknown"
      }".`;
    case "filename_changed":
      return `The browser changed the destination name for this download to ${quotedName}.`;
    case "file_removed":
      return `The browser reports that the downloaded file ${quotedName} no longer exists at its recorded location.`;
    case "history_erased":
      return `The browser removed download ID ${details.downloadId ?? "unknown"} from its download history.`;
    case "updated": {
      const keys = Object.keys(details.delta || {});
      const description = keys.length ? keys.join(", ") : "download metadata";
      return `The browser updated ${description} for ${quotedName}.`;
    }
    default:
      return `The browser reported a "${eventType}" event for ${quotedName}.`;
  }
}
