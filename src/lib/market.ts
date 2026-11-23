import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ensureWorkspace, writeAtomic } from "./workspace";

export type MarketBar = {
  date: string;       // YYYY-MM-DD
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount?: number;
  pctChg?: number;    // daily % change
  turnover?: number;
};

export type MarketSeries = {
  symbol: string;       // 6-digit code e.g. "002460" or "000300"
  secid: string;        // Eastmoney secid e.g. "0.002460" or "1.000300"
  name: string;
  kind: "stock" | "index";
  adjusted: "qfq" | "none";
  bars: MarketBar[];
  source: "eastmoney" | "tencent" | "cache";
  fetchedAt: string;
};

export type SymbolSuggestion = {
  symbol: string;
  name: string;
  market: "SH" | "SZ" | "BJ";
  kind: "stock" | "index";
};

export type BenchmarkSpec = {
  code: string;
  name: string;
  secid: string;
  txCode: string;
};

export const A_SHARE_BENCHMARKS: BenchmarkSpec[] = [
  { code: "000300", name: "沪深300", secid: "1.000300", txCode: "sh000300" },
  { code: "000001", name: "上证指数", secid: "1.000001", txCode: "sh000001" },
  { code: "399006", name: "创业板指", secid: "0.399006", txCode: "sz399006" },
  { code: "000688", name: "科创50", secid: "1.000688", txCode: "sh000688" },
  { code: "000852", name: "中证1000", secid: "1.000852", txCode: "sh000852" },
];

const BENCHMARK_MAP = new Map(A_SHARE_BENCHMARKS.map((b) => [b.code, b]));

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Normalize raw A-share ticker strings like "SH600519", "600519.SH", "sz002460", "2460" -> 6-digit code + market prefix.
 */
export function normalizeAShareSymbol(
  raw: string,
  kind: "stock" | "index" = "stock",
): { code: string; secid: string; txCode: string; market: "SH" | "SZ" | "BJ" } | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;

  let explicitMarket: "SH" | "SZ" | "BJ" | null = null;
  if (/^(SH|SS)|\.SH$|\.SS$/.test(s)) explicitMarket = "SH";
  else if (/^SZ|\.SZ$/.test(s)) explicitMarket = "SZ";
  else if (/^BJ|\.BJ$/.test(s)) explicitMarket = "BJ";

  const digitsMatch = s.match(/(\d{4,6})/);
  if (!digitsMatch) return null;
  const code = digitsMatch[1].padStart(6, "0");

  if (kind === "index") {
    const known = BENCHMARK_MAP.get(code);
    if (known) {
      return {
        code: known.code,
        secid: known.secid,
        txCode: known.txCode,
        market: known.secid.startsWith("1.") ? "SH" : "SZ",
      };
    }
    const isSz = explicitMarket === "SZ" || code.startsWith("399");
    return {
      code,
      secid: `${isSz ? 0 : 1}.${code}`,
      txCode: `${isSz ? "sz" : "sh"}${code}`,
      market: isSz ? "SZ" : "SH",
    };
  }

  let market: "SH" | "SZ" | "BJ";
  if (explicitMarket) {
    market = explicitMarket;
  } else if (
    code.startsWith("6") ||
    code.startsWith("5") ||
    code.startsWith("11") ||
    code.startsWith("900")
  ) {
    market = "SH";
  } else if (code.startsWith("8") || code.startsWith("4") || code.startsWith("92")) {
    market = "BJ";
  } else {
    market = "SZ";
  }

  const emPrefix = market === "SH" ? "1" : "0";
  const txPrefix = market.toLowerCase();
  return { code, secid: `${emPrefix}.${code}`, txCode: `${txPrefix}${code}`, market };
}

function toCompactDate(ymd: string): string {
  return ymd.replace(/[^0-9]/g, "").slice(0, 8);
}

function fillPctChg(bars: MarketBar[]): MarketBar[] {
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].pctChg === undefined && i > 0 && bars[i - 1].close > 0) {
      bars[i].pctChg = Number((((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100).toFixed(2));
    }
  }
  return bars;
}

