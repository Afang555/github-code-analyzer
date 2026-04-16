import "server-only";

import {
  DEFAULT_APP_SETTINGS,
  maskSecret,
  type AppSettingsEnvironmentSnapshot,
  type AppSettingsInput,
} from "@/lib/appSettings";

export type ResolvedServerAppSettings = {
  aiBaseUrl: string | null;
  aiApiKey: string | null;
  aiModel: string;
  githubToken: string | null;
  maxDrillDownDepth: number;
  maxKeySubFunctions: number;
};

function normalizeOptionalEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function parsePositiveIntegerEnv(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getEnvironmentGitHubToken(): string | null {
  return (
    normalizeOptionalEnvValue(process.env.GITHUB_TOKEN) ??
    normalizeOptionalEnvValue(process.env.GITHUB_API_TOKEN)
  );
}

export function getAppSettingsEnvironmentSnapshot(): AppSettingsEnvironmentSnapshot {
  const aiApiKey = normalizeOptionalEnvValue(process.env.OPENAI_COMPAT_API_KEY);
  const githubToken = getEnvironmentGitHubToken();

  return {
    aiBaseUrl: normalizeOptionalEnvValue(process.env.OPENAI_COMPAT_BASE_URL),
    aiApiKeyMasked: maskSecret(aiApiKey),
    aiModel: normalizeOptionalEnvValue(process.env.OPENAI_COMPAT_MODEL),
    githubTokenMasked: maskSecret(githubToken),
    maxDrillDownDepth: parsePositiveIntegerEnv(
      process.env.OPENAI_COMPAT_FUNCTION_MAX_DEPTH,
    ),
    maxKeySubFunctions: parsePositiveIntegerEnv(
      process.env.OPENAI_COMPAT_MAX_KEY_SUB_FUNCTIONS,
    ),
  };
}

export function resolveServerAppSettings(
  input: AppSettingsInput = {},
): ResolvedServerAppSettings {
  const env = getAppSettingsEnvironmentSnapshot();

  return {
    aiBaseUrl: env.aiBaseUrl ?? input.aiBaseUrl ?? null,
    aiApiKey:
      normalizeOptionalEnvValue(process.env.OPENAI_COMPAT_API_KEY) ??
      input.aiApiKey ??
      null,
    aiModel: env.aiModel ?? input.aiModel ?? DEFAULT_APP_SETTINGS.aiModel,
    githubToken:
      getEnvironmentGitHubToken() ??
      input.githubToken ??
      null,
    maxDrillDownDepth:
      env.maxDrillDownDepth ??
      input.maxDrillDownDepth ??
      DEFAULT_APP_SETTINGS.maxDrillDownDepth,
    maxKeySubFunctions:
      env.maxKeySubFunctions ??
      input.maxKeySubFunctions ??
      DEFAULT_APP_SETTINGS.maxKeySubFunctions,
  };
}
