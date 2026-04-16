"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, RotateCcw, Settings2, X } from "lucide-react";

import {
  DEFAULT_APP_SETTINGS,
  normalizeStoredAppSettings,
  type AppSettings,
  type AppSettingsEnvironmentResponse,
  type AppSettingsEnvironmentSnapshot,
} from "@/lib/appSettings";
import {
  getAppSettingsServerSnapshot,
  getAppSettingsSnapshot,
  resetAppSettings,
  saveAppSettings,
  subscribeAppSettings,
} from "@/lib/appSettingsStore";

type AppSettingsDialogProps = {
  buttonClassName?: string;
  buttonLabel?: string;
};

type AppSettingsDraft = {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  githubToken: string;
  maxDrillDownDepth: string;
  maxKeySubFunctions: string;
};

const EMPTY_ENVIRONMENT: AppSettingsEnvironmentSnapshot = {
  aiBaseUrl: null,
  aiApiKeyMasked: null,
  aiModel: null,
  githubTokenMasked: null,
  maxDrillDownDepth: null,
  maxKeySubFunctions: null,
};

function createDraftFromSettings(settings: AppSettings): AppSettingsDraft {
  return {
    aiBaseUrl: settings.aiBaseUrl,
    aiApiKey: settings.aiApiKey,
    aiModel: settings.aiModel,
    githubToken: settings.githubToken,
    maxDrillDownDepth: String(settings.maxDrillDownDepth),
    maxKeySubFunctions: String(settings.maxKeySubFunctions),
  };
}

