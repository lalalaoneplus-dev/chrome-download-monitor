import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { groupLogEvents } from "../src/log-groups.js";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function listener() {
  let callback;
  return {
    addListener(next) {
      callback = next;
    },
    emit(...args) {
      return callback?.(...args);
    },
    get callback() {
      return callback;
    }
  };
}

const apiEvents = {
  created: listener(),
  changed: listener(),
  erased: listener(),
  alarm: listener(),
  clicked: listener(),
  installed: listener(),
  startup: listener(),
  message: listener()
};

const state = {
  storage: {
    downloadMonitorEvents: [
      {
        id: "legacy-incognito",
        downloadId: 501,
        eventType: "started",
        technical: {
          apiEvent: "chrome.downloads.onCreated",
          snapshot: { id: 501, incognito: true }
        }
      },
      {
        id: "legacy-incognito-completed",
        downloadId: 501,
        eventType: "completed",
        technical: { apiEvent: "chrome.downloads.onChanged", snapshot: { state: "complete" } }
      },
      {
        id: "legacy-incognito-erased",
        downloadId: 501,
        eventType: "history_erased",
        technical: { apiEvent: "chrome.downloads.onErased", downloadId: 501 }
      },
      {
        id: "standalone-unknown-erased",
        downloadId: 599,
        eventType: "history_erased",
        technical: { apiEvent: "chrome.downloads.onErased", downloadId: 599 }
      }
    ],
    downloadMonitorSettings: {
      enabled: true,
      onlyExtensionDownloads: false,
      storeFullDetails: false,
      maxEvents: 2000,
      progressStep: 10,
      privacySettingsVersion: 1
    },
    downloadMonitorProgress: {
      501: { bytesReceived: 10, bucket: 0, sampledAt: 1 }
    }
  },
  downloads: new Map(),
  delayEventWrites: false,
  pendingEventWrite: null,
  delaySettingsReads: false,
  pendingSettingsReads: []
};

function readStorage(keys) {
  if (typeof keys === "string") {
    return { [keys]: clone(state.storage[keys]) };
  }
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, clone(state.storage[key])]));
  }
  return clone(state.storage);
}

function writeStorage(values) {
  Object.assign(state.storage, clone(values));
}

globalThis.chrome = {
  storage: {
    local: {
      get(keys) {
        if (state.delaySettingsReads && keys === "downloadMonitorSettings") {
          return new Promise((resolve) => {
            state.pendingSettingsReads.push(resolve);
          });
        }
        return Promise.resolve(readStorage(keys));
      },
      set(values) {
        if (
          state.delayEventWrites &&
          Array.isArray(values.downloadMonitorEvents) &&
          values.downloadMonitorEvents.length
        ) {
          return new Promise((resolve) => {
            state.pendingEventWrite = { values, resolve };
          });
        }
        writeStorage(values);
        return Promise.resolve();
      },
      setAccessLevel() {
        return Promise.resolve();
      },
      getBytesInUse() {
        return Promise.resolve(0);
      }
    }
  },
  downloads: {
    onCreated: apiEvents.created,
    onChanged: apiEvents.changed,
    onErased: apiEvents.erased,
    search(query = {}) {
      let matches = [...state.downloads.values()];
      if (query.id !== undefined) {
        matches = matches.filter((item) => String(item.id) === String(query.id));
      }
      if (query.state) {
        matches = matches.filter((item) => item.state === query.state);
      }
      return Promise.resolve(matches);
    }
  },
  alarms: {
    onAlarm: apiEvents.alarm,
    create() {
      return Promise.resolve();
    }
  },
  action: {
    onClicked: apiEvents.clicked,
    setBadgeBackgroundColor() {
      return Promise.resolve();
    },
    setBadgeText() {
      return Promise.resolve();
    },
    setTitle() {
      return Promise.resolve();
    }
  },
  tabs: {
    create() {
      return Promise.resolve();
    }
  },
  runtime: {
    onInstalled: apiEvents.installed,
    onStartup: apiEvents.startup,
    onMessage: apiEvents.message,
    getURL(path) {
      return `chrome-extension://test/${path}`;
    }
  }
};

await import("../background.js?background-lifecycle-test");

