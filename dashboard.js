import { fileNameFromItem, formatBytes, hostFromUrl } from "./src/log-format.js";
import { reconcileLogEntries } from "./src/log-dom.js";
import { groupLogEvents, technicalRecordForGroup } from "./src/log-groups.js";

const state = {
  events: [],
  settings: {},
  liveDownloads: [],
  bytesInUse: 0,
  view: "natural",
  query: "",
  sourceFilter: "all",
  eventFilter: "all"
};

const elements = {
  activeMetric: document.querySelector("#activeMetric"),
  activeMetricNote: document.querySelector("#activeMetricNote"),
  brandVersion: document.querySelector("#brandVersion"),
  clearButton: document.querySelector("#clearButton"),
  completedMetric: document.querySelector("#completedMetric"),
  eventFilter: document.querySelector("#eventFilter"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  extensionMetric: document.querySelector("#extensionMetric"),
  extensionOnlyToggle: document.querySelector("#extensionOnlyToggle"),
  fullDetailsToggle: document.querySelector("#fullDetailsToggle"),
  interruptedMetric: document.querySelector("#interruptedMetric"),
  liveDownloads: document.querySelector("#liveDownloads"),
  logList: document.querySelector("#logList"),
  maxEventsSelect: document.querySelector("#maxEventsSelect"),
  monitoringToggle: document.querySelector("#monitoringToggle"),
  monitorState: document.querySelector("#monitorState"),
  naturalTab: document.querySelector("#naturalTab"),
  openDownloadsButton: document.querySelector("#openDownloadsButton"),
  refreshButton: document.querySelector("#refreshButton"),
  resultCount: document.querySelector("#resultCount"),
  searchInput: document.querySelector("#searchInput"),
  showFolderButton: document.querySelector("#showFolderButton"),
  sourceFilter: document.querySelector("#sourceFilter"),
  storageLabel: document.querySelector("#storageLabel"),
  technicalTab: document.querySelector("#technicalTab"),
  toast: document.querySelector("#toast")
};

let toastTimer;

elements.brandVersion.textContent = `v${chrome.runtime.getManifest().version}`;

function sendMessage(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) {
      throw new Error(response?.error || "The background monitor did not respond.");
    }
    return response;
  });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

function formatClock(timestamp) {
  if (!timestamp) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(timestamp));
}

function eventLabel(eventType) {
  return (
    {
      monitor_started: "Monitor active",
      monitor_paused: "Monitor paused",
      started: "Download started",
      progress: "Progress update",
      completed: "Download completed",
      interrupted: "Download interrupted",
      paused: "Download paused",
      resumed: "Download resumed",
      danger_changed: "Safety changed",
      filename_changed: "Filename changed",
      file_removed: "File removed",
      history_erased: "History erased",
      updated: "Download updated"
    }[eventType] || eventType.replaceAll("_", " ")
  );
}

function eventGlyph(eventType) {
  return (
    {
      completed: "✓",
      interrupted: "!",
      started: "↓",
      progress: "%",
      paused: "Ⅱ",
      resumed: "▶",
      danger_changed: "!",
      history_erased: "×",
      monitor_started: "●",
      monitor_paused: "○"
    }[eventType] || "•"
  );
}

function uniqueDownloadsFor(eventType) {
  return new Set(
    state.events
      .filter((entry) => entry.eventType === eventType && entry.downloadId !== null)
      .map((entry) => entry.downloadId)
  ).size;
}

function renderMetrics() {
  const active = state.liveDownloads.filter((item) => item.state === "in_progress");
  elements.activeMetric.textContent = String(active.length);
  elements.activeMetricNote.textContent = active.length
    ? `${active.length} transfer${active.length === 1 ? "" : "s"} currently running`
    : "No downloads in progress";
  elements.completedMetric.textContent = String(uniqueDownloadsFor("completed"));
  elements.interruptedMetric.textContent = String(uniqueDownloadsFor("interrupted"));
  elements.extensionMetric.textContent = String(
    new Set(
      state.events
        .filter((entry) => entry.isExtensionInitiated && entry.downloadId !== null)
        .map((entry) => entry.downloadId)
    ).size
  );
}

