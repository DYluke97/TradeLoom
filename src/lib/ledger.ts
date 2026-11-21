import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  computeLedgerAnalytics,
  type LedgerAnalytics,
  type PeriodQuantBrief,
} from "./ledger-analytics";
import {
  autoMapCsvColumns,
  generateCsvTemplate,
  normalizeDateStr,
  parseNumberLoose,
  parseRawCsvTable,
  parseTradeSide,
  previewLedgerCsv,
  type CsvColumnMapping,
  type CsvImportKind,
} from "./ledger-csv";
import { generateDemoLedgerRows } from "./ledger-demo";
import { A_SHARE_BENCHMARKS, getAShareDailyBars, normalizeAShareSymbol, type MarketBar } from "./market";
import { ensureWorkspace, writeAtomic } from "./workspace";

export * from "./ledger-analytics";
export * from "./ledger-csv";

export type DailyNavRecord = {
  id: string;
  date: string;
  nav?: number;
  dailyReturnPct?: number;
  positionPct?: number;
  marginUsed?: boolean;
  benchmarkPct?: number;
  note?: string;
  source: "manual" | "csv" | "demo";
};

export type TradeExecution = {
  id: string;
  date: string;
  time?: string;
  symbol: string;
  name: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  amount: number;
  fee?: number;
  tag?: string;
  note?: string;
  source: "manual" | "csv" | "demo";
};

export type LedgerSettings = {
  benchmarkCode: string;
  colorScheme: "cn" | "global";
};

export type LedgerStore = {
  version: 1;
  updatedAt: string;
  settings: LedgerSettings;
  dailyRecords: DailyNavRecord[];
  trades: TradeExecution[];
};

const DEFAULT_SETTINGS: LedgerSettings = {
  benchmarkCode: "000300",
  colorScheme: "cn",
};

function makeId(prefix: string, seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
}

export async function loadLedger(): Promise<LedgerStore> {
  const paths = await ensureWorkspace();
  try {
    const raw = JSON.parse(await readFile(paths.ledgerFile, "utf8")) as Partial<LedgerStore>;
    return {
      version: 1,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      settings: {
        benchmarkCode: raw.settings?.benchmarkCode || DEFAULT_SETTINGS.benchmarkCode,
        colorScheme: raw.settings?.colorScheme === "global" ? "global" : "cn",
      },
      dailyRecords: Array.isArray(raw.dailyRecords) ? raw.dailyRecords : [],
      trades: Array.isArray(raw.trades) ? raw.trades : [],
    };
  } catch {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS },
      dailyRecords: [],
      trades: [],
    };
  }
}

export async function saveLedger(store: LedgerStore): Promise<LedgerStore> {
  const paths = await ensureWorkspace();
  const next: LedgerStore = {
    ...store,
    version: 1,
    updatedAt: new Date().toISOString(),
    dailyRecords: [...store.dailyRecords].sort((a, b) => a.date.localeCompare(b.date)),
    trades: [...store.trades].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""),
    ),
  };
  await writeAtomic(paths.ledgerFile, JSON.stringify(next, null, 2));
  return next;
}

export async function upsertDailyRecord(input: {
  date: string;
  nav?: number;
  dailyReturnPct?: number;
  positionPct?: number;
  marginUsed?: boolean;
  benchmarkPct?: number;
  note?: string;
  source?: DailyNavRecord["source"];
}): Promise<{ ok: true; store: LedgerStore; record: DailyNavRecord } | { ok: false; error: string }> {
  const date = normalizeDateStr(input.date);
  if (!date) return { ok: false, error: "请填写有效的交易日期（YYYY-MM-DD）" };
  if (input.nav === undefined && input.dailyReturnPct === undefined) {
    return { ok: false, error: "「当日收益率 %」或「单位净值」至少填写一项" };
  }
  const store = await loadLedger();
  const rec: DailyNavRecord = {
    id: makeId("day", date),
    date,
    nav: input.nav !== undefined && Number.isFinite(input.nav) && input.nav > 0 ? Number(input.nav.toFixed(4)) : undefined,
    dailyReturnPct:
      input.dailyReturnPct !== undefined && Number.isFinite(input.dailyReturnPct)
        ? Number(input.dailyReturnPct.toFixed(2))
        : undefined,
    positionPct:
      input.positionPct !== undefined && Number.isFinite(input.positionPct) && input.positionPct >= 0
        ? Number(input.positionPct.toFixed(1))
        : undefined,
    marginUsed: input.marginUsed ?? (input.positionPct !== undefined ? input.positionPct > 100 : undefined),
    benchmarkPct:
      input.benchmarkPct !== undefined && Number.isFinite(input.benchmarkPct)
        ? Number(input.benchmarkPct.toFixed(2))
        : undefined,
    note: input.note?.trim() || undefined,
    source: input.source ?? "manual",
  };
  const idx = store.dailyRecords.findIndex((r) => r.date === date);
  if (idx >= 0) store.dailyRecords[idx] = rec;
  else store.dailyRecords.push(rec);
  const saved = await saveLedger(store);
  return { ok: true, store: saved, record: rec };
}

