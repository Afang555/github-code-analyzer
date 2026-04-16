import "server-only";

import type {
  AIAnalysisResult,
  FunctionCallBridgeMetadata,
  FunctionCallNode,
} from "@/types/aiAnalysis";
import {
  FUNCTION_CALL_BRIDGE_NODE_TYPES,
  formatFunctionCallRouteLabel,
} from "@/lib/functionCallBridgeUtils";

const MAX_BRIDGED_HANDLER_NODES = 20;
const MAX_FRONTEND_ENTRY_CHAIN_DEPTH = 4;
const JAVASCRIPT_MODULE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
] as const;

export type FunctionCallBridgeContext = {
  analysisResult: AIAnalysisResult;
  verifiedEntryPoint: string;
  entryContent: string;
  filePaths: string[];
  loadFileContent: (path: string) => Promise<string>;
};

export type ResolvedFunctionCallBridge = {
  id: string;
  framework: string;
  root: FunctionCallNode;
  handlerCount: number;
  truncated: boolean;
};

export type ResolvedFrontendWrapperEntryPoint = {
  effectivePath: string;
  chain: string[];
};

export type FunctionCallBridgeContinuationContext = {
  node: FunctionCallNode;
  locatedFilePath: string;
  locatedSnippet: string;
  bridgeRouteHandlers: FunctionCallNode[];
};

type FunctionCallBridge = {
  id: string;
  framework: string;
  detect: (context: FunctionCallBridgeContext) => boolean;
  build: (
    context: FunctionCallBridgeContext,
  ) => Promise<ResolvedFunctionCallBridge | null>;
};

type FunctionCallBridgeContinuationStrategy = {
  id: string;
  detect: (context: FunctionCallBridgeContinuationContext) => boolean;
  build: (context: FunctionCallBridgeContinuationContext) => FunctionCallNode[];
};

type RouteBridgeHandler = {
  name: string;
  filePath: string;
  routePath: string;
  routeMethods: string[];
};

type RouteFrameworkBridgeConfig = {
  id: string;
  framework: string;
  detect: (context: FunctionCallBridgeContext) => boolean;
  loadHandlers: (
    context: FunctionCallBridgeContext,
  ) => Promise<RouteBridgeHandler[]>;
  resolveRootName?: (args: {
    verifiedEntryPoint: string;
    entryContent: string;
  }) => string;
};

type SpringRouteMapping = {
  paths: string[];
  methods: string[];
};

type PythonImportAlias =
  | {
      kind: "module";
      modulePath: string;
    }
  | {
      kind: "member";
      modulePath: string;
      memberName: string;
    };

type FilePathLookup = Map<string, string>;
type PythonRouteRegistrationIndex = Map<string, string[]>;

type CollectedObjectMethodCall = {
  objectRef: string;
  methodName: string;
  argsText: string;
};

type CollectedFunctionCall = {
  functionName: string;
  argsText: string;
};

type CollectedConstructorAssignment = {
  variableName: string;
  constructorName: string;
  argsText: string;
};

