import {
  APP_SETTINGS_STORAGE_KEY,
  APP_SETTINGS_UPDATED_EVENT,
  DEFAULT_APP_SETTINGS,
  normalizeStoredAppSettings,
  type AppSettings,
} from "@/lib/appSettings";

const DEFAULT_APP_SETTINGS_SNAPSHOT: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
};

let cachedSettingsRawPayload: string | null = null;
let cachedSettingsSnapshot: AppSettings = DEFAULT_APP_SETTINGS_SNAPSHOT;

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function notifySettingsUpdated() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(APP_SETTINGS_UPDATED_EVENT));
}

function setSettingsSnapshotCache(
  rawPayload: string | null,
  settings: AppSettings,
) {
  cachedSettingsRawPayload = rawPayload;
  cachedSettingsSnapshot = settings;
}

function readSettingsSnapshotFromStorage(): AppSettings {
  const storage = getStorage();

  if (!storage) {
    setSettingsSnapshotCache(null, DEFAULT_APP_SETTINGS_SNAPSHOT);
    return cachedSettingsSnapshot;
  }

  const payload = storage.getItem(APP_SETTINGS_STORAGE_KEY);

  if (payload === cachedSettingsRawPayload) {
    return cachedSettingsSnapshot;
  }

  if (!payload) {
    setSettingsSnapshotCache(null, DEFAULT_APP_SETTINGS_SNAPSHOT);
    return cachedSettingsSnapshot;
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    const normalized = normalizeStoredAppSettings(parsed);
    setSettingsSnapshotCache(payload, normalized);
    return cachedSettingsSnapshot;
  } catch {
    setSettingsSnapshotCache(null, DEFAULT_APP_SETTINGS_SNAPSHOT);
    return cachedSettingsSnapshot;
  }
}

function writeSettings(settings: AppSettings): AppSettings {
  const storage = getStorage();

  if (!storage) {
    return settings;
  }

  const normalized = normalizeStoredAppSettings(settings);
  const serialized = JSON.stringify(normalized);
  storage.setItem(APP_SETTINGS_STORAGE_KEY, serialized);
  setSettingsSnapshotCache(serialized, normalized);
  notifySettingsUpdated();

  return cachedSettingsSnapshot;
}

export function getAppSettingsSnapshot(): AppSettings {
  return readSettingsSnapshotFromStorage();
}

export function getAppSettingsServerSnapshot(): AppSettings {
  return DEFAULT_APP_SETTINGS_SNAPSHOT;
}

export function subscribeAppSettings(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== APP_SETTINGS_STORAGE_KEY) {
      return;
    }

    onStoreChange();
  };

  const handleLocalUpdate = () => {
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(APP_SETTINGS_UPDATED_EVENT, handleLocalUpdate);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(APP_SETTINGS_UPDATED_EVENT, handleLocalUpdate);
  };
}

export function saveAppSettings(value: unknown): AppSettings {
  return writeSettings(normalizeStoredAppSettings(value));
}

export function resetAppSettings(): AppSettings {
  return writeSettings(DEFAULT_APP_SETTINGS_SNAPSHOT);
}
