import { normalizeAShareSymbol } from "./market";

export type CsvImportKind = "trades" | "daily";

export type CsvColumnMapping = {
  date?: number;
  time?: number;
  symbol?: number;
  name?: number;
  side?: number;
  price?: number;
  quantity?: number;
  amount?: number;
  fee?: number;
  tag?: number;
  note?: number;
  nav?: number;
  dailyReturnPct?: number;
  positionPct?: number;
  benchmarkPct?: number;
};

export type CsvEncoding = "utf-8" | "gb18030" | "utf-16le" | "utf-16be";

export type CsvPreviewResult = {
  ok: true;
  encoding: CsvEncoding;
  delimiter: string;
  detectedKind: CsvImportKind;
  headers: string[];
  mapping: CsvColumnMapping;
  totalRows: number;
  sampleRows: string[][];
  redactedColumns: string[];
};

export const SENSITIVE_COL_RE = /资金账?号|股东代码|证券账?号|合同编号|委托编号|流水号|客户姓名|身份证|银行卡/;

export function normalizeDateStr(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const iso = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const compact = s.match(/\b(\d{4})(\d{2})(\d{2})\b/);
  if (compact) {
    const y = Number(compact[1]);
    const m = Number(compact[2]);
    const d = Number(compact[3]);
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
  }
  return null;
}

export function parseNumberLoose(raw: string | number | undefined): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const s = String(raw ?? "")
    .trim()
    .replace(/[,，￥¥元股手\s]/g, "")
    .replace(/%$/, "");
  if (!s || s === "--" || s === "-" || s === "N/A") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function parseTradeSide(raw: string, qty?: number): "BUY" | "SELL" | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (/卖出|卖|SELL|证券卖出|担保品卖出|融资卖出|减仓|清仓|平仓|^S$|^B\/S:S/.test(s)) return "SELL";
  if (/买入|买|BUY|证券买入|担保品买入|融资买入|建仓|加仓|开仓|^B$|^B\/S:B/.test(s)) return "BUY";
  if (typeof qty === "number" && qty < 0) return "SELL";
  if (typeof qty === "number" && qty > 0 && /成交/.test(s)) return "BUY";
  return null;
}

function decodeCsvBuffer(buf: Buffer): { text: string; encoding: CsvEncoding } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le", { fatal: false }).decode(buf.subarray(2)), encoding: "utf-16le" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder("utf-16be", { fatal: false }).decode(buf.subarray(2)), encoding: "utf-16be" };
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (!utf8.includes("\uFFFD")) {
    return { text: utf8, encoding: "utf-8" };
  }
  try {
    return { text: new TextDecoder("gb18030", { fatal: false }).decode(buf), encoding: "gb18030" };
  } catch {
    return { text: utf8, encoding: "utf-8" };
  }
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 8).join("\n");
  const tabs = (sample.match(/\t/g) || []).length;
  const commas = (sample.match(/,/g) || []).length;
  const semis = (sample.match(/;/g) || []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return "\t";
  if (semis > commas && semis > 0) return ";";
  return ",";
}

export function parseRawCsvTable(buf: Buffer): {
  encoding: CsvEncoding;
  delimiter: string;
  headers: string[];
  rows: string[][];
} {
  const { text, encoding } = decodeCsvBuffer(buf);
  const rawLines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (rawLines.length < 2) {
    return { encoding, delimiter: ",", headers: [], rows: [] };
  }
  const delimiter = detectDelimiter(rawLines);
  const parsed = rawLines.map((l) => splitDelimitedLine(l, delimiter));

  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, parsed.length - 1); i++) {
    const cells = parsed[i];
    if (cells.length >= 2 && cells.some((c) => /日期|时间|date|代码|symbol|净值|nav|收益|买卖|操作/i.test(c))) {
      headerIdx = i;
      break;
    }
  }
  const headers = parsed[headerIdx].map((h) => h.replace(/^="?|"?$/g, "").trim());
  const rows = parsed
    .slice(headerIdx + 1)
    .filter((r) => r.length >= 2 && r.some((c) => c.trim().length > 0))
    .map((r) => r.map((c) => c.replace(/^="?|"?$/g, "").trim()));
  return { encoding, delimiter, headers, rows };
}

