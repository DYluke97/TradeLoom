import { A_SHARE_BENCHMARKS, normalizeAShareSymbol, type MarketBar } from "./market";
import type {
  DailyNavRecord,
  LedgerStore,
  TradeExecution,
} from "./ledger";

export type EquityPoint = {
  date: string;
  nav: number;
  cumReturnPct: number;
  dailyReturnPct: number;
  drawdownPct: number;
  positionPct?: number;
  marginUsed?: boolean;
  benchmarkNav?: number;
  benchmarkCumPct?: number;
  benchmarkDailyPct?: number;
  excessAlphaPct?: number;
  tradesCount: number;
  note?: string;
  source: DailyNavRecord["source"];
};

export type MonthlyQuantSummary = {
  month: string;
  returnPct: number;
  benchmarkPct?: number;
  mddPct: number;
  tradingDays: number;
  winDays: number;
  winRatePct: number;
  tradesCount: number;
};

export type StockPositionSummary = {
  symbol: string;
  name: string;
  market: "SH" | "SZ" | "BJ";
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  buyQty: number;
  sellQty: number;
  openQty: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  realizedPnl: number;
  realizedPnlPct: number;
  totalFees: number;
  firstDate: string;
  lastDate: string;
  status: "holding" | "closed";
  trades: TradeExecution[];
};

export type LedgerDailySnapshot = {
  date: string;
  nav: number;
  dailyReturnPct: number;
  cumReturnPct: number;
  drawdownPct: number;
  positionPct?: number;
  marginUsed?: boolean;
  benchmarkDailyPct?: number;
  excessDailyPct?: number;
  trades: Array<{
    symbol: string;
    name: string;
    side: "BUY" | "SELL";
    price: number;
    quantity: number;
    tag?: string;
  }>;
};

export type LedgerAnalytics = {
  hasData: boolean;
  hasDemoData: boolean;
  benchmarkCode: string;
  benchmarkName: string;
  dateRange: { from: string; to: string } | null;
  kpi: {
    cumReturnPct: number;
    benchmarkReturnPct: number | null;
    excessAlphaPct: number | null;
    mddPct: number;
    mddPeakDate: string | null;
    mddTroughDate: string | null;
    tradingDays: number;
    winDays: number;
    lossDays: number;
    dailyWinRatePct: number;
    profitFactor: number | null;
    avgWinPct: number;
    avgLossPct: number;
    peakPositionPct: number | null;
    marginDays: number;
    totalTrades: number;
    closedStocksCount: number;
    stockWinRatePct: number | null;
  };
  equityCurve: EquityPoint[];
  monthly: MonthlyQuantSummary[];
  stocks: StockPositionSummary[];
  dailyByDate: Record<string, LedgerDailySnapshot>;
};

export type PeriodQuantBrief = {
  fromDate: string;
  toDate: string;
  benchmarkName: string;
  matchedDays: number;
  periodReturnPct: number;
  benchmarkReturnPct: number | null;
  excessAlphaPct: number | null;
  mddPct: number;
  dailyWinRatePct: number;
  profitFactor: number | null;
  peakPositionPct: number | null;
  marginDays: number;
  tradeCount: number;
  worstDays: Array<{ date: string; dailyReturnPct: number; positionPct?: number }>;
  bestDays: Array<{ date: string; dailyReturnPct: number; positionPct?: number }>;
  stockStats: Array<{
    symbol: string;
    name: string;
    realizedPnlPct: number;
    tradeCount: number;
    status: "holding" | "closed";
  }>;
};

