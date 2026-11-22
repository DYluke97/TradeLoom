"use client";

import {
  ArrowUpRight,
  Compass,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Network,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VaultFileItem, VaultIndex, VaultNodeType } from "@/lib/vault-builder";

const NODE_COLORS: Record<VaultNodeType, string> = {
  overview: "var(--accent)",
  manual: "var(--emerald)",
  card: "var(--graph-node-card)",
  topic: "var(--cyan)",
  timeline: "var(--amber)",
};

const NODE_GLOW: Record<VaultNodeType, string> = {
  overview: "var(--accent-soft)",
  manual: "var(--emerald-soft)",
  card: "var(--surface-3)",
  topic: "var(--cyan-soft)",
  timeline: "var(--amber-soft)",
};

const NODE_LABELS: Record<VaultNodeType, string> = {
  overview: "核心总览",
  manual: "交易手册",
  card: "复盘卡片",
  topic: "主题节点",
  timeline: "时间轴",
};

type LayoutMode = "orbital" | "layered";

type SimNode = {
  rel: string;
  title: string;
  nodeType: VaultNodeType;
  homeX: number;
  homeY: number;
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
  structural: boolean;
};

type GuideOverlay =
  | { kind: "rings"; cx: number; cy: number; rings: Array<{ r: number; label: string; color: string }> }
  | { kind: "columns"; columns: Array<{ x: number; label: string; color: string }> };

function shortLabel(title: string, max = 14): string {
  const clean = title.replace(/\.md$/, "");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function placeOnRing(
  items: Array<{ file: VaultFileItem; degree: number; preferredAngle: number }>,
  cx: number,
  cy: number,
  radius: number,
  activeRel: string,
  staggerOuter = false,
): SimNode[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.preferredAngle - b.preferredAngle);
  const step = (Math.PI * 2) / sorted.length;
  const startAngle = -Math.PI / 2;

  return sorted.map((item, idx) => {
    const angle = startAngle + idx * step;
    const rOffset = staggerOuter && sorted.length >= 16 ? (idx % 2 === 0 ? -24 : 26) : 0;
    const finalR = radius + rOffset;
    const x = cx + Math.cos(angle) * finalR;
    const y = cy + Math.sin(angle) * finalR;
    return {
      rel: item.file.rel,
      title: item.file.title,
      nodeType: item.file.nodeType,
      homeX: x,
      homeY: y,
      x,
      y,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      r: Math.min(10.5, 5.2 + Math.sqrt(item.degree) * 0.72),
      degree: item.degree,
      isCenter: item.file.rel === activeRel,
    };
  });
}

