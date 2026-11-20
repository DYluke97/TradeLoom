import { NextResponse } from "next/server";
import { loadSkills } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const skills = await loadSkills();
  return NextResponse.json({ ok: true, skills }, { headers: { "Cache-Control": "no-store" } });
}
