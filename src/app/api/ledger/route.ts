import { NextResponse } from "next/server";
import {
  addTradeExecution,
  buildPeriodQuantBrief,
  clearDemoLedger,
  deleteDailyRecord,
  deleteTradeExecution,
  getFullLedgerWithBenchmark,
  importLedgerCsv,
  loadDemoLedger,
  previewLedgerCsv,
  updateLedgerSettings,
  upsertDailyRecord,
  type CsvColumnMapping,
  type CsvImportKind,
} from "@/lib/ledger";
import { A_SHARE_BENCHMARKS } from "@/lib/market";
import { loadOrBuildVault } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function buildReviewDateMap(): Promise<Record<string, Array<{ card: string; title: string; kind: string }>>> {
  try {
    const { index: idx } = await loadOrBuildVault();
    const map: Record<string, Array<{ card: string; title: string; kind: string }>> = {};
    for (const d of idx.documents) {
      if (!d.event_date) continue;
      const arr = map[d.event_date] ?? [];
      arr.push({ card: d.card, title: d.title, kind: d.kind });
      map[d.event_date] = arr;
    }
    return map;
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") || "full";

  if (mode === "brief") {
    const from = searchParams.get("from")?.trim() || undefined;
    const to = searchParams.get("to")?.trim() || undefined;
    const brief = await buildPeriodQuantBrief(from, to);
    return NextResponse.json({ ok: true, brief });
  }

  const lite = mode === "lite";
  const [{ store, analytics }, reviewsByDate] = await Promise.all([
    getFullLedgerWithBenchmark(lite),
    lite ? Promise.resolve({}) : buildReviewDateMap(),
  ]);

  if (lite) {
    return NextResponse.json({
      ok: true,
      hasData: analytics.hasData,
      settings: store.settings,
      benchmarkName: analytics.benchmarkName,
      monthly: analytics.monthly,
      dailyByDate: analytics.dailyByDate,
    });
  }

  return NextResponse.json({
    ok: true,
    settings: store.settings,
    benchmarks: A_SHARE_BENCHMARKS,
    analytics,
    dailyRecords: store.dailyRecords,
    trades: store.trades,
    reviewsByDate,
  });
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  // Multipart CSV/TSV preview or commit
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "请选择 CSV / TSV 文件" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const action = String(form.get("action") || "preview");

    if (action === "preview") {
      const preview = previewLedgerCsv(buf);
      return NextResponse.json(preview, { status: preview.ok ? 200 : 400 });
    }

    const kindRaw = String(form.get("kind") || "");
    const kind: CsvImportKind | undefined = kindRaw === "trades" || kindRaw === "daily" ? kindRaw : undefined;
    let mapping: CsvColumnMapping | undefined;
    const mappingRaw = form.get("mapping");
    if (typeof mappingRaw === "string" && mappingRaw.trim()) {
      try {
        mapping = JSON.parse(mappingRaw) as CsvColumnMapping;
      } catch {
        return NextResponse.json({ ok: false, error: "列映射 JSON 格式无效" }, { status: 400 });
      }
    }

    const res = await importLedgerCsv({ buf, kind, mapping });
    if (!res.ok) return NextResponse.json(res, { status: 400 });
    const [{ analytics }, reviewsByDate] = await Promise.all([
      getFullLedgerWithBenchmark(false),
      buildReviewDateMap(),
    ]);
    return NextResponse.json({
      ok: true,
      kind: res.kind,
      imported: res.imported,
      skipped: res.skipped,
      redactedColumns: res.redactedColumns,
      settings: res.store.settings,
      analytics,
      dailyRecords: res.store.dailyRecords,
      trades: res.store.trades,
      reviewsByDate,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是有效 JSON" }, { status: 400 });
  }

  const action = String(body.action || "");

  if (action === "upsert-daily") {
    const res = await upsertDailyRecord({
      date: String(body.date || ""),
      nav: body.nav !== undefined && body.nav !== "" ? Number(body.nav) : undefined,
      dailyReturnPct:
        body.dailyReturnPct !== undefined && body.dailyReturnPct !== "" ? Number(body.dailyReturnPct) : undefined,
      positionPct: body.positionPct !== undefined && body.positionPct !== "" ? Number(body.positionPct) : undefined,
      marginUsed: typeof body.marginUsed === "boolean" ? body.marginUsed : undefined,
      benchmarkPct:
        body.benchmarkPct !== undefined && body.benchmarkPct !== "" ? Number(body.benchmarkPct) : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    if (!res.ok) return NextResponse.json(res, { status: 400 });
  } else if (action === "delete-daily") {
    await deleteDailyRecord(String(body.id || body.date || ""));
  } else if (action === "add-trade") {
    const res = await addTradeExecution({
      date: String(body.date || ""),
      time: typeof body.time === "string" ? body.time : undefined,
      symbol: String(body.symbol || ""),
      name: typeof body.name === "string" ? body.name : undefined,
      side: body.side === "SELL" ? "SELL" : "BUY",
      price: Number(body.price),
      quantity: Number(body.quantity),
      fee: body.fee !== undefined && body.fee !== "" ? Number(body.fee) : undefined,
      tag: typeof body.tag === "string" ? body.tag : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    if (!res.ok) return NextResponse.json(res, { status: 400 });
  } else if (action === "delete-trade") {
    await deleteTradeExecution(String(body.id || ""));
  } else if (action === "update-settings") {
    await updateLedgerSettings({
      benchmarkCode: typeof body.benchmarkCode === "string" ? body.benchmarkCode : undefined,
      colorScheme: body.colorScheme === "global" ? "global" : body.colorScheme === "cn" ? "cn" : undefined,
    });
  } else if (action === "load-demo") {
    await loadDemoLedger();
  } else if (action === "clear-demo") {
    await clearDemoLedger();
  } else if (action === "preview-csv-text") {
    const buf = Buffer.from(String(body.text || ""), "utf8");
    const preview = previewLedgerCsv(buf);
    return NextResponse.json(preview, { status: preview.ok ? 200 : 400 });
  } else if (action === "commit-csv-text") {
    const buf = Buffer.from(String(body.text || ""), "utf8");
    const kind = body.kind === "trades" || body.kind === "daily" ? body.kind : undefined;
    const mapping = body.mapping as CsvColumnMapping | undefined;
    const res = await importLedgerCsv({ buf, kind, mapping });
    if (!res.ok) return NextResponse.json(res, { status: 400 });
  } else {
    return NextResponse.json({ ok: false, error: `未知操作：${action}` }, { status: 400 });
  }

  const [{ store, analytics }, reviewsByDate] = await Promise.all([
    getFullLedgerWithBenchmark(false),
    buildReviewDateMap(),
  ]);
  return NextResponse.json({
    ok: true,
    settings: store.settings,
    benchmarks: A_SHARE_BENCHMARKS,
    analytics,
    dailyRecords: store.dailyRecords,
    trades: store.trades,
    reviewsByDate,
  });
}