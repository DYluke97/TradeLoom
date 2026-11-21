import { NextResponse } from "next/server";
import { generateCsvTemplate } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") === "trades" ? "trades" : "daily";
  const csv = generateCsvTemplate(kind);
  const filename = kind === "trades" ? "tradeloom-trades-template.csv" : "tradeloom-daily-nav-template.csv";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}