const SPRING_BOOT_CONTROLLER_BRIDGE = createRouteFrameworkBridge({
  id: "spring-boot-controller",
  framework: "Spring Boot",
  detect(context) {
    if (!context.verifiedEntryPoint.toLowerCase().endsWith(".java")) {
      return false;
    }

    return (
      hasPrimaryLanguage(context.analysisResult, "java") &&
      (/@SpringBootApplication\b/.test(context.entryContent) ||
        /SpringApplication\.run\s*\(/.test(context.entryContent) ||
        hasTechKeyword(context.analysisResult, [
          "spring boot",
          "springboot",
          "spring framework",
          "spring",
        ]))
    );
  },
  loadHandlers: loadSpringBootControllerHandlers,
  resolveRootName(args) {
    return buildJavaBridgeRootName(args);
  },
});

const FASTAPI_ROUTE_BRIDGE = createRouteFrameworkBridge({
  id: "python-fastapi-route",
  framework: "FastAPI",
  detect(context) {
    return detectPythonFramework(context, {
      techStackKeywords: ["fastapi"],
      entryPatterns: [
        /\bFastAPI\s*\(/,
        /\bAPIRouter\s*\(/,
        /\bfrom\s+fastapi\s+import\b/i,
        /\bimport\s+fastapi\b/i,
      ],
    });
  },
  loadHandlers: loadPythonWebRouteHandlers,
  resolveRootName(args) {
    return buildPythonBridgeRootName(args);
  },
});

const FLASK_ROUTE_BRIDGE = createRouteFrameworkBridge({
  id: "python-flask-route",
  framework: "Flask",
  detect(context) {
    return detectPythonFramework(context, {
      techStackKeywords: ["flask"],
      entryPatterns: [
        /\bFlask\s*\(/,
        /\bBlueprint\s*\(/,
        /\bfrom\s+flask\s+import\b/i,
        /\bimport\s+flask\b/i,
        /\bregister_blueprint\s*\(/,
      ],
    });
  },
  loadHandlers: loadPythonWebRouteHandlers,
  resolveRootName(args) {
    return buildPythonBridgeRootName(args);
  },
});

const DJANGO_ROUTE_BRIDGE = createRouteFrameworkBridge({
  id: "python-django-route",
  framework: "Django",
  detect(context) {
    return detectPythonFramework(context, {
      techStackKeywords: ["django"],
      entryPatterns: [
        /\bDJANGO_SETTINGS_MODULE\b/,
        /\bexecute_from_command_line\s*\(/,
        /\bget_asgi_application\s*\(/,
        /\bget_wsgi_application\s*\(/,
      ],
    });
  },
  loadHandlers: loadDjangoRouteHandlers,
  resolveRootName(args) {
    return buildPythonBridgeRootName(args);
  },
});

const FUNCTION_CALL_BRIDGES: FunctionCallBridge[] = [
  SPRING_BOOT_CONTROLLER_BRIDGE,
  FASTAPI_ROUTE_BRIDGE,
  FLASK_ROUTE_BRIDGE,
  DJANGO_ROUTE_BRIDGE,
];

const FUNCTION_CALL_BRIDGE_CONTINUATION_STRATEGIES: FunctionCallBridgeContinuationStrategy[] =
  [
    {
      id: "python-flask-url-for",
      detect(context) {
        return (
          context.node.bridgeMetadata?.framework?.toLowerCase() === "flask" &&
          context.node.bridgeMetadata?.nodeType ===
            FUNCTION_CALL_BRIDGE_NODE_TYPES.routeHandler
        );
      },
      build(context) {
        return buildFlaskUrlForContinuationChildren(context);
      },
    },
  ];

export async function resolveFunctionCallBridge(
  context: FunctionCallBridgeContext,
): Promise<ResolvedFunctionCallBridge | null> {
  for (const bridge of FUNCTION_CALL_BRIDGES) {
    if (!bridge.detect(context)) {
      continue;
    }

    const resolved = await bridge.build(context);

    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export async function resolveFrontendWrapperEntryPoint(args: {
  verifiedEntryPoint: string;
  entryContent: string;
  filePaths: string[];
  loadFileContent: (path: string) => Promise<string>;
}): Promise<ResolvedFrontendWrapperEntryPoint | null> {
  if (!isJavaScriptModulePath(args.verifiedEntryPoint)) {
    return null;
  }

  const filePathLookup = createFilePathLookup(args.filePaths);
  const chain = [args.verifiedEntryPoint];
  const visited = new Set<string>([
    normalizeRepoPath(args.verifiedEntryPoint).toLowerCase(),
  ]);
  let currentPath = args.verifiedEntryPoint;
  let currentContent = args.entryContent;

  for (let depth = 0; depth < MAX_FRONTEND_ENTRY_CHAIN_DEPTH; depth += 1) {
    const nextTarget = resolveFrontendWrapperTarget({
      filePath: currentPath,
      content: currentContent,
      filePathLookup,
    });

    if (!nextTarget) {
      break;
    }

    const normalizedNextPath = normalizeRepoPath(nextTarget.filePath).toLowerCase();
    if (visited.has(normalizedNextPath)) {
      break;
    }

    let nextContent: string;

    try {
      nextContent = await args.loadFileContent(nextTarget.filePath);
    } catch {
      break;
    }

    chain.push(nextTarget.filePath);
    visited.add(normalizedNextPath);
    currentPath = nextTarget.filePath;
    currentContent = nextContent;
  }

  if (chain.length < 2) {
    return null;
  }

  return {
    effectivePath: chain[chain.length - 1]!,
    chain,
  };
}

export function collectFunctionCallBridgeRouteHandlers(
  root: FunctionCallNode | null,
): FunctionCallNode[] {
  if (!root) {
    return [];
  }

  const handlers: FunctionCallNode[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (
      current.bridgeMetadata?.nodeType === FUNCTION_CALL_BRIDGE_NODE_TYPES.routeHandler
    ) {
      handlers.push(cloneFunctionCallBridgeNode(current));
    }

    queue.push(...current.children);
  }

  return handlers;
}

export function resolveFunctionCallBridgeContinuation(
  context: FunctionCallBridgeContinuationContext,
): FunctionCallNode[] {
  for (const strategy of FUNCTION_CALL_BRIDGE_CONTINUATION_STRATEGIES) {
    if (!strategy.detect(context)) {
      continue;
    }

    const children = deduplicateFunctionCallNodes(strategy.build(context));

    if (children.length > 0) {
      return children;
    }
  }

  return [];
}

function createRouteFrameworkBridge(
  config: RouteFrameworkBridgeConfig,
): FunctionCallBridge {
  return {
    id: config.id,
    framework: config.framework,
    detect: config.detect,
    async build(context) {
      const handlers = deduplicateRouteHandlers(
        await config.loadHandlers(context),
      );

      if (handlers.length === 0) {
        return null;
      }

      const root = buildRouteBridgeRootNode({
        bridgeId: config.id,
        framework: config.framework,
        verifiedEntryPoint: context.verifiedEntryPoint,
        entryContent: context.entryContent,
        handlers,
        resolveRootName: config.resolveRootName,
      });

      return {
        id: config.id,
        framework: config.framework,
        root,
        handlerCount: handlers.length,
        truncated: handlers.length > MAX_BRIDGED_HANDLER_NODES,
      };
    },
  };
}

function resolveFrontendWrapperTarget(args: {
  filePath: string;
  content: string;
  filePathLookup: FilePathLookup;
}): {
  filePath: string;
} | null {
  if (!isThinFrontendWrapperContent(args.content)) {
    return null;
  }

  const importMap = collectJavaScriptLocalImportMap(args);
  if (importMap.size === 0) {
    return null;
  }

  const projectTargetCandidates = Array.from(
    new Map(
      collectImportedJsxUsages(args.content, importMap).map((item) => [
        `${item.symbol}::${item.filePath}`,
        item,
      ]),
    ).values(),
  );

  if (projectTargetCandidates.length !== 1) {
    return null;
  }

  return {
    filePath: projectTargetCandidates[0]!.filePath,
  };
}

function collectJavaScriptLocalImportMap(args: {
  filePath: string;
  content: string;
  filePathLookup: FilePathLookup;
}): Map<string, string> {
  const importMap = new Map<string, string>();

  for (const match of args.content.matchAll(
    /\bimport\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
  )) {
    const source = match[2]?.trim() ?? "";
    const resolvedFilePath = resolveProjectModulePath({
      fromFilePath: args.filePath,
      modulePath: source,
      filePathLookup: args.filePathLookup,
    });

    if (!resolvedFilePath) {
      continue;
    }

    for (const alias of extractJavaScriptImportAliases(match[1] ?? "")) {
      importMap.set(alias, resolvedFilePath);
    }
  }

  for (const match of args.content.matchAll(
    /\b(?:const|let|var)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:dynamic|lazy)\s*\(\s*[\s\S]*?import\s*\(\s*["']([^"']+)["']\s*\)/g,
  )) {
    const alias = match[1]?.trim() ?? "";
    const source = match[2]?.trim() ?? "";
    const resolvedFilePath = resolveProjectModulePath({
      fromFilePath: args.filePath,
      modulePath: source,
      filePathLookup: args.filePathLookup,
    });

    if (!alias || !resolvedFilePath) {
      continue;
    }

    importMap.set(alias, resolvedFilePath);
  }

  return importMap;
}

function extractJavaScriptImportAliases(clause: string): string[] {
  const aliases = new Set<string>();
  const normalizedClause = clause.trim().replace(/^type\s+/, "");

  if (!normalizedClause) {
    return [];
  }

  const namespaceMatch = normalizedClause.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (namespaceMatch?.[1]) {
    aliases.add(namespaceMatch[1]);
  }

  const namedBlockMatch = normalizedClause.match(/\{([\s\S]*?)\}/);
  if (namedBlockMatch?.[1]) {
    for (const item of namedBlockMatch[1].split(",")) {
      const normalizedItem = item.trim().replace(/^type\s+/, "");

      if (!normalizedItem) {
        continue;
      }

      const aliasMatch = normalizedItem.match(
        /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/,
      );

      if (!aliasMatch) {
        continue;
      }

      aliases.add(aliasMatch[2] ?? aliasMatch[1]);
    }
  }

  const defaultImportPart = namedBlockMatch
    ? normalizedClause.slice(0, namedBlockMatch.index).replace(/,$/, "").trim()
    : normalizedClause;

  if (
    defaultImportPart &&
    !defaultImportPart.startsWith("*") &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(defaultImportPart)
  ) {
    aliases.add(defaultImportPart);
  }

  return Array.from(aliases);
}

function collectImportedJsxUsages(
  content: string,
  importMap: Map<string, string>,
): Array<{
  symbol: string;
  filePath: string;
}> {
  const usages: Array<{
    symbol: string;
    filePath: string;
  }> = [];

  for (const match of content.matchAll(/<([A-Z][A-Za-z0-9_$]*)\b/g)) {
    const symbol = match[1] ?? "";
    const filePath = importMap.get(symbol);

    if (!filePath) {
      continue;
    }

    usages.push({
      symbol,
      filePath,
    });
  }

  return usages;
}

function resolveProjectModulePath(args: {
  fromFilePath: string;
  modulePath: string;
  filePathLookup: FilePathLookup;
}): string | null {
  const modulePath = args.modulePath.trim();

  if (!modulePath) {
    return null;
  }

  let basePath: string | null = null;

  if (modulePath.startsWith("@/")) {
    basePath = modulePath.slice(2);
  } else if (modulePath.startsWith("./") || modulePath.startsWith("../")) {
    const normalizedFromPath = normalizeRepoPath(args.fromFilePath);
    const baseDirectory = normalizedFromPath.replace(/\/[^/]+$/, "");
    basePath = resolveRelativeRepoPath(baseDirectory, modulePath);
  } else if (/^(?:src|app)\//.test(modulePath)) {
    basePath = normalizeRepoPath(modulePath);
  }

  if (!basePath) {
    return null;
  }

  for (const candidate of buildJavaScriptModuleCandidates(basePath)) {
    const resolved = args.filePathLookup.get(candidate.toLowerCase());

    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function buildJavaScriptModuleCandidates(basePath: string): string[] {
  const normalizedBasePath = normalizeRepoPath(basePath);
  const basePathHasExtension = /\.[A-Za-z0-9]+$/.test(normalizedBasePath);

  if (basePathHasExtension) {
    return [normalizedBasePath];
  }

  return Array.from(
    new Set([
      normalizedBasePath,
      ...JAVASCRIPT_MODULE_EXTENSIONS.map((extension) => `${normalizedBasePath}${extension}`),
      ...JAVASCRIPT_MODULE_EXTENSIONS.map(
        (extension) => `${normalizedBasePath}/index${extension}`,
      ),
    ]),
  );
}

function resolveRelativeRepoPath(baseDirectory: string, relativePath: string): string {
  const segments = normalizeRepoPath(baseDirectory).split("/").filter(Boolean);

  for (const segment of normalizeRepoPath(relativePath).split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.join("/");
}

function isJavaScriptModulePath(filePath: string): boolean {
  const loweredPath = normalizeRepoPath(filePath).toLowerCase();
  return JAVASCRIPT_MODULE_EXTENSIONS.some((extension) =>
    loweredPath.endsWith(extension),
  );
}

function isThinFrontendWrapperContent(content: string): boolean {
  const functionDeclarationCount = Array.from(
    content.matchAll(/\bfunction\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(/g),
  ).length;
  const arrowFunctionCount = Array.from(
    content.matchAll(
      /\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g,
    ),
  ).length;
  const hookUsageCount = Array.from(
    content.matchAll(
      /\buse(?:State|Effect|LayoutEffect|Memo|Callback|Ref|Reducer|Transition|DeferredValue|Optimistic|ActionState|ImperativeHandle)\s*\(/g,
    ),
  ).length;

  return functionDeclarationCount + arrowFunctionCount <= 3 && hookUsageCount === 0;
}

function buildFlaskUrlForContinuationChildren(
  context: FunctionCallBridgeContinuationContext,
): FunctionCallNode[] {
  const endpoints = extractFlaskUrlForEndpointTargets(context.locatedSnippet);
  const currentKey = makeFunctionCallNodeKey({
    name: context.node.name,
    filePath: context.locatedFilePath,
  });
  const handlersByExactName = new Map<string, FunctionCallNode[]>();
  const handlersByTailName = new Map<string, FunctionCallNode[]>();

  for (const handler of context.bridgeRouteHandlers) {
    pushFunctionCallNodeMapValue(
      handlersByExactName,
      normalizeEndpointName(handler.name),
      handler,
    );
    pushFunctionCallNodeMapValue(
      handlersByTailName,
      getEndpointTailName(handler.name),
      handler,
    );
  }

  const resolvedChildren: FunctionCallNode[] = [];

  for (const endpoint of endpoints) {
    const normalizedEndpoint = normalizeEndpointName(endpoint);
    const tailName = getEndpointTailName(endpoint);
    const candidates = [
      ...(handlersByExactName.get(normalizedEndpoint) ?? []),
      ...(handlersByTailName.get(tailName) ?? []),
    ];

    for (const candidate of candidates) {
      if (makeFunctionCallNodeKey(candidate) === currentKey) {
        continue;
      }

      resolvedChildren.push(cloneFunctionCallBridgeNode(candidate));
      break;
    }
  }

  return resolvedChildren;
}

function createBridgeMetadata(args: {
  bridgeId: string;
  framework: string;
  nodeType: string;
  routePath?: string | null;
  routeMethods?: string[];
}): FunctionCallBridgeMetadata {
  return {
    bridgeId: args.bridgeId,
    framework: args.framework,
    nodeType: args.nodeType,
    routePath: args.routePath ?? null,
    routeMethods: normalizeRouteMethods(args.routeMethods ?? []),
  };
}

function buildRouteBridgeRootNode(args: {
  bridgeId: string;
  framework: string;
  verifiedEntryPoint: string;
  entryContent: string;
  handlers: RouteBridgeHandler[];
  resolveRootName?: (args: {
    verifiedEntryPoint: string;
    entryContent: string;
  }) => string;
}): FunctionCallNode {
  const rootName =
    args.resolveRootName?.({
      verifiedEntryPoint: args.verifiedEntryPoint,
      entryContent: args.entryContent,
    }) ??
    buildDefaultBridgeRootName({
      verifiedEntryPoint: args.verifiedEntryPoint,
      entryContent: args.entryContent,
    });
  const visibleHandlers = args.handlers.slice(0, MAX_BRIDGED_HANDLER_NODES);

  return {
    name: rootName,
    filePath: args.verifiedEntryPoint,
    summary: `${args.framework} 启动入口，通过框架桥接直接连接路由处理函数。`,
    moduleId: null,
    bridgeMetadata: createBridgeMetadata({
      bridgeId: args.bridgeId,
      framework: args.framework,
      nodeType: FUNCTION_CALL_BRIDGE_NODE_TYPES.frameworkEntry,
    }),
    shouldDive: 1,
    children: visibleHandlers.map((handler) =>
      createRouteHandlerNode({
        bridgeId: args.bridgeId,
        framework: args.framework,
        handler,
      }),
    ),
  };
}

function createRouteHandlerNode(args: {
  bridgeId: string;
  framework: string;
  handler: RouteBridgeHandler;
}): FunctionCallNode {
  return {
    name: args.handler.name,
    filePath: args.handler.filePath,
    summary: buildRouteHandlerSummary(args.framework, args.handler),
    moduleId: null,
    bridgeMetadata: createBridgeMetadata({
      bridgeId: args.bridgeId,
      framework: args.framework,
      nodeType: FUNCTION_CALL_BRIDGE_NODE_TYPES.routeHandler,
      routePath: args.handler.routePath,
      routeMethods: args.handler.routeMethods,
    }),
    shouldDive: 1,
    children: [],
  };
}

function buildRouteHandlerSummary(
  framework: string,
  handler: RouteBridgeHandler,
): string {
  const routeLabel = formatFunctionCallRouteLabel({
    routePath: handler.routePath,
    routeMethods: handler.routeMethods,
  });

  return routeLabel
    ? `${framework} 路由处理函数，处理 ${routeLabel}。`
    : `${framework} 路由处理函数。`;
}

function buildDefaultBridgeRootName(args: {
  verifiedEntryPoint: string;
  entryContent: string;
}): string {
  const loweredPath = normalizeRepoPath(args.verifiedEntryPoint).toLowerCase();

  if (loweredPath.endsWith(".java")) {
    return buildJavaBridgeRootName(args);
  }

  if (loweredPath.endsWith(".py")) {
    return buildPythonBridgeRootName(args);
  }

  return getFileNameWithoutExtension(args.verifiedEntryPoint) || "entry";
}

function buildJavaBridgeRootName(args: {
  verifiedEntryPoint: string;
  entryContent: string;
}): string {
  const className = extractJavaClassName(args.entryContent);
  const hasMainMethod = /\bpublic\s+static\s+void\s+main\s*\(/.test(
    args.entryContent,
  );

  if (className) {
    return hasMainMethod ? `${className}.main` : className;
  }

  return hasMainMethod ? "main" : "SpringApplication.run";
}

function buildPythonBridgeRootName(args: {
  verifiedEntryPoint: string;
  entryContent: string;
}): string {
  const explicitRoot =
    extractPythonFunctionDefinitionName(args.entryContent, [
      "main",
      "create_app",
      "create_application",
    ]) ?? null;

  if (explicitRoot) {
    return explicitRoot;
  }

  const moduleName = getFileNameWithoutExtension(args.verifiedEntryPoint) || "app";
  const appObject = extractPythonAppObjectName(args.entryContent);

  if (appObject) {
    return `${moduleName}.${appObject}`;
  }

  if (/if\s+__name__\s*==\s*["']__main__["']/.test(args.entryContent)) {
    return `${moduleName}.__main__`;
  }

  return moduleName;
}

function detectPythonFramework(
  context: FunctionCallBridgeContext,
  args: {
    techStackKeywords: string[];
    entryPatterns: RegExp[];
  },
): boolean {
  if (!context.verifiedEntryPoint.toLowerCase().endsWith(".py")) {
    return false;
  }

  if (!hasPrimaryLanguage(context.analysisResult, "python")) {
    return false;
  }

  return (
    hasTechKeyword(context.analysisResult, args.techStackKeywords) ||
    args.entryPatterns.some((pattern) => pattern.test(context.entryContent))
  );
}

function hasPrimaryLanguage(
  analysisResult: AIAnalysisResult,
  keyword: string,
): boolean {
  const loweredKeyword = keyword.toLowerCase();
  return analysisResult.primaryLanguages.some((value) =>
    value.toLowerCase().includes(loweredKeyword),
  );
}

function hasTechKeyword(
  analysisResult: AIAnalysisResult,
  keywords: string[],
): boolean {
  return analysisResult.techStack.some((value) => {
    const lowered = value.toLowerCase();
    return keywords.some((keyword) => lowered.includes(keyword.toLowerCase()));
  });
}

function deduplicateRouteHandlers(
  handlers: RouteBridgeHandler[],
): RouteBridgeHandler[] {
  const seen = new Set<string>();
  const deduplicated: RouteBridgeHandler[] = [];

  for (const handler of handlers) {
    const normalizedHandler: RouteBridgeHandler = {
      ...handler,
      routePath: normalizeBridgeRoutePath(handler.routePath),
      routeMethods: normalizeRouteMethods(handler.routeMethods),
    };
    const key = [
      normalizeRepoPath(normalizedHandler.filePath).toLowerCase(),
      normalizedHandler.name,
      normalizedHandler.routePath,
      normalizedHandler.routeMethods.join(","),
    ].join("::");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduplicated.push(normalizedHandler);
  }

  return deduplicated.sort((left, right) => {
    return (
      left.filePath.localeCompare(right.filePath) ||
      left.name.localeCompare(right.name) ||
      left.routePath.localeCompare(right.routePath) ||
      left.routeMethods.join(",").localeCompare(right.routeMethods.join(","))
    );
  });
}

function normalizeBridgeRoutePath(routePath: string): string {
  const trimmed = routePath.trim();
  return trimmed || "/";
}

function normalizeRouteMethods(routeMethods: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const routeMethod of routeMethods) {
    const trimmed = routeMethod.trim().toUpperCase();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}
async function loadSpringBootControllerHandlers(
  context: FunctionCallBridgeContext,
): Promise<RouteBridgeHandler[]> {
  const controllerPaths = getLikelySpringControllerPaths(context.filePaths);
  const handlers: RouteBridgeHandler[] = [];

  for (const filePath of controllerPaths) {
    let content: string;

    try {
      content = await context.loadFileContent(filePath);
    } catch {
      continue;
    }

    handlers.push(
      ...parseSpringControllerFile({
        filePath,
        content,
      }),
    );
  }

  return handlers;
}

function getLikelySpringControllerPaths(filePaths: string[]): string[] {
  const javaPaths = filePaths.filter((path) => path.toLowerCase().endsWith(".java"));
  const controllerLikePaths = javaPaths.filter((path) => {
    const lowered = normalizeRepoPath(path).toLowerCase();
    return (
      lowered.includes("/controller/") ||
      lowered.includes("/controllers/") ||
      lowered.endsWith("controller.java")
    );
  });

  return controllerLikePaths.length > 0 ? controllerLikePaths : javaPaths;
}

function parseSpringControllerFile(args: {
  filePath: string;
  content: string;
}): RouteBridgeHandler[] {
  const lines = splitLines(args.content);
  let className: string | null = null;
  let classBasePaths: string[] = [""];
  let isController = false;
  const handlers: RouteBridgeHandler[] = [];

  for (let index = 0; index < lines.length; ) {
    const trimmed = lines[index]?.trim() ?? "";

    if (!trimmed.startsWith("@")) {
      index += 1;
      continue;
    }

    const annotationBlock = collectAnnotationBlock(lines, index);
    const signature = collectSignature(lines, annotationBlock.nextIndex);
    index = Math.max(signature.nextIndex, annotationBlock.nextIndex);

    if (!signature.text) {
      continue;
    }

    const parsedClassName = extractClassNameFromSignature(signature.text);

    if (parsedClassName) {
      className = parsedClassName;
      isController = hasSpringControllerAnnotation(annotationBlock.annotations);
      classBasePaths = isController
        ? parseSpringMapping(annotationBlock.annotations)?.paths ?? [""]
        : [""];
      continue;
    }

    if (!isController || !className) {
      continue;
    }

    const parsedMethodName = extractJavaMethodName(signature.text);
    const methodMapping = parseSpringMapping(annotationBlock.annotations);

    if (!parsedMethodName || !methodMapping) {
      continue;
    }

    const routePaths = combineRoutePaths(classBasePaths, methodMapping.paths);
    const routePath = routePaths.join(" | ") || "/";

    handlers.push({
      name: `${className}.${parsedMethodName}`,
      filePath: args.filePath,
      routePath,
      routeMethods: methodMapping.methods,
    });
  }

  return isController ? handlers : [];
}

function hasSpringControllerAnnotation(annotations: string[]): boolean {
  return annotations.some((annotation) => {
    const name = getAnnotationName(annotation);
    return name === "RestController" || name === "Controller";
  });
}

function parseSpringMapping(annotations: string[]): SpringRouteMapping | null {
  const paths = new Set<string>();
  const methods = new Set<string>();
  let matched = false;

  for (const annotation of annotations) {
    const name = getAnnotationName(annotation);

    if (!name) {
      continue;
    }

    if (name === "RequestMapping") {
      matched = true;

      for (const path of extractSpringMappingPaths(annotation)) {
        paths.add(path);
      }

      for (const method of extractSpringRequestMethods(annotation)) {
        methods.add(method);
      }

      continue;
    }

    const fixedMethod = getFixedSpringRequestMethod(name);

    if (!fixedMethod) {
      continue;
    }

    matched = true;
    methods.add(fixedMethod);

    for (const path of extractSpringMappingPaths(annotation)) {
      paths.add(path);
    }
  }

  if (!matched) {
    return null;
  }

  return {
    paths: paths.size > 0 ? Array.from(paths) : [""],
    methods: Array.from(methods),
  };
}

function getAnnotationName(annotation: string): string | null {
  const match = annotation.match(/^@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/);

  if (!match) {
    return null;
  }

  const segments = match[1].split(".");
  return segments[segments.length - 1] ?? null;
}

function getFixedSpringRequestMethod(annotationName: string): string | null {
  switch (annotationName) {
    case "GetMapping":
      return "GET";
    case "PostMapping":
      return "POST";
    case "PutMapping":
      return "PUT";
    case "DeleteMapping":
      return "DELETE";
    case "PatchMapping":
      return "PATCH";
    default:
      return null;
  }
}

function extractSpringMappingPaths(annotation: string): string[] {
  const namedMatches = Array.from(
    annotation.matchAll(
      /\b(?:value|path)\s*=\s*(\{[\s\S]*?\}|"(?:\\.|[^"])*")/g,
    ),
  );

  if (namedMatches.length > 0) {
    return Array.from(
      new Set(
        namedMatches
          .flatMap((match) => extractJavaStringLiterals(match[1] ?? ""))
          .map((path) => normalizeRouteSegment(path))
          .filter((path): path is string => path !== null),
      ),
    );
  }

  const argsMatch = annotation.match(/^[^(]+\(([\s\S]*)\)$/);

  if (!argsMatch) {
    return [];
  }

  const unnamedArgs = argsMatch[1].replace(
    /\b(?:method|produces|consumes|headers|params|name)\s*=\s*(\{[\s\S]*?\}|"(?:\\.|[^"])*"|[^,)]+)/g,
    "",
  );

  return Array.from(
    new Set(
      extractJavaStringLiterals(unnamedArgs)
        .map((path) => normalizeRouteSegment(path))
        .filter((path): path is string => path !== null),
    ),
  );
}

function extractSpringRequestMethods(annotation: string): string[] {
  return Array.from(
    new Set(
      Array.from(
        annotation.matchAll(
          /\bRequestMethod\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g,
        ),
      ).map((match) => match[1]),
    ),
  );
}

function extractJavaStringLiterals(value: string): string[] {
  return Array.from(value.matchAll(/"((?:\\.|[^"])*)"/g)).map((match) =>
    match[1].replace(/\\"/g, '"'),
  );
}

async function loadPythonWebRouteHandlers(
  context: FunctionCallBridgeContext,
): Promise<RouteBridgeHandler[]> {
  const filePathLookup = createFilePathLookup(context.filePaths);
  const registrationIndex = buildPythonRouteRegistrationIndex({
    filePath: context.verifiedEntryPoint,
    content: context.entryContent,
    filePathLookup,
  });
  const candidatePaths = getLikelyPythonRoutePaths(
    context.filePaths,
    context.verifiedEntryPoint,
  );
  const handlers: RouteBridgeHandler[] = [];

  for (const filePath of candidatePaths) {
    let content: string;

    try {
      content = await context.loadFileContent(filePath);
    } catch {
      continue;
    }

    handlers.push(
      ...extractPythonDecoratedRouteHandlers({
        filePath,
        content,
        registrationIndex,
      }),
      ...extractPythonRegisteredRouteHandlers({
        filePath,
        content,
        filePathLookup,
        registrationIndex,
      }),
    );
  }

  return handlers;
}

function getLikelyPythonRoutePaths(
  filePaths: string[],
  verifiedEntryPoint: string,
): string[] {
  const pythonPaths = filePaths.filter((path) =>
    path.toLowerCase().endsWith(".py"),
  );
  const preferredPaths = pythonPaths.filter((path) => {
    const lowered = normalizeRepoPath(path).toLowerCase();
    return (
      lowered.includes("/route") ||
      lowered.includes("/router") ||
      lowered.includes("/api") ||
      lowered.includes("/view") ||
      lowered.includes("/endpoint") ||
      lowered.includes("/controller") ||
      lowered.endsWith("/app.py") ||
      lowered.endsWith("/main.py") ||
      lowered.endsWith("/views.py") ||
      lowered.endsWith("/routes.py") ||
      lowered.endsWith("/routers.py") ||
      lowered.endsWith("/api.py")
    );
  });

  const selected = preferredPaths.length > 0 ? preferredPaths : pythonPaths;

  return Array.from(
    new Set([verifiedEntryPoint, ...selected].filter(Boolean)),
  );
}

function extractPythonDecoratedRouteHandlers(args: {
  filePath: string;
  content: string;
  registrationIndex: PythonRouteRegistrationIndex;
}): RouteBridgeHandler[] {
  const lines = splitLines(args.content);
  const routeObjectPrefixes = extractPythonRouteObjectPrefixes(args.content);
  const handlers: RouteBridgeHandler[] = [];

  for (let index = 0; index < lines.length; ) {
    const trimmed = lines[index]?.trim() ?? "";

    if (!trimmed.startsWith("@")) {
      index += 1;
      continue;
    }

    const decoratorBlock = collectPythonDecoratorBlock(lines, index);
    const signature = collectPythonDefinitionSignature(
      lines,
      decoratorBlock.nextIndex,
    );
    index = Math.max(decoratorBlock.nextIndex, signature.nextIndex);

    if (!signature.text) {
      continue;
    }

    const functionName = extractPythonFunctionName(signature.text);

    if (!functionName) {
      continue;
    }

    for (const decorator of decoratorBlock.decorators) {
      const routeInfo = extractPythonDecoratorRouteInfo({
        decorator,
        filePath: args.filePath,
        registrationIndex: args.registrationIndex,
        routeObjectPrefixes,
      });

      if (!routeInfo) {
        continue;
      }

      handlers.push({
        name: functionName,
        filePath: args.filePath,
        routePath: routeInfo.routePath,
        routeMethods: routeInfo.routeMethods,
      });
    }
  }

  return handlers;
}

function extractPythonRegisteredRouteHandlers(args: {
  filePath: string;
  content: string;
  filePathLookup: FilePathLookup;
  registrationIndex: PythonRouteRegistrationIndex;
}): RouteBridgeHandler[] {
  const importMap = parsePythonImports({
    filePath: args.filePath,
    content: args.content,
    filePathLookup: args.filePathLookup,
  });
  const routeObjectPrefixes = extractPythonRouteObjectPrefixes(args.content);
  const handlers: RouteBridgeHandler[] = [];

  for (const call of collectObjectMethodCalls(args.content, [
    "add_api_route",
    "add_url_rule",
  ])) {
    const positionalArgs = getPositionalArguments(call.argsText);
    const pathArgument =
      extractNamedArgumentExpression(
        call.argsText,
        call.methodName === "add_url_rule" ? "rule" : "path",
      ) ?? positionalArgs[0] ?? null;
    const rawRoutePath = pathArgument
      ? extractFirstPythonStringLiteral(pathArgument)
      : null;

    if (rawRoutePath === null) {
      continue;
    }

    const targetArgument =
      extractNamedArgumentExpression(
        call.argsText,
        call.methodName === "add_url_rule" ? "view_func" : "endpoint",
      ) ??
      (call.methodName === "add_url_rule"
        ? positionalArgs[2] ?? null
        : positionalArgs[1] ?? null);

    if (!targetArgument) {
      continue;
    }

    const resolvedTarget = resolvePythonReferenceToProjectObject({
      expression: targetArgument,
      importMap,
      currentFilePath: args.filePath,
      filePathLookup: args.filePathLookup,
    });

    if (!resolvedTarget) {
      continue;
    }

    handlers.push({
      name: resolvedTarget.objectName,
      filePath: resolvedTarget.filePath,
      routePath: buildPythonRoutePath({
        filePath: args.filePath,
        objectRef: call.objectRef,
        rawRoutePath,
        routeObjectPrefixes,
        registrationIndex: args.registrationIndex,
      }),
      routeMethods: extractPythonRouteMethods(
        call.methodName === "add_url_rule" ? "route" : "api_route",
        call.argsText,
      ),
    });
  }

  return handlers;
}
function extractPythonRouteObjectPrefixes(content: string): Map<string, string[]> {
  const prefixes = new Map<string, string[]>();

  for (const assignment of collectConstructorAssignments(content, [
    "APIRouter",
    "Blueprint",
  ])) {
    const prefixArgument =
      assignment.constructorName === "Blueprint"
        ? extractNamedArgumentExpression(assignment.argsText, "url_prefix")
        : extractNamedArgumentExpression(assignment.argsText, "prefix");
    const prefix =
      prefixArgument === null
        ? ""
        : extractFirstPythonStringLiteral(prefixArgument) ?? "";

    appendMapValue(prefixes, assignment.variableName, prefix);
  }

  return prefixes;
}

function buildPythonRouteRegistrationIndex(args: {
  filePath: string;
  content: string;
  filePathLookup: FilePathLookup;
}): PythonRouteRegistrationIndex {
  const importMap = parsePythonImports({
    filePath: args.filePath,
    content: args.content,
    filePathLookup: args.filePathLookup,
  });
  const registrationIndex: PythonRouteRegistrationIndex = new Map();

  for (const call of collectObjectMethodCalls(args.content, [
    "include_router",
    "register_blueprint",
  ])) {
    const positionalArgs = getPositionalArguments(call.argsText);
    const targetArgument = positionalArgs[0] ?? null;

    if (!targetArgument) {
      continue;
    }

    const resolvedTarget = resolvePythonReferenceToProjectObject({
      expression: targetArgument,
      importMap,
      currentFilePath: args.filePath,
      filePathLookup: args.filePathLookup,
    });

    if (!resolvedTarget) {
      continue;
    }

    const prefixArgument =
      call.methodName === "include_router"
        ? extractNamedArgumentExpression(call.argsText, "prefix")
        : extractNamedArgumentExpression(call.argsText, "url_prefix");
    const prefix =
      prefixArgument === null
        ? ""
        : extractFirstPythonStringLiteral(prefixArgument) ?? "";

    appendMapValue(
      registrationIndex,
      makePythonRegistrationKey(
        resolvedTarget.filePath,
        resolvedTarget.objectName,
      ),
      prefix,
    );
  }

  return registrationIndex;
}

function extractPythonDecoratorRouteInfo(args: {
  decorator: string;
  filePath: string;
  registrationIndex: PythonRouteRegistrationIndex;
  routeObjectPrefixes: Map<string, string[]>;
}): { routePath: string; routeMethods: string[] } | null {
  const match = args.decorator.match(
    /^@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.(route|api_route|get|post|put|delete|patch|head|options)\s*\(([\s\S]*)\)$/i,
  );

  if (!match) {
    return null;
  }

  const objectRef = match[1];
  const methodKind = match[2].toLowerCase();
  const argsText = match[3];
  const pathArgument =
    extractNamedArgumentExpression(argsText, "path") ??
    extractNamedArgumentExpression(argsText, "rule") ??
    getPositionalArguments(argsText)[0] ??
    null;
  const rawRoutePath = pathArgument
    ? extractFirstPythonStringLiteral(pathArgument)
    : "";

  if (rawRoutePath === null) {
    return null;
  }

  return {
    routePath: buildPythonRoutePath({
      filePath: args.filePath,
      objectRef,
      rawRoutePath,
      routeObjectPrefixes: args.routeObjectPrefixes,
      registrationIndex: args.registrationIndex,
    }),
    routeMethods: extractPythonRouteMethods(methodKind, argsText),
  };
}

function buildPythonRoutePath(args: {
  filePath: string;
  objectRef: string;
  rawRoutePath: string;
  routeObjectPrefixes: Map<string, string[]>;
  registrationIndex: PythonRouteRegistrationIndex;
}): string {
  const objectName = getLastReferenceSegment(args.objectRef);
  const localPrefixes = args.routeObjectPrefixes.get(objectName) ?? [""];
  const registeredPrefixes =
    args.registrationIndex.get(
      makePythonRegistrationKey(args.filePath, objectName),
    ) ?? [""];
  const basePrefixes = combineRoutePaths(localPrefixes, registeredPrefixes);
  const normalizedRoutePath = normalizeRouteSegment(args.rawRoutePath) ?? "";

  return (
    combineRoutePaths(basePrefixes, [normalizedRoutePath]).join(" | ") || "/"
  );
}

function makePythonRegistrationKey(filePath: string, objectName: string): string {
  return `${normalizeRepoPath(filePath).toLowerCase()}::${objectName.toLowerCase()}`;
}

function parsePythonImports(args: {
  filePath: string;
  content: string;
  filePathLookup: FilePathLookup;
}): Map<string, PythonImportAlias> {
  const importMap = new Map<string, PythonImportAlias>();

  for (const rawLine of splitLines(args.content)) {
    const line = stripTrailingHashComment(rawLine).trim();

    if (!line) {
      continue;
    }

    const importMatch = line.match(/^import\s+(.+)$/);

    if (importMatch) {
      for (const item of splitTopLevelArguments(importMatch[1])) {
        const normalizedItem = item.trim();
        const match = normalizedItem.match(
          /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s+as\s+([A-Za-z_]\w*))?$/,
        );

        if (!match) {
          continue;
        }

        const modulePath = match[1];
        const alias = match[2] ?? getLastReferenceSegment(modulePath);

        importMap.set(alias, {
          kind: "module",
          modulePath,
        });
      }

      continue;
    }

    const fromMatch = line.match(/^from\s+([.\w]+)\s+import\s+(.+)$/);

    if (!fromMatch) {
      continue;
    }

    const baseModule = resolvePythonImportModule(args.filePath, fromMatch[1]);
    const importedItems = splitTopLevelArguments(
      fromMatch[2].replace(/^\(([\s\S]*)\)$/, "$1"),
    );

    for (const importedItem of importedItems) {
      const normalizedItem = importedItem.trim();
      const match = normalizedItem.match(
        /^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/,
      );

      if (!match) {
        continue;
      }

      const importedName = match[1];
      const alias = match[2] ?? importedName;
      const candidateModulePath = joinPythonModule(baseModule, importedName);

      if (resolvePythonModuleFilePath(candidateModulePath, args.filePathLookup)) {
        importMap.set(alias, {
          kind: "module",
          modulePath: candidateModulePath,
        });
        continue;
      }

      importMap.set(alias, {
        kind: "member",
        modulePath: baseModule,
        memberName: importedName,
      });
    }
  }

  return importMap;
}

function resolvePythonImportModule(
  currentFilePath: string,
  moduleReference: string,
): string {
  if (!moduleReference.startsWith(".")) {
    return moduleReference;
  }

  const relativeDots = moduleReference.match(/^\.+/)?.[0].length ?? 0;
  const suffix = moduleReference.slice(relativeDots);
  const currentPackage = getPythonPackageName(currentFilePath);
  const currentSegments = currentPackage ? currentPackage.split(".") : [];
  const keptSegments = currentSegments.slice(
    0,
    Math.max(0, currentSegments.length - (relativeDots - 1)),
  );

  if (suffix) {
    keptSegments.push(...suffix.split(".").filter(Boolean));
  }

  return keptSegments.join(".");
}

function resolvePythonReferenceToProjectObject(args: {
  expression: string;
  importMap: Map<string, PythonImportAlias>;
  currentFilePath: string;
  filePathLookup: FilePathLookup;
}): { filePath: string; objectName: string } | null {
  const normalizedExpression = normalizePythonReferenceExpression(args.expression);

  if (!normalizedExpression) {
    return null;
  }

  const parts = normalizedExpression.split(".");
  const rootName = parts[0];
  const remainingParts = parts.slice(1);
  const importAlias = args.importMap.get(rootName);

  if (!importAlias) {
    return parts.length === 1
      ? {
          filePath: args.currentFilePath,
          objectName: rootName,
        }
      : null;
  }

  if (importAlias.kind === "member") {
    if (remainingParts.length > 0) {
      return null;
    }

    const filePath = resolvePythonModuleFilePath(
      importAlias.modulePath,
      args.filePathLookup,
    );

    return filePath
      ? {
          filePath,
          objectName: importAlias.memberName,
        }
      : null;
  }

  return resolvePythonModuleObject({
    modulePath: importAlias.modulePath,
    remainingParts,
    filePathLookup: args.filePathLookup,
  });
}

function resolvePythonModuleObject(args: {
  modulePath: string;
  remainingParts: string[];
  filePathLookup: FilePathLookup;
}): { filePath: string; objectName: string } | null {
  if (args.remainingParts.length === 0) {
    return null;
  }

  for (let index = args.remainingParts.length - 1; index >= 1; index -= 1) {
    const candidateModulePath = joinPythonModule(
      args.modulePath,
      args.remainingParts.slice(0, index).join("."),
    );
    const candidateFilePath = resolvePythonModuleFilePath(
      candidateModulePath,
      args.filePathLookup,
    );

    if (candidateFilePath) {
      return {
        filePath: candidateFilePath,
        objectName: args.remainingParts[args.remainingParts.length - 1],
      };
    }
  }

  const baseFilePath = resolvePythonModuleFilePath(
    args.modulePath,
    args.filePathLookup,
  );

  return baseFilePath
    ? {
        filePath: baseFilePath,
        objectName: args.remainingParts[args.remainingParts.length - 1],
      }
    : null;
}

function normalizePythonReferenceExpression(expression: string): string | null {
  const trimmed = expression
    .trim()
    .replace(/\.as_view\s*\([\s\S]*\)\s*$/, "")
    .replace(/\s+/g, "");

  if (!trimmed) {
    return null;
  }

  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function resolvePythonModuleFilePath(
  modulePath: string,
  filePathLookup: FilePathLookup,
): string | null {
  if (!modulePath) {
    return null;
  }

  const normalizedModulePath = modulePath.replace(/\./g, "/");

  return (
    filePathLookup.get(`${normalizedModulePath}.py`.toLowerCase()) ??
    filePathLookup.get(`${normalizedModulePath}/__init__.py`.toLowerCase()) ??
    null
  );
}

function extractPythonRouteMethods(
  methodKind: string,
  argsText: string,
): string[] {
  switch (methodKind.toLowerCase()) {
    case "get":
      return ["GET"];
    case "post":
      return ["POST"];
    case "put":
      return ["PUT"];
    case "delete":
      return ["DELETE"];
    case "patch":
      return ["PATCH"];
    case "head":
      return ["HEAD"];
    case "options":
      return ["OPTIONS"];
    case "route":
    case "api_route": {
      const methodsArgument = extractNamedArgumentExpression(argsText, "methods");
      const methods = methodsArgument
        ? extractPythonStringLiterals(methodsArgument)
        : [];

      return methods.length > 0 ? methods : ["GET"];
    }
    default:
      return [];
  }
}

async function loadDjangoRouteHandlers(
  context: FunctionCallBridgeContext,
): Promise<RouteBridgeHandler[]> {
  const filePathLookup = createFilePathLookup(context.filePaths);
  const rootUrlPaths = await resolveDjangoRootUrlPaths({
    context,
    filePathLookup,
  });
  const visited = new Set<string>();
  const handlers: RouteBridgeHandler[] = [];

  for (const rootUrlPath of rootUrlPaths) {
    handlers.push(
      ...(await collectDjangoRouteHandlers({
        urlFilePath: rootUrlPath,
        routePrefix: "",
        context,
        filePathLookup,
        visited,
      })),
    );
  }

  return handlers;
}
async function resolveDjangoRootUrlPaths(args: {
  context: FunctionCallBridgeContext;
  filePathLookup: FilePathLookup;
}): Promise<string[]> {
  const resolvedPaths = new Set<string>();
  const settingsModule = extractDjangoSettingsModule(args.context.entryContent);

  if (settingsModule) {
    const settingsFilePath = resolvePythonModuleFilePath(
      settingsModule,
      args.filePathLookup,
    );
    let rootUrlModule =
      settingsModule.endsWith(".settings")
        ? `${settingsModule.slice(0, -".settings".length)}.urls`
        : `${settingsModule}.urls`;

    if (settingsFilePath) {
      try {
        const settingsContent = await args.context.loadFileContent(settingsFilePath);
        rootUrlModule = extractDjangoRootUrlConf(settingsContent) ?? rootUrlModule;
      } catch {
        // Ignore settings file read failures and keep the default module guess.
      }
    }

    const rootUrlFilePath = resolvePythonModuleFilePath(
      rootUrlModule,
      args.filePathLookup,
    );

    if (rootUrlFilePath) {
      resolvedPaths.add(rootUrlFilePath);
    }
  }

  if (resolvedPaths.size === 0) {
    const fallbackPaths = getLikelyDjangoUrlPaths(args.context.filePaths);

    if (fallbackPaths[0]) {
      resolvedPaths.add(fallbackPaths[0]);
    }
  }

  return Array.from(resolvedPaths);
}

async function collectDjangoRouteHandlers(args: {
  urlFilePath: string;
  routePrefix: string;
  context: FunctionCallBridgeContext;
  filePathLookup: FilePathLookup;
  visited: Set<string>;
}): Promise<RouteBridgeHandler[]> {
  const visitKey = `${normalizeRepoPath(args.urlFilePath).toLowerCase()}::${args.routePrefix}`;

  if (args.visited.has(visitKey)) {
    return [];
  }

  args.visited.add(visitKey);

  let content: string;

  try {
    content = await args.context.loadFileContent(args.urlFilePath);
  } catch {
    return [];
  }

  const importMap = parsePythonImports({
    filePath: args.urlFilePath,
    content,
    filePathLookup: args.filePathLookup,
  });
  const handlers: RouteBridgeHandler[] = [];

  for (const call of collectFunctionCalls(content, ["path", "re_path", "url"])) {
    const callArguments = splitTopLevelArguments(call.argsText);

    if (callArguments.length < 2) {
      continue;
    }

    const routeFragment = parseDjangoRouteFragment(
      callArguments[0],
      call.functionName,
    );
    const targetExpression = callArguments[1]?.trim() ?? "";

    if (!targetExpression) {
      continue;
    }

    const includeModule = extractDjangoIncludeModule(targetExpression);

    if (includeModule) {
      const includeFilePath = resolvePythonModuleFilePath(
        resolvePythonImportModule(args.urlFilePath, includeModule),
        args.filePathLookup,
      );

      if (!includeFilePath) {
        continue;
      }

      handlers.push(
        ...(await collectDjangoRouteHandlers({
          urlFilePath: includeFilePath,
          routePrefix: joinRoutePath(args.routePrefix, routeFragment),
          context: args.context,
          filePathLookup: args.filePathLookup,
          visited: args.visited,
        })),
      );
      continue;
    }

    const resolvedView = resolvePythonReferenceToProjectObject({
      expression: targetExpression,
      importMap,
      currentFilePath: args.urlFilePath,
      filePathLookup: args.filePathLookup,
    });

    if (!resolvedView) {
      continue;
    }

    handlers.push({
      name: resolvedView.objectName,
      filePath: resolvedView.filePath,
      routePath: joinRoutePath(args.routePrefix, routeFragment),
      routeMethods: [],
    });
  }

  return handlers;
}

function extractDjangoSettingsModule(entryContent: string): string | null {
  const match = entryContent.match(
    /DJANGO_SETTINGS_MODULE["']?\s*,\s*["']([^"']+)["']/,
  );

  return match?.[1] ?? null;
}

function extractDjangoRootUrlConf(settingsContent: string): string | null {
  const match = settingsContent.match(/ROOT_URLCONF\s*=\s*["']([^"']+)["']/);
  return match?.[1] ?? null;
}

function extractDjangoIncludeModule(targetExpression: string): string | null {
  const normalizedExpression = targetExpression.trim();

  if (!normalizedExpression.startsWith("include(")) {
    return null;
  }

  const startIndex = normalizedExpression.indexOf("(");
  const balanced = collectBalancedParentheses(normalizedExpression, startIndex);

  if (!balanced) {
    return null;
  }

  const firstArgument = splitTopLevelArguments(balanced.body)[0] ?? "";
  return extractFirstPythonStringLiteral(firstArgument);
}

function parseDjangoRouteFragment(
  expression: string,
  functionName: string,
): string {
  const rawPattern = extractFirstPythonStringLiteral(expression) ?? "";

  if (functionName === "path") {
    return normalizeRouteSegment(rawPattern) ?? "";
  }

  return normalizeDjangoRegexPath(rawPattern);
}

function normalizeDjangoRegexPath(pattern: string): string {
  const normalizedPattern = pattern
    .trim()
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\(\?P<([A-Za-z_]\w*)>[^)]+\)/g, "<$1>")
    .replace(/\((?!\?:)[^)]+\)/g, "*")
    .replace(/\\\//g, "/");

  return normalizeRouteSegment(normalizedPattern) ?? "";
}

function getLikelyDjangoUrlPaths(filePaths: string[]): string[] {
  return filePaths
    .filter((path) => normalizeRepoPath(path).toLowerCase().endsWith("/urls.py"))
    .sort((left, right) => {
      return (
        normalizeRepoPath(left).split("/").length -
          normalizeRepoPath(right).split("/").length ||
        left.length - right.length ||
        left.localeCompare(right)
      );
    });
}

function collectPythonDecoratorBlock(
  lines: string[],
  startIndex: number,
): { decorators: string[]; nextIndex: number } {
  const decorators: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const trimmed = lines[index]?.trim() ?? "";

    if (!trimmed.startsWith("@")) {
      break;
    }

    const parts = [trimmed];
    let balance = getParenthesisBalance(trimmed);
    index += 1;

    while (index < lines.length && balance > 0) {
      const current = lines[index]?.trim() ?? "";
      parts.push(current);
      balance += getParenthesisBalance(current);
      index += 1;
    }

    decorators.push(parts.join(" "));

    while (index < lines.length && !(lines[index]?.trim() ?? "")) {
      index += 1;
    }
  }

  return {
    decorators,
    nextIndex: index,
  };
}

function collectPythonDefinitionSignature(
  lines: string[],
  startIndex: number,
): { text: string; nextIndex: number } {
  let index = startIndex;

  while (index < lines.length && !(lines[index]?.trim() ?? "")) {
    index += 1;
  }

  if (index >= lines.length) {
    return {
      text: "",
      nextIndex: lines.length,
    };
  }

  const parts: string[] = [];

  while (index < lines.length) {
    const trimmed = lines[index]?.trim() ?? "";

    if (!trimmed || trimmed.startsWith("@")) {
      break;
    }

    parts.push(trimmed);
    index += 1;

    if (trimmed.endsWith(":")) {
      break;
    }
  }

  return {
    text: parts.join(" "),
    nextIndex: index,
  };
}

function extractPythonFunctionName(signature: string): string | null {
  const match = signature.match(/^(?:async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/);
  return match?.[1] ?? null;
}

function extractPythonFunctionDefinitionName(
  content: string,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    const pattern = new RegExp(`\\bdef\\s+${escapeRegExp(candidate)}\\s*\\(`);

    if (pattern.test(content)) {
      return candidate;
    }
  }

  return null;
}

function extractPythonAppObjectName(content: string): string | null {
  const match = content.match(
    /\b([A-Za-z_]\w*)\s*=\s*(?:Flask|FastAPI)\s*\(/,
  );
  return match?.[1] ?? null;
}
function collectObjectMethodCalls(
  content: string,
  methodNames: string[],
): CollectedObjectMethodCall[] {
  const escapedNames = methodNames.map((value) => escapeRegExp(value)).join("|");
  const pattern = new RegExp(
    `([A-Za-z_][\\w\\.]*)\\s*\\.\\s*(${escapedNames})\\s*\\(`,
    "g",
  );
  const calls: CollectedObjectMethodCall[] = [];

  for (const match of content.matchAll(pattern)) {
    const openParenIndex = match.index! + match[0].length - 1;
    const balanced = collectBalancedParentheses(content, openParenIndex);

    if (!balanced) {
      continue;
    }

    calls.push({
      objectRef: match[1],
      methodName: match[2],
      argsText: balanced.body,
    });
  }

  return calls;
}

function collectFunctionCalls(
  content: string,
  functionNames: string[],
): CollectedFunctionCall[] {
  const escapedNames = functionNames.map((value) => escapeRegExp(value)).join("|");
  const pattern = new RegExp(`\\b(${escapedNames})\\s*\\(`, "g");
  const calls: CollectedFunctionCall[] = [];

  for (const match of content.matchAll(pattern)) {
    const openParenIndex = match.index! + match[0].length - 1;
    const balanced = collectBalancedParentheses(content, openParenIndex);

    if (!balanced) {
      continue;
    }

    calls.push({
      functionName: match[1],
      argsText: balanced.body,
    });
  }

  return calls;
}

function collectConstructorAssignments(
  content: string,
  constructorNames: string[],
): CollectedConstructorAssignment[] {
  const escapedNames = constructorNames
    .map((value) => escapeRegExp(value))
    .join("|");
  const pattern = new RegExp(
    `\\b([A-Za-z_][\\w]*)\\s*=\\s*(${escapedNames})\\s*\\(`,
    "g",
  );
  const assignments: CollectedConstructorAssignment[] = [];

  for (const match of content.matchAll(pattern)) {
    const openParenIndex = match.index! + match[0].length - 1;
    const balanced = collectBalancedParentheses(content, openParenIndex);

    if (!balanced) {
      continue;
    }

    assignments.push({
      variableName: match[1],
      constructorName: match[2],
      argsText: balanced.body,
    });
  }

  return assignments;
}

function collectBalancedParentheses(
  value: string,
  openParenIndex: number,
): { body: string; endIndex: number } | null {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let index = openParenIndex; index < value.length; index += 1) {
    const char = value[index];

    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;

      if (depth === 0) {
        return {
          body: value.slice(openParenIndex + 1, index),
          endIndex: index,
        };
      }
    }
  }

  return null;
}

function splitTopLevelArguments(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of value) {
    if (quote) {
      current += char;

      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    switch (char) {
      case "(":
        parenthesisDepth += 1;
        current += char;
        break;
      case ")":
        parenthesisDepth -= 1;
        current += char;
        break;
      case "[":
        bracketDepth += 1;
        current += char;
        break;
      case "]":
        bracketDepth -= 1;
        current += char;
        break;
      case "{":
        braceDepth += 1;
        current += char;
        break;
      case "}":
        braceDepth -= 1;
        current += char;
        break;
      case ",":
        if (
          parenthesisDepth === 0 &&
          bracketDepth === 0 &&
          braceDepth === 0
        ) {
          const trimmed = current.trim();

          if (trimmed) {
            parts.push(trimmed);
          }

          current = "";
        } else {
          current += char;
        }
        break;
      default:
        current += char;
        break;
    }
  }

  const trimmed = current.trim();

  if (trimmed) {
    parts.push(trimmed);
  }

  return parts;
}

function getPositionalArguments(value: string): string[] {
  return splitTopLevelArguments(value).filter(
    (argument) => !/^[A-Za-z_]\w*\s*=/.test(argument),
  );
}

function extractNamedArgumentExpression(
  value: string,
  argumentName: string,
): string | null {
  for (const argument of splitTopLevelArguments(value)) {
    const match = argument.match(
      new RegExp(`^${escapeRegExp(argumentName)}\\s*=\\s*([\\s\\S]+)$`),
    );

    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function extractPythonStringLiterals(value: string): string[] {
  const strings: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const quote = value[index];

    if (quote !== "'" && quote !== '"') {
      continue;
    }

    let collected = "";
    let escaping = false;

    for (let innerIndex = index + 1; innerIndex < value.length; innerIndex += 1) {
      const current = value[innerIndex];

      if (escaping) {
        collected += current;
        escaping = false;
        continue;
      }

      if (current === "\\") {
        escaping = true;
        continue;
      }

      if (current === quote) {
        strings.push(decodeQuotedValue(collected));
        index = innerIndex;
        break;
      }

      collected += current;
    }
  }

  return strings;
}

function extractFirstPythonStringLiteral(value: string): string | null {
  return extractPythonStringLiterals(value)[0] ?? null;
}

function decodeQuotedValue(value: string): string {
  return value.replace(/\\(["'\\])/g, "$1");
}

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function collectAnnotationBlock(
  lines: string[],
  startIndex: number,
): { annotations: string[]; nextIndex: number } {
  const annotations: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const trimmed = lines[index]?.trim() ?? "";

    if (!trimmed.startsWith("@")) {
      break;
    }

    const parts = [trimmed];
    let balance = getParenthesisBalance(trimmed);
    index += 1;

    while (index < lines.length && balance > 0) {
      const current = lines[index]?.trim() ?? "";
      parts.push(current);
      balance += getParenthesisBalance(current);
      index += 1;
    }

    annotations.push(parts.join(" "));

    while (index < lines.length && !(lines[index]?.trim() ?? "")) {
      index += 1;
    }
  }

  return {
    annotations,
    nextIndex: index,
  };
}

function collectSignature(
  lines: string[],
  startIndex: number,
): { text: string; nextIndex: number } {
  let index = startIndex;

  while (index < lines.length && !(lines[index]?.trim() ?? "")) {
    index += 1;
  }

  if (index >= lines.length) {
    return {
      text: "",
      nextIndex: lines.length,
    };
  }

  const parts: string[] = [];

  while (index < lines.length) {
    const trimmed = lines[index]?.trim() ?? "";

    if (!trimmed || trimmed.startsWith("@")) {
      break;
    }

    parts.push(trimmed);
    index += 1;

    if (trimmed.includes("{") || trimmed.endsWith(";")) {
      break;
    }
  }

  return {
    text: parts.join(" "),
    nextIndex: index,
  };
}

function getParenthesisBalance(value: string): number {
  let balance = 0;

  for (const char of value) {
    if (char === "(") {
      balance += 1;
    } else if (char === ")") {
      balance -= 1;
    }
  }

  return balance;
}
function extractJavaClassName(content: string): string | null {
  const match = content.match(/\bclass\s+([A-Za-z_]\w*)\b/);
  return match?.[1] ?? null;
}

function extractClassNameFromSignature(signature: string): string | null {
  const match = signature.match(/\bclass\s+([A-Za-z_]\w*)\b/);
  return match?.[1] ?? null;
}

function extractJavaMethodName(signature: string): string | null {
  if (!signature.includes("(") || /\bclass\b/.test(signature)) {
    return null;
  }

  const beforeParams = signature.slice(0, signature.indexOf("(")).trim();

  if (!beforeParams) {
    return null;
  }

  const tokens = beforeParams.split(/\s+/).filter(Boolean);
  const methodName = tokens[tokens.length - 1] ?? "";

  if (!/^[A-Za-z_]\w*$/.test(methodName)) {
    return null;
  }

  if (
    methodName === "if" ||
    methodName === "for" ||
    methodName === "while" ||
    methodName === "switch" ||
    methodName === "catch"
  ) {
    return null;
  }

  const className = extractClassNameFromSignature(signature);

  if (className && className === methodName) {
    return null;
  }

  return methodName;
}

function normalizeRouteSegment(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

function combineRoutePaths(basePaths: string[], methodPaths: string[]): string[] {
  const normalizedBasePaths = basePaths.length > 0 ? basePaths : [""];
  const normalizedMethodPaths = methodPaths.length > 0 ? methodPaths : [""];
  const combined = new Set<string>();

  for (const basePath of normalizedBasePaths) {
    for (const methodPath of normalizedMethodPaths) {
      combined.add(joinRoutePath(basePath, methodPath));
    }
  }

  return Array.from(combined);
}

function joinRoutePath(basePath: string, methodPath: string): string {
  if (/^https?:\/\//i.test(basePath) || /^https?:\/\//i.test(methodPath)) {
    return methodPath || basePath;
  }

  const base = basePath.trim().replace(/^\/+|\/+$/g, "");
  const method = methodPath.trim().replace(/^\/+|\/+$/g, "");

  if (!base && !method) {
    return "/";
  }

  if (!base) {
    return `/${method}`;
  }

  if (!method) {
    return `/${base}`;
  }

  return `/${base}/${method}`.replace(/\/+/g, "/");
}

function extractFlaskUrlForEndpointTargets(content: string): string[] {
  const endpoints = new Set<string>();

  for (const call of collectFunctionCalls(content, ["url_for"])) {
    const endpointArgument =
      extractNamedArgumentExpression(call.argsText, "endpoint") ??
      getPositionalArguments(call.argsText)[0] ??
      null;
    const endpointName = endpointArgument
      ? extractFirstPythonStringLiteral(endpointArgument)
      : null;

    if (!endpointName) {
      continue;
    }

    endpoints.add(endpointName.trim());
  }

  return Array.from(endpoints);
}

function deduplicateFunctionCallNodes(nodes: FunctionCallNode[]): FunctionCallNode[] {
  const deduplicated = new Map<string, FunctionCallNode>();

  for (const node of nodes) {
    const key = makeFunctionCallNodeKey(node);

    if (!deduplicated.has(key)) {
      deduplicated.set(key, cloneFunctionCallBridgeNode(node));
      continue;
    }

    const existing = deduplicated.get(key)!;
    deduplicated.set(key, {
      ...existing,
      filePath: existing.filePath ?? node.filePath,
      summary: existing.summary || node.summary,
      bridgeMetadata: existing.bridgeMetadata ?? node.bridgeMetadata,
      shouldDive:
        existing.shouldDive === 1 || node.shouldDive === 1
          ? 1
          : existing.shouldDive === 0 || node.shouldDive === 0
            ? 0
            : -1,
      children:
        existing.children.length > 0
          ? existing.children
          : node.children.map((child) => cloneFunctionCallBridgeNode(child)),
    });
  }

  return Array.from(deduplicated.values());
}

function cloneFunctionCallBridgeNode(node: FunctionCallNode): FunctionCallNode {
  return cloneFunctionCallBridgeNodeWithSeen(
    node,
    new WeakMap<object, FunctionCallNode>(),
  );
}

function cloneFunctionCallBridgeNodeWithSeen(
  node: FunctionCallNode,
  seen: WeakMap<object, FunctionCallNode>,
): FunctionCallNode {
  const cached = seen.get(node);

  if (cached) {
    return {
      ...cached,
      children: [],
    };
  }

  const clone: FunctionCallNode = {
    ...node,
    children: [],
  };
  seen.set(node, clone);
  clone.children = node.children.map((child) =>
    cloneFunctionCallBridgeNodeWithSeen(child, seen),
  );
  return clone;
}

function makeFunctionCallNodeKey(
  node: Pick<FunctionCallNode, "name" | "filePath">,
): string {
  return `${(node.filePath ?? "__unknown__").toLowerCase()}::${node.name.toLowerCase()}`;
}

function normalizeEndpointName(value: string): string {
  return value.trim().toLowerCase();
}

function getEndpointTailName(value: string): string {
  const normalized = normalizeEndpointName(value);
  const segments = normalized.split(".");
  return segments[segments.length - 1] ?? normalized;
}

function pushFunctionCallNodeMapValue(
  map: Map<string, FunctionCallNode[]>,
  key: string,
  value: FunctionCallNode,
): void {
  const normalizedKey = key.trim().toLowerCase();

  if (!normalizedKey) {
    return;
  }

  const existing = map.get(normalizedKey) ?? [];

  if (existing.some((item) => makeFunctionCallNodeKey(item) === makeFunctionCallNodeKey(value))) {
    return;
  }

  existing.push(value);
  map.set(normalizedKey, existing);
}

function createFilePathLookup(filePaths: string[]): FilePathLookup {
  const lookup: FilePathLookup = new Map();

  for (const filePath of filePaths) {
    lookup.set(normalizeRepoPath(filePath).toLowerCase(), filePath);
  }

  return lookup;
}

function getPythonPackageName(filePath: string): string {
  const normalizedPath = normalizeRepoPath(filePath);
  const withoutFileName = normalizedPath.replace(/\/[^/]+$/, "");
  return withoutFileName.replace(/\//g, ".");
}

function joinPythonModule(baseModule: string, suffix: string): string {
  return [baseModule, suffix].filter(Boolean).join(".");
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function getFileNameWithoutExtension(filePath: string): string {
  const normalizedPath = normalizeRepoPath(filePath);
  const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
  return fileName.replace(/\.[^.]+$/, "");
}

function getLastReferenceSegment(value: string): string {
  const segments = value.split(".");
  return segments[segments.length - 1] ?? value;
}

function appendMapValue(
  map: Map<string, string[]>,
  key: string,
  value: string,
): void {
  const normalizedValue = value.trim();
  const existing = map.get(key) ?? [];

  if (existing.includes(normalizedValue)) {
    return;
  }

  existing.push(normalizedValue);
  map.set(key, existing);
}

function stripTrailingHashComment(value: string): string {
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "#") {
      return value.slice(0, index);
    }
  }

  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
