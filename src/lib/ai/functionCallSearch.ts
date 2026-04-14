import type { FunctionCallNode } from "@/types/aiAnalysis";

const SEARCHABLE_FUNCTION_EXTENSIONS = new Set([
  "c",
  "cc",
  "cjs",
  "clj",
  "cljs",
  "cpp",
  "cs",
  "cts",
  "cxx",
  "dart",
  "erl",
  "ex",
  "exs",
  "fs",
  "fsi",
  "fsx",
  "go",
  "groovy",
  "h",
  "hh",
  "hpp",
  "java",
  "js",
  "jsx",
  "kt",
  "kts",
  "lua",
  "m",
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
  "scala",
  "sh",
  "swift",
  "ts",
  "tsx",
  "vue",
  "zsh",
]);

const NON_LOCAL_FUNCTION_NAMES = new Set([
  "anonymous",
  "<anonymous>",
  "default export",
  "module bootstrap",
]);

const LIKELY_NON_PROJECT_FUNCTION_NAMES = new Set([
  "map",
  "filter",
  "reduce",
  "foreach",
  "find",
  "findindex",
  "includes",
  "some",
  "every",
  "push",
  "pop",
  "shift",
  "unshift",
  "slice",
  "splice",
  "concat",
  "join",
  "sort",
  "reverse",
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
  "printf",
  "println",
  "sprintf",
  "snprintf",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "fetch",
  "require",
  "import",
  "then",
  "catch",
  "finally",
  "parse",
  "stringify",
  "useState",
  "useEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useContext",
]);

type ExtractionMode = "brace" | "indent" | "single";

type FunctionPattern = {
  regex: RegExp;
  mode: ExtractionMode;
};

type ParsedFunctionSearchName = {
  normalizedName: string;
  qualifiers: string[];
};

type LocatedPatternMatch = {
  mode: ExtractionMode;
  index: number;
};

export type FunctionSearchStrategy = "same_file" | "ai_guess" | "project_search";

export type FunctionDefinitionMatch = {
  filePath: string;
  line: number;
  snippet: string;
  totalLines: number;
  extractedLines: number;
  strategy: FunctionSearchStrategy;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function getFileExtension(path: string): string | null {
  const fileName = path.split("/").pop();

  if (!fileName || !fileName.includes(".")) {
    return null;
  }

  return fileName.split(".").pop()?.toLowerCase() ?? null;
}

export function isSearchableFunctionFile(path: string): boolean {
  const extension = getFileExtension(path);
  return extension ? SEARCHABLE_FUNCTION_EXTENSIONS.has(extension) : false;
}

function getDirectoryPath(path: string | null): string | null {
  if (!path || !path.includes("/")) {
    return null;
  }

  return path.slice(0, path.lastIndexOf("/"));
}

function countIndent(line: string): number {
  const match = line.match(/^[\t ]*/);
  return match ? match[0].length : 0;
}

function isDecoratorLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("@");
}

function getLeadingDecoratedStart(lines: string[], startLineIndex: number): number {
  let current = startLineIndex;

  while (current > 0 && isDecoratorLine(lines[current - 1])) {
    current -= 1;
  }

  return current;
}

function buildLineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;

  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  return offsets;
}

function findLineIndexFromOffset(offsets: number[], index: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = offsets[mid];
    const nextStart = offsets[mid + 1] ?? Number.MAX_SAFE_INTEGER;

    if (index < start) {
      high = mid - 1;
      continue;
    }

    if (index >= nextStart) {
      low = mid + 1;
      continue;
    }

    return mid;
  }

  return Math.max(0, Math.min(offsets.length - 1, low));
}

