import {
  classifyChange,
  extensionAttribution,
  naturalLanguageForEvent,
  sanitizeDelta,
  sanitizeDownloadItem,
  severityForEvent
} from "./src/log-format.js";
import {
  activeDownloadsQuery,
  extensionEvidenceForDownload,
  isTrackedDownloadId,
  migrateStoredDownloadState,
  nonIncognitoDownloads,
  TRACKING_PROVENANCE
} from "./src/downloads.js";
import { migrateSettings } from "./src/settings.js";

const EVENTS_KEY = "downloadMonitorEvents";
const SETTINGS_KEY = "downloadMonitorSettings";
const PROGRESS_KEY = "downloadMonitorProgress";
const SAMPLE_ALARM = "sample-active-downloads";

let writeQueue = Promise.resolve();
let initializationPromise;
// ponytail: keep one global lifecycle queue; split per-download only if throughput ever matters.
let lifecycleQueue = Promise.resolve();
const sessionTrackedDownloadIds = new Set();

function enqueueWrite(task) {
  const operation = writeQueue.then(task, task);
  writeQueue = operation.catch((error) => console.error("Download Monitor write failed", error));
  return operation;
}

function enqueueLifecycle(task) {
  const operation = lifecycleQueue.then(task, task);
  lifecycleQueue = operation.catch((error) =>
    console.error("Download Monitor lifecycle failed", error)
  );
  return operation;
}

async function getSettings() {
  await ensureReady();
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return migrateSettings(result[SETTINGS_KEY]).settings;
}

async function ensureInitialized() {
  const stored = await chrome.storage.local.get([EVENTS_KEY, SETTINGS_KEY, PROGRESS_KEY]);
  const updates = {};
  if (!Array.isArray(stored[EVENTS_KEY])) {
    updates[EVENTS_KEY] = [];
  }
  const settingsMigration = migrateSettings(stored[SETTINGS_KEY]);
  if (settingsMigration.migrated) {
    const migratedState = migrateStoredDownloadState(stored[EVENTS_KEY]);
    updates[EVENTS_KEY] = migratedState.events;
    updates[SETTINGS_KEY] = settingsMigration.settings;
    updates[PROGRESS_KEY] = migratedState.progress;
  }
  if (!stored[PROGRESS_KEY]) {
    updates[PROGRESS_KEY] = {};
  }
  if (Object.keys(updates).length) {
    await chrome.storage.local.set(updates);
  }

  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.alarms.create(SAMPLE_ALARM, { periodInMinutes: 0.5 });
}

function ensureReady() {
  if (!initializationPromise) {
    initializationPromise = ensureInitialized();
  }
  return initializationPromise;
}

function makeEntry(eventType, item, technical, extra = {}) {
  const attribution = extensionAttribution(item);
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    eventType,
    severity: severityForEvent(eventType),
    downloadId: item?.id ?? extra.downloadId ?? null,
    isExtensionInitiated: Boolean(attribution),
    extension: attribution,
    natural: naturalLanguageForEvent(eventType, item, extra),
    technical
  };
}

async function persistEntry(entry, settings, force = false) {
  await ensureReady();
  if (!force && !settings.enabled) {
    return false;
  }
  if (
    !force &&
    settings.onlyExtensionDownloads &&
    entry.downloadId !== null &&
    !entry.isExtensionInitiated
  ) {
    return false;
  }

  return enqueueWrite(async () => {
    const result = await chrome.storage.local.get(EVENTS_KEY);
    const events = Array.isArray(result[EVENTS_KEY]) ? result[EVENTS_KEY] : [];
    events.unshift(entry);
    events.length = Math.min(events.length, settings.maxEvents);
    await chrome.storage.local.set({ [EVENTS_KEY]: events });
    return true;
  });
}

async function findDownload(downloadId) {
  await ensureReady();
  const matches = await chrome.downloads.search({ id: downloadId });
  return matches[0] || null;
}

async function isTrackedDownload(downloadId) {
  const id = String(downloadId);
  if (sessionTrackedDownloadIds.has(id)) {
    return true;
  }
  await ensureReady();
  const stored = await chrome.storage.local.get([EVENTS_KEY, PROGRESS_KEY]);
  return isTrackedDownloadId(downloadId, stored[EVENTS_KEY], stored[PROGRESS_KEY]);
}

async function recordDownloadEvent(eventType, item, apiEvent, details = {}) {
  if (item?.incognito !== false) {
    return false;
  }
  const settings = await getSettings();
  const snapshot = sanitizeDownloadItem(item || {}, settings.storeFullDetails);
  const cleanDelta = details.delta
    ? sanitizeDelta(details.delta, settings.storeFullDetails)
    : undefined;
  const technical = {
    apiEvent,
    capturedAt: new Date().toISOString(),
    downloadId: item?.id ?? details.downloadId ?? null,
    ...(cleanDelta ? { delta: cleanDelta } : {}),
    ...(details.samplingSource ? { samplingSource: details.samplingSource } : {}),
    snapshot
  };
  const entry = makeEntry(eventType, snapshot, technical, {
    ...details,
    delta: cleanDelta,
    downloadId: item?.id ?? details.downloadId
  });
  return persistEntry(entry, settings);
}

