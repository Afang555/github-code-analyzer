import "server-only";

import fs from "node:fs";
import path from "node:path";

import { createFileTreeFromFileList } from "@/lib/fileTree";
import type { FileNode, LocalRepositoryContext } from "@/types/repository";

const MAX_LOCAL_SNAPSHOTS = 12;
const LOCAL_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
const LOCAL_SNAPSHOT_DIRECTORY = path.join(
  process.cwd(),
  ".codex-local-snapshots",
);

type LocalRepositorySnapshot = {
  context: LocalRepositoryContext;
  fileTree: FileNode[];
  fileContents: Map<string, string>;
  createdAt: number;
};

type SerializedLocalRepositorySnapshot = {
  context: LocalRepositoryContext;
  fileTree: FileNode[];
  fileContents: Array<[string, string]>;
  createdAt: number;
};

declare global {
  // Preserve the hot data cache across module reloads in the same process.
  // Disk remains the source of truth across route workers.
  var __localRepositorySnapshots:
    | Map<string, LocalRepositorySnapshot>
    | undefined;
}

const localRepositorySnapshots =
  globalThis.__localRepositorySnapshots ?? new Map<string, LocalRepositorySnapshot>();

if (!globalThis.__localRepositorySnapshots) {
  globalThis.__localRepositorySnapshots = localRepositorySnapshots;
}

function normalizeSnapshotPath(path: string): string | null {
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

function cleanupLocalRepositorySnapshots() {
  const now = Date.now();

  for (const [snapshotId, snapshot] of localRepositorySnapshots.entries()) {
    if (now - snapshot.createdAt > LOCAL_SNAPSHOT_TTL_MS) {
      localRepositorySnapshots.delete(snapshotId);
    }
  }

  const memorySnapshots = Array.from(localRepositorySnapshots.entries()).sort(
    (left, right) => right[1].createdAt - left[1].createdAt,
  );

  for (const [index, [snapshotId]] of memorySnapshots.entries()) {
    if (index < MAX_LOCAL_SNAPSHOTS) {
      continue;
    }

    localRepositorySnapshots.delete(snapshotId);
  }

  if (!fs.existsSync(LOCAL_SNAPSHOT_DIRECTORY)) {
    return;
  }

  const diskSnapshots = fs
    .readdirSync(LOCAL_SNAPSHOT_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const snapshotPath = path.join(LOCAL_SNAPSHOT_DIRECTORY, entry.name);
      const stats = fs.statSync(snapshotPath);
      return {
        snapshotId: entry.name.slice(0, -".json".length),
        snapshotPath,
        createdAt: stats.mtimeMs,
      };
    })
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const snapshot of diskSnapshots) {
    if (now - snapshot.createdAt <= LOCAL_SNAPSHOT_TTL_MS) {
      continue;
    }

    localRepositorySnapshots.delete(snapshot.snapshotId);
    fs.rmSync(snapshot.snapshotPath, { force: true });
  }

  for (const [index, snapshot] of diskSnapshots.entries()) {
    if (index < MAX_LOCAL_SNAPSHOTS) {
      continue;
    }

    localRepositorySnapshots.delete(snapshot.snapshotId);
    fs.rmSync(snapshot.snapshotPath, { force: true });
  }
}

function getSnapshotFilePath(sourceId: string): string {
  return path.join(LOCAL_SNAPSHOT_DIRECTORY, `${sourceId}.json`);
}

function serializeSnapshot(
  snapshot: LocalRepositorySnapshot,
): SerializedLocalRepositorySnapshot {
  return {
    context: snapshot.context,
    fileTree: snapshot.fileTree,
    fileContents: Array.from(snapshot.fileContents.entries()),
    createdAt: snapshot.createdAt,
  };
}

function hydrateSnapshot(
  value: SerializedLocalRepositorySnapshot,
): LocalRepositorySnapshot | null {
  if (
    !value ||
    typeof value !== "object" ||
    !value.context ||
    !Array.isArray(value.fileTree) ||
    !Array.isArray(value.fileContents) ||
    typeof value.createdAt !== "number"
  ) {
    return null;
  }

  const fileContents = new Map<string, string>();

  for (const entry of value.fileContents) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      typeof entry[1] !== "string"
    ) {
      return null;
    }

    fileContents.set(entry[0], entry[1]);
  }

  return {
    context: value.context,
    fileTree: value.fileTree,
    fileContents,
    createdAt: value.createdAt,
  };
}

function persistSnapshot(snapshot: LocalRepositorySnapshot) {
  fs.mkdirSync(LOCAL_SNAPSHOT_DIRECTORY, { recursive: true });

  const targetPath = getSnapshotFilePath(snapshot.context.sourceId);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(tempPath, JSON.stringify(serializeSnapshot(snapshot)), "utf8");
  fs.renameSync(tempPath, targetPath);
}

function loadSnapshotFromDisk(sourceId: string): LocalRepositorySnapshot | null {
  const snapshotPath = getSnapshotFilePath(sourceId);

  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as SerializedLocalRepositorySnapshot;
    const snapshot = hydrateSnapshot(parsed);

    if (!snapshot) {
      fs.rmSync(snapshotPath, { force: true });
      return null;
    }

    if (Date.now() - snapshot.createdAt > LOCAL_SNAPSHOT_TTL_MS) {
      fs.rmSync(snapshotPath, { force: true });
      return null;
    }

    localRepositorySnapshots.set(sourceId, snapshot);
    return snapshot;
  } catch {
    fs.rmSync(snapshotPath, { force: true });
    return null;
  }
}

export function createLocalRepositorySnapshot(args: {
  projectName: string;
  localPath: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}): LocalRepositorySnapshot {
  cleanupLocalRepositorySnapshots();

  const sourceId = crypto.randomUUID();
  const fileContents = new Map<string, string>();

  for (const file of args.files) {
    const normalizedPath = normalizeSnapshotPath(file.path);

    if (!normalizedPath) {
      continue;
    }

    fileContents.set(normalizedPath, file.content);
  }

  const normalizedPaths = Array.from(fileContents.keys());
  const projectName = args.projectName.trim() || "local-project";
  const localPath = args.localPath.trim() || projectName;
  const context: LocalRepositoryContext = {
    sourceType: "local",
    sourceId,
    projectName,
    branch: null,
    localPath,
    repositoryUrl: localPath,
    repositoryDescription: null,
  };

  const snapshot: LocalRepositorySnapshot = {
    context,
    fileTree: createFileTreeFromFileList(normalizedPaths),
    fileContents,
    createdAt: Date.now(),
  };

  localRepositorySnapshots.set(sourceId, snapshot);
  persistSnapshot(snapshot);

  return snapshot;
}

export function getLocalRepositorySnapshot(
  sourceId: string,
): LocalRepositorySnapshot | null {
  cleanupLocalRepositorySnapshots();

  const snapshot = localRepositorySnapshots.get(sourceId);

  if (snapshot) {
    return snapshot;
  }

  return loadSnapshotFromDisk(sourceId);
}