function findBraceBlockEnd(source: string, openBraceIndex: number): number | null {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (!escaped && char === "'") {
        inSingleQuote = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (inDoubleQuote) {
      if (!escaped && char === '"') {
        inDoubleQuote = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (inTemplateString) {
      if (!escaped && char === "`") {
        inTemplateString = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      escaped = false;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      escaped = false;
      continue;
    }

    if (char === "`") {
      inTemplateString = true;
      escaped = false;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function extractBraceSnippet(lines: string[], startLineIndex: number): string {
  const actualStartLineIndex = getLeadingDecoratedStart(lines, startLineIndex);
  const source = lines.join("\n");
  const offsets = buildLineStartOffsets(lines);
  const startOffset = offsets[actualStartLineIndex] ?? 0;
  const openBraceIndex = source.indexOf("{", startOffset);

  if (openBraceIndex === -1) {
    return extractSingleSnippet(lines, actualStartLineIndex);
  }

  const closeBraceIndex = findBraceBlockEnd(source, openBraceIndex);

  if (closeBraceIndex === null) {
    return extractSingleSnippet(lines, actualStartLineIndex);
  }

  const endLineIndex = findLineIndexFromOffset(offsets, closeBraceIndex);
  return lines.slice(actualStartLineIndex, endLineIndex + 1).join("\n");
}

function extractIndentedSnippet(lines: string[], startLineIndex: number): string {
  const actualStartLineIndex = getLeadingDecoratedStart(lines, startLineIndex);
  const baseIndent = countIndent(lines[startLineIndex] ?? "");
  let endLineIndex = lines.length - 1;

  for (let index = startLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (countIndent(line) <= baseIndent) {
      endLineIndex = index - 1;
      break;
    }
  }

  return lines.slice(actualStartLineIndex, endLineIndex + 1).join("\n");
}

function extractSingleSnippet(lines: string[], startLineIndex: number): string {
  const actualStartLineIndex = getLeadingDecoratedStart(lines, startLineIndex);
  let endLineIndex = startLineIndex;
  let openParens = 0;
  let seenContent = false;

  for (let index = startLineIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed && seenContent) {
      break;
    }

    if (trimmed) {
      seenContent = true;
    }

    for (const char of line) {
      if (char === "(") {
        openParens += 1;
      } else if (char === ")") {
        openParens = Math.max(0, openParens - 1);
      }
    }

    endLineIndex = index;

    if (trimmed.includes("{")) {
      return extractBraceSnippet(lines, actualStartLineIndex);
    }

    if (openParens === 0 && /[;{]$/.test(trimmed)) {
      break;
    }
  }

  return lines.slice(actualStartLineIndex, endLineIndex + 1).join("\n");
}

function parseFunctionSearchName(name: string): ParsedFunctionSearchName | null {
  const trimmedName = name.trim().replace(/\(\)$/g, "");
  const lowered = trimmedName.toLowerCase();

  if (!trimmedName || NON_LOCAL_FUNCTION_NAMES.has(lowered)) {
    return null;
  }

  const normalizedParts = trimmedName
    .split(/::|->|\.|#|\/|\\/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const normalizedCandidate = normalizedParts[normalizedParts.length - 1] ?? trimmedName;
  const normalizedName = normalizedCandidate.replace(/^[`'"]+|[`'"]+$/g, "");

  if (!normalizedName || !/^[A-Za-z_$][\w$]*$/.test(normalizedName)) {
    return null;
  }

  const qualifierParts = trimmedName
    .split(/::|->|\.|#/g)
    .map((part) => part.trim().replace(/^[`'"]+|[`'"]+$/g, ""))
    .filter(Boolean);

  return {
    normalizedName,
    qualifiers: qualifierParts.slice(0, -1),
  };
}

export function normalizeFunctionSearchName(name: string): string | null {
  return parseFunctionSearchName(name)?.normalizedName ?? null;
}

export function isLikelyNonProjectFunctionName(name: string): boolean {
  const normalized = normalizeFunctionSearchName(name);

  if (!normalized) {
    return true;
  }

  const lowered = normalized.toLowerCase();
  return (
    LIKELY_NON_PROJECT_FUNCTION_NAMES.has(normalized) ||
    LIKELY_NON_PROJECT_FUNCTION_NAMES.has(lowered) ||
    /^__.*__$/.test(normalized)
  );
}

function buildDefinitionPatterns(
  functionName: string,
  qualifiers: string[] = [],
): FunctionPattern[] {
  const name = escapeRegExp(functionName);
  const patterns: FunctionPattern[] = [];

  if (qualifiers.length > 0) {
    const qualifierTokens = qualifiers
      .map((qualifier) => qualifier.trim())
      .filter(Boolean)
      .map((qualifier) => escapeRegExp(qualifier));
    const qualifiedCppName = [...qualifierTokens, name].join("\\s*::\\s*");
    const qualifiedDotName = [...qualifierTokens, name].join("\\s*[.#]\\s*");

    patterns.push({
      regex: new RegExp(
        `^[\\t ]*(?:template\\s*<[^\\n{}]+>\\s*)?(?:(?:inline|static|virtual|constexpr|consteval|constinit|friend|extern|typename|auto|signed|unsigned|long|short|mutable|explicit)\\s+|(?:[A-Za-z_$~][\\w$:<>,\\[\\]\\*&?.~]*\\s+))*${qualifiedCppName}\\s*\\(`,
        "m",
      ),
      mode: "brace",
    });
    patterns.push({
      regex: new RegExp(
        `^[\\t ]*(?:(?:public|private|protected|internal|static|readonly|abstract|override|virtual|final|open|sealed|partial|async)\\s+)*(?:[A-Za-z_$][\\w$:<>,\\[\\]\\*&?.]*\\s+)+${qualifiedDotName}\\s*\\(`,
        "m",
      ),
      mode: "brace",
    });
    patterns.push({
      regex: new RegExp(
        `^[\\t ]*${qualifiedDotName}\\s*=\\s*(?:async\\s*)?function\\b`,
        "m",
      ),
      mode: "brace",
    });
    patterns.push({
      regex: new RegExp(
        `^[\\t ]*${qualifiedDotName}\\s*=\\s*(?:async\\s*)?(?:\\([^\\n]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`,
        "m",
      ),
      mode: "single",
    });
  }

  patterns.push(
    {
      regex: new RegExp(
        `^[\\t ]*(?:export\\s+default\\s+)?(?:export\\s+)?(?:async\\s+)?function\\*?\\s+${name}\\s*\\(`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:local\\s+)?function\\s+${name}\\s*\\(`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?function\\b`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^\\n]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`,
        "m",
      ),
      mode: "single",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:(?:public|private|protected|internal|static|readonly|abstract|override|virtual|final|open|sealed|partial|extern|constexpr|const|unsafe|synchronized|native|async)\\s+)*(?:<[^\\n{}>]+>\\s+)?(?:[A-Za-z_$][\\w$:<>,\\[\\]\\*&?.]*\\s+)+${name}\\s*\\(`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:(?:public|private|protected|internal|static|readonly|abstract|override|virtual|final|open|sealed|partial|async)\\s+)*(?:[A-Za-z_$][\\w$:<>,\\[\\]\\*&?.]*\\s+)+${name}\\s*\\([^\\n]*\\)\\s*=>`,
        "m",
      ),
      mode: "single",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:function\\s+)?${name}\\s*\\(\\)\\s*\\{`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*${name}\\s*:\\s*(?:async\\s*)?function\\b`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*${name}\\s*:\\s*(?:async\\s*)?(?:\\([^\\n]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`,
        "m",
      ),
      mode: "single",
    },
    {
      regex: new RegExp(
        `^[\\t ]*${name}\\s*=\\s*(?:async\\s*)?function\\b`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*${name}\\s*=\\s*(?:async\\s*)?(?:\\([^\\n]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`,
        "m",
      ),
      mode: "single",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:public|private|protected|internal|static|readonly|abstract|override|async|get|set|\\s)*${name}\\s*\\([^\\n]*\\)\\s*(?::\\s*[^={]+)?\\s*\\{`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:async\\s+)?def\\s+${name}\\s*\\(`,
        "m",
      ),
      mode: "indent",
    },
    {
      regex: new RegExp(
        `^[\\t ]*def\\s+${name}(?:\\s|\\()`,
        "m",
      ),
      mode: "indent",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${name}\\b`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*func\\s+(?:\\([^)]*\\)\\s*)?${name}\\s*\\(`,
        "m",
      ),
      mode: "brace",
    },
    {
      regex: new RegExp(
        `^[\\t ]*(?:public|private|protected|internal|static|override|open|final|suspend|inline|operator|tailrec|external|abstract|\\s)*fun\\s+${name}\\s*\\(`,
        "m",
      ),
      mode: "brace",
    },
  );

  return patterns;
}

function locatePatternMatch(
  content: string,
  functionName: string,
  qualifiers: string[] = [],
): LocatedPatternMatch | null {
  const patterns = buildDefinitionPatterns(functionName, qualifiers);
  let bestMatch: LocatedPatternMatch | null = null;

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const match = pattern.regex.exec(content);

    if (!match || match.index === undefined) {
      continue;
    }

    if (!bestMatch || match.index < bestMatch.index) {
      bestMatch = {
        mode: pattern.mode,
        index: match.index,
      };
    }
  }

  return bestMatch;
}

export function findFunctionDefinitionInContent(args: {
  content: string;
  filePath: string;
  functionName: string;
  strategy: FunctionSearchStrategy;
}): FunctionDefinitionMatch | null {
  const parsedSearchName = parseFunctionSearchName(args.functionName);
  const normalizedName = parsedSearchName?.normalizedName ?? null;

  if (!normalizedName) {
    return null;
  }

  const patternMatch = locatePatternMatch(
    args.content,
    normalizedName,
    parsedSearchName?.qualifiers ?? [],
  );

  if (!patternMatch) {
    return null;
  }

  const lines = splitLines(args.content);
  const lineOffsets = buildLineStartOffsets(lines);
  const lineIndex = findLineIndexFromOffset(lineOffsets, patternMatch.index);
  const snippet =
    patternMatch.mode === "indent"
      ? extractIndentedSnippet(lines, lineIndex)
      : patternMatch.mode === "brace"
        ? extractBraceSnippet(lines, lineIndex)
        : extractSingleSnippet(lines, lineIndex);

  return {
    filePath: args.filePath,
    line: lineIndex + 1,
    snippet,
    totalLines: lines.length,
    extractedLines: splitLines(snippet).length,
    strategy: args.strategy,
  };
}

function scoreSearchPath(args: {
  path: string;
  functionName: string;
  parentFilePath: string | null;
  hintedFilePath: string | null;
}): number {
  const parsedSearchName = parseFunctionSearchName(args.functionName);
  const normalizedName = parsedSearchName?.normalizedName.toLowerCase() ?? null;
  const qualifierHints = (parsedSearchName?.qualifiers ?? [])
    .map((qualifier) => qualifier.toLowerCase().replace(/[^a-z0-9_]/g, ""))
    .filter(Boolean);
  const lowerPath = args.path.toLowerCase();
  const lowerHintedPath = args.hintedFilePath?.toLowerCase() ?? null;
  const lowerParentPath = args.parentFilePath?.toLowerCase() ?? null;
  const parentDir = getDirectoryPath(lowerParentPath);
  const parentExtension = lowerParentPath ? getFileExtension(lowerParentPath) : null;
  const pathExtension = getFileExtension(lowerPath);
  const fileName = lowerPath.split("/").pop() ?? lowerPath;

  let score = 0;

  if (lowerHintedPath && lowerPath === lowerHintedPath) {
    score += 200;
  }

  if (lowerParentPath && lowerPath === lowerParentPath) {
    score += 120;
  }

  if (parentDir && lowerPath.startsWith(`${parentDir}/`)) {
    score += 40;
  }

  if (parentExtension && pathExtension && parentExtension === pathExtension) {
    score += 12;
  }

  if (normalizedName) {
    if (fileName.includes(normalizedName)) {
      score += 24;
    }

    if (lowerPath.includes(`/${normalizedName}/`)) {
      score += 10;
    }
  }

  for (const qualifierHint of qualifierHints) {
    if (fileName.includes(qualifierHint)) {
      score += 16;
    }

    if (lowerPath.includes(`/${qualifierHint}/`)) {
      score += 10;
    }
  }

  return score;
}

export function createRankedFunctionSearchPaths(args: {
  filePaths: string[];
  functionName: string;
  parentFilePath: string | null;
  hintedFilePath: string | null;
}): string[] {
  return Array.from(
    new Set(
      args.filePaths.filter((path) => isSearchableFunctionFile(path)),
    ),
  ).sort((left, right) => {
    const scoreDelta =
      scoreSearchPath({
        path: right,
        functionName: args.functionName,
        parentFilePath: args.parentFilePath,
        hintedFilePath: args.hintedFilePath,
      }) -
      scoreSearchPath({
        path: left,
        functionName: args.functionName,
        parentFilePath: args.parentFilePath,
        hintedFilePath: args.hintedFilePath,
      });

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.localeCompare(right);
  });
}

export async function searchFunctionDefinitionInFiles(args: {
  filePaths: string[];
  loadFileContent: (path: string) => Promise<string>;
  functionName: string;
  strategy: FunctionSearchStrategy;
}): Promise<FunctionDefinitionMatch | null> {
  for (const filePath of args.filePaths) {
    try {
      const content = await args.loadFileContent(filePath);
      const match = findFunctionDefinitionInContent({
        content,
        filePath,
        functionName: args.functionName,
        strategy: args.strategy,
      });

      if (match) {
        return match;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function countFunctionTreeNodes(root: FunctionCallNode | null): number {
  if (!root) {
    return 0;
  }

  return root.children.reduce(
    (count, child) => count + countFunctionTreeNodes(child),
    1,
  );
}

export function getFunctionTreeDepth(root: FunctionCallNode | null): number {
  if (!root) {
    return 0;
  }

  const visit = (node: FunctionCallNode, depth: number): number =>
    node.children.reduce(
      (maxDepth, child) => Math.max(maxDepth, visit(child, depth + 1)),
      depth,
    );

  return Math.max(1, visit(root, 0));
}