async function recordMonitorState(eventType) {
  const settings = await getSettings();
  const technical = {
    apiEvent: "chrome.runtime",
    capturedAt: new Date().toISOString(),
    state: eventType === "monitor_started" ? "active" : "paused"
  };
  const entry = makeEntry(eventType, {}, technical);
  await persistEntry(entry, settings, true);
}

async function updateBadge() {
  await ensureReady();
  try {
    const active = nonIncognitoDownloads(
      await chrome.downloads.search({ state: "in_progress" })
    );
    const count = active.length;
    await chrome.action.setBadgeBackgroundColor({ color: count ? "#b84d14" : "#64748b" });
    await chrome.action.setBadgeText({ text: count ? String(count) : "" });
    await chrome.action.setTitle({
      title: count
        ? `${count} active download${count === 1 ? "" : "s"} - open monitor`
        : "Open Download Monitor"
    });
  } catch (error) {
    console.error("Unable to update action badge", error);
  }
}

async function handleCreated(item) {
  await ensureReady();
  const recorded = await recordDownloadEvent("started", item, "chrome.downloads.onCreated");
  if (!recorded) {
    sessionTrackedDownloadIds.delete(String(item?.id));
    await updateBadge();
    return;
  }
  await updateProgressBaseline(item, TRACKING_PROVENANCE.CREATED);
  await updateBadge();
}

async function handleChanged(delta) {
  await ensureReady();
  const item = await findDownload(delta.id);
  if (!item) {
    return;
  }
  if (item.incognito !== false || !(await isTrackedDownload(delta.id))) {
    return;
  }
  const eventType = classifyChange(delta);
  const isTerminal = ["completed", "interrupted"].includes(eventType);
  const recorded = await recordDownloadEvent(eventType, item, "chrome.downloads.onChanged", {
    delta
  });

  if (isTerminal) {
    await removeProgressBaseline(delta.id);
    sessionTrackedDownloadIds.delete(String(delta.id));
  } else if (recorded) {
    await updateProgressBaseline(item, TRACKING_PROVENANCE.LIFECYCLE);
  }
  await updateBadge();
}

async function handleErased(downloadId) {
  await ensureReady();
  if (!(await isTrackedDownload(downloadId))) {
    return;
  }
  const settings = await getSettings();
  const stored = await chrome.storage.local.get(EVENTS_KEY);
  const extension = extensionEvidenceForDownload(downloadId, stored[EVENTS_KEY]);
  const item = extension
    ? {
        id: downloadId,
        byExtensionId: extension.id,
        byExtensionName: extension.name
      }
    : {};
  const technical = {
    apiEvent: "chrome.downloads.onErased",
    capturedAt: new Date().toISOString(),
    downloadId
  };
  const entry = makeEntry("history_erased", item, technical, { downloadId });
  await persistEntry(entry, settings);
  await removeProgressBaseline(downloadId);
  sessionTrackedDownloadIds.delete(String(downloadId));
}

async function updateProgressBaseline(item, provenance = TRACKING_PROVENANCE.LIFECYCLE) {
  await ensureReady();
  if (item?.incognito !== false) {
    return false;
  }
  await enqueueWrite(async () => {
    const stored = await chrome.storage.local.get(PROGRESS_KEY);
    const progress = stored[PROGRESS_KEY] || {};
    progress[item.id] = {
      bytesReceived: Number(item.bytesReceived) || 0,
      bucket: progress[item.id]?.bucket ?? 0,
      sampledAt: Date.now(),
      provenance
    };
    await chrome.storage.local.set({ [PROGRESS_KEY]: progress });
  });
}

async function removeProgressBaseline(downloadId) {
  await ensureReady();
  await enqueueWrite(async () => {
    const stored = await chrome.storage.local.get(PROGRESS_KEY);
    const progress = stored[PROGRESS_KEY] || {};
    delete progress[downloadId];
    await chrome.storage.local.set({ [PROGRESS_KEY]: progress });
  });
}

