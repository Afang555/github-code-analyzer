export const APP_SETTINGS_STORAGE_KEY =
  "github-code-analyzer:settings:v1";
export const APP_SETTINGS_UPDATED_EVENT =
  "github-code-analyzer:settings-updated";
export const APP_GITHUB_TOKEN_HEADER = "x-app-github-token";

export const DEFAULT_APP_SETTINGS = {
  aiBaseUrl: "",
  aiApiKey: "",
  aiModel: "gpt-5.4",
  githubToken: "",
  maxDrillDownDepth: 2,
  maxKeySubFunctions: 10,
} as const;

export type AppSettings = {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  githubToken: string;
  maxDrillDownDepth: number;
  maxKeySubFunctions: number;
};

export type AppSettingsInput = Partial<AppSettings>;

export type AppSettingsEnvironmentSnapshot = {
  aiBaseUrl: string | null;
  aiApiKeyMasked: string | null;
  aiModel: string | null;
  githubTokenMasked: string | null;
  maxDrillDownDepth: number | null;
  maxKeySubFunctions: number | null;
};

export type AppSettingsEnvironmentResponse = {
  env: AppSettingsEnvironmentSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeTextSetting(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export function normalizeStoredAppSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_APP_SETTINGS };
  }

  return {
    aiBaseUrl: normalizeTextSetting(value.aiBaseUrl),
    aiApiKey: normalizeTextSetting(value.aiApiKey),
    aiModel:
      normalizeTextSetting(value.aiModel) || DEFAULT_APP_SETTINGS.aiModel,
    githubToken: normalizeTextSetting(value.githubToken),
    maxDrillDownDepth:
      parsePositiveInteger(value.maxDrillDownDepth) ??
      DEFAULT_APP_SETTINGS.maxDrillDownDepth,
    maxKeySubFunctions:
      parsePositiveInteger(value.maxKeySubFunctions) ??
      DEFAULT_APP_SETTINGS.maxKeySubFunctions,
  };
}

export function normalizeAppSettingsInput(value: unknown): AppSettingsInput {
  if (value === null || value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("settings must be a JSON object");
  }

  const result: AppSettingsInput = {};

  if ("aiBaseUrl" in value) {
    if (typeof value.aiBaseUrl !== "string") {
      throw new Error("settings.aiBaseUrl must be a string");
    }

    const normalized = normalizeTextSetting(value.aiBaseUrl);
    if (normalized) {
      result.aiBaseUrl = normalized;
    }
  }

  if ("aiApiKey" in value) {
    if (typeof value.aiApiKey !== "string") {
      throw new Error("settings.aiApiKey must be a string");
    }

    const normalized = normalizeTextSetting(value.aiApiKey);
    if (normalized) {
      result.aiApiKey = normalized;
    }
  }

  if ("aiModel" in value) {
    if (typeof value.aiModel !== "string") {
      throw new Error("settings.aiModel must be a string");
    }

    const normalized = normalizeTextSetting(value.aiModel);
    if (normalized) {
      result.aiModel = normalized;
    }
  }

  if ("githubToken" in value) {
    if (typeof value.githubToken !== "string") {
      throw new Error("settings.githubToken must be a string");
    }

    const normalized = normalizeTextSetting(value.githubToken);
    if (normalized) {
      result.githubToken = normalized;
    }
  }

  if ("maxDrillDownDepth" in value) {
    const normalized = parsePositiveInteger(value.maxDrillDownDepth);

    if (normalized === null) {
      throw new Error("settings.maxDrillDownDepth must be a positive integer");
    }

    result.maxDrillDownDepth = normalized;
  }

  if ("maxKeySubFunctions" in value) {
    const normalized = parsePositiveInteger(value.maxKeySubFunctions);

    if (normalized === null) {
      throw new Error("settings.maxKeySubFunctions must be a positive integer");
    }

    result.maxKeySubFunctions = normalized;
  }

  return result;
}

export function maskSecret(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`;
  }

  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

export function getGitHubTokenOverride(
  settings?: Pick<AppSettingsInput, "githubToken"> | null,
): string | null {
  const token =
    settings && typeof settings.githubToken === "string"
      ? settings.githubToken.trim()
      : "";

  return token || null;
}
