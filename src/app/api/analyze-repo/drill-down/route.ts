import { NextResponse } from "next/server";

import { normalizeAppSettingsInput } from "@/lib/appSettings";
import {
  AIAnalysisServiceError,
  drillDownFunctionOverviewNode,
} from "@/lib/ai/openaiCompatible";
import {
  normalizeAIAnalysisResult,
  type FunctionCallAnalysisDebugData,
  type AIAnalysisResult,
} from "@/types/aiAnalysis";
import { normalizeRepositoryContext } from "@/types/repository";

export const runtime = "nodejs";

const TEXT = {
  invalidFilePaths: "filePaths 数组无效或为空。",
  invalidRepositoryContext: "repositoryContext 无效。",
  invalidSettings: "settings 无效。",
  invalidNodePath: "nodePath 无效，必须是由非负整数组成的数组。",
  invalidAnalysisResult: "analysisResult 无效，无法解析当前分析结果。",
  drillDownFailed: "手动下钻分析失败。",
} as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidNodePath(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "number" &&
        Number.isInteger(item) &&
        Number.isFinite(item) &&
        item >= 0,
    )
  );
}

function createTraceId(): string {
  return `manual-drill-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function stringifyLogPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeModelAttempts(debug: FunctionCallAnalysisDebugData | null): unknown[] {
  const attempts = debug?.model?.attempts ?? [];

  return attempts.map((attempt, index) => ({
    index,
    mode: attempt.mode,
    ok: attempt.ok,
    status: attempt.status,
    requestKeys:
      attempt.request && typeof attempt.request === "object"
        ? Object.keys(attempt.request as Record<string, unknown>)
        : [],
    responseType: Array.isArray(attempt.response)
      ? "array"
      : attempt.response === null
        ? "null"
        : typeof attempt.response,
    response:
      typeof attempt.response === "string"
        ? attempt.response
        : attempt.response ?? null,
  }));
}

export async function POST(req: Request) {
  const traceId = createTraceId();

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const filePaths = body.filePaths;
    const nodePath = body.nodePath;

    if (
      !Array.isArray(filePaths) ||
      filePaths.length === 0 ||
      !filePaths.every(isNonEmptyString)
    ) {
      return NextResponse.json(
        { error: TEXT.invalidFilePaths },
        { status: 400 },
      );
    }

    let repositoryContext;
    let settings;

    try {
      repositoryContext = normalizeRepositoryContext(body.repositoryContext);
    } catch {
      return NextResponse.json(
        { error: TEXT.invalidRepositoryContext },
        { status: 400 },
      );
    }

    try {
      settings = normalizeAppSettingsInput(body.settings);
    } catch {
      return NextResponse.json(
        { error: TEXT.invalidSettings },
        { status: 400 },
      );
    }

    if (!isValidNodePath(nodePath)) {
      return NextResponse.json(
        { error: TEXT.invalidNodePath },
        { status: 400 },
      );
    }

    const normalizedFilePaths = (filePaths as string[]).map((path) =>
      path.trim(),
    );
    const normalizedNodePath = nodePath as number[];
    let analysisResult: AIAnalysisResult;

    try {
      analysisResult = normalizeAIAnalysisResult(body.analysisResult);
    } catch {
      return NextResponse.json(
        { error: TEXT.invalidAnalysisResult },
        { status: 400 },
      );
    }

    const outcome = await drillDownFunctionOverviewNode({
      filePaths: normalizedFilePaths,
      repositoryContext,
      analysisResult,
      nodePath: normalizedNodePath,
      settings,
    });

    if (outcome.debug.status !== "completed") {
      console.error(
        `[Manual Drill-Down][${traceId}] Non-completed outcome\n${stringifyLogPayload(
          {
            status: outcome.debug.status,
            message: outcome.debug.message,
            targetEntryPoint: outcome.debug.targetEntryPoint,
            readmePath: outcome.debug.readmePath,
            nodePath: normalizedNodePath,
            modelAttempts: summarizeModelAttempts(outcome.debug),
            drillDownAttempts: outcome.debug.drillDownAttempts,
            cacheEvents: outcome.debug.cacheEvents,
            fullDebug: outcome.debug,
          },
        )}`,
      );
    }

    return NextResponse.json({
      result: outcome.result,
      debug: {
        functionOverview: outcome.debug,
      },
    });
  } catch (error: unknown) {
    console.error(
      `[Manual Drill-Down][${traceId}] Route error\n${stringifyLogPayload({
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        debug:
          error instanceof AIAnalysisServiceError
            ? error.debug?.functionOverview ?? null
            : null,
      })}`,
    );

    const message =
      error instanceof Error ? error.message : TEXT.drillDownFailed;

    return NextResponse.json(
      {
        error: message,
        debug:
          error instanceof AIAnalysisServiceError && error.debug?.functionOverview
            ? {
                functionOverview: error.debug.functionOverview,
              }
            : undefined,
      },
      { status: 500 },
    );
  }
}
