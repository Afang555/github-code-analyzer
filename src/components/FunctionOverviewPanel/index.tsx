"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Minus, Move, Plus, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FunctionCallNode, FunctionCallOverview } from "@/types/aiAnalysis";

const CARD_WIDTH = 272;
const CARD_HEIGHT = 136;
const COLUMN_GAP = 128;
const VERTICAL_GAP = 28;
const SCENE_PADDING = 40;
const ELBOW_OFFSET = 42;
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.8;

const TEXT = {
  title: "函数全景图",
  subtitle: "展示入口函数及递归下钻后的关键调用链",
  loading: "正在生成函数调用全景图...",
  empty: "完成入口识别后，这里会展示入口函数及其递归调用链。",
  zoomIn: "放大",
  zoomOut: "缩小",
  reset: "重置视图",
  dragHint: "拖拽平移，滚轮缩放",
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
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

type SubtreeLayout = {
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
): SubtreeLayout {
  const x = SCENE_PADDING + depth * (CARD_WIDTH + COLUMN_GAP);

  if (node.children.length === 0) {
    return {
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

  const childLayouts = node.children.map((child, index) =>
    layoutSubtree(child, depth + 1, `${id}-${index}`),
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
      id: `${id}->${shiftedChildLayout.nodes[0]?.id ?? currentChildY}`,
      fromX: x + CARD_WIDTH,
      fromY: rootY,
      toX: shiftedChildLayout.rootX,
      toY: shiftedChildLayout.rootY,
    });
    currentChildY += childLayout.height + VERTICAL_GAP;
    maxX = Math.max(maxX, shiftedChildLayout.maxX);
  }

  return {
    nodes,
    edges,
    height,
    rootX: x,
    rootY,
    maxX,
  };
}

function createLayout(root: FunctionCallNode): LayoutResult {
  const subtree = layoutSubtree(root, 0, "root");

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
    height: subtree.height + SCENE_PADDING * 2,
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

function FunctionNodeCard({
  node,
  depth,
  isSelected,
  onSelectFile,
}: {
  node: FunctionCallNode;
  depth: number;
  isSelected: boolean;
  onSelectFile?: (path: string) => void;
}) {
  const badge = getDiveBadge(node);
  const canOpenFile = Boolean(node.filePath);
  const isRoot = depth === 0;

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
        "flex h-[136px] w-[272px] flex-col overflow-hidden rounded-[24px] border-2 border-slate-900 bg-white text-left shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition-transform dark:border-slate-100 dark:bg-[#191c22]",
        canOpenFile && "cursor-pointer hover:-translate-y-0.5",
        !canOpenFile && "cursor-default",
        isRoot &&
          "border-blue-700 shadow-[0_14px_26px_rgba(29,78,216,0.18)] dark:border-blue-300",
        isSelected &&
          "ring-4 ring-blue-200/70 dark:border-blue-300 dark:ring-blue-500/30",
      )}
    >
      <div
        className={cn(
          "border-b-2 border-slate-900 px-4 py-2 text-[11px] font-medium tracking-wide text-slate-500 dark:border-slate-100 dark:text-slate-400",
          isRoot && "border-blue-700 bg-blue-50/60 text-blue-700 dark:border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
        )}
      >
        <span className="block truncate" title={node.filePath ?? TEXT.noFile}>
          {node.filePath ?? TEXT.noFile}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 px-4 py-3">
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

        <p
          className="text-sm leading-6 text-slate-700 dark:text-slate-200"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
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
}

export function FunctionOverviewPanel({
  overview,
  selectedFilePath,
  onSelectFile,
  isLoading = false,
  emptyMessage,
}: {
  overview: FunctionCallOverview | null;
  selectedFilePath?: string;
  onSelectFile?: (path: string) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
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

  const [transform, setTransform] = useState<ViewTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });

  const layout = overview?.root ? createLayout(overview.root) : null;
  const hasOverview = Boolean(overview?.root);
  const sceneWidth = layout?.width ?? 0;
  const sceneHeight = layout?.height ?? 0;
  const overviewSignature = overview?.root
    ? `${createOverviewSignature(overview.root)}-${overview.analyzedDepth}`
    : "empty";

  const applySceneTransform = (nextTransform: ViewTransform) => {
    transformRef.current = nextTransform;

    if (sceneRef.current) {
      sceneRef.current.style.transform = `translate(${nextTransform.x}px, ${nextTransform.y}px) scale(${nextTransform.scale})`;
    }
  };

  const commitSceneTransform = (nextTransform?: ViewTransform) => {
    if (nextTransform) {
      applySceneTransform(nextTransform);
    }

    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }

    setTransform(transformRef.current);
  };

  const scheduleSceneTransformCommit = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
    }

    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      setTransform(transformRef.current);
    }, 80);
  };

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

      if (sceneRef.current) {
        sceneRef.current.style.transform = `translate(${nextTransform.x}px, ${nextTransform.y}px) scale(${nextTransform.scale})`;
      }

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
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      observer.disconnect();
    };
  }, [hasOverview, overviewSignature, sceneHeight, sceneWidth]);

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

    applySceneTransform({
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
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!layout) {
      return;
    }

    event.preventDefault();

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

    applySceneTransform({
      scale: nextScale,
      x: pointerX - (pointerX - current.x) * scaleRatio,
      y: pointerY - (pointerY - current.y) * scaleRatio,
    });
    scheduleSceneTransformCommit();
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

  return (
    <aside className="flex min-w-0 flex-1 flex-col bg-[#f8f5ef] dark:bg-[#12151c]">
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
          "relative flex-1 touch-none overflow-hidden",
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
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: "0 0",
              willChange: "transform",
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              className="absolute inset-0"
            >
              {layout.edges.map((edge) => {
                const elbowX = edge.fromX + ELBOW_OFFSET;

                return (
                  <path
                    key={edge.id}
                    d={`M ${edge.fromX} ${edge.fromY} H ${elbowX} V ${edge.toY} H ${edge.toX}`}
                    fill="none"
                    stroke="rgba(51,65,85,0.8)"
                    strokeWidth="2.2"
                    strokeDasharray="7 7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}
            </svg>

            {layout.nodes.map((layoutNode) => (
              <div
                key={layoutNode.id}
                className="absolute"
                style={{
                  left: `${layoutNode.x}px`,
                  top: `${layoutNode.y}px`,
                }}
              >
                <FunctionNodeCard
                  node={layoutNode.node}
                  depth={layoutNode.depth}
                  isSelected={
                    Boolean(layoutNode.node.filePath) &&
                    layoutNode.node.filePath === selectedFilePath
                  }
                  onSelectFile={onSelectFile}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
