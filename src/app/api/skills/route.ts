import { NextRequest, NextResponse } from "next/server";
import { deleteCustomSkill, loadSkills, saveCustomSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const skills = await loadSkills();
  return NextResponse.json({ ok: true, skills }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      id?: string;
      name?: string;
      summary?: string;
      tags?: string[] | string;
      content?: string;
    };

    const result = await saveCustomSkill({
      id: body.id ?? "",
      name: body.name ?? "",
      summary: body.summary,
      tags: body.tags,
      content: body.content ?? "",
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, skill: result.skill, skills: result.skills },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "保存自定义 Skill 失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    let id = request.nextUrl.searchParams.get("id") ?? "";
    if (!id) {
      try {
        const body = (await request.json()) as { id?: string };
        id = body.id ?? "";
      } catch {
        /* no body */
      }
    }

    const result = await deleteCustomSkill(id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, skills: result.skills }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "删除自定义 Skill 失败" },
      { status: 500 },
    );
  }
}
