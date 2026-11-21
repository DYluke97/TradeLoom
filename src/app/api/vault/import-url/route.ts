import { NextRequest, NextResponse } from "next/server";
import { importFromUrl, importFromUrlsBatch, parseBatchUrls } from "@/lib/cloud-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      url?: string;
      urls?: string[] | string;
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

    const batchList =
      body.urls !== undefined
        ? parseBatchUrls(body.urls)
        : typeof body.url === "string" && body.url.includes("\n")
          ? parseBatchUrls(body.url)
          : [];

    if (batchList.length > 1 || Array.isArray(body.urls)) {
      const outcome = await importFromUrlsBatch({
        urls: batchList,
        eventDate: body.eventDate,
        tags,
      });
      return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
    }

    const singleUrl = batchList[0] ?? body.url ?? "";
    const outcome = await importFromUrl({
      url: singleUrl,
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