function EnvironmentHint({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  if (value === null || value === "") {
    return null;
  }

  return (
    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
      <span className="font-medium">环境变量生效：</span>
      {label} = {String(value)}
    </p>
  );
}

function FieldLabel({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-2">
      <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {title}
      </label>
      {description && (
        <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {description}
        </p>
      )}
    </div>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
  visible,
  onToggleVisibility,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  visible: boolean;
  onToggleVisibility: () => void;
}) {
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      />
      <button
        type="button"
        onClick={onToggleVisibility}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        aria-label={visible ? "隐藏" : "显示"}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function AppSettingsDialog({
  buttonClassName,
  buttonLabel = "设置",
}: AppSettingsDialogProps) {
  const storedSettings = useSyncExternalStore(
    subscribeAppSettings,
    getAppSettingsSnapshot,
    getAppSettingsServerSnapshot,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<AppSettingsDraft>(
    createDraftFromSettings(storedSettings),
  );
  const [environment, setEnvironment] =
    useState<AppSettingsEnvironmentSnapshot>(EMPTY_ENVIRONMENT);
  const [isEnvironmentLoading, setIsEnvironmentLoading] = useState(false);
  const [environmentError, setEnvironmentError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [showAiApiKey, setShowAiApiKey] = useState(false);
  const [showGitHubToken, setShowGitHubToken] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDraft(createDraftFromSettings(storedSettings));
      setSaveMessage("");
    }
  }, [isOpen, storedSettings]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const loadEnvironment = async () => {
      setIsEnvironmentLoading(true);
      setEnvironmentError("");

      try {
        const response = await fetch("/api/settings", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as unknown;

        if (
          !response.ok ||
          !payload ||
          typeof payload !== "object" ||
          !("env" in payload)
        ) {
          throw new Error("加载环境变量设置失败");
        }

        const data = payload as AppSettingsEnvironmentResponse;
        setEnvironment(data.env ?? EMPTY_ENVIRONMENT);
      } catch (error) {
        setEnvironment(EMPTY_ENVIRONMENT);
        setEnvironmentError(
          error instanceof Error ? error.message : "加载环境变量设置失败",
        );
      } finally {
        setIsEnvironmentLoading(false);
      }
    };

    void loadEnvironment();
  }, [isOpen]);

  const hasEnvironmentOverride = useMemo(() => {
    return Boolean(
      environment.aiBaseUrl ||
        environment.aiApiKeyMasked ||
        environment.aiModel ||
        environment.githubTokenMasked ||
        environment.maxDrillDownDepth !== null ||
        environment.maxKeySubFunctions !== null,
    );
  }, [environment]);

  const handleDraftChange = (
    field: keyof AppSettingsDraft,
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setSaveMessage("");
  };

  const handleSave = () => {
    const nextSettings = normalizeStoredAppSettings({
      ...draft,
      maxDrillDownDepth: draft.maxDrillDownDepth,
      maxKeySubFunctions: draft.maxKeySubFunctions,
    });

    saveAppSettings(nextSettings);
    setDraft(createDraftFromSettings(nextSettings));
    setSaveMessage("本地设置已保存。环境变量存在时，仍会优先使用环境变量。");
  };

  const handleReset = () => {
    const nextSettings = resetAppSettings();
    setDraft(createDraftFromSettings(nextSettings));
    setSaveMessage("本地保存值已恢复为默认设置。");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          buttonClassName ??
          "inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        }
      >
        <Settings2 className="h-4 w-4" />
        <span>{buttonLabel}</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 p-4 backdrop-blur-sm sm:p-6">
          <div className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  设置
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  生效优先级：环境变量 &gt; 本地保存 &gt; 默认值
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="关闭设置"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              <div className="space-y-5">
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
                  <p>
                    这里保存的是当前浏览器的本地设置。项目启动时如果检测到环境变量与本地保存值不一致，运行时会自动以环境变量为准。
                  </p>
                  {hasEnvironmentOverride && (
                    <p className="mt-2">
                      当前已检测到环境变量覆盖项，移除对应环境变量后，本地保存值才会生效。
                    </p>
                  )}
                  {isEnvironmentLoading && (
                    <p className="mt-2 text-xs opacity-80">
                      正在读取环境变量设置…
                    </p>
                  )}
                  {environmentError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-300">
                      {environmentError}
                    </p>
                  )}
                </div>

                <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                  <FieldLabel title="AI Base URL" />
                  <input
                    type="text"
                    value={draft.aiBaseUrl}
                    onChange={(event) =>
                      handleDraftChange("aiBaseUrl", event.target.value)
                    }
                    placeholder="https://your-provider.example/v1"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  />
                  <EnvironmentHint
                    label="OPENAI_COMPAT_BASE_URL"
                    value={environment.aiBaseUrl}
                  />
                </section>

                <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                  <FieldLabel title="AI API Key" />
                  <SecretInput
                    value={draft.aiApiKey}
                    onChange={(value) => handleDraftChange("aiApiKey", value)}
                    placeholder="sk-..."
                    visible={showAiApiKey}
                    onToggleVisibility={() => setShowAiApiKey((current) => !current)}
                  />
                  <EnvironmentHint
                    label="OPENAI_COMPAT_API_KEY"
                    value={environment.aiApiKeyMasked}
                  />
                </section>

                <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                  <FieldLabel title="AI 模型名称" />
                  <input
                    type="text"
                    value={draft.aiModel}
                    onChange={(event) =>
                      handleDraftChange("aiModel", event.target.value)
                    }
                    placeholder={DEFAULT_APP_SETTINGS.aiModel}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  />
                  <EnvironmentHint
                    label="OPENAI_COMPAT_MODEL"
                    value={environment.aiModel}
                  />
                </section>

                <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                  <FieldLabel
                    title="GitHub Token"
                    description="用于访问私有仓库、提高 GitHub API 配额，并减少 403/429 限流。"
                  />
                  <SecretInput
                    value={draft.githubToken}
                    onChange={(value) => handleDraftChange("githubToken", value)}
                    placeholder="github_pat_xxx"
                    visible={showGitHubToken}
                    onToggleVisibility={() =>
                      setShowGitHubToken((current) => !current)
                    }
                  />
                  <EnvironmentHint
                    label="GITHUB_TOKEN / GITHUB_API_TOKEN"
                    value={environment.githubTokenMasked}
                  />
                </section>

                <div className="grid gap-5 md:grid-cols-2">
                  <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                    <FieldLabel
                      title="最大下钻层数"
                      description={`默认值：${DEFAULT_APP_SETTINGS.maxDrillDownDepth}`}
                    />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={draft.maxDrillDownDepth}
                      onChange={(event) =>
                        handleDraftChange(
                          "maxDrillDownDepth",
                          event.target.value,
                        )
                      }
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    />
                    <EnvironmentHint
                      label="OPENAI_COMPAT_FUNCTION_MAX_DEPTH"
                      value={environment.maxDrillDownDepth}
                    />
                  </section>

                  <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                    <FieldLabel
                      title="关键调用子函数数量"
                      description={`默认值：${DEFAULT_APP_SETTINGS.maxKeySubFunctions}`}
                    />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={draft.maxKeySubFunctions}
                      onChange={(event) =>
                        handleDraftChange(
                          "maxKeySubFunctions",
                          event.target.value,
                        )
                      }
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    />
                    <EnvironmentHint
                      label="OPENAI_COMPAT_MAX_KEY_SUB_FUNCTIONS"
                      value={environment.maxKeySubFunctions}
                    />
                  </section>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {saveMessage || "设置会持久化保存到当前浏览器。"}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>恢复默认</span>
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  保存设置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
