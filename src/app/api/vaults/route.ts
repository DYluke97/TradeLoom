import { NextRequest, NextResponse } from "next/server";
import {
  createOrResetDemoVault,
  createVault,
  deleteVault,
  getVaultsOverview,
  saveVaultConnectorFilters,
  switchActiveVault,
  updateVaultMeta,
  type VaultTemplateId,
} from "@/lib/vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const overview = await getVaultsOverview();
    return NextResponse.json({ ok: true, ...overview }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "读取知识库列表失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?:
        | "create"
        | "switch"
        | "update"
        | "delete"
        | "create-demo"
        | "save-connector-filters";
      id?: string;
      name?: string;
      description?: string;
      color?: string;
      templateId?: VaultTemplateId;
      defaultSkillId?: string;
      externalSourceDir?: string;
      cloneConceptsFromVaultId?: string;
      activate?: boolean;
      skipLedgerStep?: boolean;
      connectorId?: string;
      filters?: Record<string, string>;
    };

    if (body.action === "create") {
      const res = await createVault({
        name: body.name ?? "",
        description: body.description,
        color: body.color,
        templateId: body.templateId,
        defaultSkillId: body.defaultSkillId,
        externalSourceDir: body.externalSourceDir,
        cloneConceptsFromVaultId: body.cloneConceptsFromVaultId,
        activate: body.activate !== false,
      });
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      return NextResponse.json({ ok: true, vault: res.vault, ...res.overview });
    }

    if (body.action === "switch") {
      if (!body.id) return NextResponse.json({ ok: false, error: "缺少目标知识库 ID" }, { status: 400 });
      const res = await switchActiveVault(body.id);
      if (!res.ok) return NextResponse.json(res, { status: 404 });
      return NextResponse.json({ ok: true, ...res.overview });
    }

    if (body.action === "update") {
      if (!body.id) return NextResponse.json({ ok: false, error: "缺少知识库 ID" }, { status: 400 });
      const res = await updateVaultMeta(body.id, {
        name: body.name,
        description: body.description,
        color: body.color,
        defaultSkillId: body.defaultSkillId,
        externalSourceDir: body.externalSourceDir,
        skipLedgerStep: body.skipLedgerStep,
      });
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      return NextResponse.json({ ok: true, ...res.overview });
    }

    if (body.action === "delete") {
      if (!body.id) return NextResponse.json({ ok: false, error: "缺少知识库 ID" }, { status: 400 });
      const res = await deleteVault(body.id);
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      return NextResponse.json({ ok: true, trashedTo: res.trashedTo, ...res.overview });
    }

    if (body.action === "create-demo") {
      const res = await createOrResetDemoVault({ activate: body.activate !== false });
      return NextResponse.json({ ok: true, vault: res.vault, ...res.overview });
    }

    if (body.action === "save-connector-filters") {
      if (!body.id || !body.connectorId) {
        return NextResponse.json({ ok: false, error: "缺少知识库 ID 或连接器 ID" }, { status: 400 });
      }
      const res = await saveVaultConnectorFilters(body.id, body.connectorId, body.filters ?? {});
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      return NextResponse.json({ ok: true, ...res.overview });
    }

    return NextResponse.json({ ok: false, error: "未知知识库操作类型" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "知识库操作失败" },
      { status: 500 },
    );
  }
}