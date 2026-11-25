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
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VaultFileItem, VaultIndex, VaultNodeType } from "@/lib/vault-builder";

const NODE_COLORS: Record<VaultNodeType, string> = {
  overview: "var(--graph-node-overview)",
  manual: "var(--graph-node-manual)",
  card: "var(--graph-node-card)",
  topic: "var(--graph-node-topic)",
  timeline: "var(--graph-node-timeline)",
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
type GraphDensityMode = "skeleton" | "full";

function isYearTimelineRel(rel: string): boolean {
  return /^10-时间轴\/\d{4}年\.md$/.test(rel);
}

function isMonthTimelineRel(rel: string): boolean {
  return /^10-时间轴\/\d{4}-\d{2}\.md$/.test(rel);
}

function monthParentYearRel(rel: string): string | null {
  const m = /^10-时间轴\/(\d{4})-\d{2}\.md$/.exec(rel);
  return m ? `10-时间轴/${m[1]}年.md` : null;
}

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

function sampleEvenly<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  if (cap <= 0) return [];
  if (cap === 1) return [items[0]];
  const out: T[] = [];
  const step = (items.length - 1) / (cap - 1);
  for (let i = 0; i < cap; i++) {
    out.push(items[Math.round(i * step)]);
  }
  return out;
}

const MAX_GLOBAL_GRAPH_NODES = 160;