async function flush() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    apiEvents.message.emit(message, {}, resolve);
  });
}

function eventFor(downloadId, eventType, apiEvent, snapshot = {}) {
  return {
    id: `${eventType}-${downloadId}`,
    downloadId,
    eventType,
    technical: { apiEvent, snapshot },
    isExtensionInitiated: false,
    extension: null
  };
}

await flush();

test("migration and persisted trust reject historical lifecycle noise", async () => {
  assert.equal(
    state.storage.downloadMonitorEvents.some(
      (event) => event.technical?.snapshot?.incognito === true
    ),
    false
  );
  assert.deepEqual(
    state.storage.downloadMonitorEvents.map((event) => event.id),
    ["standalone-unknown-erased"]
  );
  assert.deepEqual(state.storage.downloadMonitorProgress, {});

  state.downloads.set(701, { id: 701, state: "complete", incognito: false });
  state.downloads.set(702, { id: 702, state: "complete", incognito: false });
  state.downloads.set(703, { id: 703, state: "complete", incognito: true });
  state.storage.downloadMonitorEvents = [
    eventFor(701, "updated", "chrome.downloads.onChanged"),
    eventFor(702, "completed", "chrome.downloads.onChanged"),
    eventFor(703, "started", "chrome.downloads.onCreated", { incognito: true })
  ];

  apiEvents.changed.emit({ id: 701, state: { current: "complete" } });
  apiEvents.changed.emit({ id: 702, state: { current: "complete" } });
  apiEvents.changed.emit({ id: 703, state: { current: "complete" } });
  apiEvents.erased.emit(501);
  await flush();

  assert.deepEqual(state.storage.downloadMonitorEvents, [
    eventFor(701, "updated", "chrome.downloads.onChanged"),
    eventFor(702, "completed", "chrome.downloads.onChanged"),
    eventFor(703, "started", "chrome.downloads.onCreated", { incognito: true })
  ]);
});

test("created then completed immediately persists both and clears progress", async () => {
  const item = {
    id: 801,
    state: "in_progress",
    incognito: false,
    bytesReceived: 20,
    totalBytes: 100,
    filename: "/tmp/created.zip"
  };
  state.downloads.set(801, { ...item, state: "complete" });
  state.delaySettingsReads = true;
  apiEvents.created.emit(item);
  apiEvents.changed.emit({
    id: 801,
    state: { previous: "in_progress", current: "complete" }
  });
  for (let index = 0; index < 8 && !state.pendingSettingsReads.length; index += 1) {
    await flush();
  }
  assert.equal(state.pendingSettingsReads.length, 1);
  state.delaySettingsReads = false;
  state.pendingSettingsReads.shift()(readStorage("downloadMonitorSettings"));
  await flush();

  const lifecycle = state.storage.downloadMonitorEvents.filter((event) => event.downloadId === 801);
  assert.deepEqual(lifecycle.map((event) => event.eventType), ["completed", "started"]);
  const [group] = groupLogEvents(lifecycle);
  assert.equal(group.status, "completed");
  assert.deepEqual(group.events.map((event) => event.eventType), ["started", "completed"]);
  assert.equal(state.storage.downloadMonitorProgress[801], undefined);
});

test("queued clear waits for an in-flight event write", async () => {
  const item = {
    id: 802,
    state: "in_progress",
    incognito: false,
    bytesReceived: 20,
    totalBytes: 100,
    filename: "/tmp/queued.zip"
  };
  state.downloads.set(802, item);
  state.storage.downloadMonitorEvents = [];
  state.delayEventWrites = true;
  apiEvents.created.emit(item);
  for (let index = 0; index < 8 && !state.pendingEventWrite; index += 1) {
    await flush();
  }
  assert.ok(state.pendingEventWrite);

  const clearPromise = sendMessage({ type: "CLEAR_LOGS" });
  apiEvents.changed.emit({
    id: 802,
    state: { previous: "in_progress", current: "complete" }
  });
  apiEvents.erased.emit(802);
  let clearResolved = false;
  clearPromise.then(() => {
    clearResolved = true;
  });
  await flush();
  assert.equal(clearResolved, false);
  assert.deepEqual(state.storage.downloadMonitorEvents, []);

  const pending = state.pendingEventWrite;
  state.pendingEventWrite = null;
  state.delayEventWrites = false;
  writeStorage(pending.values);
  pending.resolve();
  const response = await clearPromise;
  await flush();
  assert.deepEqual(response, { ok: true, cleared: true });
  assert.deepEqual(
    state.storage.downloadMonitorEvents.map((event) => event.eventType),
    ["completed"]
  );
  assert.equal(state.storage.downloadMonitorProgress[802], undefined);
  const [group] = groupLogEvents(state.storage.downloadMonitorEvents);
  assert.equal(group.status, "completed");
  assert.deepEqual(group.events.map((event) => event.eventType), ["completed"]);
});

