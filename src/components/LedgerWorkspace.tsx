"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  BarChart3,
  CandlestickChart,
  FileSpreadsheet,
  ListChecks,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LedgerAnalytics } from "@/lib/ledger-analytics";
import type { DailyNavRecord, LedgerSettings, TradeExecution } from "@/lib/ledger";
import type { BenchmarkSpec } from "@/lib/market";
import EquityCurveChart, { type ReviewRef } from "./EquityCurveChart";
import LedgerCsvModal from "./LedgerCsvModal";
import LedgerManualModal from "./LedgerManualModal";
import LedgerRecordsTable from "./LedgerRecordsTable";
import StockKlineChart from "./StockKlineChart";

type LedgerApiResponse = {
  ok: boolean;
  settings?: LedgerSettings;
  benchmarks?: BenchmarkSpec[];
  analytics?: LedgerAnalytics;
  dailyRecords?: DailyNavRecord[];
  trades?: TradeExecution[];
  reviewsByDate?: Record<string, ReviewRef[]>;
  error?: string;
};

function fmtSigned(v: number | null | undefined, suffix = "%"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "--";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;
}

export default function LedgerWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramSymbol = searchParams.get("symbol") || "";
  const paramTab = searchParams.get("tab") || "";

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<LedgerSettings>({ benchmarkCode: "000300", colorScheme: "cn" });
  const [benchmarks, setBenchmarks] = useState<BenchmarkSpec[]>([]);
  const [analytics, setAnalytics] = useState<LedgerAnalytics | null>(null);
  const [trades, setTrades] = useState<TradeExecution[]>([]);
  const [reviewsByDate, setReviewsByDate] = useState<Record<string, ReviewRef[]>>({});

  const [activeTab, setActiveTab] = useState<"equity" | "stocks" | "records">(
    paramSymbol ? "stocks" : paramTab === "records" ? "records" : "equity",
  );
  const [selectedSymbol, setSelectedSymbol] = useState(paramSymbol);
  const [stockFilter, setStockFilter] = useState("");

  const [manualOpen, setManualOpen] = useState(false);
  const [manualTab, setManualTab] = useState<"daily" | "trade">("trade");
  const [csvOpen, setCsvOpen] = useState(false);

  const applyPayload = useCallback((data: LedgerApiResponse) => {
    if (data.settings) setSettings(data.settings);
    if (data.benchmarks) setBenchmarks(data.benchmarks);
    if (data.analytics) setAnalytics(data.analytics);
    if (data.trades) setTrades(data.trades);
    if (data.reviewsByDate) setReviewsByDate(data.reviewsByDate);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ledger", { cache: "no-store" });
      const data = (await res.json()) as LedgerApiResponse;
      if (data.ok) applyPayload(data);
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (paramSymbol) {
      setSelectedSymbol(paramSymbol);
      setActiveTab("stocks");
    }
  }, [paramSymbol]);

  const stocks = useMemo(() => analytics?.stocks ?? [], [analytics]);
  const filteredStocks = useMemo(() => {
    const q = stockFilter.trim().toLowerCase();
    if (!q) return stocks;
    return stocks.filter((s) => s.symbol.includes(q) || s.name.toLowerCase().includes(q));
  }, [stocks, stockFilter]);

  const activeStock = useMemo(() => {
    if (stocks.length === 0) return null;
    return stocks.find((s) => s.symbol === selectedSymbol) ?? stocks[0];
  }, [stocks, selectedSymbol]);

  const upText = settings.colorScheme === "cn" ? "text-red-400" : "text-emerald-400";
  const downText = settings.colorScheme === "cn" ? "text-emerald-400" : "text-red-400";

  async function postAction(body: Record<string, unknown>, msg?: string) {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as LedgerApiResponse;
      if (data.ok) {
        applyPayload(data);
        if (msg) setNotice(msg);
      } else {
        setNotice(data.error || "操作失败");
      }
    } finally {
      setBusy(false);
    }
  }

  const kpi = analytics?.kpi;

  return (
    <div className="space-y-5">
      {/* Institutional Header */}
      <section className="scifi-card rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cyan)]/35 bg-[var(--cyan-soft)] px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-[var(--cyan)]">
              <Activity className="h-3 w-3" />
              A-SHARE LIVE MARKET · REAL-MONEY LEDGER · QUANT AUDIT
            </div>
            <h1 className="mt-2.5 text-xl font-bold tracking-tight text-[#f8fafc]">
              实盘投资账本 · 净值曲线与个股 K 线买卖节点
            </h1>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              对接真实 A 股前复权日K与大盘基准行情，支持券商交割单/净值 CSV 导入与每日手动记账，让主观复盘接受真金白银的定量检验。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={settings.benchmarkCode}
              disabled={busy}
              onChange={(e) =>
                postAction(
                  { action: "update-settings", benchmarkCode: e.target.value },
                  "已切换对比基准指数并重新对齐超额 Alpha。",
                )
              }
              title="选择对比的 A 股基准指数"
              className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-2.5 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
            >
              {(benchmarks.length > 0
                ? benchmarks
                : [
                    { code: "000300", name: "沪深300" },
                    { code: "000001", name: "上证指数" },
                    { code: "399006", name: "创业板指" },
                    { code: "000688", name: "科创50" },
                    { code: "000852", name: "中证1000" },
                  ]
              ).map((b) => (
                <option key={b.code} value={b.code}>
                  基准：{b.name} ({b.code})
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                postAction({
                  action: "update-settings",
                  colorScheme: settings.colorScheme === "cn" ? "global" : "cn",
                })
              }
              className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:border-[var(--cyan)]/50 hover:text-[var(--ink)]"
            >
              {settings.colorScheme === "cn" ? "A股 红涨绿跌" : "国际 绿涨红跌"}
            </button>

            <button
              type="button"
              onClick={() => {
                setManualTab("trade");
                setManualOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cyan)]/50 bg-[var(--cyan-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--cyan)] transition hover:bg-[var(--cyan)]/20"
            >
              <Plus className="h-3.5 w-3.5" />
              手动记一笔
            </button>

            <button
              type="button"
              onClick={() => setCsvOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_0_16px_rgba(124,77,255,0.4)] transition hover:bg-[var(--accent)]"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              导入交割单 / 净值 CSV
            </button>

            {analytics?.hasDemoData ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => postAction({ action: "clear-demo" }, "已清空演示账本数据，你的个人记录完好保留。")}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                清理演示账本
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  postAction(
                    { action: "load-demo" },
                    "已加载 6 个月真实 A 股行情对齐的演示账本（含赣锋锂业/宁德时代/紫金矿业/江特电机买卖节点）。",
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--emerald)]/40 bg-[var(--emerald-soft)] px-2.5 py-1.5 text-xs text-[var(--emerald)] hover:bg-[var(--emerald)]/20 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                加载 A 股演示账本
              </button>
            )}
          </div>
        </div>

        {notice && (
          <div className="mt-3 rounded-lg border border-[var(--cyan)]/35 bg-[var(--cyan-soft)]/50 px-3 py-1.5 text-xs text-[var(--cyan)]">
            {notice}
          </div>
        )}

        {/* 6 KPI Cards */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/90 p-3">
            <div className="font-mono text-[10px] uppercase text-[var(--ink-dim)]">区间累计收益</div>
            <div className={`mt-1 font-mono text-xl font-bold ${(kpi?.cumReturnPct ?? 0) >= 0 ? upText : downText}`}>
              {kpi && kpi.tradingDays > 0 ? fmtSigned(kpi.cumReturnPct) : "--"}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-dim)]">{kpi?.tradingDays ?? 0} 个交易日</div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/90 p-3">
            <div className="font-mono text-[10px] uppercase text-[var(--ink-dim)]">
              超额 Alpha (vs {analytics?.benchmarkName || "沪深300"})
            </div>
            <div
              className={`mt-1 font-mono text-xl font-bold ${
                (kpi?.excessAlphaPct ?? 0) >= 0 ? "text-[var(--cyan)]" : "text-amber-400"
              }`}
            >
              {fmtSigned(kpi?.excessAlphaPct)}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-dim)]">
              基准 {fmtSigned(kpi?.benchmarkReturnPct)}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/90 p-3">
            <div className="font-mono text-[10px] uppercase text-[var(--ink-dim)]">最大回撤 (MDD)</div>
            <div className="mt-1 font-mono text-xl font-bold text-red-400">
              {kpi && kpi.tradingDays > 0 ? `${kpi.mddPct.toFixed(2)}%` : "--"}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--ink-dim)]">
              {kpi?.mddTroughDate ? `谷底 ${kpi.mddTroughDate}` : "暂无回撤记录"}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/90 p-3">
            <div className="font-mono text-[10px] uppercase text-[var(--ink-dim)]">日胜率 / 盈亏比 (PF)</div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className="text-xl font-bold text-[#f8fafc]">
                {kpi && kpi.tradingDays > 0 ? `${kpi.dailyWinRatePct.toFixed(1)}%` : "--"}
              </span>
              <span className="text-xs text-[var(--accent)]">
                PF {kpi?.profitFactor !== null && kpi?.profitFactor !== undefined ? kpi.profitFactor.toFixed(2) : "--"}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-dim)]">
              均盈 {fmtSigned(kpi?.avgWinPct)} / 均亏 {fmtSigned(kpi?.avgLossPct)}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/90 p-3">
            <div className="font-mono text-[10px] uppercase text-[var(--ink-dim)]">峰值仓位 / 融资暴露</div>
            <div
              className={`mt-1 font-mono text-xl font-bold ${
                (kpi?.peakPositionPct ?? 0) > 100 ? "text-amber-300" : "text-[#f8fafc]"
              }`}
            >
              {kpi?.peakPositionPct !== null && kpi?.peakPositionPct !== undefined
                ? `${kpi.peakPositionPct.toFixed(0)}%`
                : "--"}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-dim)]">融资交易日 {kpi?.marginDays ?? 0} 天</div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/90 p-3">
            <div className="font-mono text-[10px] uppercase text-[var(--ink-dim)]">交割笔数 / 个股胜率</div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className="text-xl font-bold text-[var(--emerald)]">{kpi?.totalTrades ?? 0}</span>
              <span className="text-xs text-[var(--ink-muted)]">
                {kpi?.stockWinRatePct !== null && kpi?.stockWinRatePct !== undefined
                  ? `胜 ${kpi.stockWinRatePct.toFixed(0)}%`
                  : `${stocks.length} 标的`}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-dim)]">覆盖 {stocks.length} 只 A 股标的</div>
          </div>
        </div>
      </section>

      {/* Tabs Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("equity")}
            className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-medium transition ${
              activeTab === "equity"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            净值曲线 & 超额归因
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stocks")}
            className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-medium transition ${
              activeTab === "stocks"
                ? "border-[var(--cyan)] text-[var(--cyan)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <CandlestickChart className="h-3.5 w-3.5" />
            个股 K 线 & 买卖节点 ({stocks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("records")}
            className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-medium transition ${
              activeTab === "records"
                ? "border-[var(--emerald)] text-[var(--emerald)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <ListChecks className="h-3.5 w-3.5" />
            每日台账 & 交割流水
          </button>
        </div>

        <Link
          href="/synthesize"
          className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/25"
        >
          去「阶段提炼」开启文字 × 实盘定量证伪 →
        </Link>
      </div>

      {/* View Body */}
      {loading ? (
        <div className="flex h-72 items-center justify-center gap-2 text-xs text-[var(--ink-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--cyan)]" />
          正在同步本地实盘账本与 A 股基准行情...
        </div>
      ) : activeTab === "equity" ? (
        <section className="scifi-card rounded-xl p-4">
          <EquityCurveChart
            points={analytics?.equityCurve ?? []}
            monthly={analytics?.monthly ?? []}
            benchmarkName={analytics?.benchmarkName || "沪深300"}
            colorScheme={settings.colorScheme}
            reviewsByDate={reviewsByDate}
            onSelectDateForReview={(date) => {
              const rev = reviewsByDate[date]?.[0];
              if (rev) router.push(`/vault?card=${encodeURIComponent(rev.card)}`);
            }}
          />
        </section>
      ) : activeTab === "stocks" ? (
        <section className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
          <div className="scifi-card flex flex-col rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="text-xs font-semibold text-[#f8fafc]">交易标的战绩榜</span>
              <button
                type="button"
                onClick={() => {
                  setManualTab("trade");
                  setManualOpen(true);
                }}
                className="rounded border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] px-2 py-0.5 text-[10px] text-[var(--cyan)]"
              >
                + 记一笔
              </button>
            </div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--ink-dim)]" />
              <input
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value)}
                placeholder="搜代码或简称..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] py-1.5 pl-8 pr-2 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
              />
            </div>

            {filteredStocks.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center text-xs text-[var(--ink-dim)]">
                <div>暂无股票交割记录</div>
                <button
                  type="button"
                  onClick={() => setCsvOpen(true)}
                  className="rounded border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] px-3 py-1 text-[11px] text-[var(--cyan)]"
                >
                  导入券商交割单
                </button>
              </div>
            ) : (
              <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-0.5">
                {filteredStocks.map((s) => {
                  const active = activeStock?.symbol === s.symbol;
                  const pnlPos = s.realizedPnl >= 0;
                  return (
                    <button
                      key={s.symbol}
                      type="button"
                      onClick={() => setSelectedSymbol(s.symbol)}
                      className={`w-full rounded-lg border p-2.5 text-left transition ${
                        active
                          ? "border-[var(--cyan)] bg-[var(--cyan-soft)]/50 shadow-[0_0_16px_rgba(34,211,238,0.12)]"
                          : "border-[var(--border)] bg-[var(--bg-deep)]/75 hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-[#f8fafc]">{s.name}</div>
                          <div className="font-mono text-[10px] text-[var(--ink-dim)]">
                            {s.market}.{s.symbol} · {s.buyCount}买/{s.sellCount}卖
                          </div>
                        </div>
                        <div className="text-right font-mono">
                          {s.sellQty > 0 ? (
                            <div className={`text-xs font-bold ${pnlPos ? upText : downText}`}>
                              {pnlPos ? "+" : ""}
                              {s.realizedPnlPct.toFixed(1)}%
                            </div>
                          ) : (
                            <div className="text-[11px] text-[var(--cyan)]">持仓中</div>
                          )}
                          <div className="text-[10px] text-[var(--ink-dim)]">{s.lastDate.slice(5)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="scifi-card rounded-xl p-4">
            {activeStock ? (
              <StockKlineChart
                stock={activeStock}
                colorScheme={settings.colorScheme}
                reviewsByDate={reviewsByDate}
              />
            ) : (
              <div className="flex h-80 flex-col items-center justify-center gap-3 text-xs text-[var(--ink-dim)]">
                <CandlestickChart className="h-8 w-8 text-[var(--cyan)]/60" />
                <div>导入券商交割单、手动记一笔，或点击右上角「加载 A 股演示账本」即可体验真实日 K 线买卖节点标注</div>
              </div>
            )}
          </div>
        </section>
      ) : (
        <LedgerRecordsTable
          equityCurve={analytics?.equityCurve ?? []}
          trades={trades}
          colorScheme={settings.colorScheme}
          reviewsByDate={reviewsByDate}
          onDeleteDaily={(date) => postAction({ action: "delete-daily", date }, `已删除 ${date} 日度记录。`)}
          onDeleteTrade={(id) => postAction({ action: "delete-trade", id }, "已删除该笔成交记录。")}
          onInspectStock={(sym) => {
            setSelectedSymbol(sym);
            setActiveTab("stocks");
          }}
        />
      )}

      <LedgerManualModal
        open={manualOpen}
        initialTab={manualTab}
        onClose={() => setManualOpen(false)}
        onSaved={(data, msg) => {
          applyPayload(data as LedgerApiResponse);
          setNotice(msg);
        }}
      />

      <LedgerCsvModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        onImported={(data, msg) => {
          applyPayload(data as LedgerApiResponse);
          setNotice(msg);
        }}
      />
    </div>
  );
}