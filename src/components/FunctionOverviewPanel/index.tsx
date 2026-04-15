"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Move,
  Plus,
  RotateCcw,
} from "lucide-react";

import {
  buildFunctionModuleColorMap,
  getFunctionModuleColor,
  type FunctionModuleColor,
} from "@/lib/functionModules";
import { getFunctionCallNodeRouteLabel } from "@/lib/functionCallBridgeUtils";
import { cn } from "@/lib/utils";
import type {
  FunctionCallNode,
  FunctionCallOverview,
  FunctionModule,
} from "@/types/aiAnalysis";

const CARD_WIDTH = 272;
const CARD_HEIGHT = 156;
const COLUMN_GAP = 128;
const VERTICAL_GAP = 28;
const SCENE_PADDING = 40;
const ELBOW_OFFSET = 42;
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.8;
const NODE_CONTROL_OVERFLOW = 34;

const TEXT = {
  title: "函数全景图",
  subtitle: "展示入口函数及递归下钻后的关键调用链",
  loading: "正在生成函数调用全景图...",
  empty: "完成入口识别后，这里会展示入口函数及其递归调用链。",
  zoomIn: "放大",
  zoomOut: "缩小",
  reset: "重置视图",
  dragHint: "拖拽平移，滚轮缩放",
  fullscreen: "全屏",
  exitFullscreen: "退出全屏",
  expandAll: "全部展开",
  collapseAll: "全部收起",
  expandNode: "展开子节点",
  collapseNode: "收起子节点",
  continueDive: "继续下钻",
  drillingDive: "下钻中",
  noFile: "文件待确认",
  needDive: "建议下钻",
  maybeDive: "待确认",
  stopDive: "停止",
} as const;

type ViewTransform = {
  x: number;
  y: number;
  scale: number;
};

type LayoutNode = {
  id: string;
  node: FunctionCallNode;
  depth: number;
  x: number;
  y: number;
};

type LayoutEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

type SubtreeLayout = {
  rootId: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  height: number;
  rootX: number;
  rootY: number;
  maxX: number;
};

type LayoutResult = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
};

