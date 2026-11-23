import { NextRequest, NextResponse } from "next/server";
import { deleteSavedManual, exportReportToObsidianMarkdown, listSavedManuals } from "@/lib/synthesis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const format = request.nextUrl.searchParams.get("format");
  const manuals = await listSavedManuals();

  if (id) {
    const found = manuals.find((m) => m.id === id);
    if (!found) return NextResponse.json({ ok: false, error: "找不到该交易手册" }, { status: 404 });
    if (format === "md") {
      const md = exportReportToObsidianMarkdown(found);
      return new NextResponse(md, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${found.id}.md"`,
        },
      });
    }
    return NextResponse.json({ ok: true, manual: found, markdown: exportReportToObsidianMarkdown(found) });
  }

  return NextResponse.json({ ok: true, manuals }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });
  const deleted = await deleteSavedManual(id);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "找不到该交易手册" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