export function buildStockSummaries(trades: TradeExecution[]): StockPositionSummary[] {
  const grouped = new Map<string, TradeExecution[]>();
  for (const t of trades) {
    const arr = grouped.get(t.symbol) ?? [];
    arr.push(t);
    grouped.set(t.symbol, arr);
  }

  const summaries: StockPositionSummary[] = [];
  for (const [symbol, list] of grouped.entries()) {
    const sorted = [...list].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""),
    );
    const norm = normalizeAShareSymbol(symbol, "stock");
    let buyQty = 0;
    let sellQty = 0;
    let buyCostTotal = 0;
    let sellProceedsTotal = 0;
    let totalFees = 0;
    let buyCount = 0;
    let sellCount = 0;

    let invQty = 0;
    let invCost = 0;
    let realizedPnl = 0;
    let closedCostBasis = 0;

    for (const t of sorted) {
      const fee = t.fee ?? 0;
      totalFees += fee;
      if (t.side === "BUY") {
        buyCount++;
        buyQty += t.quantity;
        buyCostTotal += t.price * t.quantity;
        invQty += t.quantity;
        invCost += t.price * t.quantity + fee;
      } else {
        sellCount++;
        sellQty += t.quantity;
        sellProceedsTotal += t.price * t.quantity;
        const avgCost = invQty > 0 ? invCost / invQty : t.price;
        const matchedQty = Math.min(invQty, t.quantity);
        if (matchedQty > 0) {
          const basis = avgCost * matchedQty;
          realizedPnl += t.price * matchedQty - basis - fee;
          closedCostBasis += basis;
          invQty -= matchedQty;
          invCost = Math.max(0, invCost - basis);
        } else {
          realizedPnl -= fee;
        }
      }
    }

    const avgBuyPrice = buyQty > 0 ? buyCostTotal / buyQty : 0;
    const avgSellPrice = sellQty > 0 ? sellProceedsTotal / sellQty : 0;
    const realizedPnlPct = closedCostBasis > 0 ? (realizedPnl / closedCostBasis) * 100 : 0;
    const displayName = [...sorted].reverse().find((t) => t.name && t.name !== symbol)?.name || symbol;

    summaries.push({
      symbol,
      name: displayName,
      market: norm?.market ?? "SH",
      tradeCount: sorted.length,
      buyCount,
      sellCount,
      buyQty,
      sellQty,
      openQty: Math.max(0, buyQty - sellQty),
      avgBuyPrice: Number(avgBuyPrice.toFixed(2)),
      avgSellPrice: Number(avgSellPrice.toFixed(2)),
      realizedPnl: Number(realizedPnl.toFixed(2)),
      realizedPnlPct: Number(realizedPnlPct.toFixed(2)),
      totalFees: Number(totalFees.toFixed(2)),
      firstDate: sorted[0].date,
      lastDate: sorted[sorted.length - 1].date,
      status: buyQty - sellQty > 0 ? "holding" : "closed",
      trades: sorted,
    });
  }

  return summaries.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.tradeCount - a.tradeCount);
}