async function fetchFromEastmoney(
  secid: string,
  kind: "stock" | "index",
  startYmd: string,
  endYmd: string,
): Promise<{ name: string; bars: MarketBar[] } | null> {
  const fqt = kind === "stock" ? "1" : "0";
  const beg = toCompactDate(startYmd);
  const end = toCompactDate(endYmd);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=${fqt}&beg=${beg}&end=${end}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: { name?: string; klines?: string[] } | null;
  };
  const klines = json?.data?.klines;
  if (!Array.isArray(klines) || klines.length === 0) return null;

  const bars: MarketBar[] = [];
  for (const row of klines) {
    const parts = row.split(",");
    if (parts.length < 6) continue;
    const [date, open, close, high, low, vol, amount, _amp, pctChg, _chg, turnover] = parts;
    const o = Number(open);
    const c = Number(close);
    const h = Number(high);
    const l = Number(low);
    const v = Number(vol);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(c) || c <= 0) continue;
    bars.push({
      date,
      open: Number.isFinite(o) ? o : c,
      close: c,
      high: Number.isFinite(h) ? h : Math.max(o, c),
      low: Number.isFinite(l) ? l : Math.min(o, c),
      volume: Number.isFinite(v) ? v : 0,
      amount: Number.isFinite(Number(amount)) ? Number(amount) : undefined,
      pctChg: Number.isFinite(Number(pctChg)) ? Number(pctChg) : undefined,
      turnover: Number.isFinite(Number(turnover)) ? Number(turnover) : undefined,
    });
  }
  return bars.length > 0 ? { name: json.data?.name || secid, bars: fillPctChg(bars) } : null;
}

async function fetchFromTencent(
  txCode: string,
  kind: "stock" | "index",
  startYmd: string,
  endYmd: string,
): Promise<{ name: string; bars: MarketBar[] } | null> {
  const adj = kind === "stock" ? "qfq" : "";
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(txCode)},day,${startYmd},${endYmd},640,${adj}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: Record<string, { qfqday?: string[][]; day?: string[][]; qt?: Record<string, string[]> }>;
  };
  const node = json?.data?.[txCode];
  const rows = node?.qfqday || node?.day;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const qtArr = node?.qt?.[txCode];
  const name = Array.isArray(qtArr) && qtArr[1] ? qtArr[1] : txCode;

  const bars: MarketBar[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const [date, open, close, high, low, vol] = r;
    const o = Number(open);
    const c = Number(close);
    const h = Number(high);
    const l = Number(low);
    const v = Number(vol);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(c) || c <= 0) continue;
    bars.push({
      date,
      open: Number.isFinite(o) ? o : c,
      close: c,
      high: Number.isFinite(h) ? h : Math.max(o, c),
      low: Number.isFinite(l) ? l : Math.min(o, c),
      volume: Number.isFinite(v) ? v : 0,
    });
  }
  return bars.length > 0 ? { name, bars: fillPctChg(bars) } : null;
}

function mergeBars(existing: MarketBar[], incoming: MarketBar[]): MarketBar[] {
  const map = new Map<string, MarketBar>();
  for (const b of existing) map.set(b.date, b);
  for (const b of incoming) map.set(b.date, b);
  return fillPctChg([...map.values()].sort((a, b) => a.date.localeCompare(b.date)));
}

function filterBars(bars: MarketBar[], start?: string, end?: string): MarketBar[] {
  return bars.filter((b) => (!start || b.date >= start) && (!end || b.date <= end));
}

