"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Minus, Move, Plus, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FunctionCallNode, FunctionCallOverview } from "@/types/aiAnalysis";

const CARD_WIDTH = 260;
const CARD_HEIGHT = 128;
const NODE_INDENT = 72;
const CHILDREN_GAP = 32;
const ROOT_CHILDREN_GAP = 64;
const SCENE_PADDING = 40;
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.8;

const TEXT = {
  title: "函数全景图",
  subtitle: "展示入口函数及关键子函数",
  loading: "正在生成函数调用全景图...",
  empty: "完成入口识别后，这里会展示入口函数及其关键子函数。",
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
  x: number;
  y: number;
};

type LayoutResult = {
  nodes: LayoutNode[];
  width: number;
  height: number;
  connectorX: number;
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

function createLayout(root: FunctionCallNode): LayoutResult {
  const x = SCENE_PADDING + NODE_INDENT;
  const nodes: LayoutNode[] = [
    {
      id: "root",
      node: root,
      x,
      y: SCENE_PADDING,
    },
  ];
  let nextY = SCENE_PADDING + CARD_HEIGHT;

  if (root.children.length > 0) {
    nextY += ROOT_CHILDREN_GAP;
  }

  root.children.forEach((child, index) => {
    nodes.push({
      id: `root-${index}`,
      node: child,
      x,
      y: nextY,
    });
    nextY += CARD_HEIGHT + CHILDREN_GAP;
  });

  return {
    nodes,
    width: x + CARD_WIDTH + SCENE_PADDING,
    height: (nodes[nodes.length - 1]?.y ?? SCENE_PADDING) + CARD_HEIGHT + SCENE_PADDING,
    connectorX: SCENE_PADDING + 26,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function FunctionNodeCard({
  node,
  isSelected,
  onSelectFile,
}: {
  node: FunctionCallNode;
  isSelected: boolean;
  onSelectFile?: (path: string) => void;
}) {
  const badge = getDiveBadge(node);
  const canOpenFile = Boolean(node.filePath);

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
        "flex h-[128px] w-[260px] flex-col overflow-hidden rounded-[26px] border-2 border-slate-900 bg-white text-left shadow-[0_18px_38px_rgba(15,23,42,0.12)] transition-transform dark:border-slate-100 dark:bg-[#191c22]",
        canOpenFile && "cursor-pointer hover:-translate-y-0.5",
        !canOpenFile && "cursor-default",
        isSelected &&
          "ring-4 ring-blue-200/70 dark:border-blue-300 dark:ring-blue-500/30",
      )}
    >
      <div className="border-b-2 border-slate-900 px-4 py-2 text-[11px] font-medium tracking-wide text-slate-500 dark:border-slate-100 dark:text-slate-400">
        <span className="block truncate" title={node.filePath ?? TEXT.noFile}>
          {node.filePath ?? TEXT.noFile}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <h3
            className="text-base font-semibold text-slate-900 dark:text-slate-50"
            title={node.name}
          >
            {node.name}
          </h3>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        </div>

        <p
          className="text-xs leading-5 text-slate-600 dark:text-slate-300"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
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
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

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
    ? `${overview.root.name}-${overview.root.filePath ?? "unknown"}-${
        overview.root.children.length
      }-${sceneWidth}-${sceneHeight}`
    : "empty";

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    let frameId = 0;
    const syncView = () => {
      const rect = container.getBoundingClientRect();

      if (!hasOverview || sceneWidth === 0 || sceneHeight === 0) {
        setTransform({ x: 0, y: 0, scale: 1 });
        return;
      }

      const fitScale = clamp(
        Math.min((rect.width - 32) / sceneWidth, (rect.height - 32) / sceneHeight),
        MIN_SCALE,
        1,
      );

      setTransform({
        scale: fitScale,
        x: (rect.width - sceneWidth * fitScale) / 2,
        y: (rect.height - sceneHeight * fitScale) / 2,
      });
    };

    frameId = window.requestAnimationFrame(syncView);
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncView);
    });

    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [hasOverview, overviewSignature, sceneHeight, sceneWidth]);

  const adjustScale = (nextScale: number) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();

    setTransform((current) => {
      const safeScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const scaleRatio = safeScale / current.scale;

      return {
        scale: safeScale,
        x: centerX - (centerX - current.x) * scaleRatio,
        y: centerY - (centerY - current.y) * scaleRatio,
      };
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
      originX: transform.x,
      originY: transform.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    setTransform((current) => ({
      ...current,
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
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

    setTransform((current) => {
      const nextScale = clamp(
        current.scale * (event.deltaY < 0 ? 1.1 : 0.9),
        MIN_SCALE,
        MAX_SCALE,
      );
      const scaleRatio = nextScale / current.scale;

      return {
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * scaleRatio,
        y: pointerY - (pointerY - current.y) * scaleRatio,
      };
    });
  };

  const resetView = () => {
    if (!layout || !containerRef.current) {
      setTransform({ x: 0, y: 0, scale: 1 });
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const fitScale = clamp(
      Math.min((rect.width - 32) / layout.width, (rect.height - 32) / layout.height),
      MIN_SCALE,
      1,
    );

    setTransform({
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
              onClick={() => adjustScale(transform.scale - 0.1)}
              className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#1b1f27] dark:text-gray-300 dark:hover:bg-[#222733]"
              aria-label={TEXT.zoomOut}
              title={TEXT.zoomOut}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => adjustScale(transform.scale + 0.1)}
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
          "relative flex-1 overflow-hidden",
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
            className="absolute left-0 top-0"
            style={{
              width: `${layout.width}px`,
              height: `${layout.height}px`,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              className="absolute inset-0"
            >
              {layout.nodes.length > 1 && (
                <line
                  x1={layout.connectorX}
                  y1={layout.nodes[0].y + CARD_HEIGHT / 2}
                  x2={layout.connectorX}
                  y2={layout.nodes[layout.nodes.length - 1].y + CARD_HEIGHT / 2}
                  stroke="rgba(71,85,105,0.58)"
                  strokeWidth="2"
                  strokeDasharray="8 8"
                  strokeLinecap="round"
                />
              )}

              {layout.nodes.map((node) => {
                const anchorY = node.y + CARD_HEIGHT / 2;

                return (
                  <path
                    key={`connector-${node.id}`}
                    d={`M ${layout.connectorX} ${anchorY} L ${node.x - 18} ${anchorY}`}
                    fill="none"
                    stroke="rgba(71,85,105,0.7)"
                    strokeWidth="2"
                    strokeDasharray="8 8"
                    strokeLinecap="round"
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
