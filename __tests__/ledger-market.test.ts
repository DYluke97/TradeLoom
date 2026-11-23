import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAShareSymbol } from "../src/lib/market";
import { generateCsvTemplate, previewLedgerCsv } from "../src/lib/ledger-csv";
import { buildStockSummaries, computeLedgerAnalytics } from "../src/lib/ledger-analytics";
import {
  buildPeriodQuantBrief,
  importLedgerCsv,
  type DailyNavRecord,
  type LedgerStore,
  type TradeExecution,
} from "../src/lib/ledger";
import { exportReportToObsidianMarkdown, type SynthesisReport } from "../src/lib/synthesis";

const E_TMP_BASE = "E:/.dev-cache/tmp";

describe("Sprint 3: A-share symbol normalization, CSV broker import, quant analytics & privacy", () => {
  it("normalizes SH/SZ/BJ stock codes and benchmark indices accurately", () => {
    const sh = normalizeAShareSymbol("600519");
    expect(sh).toEqual({ code: "600519", market: "SH", secid: "1.600519", txCode: "sh600519" });

    const sz = normalizeAShareSymbol("SZ002460");
    expect(sz).toEqual({ code: "002460", market: "SZ", secid: "0.002460", txCode: "sz002460" });

    const bj = normalizeAShareSymbol("832566");
    expect(bj).toEqual({ code: "832566", market: "BJ", secid: "0.832566", txCode: "bj832566" });

    const hs300 = normalizeAShareSymbol("000300", "index");
    expect(hs300).toEqual({ code: "000300", market: "SH", secid: "1.000300", txCode: "sh000300" });

    const cyb = normalizeAShareSymbol("399006", "index");
    expect(cyb).toEqual({ code: "399006", market: "SZ", secid: "0.399006", txCode: "sz399006" });

    const shBond = normalizeAShareSymbol("113050");
    expect(shBond).toEqual({ code: "113050", market: "SH", secid: "1.113050", txCode: "sh113050" });

    const szBond = normalizeAShareSymbol("128130");
    expect(szBond).toEqual({ code: "128130", market: "SZ", secid: "0.128130", txCode: "sz128130" });

    expect(normalizeAShareSymbol("INVALID")).toBeNull();
  });

  it("decodes UTF-16LE BOM TSV exports and preserves empty leading columns without shifting indices", () => {
    const tsvText = [
      "备注\t成交日期\t证券代码\t证券名称\t买卖标志\t成交价格\t成交数量",
      "\t2026-03-10\t113050\t南银转债\t买入\t118.50\t100",
    ].join("\r\n");
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from(tsvText, "utf16le");
    const preview = previewLedgerCsv(Buffer.concat([bom, body]));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.encoding).toBe("utf-16le");
    expect(preview.delimiter).toBe("\t");
    expect(preview.sampleRows[0][preview.mapping.date!]).toBe("2026-03-10");
    expect(preview.sampleRows[0][preview.mapping.symbol!]).toBe("113050");
  });

  it("compounds mixed raw NAV and dailyReturnPct records smoothly without resetting or exploding", () => {
    const store: LedgerStore = {
      version: 1,
      updatedAt: "2026-03-05T00:00:00Z",
      settings: { benchmarkCode: "000300", colorScheme: "cn" },
      dailyRecords: [
        { id: "m1", date: "2026-03-01", nav: 100, source: "csv" },
        { id: "m2", date: "2026-03-02", dailyReturnPct: 5, source: "manual" },
        { id: "m3", date: "2026-03-03", nav: 105, source: "csv" },
        { id: "m4", date: "2026-03-04", nav: 115.5, source: "csv" },
      ],
      trades: [],
    };
    const analytics = computeLedgerAnalytics(store, []);
    expect(analytics.equityCurve[1].cumReturnPct).toBeCloseTo(5.0, 2);
    expect(analytics.equityCurve[2].dailyReturnPct).toBe(0);
    expect(analytics.equityCurve[2].cumReturnPct).toBeCloseTo(5.0, 2);
    expect(analytics.equityCurve[3].dailyReturnPct).toBeCloseTo(10.0, 2);
    expect(analytics.kpi.cumReturnPct).toBeCloseTo(15.5, 2);
  });

  it("parses Chinese broker trade CSV, skips banner rows, and redacts sensitive account columns", () => {
    const rawCsv = [
      "某券商客户交割单导出 (2026-01-01 至 2026-03-31)",
      "成交日期,证券代码,证券名称,买卖标志,成交价格,成交数量,手续费,印花税,资金账号,股东代码,合同编号",
      "20260108,002460,赣锋锂业,证券买入,38.50,1000,11.55,0,88800123456,A009876543,HT2026010801",
      "2026-01-20,002460,赣锋锂业,证券卖出,42.35,1000,12.71,21.18,88800123456,A009876543,HT2026012002",
    ].join("\n");

    const preview = previewLedgerCsv(Buffer.from(rawCsv, "utf-8"));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.detectedKind).toBe("trades");
    expect(preview.totalRows).toBe(2);
    expect(preview.headers[preview.mapping.date!]).toBe("成交日期");
    expect(preview.headers[preview.mapping.symbol!]).toBe("证券代码");
    expect(preview.headers[preview.mapping.side!]).toBe("买卖标志");
    expect(preview.redactedColumns).toContain("资金账号");
    expect(preview.redactedColumns).toContain("股东代码");
    expect(preview.redactedColumns).toContain("合同编号");
    // headers preserve column index alignment while sampleRows redact sensitive cell values
    for (const row of preview.sampleRows) {
      const joined = row.join("|");
      expect(joined).not.toContain("88800123456");
      expect(joined).not.toContain("A009876543");
    }
  });

  it("auto-detects daily NAV template and generates valid downloadable CSV templates", () => {
    const dailyTpl = generateCsvTemplate("daily");
    const tradesTpl = generateCsvTemplate("trades");
    const p1 = previewLedgerCsv(Buffer.from(dailyTpl, "utf-8"));
    const p2 = previewLedgerCsv(Buffer.from(tradesTpl, "utf-8"));
    expect(p1.ok && p1.detectedKind).toBe("daily");
    expect(p2.ok && p2.detectedKind).toBe("trades");
  });

  it("computes accurate NAV return, MDD, Win Rate, Profit Factor, Benchmark Alpha, and weighted-avg stock PnL", () => {
    const daily: DailyNavRecord[] = [
      { id: "d1", date: "2026-01-05", nav: 1.0, dailyReturnPct: 0, positionPct: 60, source: "manual" },
      { id: "d2", date: "2026-01-06", nav: 1.05, dailyReturnPct: 5.0, positionPct: 80, source: "manual" },
      { id: "d3", date: "2026-01-07", nav: 0.9975, dailyReturnPct: -5.0, positionPct: 110, marginUsed: true, source: "manual" },
      { id: "d4", date: "2026-01-08", nav: 1.09725, dailyReturnPct: 10.0, positionPct: 90, source: "manual" },
    ];
    const trades: TradeExecution[] = [
      { id: "t1", date: "2026-01-05", symbol: "002460", name: "赣锋锂业", side: "BUY", price: 40, quantity: 1000, amount: 40000, fee: 10, source: "manual" },
      { id: "t2", date: "2026-01-06", symbol: "002460", name: "赣锋锂业", side: "BUY", price: 50, quantity: 1000, amount: 50000, fee: 10, source: "manual" },
      { id: "t3", date: "2026-01-08", symbol: "002460", name: "赣锋锂业", side: "SELL", price: 55, quantity: 1000, amount: 55000, fee: 50, source: "manual" },
    ];
    const store: LedgerStore = {
      version: 1,
      updatedAt: "2026-01-08T00:00:00Z",
      settings: { benchmarkCode: "000300", colorScheme: "cn" },
      dailyRecords: daily,
      trades,
    };
    const bench = [
      { date: "2026-01-05", open: 4000, high: 4010, low: 3990, close: 4000, volume: 100 },
      { date: "2026-01-06", open: 4000, high: 4040, low: 3990, close: 4040, volume: 100 },
      { date: "2026-01-07", open: 4040, high: 4050, low: 4010, close: 4020, volume: 100 },
      { date: "2026-01-08", open: 4020, high: 4090, low: 4010, close: 4080, volume: 100 },
    ];

    const summaries = buildStockSummaries(trades);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].symbol).toBe("002460");
    expect(summaries[0].avgBuyPrice).toBeCloseTo(45, 2);
    expect(summaries[0].openQty).toBe(1000);
    // Weighted buy cost including pro-rata buy fees = (40010 + 50010) / 2000 = 45.01; realized = (55 - 45.01)*1000 - 50 = 9940
    expect(summaries[0].realizedPnl).toBeCloseTo(9940, 0);
    expect(summaries[0].status).toBe("holding");

    const analytics = computeLedgerAnalytics(store, bench);
    expect(analytics.kpi.cumReturnPct).toBeCloseTo(9.725, 1);
    expect(analytics.kpi.benchmarkReturnPct).toBeCloseTo(2.0, 1);
    expect(analytics.kpi.excessAlphaPct).toBeCloseTo(7.725, 1);
    expect(analytics.kpi.mddPct).toBeCloseTo(-5.0, 1);
    expect(analytics.kpi.mddPeakDate).toBe("2026-01-06");
    expect(analytics.kpi.mddTroughDate).toBe("2026-01-07");
    expect(analytics.kpi.peakPositionPct).toBe(110);
    expect(analytics.kpi.marginDays).toBe(1);
    expect(analytics.kpi.dailyWinRatePct).toBeCloseTo(66.7, 0);
    expect(analytics.kpi.profitFactor).toBeCloseTo(3.0, 1);
  });

  it("imports CSV into isolated workspace, deduplicates, and builds privacy-safe PeriodQuantBrief without raw RMB", async () => {
    await mkdir(E_TMP_BASE, { recursive: true });
    const tmp = await mkdtemp(path.join(E_TMP_BASE, "tl-ledger-"));
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;
    try {
      const dailyCsv = [
        "日期,单位净值,当日涨跌幅,总资产,仓位,融资,备注,资金账号",
        "2026-02-02,1.0000,0%,9876543.21,70%,否,建仓日,ACC999888777",
        "2026-02-03,1.0420,+4.20%,10291358.02,85%,否,放量突破,ACC999888777",
        "2026-02-04,0.9980,-4.22%,9856790.12,115%,是,高杠杆追高回撤,ACC999888777",
      ].join("\n");

      const r1 = await importLedgerCsv({ buf: Buffer.from(dailyCsv, "utf-8") });
      expect(r1.ok).toBe(true);
      if (r1.ok) {
        expect(r1.imported).toBe(3);
        expect(r1.redactedColumns).toContain("资金账号");
      }

      const tradesCsv = [
        "成交日期,证券代码,证券名称,方向,成交价,数量,手续费,资金账号",
        "2026-02-02,300750,宁德时代,买入,210.0,1000,63,ACC999888777",
        "2026-02-04,300750,宁德时代,卖出,202.0,1000,161,ACC999888777",
      ].join("\n");
      const r2 = await importLedgerCsv({ buf: Buffer.from(tradesCsv, "utf-8") });
      expect(r2.ok).toBe(true);
      const r2Dup = await importLedgerCsv({ buf: Buffer.from(tradesCsv, "utf-8") });
      expect(r2Dup.ok).toBe(false);
      if (!r2Dup.ok) {
        expect(r2Dup.error).toContain("跳过 2 行");
      }

      // Cross-period cost basis check: buy in Jan @ 100, sell in Feb @ 120 -> Feb brief reflects +20% realized PnL
      const crossCsv = [
        "成交日期,证券代码,证券名称,方向,成交价,数量,手续费,资金账号",
        "2026-01-15,600519,贵州茅台,买入,1400.0,100,0,ACC999888777",
        "2026-02-10,600519,贵州茅台,卖出,1540.0,100,0,ACC999888777",
      ].join("\n");
      const rCross = await importLedgerCsv({
        buf: Buffer.from(crossCsv, "utf-8"),
        mapping: { date: 0, symbol: 1, name: 2, side: 3, price: 4, quantity: 5, note: 7 },
      });
      expect(rCross.ok).toBe(true);
      if (rCross.ok) {
        // Explicit mapping attempting to map sensitive column #7 ("资金账号") into note must be stripped
        const mtSell = rCross.store.trades.find((t) => t.symbol === "600519" && t.date === "2026-02-10");
        expect(mtSell?.note).toBeUndefined();
      }

      const brief = await buildPeriodQuantBrief("2026-02-01", "2026-02-28");
      expect(brief).not.toBeNull();
      const mtStat = brief!.stockStats.find((s) => s.symbol === "600519");
      expect(mtStat?.realizedPnlPct).toBeCloseTo(10.0, 1);
      expect(mtStat?.tradeCount).toBe(1);
      const serialized = JSON.stringify(brief);
      expect(serialized).not.toContain("9876543");
      expect(serialized).not.toContain("10291358");
      expect(serialized).not.toContain("ACC999888777");
      expect(brief!.matchedDays).toBe(3);
      expect(brief!.marginDays).toBe(1);
      expect(brief!.peakPositionPct).toBe(115);

      const mockReport: SynthesisReport = {
        id: "r-test",
        schema: "tradeloom-playbook@v1",
        fingerprint: "fp-test",
        source_docs: [],
        usage: { promptTokens: 100, completionTokens: 100 },
        title: "测试阶段手册",
        skill_id: "short-term",
        skill_name: "短线博弈",
        model: "test-model",
        created_at: "2026-02-05T00:00:00Z",
        date_range: { from: "2026-02-01", to: "2026-02-28" },
        overview: { summary: "总览测试", conditions: [], counterexamples: [] },
        timeline: [],
        manual: [
          {
            id: "R01",
            title: "高杠杆追高必须止损",
            context: "放量分歧",
            condition: "回撤超3%",
            action: "降仓至50%",
            exit: "跌破5日线",
            counterexample: "2月4日未执行",
            lifecycle: "validated",
            quant_warning: "实盘 2026-02-04 仓位 115% 且单日回撤 -4.22%，存在知行背离",
            evidence: [],
            known_dates: ["2026-02-04"],
          },
        ],
        quant_anchor: brief,
        statistics: { docs_count: 3, timeline_count: 0, rules_count: 1, evidence_used: 0, multi_date_rules: 0 },
        warnings: [],
      };
      const md = exportReportToObsidianMarkdown(mockReport);
      expect(md).toContain("客观实盘量化锚点");
      expect(md).toContain("实盘定量核验警示");
      expect(md).not.toContain("9876543");
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});