test("clear waits for an event delayed before its write", async () => {
  const item = {
    id: 805,
    state: "in_progress",
    incognito: false,
    bytesReceived: 0,
    totalBytes: 100,
    filename: "/tmp/pre-clear.zip"
  };
  state.storage.downloadMonitorEvents = [];
  state.delaySettingsReads = true;
  apiEvents.created.emit(item);
  for (let index = 0; index < 8 && !state.pendingSettingsReads.length; index += 1) {
    await flush();
  }
  assert.equal(state.pendingSettingsReads.length, 1);

  const clearPromise = sendMessage({ type: "CLEAR_LOGS" });
  let clearResolved = false;
  clearPromise.then(() => {
    clearResolved = true;
  });
  await flush();
  assert.equal(clearResolved, false);

  state.delaySettingsReads = false;
  state.pendingSettingsReads.shift()(readStorage("downloadMonitorSettings"));
  assert.deepEqual(await clearPromise, { ok: true, cleared: true });
  await flush();
  assert.deepEqual(state.storage.downloadMonitorEvents, []);
});

test("sampling ignores an active download without trusted provenance", async () => {
  const item = {
    id: 804,
    state: "in_progress",
    incognito: false,
    bytesReceived: 80,
    totalBytes: 100,
    filename: "/tmp/unrooted.zip"
  };
  state.downloads.set(804, item);
  const response = await sendMessage({ type: "SAMPLE_PROGRESS" });
  assert.deepEqual(response, { ok: true, sampled: true });
  assert.equal(
    state.storage.downloadMonitorEvents.some((event) => event.downloadId === 804),
    false
  );
  assert.equal(state.storage.downloadMonitorProgress[804], undefined);
});

test("paused monitoring stores no event or progress baseline", async () => {
  state.storage.downloadMonitorSettings.enabled = false;
  const item = {
    id: 806,
    state: "in_progress",
    incognito: false,
    bytesReceived: 20,
    totalBytes: 100,
    filename: "/tmp/paused.zip"
  };
  state.downloads.set(806, item);
  apiEvents.created.emit(item);
  await flush();
  state.downloads.set(806, { ...item, state: "complete" });
  apiEvents.changed.emit({ id: 806, state: { current: "complete" } });
  await flush();

  assert.equal(
    state.storage.downloadMonitorEvents.some((event) => event.downloadId === 806),
    false
  );
  assert.equal(state.storage.downloadMonitorProgress[806], undefined);
  state.storage.downloadMonitorSettings.enabled = true;
});

test("extension-only erased events inherit prior extension attribution", async () => {
  const settingsResponse = await sendMessage({
    type: "SET_SETTINGS",
    patch: { onlyExtensionDownloads: true }
  });
  assert.equal(settingsResponse.ok, true);

  const item = {
    id: 803,
    state: "in_progress",
    incognito: false,
    bytesReceived: 20,
    totalBytes: 100,
    filename: "/tmp/extension.zip",
    byExtensionId: "extension-id",
    byExtensionName: "Example extension"
  };
  state.downloads.set(803, item);
  apiEvents.created.emit(item);
  apiEvents.erased.emit(803);
  await flush();

  const erased = state.storage.downloadMonitorEvents.find(
    (event) => event.downloadId === 803 && event.eventType === "history_erased"
  );
  assert.equal(erased?.isExtensionInitiated, true);
  assert.deepEqual(erased?.extension, {
    id: "extension-id",
    name: "Example extension"
  });
});