function renderSettings() {
  elements.monitoringToggle.checked = Boolean(state.settings.enabled);
  elements.extensionOnlyToggle.checked = Boolean(state.settings.onlyExtensionDownloads);
  elements.fullDetailsToggle.checked = Boolean(state.settings.storeFullDetails);
  elements.maxEventsSelect.value = String(state.settings.maxEvents || 2000);
  elements.storageLabel.textContent = `${formatBytes(state.bytesInUse)} stored`;

  elements.monitorState.classList.toggle("paused", !state.settings.enabled);
  elements.monitorState.querySelector("span:last-child").textContent = state.settings.enabled
    ? "Monitoring active"
    : "Monitoring paused";
}

function extensionText(item) {
  if (item.byExtensionName || item.byExtensionId) {
    return item.byExtensionName || `Extension ${item.byExtensionId}`;
  }
  return hostFromUrl(item.referrer) || hostFromUrl(item.finalUrl) || hostFromUrl(item.url) || "Browser";
}

function renderLiveDownloads() {
  const items = state.liveDownloads.filter((item) =>
    ["in_progress", "interrupted"].includes(item.state)
  );
  elements.liveDownloads.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-compact";
    empty.textContent = "No active downloads. New activity will appear here.";
    elements.liveDownloads.append(empty);
    return;
  }

  for (const item of items.slice(0, 8)) {
    const card = document.createElement("article");
    card.className = "download-card";

    const icon = document.createElement("span");
    icon.className = "file-icon";
    const extension = fileNameFromItem(item).split(".").pop();
    icon.textContent = extension && extension.length <= 4 ? extension : "file";

    const main = document.createElement("div");
    main.className = "download-main";
    const title = document.createElement("p");
    title.className = "download-title";
    title.textContent = fileNameFromItem(item);
    title.title = item.filename || item.url || "";
    const subtitle = document.createElement("p");
    subtitle.className = "download-subtitle";
    const total = Number(item.totalBytes) || 0;
    const received = Number(item.bytesReceived) || 0;
    subtitle.textContent = `${extensionText(item)} · ${formatBytes(received)}${
      total > 0 ? ` of ${formatBytes(total)}` : ""
    }`;
    main.append(title, subtitle);

    if (item.state === "in_progress") {
      const track = document.createElement("div");
      track.className = "progress-track";
      const bar = document.createElement("div");
      bar.className = "progress-bar";
      bar.style.width = `${total > 0 ? Math.min(100, (received / total) * 100) : 12}%`;
      track.append(bar);
      main.append(track);
    }

    const status = document.createElement("span");
    status.className = `download-state ${item.state}`;
    status.textContent = item.state === "in_progress" ? (item.paused ? "paused" : "active") : item.state;

    card.append(icon, main, status);
    elements.liveDownloads.append(card);
  }
}

function filteredRecords() {
  const query = state.query.trim().toLowerCase();
  const otherEvents = new Set([
    "monitor_started",
    "monitor_paused",
    "paused",
    "resumed",
    "danger_changed",
    "filename_changed",
    "file_removed",
    "history_erased",
    "updated"
  ]);

  return groupLogEvents(state.events).filter((record) => {
    if (state.sourceFilter === "extension" && !record.isExtensionInitiated) {
      return false;
    }
    if (state.sourceFilter === "other" && record.isExtensionInitiated) {
      return false;
    }
    if (state.eventFilter !== "all") {
      if (
        state.eventFilter === "other" &&
        !record.eventTypes.some((eventType) => otherEvents.has(eventType))
      ) {
        return false;
      }
      if (state.eventFilter !== "other" && !record.eventTypes.includes(state.eventFilter)) {
        return false;
      }
    }
    if (!query) {
      return true;
    }
    return `${record.summary} ${record.fileName} ${record.eventTypes.join(" ")} ${
      record.downloadId ?? ""
    } ${record.extension?.name || ""} ${record.extension?.id || ""} ${JSON.stringify(
      record.events
    )}`
      .toLowerCase()
      .includes(query);
  });
}

