export const PRIVACY_SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS = {
  enabled: true,
  onlyExtensionDownloads: false,
  storeFullDetails: false,
  maxEvents: 2000,
  progressStep: 10,
  privacySettingsVersion: PRIVACY_SETTINGS_VERSION
};

export function migrateSettings(stored) {
  const existing = stored && typeof stored === "object" ? stored : {};
  const settings = { ...DEFAULT_SETTINGS, ...existing };
  const migrated = existing.privacySettingsVersion !== PRIVACY_SETTINGS_VERSION;

  if (migrated) {
    settings.storeFullDetails = false;
    settings.privacySettingsVersion = PRIVACY_SETTINGS_VERSION;
  }

  return { settings, migrated };
}