export function autoMapCsvColumns(headers: string[]): {
  kind: CsvImportKind;
  mapping: CsvColumnMapping;
  redactedColumns: string[];
} {
  const mapping: CsvColumnMapping = {};
  const redactedColumns: string[] = [];

  headers.forEach((rawH, idx) => {
    const h = rawH.trim();
    if (SENSITIVE_COL_RE.test(h)) {
      redactedColumns.push(h);
      return;
    }
    if (mapping.date === undefined && /成交日期|发生日期|交割日期|交易日期|^日期$|^date$/i.test(h)) mapping.date = idx;
    else if (mapping.time === undefined && /成交时间|委托时间|^时间$|^time$/i.test(h)) mapping.time = idx;
    else if (mapping.symbol === undefined && /证券代码|股票代码|标的代码|代码|symbol|ticker|code/i.test(h)) mapping.symbol = idx;
    else if (mapping.name === undefined && /证券名称|股票名称|标的名称|证券简称|^名称$|^name$/i.test(h)) mapping.name = idx;
    else if (mapping.side === undefined && /买卖标志|买卖方向|业务名称|操作类型|操作|方向|side|action/i.test(h)) mapping.side = idx;
    else if (mapping.price === undefined && /成交均价|成交价格|成交价|价格|price/i.test(h)) mapping.price = idx;
    else if (mapping.quantity === undefined && /成交数量|发生数量|成交股数|数量|股数|qty|quantity|shares/i.test(h)) mapping.quantity = idx;
    else if (mapping.amount === undefined && /成交金额|发生金额|成交额|金额|amount/i.test(h)) mapping.amount = idx;
    else if (mapping.fee === undefined && /手续费|佣金|印花税|过户费|总费用|费用|fee|commission/i.test(h)) mapping.fee = idx;
    else if (mapping.nav === undefined && /单位净值|累计净值|^净值$|^nav$/i.test(h)) mapping.nav = idx;
    else if (mapping.dailyReturnPct === undefined && /当日收益率|日收益率|当日盈亏%|当日涨跌幅|日涨跌幅|收益率|return|pnl_pct/i.test(h))
      mapping.dailyReturnPct = idx;
    else if (mapping.positionPct === undefined && /总仓位|仓位|持股比例|杠杆|position/i.test(h)) mapping.positionPct = idx;
    else if (mapping.benchmarkPct === undefined && /基准涨跌幅|基准收益|沪深300|大盘涨跌|benchmark/i.test(h)) mapping.benchmarkPct = idx;
    else if (mapping.tag === undefined && /策略标签|操作标签|标签|模式|tag/i.test(h)) mapping.tag = idx;
    else if (mapping.note === undefined && /备注|复盘|说明|note|memo/i.test(h)) mapping.note = idx;
  });

  if (mapping.date === undefined) {
    const fallbackIdx = headers.findIndex((h) => /日期|date|day/i.test(h));
    if (fallbackIdx >= 0) mapping.date = fallbackIdx;
  }

  const isTrades =
    mapping.symbol !== undefined &&
    (mapping.side !== undefined || mapping.price !== undefined || mapping.quantity !== undefined);
  return { kind: isTrades ? "trades" : "daily", mapping, redactedColumns };
}

export function previewLedgerCsv(buf: Buffer): CsvPreviewResult | { ok: false; error: string } {
  const { encoding, delimiter, headers, rows } = parseRawCsvTable(buf);
  if (headers.length < 2 || rows.length === 0) {
    return { ok: false, error: "CSV/TSV 内容过短或无法解析出有效表头，请确认至少包含表头行和 1 行数据" };
  }
  const { kind, mapping, redactedColumns } = autoMapCsvColumns(headers);
  const redactedSet = new Set(redactedColumns);
  const sampleRows = rows.slice(0, 6).map((row) =>
    row.map((cell, idx) => (redactedSet.has(headers[idx] ?? "") && cell.trim() ? "***已脱敏***" : cell)),
  );
  return {
    ok: true,
    encoding,
    delimiter,
    detectedKind: kind,
    headers,
    mapping,
    totalRows: rows.length,
    sampleRows,
    redactedColumns,
  };
}

export function parseSymbolSafe(raw: string): string | null {
  return normalizeAShareSymbol(raw, "stock")?.code ?? null;
}

export function generateCsvTemplate(kind: CsvImportKind): string {
  if (kind === "trades") {
    return (
      "\uFEFF" +
      [
        "成交日期,成交时间,证券代码,证券名称,买卖标志,成交价格,成交数量,手续费,操作标签,备注",
        "2026-03-04,09:42:15,002460,赣锋锂业,买入,38.20,1000,9.55,右侧突破,放量站上20日线首笔建仓",
        "2026-03-18,14:15:00,002460,赣锋锂业,卖出,42.60,1000,31.95,分批止盈,情绪高潮冲高兑现",
      ].join("\r\n") +
      "\r\n"
    );
  }
  return (
    "\uFEFF" +
    [
      "日期,当日收益率%,单位净值,总仓位%,基准涨跌幅%,备注",
      "2026-03-02,1.85,1.0185,75,0.62,顺风期聚焦主线核心",
      "2026-03-03,-2.40,0.9941,95,-0.85,早盘追高回落教训",
      "2026-03-04,3.12,1.0251,80,1.10,严格执行去弱留强",
    ].join("\r\n") +
    "\r\n"
  );
}