function makeTag(text, extension = false) {
  const tag = document.createElement("span");
  tag.className = extension ? "tag tag-extension" : "tag";
  tag.textContent = text;
  return tag;
}

function appendRecordTags(tags, record) {
  if (record.downloadId !== null) {
    tags.append(makeTag(`Download ID ${record.downloadId}`));
  }
  tags.append(makeTag(`${record.eventCount} linked event${record.eventCount === 1 ? "" : "s"}`));
  if (record.extension) {
    tags.append(makeTag(record.extension.name, true));
    if (record.extension.id) {
      tags.append(makeTag(record.extension.id, true));
    }
  } else if (record.downloadId !== null) {
    tags.append(makeTag("No extension attribution"));
  }
}

function renderNaturalTimeline(record) {
  const details = document.createElement("details");
  details.className = "natural-timeline";
  details.dataset.role = "natural-timeline";

  const summary = document.createElement("summary");
  summary.textContent = `View ${record.eventCount} linked lifecycle event${
    record.eventCount === 1 ? "" : "s"
  }`;
  const timeline = document.createElement("ol");

  for (const event of record.events) {
    const item = document.createElement("li");
    const heading = document.createElement("div");
    heading.className = "timeline-heading";
    const label = document.createElement("strong");
    label.textContent = eventLabel(event.eventType);
    const time = document.createElement("time");
    time.dateTime = event.timestamp;
    time.textContent = formatClock(event.timestamp);
    const description = document.createElement("p");
    description.textContent = event.natural;
    heading.append(label, time);
    item.append(heading, description);
    timeline.append(item);
  }

  details.append(summary, timeline);
  return details;
}

function renderNaturalEntry(record) {
  const article = document.createElement("article");
  article.className = "natural-entry";
  article.dataset.entryId = record.id;

  const dot = document.createElement("span");
  dot.className = `event-dot ${record.severity}`;
  dot.textContent = eventGlyph(record.status);

  const body = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent =
    record.kind === "download"
      ? `${record.fileName} · ${eventLabel(record.status)}`
      : eventLabel(record.status);
  const description = document.createElement("p");
  description.textContent = record.summary;
  const tags = document.createElement("div");
  tags.className = "entry-tags";
  appendRecordTags(tags, record);
  body.append(heading, description, tags, renderNaturalTimeline(record));

  const time = document.createElement("time");
  time.className = "entry-time";
  time.dateTime = record.updatedAt;
  time.textContent = formatClock(record.updatedAt);

  article.append(dot, body, time);
  return article;
}

function renderTechnicalEntry(record) {
  const article = document.createElement("article");
  article.className = "technical-entry";
  article.dataset.entryId = record.id;
  const details = document.createElement("details");
  details.dataset.role = "technical-record";
  const summary = document.createElement("summary");

  const event = document.createElement("span");
  event.className = "technical-event";
  event.textContent =
    record.downloadId === null ? record.status : `download_${record.downloadId}`;
  const api = document.createElement("span");
  api.className = "technical-api";
  api.textContent =
    record.kind === "download"
      ? `${record.fileName} · ${record.eventCount} linked lifecycle event${
          record.eventCount === 1 ? "" : "s"
        } · ${record.status}`
      : record.latestEvent.technical?.apiEvent || "monitor event";
  const time = document.createElement("time");
  time.className = "entry-time";
  time.dateTime = record.updatedAt;
  time.textContent = formatClock(record.updatedAt);
  summary.append(event, api, time);

  const code = document.createElement("pre");
  code.dataset.role = "technical-json";
  code.textContent = JSON.stringify(technicalRecordForGroup(record), null, 2);
  details.append(summary, code);
  article.append(details);
  return article;
}

