import type { FileNode } from "@/services/githubService";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".vscode",
  "__pycache__",
  "assets",
  "build",
  "coverage",
  "dist",
  "images",
  "node_modules",
  "out",
  "public",
  "static",
  "vendor",
]);

const CODE_FILE_EXTENSIONS = new Set([
  "astro",
  "bash",
  "bat",
  "c",
  "cc",
  "cjs",
  "clj",
  "cljs",
  "cmd",
  "cpp",
  "cs",
  "css",
  "cts",
  "cxx",
  "dart",
  "erl",
  "ex",
  "exs",
  "fish",
  "fs",
  "fsi",
  "fsx",
  "go",
  "gradle",
  "groovy",
  "h",
  "hh",
  "hpp",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "less",
  "lua",
  "m",
  "mdx",
  "mjs",
  "mm",
  "mod",
  "mts",
  "php",
  "pl",
  "pm",
  "ps1",
  "py",
  "r",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

const STACK_SIGNAL_FILE_NAMES = new Set([
  ".eslintrc",
  ".prettierrc",
  "cargo.lock",
  "cargo.toml",
  "composer.json",
  "deno.json",
  "deno.jsonc",
  "docker-compose.yaml",
  "docker-compose.yml",
  "dockerfile",
  "gemfile",
  "go.mod",
  "go.sum",
  "makefile",
  "package-lock.json",
  "package.json",
  "pipfile",
  "pnpm-lock.yaml",
  "poetry.lock",
  "pom.xml",
  "pyproject.toml",
  "requirements.txt",
  "settings.gradle",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "yarn.lock",
]);

const STACK_SIGNAL_SUFFIXES = [
  ".config.cjs",
  ".config.js",
  ".config.mjs",
  ".config.ts",
  ".config.yaml",
  ".config.yml",
  ".rc",
];

const PROJECT_INTRO_FILE_NAMES = new Set(["readme.md", "readme.mdx", "readme.txt"]);

function shouldIgnorePath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => IGNORED_DIRECTORIES.has(segment.toLowerCase()));
}

function hasCodeExtension(path: string): boolean {
  const fileName = path.split("/").pop();

  if (!fileName || !fileName.includes(".")) {
    return false;
  }

  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension ? CODE_FILE_EXTENSIONS.has(extension) : false;
}

function isStackSignalFile(path: string): boolean {
  const fileName = path.split("/").pop()?.toLowerCase();

  if (!fileName) {
    return false;
  }

  if (STACK_SIGNAL_FILE_NAMES.has(fileName)) {
    return true;
  }

  return STACK_SIGNAL_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

function isProjectIntroFile(path: string): boolean {
  const fileName = path.split("/").pop()?.toLowerCase();
  return fileName ? PROJECT_INTRO_FILE_NAMES.has(fileName) : false;
}

function isAnalysisCandidate(path: string): boolean {
  return hasCodeExtension(path) || isStackSignalFile(path) || isProjectIntroFile(path);
}

export function collectAnalysisCandidatePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];

  const visit = (items: FileNode[]) => {
    for (const node of items) {
      if (shouldIgnorePath(node.path)) {
        continue;
      }

      if (node.type === "file") {
        if (isAnalysisCandidate(node.path)) {
          paths.push(node.path);
        }
        continue;
      }

      if (node.children) {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return paths;
}
