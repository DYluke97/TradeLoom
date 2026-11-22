"use client";

import Link from "next/link";
import { FileText, AlertTriangle, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import type { EquityPoint, MonthlyQuantSummary } from "@/lib/ledger-analytics";

export type ReviewRef = { card: string; title: string; kind: string };

function fmtPct(v: number | undefined | null, signed = true): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "--";
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export default function EquityCurveChart({
  points,
  monthly,
  benchmarkName,
  colorScheme,
  reviewsByDate,
  onSelectDateForReview,
}: {
  points: EquityPoint[];
  monthly: MonthlyQuantSummary[];
  benchmarkName: string;
  colorScheme: "cn" | "global";
  reviewsByDate: Record<string, ReviewRef[]>;
  onSelectDateForReview?: (date: string) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showBenchmark, setShowBenchmark] = useState(true);
  const [showReviewDots, setShowReviewDots] = useState(true);

  const upColor = colorScheme === "cn" ? "#d64545" : "#157f57";
  const downColor = colorScheme === "cn" ? "#157f57" : "#d64545";
  const upText = colorScheme === "cn" ? "text-[var(--rose)]" : "text-[var(--emerald)]";
  const downText = colorScheme === "cn" ? "text-[var(--emerald)]" : "text-[var(--rose)]";

  const W = 960;
  const H_MAIN = 250;
  const H_DD = 74;
  const GAP = 18;
  const H_TOTAL = H_MAIN + GAP + H_DD + 26;
  const PAD_L = 56;
  const PAD_R = 20;
  const PAD_T = 18;
  const plotW = W - PAD_L - PAD_R;
  const mainH = H_MAIN - PAD_T - 12;
  const ddTop = H_MAIN + GAP;

  const geom = useMemo(() => {
    if (points.length === 0) return null;
    const vals: number[] = [0];
    for (const p of points) {
      vals.push(p.cumReturnPct);
      if (showBenchmark && p.benchmarkCumPct !== undefined) vals.push(p.benchmarkCumPct);
    }
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const pad = Math.max(2, (rawMax - rawMin) * 0.12);
    const yMin = rawMin - pad;
    const yMax = rawMax + pad;
    const ySpan = Math.max(yMax - yMin, 1);

    const ddMin = Math.min(-2, ...points.map((p) => p.drawdownPct));

    const xOf = (i: number) =>
      points.length === 1 ? PAD_L + plotW / 2 : PAD_L + (i / (points.length - 1)) * plotW;
    const yMain = (v: number) => PAD_T + ((yMax - v) / ySpan) * mainH;
    const yDd = (v: number) => ddTop + (Math.abs(Math.min(0, v)) / Math.abs(ddMin)) * H_DD;

    const acctPath = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yMain(p.cumReturnPct).toFixed(1)}`)
      .join(" ");
    const zeroY = yMain(0);
    const acctArea = `${acctPath} L${xOf(points.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${xOf(0).toFixed(1)},${zeroY.toFixed(1)} Z`;

    const benchCoords: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const bv = points[i].benchmarkCumPct;
      if (bv !== undefined) {
        benchCoords.push(`${benchCoords.length === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yMain(bv).toFixed(1)}`);
      }
    }
    const benchPath = benchCoords.join(" ");

    const ddLine = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yDd(p.drawdownPct).toFixed(1)}`)
      .join(" ");
    const ddArea = `${ddLine} L${xOf(points.length - 1).toFixed(1)},${ddTop.toFixed(1)} L${xOf(0).toFixed(1)},${ddTop.toFixed(1)} Z`;

    const yTicks: number[] = [];
    for (let k = 0; k <= 4; k++) {
      yTicks.push(yMin + (ySpan * k) / 4);
    }

    const xLabelStep = Math.max(1, Math.floor(points.length / 6));
    const xTicks: Array<{ idx: number; label: string; x: number }> = [];
    for (let i = 0; i < points.length; i += xLabelStep) {
      xTicks.push({ idx: i, label: points[i].date.slice(2), x: xOf(i) });
    }
    if (points.length > 1 && xTicks[xTicks.length - 1]?.idx !== points.length - 1) {
      xTicks.push({
        idx: points.length - 1,
        label: points[points.length - 1].date.slice(2),
        x: xOf(points.length - 1),
      });
    }

    return {
      xOf,
      yMain,
      yDd,
      zeroY,
      acctPath,
      acctArea,
      benchPath,
      ddLine,
      ddArea,
      yTicks,
      xTicks,
      ddMin,
    };
  }, [points, showBenchmark, plotW, mainH, ddTop]);

  const activeIdx = hoverIdx !== null && hoverIdx < points.length ? hoverIdx : points.length - 1;
  const activePt = points[activeIdx] ?? null;
  const activeReviews = activePt ? reviewsByDate[activePt.date] ?? [] : [];

  if (!geom || points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-deep)]/60 text-xs text-[var(--ink-dim)]">
        导入每日净值或手动录入首日收益率后，此处将自动绘制净值曲线、{benchmarkName}基准对比与回撤水下图
      </div>
    );
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W;
    const ratio = (relX - PAD_L) / Math.max(plotW, 1);
    const idx = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    setHoverIdx(idx);
  }

  return (
    <div className="space-y-4">
      {/* Interactive Readout HUD Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/90 px-3.5 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
          <span className="font-semibold text-[var(--ink)]">{activePt?.date}</span>
          <span>
            累计{" "}
            <strong className={(activePt?.cumReturnPct ?? 0) >= 0 ? upText : downText}>
              {fmtPct(activePt?.cumReturnPct)}
            </strong>
          </span>
          <span>
            当日{" "}
            <strong className={(activePt?.dailyReturnPct ?? 0) >= 0 ? upText : downText}>
              {fmtPct(activePt?.dailyReturnPct)}
            </strong>
          </span>
          <span className="text-[var(--ink-muted)]">净值 {activePt?.nav.toFixed(4)}</span>
          {activePt?.benchmarkCumPct !== undefined && (
            <span className="text-[var(--amber)]">
              {benchmarkName} {fmtPct(activePt.benchmarkCumPct)}
            </span>
          )}
          {activePt?.excessAlphaPct !== undefined && (
            <span className={activePt.excessAlphaPct >= 0 ? "text-[var(--cyan)]" : "text-[var(--amber)]"}>
              超额 {fmtPct(activePt.excessAlphaPct)}
            </span>
          )}
          <span className="text-[var(--rose)]">回撤 {fmtPct(activePt?.drawdownPct, false)}</span>
          {activePt?.positionPct !== undefined && (
            <span className={activePt.positionPct > 100 ? "text-[var(--amber)] font-semibold" : "text-[var(--ink-muted)]"}>
              仓位 {activePt.positionPct}%{activePt.positionPct > 100 ? " (含融)" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={showBenchmark}
              onChange={(e) => setShowBenchmark(e.target.checked)}
              className="accent-[var(--amber)]"
            />
            基准对比
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={showReviewDots}
              onChange={(e) => setShowReviewDots(e.target.checked)}
              className="accent-[var(--cyan)]"
            />
            复盘锚点
          </label>
        </div>
      </div>

      {/* Main Dual-Curve + Drawdown SVG */}
      <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--chart-bg)] p-2">
        <svg
          viewBox={`0 0 ${W} ${H_TOTAL}`}
          className="h-auto w-full select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="tl-acct-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="tl-dd-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--rose)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--rose)" stopOpacity="0.36" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid + Y Axis */}
          {geom.yTicks.map((t, i) => {
            const y = geom.yMain(t);
            return (
              <g key={i}>
                <line
                  x1={PAD_L}
                  y1={y}
                  x2={W - PAD_R}
                  y2={y}
                  stroke="var(--chart-grid)"
                  strokeDasharray="3 5"
                />
                <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fill="var(--chart-axis)" fontSize={10} fontFamily="monospace">
                  {t >= 0 ? `+${t.toFixed(0)}%` : `${t.toFixed(0)}%`}
                </text>
              </g>
            );
          })}

          {/* 0% Baseline */}
          <line x1={PAD_L} y1={geom.zeroY} x2={W - PAD_R} y2={geom.zeroY} stroke="var(--border-strong)" strokeWidth={1} />

          {/* Account Area & Curve */}
          <path d={geom.acctArea} fill="url(#tl-acct-area)" />
          {showBenchmark && geom.benchPath && (
            <path
              d={geom.benchPath}
              fill="none"
              stroke="var(--amber)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              opacity={0.85}
            />
          )}
          <path d={geom.acctPath} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" />

          {/* Review Note Anchor Markers & Missing-Review Big-Loss Alerts */}
          {showReviewDots &&
            points.map((p, i) => {
              const hasRev = (reviewsByDate[p.date]?.length ?? 0) > 0;
              const missedBigLoss = !hasRev && p.dailyReturnPct <= -3.0;
              if (!hasRev && !missedBigLoss) return null;
              const cx = geom.xOf(i);
              const cy = geom.yMain(p.cumReturnPct);
              return hasRev ? (
                <g key={p.date} className="cursor-pointer" onClick={() => onSelectDateForReview?.(p.date)}>
                  <polygon
                    points={`${cx},${cy - 5} ${cx + 4.5},${cy} ${cx},${cy + 5} ${cx - 4.5},${cy}`}
                    fill="var(--cyan)"
                    stroke="var(--chart-bg)"
                    strokeWidth={1.2}
                  />
                </g>
              ) : (
                <circle
                  key={p.date}
                  cx={cx}
                  cy={cy}
                  r={3.8}
                  fill="none"
                  stroke="var(--amber)"
                  strokeWidth={1.5}
                />
              );
            })}

          {/* Drawdown Subplot Header & Grid */}
          <line x1={PAD_L} y1={ddTop} x2={W - PAD_R} y2={ddTop} stroke="var(--border)" />
          <text x={PAD_L + 4} y={ddTop + 12} fill="var(--ink-muted)" fontSize={9.5} fontFamily="monospace">
            回撤水下图 (MDD {geom.ddMin.toFixed(1)}%)
          </text>
          <text x={PAD_L - 8} y={ddTop + 4} textAnchor="end" fill="var(--chart-axis)" fontSize={9.5} fontFamily="monospace">
            0%
          </text>
          <text x={PAD_L - 8} y={ddTop + H_DD} textAnchor="end" fill="var(--rose)" fontSize={9.5} fontFamily="monospace">
            {geom.ddMin.toFixed(0)}%
          </text>

          <path d={geom.ddArea} fill="url(#tl-dd-area)" />
          <path d={geom.ddLine} fill="none" stroke="var(--rose)" strokeWidth={1.3} opacity={0.85} />

          {/* X Axis Date Labels */}
          {geom.xTicks.map((t) => (
            <text
              key={t.idx}
              x={t.x}
              y={H_TOTAL - 6}
              textAnchor="middle"
              fill="var(--chart-axis)"
              fontSize={10}
              fontFamily="monospace"
            >
              {t.label}
            </text>
          ))}

          {/* Active Crosshair */}
          {activePt && (
            <g className="pointer-events-none">
              <line
                x1={geom.xOf(activeIdx)}
                y1={PAD_T}
                x2={geom.xOf(activeIdx)}
                y2={ddTop + H_DD}
                stroke="var(--accent)"
                strokeDasharray="3 3"
              />
              <circle
                cx={geom.xOf(activeIdx)}
                cy={geom.yMain(activePt.cumReturnPct)}
                r={4.5}
                fill="var(--accent)"
                stroke="var(--surface)"
                strokeWidth={1.8}
              />
              {showBenchmark && activePt.benchmarkCumPct !== undefined && (
                <circle
                  cx={geom.xOf(activeIdx)}
                  cy={geom.yMain(activePt.benchmarkCumPct)}
                  r={3.5}
                  fill="var(--amber)"
                  stroke="var(--chart-bg)"
                  strokeWidth={1.2}
                />
              )}
              <circle
                cx={geom.xOf(activeIdx)}
                cy={geom.yDd(activePt.drawdownPct)}
                r={3.2}
                fill="var(--rose)"
              />
            </g>
          )}
        </svg>

        {/* Bottom Legend & Active Date Review Link */}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-2 pt-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-3 text-[var(--ink-dim)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm bg-[var(--accent)]" /> 账户累计收益
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed border-amber-400" /> {benchmarkName}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rotate-45 bg-[var(--cyan)]" /> 已有同日复盘
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-amber-400" /> 大亏日(≤-3%)未写复盘
            </span>
          </div>

          {activePt && (
            <div className="flex items-center gap-2">
              {activeReviews.length > 0 ? (
                <Link
                  href={`/vault?card=${encodeURIComponent(activeReviews[0].card)}`}
                  className="inline-flex items-center gap-1 rounded border border-[var(--cyan)]/45 bg-[var(--cyan-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--cyan)] hover:bg-[var(--cyan)]/20"
                >
                  <FileText className="h-3 w-3" />
                  查看 {activePt.date} 复盘：《{activeReviews[0].title.slice(0, 18)}》
                </Link>
              ) : activePt.dailyReturnPct <= -3.0 ? (
                <Link
                  href="/vault?import=cloud"
                  className="inline-flex items-center gap-1 rounded border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-[11px] text-[var(--amber)] hover:bg-amber-500/20"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {activePt.date} 大跌 {activePt.dailyReturnPct}% 尚未写复盘 → 去补录
                </Link>
              ) : activePt.note ? (
                <span className="text-[var(--ink-muted)]">备注：{activePt.note}</span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Monthly Performance Distribution Bars */}
      {monthly.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/75 p-3.5">
          <div className="mb-2.5 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ink)]">
              <TrendingUp className="h-3.5 w-3.5 text-[var(--accent)]" />
              月度战绩分布（收益 / 最大回撤 / 日胜率）
            </span>
            <span className="font-mono text-[10px] text-[var(--ink-dim)]">共 {monthly.length} 个交易月</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {monthly.map((m) => {
              const pos = m.returnPct >= 0;
              return (
                <Link
                  key={m.month}
                  href={`/vault?card=${encodeURIComponent(`10-时间轴/${m.month}.md`)}`}
                  className="group rounded-lg border border-[var(--border)] bg-[var(--surface)]/80 p-2.5 transition hover:border-[var(--cyan)]/45"
                >
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-[var(--ink-muted)] group-hover:text-[var(--cyan)]">{m.month}</span>
                    <span className="text-[10px] text-[var(--ink-dim)]">{m.tradingDays}天</span>
                  </div>
                  <div className={`mt-1 font-mono text-sm font-bold ${pos ? upText : downText}`}>
                    {fmtPct(m.returnPct)}
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-deep)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(8, Math.abs(m.returnPct) * 4))}%`,
                        backgroundColor: pos ? upColor : downColor,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-[var(--ink-dim)]">
                    <span>MDD {m.mddPct.toFixed(1)}%</span>
                    <span>胜 {m.winRatePct.toFixed(0)}%</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}