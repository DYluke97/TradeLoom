"use client";

import { Maximize2, Minimize2, Network } from "lucide-react";
import { useMemo, useState } from "react";
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

type GraphNode = {
  rel: string;
  title: string;
  nodeType: VaultNodeType;
  x: number;
  y: number;
  r: number;
  degree: number;
  isCenter?: boolean;
};

type GraphEdge = {
  from: string;
  to: string;
  direction?: "out" | "in" | "peer";
};

function shortLabel(title: string, max = 14): string {
  const clean = title.replace(/\.md$/, "");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildLocalLayout(
  index: VaultIndex,
  activeRel: string,
  width: number,
  height: number,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const fileMap = new Map<string, VaultFileItem>(index.files.map((f) => [f.rel, f]));
  const linkInfo = index.links[activeRel] ?? { out: [], in: [] };
  const centerFile = fileMap.get(activeRel);

  const cx = width / 2;
  const cy = height / 2;

  const nodes: GraphNode[] = [
    {
      rel: activeRel,
      title: centerFile?.title ?? activeRel,
      nodeType: centerFile?.nodeType ?? "card",
      x: cx,
      y: cy,
      r: 8.5,
      degree: linkInfo.out.length + linkInfo.in.length,
      isCenter: true,
    },
  ];

  const neighborMap = new Map<string, "out" | "in">();
  for (const t of linkInfo.out) {
    if (t !== activeRel) neighborMap.set(t, "out");
  }
  for (const s of linkInfo.in) {
    if (s !== activeRel && !neighborMap.has(s)) neighborMap.set(s, "in");
  }

  const neighbors = [...neighborMap.entries()].slice(0, 26);
  const edges: GraphEdge[] = [];
  const baseRadius = Math.min(width, height) * 0.36;

  neighbors.forEach(([rel, dir], idx) => {
    const file = fileMap.get(rel);
    const angle = (idx / Math.max(neighbors.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const ringFactor = neighbors.length > 14 && idx % 2 === 1 ? 0.72 : 1;
    const x = cx + Math.cos(angle) * baseRadius * ringFactor;
    const y = cy + Math.sin(angle) * baseRadius * ringFactor;
    const deg = (index.links[rel]?.out.length ?? 0) + (index.links[rel]?.in.length ?? 0);

    nodes.push({
      rel,
      title: file?.title ?? rel,
      nodeType: file?.nodeType ?? "card",
      x,
      y,
      r: Math.min(7, 4 + Math.sqrt(deg) * 0.7),
      degree: deg,
    });
    edges.push({ from: activeRel, to: rel, direction: dir });
  });

  // Add subtle cross-links between neighbors so local clusters look authentic
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

function buildGlobalLayout(
  index: VaultIndex,
  activeRel: string,
  width: number,
  height: number,
  filterType: VaultNodeType | "all",
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const candidates = index.files
    .filter((f) => filterType === "all" || f.nodeType === filterType)
    .map((f) => ({
      file: f,
      degree: (index.links[f.rel]?.out.length ?? 0) + (index.links[f.rel]?.in.length ?? 0),
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 90);

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) * 0.43;

  // Concentric semantic rings: overview at center, manuals/topics inner-mid, timeline mid, cards outer
  const groups: Record<VaultNodeType, typeof candidates> = {
    overview: [],
    manual: [],
    topic: [],
    timeline: [],
    card: [],
  };
  for (const c of candidates) groups[c.file.nodeType].push(c);

  const nodes: GraphNode[] = [];
  const placeRing = (
    items: typeof candidates,
    radiusRatio: number,
    phaseOffset: number,
  ) => {
    items.forEach((item, idx) => {
      const angle = (idx / Math.max(items.length, 1)) * Math.PI * 2 + phaseOffset;
      const jitter = items.length > 16 ? (idx % 2 === 0 ? 1 : 0.84) : 1;
      const r = radiusRatio * maxR * jitter;
      nodes.push({
        rel: item.file.rel,
        title: item.file.title,
        nodeType: item.file.nodeType,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        r: Math.min(10, 4.2 + Math.sqrt(item.degree) * 0.85),
        degree: item.degree,
        isCenter: item.file.rel === activeRel,
      });
    });
  };

  if (groups.overview.length > 0) {
    const ov = groups.overview[0];
    nodes.push({
      rel: ov.file.rel,
      title: ov.file.title,
      nodeType: "overview",
      x: cx,
      y: cy,
      r: 9,
      degree: ov.degree,
      isCenter: ov.file.rel === activeRel,
    });
  }
  placeRing(groups.manual, 0.28, -Math.PI / 4);
  placeRing(groups.topic, 0.52, 0.2);
  placeRing(groups.timeline, 0.76, -0.5);
  placeRing(groups.card, 0.98, 0.1);

  const shown = new Set(nodes.map((n) => n.rel));
  const edges: GraphEdge[] = [];
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
  const [hoveredRel, setHoveredRel] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<VaultNodeType | "all">("all");

  const width = mode === "global" ? 860 : 280;
  const height = mode === "global" ? 560 : 220;

  const { nodes, edges } = useMemo(() => {
    if (!index) return { nodes: [], edges: [] };
    return mode === "global"
      ? buildGlobalLayout(index, activeRel, width, height, filterType)
      : buildLocalLayout(index, activeRel, width, height);
  }, [index, activeRel, mode, width, height, filterType]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.rel, n])), [nodes]);

  const connectedToHover = useMemo(() => {
    if (!hoveredRel) return null;
    const set = new Set<string>([hoveredRel]);
    for (const e of edges) {
      if (e.from === hoveredRel) set.add(e.to);
      if (e.to === hoveredRel) set.add(e.from);
    }
    return set;
  }, [hoveredRel, edges]);

  return (
    <div className="flex h-full flex-col">
      {/* Header / Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
          <Network className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>{mode === "global" ? "全局双链关系图谱（Graph View）" : "局部关系图谱（Local Graph）"}</span>
          <span className="font-mono text-[10px] text-[var(--ink-dim)]">
            {nodes.length} 节点 · {edges.length} 连线
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {mode === "global" && (
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
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

          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              title={mode === "global" ? "返回阅读视图" : "打开全局关系图谱"}
              className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
            >
              {mode === "global" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Interactive SVG Canvas */}
      <div className="obsidian-graph-bg relative flex-1 overflow-hidden">
        {nodes.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-[var(--ink-dim)]">
            暂无可绘制的双链关系节点
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-full w-full select-none"
            role="img"
            aria-label="Obsidian Knowledge Graph"
          >
            {/* Edges */}
            <g>
              {edges.map((e, i) => {
                const a = nodeMap.get(e.from);
                const b = nodeMap.get(e.to);
                if (!a || !b) return null;
                const highlighted =
                  hoveredRel && (e.from === hoveredRel || e.to === hoveredRel);
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
                          ? "rgba(168,130,255,0.42)"
                          : e.direction === "in"
                            ? "rgba(74,222,128,0.38)"
                            : "rgba(154,155,166,0.22)"
                    }
                    strokeWidth={highlighted ? 1.6 : e.direction === "peer" ? 0.85 : 1.15}
                    opacity={dimmed ? 0.14 : 1}
                  />
                );
              })}
            </g>

            {/* Nodes */}
            <g>
              {nodes.map((n) => {
                const isHovered = hoveredRel === n.rel;
                const dimmed = connectedToHover && !connectedToHover.has(n.rel);
                const fill = n.isCenter ? "#a882ff" : NODE_COLORS[n.nodeType];
                const showLabel =
                  mode === "local"
                    ? n.isCenter || isHovered || nodes.length <= 12
                    : n.isCenter || isHovered || n.degree >= 4 || n.nodeType !== "card";

                return (
                  <g
                    key={n.rel}
                    transform={`translate(${n.x}, ${n.y})`}
                    onMouseEnter={() => setHoveredRel(n.rel)}
                    onMouseLeave={() => setHoveredRel(null)}
                    onClick={() => onSelectNode(n.rel)}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.2 : 1}
                  >
                    {(n.isCenter || isHovered) && (
                      <circle r={n.r + 5} fill="rgba(168,130,255,0.22)" />
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
                        fill={n.isCenter || isHovered ? "#ffffff" : "#9a9ba6"}
                        fontSize={mode === "global" ? 10.5 : 9}
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
          </svg>
        )}

        {/* Legend bar */}
        <div className="pointer-events-none absolute bottom-2 left-2.5 flex flex-wrap items-center gap-2.5 rounded bg-[#141417]/85 px-2 py-1 text-[10px] text-[var(--ink-muted)] backdrop-blur-sm">
          {(["card", "topic", "timeline", "manual"] as const).map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NODE_COLORS[t] }} />
              {NODE_LABELS[t]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