function buildGraphTopology(
  index: VaultIndex | null,
  activeRel: string,
  mode: "local" | "global",
  layoutMode: LayoutMode,
  width: number,
  height: number,
  filterType: VaultNodeType | "all",
  densityMode: GraphDensityMode,
): { nodes: SimNode[]; edges: SimEdge[]; guide: GuideOverlay | null; totalFiltered: number } {
  if (!index) return { nodes: [], edges: [], guide: null, totalFiltered: 0 };
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
        rings: [{ r: innerR, label: "", color: "var(--graph-ring)" }],
      },
      totalFiltered: nodes.length,
    };
  }

  // Global Graph: Abstraction-Ordered Hierarchy (Inside -> Outside)
  // Core (MOC + Manuals) -> Orbit 01 (Topics + Year Hubs) -> Orbit 02 (Month Hubs) -> Orbit 03 (Review Cards)
  const allFiltered = index.files
    .filter((f) => filterType === "all" || f.nodeType === filterType)
    .map((f) => ({
      file: f,
      degree: (index.links[f.rel]?.out.length ?? 0) + (index.links[f.rel]?.in.length ?? 0),
    }));
  const totalFiltered = allFiltered.length;

  let candidates = allFiltered;
  if (filterType === "all") {
    const overviews = allFiltered.filter((c) => c.file.nodeType === "overview");
    const manuals = allFiltered.filter((c) => c.file.nodeType === "manual");
    const topics = allFiltered.filter((c) => c.file.nodeType === "topic").sort((a, b) => b.degree - a.degree);
    const years = allFiltered
      .filter((c) => isYearTimelineRel(c.file.rel))
      .sort((a, b) => (a.file.eventDate ?? "").localeCompare(b.file.eventDate ?? ""));
    const months = allFiltered
      .filter((c) => isMonthTimelineRel(c.file.rel))
      .sort((a, b) => (a.file.eventDate ?? "").localeCompare(b.file.eventDate ?? ""));
    const cardsChrono = allFiltered
      .filter((c) => c.file.nodeType === "card")
      .sort((a, b) => (a.file.eventDate ?? "9999").localeCompare(b.file.eventDate ?? "9999"));

    if (densityMode === "skeleton") {
      // Macro Knowledge Skeleton: Core MOC + Manuals + Topics + Years + Months (zero leaf hairball)
      const picked: typeof allFiltered = [
        ...overviews,
        ...manuals.slice(0, 16),
        ...topics.slice(0, 36),
        ...years,
      ];
      const monthBudget = Math.max(0, MAX_GLOBAL_GRAPH_NODES - picked.length);
      picked.push(...sampleEvenly(months, monthBudget));
      candidates = picked;
    } else {
      // Full View: Core + Hubs + Outermost Cards Ring (sampled evenly across all years if > cap)
      const picked: typeof allFiltered = [
        ...overviews,
        ...manuals.slice(0, 12),
        ...topics.slice(0, 28),
        ...years,
      ];
      const remaining = Math.max(0, MAX_GLOBAL_GRAPH_NODES - picked.length);
      const monthBudget = Math.min(months.length, Math.max(12, Math.floor(remaining * 0.4)));
      const cardBudget = Math.min(cardsChrono.length, Math.max(0, remaining - monthBudget));
      picked.push(...sampleEvenly(months, monthBudget));
      picked.push(...sampleEvenly(cardsChrono, cardBudget));
      candidates = picked;
    }
  } else if (allFiltered.length > MAX_GLOBAL_GRAPH_NODES) {
    const chronoSorted = [...allFiltered].sort((a, b) =>
      (a.file.eventDate ?? "9999").localeCompare(b.file.eventDate ?? "9999"),
    );
    candidates =
      filterType === "card"
        ? sampleEvenly(chronoSorted, MAX_GLOBAL_GRAPH_NODES)
        : [...allFiltered].sort((a, b) => b.degree - a.degree).slice(0, MAX_GLOBAL_GRAPH_NODES);
  }

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

  const yearItems = buckets.timeline.filter((c) => isYearTimelineRel(c.file.rel));
  const monthItems = buckets.timeline.filter((c) => isMonthTimelineRel(c.file.rel));
  const dayItems = buckets.timeline.filter((c) => !isYearTimelineRel(c.file.rel) && !isMonthTimelineRel(c.file.rel));

  const nodes: SimNode[] = [];
  let guide: GuideOverlay | null = null;

  if (layoutMode === "layered") {
    const rawCols: Array<{ key: string; label: string; color: string; items: typeof candidates }> = [
      {
        key: "manual",
        label: "01 // 总览 & 交易手册",
        color: "var(--graph-node-manual)",
        items: [...buckets.overview, ...buckets.manual],
      },
      { key: "topic", label: "02 // 核心主题星核", color: "var(--graph-node-topic)", items: buckets.topic },
      {
        key: "timeline",
        label: "03 // 时间轴（年 / 月）",
        color: "var(--graph-node-timeline)",
        items: [...yearItems, ...monthItems, ...dayItems],
      },
      { key: "card", label: "04 // 复盘原件卡片", color: "var(--graph-node-card)", items: buckets.card },
    ];
    const activeCols = rawCols.filter((c) => c.items.length > 0);
    const colSpecs = activeCols.map((c, idx) => ({
      ...c,
      x:
        activeCols.length === 1
          ? width * 0.5
          : width * (0.13 + (idx / (activeCols.length - 1)) * 0.74),
    }));

    const usableH = height - 140;
    for (const col of colSpecs) {
      const count = col.items.length;
      if (count === 0) continue;
      const useTwoLanes = count > 14;
      col.items.forEach((item, idx) => {
        const lane = useTwoLanes ? (idx % 2 === 0 ? -48 : 48) : 0;
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
          r: Math.min(10.5, 5.2 + Math.sqrt(item.degree) * 0.65),
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
    const outerLeaves = [...buckets.card, ...dayItems];
    const hasOuterCards = outerLeaves.length > 0;
    const hasTopics = buckets.topic.length > 0;
    const hasYears = yearItems.length > 0;
    const hasMonths = monthItems.length > 0;

    // Dedicated full-360° concentric rings: Topics and Years each own an independent symmetric orbit
    const rManual = hasOuterCards ? 64 : 72;
    const rTopic = hasOuterCards ? 128 : 145;
    const rYear = hasTopics ? (hasOuterCards ? 228 : 255) : rTopic;
    const rMonth = hasYears
      ? hasOuterCards
        ? 322
        : 365
      : hasTopics
        ? hasOuterCards
          ? 248
          : 280
        : rTopic;
    const rCard = hasTopics || hasYears || hasMonths ? 418 : 260;

    // Center: Master MOC
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
        r: 12.5,
        degree: ov.degree,
        isCenter: ov.file.rel === activeRel,
      });
    }

    // Inner Satellite Ring: Distilled Playbook Manuals
    if (buckets.manual.length > 0) {
      nodes.push(
        ...placeOnRing(
          buckets.manual.map((m, i) => ({ ...m, preferredAngle: (i / buckets.manual.length) * Math.PI * 2 })),
          cx,
          cy,
          rManual,
          activeRel,
        ),
      );
    }

    const hubAngleMap = new Map<string, number>();

    // ORBIT 01 (Dedicated 360° Topic Ring): Core Theme Hubs evenly spaced across full circle
    if (hasTopics) {
      const tStep = (Math.PI * 2) / buckets.topic.length;
      const tStart = -Math.PI / 2 + tStep / 2;
      buckets.topic.forEach((tItem, idx) => {
        const angle = tStart + tStep * idx;
        hubAngleMap.set(tItem.file.rel, angle);
        const x = cx + Math.cos(angle) * rTopic;
        const y = cy + Math.sin(angle) * rTopic;
        nodes.push({
          rel: tItem.file.rel,
          title: tItem.file.title,
          nodeType: tItem.file.nodeType,
          homeX: x,
          homeY: y,
          x,
          y,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
          r: Math.min(11, 6.4 + Math.sqrt(tItem.degree) * 0.48),
          degree: tItem.degree,
          isCenter: tItem.file.rel === activeRel,
        });
      });
    }

    // ORBIT 02 (Dedicated 360° Year Ring): Year Archives evenly spaced across full circle
    const yearWedgeMap = new Map<string, { center: number; span: number }>();
    if (hasYears) {
      const yStep = (Math.PI * 2) / yearItems.length;
      const yStart = -Math.PI / 2 + yStep / 2;
      yearItems.forEach((yItem, idx) => {
        const angle = yStart + yStep * idx;
        hubAngleMap.set(yItem.file.rel, angle);
        yearWedgeMap.set(yItem.file.rel, { center: angle, span: yStep * 0.84 });
        const x = cx + Math.cos(angle) * rYear;
        const y = cy + Math.sin(angle) * rYear;
        nodes.push({
          rel: yItem.file.rel,
          title: yItem.file.title,
          nodeType: yItem.file.nodeType,
          homeX: x,
          homeY: y,
          x,
          y,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
          r: Math.min(10.5, 6.2 + Math.sqrt(yItem.degree) * 0.56),
          degree: yItem.degree,
          isCenter: yItem.file.rel === activeRel,
        });
      });
    }

    // ORBIT 03 (Dedicated 360° Month Ring): Month Hubs fanned out cleanly outside their parent year's wedge
    if (hasMonths) {
      const monthsByYear = new Map<string, typeof monthItems>();
      const orphanMonths: typeof monthItems = [];
      for (const m of monthItems) {
        const parent = monthParentYearRel(m.file.rel);
        if (parent && yearWedgeMap.has(parent)) {
          const arr = monthsByYear.get(parent) ?? [];
          arr.push(m);
          monthsByYear.set(parent, arr);
        } else {
          orphanMonths.push(m);
        }
      }

      for (const [parentRel, group] of monthsByYear.entries()) {
        const wedge = yearWedgeMap.get(parentRel)!;
        group.forEach((mItem, idx) => {
          const t = group.length === 1 ? 0 : idx / (group.length - 1) - 0.5;
          const angle = wedge.center + t * wedge.span;
          const rOffset = group.length >= 6 ? (idx % 2 === 0 ? -13 : 15) : 0;
          const finalR = rMonth + rOffset;
          hubAngleMap.set(mItem.file.rel, angle);
          const x = cx + Math.cos(angle) * finalR;
          const y = cy + Math.sin(angle) * finalR;
          nodes.push({
            rel: mItem.file.rel,
            title: mItem.file.title,
            nodeType: mItem.file.nodeType,
            homeX: x,
            homeY: y,
            x,
            y,
            vx: 0,
            vy: 0,
            fx: null,
            fy: null,
            r: Math.min(8.2, 4.6 + Math.sqrt(mItem.degree) * 0.52),
            degree: mItem.degree,
            isCenter: mItem.file.rel === activeRel,
          });
        });
      }

      if (orphanMonths.length > 0) {
        nodes.push(
          ...placeOnRing(
            orphanMonths.map((m, i) => ({
              ...m,
              preferredAngle: (i / orphanMonths.length) * Math.PI * 2 - Math.PI / 2,
            })),
            cx,
            cy,
            rMonth,
            activeRel,
            true,
          ),
        );
      }
    }

    // ORBIT 04 (Outermost Ring, Largest Circumference): Original Review Cards & Leaf Days
    if (hasOuterCards) {
      const preferredOuterAngle = (rel: string, fallbackIdx: number, total: number): number => {
        const link = index.links[rel];
        if (!link) return (fallbackIdx / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
        let sx = 0;
        let sy = 0;
        let weight = 0;
        for (const peer of [...link.out, ...link.in]) {
          const ang = hubAngleMap.get(peer);
          if (ang !== undefined) {
            // Pull cards strongly toward their parent month/year sector across the full 360° ring
            const w = peer.startsWith("10-时间轴/") ? 3.2 : 0.8;
            sx += Math.cos(ang) * w;
            sy += Math.sin(ang) * w;
            weight += w;
          }
        }
        if (weight === 0) return (fallbackIdx / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
        return Math.atan2(sy / weight, sx / weight);
      };

      nodes.push(
        ...placeOnRing(
          outerLeaves.map((leaf, i) => ({
            ...leaf,
            preferredAngle: preferredOuterAngle(leaf.file.rel, i, outerLeaves.length),
          })),
          cx,
          cy,
          rCard,
          activeRel,
          true,
        ),
      );
    }

    const rings: Array<{ r: number; label: string; color: string }> = [];
    let orbitIdx = 1;
    const pushRing = (r: number, title: string) => {
      rings.push({
        r,
        label: `ORBIT 0${orbitIdx++} · ${title}`,
        color: "var(--graph-ring)",
      });
    };
    if (hasTopics) pushRing(rTopic, "主题星核环");
    if (hasYears) pushRing(rYear, "年度档案环");
    if (hasMonths) pushRing(rMonth, "月度时间索引");
    if (hasOuterCards) pushRing(rCard, "复盘原件卡片外环");
    guide = { kind: "rings", cx, cy, rings };
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
      const tA = nodeTypeByRel.get(n.rel);
      const tB = nodeTypeByRel.get(target);
      // Skip redundant "month -> overview" return-home shortcuts when the parent year hub is already shown
      // so the hierarchy stays crystal-clear: Overview -> Year -> Month -> Cards
      const monthRel =
        tA === "overview" && isMonthTimelineRel(target)
          ? target
          : tB === "overview" && isMonthTimelineRel(n.rel)
            ? n.rel
            : null;
      if (monthRel) {
        const parentYear = monthParentYearRel(monthRel);
        if (parentYear && shown.has(parentYear)) continue;
      }
      // Primary structural backbone edges (MOC -> Topic/Year -> Month) stay crisp;
      // cross-dimensional Topic <-> Year/Month and leaf Card edges stay subtle ambient until hovered/locked
      const isLeafEdge = tA === "card" || tB === "card";
      const isCrossTopicTimeline =
        (tA === "topic" && tB === "timeline") || (tB === "topic" && tA === "timeline");
      edges.push({
        from: n.rel,
        to: target,
        direction: "peer",
        structural: !isLeafEdge && !isCrossTopicTimeline,
      });
    }
  }

  return { nodes, edges, guide, totalFiltered };
}

