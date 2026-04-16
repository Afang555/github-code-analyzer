import { NextResponse } from "next/server";

import { createLocalRepositorySnapshot } from "@/lib/localRepositorySnapshots";

export const runtime = "nodejs";

const TEXT = {
  invalidProjectName: "projectName 参数无效",
  invalidManifest: "manifest 参数无效",
  invalidFileList: "上传的文件列表无效",
  emptyFiles: "未检测到可用的本地项目文件",
  createFailed: "创建本地项目快照失败",
} as const;

function normalizeRelativePath(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, "/");

  if (!normalized) {
    return null;
  }

  const segments = normalized.split("/").filter(Boolean);

  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }

  return segments.join("/");
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const projectNameValue = formData.get("projectName");
    const localPathValue = formData.get("localPath");
    const manifestValue = formData.get("manifest");
    const fileEntries = formData.getAll("files");

    const projectName =
      typeof projectNameValue === "string" ? projectNameValue.trim() : "";
    const localPath =
      typeof localPathValue === "string" ? localPathValue.trim() : projectName;

    if (!projectName) {
      return NextResponse.json(
        { error: TEXT.invalidProjectName },
        { status: 400 },
      );
    }

    if (typeof manifestValue !== "string") {
      return NextResponse.json({ error: TEXT.invalidManifest }, { status: 400 });
    }

    let manifest: string[];

    try {
      const parsed = JSON.parse(manifestValue) as unknown;
      manifest = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return NextResponse.json({ error: TEXT.invalidManifest }, { status: 400 });
    }

    if (manifest.length === 0 || fileEntries.length === 0) {
      return NextResponse.json({ error: TEXT.emptyFiles }, { status: 400 });
    }

    if (manifest.length !== fileEntries.length) {
      return NextResponse.json({ error: TEXT.invalidFileList }, { status: 400 });
    }

    const files: Array<{ path: string; content: string }> = [];

    for (const [index, entry] of fileEntries.entries()) {
      if (!(entry instanceof File)) {
        return NextResponse.json({ error: TEXT.invalidFileList }, { status: 400 });
      }

      const path = normalizeRelativePath(manifest[index] ?? "");

      if (!path) {
        continue;
      }

      files.push({
        path,
        content: await entry.text(),
      });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: TEXT.emptyFiles }, { status: 400 });
    }

    const snapshot = createLocalRepositorySnapshot({
      projectName,
      localPath: localPath || projectName,
      files,
    });

    return NextResponse.json({
      sourceId: snapshot.context.sourceId,
      projectName: snapshot.context.projectName,
      localPath: snapshot.context.localPath,
      fileCount: snapshot.fileContents.size,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : TEXT.createFailed,
      },
      { status: 500 },
    );
  }
}