function updateRenderedEntry(existing, record) {
  const openDetails = new Set(
    [...existing.querySelectorAll("details[open]")].map((details) => details.dataset.role)
  );
  const scrollPositions = new Map(
    [...existing.querySelectorAll("[data-role]")].map((element) => [
      element.dataset.role,
      element.scrollTop
    ])
  );
  const replacement =
    state.view === "natural" ? renderNaturalEntry(record) : renderTechnicalEntry(record);

  existing.className = replacement.className;
  existing.dataset.entryId = replacement.dataset.entryId;
  existing.replaceChildren(...replacement.childNodes);

  for (const details of existing.querySelectorAll("details[data-role]")) {
    details.open = openDetails.has(details.dataset.role);
  }
  for (const element of existing.querySelectorAll("[data-role]")) {
    if (scrollPositions.has(element.dataset.role)) {
      element.scrollTop = scrollPositions.get(element.dataset.role);
    }
  }
}

function captureLogAnchor() {
  const entries = [...elements.logList.querySelectorAll("[data-entry-id]")];
  const visibleEntries = entries.filter((entry) => {
    const bounds = entry.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < window.innerHeight;
  });
  const anchor =
    visibleEntries.find((entry) => entry.querySelector("details[open]")) || visibleEntries[0];

  if (!anchor) {
    return null;
  }

  return {
    entryId: anchor.dataset.entryId,
    top: anchor.getBoundingClientRect().top
  };
}

function restoreLogAnchor(anchor) {
  if (!anchor) {
    return;
  }

  const matchingEntry = [...elements.logList.querySelectorAll("[data-entry-id]")].find(
    (entry) => entry.dataset.entryId === anchor.entryId
  );
  if (!matchingEntry) {
    return;
  }

  const topDelta = matchingEntry.getBoundingClientRect().top - anchor.top;
  if (topDelta) {
    window.scrollBy(0, topDelta);
  }
}

function renderLogs() {
  const entries = filteredRecords();
  const downloadCount = entries.filter((entry) => entry.kind === "download").length;
  const systemCount = entries.length - downloadCount;
  elements.resultCount.textContent = `${downloadCount} download${
    downloadCount === 1 ? "" : "s"
  }${systemCount ? ` · ${systemCount} system event${systemCount === 1 ? "" : "s"}` : ""}`;
  const anchor = captureLogAnchor();

  if (!entries.length) {
    elements.logList.replaceChildren();
    elements.logList.dataset.view = state.view;
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = state.events.length ? "No events match these filters" : "No download events yet";
    const text = document.createElement("p");
    text.textContent = state.events.length
      ? "Try a different source, event type, or search."
      : "Start a download in your browser and the monitor will explain what happens.";
    empty.append(title, text);
    elements.logList.append(empty);
    return;
  }

  reconcileLogEntries(
    elements.logList,
    entries,
    state.view,
    (entry) => (state.view === "natural" ? renderNaturalEntry(entry) : renderTechnicalEntry(entry)),
    updateRenderedEntry
  );
  restoreLogAnchor(anchor);
}

function render() {
  renderSettings();
  renderMetrics();
  renderLiveDownloads();
  renderLogs();
}

async function loadState() {
  const response = await sendMessage({ type: "GET_STATE" });
  state.events = response.events;
  state.settings = response.settings;
  state.liveDownloads = response.liveDownloads;
  state.bytesInUse = response.bytesInUse;
  render();
}

async function refreshLiveDownloads(sample = false) {
  if (sample) {
    await sendMessage({ type: "SAMPLE_PROGRESS" });
  }
  const response = await sendMessage({ type: "GET_LIVE_DOWNLOADS" });
  state.liveDownloads = response.liveDownloads;
  renderMetrics();
  renderLiveDownloads();
}

async function saveSetting(patch) {
  const response = await sendMessage({ type: "SET_SETTINGS", patch });
  state.settings = response.settings;
  renderSettings();
}

