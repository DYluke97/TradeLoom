"use client";

import {
  Maximize2,
  Minimize2,
  Network,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VaultFileItem, VaultIndex, VaultNodeType } from "@/lib/vault-builder";

const NODE_COLORS: Record<VaultNodeType, string> = {
  overview: "#a882ff",
  timeline: "#e0b354",
  card: "#dcddde",
  topic: "#56c2d6",
  manual: "#4ade80",
};

const NODE_LABELS: Record<VaultNodeType, string> = {
  overview: "总览",
  timeline: "时间轴",
  card: "复盘卡片",
  topic: "主题节点",
  manual: "交易手册",
};

type SimNode = {
  rel: string;
  title: string;
  nodeType: VaultNodeType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  r: number;
  degree: number;
  isCenter: boolean;
};

type SimEdge = {
  from: string;
  to: string;
  direction: "out" | "in" | "peer";
};

function shortLabel(title: string, max = 14): string {
  const clean = title.replace(/\.md$/, "");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildGraphTopology(
  index: VaultIndex | null,
  activeRel: string,
  mode: "local" | "global",
  width: number,
  height: number,
  filterType: VaultNodeType | "all",
): { nodes: SimNode[]; edges: SimEdge[] } {
  if (!index) return { nodes: [], edges: [] };
  const fileMap = new Map<string, VaultFileItem>(index.files.map((f) => [f.rel, f]));
  const cx = width / 2;
  const cy = height / 2;

  if (mode === "local") {
    const linkInfo = index.links[activeRel] ?? { out: [], in: [] };
    const centerFile = fileMap.get(activeRel);
    const nodes: SimNode[] = [
      {
        rel: activeRel,
        title: centerFile?.title ?? activeRel,
        nodeType: centerFile?.nodeType ?? "card",
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        r: 8.5,
        degree: linkInfo.out.length + linkInfo.in.length,
        isCenter: true,
      },
    ];

    const neighborMap = new Map<string, "out" | "in">();
    for (const t of linkInfo.out) if (t !== activeRel) neighborMap.set(t, "out");
    for (const s of linkInfo.in) if (s !== activeRel && !neighborMap.has(s)) neighborMap.set(s, "in");

    const neighbors = [...neighborMap.entries()].slice(0, 28);
    const edges: SimEdge[] = [];
    const baseRadius = Math.min(width, height) * 0.34;

    neighbors.forEach(([rel, dir], idx) => {
      const file = fileMap.get(rel);
      const angle = (idx / Math.max(neighbors.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const ring = neighbors.length > 14 && idx % 2 === 1 ? 0.72 : 1;
      const deg = (index.links[rel]?.out.length ?? 0) + (index.links[rel]?.in.length ?? 0);
      nodes.push({
        rel,
        title: file?.title ?? rel,
        nodeType: file?.nodeType ?? "card",
        x: cx + Math.cos(angle) * baseRadius * ring,
        y: cy + Math.sin(angle) * baseRadius * ring,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        r: Math.min(7, 4.2 + Math.sqrt(deg) * 0.65),
        degree: deg,
        isCenter: false,
      });
      edges.push({ from: activeRel, to: rel, direction: dir });
    });

    const neighborSet = new Set(neighbors.map(([r]) => r));
    for (const [rel] of neighbors) {
      for (const target of index.links[rel]?.out ?? []) {
        if (neighborSet.has(target) && rel < target) {
          edges.push({ from: rel, to: target, direction: "peer" });
        }
      }
    }
    return { nodes, edges };
  }

  // Global mode: up to 110 highest-degree nodes seeded in semantic spiral for fast force convergence
  const candidates = index.files
    .filter((f) => filterType === "all" || f.nodeType === filterType)
    .map((f) => ({
      file: f,
      degree: (index.links[f.rel]?.out.length ?? 0) + (index.links[f.rel]?.in.length ?? 0),
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 110);

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const spread = Math.min(width, height) * 0.38;
  const nodes: SimNode[] = candidates.map((c, idx) => {
    const rFactor = Math.sqrt((idx + 0.5) / Math.max(candidates.length, 1));
    const angle = idx * goldenAngle;
    return {
      rel: c.file.rel,
      title: c.file.title,
      nodeType: c.file.nodeType,
      x: cx + Math.cos(angle) * spread * rFactor,
      y: cy + Math.sin(angle) * spread * rFactor,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      r: Math.min(10.5, 4.2 + Math.sqrt(c.degree) * 0.85),
      degree: c.degree,
      isCenter: c.file.rel === activeRel,
    };
  });

  const shown = new Set(nodes.map((n) => n.rel));
  const edges: SimEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const n of nodes) {
    for (const target of index.links[n.rel]?.out ?? []) {
      if (!shown.has(target)) continue;
      const key = n.rel < target ? `${n.rel}->${target}` : `${target}->${n.rel}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      edges.push({ from: n.rel, to: target, direction: "peer" });
    }
  }

  return { nodes, edges };
}

export default function ObsidianGraph({
  index,
  activeRel,
  mode = "local",
  onSelectNode,
  onToggleExpand,
}: {
  index: VaultIndex | null;
  activeRel: string;
  mode?: "local" | "global";
  onSelectNode: (rel: string) => void;
  onToggleExpand?: () => void;
}) {
  const width = mode === "global" ? 960 : 300;
  const height = mode === "global" ? 620 : 240;

  const [hoveredRel, setHoveredRel] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<VaultNodeType | "all">("all");
  const [showSettings, setShowSettings] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(false);

  // Tunable Obsidian-style physics parameters
  const [repulsion, setRepulsion] = useState(mode === "global" ? 1800 : 760);
  const [linkDist, setLinkDist] = useState(mode === "global" ? 86 : 64);

  // Camera pan + zoom
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });

  // Live simulation state
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const rafRef = useRef<number | null>(null);
  const alphaRef = useRef<number>(1);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [, setRenderTick] = useState(0);

  // Drag / pan gesture refs
  const dragNodeRef = useRef<{
    rel: string;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);
  const panRef = useRef<{
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const physicsRef = useRef({ repulsion, linkDist });
  physicsRef.current = { repulsion, linkDist };

  const startLoop = useCallback(() => {
    if (rafRef.current !== null) return;

    const step = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      if (nodes.length === 0) {
        rafRef.current = null;
        return;
      }

      const cx = width / 2;
      const cy = height / 2;
      const { repulsion: rep, linkDist: targetDist } = physicsRef.current;
      const byRel = new Map<string, SimNode>(nodes.map((n) => [n.rel, n]));

      // 1) Coulomb node-node repulsion
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 1) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            distSq = dx * dx + dy * dy;
          }
          const dist = Math.sqrt(distSq);
          const force = Math.min(rep / distSq, 14);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (a.fx === null) {
            a.vx -= fx;
            a.vy -= fy;
          }
          if (b.fx === null) {
            b.vx += fx;
            b.vy += fy;
          }
        }
      }

      // 2) Hooke spring attraction along edges
      const springK = mode === "global" ? 0.032 : 0.055;
      for (const e of edges) {
        const a = byRel.get(e.from);
        const b = byRel.get(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - targetDist;
        const f = displacement * springK;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        if (a.fx === null) {
          a.vx += fx;
          a.vy += fy;
        }
        if (b.fx === null) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // 3) Center gravity & velocity integration
      const gravity = mode === "global" ? 0.014 : 0.025;
      let totalEnergy = 0;
      for (const n of nodes) {
        if (n.fx !== null && n.fy !== null) {
          n.x = n.fx;
          n.y = n.fy;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx += (cx - n.x) * gravity;
        n.vy += (cy - n.y) * gravity;
        n.vx *= 0.82;
        n.vy *= 0.82;

        // Clamp max step for stability
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (speed > 18) {
          n.vx = (n.vx / speed) * 18;
          n.vy = (n.vy / speed) * 18;
        }
        n.x += n.vx;
        n.y += n.vy;
        totalEnergy += n.vx * n.vx + n.vy * n.vy;
      }

      alphaRef.current = Math.max(0, alphaRef.current * 0.985);
      setRenderTick((t) => (t + 1) % 100000);

      // Keep running while dragging or until simulation cools cleanly
      if (dragNodeRef.current || totalEnergy > 0.08 || alphaRef.current > 0.04) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, [width, height, mode]);

  const reheat = useCallback(
    (energy = 0.85) => {
      alphaRef.current = energy;
      startLoop();
    },
    [startLoop],
  );

  // Rebuild topology whenever vault, active card, mode, or filter changes
  useEffect(() => {
    const topo = buildGraphTopology(index, activeRel, mode, width, height, filterType);
    nodesRef.current = topo.nodes;
    edgesRef.current = topo.edges;
    setTransform({ x: 0, y: 0, k: 1 });
    reheat(1);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [index, activeRel, mode, width, height, filterType, reheat]);

  // Reheat gently when physics sliders change
  useEffect(() => {
    reheat(0.6);
  }, [repulsion, linkDist, reheat]);

  // Convert pointer client coords -> SVG world coords (taking zoom/pan into account)
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: width / 2, y: height / 2 };
      const rect = svg.getBoundingClientRect();
      const svgX = ((clientX - rect.left) / Math.max(rect.width, 1)) * width;
      const svgY = ((clientY - rect.top) / Math.max(rect.height, 1)) * height;
      const { x, y, k } = transformRef.current;
      return { x: (svgX - x) / k, y: (svgY - y) / k };
    },
    [width, height],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * width;
      const svgY = ((e.clientY - rect.top) / Math.max(rect.height, 1)) * height;
      const factor = e.deltaY < 0 ? 1.14 : 0.88;

      setTransform((prev) => {
        const nextK = Math.min(3.2, Math.max(0.35, prev.k * factor));
        const ratio = nextK / prev.k;
        return {
          k: nextK,
          x: svgX - (svgX - prev.x) * ratio,
          y: svgY - (svgY - prev.y) * ratio,
        };
      });
    },
    [width, height],
  );

  const handleBgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("[data-graph-node]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: transformRef.current.x,
      origY: transformRef.current.y,
    };
  };

  const handleNodePointerDown = (e: React.PointerEvent<SVGGElement>, rel: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    const world = clientToWorld(e.clientX, e.clientY);
    const node = nodesRef.current.find((n) => n.rel === rel);
    if (node) {
      node.fx = world.x;
      node.fy = world.y;
    }
    dragNodeRef.current = {
      rel,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
    reheat(0.8);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragNodeRef.current) {
      const drag = dragNodeRef.current;
      const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
      if (dist > 4) drag.moved = true;
      const world = clientToWorld(e.clientX, e.clientY);
      const node = nodesRef.current.find((n) => n.rel === drag.rel);
      if (node) {
        node.fx = world.x;
        node.fy = world.y;
      }
      reheat(0.5);
      return;
    }

    if (panRef.current && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const dx = ((e.clientX - panRef.current.startClientX) / Math.max(rect.width, 1)) * width;
      const dy = ((e.clientY - panRef.current.startClientY) / Math.max(rect.height, 1)) * height;
      setTransform((prev) => ({
        ...prev,
        x: panRef.current!.origX + dx,
        y: panRef.current!.origY + dy,
      }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragNodeRef.current) {
      const { rel, moved } = dragNodeRef.current;
      const node = nodesRef.current.find((n) => n.rel === rel);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      dragNodeRef.current = null;
      if (!moved) {
        onSelectNode(rel);
      }
    }
    panRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const zoomBy = (factor: number) => {
    setTransform((prev) => {
      const nextK = Math.min(3.2, Math.max(0.35, prev.k * factor));
      const ratio = nextK / prev.k;
      return {
        k: nextK,
        x: width / 2 - (width / 2 - prev.x) * ratio,
        y: height / 2 - (height / 2 - prev.y) * ratio,
      };
    });
  };

  const nodes = nodesRef.current;
  const edges = edgesRef.current;
  const nodeMap = new Map(nodes.map((n) => [n.rel, n]));

  const connectedToHover = useMemo(() => {
    if (!hoveredRel) return null;
    const set = new Set<string>([hoveredRel]);
    for (const e of edgesRef.current) {
      if (e.from === hoveredRel) set.add(e.to);
      if (e.to === hoveredRel) set.add(e.from);
    }
    return set;
  }, [hoveredRel]);

  return (
    <div className="flex h-full flex-col">
      {/* Header / Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
          <Network className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>{mode === "global" ? "全局力导向图谱（Graph View）" : "局部力导向图谱（Local Graph）"}</span>
          <span className="font-mono text-[10px] text-[var(--ink-dim)]">
            {nodes.length} 节点 · {edges.length} 连线
          </span>
        </div>

        <div className="flex items-center gap-1">
          {mode === "global" && (
            <div className="mr-1 flex flex-wrap items-center gap-1 text-[11px]">
              {(["all", "card", "topic", "timeline", "manual"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilterType(t)}
                  className={`rounded px-2 py-0.5 transition ${
                    filterType === t
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  }`}
                >
                  {t === "all" ? "全部" : NODE_LABELS[t]}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => zoomBy(1.22)}
            title="放大"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.82)}
            title="缩小"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setTransform({ x: 0, y: 0, k: 1 });
              reheat(0.9);
            }}
            title="重置视角并重新舒展物理布局"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          {mode === "global" && (
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              title="物理力场参数设置"
              className={`rounded p-1 transition ${
                showSettings
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          )}

          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              title={mode === "global" ? "返回阅读视图" : "展开全局力导向图谱"}
              className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
            >
              {mode === "global" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Interactive Physics SVG Canvas */}
      <div className="obsidian-graph-bg relative flex-1 overflow-hidden">
        {nodes.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-[var(--ink-dim)]">
            暂无可绘制的双链关系节点
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            onWheel={handleWheel}
            onPointerDown={handleBgPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="h-full w-full cursor-grab select-none active:cursor-grabbing touch-none"
            role="img"
            aria-label="Obsidian Force-Directed Knowledge Graph"
          >
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
              {/* Edges */}
              <g>
                {edges.map((e, i) => {
                  const a = nodeMap.get(e.from);
                  const b = nodeMap.get(e.to);
                  if (!a || !b) return null;
                  const highlighted = hoveredRel && (e.from === hoveredRel || e.to === hoveredRel);
                  const dimmed = hoveredRel && !highlighted;
                  return (
                    <line
                      key={`${e.from}-${e.to}-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={
                        highlighted
                          ? "#a882ff"
                          : e.direction === "out"
                            ? "rgba(168,130,255,0.45)"
                            : e.direction === "in"
                              ? "rgba(74,222,128,0.42)"
                              : "rgba(154,155,166,0.24)"
                      }
                      strokeWidth={(highlighted ? 1.7 : e.direction === "peer" ? 0.9 : 1.2) / Math.sqrt(transform.k)}
                      opacity={dimmed ? 0.14 : 1}
                    />
                  );
                })}
              </g>

              {/* Draggable Nodes */}
              <g>
                {nodes.map((n) => {
                  const isHovered = hoveredRel === n.rel;
                  const dimmed = connectedToHover && !connectedToHover.has(n.rel);
                  const fill = n.isCenter ? "#a882ff" : NODE_COLORS[n.nodeType];
                  const showLabel =
                    showAllLabels ||
                    n.isCenter ||
                    isHovered ||
                    transform.k >= 1.45 ||
                    (mode === "local" ? nodes.length <= 12 : n.degree >= 5 || n.nodeType !== "card");

                  return (
                    <g
                      key={n.rel}
                      data-graph-node={n.rel}
                      transform={`translate(${n.x}, ${n.y})`}
                      onMouseEnter={() => setHoveredRel(n.rel)}
                      onMouseLeave={() => setHoveredRel(null)}
                      onPointerDown={(e) => handleNodePointerDown(e, n.rel)}
                      className="cursor-pointer"
                      opacity={dimmed ? 0.18 : 1}
                    >
                      {(n.isCenter || isHovered) && (
                        <circle r={n.r + 5.5} fill="rgba(168,130,255,0.24)" />
                      )}
                      <circle
                        r={isHovered ? n.r + 1.5 : n.r}
                        fill={fill}
                        stroke={n.isCenter || isHovered ? "#ffffff" : "#161619"}
                        strokeWidth={n.isCenter || isHovered ? 1.5 : 1}
                      />
                      {showLabel && (
                        <text
                          y={n.r + (mode === "global" ? 13 : 11)}
                          textAnchor="middle"
                          fill={n.isCenter || isHovered ? "#ffffff" : "#a5a7b4"}
                          fontSize={(mode === "global" ? 10.5 : 9) / Math.pow(transform.k, 0.35)}
                          fontWeight={n.isCenter || isHovered ? 600 : 400}
                          className="pointer-events-none"
                        >
                          {shortLabel(n.title, mode === "global" ? 16 : 11)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}

        {/* Obsidian Physics Settings Popover (Global Graph) */}
        {mode === "global" && showSettings && (
          <div className="absolute right-3 top-3 w-56 space-y-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]/95 p-3 text-xs shadow-xl backdrop-blur">
            <div className="flex items-center justify-between font-semibold text-[var(--ink)]">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                力导向物理引擎
              </span>
              <span className="font-mono text-[10px] text-[var(--ink-dim)]">{Math.round(transform.k * 100)}%</span>
            </div>

            <label className="block space-y-1 text-[11px] text-[var(--ink-muted)]">
              <div className="flex justify-between">
                <span>节点斥力</span>
                <span className="font-mono text-[var(--ink)]">{repulsion}</span>
              </div>
              <input
                type="range"
                min={400}
                max={4200}
                step={100}
                value={repulsion}
                onChange={(e) => setRepulsion(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <label className="block space-y-1 text-[11px] text-[var(--ink-muted)]">
              <div className="flex justify-between">
                <span>连线弹簧长度</span>
                <span className="font-mono text-[var(--ink)]">{linkDist}px</span>
              </div>
              <input
                type="range"
                min={40}
                max={180}
                step={6}
                value={linkDist}
                onChange={(e) => setLinkDist(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between text-[11px] text-[var(--ink-muted)]">
              <span>始终显示全部节点标题</span>
              <input
                type="checkbox"
                checked={showAllLabels}
                onChange={(e) => setShowAllLabels(e.target.checked)}
                className="accent-[var(--accent)]"
              />
            </label>
          </div>
        )}

        {/* Legend & Gesture Hint */}
        <div className="pointer-events-none absolute bottom-2 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5 rounded bg-[#141417]/85 px-2 py-1 text-[10px] text-[var(--ink-muted)] backdrop-blur-sm">
            {(["card", "topic", "timeline", "manual"] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NODE_COLORS[t] }} />
                {NODE_LABELS[t]}
              </span>
            ))}
          </div>

          <div className="hidden rounded bg-[#141417]/80 px-2 py-1 text-[10px] text-[var(--ink-dim)] sm:block">
            拖拽节点扯动星图 · 拖拽空白平移 · 滚轮缩放 · 单击跳转
          </div>
        </div>
      </div>
    </div>
  );
}