export async function deleteDailyRecord(dateOrId: string): Promise<LedgerStore> {
  const store = await loadLedger();
  store.dailyRecords = store.dailyRecords.filter((r) => r.id !== dateOrId && r.date !== dateOrId);
  return saveLedger(store);
}

export async function addTradeExecution(input: {
  date: string;
  time?: string;
  symbol: string;
  name?: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  fee?: number;
  tag?: string;
  note?: string;
  source?: TradeExecution["source"];
}): Promise<{ ok: true; store: LedgerStore; trade: TradeExecution } | { ok: false; error: string }> {
  const date = normalizeDateStr(input.date);
  if (!date) return { ok: false, error: "请填写有效的成交日期（YYYY-MM-DD）" };
  const norm = normalizeAShareSymbol(input.symbol, "stock");
  if (!norm) return { ok: false, error: `无法识别的股票代码：${input.symbol}` };
  if (!Number.isFinite(input.price) || input.price <= 0) return { ok: false, error: "请填写大于 0 的成交价格" };
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return { ok: false, error: "请填写大于 0 的成交股数" };

  const store = await loadLedger();
  const price = Number(input.price.toFixed(3));
  const quantity = Math.round(Math.abs(input.quantity));
  const amount = Number((price * quantity).toFixed(2));
  const trade: TradeExecution = {
    id: makeId("trd", `${date}|${input.time || ""}|${norm.code}|${input.side}|${price}|${quantity}|${Date.now()}`),
    date,
    time: input.time?.trim() || undefined,
    symbol: norm.code,
    name: input.name?.trim() || norm.code,
    side: input.side,
    price,
    quantity,
    amount,
    fee: input.fee !== undefined && Number.isFinite(input.fee) ? Number(Math.abs(input.fee).toFixed(2)) : undefined,
    tag: input.tag?.trim() || undefined,
    note: input.note?.trim() || undefined,
    source: input.source ?? "manual",
  };
  store.trades.push(trade);
  const saved = await saveLedger(store);
  return { ok: true, store: saved, trade };
}

export async function deleteTradeExecution(id: string): Promise<LedgerStore> {
  const store = await loadLedger();
  store.trades = store.trades.filter((t) => t.id !== id);
  return saveLedger(store);
}

export async function updateLedgerSettings(patch: Partial<LedgerSettings>): Promise<LedgerStore> {
  const store = await loadLedger();
  if (patch.benchmarkCode && A_SHARE_BENCHMARKS.some((b) => b.code === patch.benchmarkCode)) {
    store.settings.benchmarkCode = patch.benchmarkCode;
  }
  if (patch.colorScheme === "cn" || patch.colorScheme === "global") {
    store.settings.colorScheme = patch.colorScheme;
  }
  return saveLedger(store);
}

export async function importLedgerCsv(args: {
  buf: Buffer;
  kind?: CsvImportKind;
  mapping?: CsvColumnMapping;
}): Promise<
  | {
      ok: true;
      kind: CsvImportKind;
      imported: number;
      skipped: number;
      redactedColumns: string[];
      store: LedgerStore;
    }
  | { ok: false; error: string }
