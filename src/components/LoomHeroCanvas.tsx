"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CandlestickChart,
  FileText,
  Layers,
  Network,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { LedgerDailySnapshot, MonthlyQuantSummary } from "@/lib/ledger-analytics";
import type { SynthesisReport } from "@/lib/synthesis";
import type { VaultDoc, VaultIndex } from "@/lib/vault-builder";

export type HeroLedgerLite = {
  hasData: boolean;
  benchmarkName?: string;
  monthly?: MonthlyQuantSummary[];
  dailyByDate?: Record<string, LedgerDailySnapshot>;
};

type TimelinePoint = {
  date: string;
  docs: VaultDoc[];
  ledger?: LedgerDailySnapshot;
  value: number; // cumReturnPct if ledger exists, else cumulative docs/concept signal
  hasTrades: boolean;
};

type Props = {
  vault: VaultIndex | null;
  ledger: HeroLedgerLite | null;
  latestManual: SynthesisReport | null;
  accentColor: string;
  skipLedgerStep?: boolean;
};

function fmtSignedPct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "--";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function LoomHeroCanvas({
  vault,
  ledger,
  latestManual,
  accentColor,
  skipLedgerStep,
}: Props) {
  const hasLedgerCurve = useMemo(() => {
    return Boolean(ledger?.hasData && ledger.dailyByDate && Object.keys(ledger.dailyByDate).length > 0);
  }, [ledger]);

  const points = useMemo<TimelinePoint[]>(() => {
    const docsByDate = new Map<string, VaultDoc[]>();
    for (const d of vault?.documents ?? []) {
      if (!d.event_date) continue;
      const arr = docsByDate.get(d.event_date) ?? [];
      arr.push(d);
      docsByDate.set(d.event_date, arr);
    }

    const dailyMap = ledger?.dailyByDate ?? {};
    const allDates = new Set<string>([...docsByDate.keys(), ...Object.keys(dailyMap)]);
    const sortedDates = [...allDates].sort((a, b) => a.localeCompare(b));

    if (sortedDates.length === 0) return [];

    // Downsample evenly only if huge (>180 points), while always preserving review/trade milestones and endpoints
    let pickedDates = sortedDates;
    if (sortedDates.length > 180) {
      const step = Math.ceil(sortedDates.length / 140);
      pickedDates = sortedDates.filter((dt, idx) => {
        if (idx === 0 || idx === sortedDates.length - 1) return true;
        if (docsByDate.has(dt)) return true;
        if ((dailyMap[dt]?.trades?.length ?? 0) > 0) return true;
        return idx % step === 0;
      });
    }

    let runningDocs = 0;
    let lastNavReturn = 0;
    return pickedDates.map((date) => {
      const docs = docsByDate.get(date) ?? [];
      const snap = dailyMap[date];
      runningDocs += docs.length;
      if (snap && Number.isFinite(snap.cumReturnPct)) {
        lastNavReturn = snap.cumReturnPct;
      }
      return {
        date,
        docs,
        ledger: snap,
        value: hasLedgerCurve ? lastNavReturn : runningDocs,
        hasTrades: (snap?.trades?.length ?? 0) > 0,
      };
    });
  }, [vault, ledger, hasLedgerCurve]);

  const defaultSelectedIdx = useMemo(() => {
    if (points.length === 0) return -1;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].docs.length > 0 && points[i].hasTrades) return i;
    }
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].docs.length > 0) return i;
    }
    return points.length - 1;
  }, [points]);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const activeIdx =
    hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < points.length ? hoveredIdx : defaultSelectedIdx;
  const activePoint = activeIdx >= 0 ? points[activeIdx] : null;

  // Geometry for SVG timeline curve
  const W = 720;
  const H = 228;
  const PAD_L = 42;
  const PAD_R = 18;
  const PAD_T = 22;
  const PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const geom = useMemo(() => {
    if (points.length === 0) return null;
    const vals = points.map((p) => p.value);
    const minRaw = hasLedgerCurve ? Math.min(0, ...vals) : 0;
    const maxRaw = Math.max(hasLedgerCurve ? 1 : 1, ...vals);
    const pad = hasLedgerCurve ? Math.max(1.5, (maxRaw - minRaw) * 0.14) : Math.max(1, maxRaw * 0.12);
    const yMin = hasLedgerCurve ? minRaw - pad * 0.45 : 0;
    const yMax = maxRaw + pad;
    const ySpan = Math.max(yMax - yMin, 1);

    const xOf = (i: number) =>
      points.length === 1 ? PAD_L + plotW / 2 : PAD_L + (i / (points.length - 1)) * plotW;
    const yOf = (v: number) => PAD_T + ((yMax - v) / ySpan) * plotH;

    const linePath = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`)
      .join(" ");
    const baseY = yOf(hasLedgerCurve ? 0 : 0);
    const clampedBaseY = Math.min(PAD_T + plotH, Math.max(PAD_T, baseY));
    const areaPath =
      points.length === 1
        ? ""
        : `${linePath} L${xOf(points.length - 1).toFixed(1)},${clampedBaseY.toFixed(1)} L${xOf(0).toFixed(1)},${clampedBaseY.toFixed(1)} Z`;

    return { xOf, yOf, linePath, areaPath, zeroY: clampedBaseY, yMin, yMax };
  }, [points, hasLedgerCurve, plotW, plotH]);

  // Mini orbital constellation nodes for top topics
  const miniConstellation = useMemo(() => {
    const topics = (vault?.topics ?? []).slice(0, 7);
    const docs = vault?.documents ?? [];
    const counted = topics.map((t) => ({
      topic: t,
      count: docs.filter((d) => d.tags.includes(t) || d.auto_concepts.includes(t)).length,
    }));
    const cx = 110;
    const cy = 62;
    return counted.map((item, idx) => {
      const angle = -Math.PI / 2 + (idx / Math.max(counted.length, 1)) * Math.PI * 2;
      const rx = idx % 2 === 0 ? 74 : 56;
      const ry = idx % 2 === 0 ? 44 : 35;
      return {
        ...item,
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
      };
    });
  }, [vault]);

  const firstRule = latestManual?.manual?.[0] ?? null;
  const firstStage = latestManual?.timeline?.[latestManual.timeline.length - 1] ?? null;
  const primaryDoc = activePoint?.docs?.[0] ?? null;
  const dateRangeLabel =
    points.length > 0 ? `${points[0].date} — ${points[points.length - 1].date}` : "等待导入带日期的复盘笔记";

  const totalNodesCount = vault?.counts.total ?? 0;
  const totalLinksCount = vault?.counts.links ?? 0;

  return (
    <section className="tl-hero-canvas relative overflow-hidden rounded-2xl">
      <div className="pointer-events-none absolute -top-24 left-1/3 h-64 w-96 -translate-x-1/2 rounded-full bg-[var(--hero-glow)] blur-3xl" />

      {/* Top Canvas Header */}
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
          <span className="text-xs font-semibold tracking-tight text-[var(--ink-strong)]">
            三线织脉画布 · 复盘 × 实盘 × 规则
          </span>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
            {dateRangeLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-[var(--ink-muted)]">
            <span className="h-2 w-2 rounded-full bg-[var(--hero-review-pin)]" />
            复盘节点
          </span>
          {hasLedgerCurve && (
            <span className="inline-flex items-center gap-1.5 text-[var(--ink-muted)]">
              <span className="h-2 w-2 rounded-full bg-[var(--hero-trade-pin)]" />
              实盘买卖共振
            </span>
          )}
          <Link
            href="/vault?view=graph"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Network className="h-3.5 w-3.5 text-[var(--accent)]" />
            打开全屏星图
          </Link>
        </div>
      </div>

      {/* Main Split Canvas */}
      <div className="relative grid lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.95fr)]">
        {/* Left: Interactive Loom Timeline Curve */}
        <div className="border-b border-[var(--border)] p-4 lg:border-r lg:border-b-0 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] text-[var(--ink-muted)]">
              <TrendingUp className="h-3.5 w-3.5 text-[var(--accent)]" />
              {hasLedgerCurve ? (
                <span>
                  累计净值收益率 × 复盘锚点
                  {ledger?.benchmarkName ? ` · 基准 ${ledger.benchmarkName}` : ""}
                </span>
              ) : (
                <span>复盘脉络势能曲线 · 悬停节点切片</span>
              )}
            </div>
            {!hasLedgerCurve && !skipLedgerStep && (
              <Link href="/ledger" className="text-[11px] text-[var(--accent)] hover:underline">
                + 叠加实盘账本 →
              </Link>
            )}
          </div>

          {points.length > 0 && geom ? (
            <div className="relative">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="h-[220px] w-full select-none overflow-visible"
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <defs>
                  <linearGradient id="tlHeroAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--hero-curve)" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="var(--hero-curve)" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {/* Subtle horizontal guides */}
                {[0.25, 0.5, 0.75].map((ratio) => {
                  const gy = PAD_T + plotH * ratio;
                  return (
                    <line
                      key={ratio}
                      x1={PAD_L}
                      y1={gy}
                      x2={W - PAD_R}
                      y2={gy}
                      stroke="var(--chart-grid)"
                      strokeDasharray="3 4"
                    />
                  );
                })}

                {hasLedgerCurve && (
                  <line
                    x1={PAD_L}
                    y1={geom.zeroY}
                    x2={W - PAD_R}
                    y2={geom.zeroY}
                    stroke="var(--border-strong)"
                    strokeWidth="1"
                  />
                )}

                {/* Area & Main Curve */}
                {geom.areaPath && <path d={geom.areaPath} fill="url(#tlHeroAreaGrad)" />}
                <path
                  d={geom.linePath}
                  fill="none"
                  stroke="var(--hero-curve)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Active Scrub Line */}
                {activeIdx >= 0 && (
                  <line
                    x1={geom.xOf(activeIdx)}
                    y1={PAD_T - 4}
                    x2={geom.xOf(activeIdx)}
                    y2={H - PAD_B + 4}
                    stroke="var(--accent)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity="0.7"
                  />
                )}

                {/* Review & Trade Nodes */}
                {points.map((pt, i) => {
                  const hasReview = pt.docs.length > 0;
                  const isActive = i === activeIdx;
                  if (!hasReview && !pt.hasTrades && !isActive) return null;
                  const cx = geom.xOf(i);
                  const cy = geom.yOf(pt.value);
                  const fill = pt.hasTrades ? "var(--hero-trade-pin)" : "var(--hero-review-pin)";
                  return (
                    <g key={pt.date}>
                      {(isActive || (hasReview && pt.hasTrades)) && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isActive ? 9 : 6.5}
                          fill={fill}
                          opacity={isActive ? 0.22 : 0.14}
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isActive ? 4.5 : pt.hasTrades ? 3.5 : 2.8}
                        fill={fill}
                        stroke="var(--surface)"
                        strokeWidth="1.5"
                      />
                    </g>
                  );
                })}

                {/* Invisible wide hover scrub columns */}
                {points.map((pt, i) => {
                  const x = geom.xOf(i);
                  const prevX = i === 0 ? PAD_L : (geom.xOf(i - 1) + x) / 2;
                  const nextX = i === points.length - 1 ? W - PAD_R : (x + geom.xOf(i + 1)) / 2;
                  return (
                    <rect
                      key={`hit-${pt.date}`}
                      x={prevX}
                      y={PAD_T - 6}
                      width={Math.max(4, nextX - prevX)}
                      height={plotH + 18}
                      fill="transparent"
                      className="cursor-crosshair"
                      onMouseEnter={() => setHoveredIdx(i)}
                      onClick={() => setHoveredIdx(i)}
                    />
                  );
                })}

                {/* Axis Labels */}
                <text x={PAD_L - 6} y={PAD_T + 4} textAnchor="end" className="fill-[var(--ink-dim)] font-mono text-[10px]">
                  {hasLedgerCurve ? fmtSignedPct(geom.yMax) : `${Math.round(geom.yMax)}篇`}
                </text>
                <text x={PAD_L - 6} y={H - PAD_B} textAnchor="end" className="fill-[var(--ink-dim)] font-mono text-[10px]">
                  {hasLedgerCurve ? fmtSignedPct(geom.yMin) : "0"}
                </text>
                <text x={PAD_L} y={H - 8} textAnchor="start" className="fill-[var(--ink-dim)] font-mono text-[10px]">
                  {points[0].date}
                </text>
                {points.length > 2 && (
                  <text
                    x={PAD_L + plotW / 2}
                    y={H - 8}
                    textAnchor="middle"
                    className="fill-[var(--ink-dim)] font-mono text-[10px]"
                  >
                    {points[Math.floor(points.length / 2)].date}
                  </text>
                )}
                <text
                  x={W - PAD_R}
                  y={H - 8}
                  textAnchor="end"
                  className="fill-[var(--ink-dim)] font-mono text-[10px]"
                >
                  {points[points.length - 1].date}
                </text>
              </svg>
            </div>
          ) : (
            <div className="flex h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-elevated)] text-center">
              <Sparkles className="h-5 w-5 text-[var(--accent)]" />
              <p className="mt-2 text-xs font-medium text-[var(--ink-strong)]">还没有带日期的复盘节点</p>
              <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                导入复盘或从 9 大云端平台同步后，这里会自动织出时间轴与实盘联动曲线
              </p>
              <Link
                href="/vault"
                className="mt-3 rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent)]"
              >
                导入第 1 批复盘 →
              </Link>
            </div>
          )}
        </div>

        {/* Right: Live Cross-Section Inspector + Mini Orbital Constellation */}
        <div className="flex flex-col justify-between divide-y divide-[var(--border)] bg-[var(--surface-elevated)]">
          {/* Active Slice */}
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                当期织脉切片
              </span>
              {activePoint && (
                <span className="rounded bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[11px] font-medium text-[var(--ink-strong)]">
                  {activePoint.date}
                </span>
              )}
            </div>

            {activePoint ? (
              <div className="mt-3 space-y-2.5">
                {primaryDoc ? (
                  <Link
                    href={`/vault?card=${encodeURIComponent(primaryDoc.card)}`}
                    className="group block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 transition hover:border-[var(--accent)]/60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                        <span className="truncate text-xs font-semibold text-[var(--ink-strong)] group-hover:text-[var(--accent)]">
                          {primaryDoc.title}
                        </span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-dim)] transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
                    </div>
                    {(primaryDoc.tags.length > 0 || primaryDoc.auto_concepts.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {[...new Set([...primaryDoc.tags, ...primaryDoc.auto_concepts])].slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)]"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--ink-dim)]">
                    该交易日暂无对应复盘笔记
                  </div>
                )}

                {activePoint.ledger && (
                  <Link
                    href="/ledger"
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[11px] transition hover:border-[var(--hero-trade-pin)]/60"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ink-strong)]">
                      <CandlestickChart className="h-3.5 w-3.5 text-[var(--hero-trade-pin)]" />
                      净值 {activePoint.ledger.nav.toFixed(3)} · 日{fmtSignedPct(activePoint.ledger.dailyReturnPct)}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                      {activePoint.ledger.trades.length > 0
                        ? `${activePoint.ledger.trades.length} 笔交割`
                        : `累计 ${fmtSignedPct(activePoint.ledger.cumReturnPct)}`}
                    </span>
                  </Link>
                )}
              </div>
            ) : (
              <p className="mt-2.5 text-xs text-[var(--ink-dim)]">暂无切片数据</p>
            )}
          </div>

          {/* Mini Constellation & Latest Rule Preview */}
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[var(--ink-strong)]">
                {firstRule ? "最新法则摘录" : "知识星图缩影"}
              </span>
              <Link
                href={firstRule ? "/manuals" : "/synthesize"}
                className="text-[11px] text-[var(--accent)] hover:underline"
              >
                {firstRule ? "全部手册 →" : "去提炼手册 →"}
              </Link>
            </div>

            {firstRule ? (
              <div className="mt-2.5 space-y-2">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-strong)]">
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--emerald)]" />
                    <span className="truncate">{firstRule.title}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--ink-muted)]">
                    {firstRule.condition || firstRule.action || firstStage?.change}
                  </p>
                </div>
              </div>
            ) : (
              <Link
                href="/vault?view=graph"
                className="group mt-2 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 transition hover:border-[var(--accent)]/50"
              >
                <svg viewBox="0 0 220 124" className="h-[88px] w-[160px] shrink-0">
                  <circle cx="110" cy="62" r="36" fill="none" stroke="var(--graph-ring)" strokeDasharray="2 3" />
                  <circle cx="110" cy="62" r="56" fill="none" stroke="var(--graph-ring)" strokeDasharray="2 4" opacity="0.6" />
                  {miniConstellation.map((node) => (
                    <g key={node.topic}>
                      <line
                        x1="110"
                        y1="62"
                        x2={node.x}
                        y2={node.y}
                        stroke="var(--graph-edge)"
                        strokeWidth="1"
                      />
                      <circle cx={node.x} cy={node.y} r="4" fill="var(--graph-node-topic)" />
                      <text
                        x={node.x}
                        y={node.y + (node.y < 62 ? -7 : 11)}
                        textAnchor="middle"
                        className="fill-[var(--ink-muted)] text-[8px]"
                      >
                        {node.topic.slice(0, 5)}
                      </text>
                    </g>
                  ))}
                  <circle cx="110" cy="62" r="7" fill={accentColor} />
                </svg>
                <div className="min-w-0 text-right">
                  <div className="font-mono text-xs font-semibold text-[var(--ink-strong)]">
                    {totalNodesCount} 节点 / {totalLinksCount} 连线
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--accent)] group-hover:underline">
                    <Layers className="h-3 w-3" />
                    进入四环星图
                  </div>
                </div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
