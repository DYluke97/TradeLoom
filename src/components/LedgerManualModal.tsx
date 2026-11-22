"use client";

import { Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SymbolSuggestion } from "@/lib/market";

const TRADE_TAGS = ["右侧突破", "低吸", "回踩加仓", "打板", "做T", "分批止盈", "纪律止损", "风控降仓", "冲动反例"];

export default function LedgerManualModal({
  open,
  initialTab = "trade",
  defaultDate,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialTab?: "daily" | "trade";
  defaultDate?: string;
  onClose: () => void;
  onSaved: (payload: Record<string, unknown>, message: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState<"daily" | "trade">(initialTab);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [dDate, setDDate] = useState(defaultDate || today);
  const [dRet, setDRet] = useState("");
  const [dNav, setDNav] = useState("");
  const [dPos, setDPos] = useState("");
  const [dMargin, setDMargin] = useState(false);
  const [dNote, setDNote] = useState("");

  const [tDate, setTDate] = useState(defaultDate || today);
  const [tTime, setTTime] = useState("09:45:00");
  const [tQuery, setTQuery] = useState("");
  const [tSymbol, setTSymbol] = useState("");
  const [tName, setTName] = useState("");
  const [tSide, setTSide] = useState<"BUY" | "SELL">("BUY");
  const [tPrice, setTPrice] = useState("");
  const [tQty, setTQty] = useState("1000");
  const [tFee, setTFee] = useState("");
  const [tTag, setTTag] = useState("");
  const [tNote, setTNote] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [refCloseHint, setRefCloseHint] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setErr("");
    if (defaultDate) {
      setDDate(defaultDate);
      setTDate(defaultDate);
    }
  }, [open, initialTab, defaultDate]);

  useEffect(() => {
    if (!open || tab !== "trade") return;
    const q = tQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/market/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok && Array.isArray(d.items)) {
            setSuggestions(d.items.filter((x: SymbolSuggestion) => x.kind === "stock"));
          }
        })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 260);
    return () => clearTimeout(timer);
  }, [tQuery, open, tab]);

  if (!open) return null;

  async function pickSuggestion(item: SymbolSuggestion) {
    setTSymbol(item.symbol);
    setTName(item.name);
    setTQuery(`${item.symbol} ${item.name}`);
    setSuggestions([]);
    setRefCloseHint("");
    if (/^\d{4}-\d{2}-\d{2}$/.test(tDate)) {
      try {
        const res = await fetch(
          `/api/market/kline?symbol=${encodeURIComponent(item.symbol)}&start=${encodeURIComponent(tDate)}&end=${encodeURIComponent(tDate)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        const bar = data?.series?.bars?.[0];
        if (bar && bar.close > 0) {
          setRefCloseHint(
            `当日行情参考：开 ${bar.open.toFixed(2)} / 收 ${bar.close.toFixed(2)} / 区间 ${bar.low.toFixed(2)}~${bar.high.toFixed(2)}`,
          );
          if (!tPrice) setTPrice(bar.close.toFixed(2));
        }
      } catch {
        /* ignore */
      }
    }
  }

  async function submitDaily(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert-daily",
          date: dDate,
          dailyReturnPct: dRet.trim() ? Number(dRet) : undefined,
          nav: dNav.trim() ? Number(dNav) : undefined,
          positionPct: dPos.trim() ? Number(dPos) : undefined,
          marginUsed: dMargin,
          note: dNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onSaved(data, `已记入 ${dDate} 每日账户战绩。`);
        setDRet("");
        setDNav("");
        setDNote("");
        onClose();
      } else {
        setErr(data.error || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitTrade(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const code = tSymbol || tQuery.trim().split(/\s+/)[0];
    if (!code) {
      setErr("请搜索选择或输入 6 位 A 股代码");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-trade",
          date: tDate,
          time: tTime.trim() || undefined,
          symbol: code,
          name: tName || undefined,
          side: tSide,
          price: Number(tPrice),
          quantity: Number(tQty),
          fee: tFee.trim() ? Number(tFee) : undefined,
          tag: tTag.trim() || undefined,
          note: tNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onSaved(
          data,
          `已记录 ${tDate} ${tName || code} ${tSide === "BUY" ? "买入" : "卖出"} ${tQty} 股，K线买卖节点已同步。`,
        );
        setTPrice("");
        setTNote("");
        onClose();
      } else {
        setErr(data.error || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
            <Plus className="h-[19px] w-[19px] text-[var(--cyan)]" />
            每日手动记账 · 实盘账本
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-strong)]"
          >
            <X className="h-[19px] w-[19px]" />
          </button>
        </div>

        <div className="flex border-b border-[var(--border)] px-5 text-xs">
          <button
            type="button"
            onClick={() => {
              setTab("trade");
              setErr("");
            }}
            className={`border-b-2 px-3 py-2.5 font-medium transition ${
              tab === "trade"
                ? "border-[var(--cyan)] text-[var(--cyan)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            记一笔股票买卖（自动标 K 线 B/S 点）
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("daily");
              setErr("");
            }}
            className={`border-b-2 px-3 py-2.5 font-medium transition ${
              tab === "daily"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            记每日账户净值 / 收益率
          </button>
        </div>

        <div className="p-5">
          {tab === "trade" ? (
            <form onSubmit={submitTrade} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">成交日期 *</label>
                  <input
                    type="date" onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch {} }}
                    required
                    value={tDate}
                    onChange={(e) => setTDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">买卖方向 *</label>
                  <div className="mt-1 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTSide("BUY")}
                      className={`rounded-lg border py-1.5 font-semibold transition ${
                        tSide === "BUY"
                          ? "border-rose-500 bg-rose-600/25 text-[var(--rose)]"
                          : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)]"
                      }`}
                    >
                      B 买入
                    </button>
                    <button
                      type="button"
                      onClick={() => setTSide("SELL")}
                      className={`rounded-lg border py-1.5 font-semibold transition ${
                        tSide === "SELL"
                          ? "border-sky-500 bg-sky-600/25 text-[var(--cyan)]"
                          : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)]"
                      }`}
                    >
                      S 卖出
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative">
                <label className="block text-[11px] text-[var(--ink-muted)]">
                  A 股代码或名称（支持中文 / 拼音 / 6位代码实时联想）*
                </label>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-[17px] w-[17px] text-[var(--ink-dim)]" />
                  <input
                    value={tQuery}
                    onChange={(e) => {
                      setTQuery(e.target.value);
                      if (/^\d{6}$/.test(e.target.value.trim())) setTSymbol(e.target.value.trim());
                    }}
                    placeholder="例如：002460 或 赣锋锂业 或 宁德时代"
                    className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] py-1.5 pl-8 pr-8 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                  {searching && <Loader2 className="absolute right-2.5 top-2 h-[17px] w-[17px] animate-spin text-[var(--cyan)]" />}
                </div>
                {suggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-[var(--cyan)]/40 bg-[var(--bg-deep)] py-1 shadow-xl">
                    {suggestions.map((s) => (
                      <button
                        key={s.symbol}
                        type="button"
                        onClick={() => pickSuggestion(s)}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-2)]"
                      >
                        <span className="font-medium text-[var(--ink-strong)]">{s.name}</span>
                        <span className="font-mono text-[11px] text-[var(--cyan)]">
                          {s.market}.{s.symbol}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {refCloseHint && <div className="mt-1 font-mono text-[10px] text-[var(--cyan)]">{refCloseHint}</div>}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">成交价 (元) *</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={tPrice}
                    onChange={(e) => setTPrice(e.target.value)}
                    placeholder="38.50"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">成交股数 *</label>
                  <input
                    type="number"
                    step="100"
                    required
                    value={tQty}
                    onChange={(e) => setTQty(e.target.value)}
                    placeholder="1000"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">手续费/税 (选填)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tFee}
                    onChange={(e) => setTFee(e.target.value)}
                    placeholder="10.00"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[var(--ink-muted)]">操作标签（点选快捷填充）</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TRADE_TAGS.map((tg) => (
                    <button
                      key={tg}
                      type="button"
                      onClick={() => setTTag(tTag === tg ? "" : tg)}
                      className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                        tTag === tg
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--bg-deep)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {tg}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-[120px_1fr] gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">成交时间</label>
                  <input
                    value={tTime}
                    onChange={(e) => setTTime(e.target.value)}
                    placeholder="09:45:00"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-2.5 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">交易逻辑 / 复盘短评</label>
                  <input
                    value={tNote}
                    onChange={(e) => setTNote(e.target.value)}
                    placeholder="例如：放量突破20日线首笔试错，跌破昨日低点止损"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                  />
                </div>
              </div>

              {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[var(--rose)]">{err}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs text-[var(--ink-muted)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-[17px] w-[17px] animate-spin" />}
                  保存成交并标注 K 线
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitDaily} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">交易日期 *</label>
                  <input
                    type="date" onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch {} }}
                    required
                    value={dDate}
                    onChange={(e) => setDDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">当日收益率 %（如 2.35 或 -3.8）</label>
                  <input
                    type="number"
                    step="0.01"
                    value={dRet}
                    onChange={(e) => setDRet(e.target.value)}
                    placeholder="例如：1.85 或 -2.40"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">单位净值（与收益率二选一）</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={dNav}
                    onChange={(e) => setDNav(e.target.value)}
                    placeholder="例如：1.1820"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)]">收盘总仓位 %（&gt;100 表示含融资）</label>
                  <input
                    type="number"
                    step="1"
                    value={dPos}
                    onChange={(e) => {
                      setDPos(e.target.value);
                      if (Number(e.target.value) > 100) setDMargin(true);
                    }}
                    placeholder="例如：80 或 130"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-[var(--ink-muted)]">
                <input
                  type="checkbox"
                  checked={dMargin}
                  onChange={(e) => setDMargin(e.target.checked)}
                  className="accent-[var(--amber)]"
                />
                当日使用了融资融券杠杆
              </label>

              <div>
                <label className="block text-[11px] text-[var(--ink-muted)]">当日一句话备注（选填）</label>
                <input
                  value={dNote}
                  onChange={(e) => setDNote(e.target.value)}
                  placeholder="例如：退潮期空仓躲过大跌 / 满融逆势加仓教训"
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-deep)] px-3 py-1.5 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>

              {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[var(--rose)]">{err}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs text-[var(--ink-muted)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-[17px] w-[17px] animate-spin" />}
                  保存当日战绩
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}