> {
  const { headers, rows } = parseRawCsvTable(args.buf);
  if (headers.length < 2 || rows.length === 0) {
    return { ok: false, error: "无法解析 CSV/TSV 数据，请检查文件格式" };
  }
  const auto = autoMapCsvColumns(headers);
  const kind = args.kind ?? auto.kind;
  const map: CsvColumnMapping = { ...auto.mapping, ...(args.mapping ?? {}) };

  if (map.date === undefined) {
    return { ok: false, error: "未匹配到「日期」列，请在预览中手动指定日期列" };
  }

  const store = await loadLedger();
  let imported = 0;
  let skipped = 0;

  if (kind === "trades") {
    if (map.symbol === undefined) {
      return { ok: false, error: "导入交割单需要指定「证券代码」列" };
    }
    const existingSigs = new Set(
      store.trades.map((t) => `${t.date}|${t.time || ""}|${t.symbol}|${t.side}|${t.price}|${t.quantity}`),
    );
    for (const r of rows) {
      const date = normalizeDateStr(r[map.date] ?? "");
      const norm = normalizeAShareSymbol(r[map.symbol] ?? "", "stock");
      if (!date || !norm) {
        skipped++;
        continue;
      }
      const rawQty = map.quantity !== undefined ? parseNumberLoose(r[map.quantity]) : undefined;
      const sideRaw = map.side !== undefined ? r[map.side] ?? "" : "";
      const side = parseTradeSide(sideRaw, rawQty);
      if (!side) {
        skipped++;
        continue;
      }
      let price = map.price !== undefined ? parseNumberLoose(r[map.price]) : undefined;
      let qty = rawQty !== undefined ? Math.abs(Math.round(rawQty)) : undefined;
      const amt = map.amount !== undefined ? Math.abs(parseNumberLoose(r[map.amount]) ?? 0) : undefined;
      if ((!price || price <= 0) && amt && qty && qty > 0) price = amt / qty;
      if ((!qty || qty <= 0) && amt && price && price > 0) qty = Math.round(amt / price);
      if (!price || price <= 0 || !qty || qty <= 0) {
        skipped++;
        continue;
      }
      const finalPrice = Number(price.toFixed(3));
      const time = map.time !== undefined ? (r[map.time] || "").trim() || undefined : undefined;
      const sig = `${date}|${time || ""}|${norm.code}|${side}|${finalPrice}|${qty}`;
      if (existingSigs.has(sig)) {
        skipped++;
        continue;
      }
      existingSigs.add(sig);
      const name = map.name !== undefined && r[map.name]?.trim() ? r[map.name].trim() : norm.code;
      const fee = map.fee !== undefined ? parseNumberLoose(r[map.fee]) : undefined;
      const tag = map.tag !== undefined ? r[map.tag]?.trim() || undefined : undefined;
      const note = map.note !== undefined ? r[map.note]?.trim() || undefined : undefined;
      store.trades.push({
        id: makeId("trd", sig),
        date,
        time,
        symbol: norm.code,
        name,
        side,
        price: finalPrice,
        quantity: qty,
        amount: Number((amt && amt > 0 ? amt : finalPrice * qty).toFixed(2)),
        fee: fee !== undefined ? Number(Math.abs(fee).toFixed(2)) : undefined,
        tag,
        note,
        source: "csv",
      });
      imported++;
    }
  } else {
    if (map.nav === undefined && map.dailyReturnPct === undefined) {
      return { ok: false, error: "导入每日净值表需至少指定「单位净值」或「当日收益率%」列" };
    }
    const byDate = new Map(store.dailyRecords.map((d) => [d.date, d]));
    for (const r of rows) {
      const date = normalizeDateStr(r[map.date] ?? "");
      if (!date) {
        skipped++;
        continue;
      }
      const nav = map.nav !== undefined ? parseNumberLoose(r[map.nav]) : undefined;
      const dailyReturnPct = map.dailyReturnPct !== undefined ? parseNumberLoose(r[map.dailyReturnPct]) : undefined;
      if (nav === undefined && dailyReturnPct === undefined) {
        skipped++;
        continue;
      }
      const positionPct = map.positionPct !== undefined ? parseNumberLoose(r[map.positionPct]) : undefined;
      const benchmarkPct = map.benchmarkPct !== undefined ? parseNumberLoose(r[map.benchmarkPct]) : undefined;
      const note = map.note !== undefined ? r[map.note]?.trim() || undefined : undefined;
      byDate.set(date, {
        id: makeId("day", date),
        date,
        nav: nav !== undefined && nav > 0 ? Number(nav.toFixed(4)) : undefined,
        dailyReturnPct: dailyReturnPct !== undefined ? Number(dailyReturnPct.toFixed(2)) : undefined,
        positionPct: positionPct !== undefined && positionPct >= 0 ? Number(positionPct.toFixed(1)) : undefined,
        marginUsed: positionPct !== undefined ? positionPct > 100 : undefined,
        benchmarkPct: benchmarkPct !== undefined ? Number(benchmarkPct.toFixed(2)) : undefined,
        note,
        source: "csv",
      });
      imported++;
    }
    store.dailyRecords = [...byDate.values()];
  }

  if (imported === 0) {
    return { ok: false, error: `没有可导入的有效行（共跳过 ${skipped} 行，请检查列映射或是否重复导入）` };
  }
  const saved = await saveLedger(store);
  return { ok: true, kind, imported, skipped, redactedColumns: auto.redactedColumns, store: saved };
}