function curvedEdgePath(ax: number, ay: number, bx: number, by: number, seed: number): string {
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist < 12) return `M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)}`;
  const bend = Math.min(24, dist * 0.085) * (seed % 2 === 0 ? 1 : -1);
  const cx = mx - (dy / dist) * bend;
  const cy = my + (dx / dist) * bend;
  return `M ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

export default function ObsidianGraph({
  index,
  activeRel,
  mode = "local",
  onSelectNode,
  onToggleExpand,
  selectedRel,
  onInspectNode,
  immersive = false,
  leftHeaderSlot,
  rightPanelOpen = false,
  bottomClearance = false,
}: {
  index: VaultIndex | null;
  activeRel: string;
  mode?: "local" | "global";
  onSelectNode: (rel: string) => void;
  onToggleExpand?: () => void;
  selectedRel?: string | null;
  onInspectNode?: (rel: string | null) => void;
  immersive?: boolean;
  leftHeaderSlot?: React.ReactNode;
  rightPanelOpen?: boolean;
  bottomClearance?: boolean;
}) {
  const width = mode === "global" ? 1180 : 300;
  const height = mode === "global" ? 900 : 245;

  const [layoutMode, setLayoutMode] = useState<LayoutMode>("orbital");
  const [densityMode, setDensityMode] = useState<GraphDensityMode>("skeleton");
  const [hoveredRel, setHoveredRel] = useState<string | null>(null);
  const [lockedRel, setLockedRel] = useState<string | null>(selectedRel ?? null);
  const [draggingRel, setDraggingRel] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<VaultNodeType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(false);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const userToggledLabelsRef = useRef(false);
  const userToggledDensityRef = useRef(false);
  const lastClickRef = useRef<{ rel: string; at: number } | null>(null);

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
      if (e.key === "Escape") {
        setLockedRel(null);
        onInspectNode?.(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onInspectNode]);

  // Keep locked node synced when caller externally selects/clears a node (e.g. neighbor hopping from preview drawer)
  useEffect(() => {
    if (selectedRel === undefined) return;
    setLockedRel(selectedRel);
    if (!selectedRel) return;
    const node = nodesRef.current.find((n) => n.rel === selectedRel);
    if (!node) return;
    setTransform((prev) => {
      const targetK = Math.max(prev.k, 1.04);
      const targetCenterX = rightPanelOpen ? width * 0.39 : width * 0.5;
      const targetCenterY = height * 0.48;
      return {
        k: targetK,
        x: targetCenterX - node.x * targetK,
        y: targetCenterY - node.y * targetK,
      };
    });
  }, [selectedRel, width, height, rightPanelOpen]);

  const startLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    let settledFrames = 0;

    const step = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      if (nodes.length === 0) {
        rafRef.current = null;
        return;
      }

      const { archPull: kHome, damping: damp, springPull: kEdge } = physicsRef.current;
      const byRel = new Map<string, SimNode>(nodes.map((n) => [n.rel, n]));
      const minSpacing = mode === "global" ? (nodes.length > 90 ? 44 : 68) : 34;

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
      settledFrames++;

      if (dragNodeRef.current || (kineticEnergy > 0.04 && settledFrames < 180)) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, [mode]);

  useEffect(() => {
    if (!index || userToggledDensityRef.current) return;
    setDensityMode(index.counts.total > 30 ? "skeleton" : "full");
  }, [index]);

  useEffect(() => {
    const topo = buildGraphTopology(index, activeRel, mode, layoutMode, width, height, filterType, densityMode);
    nodesRef.current = topo.nodes;
    edgesRef.current = topo.edges;
    guideRef.current = topo.guide;
    setTotalFiltered(topo.totalFiltered);
    if (!userToggledLabelsRef.current) {
      setShowAllLabels(mode === "global" && topo.nodes.length <= 42);
    }
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
  }, [index, activeRel, mode, layoutMode, width, height, filterType, densityMode, defaultTransform, startLoop]);

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

      if (!moved) {
        if (onInspectNode) {
          const now = Date.now();
          const prevClick = lastClickRef.current;
          if (prevClick && prevClick.rel === rel && now - prevClick.at < 360) {
            lastClickRef.current = null;
            onInspectNode(null);
            setLockedRel(null);
            onSelectNode(rel);
          } else {
            lastClickRef.current = { rel, at: now };
            setLockedRel(rel);
            onInspectNode(rel);
          }
        } else if (lockedRel && lockedCluster?.has(rel)) {
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
        onInspectNode?.(null);
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
    onInspectNode?.(null);
    setSearchQuery("");
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

  const trimmedSearch = searchQuery.trim().toLowerCase();
  const matchedNodes = trimmedSearch
    ? nodes.filter(
        (n) =>
          n.title.toLowerCase().includes(trimmedSearch) ||
          n.rel.toLowerCase().includes(trimmedSearch),
      )
    : [];
  const matchedSet = trimmedSearch ? new Set(matchedNodes.map((n) => n.rel)) : null;

  const focusNodeInView = (rel: string) => {
    const target = nodeMap.get(rel);
    if (!target) return;
    setLockedRel(rel);
    onInspectNode?.(rel);
    const targetK = Math.max(transformRef.current.k, 1.12);
    const cx = rightPanelOpen || Boolean(onInspectNode) ? width * 0.39 : width * 0.5;
    const cy = height * 0.48;
    setTransform({
      k: targetK,
      x: cx - target.x * targetK,
      y: cy - target.y * targetK,
    });
  };

  const isImmersiveGlobal = immersive && mode === "global";

  return (
    <div className="flex h-full flex-col">
      {/* Compact Header Bar (Local Graph or non-immersive Global Graph only) */}
      {!isImmersiveGlobal && (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)]/90 px-3 py-2 backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--ink)]">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] text-[var(--cyan)]">
            <Network className="h-4 w-4" />
          </span>
          <span className="tracking-wide">
            {mode === "global" ? "全息星轨双链图谱" : "局部神经星图"}
          </span>
          <span className="rounded border border-[var(--border)] bg-[var(--bg-deep)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--cyan)]">
            {mode === "global" && totalFiltered > nodes.length
              ? `${nodes.length} / ${totalFiltered} NODES`
              : `${nodes.length} NODES`}{" "}
            · {edges.length} LINKS
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
                  <Compass className="h-4 w-4" />
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
                  <Layers className="h-4 w-4" />
                  架构泳道
                </button>
              </div>

              {filterType === "all" && (
                <div
                  className="mr-1 inline-flex rounded border border-[var(--border)] bg-[var(--bg-deep)] p-0.5 text-[11px]"
                  title="骨架脉络仅展示总览/手册/主题/年/月枢纽；全量展开在外圈展示复盘原件卡片"
                >
                  <button
                    type="button"
                    onClick={() => {
                      userToggledDensityRef.current = true;
                      setDensityMode("skeleton");
                    }}
                    className={`rounded px-2 py-0.5 transition ${
                      densityMode === "skeleton"
                        ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                        : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    骨架脉络
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      userToggledDensityRef.current = true;
                      setDensityMode("full");
                    }}
                    className={`rounded px-2 py-0.5 transition ${
                      densityMode === "full"
                        ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                        : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    全量展开
                  </button>
                </div>
              )}

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
            <ZoomIn className="h-[15px] w-[15px]" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.84)}
            title="缩小"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
          >
            <ZoomOut className="h-[15px] w-[15px]" />
          </button>
          <button
            type="button"
            onClick={resetArchitecture}
            title="重置视角并解除锁定"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
          >
            <RotateCcw className="h-[15px] w-[15px]" />
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
              <SlidersHorizontal className="h-[15px] w-[15px]" />
            </button>
          )}

          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              title={mode === "global" ? "返回阅读视图" : "展开全息星轨图谱"}
              className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
            >
              {mode === "global" ? <Minimize2 className="h-[15px] w-[15px]" /> : <Maximize2 className="h-[15px] w-[15px]" />}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Interactive Constellation Canvas */}
      <div className="obsidian-graph-bg relative flex-1 overflow-hidden">
        {/* Immersive Floating Glass HUD: Top-Left (Directory Toggle + Pulse + Instant Node Search) */}
        {isImmersiveGlobal && (
          <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
            {leftHeaderSlot}
            <div className="tl-glass-hud flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-[var(--cyan)]">
                <Network className="h-3.5 w-3.5" />
                {mode === "global" && totalFiltered > nodes.length ? `${nodes.length}/${totalFiltered}` : nodes.length} 节点 · {edges.length} 双链
              </span>
              <span className="h-3.5 w-px bg-[var(--border-strong)]" />
              <div className="relative flex items-center">
                <Search className="pointer-events-none h-3.5 w-3.5 text-[var(--ink-dim)]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matchedNodes[0]) {
                      e.preventDefault();
                      focusNodeInView(matchedNodes[0].rel);
                    }
                  }}
                  placeholder="定位节点 / 日期 / 概念..."
                  className="w-36 bg-transparent pl-1.5 pr-4 text-[11px] text-[var(--ink-strong)] placeholder:text-[var(--ink-dim)] focus:w-48 focus:outline-none transition-all sm:w-44"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-0 text-[var(--ink-dim)] hover:text-[var(--ink-strong)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {trimmedSearch && (
                <span className="rounded bg-[var(--amber-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--amber)]">
                  {matchedNodes.length} 命中
                </span>
              )}
            </div>
          </div>
        )}

        {/* Immersive Floating Glass HUD: Top-Right (Layout / Density / Zoom / Physics — shifts smoothly when drawer opens) */}
        {isImmersiveGlobal && (
          <div
            className={`tl-glass-hud absolute top-3 z-20 flex items-center gap-1 rounded-xl p-1 text-[11px] transition-all duration-200 ${
              rightPanelOpen ? "right-[404px]" : "right-3"
            }`}
          >
            <div className="inline-flex rounded-lg bg-[var(--bg-deep)]/75 p-0.5">
              <button
                type="button"
                onClick={() => setLayoutMode("orbital")}
                title="四环星轨布局"
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition ${
                  layoutMode === "orbital"
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                <Compass className="h-3.5 w-3.5" />
                <span className="hidden md:inline">星轨</span>
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode("layered")}
                title="四列演进泳道"
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition ${
                  layoutMode === "layered"
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden md:inline">泳道</span>
              </button>
            </div>

            {filterType === "all" && (
              <div className="hidden rounded-lg bg-[var(--bg-deep)]/75 p-0.5 sm:inline-flex">
                <button
                  type="button"
                  onClick={() => {
                    userToggledDensityRef.current = true;
                    setDensityMode("skeleton");
                  }}
                  className={`rounded-md px-2 py-1 transition ${
                    densityMode === "skeleton"
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  骨架
                </button>
                <button
                  type="button"
                  onClick={() => {
                    userToggledDensityRef.current = true;
                    setDensityMode("full");
                  }}
                  className={`rounded-md px-2 py-1 transition ${
                    densityMode === "full"
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  全量
                </button>
              </div>
            )}

            <span className="mx-0.5 h-3.5 w-px bg-[var(--border-strong)]" />

            <button
              type="button"
              onClick={() => zoomBy(1.2)}
              title="放大"
              className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(0.84)}
              title="缩小"
              className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={resetArchitecture}
              title="重置视角"
              className="rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              title="阻尼力场与标签参数"
              className={`rounded-lg p-1.5 transition ${
                showSettings
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
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
                <stop offset="0%" stopColor="rgba(91,155,255,0.2)" />
                <stop offset="52%" stopColor="rgba(45,212,191,0.08)" />
                <stop offset="100%" stopColor="rgba(8,10,15,0)" />
              </radialGradient>
            </defs>

            <g className={mode === "global" ? "tl-graph-bloom" : undefined}>
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
              {/* Ambient Holographic Orbital Architecture Guides */}
              {guide?.kind === "rings" && (
                <g className="pointer-events-none">
                  {mode === "global" && (
                    <circle cx={guide.cx} cy={guide.cy} r={280} fill="url(#core-nebula)" opacity={0.85} />
                  )}
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
                          y={guide.cy - ring.r - 7}
                          textAnchor="middle"
                          fill="var(--ink-dim)"
                          fontSize={9.5}
                          fontFamily="monospace"
                          letterSpacing={1.8}
                          paintOrder="stroke"
                          stroke="var(--graph-bg)"
                          strokeWidth={4}
                          strokeLinejoin="round"
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

              {/* Curved Gravitational Energy Edges */}
              <g>
                {edges.map((e, i) => {
                  const a = nodeMap.get(e.from);
                  const b = nodeMap.get(e.to);
                  if (!a || !b) return null;
                  const highlighted = Boolean(focusRel && (e.from === focusRel || e.to === focusRel));
                  const dimmed = Boolean(focusRel && !highlighted) || Boolean(matchedSet && !matchedSet.has(e.from) && !matchedSet.has(e.to));
                  const d = curvedEdgePath(a.x, a.y, b.x, b.y, i);

                  return (
                    <g key={`${e.from}-${e.to}-${i}`}>
                      <path
                        d={d}
                        fill="none"
                        stroke={
                          highlighted
                            ? "var(--graph-edge-active)"
                            : e.direction === "out"
                              ? "var(--graph-node-overview)"
                              : e.direction === "in"
                                ? "var(--graph-node-manual)"
                                : e.structural
                                  ? "var(--graph-edge-structural)"
                                  : "var(--graph-edge)"
                        }
                        strokeWidth={(highlighted ? 2.15 : e.structural ? 1.3 : 0.85) / Math.sqrt(transform.k)}
                        opacity={dimmed ? 0.06 : highlighted ? 0.92 : e.structural ? 0.65 : 0.16}
                      />
                      {highlighted && (
                        <path
                          d={d}
                          fill="none"
                          stroke="var(--cyan)"
                          strokeWidth={1.65 / Math.sqrt(transform.k)}
                          opacity={0.9}
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
                  const isSearchHit = Boolean(matchedSet?.has(n.rel));
                  const isHub =
                    n.nodeType === "overview" ||
                    n.nodeType === "manual" ||
                    (n.nodeType === "topic" && n.degree >= 3);
                  const dimmed =
                    (Boolean(connectedToFocus) && !connectedToFocus!.has(n.rel)) ||
                    (Boolean(matchedSet) && !isSearchHit);
                  const fill = n.isCenter ? "var(--graph-node-overview)" : NODE_COLORS[n.nodeType];
                  const glow = n.isCenter ? NODE_GLOW.overview : NODE_GLOW[n.nodeType];

                  const showLabel =
                    showAllLabels ||
                    n.isCenter ||
                    isFocused ||
                    isInLockedSubgraph ||
                    isSearchHit ||
                    transform.k >= 1.28 ||
                    (mode === "local"
                      ? nodes.length <= 14
                      : nodes.length > 42
                        ? n.nodeType === "overview" ||
                          n.nodeType === "manual" ||
                          n.nodeType === "topic" ||
                          isYearTimelineRel(n.rel)
                        : n.nodeType !== "timeline" || isYearTimelineRel(n.rel) || n.degree >= 4);

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
                      {/* Search Hit Ring */}
                      {isSearchHit && (
                        <circle
                          r={n.r + 10}
                          fill="none"
                          stroke="var(--amber)"
                          strokeWidth={1.6}
                          strokeDasharray="4 3"
                          className="pointer-events-none"
                        />
                      )}

                      {/* Subtle Luminous Halo on Hub Nodes */}
                      {isHub && !isLockedAnchor && (
                        <circle r={n.r + 7.5} fill={glow} opacity={0.34} className="pointer-events-none" />
                      )}

                      {/* Pulsing Lock Target Reticle */}
                      {isLockedAnchor && (
                        <g className="pointer-events-none">
                          <circle
                            r={n.r + 13}
                            fill="none"
                            stroke="var(--cyan)"
                            strokeWidth={1.4}
                            strokeDasharray="5 4"
                            className="tl-pulse-ring"
                          />
                          <circle r={n.r + 8} fill={glow} opacity={0.44} />
                        </g>
                      )}

                      {/* Highlighted neighbor ring */}
                      {!isLockedAnchor && isInLockedSubgraph && (
                        <circle
                          r={n.r + 5.5}
                          fill="none"
                          stroke="var(--graph-edge-active)"
                          strokeWidth={1.1}
                          opacity={0.85}
                          className="pointer-events-none"
                        />
                      )}

                      {/* Ambient aura on hover/focus */}
                      {(n.isCenter || isFocused || isInLockedSubgraph) && (
                        <circle r={n.r + 5.5} fill={glow} opacity={0.34} className="pointer-events-none" />
                      )}

                      {/* Core Node Sphere */}
                      <circle
                        r={isLockedAnchor ? n.r + 3.5 : isFocused ? n.r + 2.6 : isHub ? n.r + 2.1 : n.r + 1.6}
                        fill={fill}
                        stroke={isLockedAnchor ? "var(--cyan)" : "var(--graph-bg)"}
                        strokeWidth={isLockedAnchor ? 2.4 : 1.8}
                      />

                      {showLabel && (
                        <text
                          y={n.r + (mode === "global" ? 17 : 13.5)}
                          textAnchor="middle"
                          fill={
                            isLockedAnchor
                              ? "var(--cyan)"
                              : isSearchHit
                                ? "var(--amber)"
                                : isFocused || isInLockedSubgraph || n.isCenter
                                  ? "var(--graph-label-strong)"
                                  : "var(--graph-label)"
                          }
                          fontSize={(mode === "global" ? 11.4 : 9.8) / Math.pow(transform.k, 0.35)}
                          fontWeight={isLockedAnchor || isFocused || n.isCenter || isSearchHit ? 500 : 300}
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
            </g>
          </svg>
        )}

        {/* Legacy Mini Locked-Node HUD (Only when caller does NOT provide a Slide-Over Preview Drawer) */}
        {lockedNode && !onInspectNode && (
          <div className="absolute left-3 top-3 max-w-[300px] rounded-lg border border-[var(--cyan)]/45 bg-[var(--bg-deep)] p-3 text-xs backdrop-blur-md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--cyan)]">
                  <Lock className="h-4 w-4" />
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
                <X className="h-[15px] w-[15px]" />
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
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Damped Push-Pull Physics Tuning Popover */}
        {mode === "global" && showSettings && (
          <div
            className={`tl-glass-hud absolute z-30 w-60 space-y-3 rounded-xl p-3.5 text-xs ${
              isImmersiveGlobal
                ? rightPanelOpen
                  ? "right-[404px] top-14"
                  : "right-3 top-14"
                : "right-3 top-3"
            }`}
          >
            <div className="flex items-center justify-between font-semibold text-[var(--ink)]">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-[15px] w-[15px] text-[var(--cyan)]" />
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
                onChange={(e) => {
                  userToggledLabelsRef.current = true;
                  setShowAllLabels(e.target.checked);
                }}
                className="accent-[var(--cyan)]"
              />
            </label>
          </div>
        )}

        {/* Bottom HUD: Interactive Filter-Legend Pill */}
        {isImmersiveGlobal ? (
          <div
            className={`absolute left-3 z-10 flex flex-wrap items-center gap-2 transition-all ${
              bottomClearance ? "bottom-20 sm:bottom-4" : "bottom-3.5"
            }`}
          >
            <div className="tl-glass-hud flex flex-wrap items-center gap-1 rounded-xl px-2 py-1.5 text-[11px]">
              {(["all", "card", "topic", "timeline", "manual"] as const).map((t) => {
                const active = filterType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFilterType(t)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition ${
                      active
                        ? "bg-[var(--surface-2)] font-semibold text-[var(--ink-strong)] ring-1 ring-[var(--border-strong)]"
                        : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)]/60 hover:text-[var(--ink)]"
                    }`}
                  >
                    {t !== "all" && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: NODE_COLORS[t], boxShadow: `0 0 8px ${NODE_GLOW[t]}` }}
                      />
                    )}
                    {t === "all" ? "全部" : NODE_LABELS[t]}
                  </button>
                );
              })}
            </div>
            {!bottomClearance && (
              <div className="tl-glass-hud pointer-events-none hidden rounded-xl px-3 py-1.5 text-[10px] text-[var(--ink-muted)] xl:block">
                单击节点侧滑预览 · 双击进入完整阅读 · 拖拽节点推拉 · 滚轮缩放
              </div>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
