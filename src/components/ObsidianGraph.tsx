"use client";

import {
  Compass,
  Layers,
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
  manual: "#4ade80",
  card: "#eceef4",
  topic: "#56c2d6",
  timeline: "#e0b354",
};

const NODE_LABELS: Record<VaultNodeType, string> = {
  overview: "总览",
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

/**
 * Evenly distributes items on a ring while preserving preferred angular order
 * so connected clusters sit in the same sector without ever overlapping.
 */
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
      r: Math.min(10, 5 + Math.sqrt(item.degree) * 0.72),
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

  // ── LOCAL GRAPH (Right Sidebar): Structured dual-ring around active note ──
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

    // Group neighbors by semantic type so local graph also has clear structure
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
        r: Math.min(7, 4.5 + Math.sqrt(deg) * 0.55),
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
        rings: [{ r: innerR, label: "", color: "rgba(168,130,255,0.12)" }],
      },
    };
  }

  // ── GLOBAL GRAPH: Structured Knowledge Architecture ──
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

  // Order review cards & timelines chronologically so the architecture tells a chronological story
  buckets.card.sort((a, b) => (a.file.eventDate ?? "9999").localeCompare(b.file.eventDate ?? "9999"));
  buckets.timeline.sort((a, b) => (a.file.eventDate ?? "9999").localeCompare(b.file.eventDate ?? "9999"));
  buckets.topic.sort((a, b) => b.degree - a.degree);

  let nodes: SimNode[] = [];
  let guide: GuideOverlay | null = null;

  if (layoutMode === "layered") {
    // 4-Column Architectural Swimlanes: Timeline -> Review Cards -> Topics -> Manuals/Overview
    const colSpecs: Array<{ key: string; label: string; color: string; x: number; items: typeof candidates }> = [
      { key: "timeline", label: "① 时间轴（年/月/日）", color: "#e0b354", x: width * 0.14, items: buckets.timeline },
      { key: "card", label: "② 复盘原件卡片", color: "#eceef4", x: width * 0.38, items: buckets.card },
      { key: "topic", label: "③ 主题与概念枢纽", color: "#56c2d6", x: width * 0.66, items: buckets.topic },
      {
        key: "manual",
        label: "④ 总览 & 交易手册",
        color: "#4ade80",
        x: width * 0.89,
        items: [...buckets.overview, ...buckets.manual],
      },
    ];

    const usableH = height - 140;
    for (const col of colSpecs) {
      const count = col.items.length;
      if (count === 0) continue;
      // Split large columns (e.g. 20+ topics) into 2 staggered sub-lanes for generous breathing room
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
          r: Math.min(10.5, 5 + Math.sqrt(item.degree) * 0.72),
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
    // Orbital Concentric Architecture:
    // Center: Overview | Inner Ring: Manuals + Cards | Mid Ring: Topics | Outer Ring: Timeline
    const rCard = 165;
    const rTopic = 295;
    const rTimeline = 415;

    // 1) Overview center
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
        r: 11,
        degree: ov.degree,
        isCenter: ov.file.rel === activeRel,
      });
    }

    // 2) Manuals on tight inner halo (if any)
    if (buckets.manual.length > 0) {
      const manualNodes = placeOnRing(
        buckets.manual.map((m, i) => ({ ...m, preferredAngle: (i / buckets.manual.length) * Math.PI * 2 })),
        cx,
        cy,
        88,
        activeRel,
      );
      nodes.push(...manualNodes);
    }

    // 3) Review Cards on Inner-Mid Ring (chronologically clockwise)
    const cardAngleMap = new Map<string, number>();
    const cardNodes = placeOnRing(
      buckets.card.map((c, i) => {
        const angle = (i / Math.max(buckets.card.length, 1)) * Math.PI * 2 - Math.PI / 2;
        cardAngleMap.set(c.file.rel, angle);
        return { ...c, preferredAngle: angle };
      }),
      cx,
      cy,
      rCard,
      activeRel,
    );
    nodes.push(...cardNodes);

    // Helper: compute average angular sector of connected review cards so topics & timelines sit near their cards
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

    // 4) Topics on Mid Ring (staggered if dense so labels never overlap)
    const topicNodes = placeOnRing(
      buckets.topic.map((t, i) => ({
        ...t,
        preferredAngle: preferredAngleFor(t.file.rel, i, buckets.topic.length),
      })),
      cx,
      cy,
      rTopic,
      activeRel,
      true,
    );
    nodes.push(...topicNodes);

    // 5) Timeline (Years/Months/Days) on Outer Ring
    const timelineNodes = placeOnRing(
      buckets.timeline.map((t, i) => ({
        ...t,
        preferredAngle: preferredAngleFor(t.file.rel, i, buckets.timeline.length),
      })),
      cx,
      cy,
      rTimeline,
      activeRel,
      true,
    );
    nodes.push(...timelineNodes);

    guide = {
      kind: "rings",
      cx,
      cy,
      rings: [
        { r: rCard, label: "复盘卡片层", color: "rgba(236,238,244,0.10)" },
        { r: rTopic, label: "主题概念星环", color: "rgba(86,194,214,0.12)" },
        { r: rTimeline, label: "时间轴外轨", color: "rgba(224,179,84,0.12)" },
      ],
    };
  }

  // Build deduplicated edges
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
  const [draggingRel, setDraggingRel] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<VaultNodeType | "all">("all");
  const [showSettings, setShowSettings] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(mode === "global");

  // Tactile Damped Physics Controls
  // archPull: elastic memory pulling nodes softly back to architectural positions (0 = free-floating, 1 = firm structure)
  // damping: viscous resistance when pushing/pulling nodes (higher = silkier honey-like drag feel)
  // springPull: how strongly connected neighbors follow when you drag a node
  const [archPull, setArchPull] = useState(mode === "global" ? 0.045 : 0.06);
  const [damping, setDamping] = useState(0.8);
  const [springPull, setSpringPull] = useState(0.032);

  // Camera pan + zoom (slightly zoomed out to 0.94 in Global so full orbital rings breathe comfortably)
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
  } | null>(null);

  const transformRef = useRef(transform);
  transformRef.current = transform;

  const physicsRef = useRef({ archPull, damping, springPull });
  physicsRef.current = { archPull, damping, springPull };

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

      // 1) Architectural Restoring Force (keeps clear structure + smooth viscous rebound after push/pull)
      for (const n of nodes) {
        if (n.fx !== null && n.fy !== null) continue;
        const dx = n.homeX - n.x;
        const dy = n.homeY - n.y;
        n.vx += dx * kHome;
        n.vy += dy * kHome;
      }

      // 2) Elastic Edge Coupling (pulling a node smoothly tugs its connected neighborhood with damping)
      for (const e of edges) {
        if (!e.structural && mode === "global") continue; // Don't let Overview hub yank the entire vault inward
        const a = byRel.get(e.from);
        const b = byRel.get(e.to);
        if (!a || !b) continue;

        // Rest length is the architectural distance between their home positions so structure stays crisp!
        const restDist = Math.max(
          minSpacing * 1.15,
          Math.hypot(b.homeX - a.homeX, b.homeY - a.homeY),
        );
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const stretch = dist - restDist;
        // Stronger coupling when one end is actively dragged so the web stretches organically
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

      // 3) Soft Label-Aware Push Collision (dragging a node pushes nearby nodes aside smoothly without overlap)
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

      // 4) Viscous Damped Integration (silky, weighty Obsidian feel)
      const velocityRetention = Math.max(0.55, Math.min(0.92, damp));
      let kineticEnergy = 0;
      for (const n of nodes) {
        if (n.fx !== null && n.fy !== null) {
          // Slight inertial easing even on the grabbed node for tactile resistance
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

  // Rebuild architectural layout whenever inputs change
  useEffect(() => {
    const topo = buildGraphTopology(index, activeRel, mode, layoutMode, width, height, filterType);
    nodesRef.current = topo.nodes;
    edgesRef.current = topo.edges;
    guideRef.current = topo.guide;
    setTransform(defaultTransform);
    setRenderTick((t) => (t + 1) % 100000);
    // Run a brief gentle settle pass for collision perfection
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
      setDraggingRel(null);
      startLoop(); // Smooth damped elastic glide back to architectural layer
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
  const focusRel = draggingRel ?? hoveredRel;

  const connectedToFocus = useMemo(() => {
    if (!focusRel) return null;
    const set = new Set<string>([focusRel]);
    for (const e of edgesRef.current) {
      if (e.from === focusRel) set.add(e.to);
      if (e.to === focusRel) set.add(e.from);
    }
    return set;
  }, [focusRel]);

  return (
    <div className="flex h-full flex-col">
      {/* Header / Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
          <Network className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>{mode === "global" ? "分层架构图谱（Graph View）" : "局部架构图谱（Local Graph）"}</span>
          <span className="font-mono text-[10px] text-[var(--ink-dim)]">
            {nodes.length} 节点 · {edges.length} 连线
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {mode === "global" && (
            <>
              {/* Architecture Mode Switch: Orbital Rings vs Layered Swimlanes */}
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
                        ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]"
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
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.84)}
            title="缩小"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetArchitecture}
            title="重置视角并回正架构"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
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
              title={mode === "global" ? "返回阅读视图" : "展开全局架构图谱"}
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
            aria-label="Obsidian Structured Force-Directed Knowledge Graph"
          >
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
              {/* Subtle Architectural Guide Overlay */}
              {guide?.kind === "rings" && (
                <g className="pointer-events-none">
                  {guide.rings.map((ring, idx) => (
                    <g key={idx}>
                      <circle
                        cx={guide.cx}
                        cy={guide.cy}
                        r={ring.r}
                        fill="none"
                        stroke={ring.color}
                        strokeWidth={1}
                        strokeDasharray="4 6"
                      />
                      {ring.label && (
                        <text
                          x={guide.cx}
                          y={guide.cy - ring.r - 6}
                          textAnchor="middle"
                          fill="rgba(154,155,166,0.42)"
                          fontSize={10}
                          letterSpacing={1.5}
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
                        stroke="rgba(255,255,255,0.05)"
                        strokeWidth={1}
                        strokeDasharray="4 6"
                      />
                      <text
                        x={col.x}
                        y={28}
                        textAnchor="middle"
                        fill={col.color}
                        opacity={0.72}
                        fontSize={11.5}
                        fontWeight={600}
                      >
                        {col.label}
                      </text>
                    </g>
                  ))}
                </g>
              )}

              {/* Edges */}
              <g>
                {edges.map((e, i) => {
                  const a = nodeMap.get(e.from);
                  const b = nodeMap.get(e.to);
                  if (!a || !b) return null;
                  const highlighted = focusRel && (e.from === focusRel || e.to === focusRel);
                  const dimmed = focusRel && !highlighted;
                  const baseOpacity = e.structural ? 0.2 : 0.08;
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
                              : `rgba(180,184,200,${baseOpacity})`
                      }
                      strokeWidth={(highlighted ? 1.8 : 0.9) / Math.sqrt(transform.k)}
                      opacity={dimmed ? 0.06 : 1}
                    />
                  );
                })}
              </g>

              {/* Draggable Nodes with Crisp Labels */}
              <g>
                {nodes.map((n) => {
                  const isFocused = focusRel === n.rel;
                  const dimmed = connectedToFocus && !connectedToFocus.has(n.rel);
                  const fill = n.isCenter ? "#a882ff" : NODE_COLORS[n.nodeType];
                  const showLabel =
                    showAllLabels ||
                    n.isCenter ||
                    isFocused ||
                    transform.k >= 1.28 ||
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
                      opacity={dimmed ? 0.16 : 1}
                    >
                      {(n.isCenter || isFocused) && (
                        <circle r={n.r + 6} fill="rgba(168,130,255,0.24)" />
                      )}
                      <circle
                        r={isFocused ? n.r + 1.8 : n.r}
                        fill={fill}
                        stroke={n.isCenter || isFocused ? "#ffffff" : "#161619"}
                        strokeWidth={n.isCenter || isFocused ? 1.6 : 1.2}
                      />
                      {showLabel && (
                        <text
                          y={n.r + (mode === "global" ? 14 : 11)}
                          textAnchor="middle"
                          fill={n.isCenter || isFocused ? "#ffffff" : "#c2c5d0"}
                          fontSize={(mode === "global" ? 11 : 9.2) / Math.pow(transform.k, 0.35)}
                          fontWeight={n.isCenter || isFocused ? 600 : 400}
                          paintOrder="stroke"
                          stroke="#141417"
                          strokeWidth={3.2}
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

        {/* Damped Push-Pull Physics Tuning Popover */}
        {mode === "global" && showSettings && (
          <div className="absolute right-3 top-3 w-60 space-y-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]/95 p-3.5 text-xs shadow-xl backdrop-blur">
            <div className="flex items-center justify-between font-semibold text-[var(--ink)]">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                推拉阻尼与架构弹性
              </span>
              <span className="font-mono text-[10px] text-[var(--ink-dim)]">{Math.round(transform.k * 100)}%</span>
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
                className="w-full accent-[var(--accent)]"
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
                className="w-full accent-[var(--accent)]"
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
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between text-[11px] text-[var(--ink-muted)]">
              <span>显示全部节点标签</span>
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
          <div className="flex flex-wrap items-center gap-2.5 rounded bg-[#141417]/85 px-2.5 py-1 text-[10px] text-[var(--ink-muted)] backdrop-blur-sm">
            {(["overview", "card", "topic", "timeline", "manual"] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NODE_COLORS[t] }} />
                {NODE_LABELS[t]}
              </span>
            ))}
          </div>

          <div className="hidden rounded bg-[#141417]/80 px-2.5 py-1 text-[10px] text-[var(--ink-dim)] sm:block">
            按住节点阻尼推拉（松手平滑归位）· 拖拽空白平移 · 滚轮缩放 · 单击打开笔记
          </div>
        </div>
      </div>
    </div>
  );
}
