import assert from "node:assert/strict";
import test from "node:test";

import { migrateStoredDownloadState } from "../src/downloads.js";
import { migrateSettings, PRIVACY_SETTINGS_VERSION } from "../src/settings.js";

test("migrates legacy privacy settings once and preserves current opt-in", () => {
  const legacy = migrateSettings({ privacySettingsVersion: 1, storeFullDetails: true });
  assert.equal(legacy.migrated, true);
  assert.equal(legacy.settings.storeFullDetails, false);
  assert.equal(legacy.settings.privacySettingsVersion, PRIVACY_SETTINGS_VERSION);

  const v2 = migrateSettings({ privacySettingsVersion: 2, storeFullDetails: true });
  assert.equal(v2.migrated, true);
  assert.equal(v2.settings.storeFullDetails, false);
  assert.equal(v2.settings.privacySettingsVersion, PRIVACY_SETTINGS_VERSION);

  const optedIn = migrateSettings({ ...legacy.settings, storeFullDetails: true });
  assert.equal(optedIn.migrated, false);
  assert.equal(optedIn.settings.storeFullDetails, true);

  const ordinary = { downloadId: 7, eventType: "started", technical: { snapshot: { id: 7 } } };
  const incognito = {
    downloadId: 8,
    eventType: "started",
    technical: { snapshot: { id: 8, incognito: true } }
  };
  const correlatedCompleted = {
    downloadId: 8,
    eventType: "completed",
    technical: { snapshot: { id: 8, state: "complete" } }
  };
  const correlatedErased = {
    downloadId: 8,
    eventType: "history_erased",
    technical: { snapshot: {} }
  };
  const erased = { downloadId: 9, eventType: "history_erased", technical: { snapshot: {} } };
  const migratedState = migrateStoredDownloadState([
    ordinary,
    incognito,
    correlatedCompleted,
    correlatedErased,
    erased
  ]);
  assert.deepEqual(migratedState.events, [ordinary, erased]);
  assert.deepEqual(migratedState.progress, {});
});