export function computeLedgerAnalytics(
  store: LedgerStore,
  benchmarkBars: MarketBar[] = [],
): LedgerAnalytics {
  const benchSpec = A_SHARE_BENCHMARKS.find((b) => b.code === store.settings.benchmarkCode) ?? A_SHARE_BENCHMARKS[0];
  const benchMap = new Map<string, MarketBar>(benchmarkBars.map((b) => [b.date, b]));

  const tradesByDate = new Map<string, TradeExecution[]>();
  for (const t of store.trades) {
    const arr = tradesByDate.get(t.date) ?? [];
    arr.push(t);
    tradesByDate.set(t.date, arr);
  }

  const sortedDaily = [...store.dailyRecords].sort((a, b) => a.date.localeCompare(b.date));
  const equityCurve: EquityPoint[] = [];

  let runningNav = 1.0;
  let prevActualRawNav: number | null = null;
  let peakNav = 1.0;
  let peakDate: string | null = null;
  let maxDd = 0;
  let mddPeakDate: string | null = null;
  let mddTroughDate: string | null = null;

  let baseBenchClose: number | null = null;
  let winDays = 0;
  let lossDays = 0;
  let sumWins = 0;
  let sumLossesAbs = 0;
  let peakPositionPct: number | null = null;
  let marginDays = 0;

  for (const rec of sortedDaily) {
    let dailyRet: number;
    if (rec.nav !== undefined && rec.nav > 0) {
      if (rec.dailyReturnPct !== undefined) {
        dailyRet = rec.dailyReturnPct;
      } else if (prevActualRawNav !== null && prevActualRawNav > 0) {
        dailyRet = ((rec.nav - prevActualRawNav) / prevActualRawNav) * 100;
      } else {
        dailyRet = 0;
      }
      prevActualRawNav = rec.nav;
    } else {
      dailyRet = rec.dailyReturnPct ?? 0;
      prevActualRawNav = null;
    }
    runningNav = runningNav * (1 + dailyRet / 100);

    if (runningNav >= peakNav) {
      peakNav = runningNav;
      peakDate = rec.date;
    }
    const dd = peakNav > 0 ? ((runningNav - peakNav) / peakNav) * 100 : 0;
    if (dd < maxDd) {
      maxDd = dd;
      mddPeakDate = peakDate;
      mddTroughDate = rec.date;
    }

    if (dailyRet > 0.0001) {
      winDays++;
      sumWins += dailyRet;
    } else if (dailyRet < -0.0001) {
      lossDays++;
      sumLossesAbs += Math.abs(dailyRet);
    }

    if (rec.positionPct !== undefined) {
      peakPositionPct = peakPositionPct === null ? rec.positionPct : Math.max(peakPositionPct, rec.positionPct);
      if (rec.positionPct > 100 || rec.marginUsed) marginDays++;
    } else if (rec.marginUsed) {
      marginDays++;
    }

    const bBar = benchMap.get(rec.date);
    let benchmarkNav: number | undefined;
    let benchmarkCumPct: number | undefined;
    let benchmarkDailyPct = rec.benchmarkPct;
    if (bBar && bBar.close > 0) {
      if (baseBenchClose === null) baseBenchClose = bBar.close;
      benchmarkNav = Number((bBar.close / baseBenchClose).toFixed(4));
      benchmarkCumPct = Number(((benchmarkNav - 1) * 100).toFixed(2));
      if (benchmarkDailyPct === undefined && bBar.pctChg !== undefined) {
        benchmarkDailyPct = Number(bBar.pctChg.toFixed(2));
      }
    }

    const cumReturnPct = Number(((runningNav - 1) * 100).toFixed(2));
    const excessAlphaPct =
      benchmarkCumPct !== undefined ? Number((cumReturnPct - benchmarkCumPct).toFixed(2)) : undefined;

    equityCurve.push({
      date: rec.date,
      nav: Number(runningNav.toFixed(4)),
      cumReturnPct,
      dailyReturnPct: Number(dailyRet.toFixed(2)),
      drawdownPct: Number(dd.toFixed(2)),
      positionPct: rec.positionPct,
      marginUsed: rec.marginUsed,
      benchmarkNav,
      benchmarkCumPct,
      benchmarkDailyPct,
      excessAlphaPct,
      tradesCount: tradesByDate.get(rec.date)?.length ?? 0,
      note: rec.note,
      source: rec.source,
    });
  }

  const monthBuckets = new Map<string, EquityPoint[]>();
  for (const pt of equityCurve) {
    const m = pt.date.slice(0, 7);
    const arr = monthBuckets.get(m) ?? [];
    arr.push(pt);
    monthBuckets.set(m, arr);
  }
  const monthly: MonthlyQuantSummary[] = [];
  for (const [month, pts] of [...monthBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let mNav = 1.0;
    let mPeak = 1.0;
    let mMdd = 0;
    let mWins = 0;
    let bNav = 1.0;
    let hasB = false;
    let mTrades = 0;
    for (const p of pts) {
      mNav *= 1 + p.dailyReturnPct / 100;
      if (mNav > mPeak) mPeak = mNav;
      const d = ((mNav - mPeak) / mPeak) * 100;
      if (d < mMdd) mMdd = d;
      if (p.dailyReturnPct > 0) mWins++;
      if (p.benchmarkDailyPct !== undefined) {
        bNav *= 1 + p.benchmarkDailyPct / 100;
        hasB = true;
      }
      mTrades += p.tradesCount;
    }
    monthly.push({
      month,
      returnPct: Number(((mNav - 1) * 100).toFixed(2)),
      benchmarkPct: hasB ? Number(((bNav - 1) * 100).toFixed(2)) : undefined,
      mddPct: Number(mMdd.toFixed(2)),
      tradingDays: pts.length,
      winDays: mWins,
      winRatePct: pts.length > 0 ? Number(((mWins / pts.length) * 100).toFixed(1)) : 0,
      tradesCount: mTrades,
    });
  }

  const stocks = buildStockSummaries(store.trades);
  const closedStocks = stocks.filter((s) => s.sellQty > 0);
  const winningStocks = closedStocks.filter((s) => s.realizedPnl > 0);

  const dailyByDate: Record<string, LedgerDailySnapshot> = {};
  for (const pt of equityCurve) {
    dailyByDate[pt.date] = {
      date: pt.date,
      nav: pt.nav,
      dailyReturnPct: pt.dailyReturnPct,
      cumReturnPct: pt.cumReturnPct,
      drawdownPct: pt.drawdownPct,
      positionPct: pt.positionPct,
      marginUsed: pt.marginUsed,
      benchmarkDailyPct: pt.benchmarkDailyPct,
      excessDailyPct:
        pt.benchmarkDailyPct !== undefined
          ? Number((pt.dailyReturnPct - pt.benchmarkDailyPct).toFixed(2))
          : undefined,
      trades: (tradesByDate.get(pt.date) ?? []).map((t) => ({
        symbol: t.symbol,
        name: t.name,
        side: t.side,
        price: t.price,
        quantity: t.quantity,
        tag: t.tag,
      })),
    };
  }
  for (const [date, list] of tradesByDate.entries()) {
    if (!dailyByDate[date]) {
      dailyByDate[date] = {
        date,
        nav: 1,
        dailyReturnPct: 0,
        cumReturnPct: 0,
        drawdownPct: 0,
        trades: list.map((t) => ({
          symbol: t.symbol,
          name: t.name,
          side: t.side,
          price: t.price,
          quantity: t.quantity,
          tag: t.tag,
        })),
      };
    }
  }

  const lastPt = equityCurve[equityCurve.length - 1];
  const cumReturnPct = lastPt ? lastPt.cumReturnPct : 0;
  const benchmarkReturnPct = lastPt?.benchmarkCumPct ?? null;
  const excessAlphaPct =
    benchmarkReturnPct !== null ? Number((cumReturnPct - benchmarkReturnPct).toFixed(2)) : null;

  const allDates = [...new Set([...sortedDaily.map((d) => d.date), ...store.trades.map((t) => t.date)])].sort();
  const hasDemoData =
    store.dailyRecords.some((d) => d.source === "demo") || store.trades.some((t) => t.source === "demo");

  return {
    hasData: store.dailyRecords.length > 0 || store.trades.length > 0,
    hasDemoData,
    benchmarkCode: benchSpec.code,
    benchmarkName: benchSpec.name,
    dateRange: allDates.length > 0 ? { from: allDates[0], to: allDates[allDates.length - 1] } : null,
    kpi: {
      cumReturnPct,
      benchmarkReturnPct,
      excessAlphaPct,
      mddPct: Number(maxDd.toFixed(2)),
      mddPeakDate,
      mddTroughDate,
      tradingDays: equityCurve.length,
      winDays,
      lossDays,
      dailyWinRatePct:
        winDays + lossDays > 0 ? Number(((winDays / (winDays + lossDays)) * 100).toFixed(1)) : 0,
      profitFactor: sumLossesAbs > 0 ? Number((sumWins / sumLossesAbs).toFixed(2)) : null,
      avgWinPct: winDays > 0 ? Number((sumWins / winDays).toFixed(2)) : 0,
      avgLossPct: lossDays > 0 ? Number((-sumLossesAbs / lossDays).toFixed(2)) : 0,
      peakPositionPct,
      marginDays,
      totalTrades: store.trades.length,
      closedStocksCount: closedStocks.length,
      stockWinRatePct:
        closedStocks.length > 0 ? Number(((winningStocks.length / closedStocks.length) * 100).toFixed(1)) : null,
    },
    equityCurve,
    monthly,
    stocks,
    dailyByDate,
  };
}