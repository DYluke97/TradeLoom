import { NextRequest, NextResponse } from "next/server";
import { importFromUrl } from "@/lib/cloud-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      url?: string;
      title?: string;
      eventDate?: string;
      tags?: string[] | string;
    };

    const tags = Array.isArray(body.tags)
      ? body.tags
      : typeof body.tags === "string"
        ? body.tags
            .split(/[,，\s#]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const outcome = await importFromUrl({
      url: body.url ?? "",
      title: body.title,
      eventDate: body.eventDate,
      tags,
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { ok: false, error: outcome.error, requiresLogin: outcome.requiresLogin },
        { status: outcome.status },
      );
    }
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "网页抓取入库失败" },
      { status: 500 },
    );
  }
}
