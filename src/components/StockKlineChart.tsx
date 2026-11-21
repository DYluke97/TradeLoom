"use client";

import Link from "next/link";
import { FileText, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StockPositionSummary } from "@/lib/ledger-analytics";
import type { TradeExecution } from "@/lib/ledger";
import type { MarketBar, MarketSeries } from "@/lib/market";
import type { ReviewRef } from "./EquityCurveChart";

function shiftDate(ymd: string, deltaDays: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function calcMA(bars: MarketBar[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export default function StockKlineChart({
  stock,
  colorScheme,
  reviewsByDate,
}: {
  stock: StockPositionSummary;
  colorScheme: "cn" | "global";
  reviewsByDate: Record<string, ReviewRef[]>;
}) {
  const [rangeMode, setRangeMode] = useState<"trade" | "3m" | "1y" | "all">("trade");
  const [series, setSeries] = useState<MarketSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showMA, setShowMA] = useState(true);
  const [showCostLine, setShowCostLine] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const upColor = colorScheme === "cn" ? "#ef4444" : "#10b981";
  const downColor = colorScheme === "cn" ? "#10b981" : "#ef4444";
  const upText = colorScheme === "cn" ? "text-red-400" : "text-emerald-400";
  const downText = colorScheme === "cn" ? "text-emerald-400" : "text-red-400";

  const dateWindow = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (rangeMode === "3m") return { start: shiftDate(today, -95), end: today };
    if (rangeMode === "1y") return { start: shiftDate(today, -365), end: today };
    if (rangeMode === "all") return { start: shiftDate(stock.firstDate, -120), end: today };
    const padEnd = shiftDate(stock.lastDate, 35);
    return {
      start: shiftDate(stock.firstDate, -35),
      end: padEnd > today ? today : padEnd,
    };
  }, [rangeMode, stock.firstDate, stock.lastDate]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    setHoverIdx(null);
    const qs = new URLSearchParams({
      symbol: stock.symbol,
      kind: "stock",
      start: dateWindow.start,
      end: dateWindow.end,
      ...(reloadNonce > 0 ? { refresh: "1" } : {}),
    });
    fetch(`/api/market/kline?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.ok && d.series) {
          setSeries(d.series);
        } else {
          setSeries(null);
          setErr(d.error || "行情加载失败");
        }
      })
      .catch((e) => {
        if (alive) {
          setSeries(null);
          setErr(e instanceof Error ? e.message : "网络请求失败");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [stock.symbol, dateWindow.start, dateWindow.end, reloadNonce]);

  const tradesByDate = useMemo(() => {
    const map = new Map<string, TradeExecution[]>();
    for (const t of stock.trades) {
      const arr = map.get(t.date) ?? [];
      arr.push(t);
      map.set(t.date, arr);
    }
    return map;
  }, [stock.trades]);

  const W = 920;
  const H_PRICE = 290;
  const GAP = 16;
  const H_VOL = 66;
  const H_TOTAL = H_PRICE + GAP + H_VOL + 24;
  const PAD_L = 56;
  const PAD_R = 20;
  const PAD_T = 22;
  const plotW = W - PAD_L - PAD_R;
  const priceH = H_PRICE - PAD_T - 14;
  const volTop = H_PRICE + GAP;

  const bars = series?.bars ?? [];

  const geom = useMemo(() => {
    if (bars.length === 0) return null;
    const ma5 = calcMA(bars, 5);
    const ma10 = calcMA(bars, 10);
    const ma20 = calcMA(bars, 20);

    let lo = Infinity;
    let hi = -Infinity;
    let maxVol = 1;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
      if (b.volume > maxVol) maxVol = b.volume;
      const dayTrades = tradesByDate.get(b.date);
      if (dayTrades) {
        for (const t of dayTrades) {
          if (t.price < lo) lo = t.price;
          if (t.price > hi) hi = t.price;
        }
      }
    }
    if (showCostLine && stock.avgBuyPrice > 0 && stock.avgBuyPrice > lo * 0.5 && stock.avgBuyPrice < hi * 1.5) {
      lo = Math.min(lo, stock.avgBuyPrice);
      hi = Math.max(hi, stock.avgBuyPrice);
    }
    const pad = Math.max(0.05, (hi - lo) * 0.12);
    const pMin = Math.max(0.01, lo - pad);
    const pMax = hi + pad;
    const pSpan = Math.max(pMax - pMin, 0.01);

    const stepX = plotW / Math.max(bars.length, 1);
    const candleW = Math.max(2, Math.min(12, stepX * 0.66));
    const xOf = (i: number) => PAD_L + (i + 0.5) * stepX;
    const yPrice = (v: number) => PAD_T + ((pMax - v) / pSpan) * priceH;
    const yVol = (v: number) => volTop + H_VOL - (v / maxVol) * (H_VOL - 6);

    const maPath = (arr: Array<number | null>) => {
      const segs: string[] = [];
      let started = false;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v === null) {
          started = false;
          continue;
        }
        segs.push(`${started ? "L" : "M"}${xOf(i).toFixed(1)},${yPrice(v).toFixed(1)}`);
        started = true;
      }
      return segs.join(" ");
    };

    const yTicks: number[] = [];
    for (let k = 0; k <= 4; k++) yTicks.push(pMin + (pSpan * k) / 4);

    const xStep = Math.max(1, Math.floor(bars.length / 6));
    const xTicks: Array<{ idx: number; x: number; label: string }> = [];
    for (let i = 0; i < bars.length; i += xStep) {
      xTicks.push({ idx: i, x: xOf(i), label: bars[i].date.slice(2) });
    }

    return {
      ma5,
      ma10,
      ma20,
      ma5Path: maPath(ma5),
      ma10Path: maPath(ma10),
      ma20Path: maPath(ma20),
      stepX,
      candleW,
      xOf,
      yPrice,
      yVol,
      yTicks,
      xTicks,
    };
  }, [bars, tradesByDate, showCostLine, stock.avgBuyPrice, plotW, priceH, volTop]);

  const activeIdx = hoverIdx !== null && hoverIdx < bars.length ? hoverIdx : bars.length - 1;
  const activeBar = bars[activeIdx] ?? null;
  const activeTrades = activeBar ? tradesByDate.get(activeBar.date) ?? [] : [];
  const activeReviews = activeBar ? reviewsByDate[activeBar.date] ?? [] : [];

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (bars.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W;
    const idx = Math.floor((relX - PAD_L) / Math.max(plotW / bars.length, 1));
    setHoverIdx(Math.max(0, Math.min(bars.length - 1, idx)));
  }

  return (
    <div className="space-y-3">
      {/* Stock Header & Range Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/90 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-sm font-bold text-[#f8fafc]">{stock.name}</span>
          <span className="rounded border border-[var(--border-strong)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--cyan)]">
            {stock.market}.{stock.symbol}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
              stock.status === "holding"
                ? "border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] text-[var(--cyan)]"
                : "border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--ink-muted)]"
            }`}
          >
            {stock.status === "holding" ? `持仓中 ${stock.openQty}股` : "已清仓"}
          </span>
          <span className="font-mono text-xs text-[var(--ink-muted)]">
            买均 <strong className="text-[var(--ink)]">{stock.avgBuyPrice.toFixed(2)}</strong>
          </span>
          {stock.sellQty > 0 && (
            <span className={`font-mono text-xs font-semibold ${stock.realizedPnl >= 0 ? upText : downText}`}>
              已实现 {stock.realizedPnl >= 0 ? "+" : ""}
              {stock.realizedPnlPct.toFixed(2)}%
            </span>
          )}
          <span className="font-mono text-[10px] text-[var(--ink-dim)]">
            前复权日K · {series?.source === "cache" ? "本地缓存" : series?.source === "tencent" ? "腾讯行情" : "东方财富行情"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <div className="inline-flex rounded border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {(
              [
                ["trade", "交易区间±35日"],
                ["3m", "近3月"],
                ["1y", "近1年"],
                ["all", "全区间"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRangeMode(k)}
                className={`rounded px-2 py-0.5 transition ${
                  rangeMode === k
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="ml-1 inline-flex cursor-pointer items-center gap-1 text-[var(--ink-muted)]">
            <input type="checkbox" checked={showMA} onChange={(e) => setShowMA(e.target.checked)} className="accent-[var(--cyan)]" />
            均线
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1 text-[var(--ink-muted)]">
            <input type="checkbox" checked={showCostLine} onChange={(e) => setShowCostLine(e.target.checked)} className="accent-[var(--amber)]" />
            成本线
          </label>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            title="刷新最新 A 股日线行情"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--cyan)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* OHLCV Readout Bar */}
      {activeBar && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[#080c15] px-3 py-1.5 font-mono text-[11px]">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <span className="font-semibold text-[var(--ink)]">{activeBar.date}</span>
            <span className="text-[var(--ink-muted)]">开 {activeBar.open.toFixed(2)}</span>
            <span className="text-[var(--ink-muted)]">高 {activeBar.high.toFixed(2)}</span>
            <span className="text-[var(--ink-muted)]">低 {activeBar.low.toFixed(2)}</span>
            <span className={(activeBar.pctChg ?? 0) >= 0 ? upText : downText}>
              收 <strong>{activeBar.close.toFixed(2)}</strong> ({(activeBar.pctChg ?? 0) >= 0 ? "+" : ""}
              {(activeBar.pctChg ?? 0).toFixed(2)}%)
            </span>
            {showMA && geom && (
              <>
                {geom.ma5[activeIdx] !== null && <span className="text-amber-300">MA5 {geom.ma5[activeIdx]!.toFixed(2)}</span>}
                {geom.ma10[activeIdx] !== null && <span className="text-[var(--cyan)]">MA10 {geom.ma10[activeIdx]!.toFixed(2)}</span>}
                {geom.ma20[activeIdx] !== null && <span className="text-[var(--accent)]">MA20 {geom.ma20[activeIdx]!.toFixed(2)}</span>}
              </>
            )}
          </div>
          {activeReviews.length > 0 && (
            <Link
              href={`/vault?card=${encodeURIComponent(activeReviews[0].card)}`}
              className="inline-flex items-center gap-1 rounded border border-[var(--cyan)]/45 bg-[var(--cyan-soft)] px-2 py-0.5 text-[10px] font-sans font-medium text-[var(--cyan)] hover:bg-[var(--cyan)]/20"
            >
              <FileText className="h-3 w-3" />
              当日复盘：《{activeReviews[0].title.slice(0, 14)}》
            </Link>
          )}
        </div>
      )}

      {/* Candlestick + Volume + B/S Markers Canvas */}
      <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[#060911] p-2">
        {loading && bars.length === 0 ? (
          <div className="flex h-[340px] items-center justify-center gap-2 text-xs text-[var(--ink-muted)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--cyan)]" />
            正在拉取 {stock.name} ({stock.symbol}) 前复权日K线...
          </div>
        ) : err && bars.length === 0 ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 text-xs text-red-300">
            <AlertCircle className="h-5 w-5" />
            <div>{err}</div>
          </div>
        ) : geom ? (
          <svg
            viewBox={`0 0 ${W} ${H_TOTAL}`}
            className="h-auto w-full select-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Price Grid */}
            {geom.yTicks.map((p, i) => {
              const y = geom.yPrice(p);
              return (
                <g key={i}>
                  <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(148,163,184,0.11)" strokeDasharray="3 5" />
                  <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fill="#64748b" fontSize={10} fontFamily="monospace">
                    {p.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* Average Buy Cost Reference Line */}
            {showCostLine && stock.avgBuyPrice > 0 && (
              <g>
                <line
                  x1={PAD_L}
                  y1={geom.yPrice(stock.avgBuyPrice)}
                  x2={W - PAD_R}
                  y2={geom.yPrice(stock.avgBuyPrice)}
                  stroke="#f59e0b"
                  strokeWidth={1}
                  strokeDasharray="6 4"
                  opacity={0.75}
                />
                <rect
                  x={W - PAD_R - 72}
                  y={geom.yPrice(stock.avgBuyPrice) - 9}
                  width={70}
                  height={16}
                  rx={3}
                  fill="#0b1020"
                  stroke="#f59e0b"
                  strokeOpacity={0.6}
                />
                <text
                  x={W - PAD_R - 37}
                  y={geom.yPrice(stock.avgBuyPrice) + 2.5}
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize={9}
                  fontFamily="monospace"
                >
                  成本 {stock.avgBuyPrice.toFixed(2)}
                </text>
              </g>
            )}

            {/* Moving Averages */}
            {showMA && (
              <g fill="none" strokeWidth={1.25} opacity={0.85}>
                {geom.ma5Path && <path d={geom.ma5Path} stroke="#fbbf24" />}
                {geom.ma10Path && <path d={geom.ma10Path} stroke="#22d3ee" />}
                {geom.ma20Path && <path d={geom.ma20Path} stroke="#a882ff" />}
              </g>
            )}

            {/* Candlesticks & Volume Bars */}
            {bars.map((b, i) => {
              const cx = geom.xOf(i);
              const isUp = b.close >= b.open;
              const col = isUp ? upColor : downColor;
              const yOpen = geom.yPrice(b.open);
              const yClose = geom.yPrice(b.close);
              const yHigh = geom.yPrice(b.high);
              const yLow = geom.yPrice(b.low);
              const bodyTop = Math.min(yOpen, yClose);
              const bodyH = Math.max(1.4, Math.abs(yClose - yOpen));
              const vTop = geom.yVol(b.volume);
              const vH = Math.max(1, volTop + H_VOL - vTop);
              return (
                <g key={b.date}>
                  <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={col} strokeWidth={1.1} />
                  <rect
                    x={cx - geom.candleW / 2}
                    y={bodyTop}
                    width={geom.candleW}
                    height={bodyH}
                    fill={isUp ? col : col}
                    fillOpacity={isUp ? 0.9 : 0.85}
                    stroke={col}
                    strokeWidth={0.6}
                  />
                  <rect
                    x={cx - geom.candleW / 2}
                    y={vTop}
                    width={geom.candleW}
                    height={vH}
                    fill={col}
                    fillOpacity={0.35}
                  />
                </g>
              );
            })}

            {/* Volume Separator & Label */}
            <line x1={PAD_L} y1={volTop} x2={W - PAD_R} y2={volTop} stroke="rgba(148,163,184,0.18)" />
            <text x={PAD_L + 4} y={volTop + 11} fill="#64748b" fontSize={9.5} fontFamily="monospace">
              成交量 (VOL)
            </text>

            {/* Tonghuashun-Style B / S Execution Markers pinned directly on Candles */}
            {bars.map((b, i) => {
              const dayTrades = tradesByDate.get(b.date);
              if (!dayTrades || dayTrades.length === 0) return null;
              const cx = geom.xOf(i);
              const buys = dayTrades.filter((t) => t.side === "BUY");
              const sells = dayTrades.filter((t) => t.side === "SELL");
              return (
                <g key={`bs-${b.date}`}>
                  {buys.length > 0 && (() => {
                    const avgP = buys.reduce((s, t) => s + t.price, 0) / buys.length;
                    const yExec = geom.yPrice(avgP);
                    const yBadge = Math.min(H_PRICE - 12, geom.yPrice(b.low) + 17);
                    const label = buys.length > 1 ? `B×${buys.length}` : "B";
                    return (
                      <g>
                        <line x1={cx} y1={yExec} x2={cx} y2={yBadge - 8} stroke="#f43f5e" strokeWidth={1.2} strokeDasharray="2 2" />
                        <circle cx={cx} cy={yExec} r={3.2} fill="#f43f5e" stroke="#ffffff" strokeWidth={1.2} />
                        <rect
                          x={cx - (buys.length > 1 ? 14 : 9)}
                          y={yBadge - 8}
                          width={buys.length > 1 ? 28 : 18}
                          height={16}
                          rx={4}
                          fill="#e11d48"
                          stroke="#fda4af"
                          strokeWidth={0.9}
                        />
                        <text x={cx} y={yBadge + 3.5} textAnchor="middle" fill="#ffffff" fontSize={9.5} fontWeight={700} fontFamily="monospace">
                          {label}
                        </text>
                      </g>
                    );
                  })()}
                  {sells.length > 0 && (() => {
                    const avgP = sells.reduce((s, t) => s + t.price, 0) / sells.length;
                    const yExec = geom.yPrice(avgP);
                    const yBadge = Math.max(PAD_T + 8, geom.yPrice(b.high) - 18);
                    const label = sells.length > 1 ? `S×${sells.length}` : "S";
                    return (
                      <g>
                        <line x1={cx} y1={yExec} x2={cx} y2={yBadge + 8} stroke="#22d3ee" strokeWidth={1.2} strokeDasharray="2 2" />
                        <circle cx={cx} cy={yExec} r={3.2} fill="#22d3ee" stroke="#06080e" strokeWidth={1.2} />
                        <rect
                          x={cx - (sells.length > 1 ? 14 : 9)}
                          y={yBadge - 8}
                          width={sells.length > 1 ? 28 : 18}
                          height={16}
                          rx={4}
                          fill="#0284c7"
                          stroke="#7dd3fc"
                          strokeWidth={0.9}
                        />
                        <text x={cx} y={yBadge + 3.5} textAnchor="middle" fill="#ffffff" fontSize={9.5} fontWeight={700} fontFamily="monospace">
                          {label}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}

            {/* X Axis Dates */}
            {geom.xTicks.map((t) => (
              <text key={t.idx} x={t.x} y={H_TOTAL - 6} textAnchor="middle" fill="#64748b" fontSize={10} fontFamily="monospace">
                {t.label}
              </text>
            ))}

            {/* Crosshair */}
            {activeBar && (
              <g className="pointer-events-none">
                <line
                  x1={geom.xOf(activeIdx)}
                  y1={PAD_T}
                  x2={geom.xOf(activeIdx)}
                  y2={volTop + H_VOL}
                  stroke="rgba(34,211,238,0.4)"
                  strokeDasharray="3 3"
                />
                <line
                  x1={PAD_L}
                  y1={geom.yPrice(activeBar.close)}
                  x2={W - PAD_R}
                  y2={geom.yPrice(activeBar.close)}
                  stroke="rgba(148,163,184,0.28)"
                  strokeDasharray="3 3"
                />
              </g>
            )}
          </svg>
        ) : null}

        {/* Active Day Execution Detail Callout */}
        {activeTrades.length > 0 && (
          <div className="mt-2 rounded-lg border border-[var(--cyan)]/35 bg-[#0b1120] p-2.5 text-xs">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--cyan)]">
              {activeBar?.date} 实盘成交明细（共 {activeTrades.length} 笔）
            </div>
            <div className="space-y-1.5">
              {activeTrades.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-white ${
                        t.side === "BUY" ? "bg-rose-600" : "bg-sky-600"
                      }`}
                    >
                      {t.side === "BUY" ? "B 买入" : "S 卖出"}
                    </span>
                    <span className="font-mono font-semibold text-[#f8fafc]">
                      ¥{t.price.toFixed(2)} × {t.quantity}股
                    </span>
                    {t.tag && (
                      <span className="rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                        {t.tag}
                      </span>
                    )}
                  </div>
                  {t.note && <span className="text-[11px] text-[var(--ink-muted)]">{t.note}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Complete Trade Execution Timeline for This Stock */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/75 p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-[var(--ink)]">
            {stock.name} 历史买卖节点流水（{stock.trades.length} 笔 · 悬停或核对K线位置）
          </span>
          <span className="font-mono text-[10px] text-[var(--ink-dim)]">
            累计买入 {stock.buyQty} 股 · 累计卖出 {stock.sellQty} 股
          </span>
        </div>
        <div className="max-h-52 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--border)] font-mono text-[10px] text-[var(--ink-dim)]">
              <tr>
                <th className="py-1.5 pr-2">日期</th>
                <th className="py-1.5 pr-2">方向</th>
                <th className="py-1.5 pr-2">成交价</th>
                <th className="py-1.5 pr-2">股数</th>
                <th className="py-1.5 pr-2">操作标签</th>
                <th className="py-1.5 pr-2">备注</th>
                <th className="py-1.5 text-right">同日复盘</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/50 font-mono">
              {stock.trades.map((t) => {
                const revs = reviewsByDate[t.date] ?? [];
                return (
                  <tr
                    key={t.id}
                    onMouseEnter={() => {
                      const idx = bars.findIndex((b) => b.date === t.date);
                      if (idx >= 0) setHoverIdx(idx);
                    }}
                    className="transition hover:bg-[var(--surface-2)]/70"
                  >
                    <td className="py-1.5 pr-2 text-[var(--ink-muted)]">{t.date}</td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                          t.side === "BUY" ? "bg-rose-600/90" : "bg-sky-600/90"
                        }`}
                      >
                        {t.side === "BUY" ? "B 买" : "S 卖"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 font-semibold text-[#f8fafc]">{t.price.toFixed(2)}</td>
                    <td className="py-1.5 pr-2 text-[var(--ink-muted)]">{t.quantity}</td>
                    <td className="py-1.5 pr-2 font-sans text-[11px] text-[var(--accent)]">{t.tag || "--"}</td>
                    <td className="max-w-[220px] truncate py-1.5 pr-2 font-sans text-[11px] text-[var(--ink-muted)]">
                      {t.note || "--"}
                    </td>
                    <td className="py-1.5 text-right font-sans">
                      {revs.length > 0 ? (
                        <Link
                          href={`/vault?card=${encodeURIComponent(revs[0].card)}`}
                          className="text-[11px] text-[var(--cyan)] hover:underline"
                        >
                          查看复盘 →
                        </Link>
                      ) : (
                        <span className="text-[10px] text-[var(--ink-dim)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}