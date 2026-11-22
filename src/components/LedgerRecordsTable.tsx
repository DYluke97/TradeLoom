"use client";

import Link from "next/link";
import { AlertTriangle, FileText, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { EquityPoint } from "@/lib/ledger-analytics";
import type { TradeExecution } from "@/lib/ledger";
import type { ReviewRef } from "./EquityCurveChart";

function fmtSigned(v: number | null | undefined, suffix = "%"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "--";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;
}

export default function LedgerRecordsTable({
  equityCurve,
  trades,
  colorScheme,
  reviewsByDate,
  onDeleteDaily,
  onDeleteTrade,
  onInspectStock,
}: {
  equityCurve: EquityPoint[];
  trades: TradeExecution[];
  colorScheme: "cn" | "global";
  reviewsByDate: Record<string, ReviewRef[]>;
  onDeleteDaily: (date: string) => void;
  onDeleteTrade: (id: string) => void;
  onInspectStock: (symbol: string) => void;
}) {
  const [recordsView, setRecordsView] = useState<"daily" | "trades">("daily");
  const [recordFilter, setRecordFilter] = useState<"all" | "big-loss" | "missing-review">("all");

  const upText = colorScheme === "cn" ? "text-[var(--rose)]" : "text-[var(--emerald)]";
  const downText = colorScheme === "cn" ? "text-[var(--emerald)]" : "text-[var(--rose)]";

  const filteredDailyRows = useMemo(() => {
    const list = [...equityCurve].reverse();
    if (recordFilter === "big-loss") return list.filter((p) => p.dailyReturnPct <= -3.0);
    if (recordFilter === "missing-review") {
      return list.filter(
        (p) => (reviewsByDate[p.date]?.length ?? 0) === 0 && (p.dailyReturnPct <= -2.0 || p.tradesCount > 0),
      );
    }
    return list;
  }, [equityCurve, recordFilter, reviewsByDate]);

  return (
    <section className="scifi-card space-y-3 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setRecordsView("daily")}
            className={`rounded px-3 py-1 transition ${
              recordsView === "daily"
                ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                : "text-[var(--ink-muted)]"
            }`}
          >
            每日净值与复盘对齐 ({equityCurve.length})
          </button>
          <button
            type="button"
            onClick={() => setRecordsView("trades")}
            className={`rounded px-3 py-1 transition ${
              recordsView === "trades"
                ? "bg-[var(--cyan-soft)] font-medium text-[var(--cyan)]"
                : "text-[var(--ink-muted)]"
            }`}
          >
            全部股票交割流水 ({trades.length})
          </button>
        </div>

        {recordsView === "daily" && (
          <div className="flex items-center gap-1.5 text-[11px]">
            {(
              [
                ["all", "全部交易日"],
                ["big-loss", "仅看大亏日 (≤-3%)"],
                ["missing-review", "大跌/有交易但漏写复盘"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRecordFilter(k)}
                className={`rounded-full border px-2.5 py-1 transition ${
                  recordFilter === k
                    ? "border-amber-400/60 bg-amber-500/15 text-[var(--amber)]"
                    : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {recordsView === "daily" ? (
        <div className="max-h-[520px] overflow-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--surface)] font-mono text-[10px] uppercase text-[var(--ink-dim)]">
              <tr>
                <th className="px-3 py-2">日期</th>
                <th className="px-3 py-2">当日收益</th>
                <th className="px-3 py-2">归一化净值</th>
                <th className="px-3 py-2">回撤</th>
                <th className="px-3 py-2">仓位/融资</th>
                <th className="px-3 py-2">基准涨跌</th>
                <th className="px-3 py-2">同日复盘对齐</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/50 font-mono">
              {filteredDailyRows.map((p) => {
                const revs = reviewsByDate[p.date] ?? [];
                const missedBigLoss = revs.length === 0 && p.dailyReturnPct <= -3.0;
                return (
                  <tr key={p.date} className="hover:bg-[var(--surface-2)]/50">
                    <td className="px-3 py-2 text-[var(--ink)]">{p.date}</td>
                    <td className={`px-3 py-2 font-semibold ${p.dailyReturnPct >= 0 ? upText : downText}`}>
                      {fmtSigned(p.dailyReturnPct)}
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">{p.nav.toFixed(4)}</td>
                    <td className="px-3 py-2 text-[var(--rose)]">{p.drawdownPct.toFixed(2)}%</td>
                    <td className="px-3 py-2">
                      {p.positionPct !== undefined ? (
                        <span className={p.positionPct > 100 ? "font-semibold text-[var(--amber)]" : "text-[var(--ink-muted)]"}>
                          {p.positionPct}%{p.positionPct > 100 ? " (融)" : ""}
                        </span>
                      ) : (
                        "--"
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">{fmtSigned(p.benchmarkDailyPct)}</td>
                    <td className="px-3 py-2 font-sans">
                      {revs.length > 0 ? (
                        <Link
                          href={`/vault?card=${encodeURIComponent(revs[0].card)}`}
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--cyan)] hover:underline"
                        >
                          <FileText className="h-4 w-4" />
                          {revs[0].title.slice(0, 18)}
                        </Link>
                      ) : missedBigLoss ? (
                        <Link
                          href="/vault?import=cloud"
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--amber)] hover:underline"
                        >
                          <AlertTriangle className="h-4 w-4" />
                          暴跌漏复盘 → 去补录
                        </Link>
                      ) : (
                        <span className="text-[11px] text-[var(--ink-dim)]">{p.note || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onDeleteDaily(p.date)}
                        title="删除该日记录"
                        className="rounded p-1 text-[var(--ink-dim)] hover:bg-red-500/15 hover:text-[var(--rose)]"
                      >
                        <Trash2 className="h-[17px] w-[17px]" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredDailyRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center font-sans text-xs text-[var(--ink-dim)]">
                    当前筛选条件下暂无记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="max-h-[520px] overflow-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--surface)] font-mono text-[10px] uppercase text-[var(--ink-dim)]">
              <tr>
                <th className="px-3 py-2">日期</th>
                <th className="px-3 py-2">标的</th>
                <th className="px-3 py-2">方向</th>
                <th className="px-3 py-2">成交价</th>
                <th className="px-3 py-2">股数</th>
                <th className="px-3 py-2">标签 / 备注</th>
                <th className="px-3 py-2 text-right">看 K 线 / 删除</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/50 font-mono">
              {[...trades].reverse().map((t) => (
                <tr key={t.id} className="hover:bg-[var(--surface-2)]/50">
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{t.date}</td>
                  <td className="px-3 py-2 font-sans font-medium text-[var(--ink-strong)]">
                    {t.name} <span className="font-mono text-[10px] text-[var(--ink-dim)]">{t.symbol}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                        t.side === "BUY" ? "bg-rose-600/90" : "bg-sky-600/90"
                      }`}
                    >
                      {t.side === "BUY" ? "B 买" : "S 卖"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold text-[var(--ink-strong)]">{t.price.toFixed(2)}</td>
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{t.quantity}</td>
                  <td className="max-w-[260px] truncate px-3 py-2 font-sans text-[11px] text-[var(--ink-muted)]">
                    {t.tag && <span className="mr-1.5 text-[var(--accent)]">[{t.tag}]</span>}
                    {t.note || "--"}
                  </td>
                  <td className="px-3 py-2 text-right font-sans">
                    <button
                      type="button"
                      onClick={() => onInspectStock(t.symbol)}
                      className="mr-2 text-[11px] text-[var(--cyan)] hover:underline"
                    >
                      看 K 线
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteTrade(t.id)}
                      className="rounded p-1 text-[var(--ink-dim)] hover:bg-red-500/15 hover:text-[var(--rose)]"
                    >
                      <Trash2 className="h-[17px] w-[17px]" />
                    </button>
                  </td>
                </tr>
              ))}
              {trades.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center font-sans text-xs text-[var(--ink-dim)]">
                    暂无股票交割流水
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}