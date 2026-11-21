import { NextRequest, NextResponse } from "next/server";
import { importPastedReview } from "@/lib/cloud-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      title?: string;
      content?: string;
      html?: string;
      eventDate?: string;
      sourcePlatform?: string;
      sourceUrl?: string;
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

    const outcome = await importPastedReview({
      title: body.title,
      content: body.content,
      html: body.html,
      eventDate: body.eventDate,
      sourcePlatform: body.sourcePlatform,
      sourceUrl: body.sourceUrl,
      tags,
    });

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
    }
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "粘贴入库失败" },
      { status: 500 },
    );
  }
}