export async function getAShareDailyBars(args: {
  symbol: string;
  kind?: "stock" | "index";
  start?: string;
  end?: string;
  forceRefresh?: boolean;
}): Promise<{ ok: true; series: MarketSeries } | { ok: false; error: string }> {
  const kind = args.kind ?? "stock";
  const norm = normalizeAShareSymbol(args.symbol, kind);
  if (!norm) return { ok: false, error: `无法识别的 A 股代码：${args.symbol}` };

  const today = new Date().toISOString().slice(0, 10);
  const start = args.start && /^\d{4}-\d{2}-\d{2}$/.test(args.start) ? args.start : "2023-01-01";
  const end = args.end && /^\d{4}-\d{2}-\d{2}$/.test(args.end) ? args.end : today;

  const paths = await ensureWorkspace();
  const cacheFile = path.join(paths.marketCache, `${kind}_${norm.secid.replace(".", "_")}.json`);

  let cached: MarketSeries | null = null;
  let cacheAgeMs = Infinity;
  try {
    const info = await stat(cacheFile);
    cacheAgeMs = Date.now() - info.mtimeMs;
    cached = JSON.parse(await readFile(cacheFile, "utf8")) as MarketSeries;
  } catch {
    cached = null;
  }

  const cacheCoversRange =
    cached &&
    cached.bars.length > 0 &&
    cached.bars[0].date <= start &&
    (end < today ? cached.bars[cached.bars.length - 1].date >= end : cacheAgeMs < 2 * 60 * 60 * 1000);

  if (!args.forceRefresh && cacheCoversRange && cached) {
    return {
      ok: true,
      series: {
        ...cached,
        bars: filterBars(cached.bars, start, end),
        source: "cache",
      },
    };
  }

  const fetchStartDate = new Date(start + "T00:00:00Z");
  fetchStartDate.setUTCDate(fetchStartDate.getUTCDate() - 45);
  const fetchStart = fetchStartDate.toISOString().slice(0, 10);
  const fetchEnd = end < today ? end : today;

  let fetched: { name: string; bars: MarketBar[] } | null = null;
  let source: "eastmoney" | "tencent" = "eastmoney";

  try {
    fetched = await fetchFromEastmoney(norm.secid, kind, fetchStart, today);
  } catch {
    fetched = null;
  }

  if (!fetched) {
    source = "tencent";
    try {
      fetched = await fetchFromTencent(norm.txCode, kind, fetchStart, fetchEnd);
    } catch {
      fetched = null;
    }
  }

  if (fetched && fetched.bars.length > 0) {
    let baseExisting = cached?.bars ?? [];
    if (kind === "stock" && baseExisting.length > 0) {
      const existingByDate = new Map(baseExisting.map((b) => [b.date, b]));
      const hasQfqDrift = fetched.bars.some((b) => {
        const old = existingByDate.get(b.date);
        return old !== undefined && Math.abs(old.close - b.close) > 0.015;
      });
      if (hasQfqDrift) {
        if (baseExisting[0].date < fetched.bars[0].date) {
          try {
            const fullRefetch =
              source === "eastmoney"
                ? await fetchFromEastmoney(norm.secid, kind, baseExisting[0].date, today)
                : await fetchFromTencent(norm.txCode, kind, baseExisting[0].date, fetchEnd);
            if (fullRefetch && fullRefetch.bars.length > 0) {
              fetched = fullRefetch;
            }
          } catch {
            /* keep fetched range */
          }
        }
        baseExisting = [];
      }
    }
    const merged = mergeBars(baseExisting, fetched.bars);
    const fullSeries: MarketSeries = {
      symbol: norm.code,
      secid: norm.secid,
      name: BENCHMARK_MAP.get(norm.code)?.name || fetched.name || cached?.name || norm.code,
      kind,
      adjusted: kind === "stock" ? "qfq" : "none",
      bars: merged,
      source,
      fetchedAt: new Date().toISOString(),
    };
    await writeAtomic(cacheFile, JSON.stringify(fullSeries));
    return {
      ok: true,
      series: {
        ...fullSeries,
        bars: filterBars(merged, start, end),
      },
    };
  }

  if (cached && cached.bars.length > 0) {
    return {
      ok: true,
      series: {
        ...cached,
        bars: filterBars(cached.bars, start, end),
        source: "cache",
      },
    };
  }

  return { ok: false, error: `拉取 ${norm.code} 日线行情失败（请检查网络连接或确认股票代码正确）` };
}

export async function searchAShareSymbols(query: string): Promise<SymbolSuggestion[]> {
  const q = query.trim();
  if (!q) return [];

  const out: SymbolSuggestion[] = [];
  const seen = new Set<string>();
  for (const b of A_SHARE_BENCHMARKS) {
    if (b.code.includes(q) || b.name.includes(q)) {
      seen.add(b.code);
      out.push({
        symbol: b.code,
        name: b.name,
        market: b.secid.startsWith("1.") ? "SH" : "SZ",
        kind: "index",
      });
    }
  }

  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(q)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=8`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        QuotationCodeTable?: {
          Data?: Array<{ Code?: string; Name?: string; Classify?: string; SecurityTypeName?: string }>;
        };
      };
      for (const item of json?.QuotationCodeTable?.Data ?? []) {
        const code = String(item.Code || "").trim();
        const name = String(item.Name || "").trim();
        if (!/^\d{6}$/.test(code) || !name || seen.has(code)) continue;
        const isAStock =
          item.Classify === "AStock" ||
          item.Classify === "Index" ||
          /沪A|深A|北A|创业板|科创板|指数/.test(item.SecurityTypeName || "");
        if (!isAStock) continue;
        seen.add(code);
        const norm = normalizeAShareSymbol(code, item.Classify === "Index" ? "index" : "stock");
        out.push({
          symbol: code,
          name,
          market: norm?.market ?? "SH",
          kind: item.Classify === "Index" ? "index" : "stock",
        });
      }
      if (out.length > 0) return out.slice(0, 10);
    }
  } catch {
    /* fallback to Tencent */
  }

  try {
    const res = await fetch(`https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(q)}&t=gp`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const text = await res.text();
      const m = text.match(/v_hint="([^"]*)"/);
      if (m && m[1]) {
        for (const chunk of m[1].split("^")) {
          const parts = chunk.split("~");
          if (parts.length < 3) continue;
          const mkt = parts[0].toUpperCase();
          const code = parts[1];
          const rawName = parts[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
          if ((mkt === "SH" || mkt === "SZ" || mkt === "BJ") && /^\d{6}$/.test(code) && !seen.has(code)) {
            seen.add(code);
            out.push({ symbol: code, name: rawName, market: mkt, kind: "stock" });
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  return out.slice(0, 10);
}