function buildGraphTopology(
  index: VaultIndex | null,
  activeRel: string,
  mode: "local" | "global",
  layoutMode: LayoutMode,
  width: number,
  height: number,
  filterType: VaultNodeType | "all",
): { nodes: SimNode[]; edges: SimEdge[]; guide: GuideOverlay | null } {
  if (!index) return { nodes: [], edges: [], guide: null };
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
        homeX: cx,
        homeY: cy,
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        r: 9,
        degree: linkInfo.out.length + linkInfo.in.length,
        isCenter: true,
      },
    ];

    const neighborMap = new Map<string, "out" | "in">();
    for (const t of linkInfo.out) if (t !== activeRel) neighborMap.set(t, "out");
    for (const s of linkInfo.in) if (s !== activeRel && !neighborMap.has(s)) neighborMap.set(s, "in");

    const neighbors = [...neighborMap.entries()].slice(0, 24);
    const edges: SimEdge[] = [];
    const innerR = Math.min(width, height) * 0.34;
    const outerR = Math.min(width, height) * 0.45;

    const typeOrder: Record<VaultNodeType, number> = {
      overview: 0,
      manual: 1,
      card: 2,
      topic: 3,
      timeline: 4,
    };
    neighbors.sort(([a], [b]) => {
      const ta = typeOrder[fileMap.get(a)?.nodeType ?? "card"];
      const tb = typeOrder[fileMap.get(b)?.nodeType ?? "card"];
      return ta - tb || a.localeCompare(b);
    });

    neighbors.forEach(([rel, dir], idx) => {
      const file = fileMap.get(rel);
      const angle = (idx / Math.max(neighbors.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const r = neighbors.length > 10 && idx % 2 === 1 ? outerR : innerR;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const deg = (index.links[rel]?.out.length ?? 0) + (index.links[rel]?.in.length ?? 0);
      nodes.push({
        rel,
        title: file?.title ?? rel,
        nodeType: file?.nodeType ?? "card",
        homeX: x,
        homeY: y,
        x,
        y,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        r: Math.min(7.2, 4.6 + Math.sqrt(deg) * 0.55),
        degree: deg,
        isCenter: false,
      });
      edges.push({ from: activeRel, to: rel, direction: dir, structural: true });
    });

    const neighborSet = new Set(neighbors.map(([r]) => r));
    for (const [rel] of neighbors) {
      for (const target of index.links[rel]?.out ?? []) {
        if (neighborSet.has(target) && rel < target) {
          edges.push({ from: rel, to: target, direction: "peer", structural: false });
        }
      }
    }

    return {
      nodes,
      edges,
      guide: {
        kind: "rings",
        cx,
        cy,
        rings: [{ r: innerR, label: "", color: "var(--border-strong)" }],
      },
    };
  }

  // Global Graph: Structured Orbital or Swimlane Architecture
  const candidates = index.files
    .filter((f) => filterType === "all" || f.nodeType === filterType)
    .map((f) => ({
      file: f,
      degree: (index.links[f.rel]?.out.length ?? 0) + (index.links[f.rel]?.in.length ?? 0),
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 120);

  const buckets: Record<VaultNodeType, typeof candidates> = {
    overview: [],
    manual: [],
    card: [],
    topic: [],
    timeline: [],
  };
  for (const c of candidates) buckets[c.file.nodeType].push(c);

  buckets.card.sort((a, b) => (a.file.eventDate ?? "9999").localeCompare(b.file.eventDate ?? "9999"));
  buckets.timeline.sort((a, b) => (a.file.eventDate ?? "9999").localeCompare(b.file.eventDate ?? "9999"));
  buckets.topic.sort((a, b) => b.degree - a.degree);

  const nodes: SimNode[] = [];
  let guide: GuideOverlay | null = null;

  if (layoutMode === "layered") {
    const colSpecs: Array<{ key: string; label: string; color: string; x: number; items: typeof candidates }> = [
      { key: "timeline", label: "01 // 时间轴（年/月/日）", color: "var(--amber)", x: width * 0.14, items: buckets.timeline },
      { key: "card", label: "02 // 复盘原件卡片", color: "var(--graph-node-card)", x: width * 0.38, items: buckets.card },
      { key: "topic", label: "03 // 主题与概念星核", color: "var(--cyan)", x: width * 0.66, items: buckets.topic },
      {
        key: "manual",
        label: "04 // 总览 & 交易手册",
        color: "var(--emerald)",
        x: width * 0.89,
        items: [...buckets.overview, ...buckets.manual],
      },
    ];

    const usableH = height - 140;
    for (const col of colSpecs) {
      const count = col.items.length;
      if (count === 0) continue;
      const useTwoLanes = count > 10;
      col.items.forEach((item, idx) => {
        const lane = useTwoLanes ? (idx % 2 === 0 ? -52 : 52) : 0;
        const rowCount = useTwoLanes ? Math.ceil(count / 2) : count;
        const rowIdx = useTwoLanes ? Math.floor(idx / 2) : idx;
        const yStep = usableH / Math.max(rowCount, 1);
        const y = 85 + yStep * (rowIdx + 0.5);
        const x = col.x + lane;
        nodes.push({
          rel: item.file.rel,
          title: item.file.title,
          nodeType: item.file.nodeType,
          homeX: x,
          homeY: y,
          x,
          y,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
          r: Math.min(10.5, 5.2 + Math.sqrt(item.degree) * 0.72),
          degree: item.degree,
          isCenter: item.file.rel === activeRel,
        });
      });
    }

    guide = {
      kind: "columns",
      columns: colSpecs.map((c) => ({ x: c.x, label: c.label, color: c.color })),
    };
  } else {
    const rCard = 165;
    const rTopic = 295;
    const rTimeline = 415;

    if (buckets.overview.length > 0) {
      const ov = buckets.overview[0];
      nodes.push({
        rel: ov.file.rel,
        title: ov.file.title,
        nodeType: "overview",
        homeX: cx,
        homeY: cy,
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        r: 12,
        degree: ov.degree,
        isCenter: ov.file.rel === activeRel,
      });
    }

    if (buckets.manual.length > 0) {
      nodes.push(
        ...placeOnRing(
          buckets.manual.map((m, i) => ({ ...m, preferredAngle: (i / buckets.manual.length) * Math.PI * 2 })),
          cx,
          cy,
          88,
          activeRel,
        ),
      );
    }

    const cardAngleMap = new Map<string, number>();
    nodes.push(
      ...placeOnRing(
        buckets.card.map((c, i) => {
          const angle = (i / Math.max(buckets.card.length, 1)) * Math.PI * 2 - Math.PI / 2;
          cardAngleMap.set(c.file.rel, angle);
          return { ...c, preferredAngle: angle };
        }),
        cx,
        cy,
        rCard,
        activeRel,
      ),
    );

    const preferredAngleFor = (rel: string, fallbackIdx: number, total: number): number => {
      const link = index.links[rel];
      if (!link) return (fallbackIdx / Math.max(total, 1)) * Math.PI * 2;
      let sx = 0;
      let sy = 0;
      let hits = 0;
      for (const peer of [...link.out, ...link.in]) {
        const ang = cardAngleMap.get(peer);
        if (ang !== undefined) {
          sx += Math.cos(ang);
          sy += Math.sin(ang);
          hits++;
        }
      }
      if (hits === 0) return (fallbackIdx / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
      return Math.atan2(sy / hits, sx / hits);
    };

    nodes.push(
      ...placeOnRing(
        buckets.topic.map((t, i) => ({
          ...t,
          preferredAngle: preferredAngleFor(t.file.rel, i, buckets.topic.length),
        })),
        cx,
        cy,
        rTopic,
        activeRel,
        true,
      ),
    );

    nodes.push(
      ...placeOnRing(
        buckets.timeline.map((t, i) => ({
          ...t,
          preferredAngle: preferredAngleFor(t.file.rel, i, buckets.timeline.length),
        })),
        cx,
        cy,
        rTimeline,
        activeRel,
        true,
      ),
    );

    guide = {
      kind: "rings",
      cx,
      cy,
      rings: [
        { r: rCard, label: "ORBIT 01 · 复盘卡片层", color: "var(--border-strong)" },
        { r: rTopic, label: "ORBIT 02 · 主题概念星环", color: "var(--border-strong)" },
        { r: rTimeline, label: "ORBIT 03 · 时间轴外轨", color: "var(--border-strong)" },
      ],
    };
  }

  const shown = new Set(nodes.map((n) => n.rel));
  const nodeTypeByRel = new Map(nodes.map((n) => [n.rel, n.nodeType]));
  const edges: SimEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const n of nodes) {
    for (const target of index.links[n.rel]?.out ?? []) {
      if (!shown.has(target)) continue;
      const key = n.rel < target ? `${n.rel}->${target}` : `${target}->${n.rel}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      const isOverviewEdge =
        nodeTypeByRel.get(n.rel) === "overview" || nodeTypeByRel.get(target) === "overview";
      edges.push({
        from: n.rel,
        to: target,
        direction: "peer",
        structural: !isOverviewEdge,
      });
    }
  }

  return { nodes, edges, guide };
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
  const width = mode === "global" ? 1180 : 300;
  const height = mode === "global" ? 900 : 245;

  const [layoutMode, setLayoutMode] = useState<LayoutMode>("orbital");
  const [hoveredRel, setHoveredRel] = useState<string | null>(null);
  const [lockedRel, setLockedRel] = useState<string | null>(null);
  const [draggingRel, setDraggingRel] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<VaultNodeType | "all">("all");
  const [showSettings, setShowSettings] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(mode === "global");

  // Tactile Damped Physics Controls
  const [archPull, setArchPull] = useState(mode === "global" ? 0.045 : 0.06);
  const [damping, setDamping] = useState(0.8);
  const [springPull, setSpringPull] = useState(0.032);

  const defaultTransform = useMemo(
    () =>
      mode === "global"
        ? { x: width * 0.03, y: height * 0.03, k: 0.94 }
        : { x: 0, y: 0, k: 1 },
    [mode, width, height],
  );
  const [transform, setTransform] = useState(defaultTransform);

  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const guideRef = useRef<GuideOverlay | null>(null);
  const rafRef = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [, setRenderTick] = useState(0);

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
    moved: boolean;
  } | null>(null);

  const transformRef = useRef(transform);
  transformRef.current = transform;

  const physicsRef = useRef({ archPull, damping, springPull });
  physicsRef.current = { archPull, damping, springPull };

  // Esc key clears locked inspection state
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLockedRel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current !== null) return;

    const step = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      if (nodes.length === 0) {
        rafRef.current = null;
        return;
      }

      const { archPull: kHome, damping: damp, springPull: kEdge } = physicsRef.current;
      const byRel = new Map<string, SimNode>(nodes.map((n) => [n.rel, n]));
      const minSpacing = mode === "global" ? 68 : 34;

      // 1) Architectural Restoring Force
      for (const n of nodes) {
        if (n.fx !== null && n.fy !== null) continue;
        n.vx += (n.homeX - n.x) * kHome;
        n.vy += (n.homeY - n.y) * kHome;
      }

      // 2) Elastic Edge Coupling
      for (const e of edges) {
        if (!e.structural && mode === "global") continue;
        const a = byRel.get(e.from);
        const b = byRel.get(e.to);
        if (!a || !b) continue;

        const restDist = Math.max(
          minSpacing * 1.15,
          Math.hypot(b.homeX - a.homeX, b.homeY - a.homeY),
        );
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const stretch = dist - restDist;
        const activeBoost = a.fx !== null || b.fx !== null ? 2.4 : 1.0;
        const force = stretch * kEdge * activeBoost;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (a.fx === null) {
          a.vx += fx;
          a.vy += fy;
        }
        if (b.fx === null) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // 3) Soft Label-Aware Push Collision
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.5;
          if (dist < minSpacing) {
            const overlap = minSpacing - dist;
            const push = overlap * 0.14;
            const px = (dx / dist) * push;
            const py = (dy / dist) * push;
            if (a.fx === null) {
              a.vx -= px;
              a.vy -= py;
            }
            if (b.fx === null) {
              b.vx += px;
              b.vy += py;
            }
          }
        }
      }

      // 4) Viscous Damped Integration
      const velocityRetention = Math.max(0.55, Math.min(0.92, damp));
      let kineticEnergy = 0;
      for (const n of nodes) {
        if (n.fx !== null && n.fy !== null) {
          n.x += (n.fx - n.x) * 0.55;
          n.y += (n.fy - n.y) * 0.55;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx *= velocityRetention;
        n.vy *= velocityRetention;

        const speed = Math.hypot(n.vx, n.vy);
        if (speed > 20) {
          n.vx = (n.vx / speed) * 20;
          n.vy = (n.vy / speed) * 20;
        }
        n.x += n.vx;
        n.y += n.vy;
        kineticEnergy += n.vx * n.vx + n.vy * n.vy;
      }

      setRenderTick((t) => (t + 1) % 100000);

      if (dragNodeRef.current || kineticEnergy > 0.04) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, [mode]);

  useEffect(() => {
    const topo = buildGraphTopology(index, activeRel, mode, layoutMode, width, height, filterType);
    nodesRef.current = topo.nodes;
    edgesRef.current = topo.edges;
    guideRef.current = topo.guide;
    setLockedRel(null);
    setTransform(defaultTransform);
    setRenderTick((t) => (t + 1) % 100000);
    startLoop();
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [index, activeRel, mode, layoutMode, width, height, filterType, defaultTransform, startLoop]);

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
      const factor = e.deltaY < 0 ? 1.12 : 0.89;

      setTransform((prev) => {
        const nextK = Math.min(3.0, Math.max(0.4, prev.k * factor));
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

  // Compute 1-hop locked subgraph set
  const lockedCluster = useMemo(() => {
    if (!lockedRel) return null;
    const set = new Set<string>([lockedRel]);
    for (const e of edgesRef.current) {
      if (e.from === lockedRel) set.add(e.to);
      if (e.to === lockedRel) set.add(e.from);
    }
    return set;
  }, [lockedRel]);

  // Active highlight source: locked node takes priority over casual hover (unless actively dragging another node)
  const focusRel = draggingRel ?? lockedRel ?? hoveredRel;

  const connectedToFocus = useMemo(() => {
    if (!focusRel) return null;
    const set = new Set<string>([focusRel]);
    for (const e of edgesRef.current) {
      if (e.from === focusRel) set.add(e.to);
      if (e.to === focusRel) set.add(e.from);
    }
    return set;
  }, [focusRel]);

  const handleBgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const targetEl = e.target instanceof Element ? e.target : null;
    if (targetEl?.closest("[data-graph-node]")) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Precision touchpad tap-to-click may release pointer before handler runs */
    }
    panRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: transformRef.current.x,
      origY: transformRef.current.y,
      moved: false,
    };
  };

  const handleNodePointerDown = (e: React.PointerEvent<SVGGElement>, rel: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* Ignore already-released pointer */
    }
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
    setDraggingRel(rel);
    startLoop();
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
      startLoop();
      return;
    }

    const pan = panRef.current;
    if (pan && svgRef.current) {
      const dist = Math.hypot(e.clientX - pan.startClientX, e.clientY - pan.startClientY);
      if (dist > 4) pan.moved = true;
      const rect = svgRef.current.getBoundingClientRect();
      const dx = ((e.clientX - pan.startClientX) / Math.max(rect.width, 1)) * width;
      const dy = ((e.clientY - pan.startClientY) / Math.max(rect.height, 1)) * height;
      const nextX = pan.origX + dx;
      const nextY = pan.origY + dy;
      setTransform((prev) => ({
        ...prev,
        x: nextX,
        y: nextY,
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
      setDraggingRel(null);
      startLoop();

      // Two-step click behavior:
      // 1st click -> lock & illuminate this node's connected structure (do NOT jump yet)
      // 2nd click on ANY highlighted node in that illuminated cluster -> navigate to its detail page!
      if (!moved) {
        if (lockedRel && lockedCluster?.has(rel)) {
          setLockedRel(null);
          onSelectNode(rel);
        } else {
          setLockedRel(rel);
        }
      }
    } else if (panRef.current) {
      // Single click on empty background unlocks highlighted cluster
      if (!panRef.current.moved) {
        setLockedRel(null);
      }
      panRef.current = null;
    }

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* Ignore if pointer already released */
    }
  };

  const zoomBy = (factor: number) => {
    setTransform((prev) => {
      const nextK = Math.min(3.0, Math.max(0.4, prev.k * factor));
      const ratio = nextK / prev.k;
      return {
        k: nextK,
        x: width / 2 - (width / 2 - prev.x) * ratio,
        y: height / 2 - (height / 2 - prev.y) * ratio,
      };
    });
  };

  const resetArchitecture = () => {
    setLockedRel(null);
    setTransform(defaultTransform);
    for (const n of nodesRef.current) {
      n.fx = null;
      n.fy = null;
    }
    startLoop();
  };

  const nodes = nodesRef.current;
  const edges = edgesRef.current;
  const guide = guideRef.current;
  const nodeMap = new Map(nodes.map((n) => [n.rel, n]));
  const lockedNode = lockedRel ? nodeMap.get(lockedRel) ?? null : null;
  const lockedLinkStats = lockedRel ? index?.links[lockedRel] ?? { out: [], in: [] } : null;

  return (
    <div className="flex h-full flex-col">
      {/* Sci-Fi HUD Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)]/90 px-3 py-2 backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--ink)]">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] text-[var(--cyan)]">
            <Network className="h-3 w-3" />
          </span>
          <span className="tracking-wide">
            {mode === "global" ? "全息星轨双链图谱" : "局部神经星图"}
          </span>
          <span className="rounded border border-[var(--border)] bg-[var(--bg-deep)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--cyan)]">
            {nodes.length} NODES · {edges.length} LINKS
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {mode === "global" && (
            <>
              <div className="mr-1 inline-flex rounded border border-[var(--border)] bg-[var(--bg-deep)] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setLayoutMode("orbital")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 transition ${
                    layoutMode === "orbital"
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  <Compass className="h-3 w-3" />
                  星轨分层
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("layered")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 transition ${
                    layoutMode === "layered"
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  <Layers className="h-3 w-3" />
                  架构泳道
                </button>
              </div>

              <div className="mr-1 flex flex-wrap items-center gap-0.5 text-[11px]">
                {(["all", "card", "topic", "timeline", "manual"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFilterType(t)}
                    className={`rounded px-1.5 py-0.5 transition ${
                      filterType === t
                        ? "border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] font-medium text-[var(--cyan)]"
                        : "text-[var(--ink-dim)] hover:text-[var(--ink-muted)]"
                    }`}
                  >
                    {t === "all" ? "全部" : NODE_LABELS[t]}
                  </button>
                ))}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            title="放大"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.84)}
            title="缩小"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetArchitecture}
            title="重置视角并解除锁定"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          {mode === "global" && (
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              title="阻尼与弹性力场参数"
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
              title={mode === "global" ? "返回阅读视图" : "展开全息星轨图谱"}
              className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
            >
              {mode === "global" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Interactive Sci-Fi Holographic Canvas */}
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
            aria-label="Holographic Force-Directed Knowledge Graph"
          >
            <defs>
              <filter id="neon-glow-strong" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="4.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="neon-glow-soft" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="2.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="core-nebula" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(168,130,255,0.22)" />
                <stop offset="55%" stopColor="rgba(34,211,238,0.06)" />
                <stop offset="100%" stopColor="rgba(6,8,14,0)" />
              </radialGradient>
            </defs>

            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
              {/* Ambient Holographic Orbital Architecture Guides */}
              {guide?.kind === "rings" && (
                <g className="pointer-events-none">
                  
                  {/* Subtle crosshairs */}
                  {mode === "global" && (
                    <g opacity={0.14} stroke="var(--border)" strokeWidth={0.7} strokeDasharray="3 8">
                      <line x1={guide.cx - 460} y1={guide.cy} x2={guide.cx + 460} y2={guide.cy} />
                      <line x1={guide.cx} y1={guide.cy - 460} x2={guide.cx} y2={guide.cy + 460} />
                    </g>
                  )}
                  {guide.rings.map((ring, idx) => (
                    <g key={idx}>
                      <circle
                        cx={guide.cx}
                        cy={guide.cy}
                        r={ring.r}
                        fill="none"
                        stroke={ring.color}
                        strokeWidth={1.1}
                        strokeDasharray={idx === 1 ? "8 5 2 5" : "4 7"}
                        
                      />
                      {ring.label && (
                        <text
                          x={guide.cx}
                          y={guide.cy - ring.r - 8}
                          textAnchor="middle"
                          fill="var(--ink-dim)"
                          fontSize={9.5}
                          fontFamily="monospace"
                          letterSpacing={2}
                        >
                          {ring.label}
                        </text>
                      )}
                    </g>
                  ))}
                </g>
              )}

              {guide?.kind === "columns" && (
                <g className="pointer-events-none">
                  {guide.columns.map((col, idx) => (
                    <g key={idx}>
                      <line
                        x1={col.x}
                        y1={42}
                        x2={col.x}
                        y2={height - 28}
                        stroke={col.color}
                        opacity={0.14}
                        strokeWidth={1}
                        strokeDasharray="4 7"
                      />
                      <text
                        x={col.x}
                        y={28}
                        textAnchor="middle"
                        fill={col.color}
                        opacity={0.85}
                        fontSize={11}
                        fontFamily="monospace"
                        fontWeight={600}
                        letterSpacing={1}
                      >
                        {col.label}
                      </text>
                    </g>
                  ))}
                </g>
              )}

              {/* Neural Energy Edges */}
              <g>
                {edges.map((e, i) => {
                  const a = nodeMap.get(e.from);
                  const b = nodeMap.get(e.to);
                  if (!a || !b) return null;
                  const highlighted = Boolean(focusRel && (e.from === focusRel || e.to === focusRel));
                  const dimmed = Boolean(focusRel && !highlighted);
                  const baseOpacity = e.structural ? 0.24 : 0.09;

                  return (
                    <g key={`${e.from}-${e.to}-${i}`}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={
                          highlighted
                            ? "var(--accent)"
                            : e.direction === "out"
                              ? "var(--accent)"
                              : e.direction === "in"
                                ? "var(--emerald)"
                                : "var(--graph-edge)"
                        }
                        strokeWidth={(highlighted ? 2.1 : 0.9) / Math.sqrt(transform.k)}
                        opacity={dimmed ? 0.05 : highlighted ? 0.92 : 1}
                        
                      />
                      {/* Animated neon energy pulse along highlighted links */}
                      {highlighted && (
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="var(--accent)"
                          strokeWidth={1.6 / Math.sqrt(transform.k)}
                          opacity={0.95}
                          className="graph-energy-edge pointer-events-none"
                        />
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Interactive Glowing Nodes */}
              <g>
                {nodes.map((n) => {
                  const isLockedAnchor = lockedRel === n.rel;
                  const isInLockedSubgraph = Boolean(lockedCluster?.has(n.rel));
                  const isFocused = focusRel === n.rel;
                  const dimmed = Boolean(connectedToFocus && !connectedToFocus.has(n.rel));
                  const fill = n.isCenter ? "var(--accent)" : NODE_COLORS[n.nodeType];
                  const glow = n.isCenter ? NODE_GLOW.overview : NODE_GLOW[n.nodeType];

                  const showLabel =
                    showAllLabels ||
                    n.isCenter ||
                    isFocused ||
                    isInLockedSubgraph ||
                    transform.k >= 1.25 ||
                    (mode === "local" ? nodes.length <= 14 : n.nodeType !== "timeline" || n.degree >= 4);

                  return (
                    <g
                      key={n.rel}
                      data-graph-node={n.rel}
                      transform={`translate(${n.x}, ${n.y})`}
                      onMouseEnter={() => setHoveredRel(n.rel)}
                      onMouseLeave={() => setHoveredRel(null)}
                      onPointerDown={(e) => handleNodePointerDown(e, n.rel)}
                      className="cursor-pointer"
                      opacity={dimmed ? 0.14 : 1}
                    >
                      {/* Pulsing Sci-Fi Lock Target Reticle */}
                      {isLockedAnchor && (
                        <g className="pointer-events-none">
                          <circle
                            r={n.r + 12}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={1.3}
                            strokeDasharray="5 4"
                            
                          />
                          <circle r={n.r + 7} fill={glow} opacity={0.38} />
                        </g>
                      )}

                      {/* Highlighted neighbor ring (clickable to enter detail!) */}
                      {!isLockedAnchor && isInLockedSubgraph && (
                        <circle
                          r={n.r + 5.5}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth={1.1}
                          opacity={0.85}
                          className="pointer-events-none"
                        />
                      )}

                      {/* Ambient neon aura */}
                      {(n.isCenter || isFocused || isInLockedSubgraph) && (
                        <circle r={n.r + 5} fill={glow} opacity={0.3} className="pointer-events-none" />
                      )}

                      {/* Core Node Sphere */}
                      <circle
                        r={isLockedAnchor ? n.r + 2.5 : isFocused ? n.r + 1.6 : n.r}
                        fill={fill}
                        stroke={isLockedAnchor ? "var(--accent)" : isFocused || n.isCenter ? "#ffffff" : "#07090f"}
                        strokeWidth={isLockedAnchor ? 2 : isFocused || n.isCenter ? 1.5 : 1.1}
                        
                      />

                      {/* Specular Inner Core Dot */}
                      

                      {showLabel && (
                        <text
                          y={n.r + (mode === "global" ? 15 : 12)}
                          textAnchor="middle"
                          fill={isLockedAnchor ? "var(--accent)" : isFocused || isInLockedSubgraph || n.isCenter ? "#ffffff" : "#cbd5e1"}
                          fontSize={(mode === "global" ? 11 : 9.2) / Math.pow(transform.k, 0.35)}
                          fontWeight={isLockedAnchor || isFocused || n.isCenter ? 600 : 400}
                          paintOrder="stroke"
                          stroke="var(--graph-bg)"
                          strokeWidth={3.6}
                          strokeLinejoin="round"
                          className="pointer-events-none"
                        >
                          {shortLabel(n.title, mode === "global" ? 15 : 11)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}

        {/* Holographic Locked-Node HUD Inspector (2-step click feedback!) */}
        {lockedNode && (
          <div className="absolute left-3 top-3 max-w-[300px] rounded-lg border border-[var(--cyan)]/45 bg-[var(--bg-deep)] p-3 text-xs backdrop-blur-md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--cyan)]">
                  <Lock className="h-3 w-3" />
                  <span>结构已锁定 · {NODE_LABELS[lockedNode.nodeType]}</span>
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-[var(--ink-strong)]">{lockedNode.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setLockedRel(null)}
                title="解除锁定 (Esc)"
                className="rounded p-0.5 text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-strong)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-[var(--ink-muted)]">
              <span>出链 {lockedLinkStats?.out.length ?? 0}</span>
              <span>·</span>
              <span>反链 {lockedLinkStats?.in.length ?? 0}</span>
              <span>·</span>
              <span className="text-[var(--accent)]">关联节点 {(lockedCluster?.size ?? 1) - 1}</span>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
              <span className="text-[10px] text-[var(--ink-muted)]">
                再次单击任意高亮节点进入详情
              </span>
              <button
                type="button"
                onClick={() => {
                  const target = lockedNode.rel;
                  setLockedRel(null);
                  onSelectNode(target);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded bg-[var(--cyan-soft)] px-2 py-1 text-[11px] font-medium text-[var(--cyan)] ring-1 ring-[var(--cyan)]/40 transition hover:bg-[var(--cyan)]/25"
              >
                进入详情
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Damped Push-Pull Physics Tuning Popover */}
        {mode === "global" && showSettings && (
          <div className="absolute right-3 top-3 w-60 space-y-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] p-3.5 text-xs backdrop-blur-md">
            <div className="flex items-center justify-between font-semibold text-[var(--ink)]">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[var(--cyan)]" />
                推拉阻尼与架构弹性
              </span>
              <span className="font-mono text-[10px] text-[var(--cyan)]">{Math.round(transform.k * 100)}%</span>
            </div>

            <label className="block space-y-1 text-[11px] text-[var(--ink-muted)]">
              <div className="flex justify-between">
                <span>架构回弹力度</span>
                <span className="font-mono text-[var(--ink)]">{Math.round(archPull * 1000)}</span>
              </div>
              <input
                type="range"
                min={0.01}
                max={0.12}
                step={0.005}
                value={archPull}
                onChange={(e) => {
                  setArchPull(Number(e.target.value));
                  startLoop();
                }}
                className="w-full accent-[var(--cyan)]"
              />
            </label>

            <label className="block space-y-1 text-[11px] text-[var(--ink-muted)]">
              <div className="flex justify-between">
                <span>推拉阻尼粘滞感</span>
                <span className="font-mono text-[var(--ink)]">{Math.round((1 - damping) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.62}
                max={0.9}
                step={0.02}
                value={damping}
                onChange={(e) => {
                  setDamping(Number(e.target.value));
                  startLoop();
                }}
                className="w-full accent-[var(--cyan)]"
              />
            </label>

            <label className="block space-y-1 text-[11px] text-[var(--ink-muted)]">
              <div className="flex justify-between">
                <span>关联牵引弹性</span>
                <span className="font-mono text-[var(--ink)]">{Math.round(springPull * 1000)}</span>
              </div>
              <input
                type="range"
                min={0.01}
                max={0.08}
                step={0.005}
                value={springPull}
                onChange={(e) => {
                  setSpringPull(Number(e.target.value));
                  startLoop();
                }}
                className="w-full accent-[var(--cyan)]"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between text-[11px] text-[var(--ink-muted)]">
              <span>显示全部节点标签</span>
              <input
                type="checkbox"
                checked={showAllLabels}
                onChange={(e) => setShowAllLabels(e.target.checked)}
                className="accent-[var(--cyan)]"
              />
            </label>
          </div>
        )}

        {/* Bottom HUD Legend & 2-Step Gesture Guide */}
        <div className="pointer-events-none absolute bottom-2 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5 rounded border border-[var(--border)] bg-[var(--chart-bg)] px-2.5 py-1 text-[10px] text-[var(--ink-muted)] backdrop-blur-sm">
            {(["overview", "card", "topic", "timeline", "manual"] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: NODE_COLORS[t], boxShadow: `0 0 6px ${NODE_GLOW[t]}` }}
                />
                {NODE_LABELS[t]}
              </span>
            ))}
          </div>

          <div className="hidden rounded border border-[var(--border)] bg-[var(--chart-bg)] px-2.5 py-1 text-[10px] text-[var(--ink-muted)] sm:block">
            单击锁定关联结构 · 再次单击高亮节点进详情 · 拖拽节点阻尼推拉 · 滚轮缩放
          </div>
        </div>
      </div>
    </div>
  );
}