export async function getFullLedgerWithBenchmark(skipRemoteBenchmark = false): Promise<{
  store: LedgerStore;
  analytics: LedgerAnalytics;
}> {
  const store = await loadLedger();
  let benchBars: MarketBar[] = [];
  if (!skipRemoteBenchmark && store.dailyRecords.length > 0) {
    const sorted = [...store.dailyRecords].sort((a, b) => a.date.localeCompare(b.date));
    const res = await getAShareDailyBars({
      symbol: store.settings.benchmarkCode,
      kind: "index",
      start: sorted[0].date,
      end: sorted[sorted.length - 1].date,
    });
    if (res.ok) benchBars = res.series.bars;
  }
  return { store, analytics: computeLedgerAnalytics(store, benchBars) };
}

/**
 * Privacy-sanitized quantitative summary for LLM synthesis (percentages & ratios ONLY — zero raw RMB totals).
 */
export async function buildPeriodQuantBrief(fromDate?: string, toDate?: string): Promise<PeriodQuantBrief | null> {
  const store = await loadLedger();
  if (store.dailyRecords.length === 0 && store.trades.length === 0) return null;

  const filteredDaily = store.dailyRecords.filter(
    (d) => (!fromDate || d.date >= fromDate) && (!toDate || d.date <= toDate),
  );
  const filteredTrades = store.trades.filter(
    (t) => (!fromDate || t.date >= fromDate) && (!toDate || t.date <= toDate),
  );
  if (filteredDaily.length === 0 && filteredTrades.length === 0) return null;

  let benchBars: MarketBar[] = [];
  if (filteredDaily.length > 0) {
    const sorted = [...filteredDaily].sort((a, b) => a.date.localeCompare(b.date));
    const res = await getAShareDailyBars({
      symbol: store.settings.benchmarkCode,
      kind: "index",
      start: sorted[0].date,
      end: sorted[sorted.length - 1].date,
    });
    if (res.ok) benchBars = res.series.bars;
  }

  const analytics = computeLedgerAnalytics(
    { ...store, dailyRecords: filteredDaily, trades: filteredTrades },
    benchBars,
  );
  const worstDays = [...analytics.equityCurve]
    .filter((p) => p.dailyReturnPct < 0)
    .sort((a, b) => a.dailyReturnPct - b.dailyReturnPct)
    .slice(0, 5)
    .map((p) => ({ date: p.date, dailyReturnPct: p.dailyReturnPct, positionPct: p.positionPct }));
  const bestDays = [...analytics.equityCurve]
    .filter((p) => p.dailyReturnPct > 0)
    .sort((a, b) => b.dailyReturnPct - a.dailyReturnPct)
    .slice(0, 5)
    .map((p) => ({ date: p.date, dailyReturnPct: p.dailyReturnPct, positionPct: p.positionPct }));

  return {
    fromDate: analytics.dateRange?.from || fromDate || "",
    toDate: analytics.dateRange?.to || toDate || "",
    benchmarkName: analytics.benchmarkName,
    matchedDays: analytics.kpi.tradingDays,
    periodReturnPct: analytics.kpi.cumReturnPct,
    benchmarkReturnPct: analytics.kpi.benchmarkReturnPct,
    excessAlphaPct: analytics.kpi.excessAlphaPct,
    mddPct: analytics.kpi.mddPct,
    dailyWinRatePct: analytics.kpi.dailyWinRatePct,
    profitFactor: analytics.kpi.profitFactor,
    peakPositionPct: analytics.kpi.peakPositionPct,
    marginDays: analytics.kpi.marginDays,
    tradeCount: analytics.kpi.totalTrades,
    worstDays,
    bestDays,
    stockStats: analytics.stocks.slice(0, 12).map((s) => ({
      symbol: s.symbol,
      name: s.name,
      realizedPnlPct: s.realizedPnlPct,
      tradeCount: s.tradeCount,
      status: s.status,
    })),
  };
}

export async function loadDemoLedger(): Promise<{ store: LedgerStore; dailyAdded: number; tradesAdded: number }> {
  const store = await loadLedger();
  store.dailyRecords = store.dailyRecords.filter((d) => d.source !== "demo");
  store.trades = store.trades.filter((t) => t.source !== "demo");

  const { dailyRecords, trades } = await generateDemoLedgerRows();
  const existingDates = new Set(store.dailyRecords.map((d) => d.date));
  for (const d of dailyRecords) {
    if (!existingDates.has(d.date)) store.dailyRecords.push(d);
  }
  store.trades.push(...trades);
  const saved = await saveLedger(store);
  return { store: saved, dailyAdded: dailyRecords.length, tradesAdded: trades.length };
}

export async function clearDemoLedger(): Promise<LedgerStore> {
  const store = await loadLedger();
  store.dailyRecords = store.dailyRecords.filter((d) => d.source !== "demo");
  store.trades = store.trades.filter((t) => t.source !== "demo");
  return saveLedger(store);
}

export { previewLedgerCsv, generateCsvTemplate };