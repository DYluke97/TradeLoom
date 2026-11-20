import { NextRequest, NextResponse } from "next/server";
import { parseMarkdown } from "@/lib/markdown";
import { loadOrBuildVault, readOriginalSource, readVaultCard, saveOriginalSource } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const card = (request.nextUrl.searchParams.get("card") ?? "00-总览.md").trim();
  const mode = request.nextUrl.searchParams.get("mode") === "source" ? "source" : "card";
  const { index } = await loadOrBuildVault();

  const fileEntry = index.files.find((f) => f.rel === card);
  if (!fileEntry) {
    return NextResponse.json({ ok: false, error: "知识库中找不到该卡片" }, { status: 404 });
  }

  const doc = index.documents.find((d) => d.card === card) ?? null;
  const linkInfo = index.links[card] ?? { out: [], in: [] };

  if (mode === "source" && doc) {
    if (doc.carrier === "pdf") {
      return NextResponse.json({
        ok: true,
        mode: "source",
        card,
        doc,
        carrier: "pdf",
        editable: false,
        text: null,
        parsed: null,
        sha256: doc.sha256,
        links: linkInfo,
        fileUrl: `/api/vault/file?card=${encodeURIComponent(card)}`,
      });
    }
    const src = await readOriginalSource(doc.source_rel);
    if (!src) {
      return NextResponse.json({ ok: false, error: "读取原文失败" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      mode: "source",
      card,
      doc,
      carrier: doc.carrier,
      editable: src.utf8 && (doc.carrier === "md" || doc.carrier === "txt"),
      text: src.text,
      parsed: src.text !== null ? parseMarkdown(src.text) : null,
      sha256: src.sha256,
      bytes: src.bytes,
      links: linkInfo,
    });
  }

  const loaded = await readVaultCard(card);
  if (!loaded) {
    return NextResponse.json({ ok: false, error: "无法读取卡片内容" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    mode: "card",
    card,
    doc,
    carrier: doc?.carrier ?? "md",
    editable: false,
    text: loaded.text,
    parsed: parseMarkdown(loaded.text),
    sha256: loaded.sha256,
    links: linkInfo,
  });
}

export async function PUT(request: NextRequest) {
  let body: { card?: string; text?: string; sha256?: string } = {};
  try {
    body = (await request.json()) as { card?: string; text?: string; sha256?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "请求体格式错误" }, { status: 400 });
  }

  if (!body.card || typeof body.text !== "string" || !body.sha256) {
    return NextResponse.json({ ok: false, error: "缺少 card、text 或 sha256 参数" }, { status: 400 });
  }

  const { index } = await loadOrBuildVault();
  const doc = index.documents.find((d) => d.card === body.card);
  if (!doc) {
    return NextResponse.json({ ok: false, error: "未找到对应原文条目" }, { status: 404 });
  }

  const saved = await saveOriginalSource(doc, body.text, body.sha256);
  if (!saved.ok) {
    return NextResponse.json(saved, { status: saved.status });
  }
  return NextResponse.json(saved);
}
