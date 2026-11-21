import { createHash } from "node:crypto";
import { getAShareDailyBars } from "./market";
import type { DailyNavRecord, TradeExecution } from "./ledger";

function demoId(prefix: string, seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
}

export async function generateDemoLedgerRows(): Promise<{
  dailyRecords: DailyNavRecord[];
  trades: TradeExecution[];
}> {
  const calRes = await getAShareDailyBars({
    symbol: "000300",
    kind: "index",
    start: "2025-10-09",
    end: "2026-04-30",
  });
  const tradingDays =
    calRes.ok && calRes.series.bars.length >= 25
      ? calRes.series.bars
      : [
          "2025-10-09","2025-10-10","2025-10-13","2025-10-14","2025-10-15","2025-10-16","2025-10-17","2025-10-20","2025-10-21","2025-10-22",
          "2025-11-03","2025-11-05","2025-11-10","2025-11-14","2025-11-20","2025-11-26","2025-12-02","2025-12-10","2025-12-18","2025-12-26",
          "2026-01-06","2026-01-14","2026-01-22","2026-02-05","2026-02-12","2026-02-24","2026-03-04","2026-03-12","2026-03-20","2026-03-30",
        ].map((d) => ({ date: d, open: 4000, close: 4000, high: 4050, low: 3950, volume: 100000, pctChg: 0.2 }));

  let nav = 1.0;
  const dailyRecords: DailyNavRecord[] = [];
  for (let i = 0; i < tradingDays.length; i++) {
    const b = tradingDays[i];
    const progress = i / Math.max(tradingDays.length - 1, 1);
    const wave = Math.sin(i * 0.65) * 1.45 + Math.cos(i * 1.37) * 0.95;
    let alpha = 0.22;
    let pos = 78;
    let note: string | undefined;
    if (progress > 0.42 && progress < 0.62) {
      alpha = -0.88;
      pos = 128 + (i % 3) * 6;
      if (i === Math.floor(tradingDays.length * 0.5)) note = "满融逆势补仓导致单日大回撤，违反止损纪律";
    } else if (progress >= 0.62) {
      alpha = 0.36;
      pos = 65 + (i % 4) * 5;
      if (i === Math.floor(tradingDays.length * 0.72)) note = "降至半仓做右侧趋势主升，回撤明显受控";
    } else if (i === 5) {
      note = "顺风期聚焦主线龙头低吸";
    }
    const benchPct = b.pctChg ?? 0;
    const rawDaily = Number(Math.max(-7.8, Math.min(8.4, benchPct * (pos / 100) + alpha + wave * 0.65)).toFixed(2));
    nav = Number((nav * (1 + rawDaily / 100)).toFixed(4));
    dailyRecords.push({
      id: demoId("day", b.date),
      date: b.date,
      nav,
      dailyReturnPct: rawDaily,
      positionPct: pos,
      marginUsed: pos > 100,
      benchmarkPct: Number(benchPct.toFixed(2)),
      note,
      source: "demo",
    });
  }

  const blueprints: Array<{
    symbol: string;
    name: string;
    fallbackPrice: number;
    legs: Array<{ pctIdx: number; side: "BUY" | "SELL"; qty: number; tag: string; note: string }>;
  }> = [
    {
      symbol: "002460",
      name: "赣锋锂业",
      fallbackPrice: 36,
      legs: [
        { pctIdx: 0.08, side: "BUY", qty: 1500, tag: "右侧突破", note: "碳酸锂期货反弹，放量站上20日线建仓" },
        { pctIdx: 0.22, side: "BUY", qty: 1000, tag: "回踩加仓", note: "缩量回踩10日线顺势加仓" },
        { pctIdx: 0.36, side: "SELL", qty: 1500, tag: "分批止盈", note: "情绪高潮冲高回落先兑现利润" },
        { pctIdx: 0.49, side: "BUY", qty: 1200, tag: "冲动抄底", note: "盘中急跌忍不住融资抄底（反例）" },
        { pctIdx: 0.57, side: "SELL", qty: 2200, tag: "纪律止损", note: "破位去杠杆，清仓认错" },
        { pctIdx: 0.78, side: "BUY", qty: 1000, tag: "二波试错", note: "轻仓低吸观察供需拐点" },
      ],
    },
    {
      symbol: "300750",
      name: "宁德时代",
      fallbackPrice: 245,
      legs: [
        { pctIdx: 0.14, side: "BUY", qty: 300, tag: "趋势底仓", note: "业绩超预期，右侧趋势底仓" },
        { pctIdx: 0.41, side: "SELL", qty: 150, tag: "波段减仓", note: "乖离率偏大减半锁盈" },
        { pctIdx: 0.68, side: "BUY", qty: 200, tag: "回踩低吸", note: "大盘企稳回补趋势仓位" },
        { pctIdx: 0.88, side: "SELL", qty: 350, tag: "目标止盈", note: "达到盈亏比目标分批落袋" },
      ],
    },
    {
      symbol: "601899",
      name: "紫金矿业",
      fallbackPrice: 17.5,
      legs: [
        { pctIdx: 0.18, side: "BUY", qty: 4000, tag: "资源周期", note: "铜金比价共振，顺周期配置" },
        { pctIdx: 0.52, side: "SELL", qty: 2000, tag: "风控降仓", note: "账户整体回撤触发总仓位红线，先降一半" },
        { pctIdx: 0.72, side: "BUY", qty: 2000, tag: "趋势回补", note: "商品价格新高重新接回" },
        { pctIdx: 0.91, side: "SELL", qty: 2000, tag: "做T止盈", note: "冲高兑现一半降低持仓成本" },
      ],
    },
    {
      symbol: "002176",
      name: "江特电机",
      fallbackPrice: 9.2,
      legs: [
        { pctIdx: 0.28, side: "BUY", qty: 5000, tag: "板块补涨", note: "锂矿主线扩散试错补涨弹性标" },
        { pctIdx: 0.46, side: "SELL", qty: 5000, tag: "不及预期止损", note: "弱势跟风股最先掉队，坚决斩仓" },
      ],
    },
  ];

  const trades: TradeExecution[] = [];
  for (const bp of blueprints) {
    const sRes = await getAShareDailyBars({
      symbol: bp.symbol,
      kind: "stock",
      start: tradingDays[0].date,
      end: tradingDays[tradingDays.length - 1].date,
    });
    const bars = sRes.ok && sRes.series.bars.length >= 10 ? sRes.series.bars : null;
    for (const leg of bp.legs) {
      let date: string;
      let price: number;
      if (bars) {
        const idx = Math.min(bars.length - 1, Math.max(0, Math.floor(bars.length * leg.pctIdx)));
        const bar = bars[idx];
        date = bar.date;
        price = Number((leg.side === "BUY" ? (bar.open + bar.low) / 2 : (bar.close + bar.high) / 2).toFixed(2));
      } else {
        const idx = Math.min(tradingDays.length - 1, Math.floor(tradingDays.length * leg.pctIdx));
        date = tradingDays[idx].date;
        price = bp.fallbackPrice;
      }
      const amount = Number((price * leg.qty).toFixed(2));
      const fee = Number(Math.max(5, amount * (leg.side === "SELL" ? 0.0007 : 0.0002)).toFixed(2));
      trades.push({
        id: demoId("trd", `demo|${bp.symbol}|${date}|${leg.side}|${leg.qty}`),
        date,
        time: leg.side === "BUY" ? "09:45:00" : "14:20:00",
        symbol: bp.symbol,
        name: sRes.ok ? sRes.series.name || bp.name : bp.name,
        side: leg.side,
        price,
        quantity: leg.qty,
        amount,
        fee,
        tag: leg.tag,
        note: leg.note,
        source: "demo",
      });
    }
  }

  return { dailyRecords, trades };
}