function getDiveBadge(node: FunctionCallNode) {
  if (node.shouldDive === 1) {
    return {
      label: TEXT.needDive,
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-300",
    };
  }

  if (node.shouldDive === 0) {
    return {
      label: TEXT.maybeDive,
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }

  return {
    label: TEXT.stopDive,
    className:
      "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
}

function shiftSubtree(
  layout: SubtreeLayout,
  offsetY: number,
): SubtreeLayout {
  return {
    ...layout,
    nodes: layout.nodes.map((node) => ({
      ...node,
      y: node.y + offsetY,
    })),
    edges: layout.edges.map((edge) => ({
      ...edge,
      fromY: edge.fromY + offsetY,
      toY: edge.toY + offsetY,
    })),
    rootY: layout.rootY + offsetY,
  };
}

function layoutSubtree(
  node: FunctionCallNode,
  depth: number,
  id: string,
  expandedNodeIds: Set<string>,
): SubtreeLayout {
  const x = SCENE_PADDING + depth * (CARD_WIDTH + COLUMN_GAP);
  const visibleChildren =
    node.children.length > 0 && expandedNodeIds.has(id) ? node.children : [];

  if (visibleChildren.length === 0) {
    return {
      rootId: id,
      nodes: [
        {
          id,
          node,
          depth,
          x,
          y: 0,
        },
      ],
      edges: [],
      height: CARD_HEIGHT,
      rootX: x,
      rootY: CARD_HEIGHT / 2,
      maxX: x + CARD_WIDTH,
    };
  }

  const childLayouts = visibleChildren.map((child, index) =>
    layoutSubtree(child, depth + 1, `${id}-${index}`, expandedNodeIds),
  );
  const childrenHeight =
    childLayouts.reduce((total, childLayout) => total + childLayout.height, 0) +
    VERTICAL_GAP * Math.max(childLayouts.length - 1, 0);
  const height = Math.max(CARD_HEIGHT, childrenHeight);
  const childBlockOffset = (height - childrenHeight) / 2;
  const rootY = height / 2;
  const rootTop = rootY - CARD_HEIGHT / 2;

  const nodes: LayoutNode[] = [
    {
      id,
      node,
      depth,
      x,
      y: rootTop,
    },
  ];
  const edges: LayoutEdge[] = [];
  let currentChildY = childBlockOffset;
  let maxX = x + CARD_WIDTH;

  for (const childLayout of childLayouts) {
    const shiftedChildLayout = shiftSubtree(childLayout, currentChildY);
    nodes.push(...shiftedChildLayout.nodes);
    edges.push(...shiftedChildLayout.edges);
    edges.push({
      id: `${id}->${shiftedChildLayout.rootId}`,
      fromNodeId: id,
      toNodeId: shiftedChildLayout.rootId,
      fromX: x + CARD_WIDTH,
      fromY: rootY,
      toX: shiftedChildLayout.rootX,
      toY: shiftedChildLayout.rootY,
    });
    currentChildY += childLayout.height + VERTICAL_GAP;
    maxX = Math.max(maxX, shiftedChildLayout.maxX);
  }

  return {
    rootId: id,
    nodes,
    edges,
    height,
    rootX: x,
    rootY,
    maxX,
  };
}

function createLayout(
  root: FunctionCallNode,
  expandedNodeIds: Set<string>,
): LayoutResult {
  const subtree = layoutSubtree(root, 0, "root", expandedNodeIds);

  return {
    nodes: subtree.nodes.map((node) => ({
      ...node,
      y: node.y + SCENE_PADDING,
    })),
    edges: subtree.edges.map((edge) => ({
      ...edge,
      fromY: edge.fromY + SCENE_PADDING,
      toY: edge.toY + SCENE_PADDING,
    })),
    width: subtree.maxX + SCENE_PADDING,
    height: subtree.height + SCENE_PADDING * 2 + NODE_CONTROL_OVERFLOW,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function countNodes(node: FunctionCallNode): number {
  return node.children.reduce((count, child) => count + countNodes(child), 1);
}

function createOverviewSignature(root: FunctionCallNode): string {
  return `${root.name}-${root.filePath ?? "unknown"}-${countNodes(root)}`;
}

function collectExpandableNodeIds(
  root: FunctionCallNode,
): Set<string> {
  const result = new Set<string>();

  const visit = (node: FunctionCallNode, nodeId: string) => {
    if (node.children.length > 0) {
      result.add(nodeId);
    }

    for (const [childIndex, child] of node.children.entries()) {
      visit(child, `${nodeId}-${childIndex}`);
    }
  };

  visit(root, "root");
  return result;
}

function parseLayoutNodePath(id: string): number[] | null {
  if (id === "root") {
    return [];
  }

  if (!id.startsWith("root-")) {
    return null;
  }

  const segments = id.split("-").slice(1);
  const path: number[] = [];

  for (const segment of segments) {
    const index = Number.parseInt(segment, 10);

    if (!Number.isInteger(index) || index < 0) {
      return null;
    }

    path.push(index);
  }

  return path;
}

type FunctionNodeCardProps = {
  node: FunctionCallNode;
  depth: number;
  isSelected: boolean;
  isDimmed: boolean;
  isModuleMatch: boolean;
  isInteracting: boolean;
  moduleColor: FunctionModuleColor;
  onSelectFile?: (path: string) => void;
};

const FunctionNodeCard = memo(function FunctionNodeCard({
  node,
  depth,
  isSelected,
  isDimmed,
  isModuleMatch,
  isInteracting,
  moduleColor,
  onSelectFile,
}: FunctionNodeCardProps) {
  const badge = getDiveBadge(node);
  const canOpenFile = Boolean(node.filePath);
  const isRoot = depth === 0;
  const routeLabel = getFunctionCallNodeRouteLabel(node);

  return (
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        if (node.filePath && onSelectFile) {
          onSelectFile(node.filePath);
        }
      }}
      disabled={!canOpenFile}
      className={cn(
        "function-node-card flex h-[156px] w-[272px] flex-col overflow-hidden rounded-[24px] border-2 border-slate-900 bg-white text-left transition-[transform,opacity,filter,box-shadow] dark:border-slate-100 dark:bg-[#191c22]",
        isInteracting
          ? "shadow-none transition-none"
          : "shadow-[0_10px_24px_rgba(15,23,42,0.12)]",
        canOpenFile && !isInteracting && "cursor-pointer hover:-translate-y-0.5",
        canOpenFile && isInteracting && "cursor-pointer",
        !canOpenFile && "cursor-default",
        isRoot &&
          (isInteracting
            ? "border-blue-700 dark:border-blue-300"
            : "border-blue-700 shadow-[0_14px_26px_rgba(29,78,216,0.18)] dark:border-blue-300"),
        isModuleMatch && "ring-4 ring-amber-200/70 dark:ring-amber-500/40",
        isSelected &&
          "ring-4 ring-blue-200/70 dark:border-blue-300 dark:ring-blue-500/30",
        isDimmed && (isInteracting ? "opacity-45" : "opacity-30 saturate-0"),
      )}
    >
      <div
        className="border-b-2 px-4 py-2 text-[15px] font-medium tracking-wide"
        style={{
          borderColor: moduleColor.border,
          backgroundColor: moduleColor.soft,
          color: "#000000",
        }}
      >
        <span className="block truncate" title={node.filePath ?? TEXT.noFile}>
          {node.filePath ?? TEXT.noFile}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <div className="relative min-h-[22px] pr-[74px]">
          <h3
            className={cn(
              "truncate text-lg font-semibold text-slate-900 dark:text-slate-50",
              isRoot && "text-xl text-blue-900 dark:text-blue-50",
            )}
            title={node.name}
          >
            {node.name}
          </h3>
          <span
            className={cn(
              "absolute top-0 right-0 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        </div>

        {routeLabel && (
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:border-sky-800/60 dark:bg-sky-900/30 dark:text-sky-300">
              URL
            </span>
            <p
              className="truncate font-mono text-[11px] text-sky-700 dark:text-sky-300"
              title={routeLabel}
            >
              {routeLabel}
            </p>
          </div>
        )}

        <p
          className="text-sm leading-6 text-slate-700 dark:text-slate-200"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: routeLabel ? 2 : 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={node.summary}
        >
          {node.summary}
        </p>
      </div>
    </button>
  );
});

export function FunctionOverviewPanel({
  overview,
  modules = [],
  activeModuleId = null,
  selectedFilePath,
  onSelectFile,
  onDrillDownNode,
  drillingNodeId = null,
  isLoading = false,
  emptyMessage,
}: {
  overview: FunctionCallOverview | null;
  modules?: FunctionModule[];
  activeModuleId?: string | null;
  selectedFilePath?: string;
  onSelectFile?: (path: string) => void;
  onDrillDownNode?: (nodePath: number[], nodeId: string) => void;
  drillingNodeId?: string | null;
  isLoading?: boolean;
  emptyMessage?: string;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const pendingTransformRef = useRef<ViewTransform | null>(null);
  const transformFrameRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const transformRef = useRef<ViewTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const commitTimerRef = useRef<number | null>(null);
  const interactionTimerRef = useRef<number | null>(null);

  const [transform, setTransform] = useState<ViewTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [expandedNodeState, setExpandedNodeState] = useState<{
    signature: string;
    ids: Set<string>;
  }>(() => ({
    signature: "empty",
    ids: new Set<string>(),
  }));
  const overviewRoot = overview?.root ?? null;
  const overviewDepth = overview?.analyzedDepth ?? 0;

  const overviewSignature = useMemo(
    () =>
      overviewRoot
        ? `${createOverviewSignature(overviewRoot)}-${overviewDepth}`
        : "empty",
    [overviewDepth, overviewRoot],
  );
  const expandableNodeIds = useMemo(
    () =>
      overviewRoot ? collectExpandableNodeIds(overviewRoot) : new Set<string>(),
    [overviewRoot],
  );
  const expandedNodeIds = useMemo(() => {
    if (!overviewRoot) {
      return new Set<string>();
    }

    if (expandedNodeState.signature !== overviewSignature) {
      return new Set(expandableNodeIds);
    }

    return expandedNodeState.ids;
  }, [expandableNodeIds, expandedNodeState, overviewRoot, overviewSignature]);
  const layout = useMemo(
    () => (overviewRoot ? createLayout(overviewRoot, expandedNodeIds) : null),
    [expandedNodeIds, overviewRoot],
  );
  const moduleColorMap = useMemo(
    () => buildFunctionModuleColorMap(modules),
    [modules],
  );
  const layoutNodeMap = useMemo(
    () => new Map(layout?.nodes.map((item) => [item.id, item] as const) ?? []),
    [layout],
  );
  const hasOverview = Boolean(overviewRoot);
  const hasExpandableNodes = expandableNodeIds.size > 0;
  const allNodesExpanded = useMemo(() => {
    if (!hasExpandableNodes) {
      return false;
    }

    for (const nodeId of expandableNodeIds) {
      if (!expandedNodeIds.has(nodeId)) {
        return false;
      }
    }

    return true;
  }, [expandableNodeIds, expandedNodeIds, hasExpandableNodes]);
  const sceneWidth = layout?.width ?? 0;
  const sceneHeight = layout?.height ?? 0;

  const writeSceneTransform = useCallback((nextTransform: ViewTransform) => {
    if (sceneRef.current) {
      sceneRef.current.style.transform = `translate3d(${nextTransform.x}px, ${nextTransform.y}px, 0) scale(${nextTransform.scale})`;
    }
  }, []);

  const applySceneTransform = useCallback(
    (nextTransform: ViewTransform) => {
      transformRef.current = nextTransform;
      pendingTransformRef.current = null;

      if (transformFrameRef.current !== null) {
        window.cancelAnimationFrame(transformFrameRef.current);
        transformFrameRef.current = null;
      }

      writeSceneTransform(nextTransform);
    },
    [writeSceneTransform],
  );

  const flushScheduledSceneTransform = useCallback(() => {
    transformFrameRef.current = null;
    const nextTransform = pendingTransformRef.current ?? transformRef.current;
    pendingTransformRef.current = null;
    writeSceneTransform(nextTransform);
  }, [writeSceneTransform]);

  const scheduleSceneTransform = useCallback(
    (nextTransform: ViewTransform) => {
      transformRef.current = nextTransform;
      pendingTransformRef.current = nextTransform;

      if (transformFrameRef.current !== null) {
        return;
      }

      transformFrameRef.current = window.requestAnimationFrame(
        flushScheduledSceneTransform,
      );
    },
    [flushScheduledSceneTransform],
  );

  const clearInteractionTimer = useCallback(() => {
    if (interactionTimerRef.current !== null) {
      window.clearTimeout(interactionTimerRef.current);
      interactionTimerRef.current = null;
    }
  }, []);

  const beginInteraction = useCallback(() => {
    clearInteractionTimer();
    setIsInteracting(true);
  }, [clearInteractionTimer]);

  const scheduleInteractionEnd = useCallback(
    (delay = 120) => {
      clearInteractionTimer();
      interactionTimerRef.current = window.setTimeout(() => {
        interactionTimerRef.current = null;
        setIsInteracting(false);
      }, delay);
    },
    [clearInteractionTimer],
  );

  const commitSceneTransform = useCallback((nextTransform?: ViewTransform) => {
    if (nextTransform) {
      applySceneTransform(nextTransform);
    }

    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }

    setTransform(transformRef.current);
  }, [applySceneTransform]);

  const scheduleSceneTransformCommit = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
    }

    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      setTransform(transformRef.current);
    }, 80);
  }, []);

  const toggleNodeExpandState = useCallback(
    (nodeId: string) => {
      if (!overviewRoot) {
        return;
      }

      setExpandedNodeState((previous) => {
        const nextIds =
          previous.signature === overviewSignature
            ? new Set(previous.ids)
            : new Set(expandableNodeIds);

        if (nextIds.has(nodeId)) {
          nextIds.delete(nodeId);
        } else {
          nextIds.add(nodeId);
        }

        return {
          signature: overviewSignature,
          ids: nextIds,
        };
      });
    },
    [expandableNodeIds, overviewRoot, overviewSignature],
  );

  const expandAllNodes = useCallback(() => {
    if (!overviewRoot) {
      return;
    }

    setExpandedNodeState({
      signature: overviewSignature,
      ids: new Set(expandableNodeIds),
    });
  }, [expandableNodeIds, overviewRoot, overviewSignature]);

  const collapseAllNodes = useCallback(() => {
    if (!overviewRoot) {
      return;
    }

    setExpandedNodeState({
      signature: overviewSignature,
      ids: new Set<string>(),
    });
  }, [overviewRoot, overviewSignature]);

  const renderedEdges = useMemo(() => {
    if (!layout) {
      return null;
    }

    return layout.edges.map((edge) => {
      const elbowX = edge.fromX + ELBOW_OFFSET;
      const fromNode = layoutNodeMap.get(edge.fromNodeId);
      const toNode = layoutNodeMap.get(edge.toNodeId);
      const fromModuleId = fromNode?.node.moduleId ?? null;
      const toModuleId = toNode?.node.moduleId ?? null;
      const isEdgeHighlighted =
        !activeModuleId ||
        (fromModuleId === activeModuleId && toModuleId === activeModuleId);

      return (
        <path
          key={edge.id}
          d={`M ${edge.fromX} ${edge.fromY} H ${elbowX} V ${edge.toY} H ${edge.toX}`}
          fill="none"
          stroke={
            isInteracting
              ? isEdgeHighlighted
                ? "rgba(51,65,85,0.66)"
                : "rgba(148,163,184,0.22)"
              : isEdgeHighlighted
                ? "rgba(51,65,85,0.8)"
                : "rgba(148,163,184,0.28)"
          }
          strokeWidth={isInteracting ? 1.6 : isEdgeHighlighted ? 2.2 : 1.8}
          strokeDasharray={isInteracting ? undefined : isEdgeHighlighted ? "7 7" : "5 8"}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    });
  }, [activeModuleId, isInteracting, layout, layoutNodeMap]);

  const renderedNodes = useMemo(() => {
    if (!layout) {
      return null;
    }

    return layout.nodes.map((layoutNode) => {
      const moduleColor = getFunctionModuleColor(
        layoutNode.node.moduleId,
        moduleColorMap,
      );
      const isDimmed =
        Boolean(activeModuleId) && layoutNode.node.moduleId !== activeModuleId;
      const isModuleMatch =
        Boolean(activeModuleId) && layoutNode.node.moduleId === activeModuleId;
      const hasChildren = layoutNode.node.children.length > 0;
      const isExpanded = expandedNodeIds.has(layoutNode.id);
      const canContinueDive = !hasChildren && Boolean(onDrillDownNode);
      const isDrilling = drillingNodeId === layoutNode.id;
      const nodePath = parseLayoutNodePath(layoutNode.id);

      return (
        <div
          key={layoutNode.id}
          className="absolute"
          style={{
            left: `${layoutNode.x}px`,
            top: `${layoutNode.y}px`,
          }}
        >
          <div className="relative h-[156px] w-[272px]">
            <FunctionNodeCard
              node={layoutNode.node}
              depth={layoutNode.depth}
              isSelected={
                Boolean(layoutNode.node.filePath) &&
                layoutNode.node.filePath === selectedFilePath
              }
              isDimmed={isDimmed}
              isModuleMatch={isModuleMatch}
              isInteracting={isInteracting}
              moduleColor={moduleColor}
              onSelectFile={onSelectFile}
            />

            {hasChildren && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleNodeExpandState(layoutNode.id);
                }}
                className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                style={{
                  left: "50%",
                  top: "100%",
                }}
                aria-label={isExpanded ? TEXT.collapseNode : TEXT.expandNode}
                title={isExpanded ? TEXT.collapseNode : TEXT.expandNode}
              >
                {isExpanded ? (
                  <ChevronDown className="mx-auto h-4 w-4" />
                ) : (
                  <ChevronRight className="mx-auto h-4 w-4" />
                )}
              </button>
            )}

            {canContinueDive && nodePath && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onDrillDownNode?.(nodePath, layoutNode.id);
                }}
                disabled={isDrilling}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-[11px] font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                style={{
                  left: "50%",
                  top: "100%",
                }}
                aria-label={TEXT.continueDive}
                title={TEXT.continueDive}
              >
                <span className="inline-flex items-center gap-1">
                  {isDrilling && <Loader2 className="h-3 w-3 animate-spin" />}
                  {isDrilling ? TEXT.drillingDive : TEXT.continueDive}
                </span>
              </button>
            )}
          </div>
        </div>
      );
    });
  }, [
    activeModuleId,
    drillingNodeId,
    expandedNodeIds,
    isInteracting,
    layout,
    moduleColorMap,
    onDrillDownNode,
    onSelectFile,
    selectedFilePath,
    toggleNodeExpandState,
  ]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    let frameId = 0;
    const syncView = () => {
      const rect = container.getBoundingClientRect();
      const nextTransform =
        !hasOverview || sceneWidth === 0 || sceneHeight === 0
          ? { x: 0, y: 0, scale: 1 }
          : (() => {
              const fitScale = clamp(
                Math.min(
                  (rect.width - 32) / sceneWidth,
                  (rect.height - 32) / sceneHeight,
                ),
                MIN_SCALE,
                1,
              );

              return {
                scale: fitScale,
                x: (rect.width - sceneWidth * fitScale) / 2,
                y: (rect.height - sceneHeight * fitScale) / 2,
              };
            })();

      transformRef.current = nextTransform;

      writeSceneTransform(nextTransform);

      setTransform(nextTransform);
    };

    frameId = window.requestAnimationFrame(syncView);
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncView);
    });

    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(frameId);
      if (transformFrameRef.current !== null) {
        window.cancelAnimationFrame(transformFrameRef.current);
        transformFrameRef.current = null;
      }
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      clearInteractionTimer();
      observer.disconnect();
    };
  }, [
    clearInteractionTimer,
    hasOverview,
    overviewSignature,
    sceneHeight,
    sceneWidth,
    writeSceneTransform,
  ]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const adjustScale = (nextScale: number) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const current = transformRef.current;
    const safeScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const scaleRatio = safeScale / current.scale;

    commitSceneTransform({
      scale: safeScale,
      x: centerX - (centerX - current.x) * scaleRatio,
      y: centerY - (centerY - current.y) * scaleRatio,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!layout) {
      return;
    }

    beginInteraction();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    scheduleSceneTransform({
      ...transformRef.current,
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      commitSceneTransform();
      scheduleInteractionEnd(80);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!layout) {
      return;
    }

    event.preventDefault();
    beginInteraction();

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const current = transformRef.current;
    const nextScale = clamp(
      current.scale * (event.deltaY < 0 ? 1.1 : 0.9),
      MIN_SCALE,
      MAX_SCALE,
    );
    const scaleRatio = nextScale / current.scale;

    scheduleSceneTransform({
      scale: nextScale,
      x: pointerX - (pointerX - current.x) * scaleRatio,
      y: pointerY - (pointerY - current.y) * scaleRatio,
    });
    scheduleSceneTransformCommit();
    scheduleInteractionEnd(140);
  };

  const resetView = () => {
    if (!layout || !containerRef.current) {
      commitSceneTransform({ x: 0, y: 0, scale: 1 });
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const fitScale = clamp(
      Math.min((rect.width - 32) / layout.width, (rect.height - 32) / layout.height),
      MIN_SCALE,
      1,
    );

    commitSceneTransform({
      scale: fitScale,
      x: (rect.width - layout.width * fitScale) / 2,
      y: (rect.height - layout.height * fitScale) / 2,
    });
  };

  const toggleFullscreen = async () => {
    if (!rootRef.current) {
      return;
    }

    try {
      if (document.fullscreenElement === rootRef.current) {
        await document.exitFullscreen();
      } else {
        await rootRef.current.requestFullscreen();
      }
    } catch {
      // Ignore browser-specific fullscreen errors.
    }
  };

  return (
    <aside
      ref={rootRef}
      className="flex min-w-0 flex-1 flex-col bg-[#f8f5ef] dark:bg-[#12151c]"
    >
      <div className="border-b border-gray-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-[#171b22]/90">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {TEXT.title}
              </h2>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {TEXT.subtitle}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expandAllNodes}
              disabled={!hasExpandableNodes || allNodesExpanded}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-[#1b1f27] dark:text-gray-300 dark:hover:bg-[#222733]"
              aria-label={TEXT.expandAll}
              title={TEXT.expandAll}
            >
              {TEXT.expandAll}
            </button>
            <button
              type="button"
              onClick={collapseAllNodes}
              disabled={!hasExpandableNodes || expandedNodeIds.size === 0}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-[#1b1f27] dark:text-gray-300 dark:hover:bg-[#222733]"
              aria-label={TEXT.collapseAll}
              title={TEXT.collapseAll}
            >
              {TEXT.collapseAll}
            </button>
            <button
              type="button"
              onClick={() => adjustScale(transformRef.current.scale - 0.1)}
              className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#1b1f27] dark:text-gray-300 dark:hover:bg-[#222733]"
              aria-label={TEXT.zoomOut}
              title={TEXT.zoomOut}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => adjustScale(transformRef.current.scale + 0.1)}
              className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#1b1f27] dark:text-gray-300 dark:hover:bg-[#222733]"
              aria-label={TEXT.zoomIn}
              title={TEXT.zoomIn}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#1b1f27] dark:text-gray-300 dark:hover:bg-[#222733]"
              aria-label={TEXT.reset}
              title={TEXT.reset}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                void toggleFullscreen();
              }}
              className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#1b1f27] dark:text-gray-300 dark:hover:bg-[#222733]"
              aria-label={isFullscreen ? TEXT.exitFullscreen : TEXT.fullscreen}
              title={isFullscreen ? TEXT.exitFullscreen : TEXT.fullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          <Move className="h-3.5 w-3.5" />
          <span>{TEXT.dragHint}</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className={cn(
          "relative flex-1 touch-none select-none overflow-hidden",
          layout && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.22) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />

        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {TEXT.loading}
          </div>
        ) : !layout ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm leading-6 text-gray-500 dark:text-gray-400">
            {emptyMessage ?? TEXT.empty}
          </div>
        ) : (
          <div
            ref={sceneRef}
            className="absolute left-0 top-0"
            style={{
              width: `${layout.width}px`,
              height: `${layout.height}px`,
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
              transformOrigin: "0 0",
              willChange: "transform",
              contain: "layout paint style",
              backfaceVisibility: "hidden",
              pointerEvents: isInteracting ? "none" : "auto",
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              className="absolute inset-0"
              style={{ pointerEvents: "none" }}
            >
              {renderedEdges}
            </svg>

            {renderedNodes}
          </div>
        )}
      </div>
    </aside>
  );
}