async function sampleActiveDownloads(samplingSource = "alarm") {
  await ensureReady();
  const settings = await getSettings();
  if (!settings.enabled) {
    return;
  }

  const active = nonIncognitoDownloads(
    await chrome.downloads.search({ state: "in_progress" })
  );
  const stored = await chrome.storage.local.get(PROGRESS_KEY);
  const progress = stored[PROGRESS_KEY] || {};
  const now = Date.now();
  let changed = false;

  for (const item of active) {
    if (!(await isTrackedDownload(item.id))) {
      continue;
    }
    const received = Number(item.bytesReceived) || 0;
    const total = Number(item.totalBytes) || 0;
    const previous = progress[item.id];
    const percent = total > 0 ? Math.min(100, (received / total) * 100) : null;
    const bucket =
      percent === null ? 0 : Math.floor(percent / settings.progressStep) * settings.progressStep;
    const enoughUnknownBytes =
      !previous || received - previous.bytesReceived >= 5 * 1024 * 1024;
    const enoughUnknownTime = !previous || now - previous.sampledAt >= 15000;
    const shouldLog =
      received > 0 &&
      (percent === null
        ? enoughUnknownBytes && enoughUnknownTime
        : !previous || bucket > previous.bucket);

    if (shouldLog) {
      await recordDownloadEvent("progress", item, "chrome.downloads.search", {
        samplingSource
      });
    }

    progress[item.id] = {
      bytesReceived: received,
      bucket,
      sampledAt: now,
      provenance:
        progress[item.id]?.provenance || TRACKING_PROVENANCE.LIFECYCLE
    };
    changed = true;
  }

  const activeIds = new Set(
    active
      .filter((item) => isTrackedDownloadId(item.id, [], progress))
      .map((item) => String(item.id))
  );
  for (const id of Object.keys(progress)) {
    if (!activeIds.has(String(id))) {
      delete progress[id];
      changed = true;
    }
  }

  if (changed) {
    await enqueueWrite(() => chrome.storage.local.set({ [PROGRESS_KEY]: progress }));
  }
  await updateBadge();
}

async function getDashboardState() {
  await ensureReady();
  const stored = await chrome.storage.local.get([EVENTS_KEY, SETTINGS_KEY]);
  const liveDownloads = nonIncognitoDownloads(
    await chrome.downloads.search(activeDownloadsQuery())
  );
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  return {
    events: stored[EVENTS_KEY] || [],
    settings: migrateSettings(stored[SETTINGS_KEY]).settings,
    liveDownloads,
    bytesInUse
  };
}

async function updateSettings(patch) {
  await ensureReady();
  const previous = await getSettings();
  const next = {
    ...previous,
    ...patch,
    maxEvents: Math.max(100, Math.min(5000, Number(patch.maxEvents ?? previous.maxEvents))),
    progressStep: 10
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });

  if (next.maxEvents < previous.maxEvents) {
    await enqueueWrite(async () => {
      const stored = await chrome.storage.local.get(EVENTS_KEY);
      const events = (stored[EVENTS_KEY] || []).slice(0, next.maxEvents);
      await chrome.storage.local.set({ [EVENTS_KEY]: events });
    });
  }

  if (previous.enabled !== next.enabled) {
    await recordMonitorState(next.enabled ? "monitor_started" : "monitor_paused");
  }
  return next;
}

chrome.downloads.onCreated.addListener((item) => {
  if (item?.incognito === false && item?.id !== null && item?.id !== undefined) {
    const id = String(item.id);
    sessionTrackedDownloadIds.add(id);
  }
  void enqueueLifecycle(() => handleCreated(item));
});

chrome.downloads.onChanged.addListener((delta) => {
  void enqueueLifecycle(() => handleChanged(delta));
});

chrome.downloads.onErased.addListener((downloadId) => {
  void enqueueLifecycle(() => handleErased(downloadId));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SAMPLE_ALARM) {
    void enqueueLifecycle(() => sampleActiveDownloads("30-second alarm"));
  }
});

chrome.action.onClicked.addListener(() => {
  void enqueueLifecycle(async () => {
    await ensureReady();
    await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void enqueueLifecycle(async () => {
    await ensureReady();
    const settings = await getSettings();
    await recordMonitorState(settings.enabled ? "monitor_started" : "monitor_paused");
    await updateBadge();
  });
});

chrome.runtime.onStartup.addListener(() => {
  void enqueueLifecycle(async () => {
    await ensureReady();
    await updateBadge();
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const respond = async () => {
    await ensureReady();
    switch (message?.type) {
      case "GET_STATE":
        return getDashboardState();
      case "SET_SETTINGS":
        return { settings: await updateSettings(message.patch || {}) };
      case "CLEAR_LOGS":
        await enqueueWrite(() => chrome.storage.local.set({ [EVENTS_KEY]: [] }));
        return { cleared: true };
      case "SAMPLE_PROGRESS":
        await sampleActiveDownloads("open dashboard");
        return { sampled: true };
      case "GET_LIVE_DOWNLOADS":
        return {
          liveDownloads: nonIncognitoDownloads(
            await chrome.downloads.search(activeDownloadsQuery())
          )
        };
      default:
        throw new Error(`Unknown message type: ${message?.type}`);
    }
  };

  enqueueLifecycle(respond)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("Download Monitor message failed", error);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

void ensureReady();
void updateBadge();