function setView(view) {
  state.view = view;
  for (const tab of [elements.naturalTab, elements.technicalTab]) {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  renderLogs();
}

function downloadBlob(contents, type, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const records = filteredRecords();
  const payload = {
    exportedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    settings: state.settings,
    records: records.map((record) => ({
      plainLanguageSummary: record.summary,
      technical: technicalRecordForGroup(record)
    }))
  };
  downloadBlob(
    JSON.stringify(payload, null, 2),
    "application/json",
    `download-monitor-by-the-nexus-pivot-${new Date().toISOString().slice(0, 10)}.json`
  );
  showToast(`Exported ${payload.records.length} grouped records as JSON.`);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  const columns = [
    "started_at",
    "updated_at",
    "current_status",
    "linked_event_count",
    "download_id",
    "file_name",
    "extension_name",
    "extension_id",
    "event_types",
    "plain_language_summary"
  ];
  const rows = filteredRecords().map((record) =>
    [
      record.startedAt,
      record.updatedAt,
      record.status,
      record.eventCount,
      record.downloadId,
      record.fileName,
      record.extension?.name,
      record.extension?.id,
      record.eventTypes.join(" | "),
      record.summary
    ]
      .map(csvCell)
      .join(",")
  );
  downloadBlob(
    [columns.map(csvCell).join(","), ...rows].join("\r\n"),
    "text/csv",
    `download-monitor-by-the-nexus-pivot-${new Date().toISOString().slice(0, 10)}.csv`
  );
  showToast(`Exported ${rows.length} grouped download records as CSV.`);
}

elements.naturalTab.addEventListener("click", () => setView("natural"));
elements.technicalTab.addEventListener("click", () => setView("technical"));
elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderLogs();
});
elements.sourceFilter.addEventListener("change", (event) => {
  state.sourceFilter = event.target.value;
  renderLogs();
});
elements.eventFilter.addEventListener("change", (event) => {
  state.eventFilter = event.target.value;
  renderLogs();
});
elements.monitoringToggle.addEventListener("change", (event) => {
  void saveSetting({ enabled: event.target.checked });
});
elements.extensionOnlyToggle.addEventListener("change", (event) => {
  void saveSetting({ onlyExtensionDownloads: event.target.checked });
});
elements.fullDetailsToggle.addEventListener("change", (event) => {
  void saveSetting({ storeFullDetails: event.target.checked });
  showToast("The detail setting applies to future log entries.");
});
elements.maxEventsSelect.addEventListener("change", (event) => {
  void saveSetting({ maxEvents: Number(event.target.value) });
});
elements.refreshButton.addEventListener("click", () => {
  void refreshLiveDownloads(true).then(() => showToast("Live download state refreshed."));
});
elements.exportJsonButton.addEventListener("click", exportJson);
elements.exportCsvButton.addEventListener("click", exportCsv);
elements.clearButton.addEventListener("click", () => {
  if (!confirm("Clear all recorded download events? This cannot be undone.")) {
    return;
  }
  void sendMessage({ type: "CLEAR_LOGS" }).then(() => {
    state.events = [];
    render();
    showToast("All recorded events were cleared.");
  });
});
elements.showFolderButton.addEventListener("click", () => chrome.downloads.showDefaultFolder());
elements.openDownloadsButton.addEventListener("click", () =>
  chrome.tabs.create({ url: "chrome://downloads/" })
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes.downloadMonitorEvents) {
    state.events = changes.downloadMonitorEvents.newValue || [];
    renderMetrics();
    renderLogs();
  }
  if (changes.downloadMonitorSettings) {
    state.settings = changes.downloadMonitorSettings.newValue || {};
    renderSettings();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refreshLiveDownloads(true);
  }
});

setInterval(() => {
  if (!document.hidden) {
    void refreshLiveDownloads(false);
  }
}, 2000);

setInterval(() => {
  if (!document.hidden) {
    void sendMessage({ type: "SAMPLE_PROGRESS" });
  }
}, 5000);

loadState().catch((error) => {
  console.error(error);
  showToast(`Unable to load the monitor: ${error.message}`);
});
