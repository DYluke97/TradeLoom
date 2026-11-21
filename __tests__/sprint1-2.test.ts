import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPrivateIpOrHost } from "../src/lib/cloud-ingest";
import { getOrCreateClipToken, verifyClipToken } from "../src/lib/provider";
import { loadSkills, saveCustomSkill } from "../src/lib/skills";
import { buildPrecheck, exportReportToObsidianMarkdown, parseSynthesisResponse, type MaterializedDoc } from "../src/lib/synthesis";
import {
  clearSampleReviews,
  deleteVaultDocument,
  exportVaultZipBuffer,
  hasLoadedSamples,
  loadSampleReviews,
  rebuildVault,
} from "../src/lib/vault";
import { listZipEntryPaths } from "../src/lib/zip";

const E_TMP_BASE = "E:/.dev-cache/tmp";

describe("Sprint 1 & Sprint 2 security, vault lifecycle, zip export, and financial audit", () => {
  it("generates persistent per-workspace clipToken and blocks unauthorized tokens", async () => {
    const tmp = await mkdtemp(path.join(E_TMP_BASE, "tl-clip-"));
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;
    try {
      const t1 = await getOrCreateClipToken();
      const t2 = await getOrCreateClipToken();
      expect(t1).toMatch(/^[a-f0-9]{32}$/);
      expect(t2).toBe(t1);
      expect(await verifyClipToken(t1)).toBe(true);
      expect(await verifyClipToken("wrong-token")).toBe(false);
      expect(await verifyClipToken("")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("blocks IPv4-mapped IPv6 and zero-network addresses in SSRF guard", () => {
    expect(isPrivateIpOrHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpOrHost("[::ffff:192.168.1.5]")).toBe(true);
    expect(isPrivateIpOrHost("0.0.0.0")).toBe(true);
    expect(isPrivateIpOrHost("::")).toBe(true);
    expect(isPrivateIpOrHost("xueqiu.com")).toBe(false);
  });

  it("supports deleting single notes to .trash, clearing samples safely, and exporting UTF-8 .zip", async () => {
    const tmp = await mkdtemp(path.join(E_TMP_BASE, "tl-lifecycle-"));
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;
    try {
      const loaded = await loadSampleReviews();
      expect(loaded.copied).toBe(6);
      expect(await hasLoadedSamples(loaded.index)).toBe(true);

      // Add 1 user private note
      await writeFile(path.join(tmp, "sources", "2026-01-15_我的实盘笔记.md"), "# 我的实盘笔记\n\n严控仓位。", "utf8");
      const rebuilt = await rebuildVault();
      expect(rebuilt.counts.total).toBe(7);

      // Export Vault as .zip and verify UTF-8 entry names
      const zipBuf = await exportVaultZipBuffer();
      expect(zipBuf.subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50);
      const entryNames = listZipEntryPaths(zipBuf);
      expect(entryNames).toContain("TradeLoom-Vault/00-总览.md");
      expect(entryNames.some((n) => n.includes("我的实盘笔记"))).toBe(true);

      // Clear built-in samples: removes 6 samples, keeps user note intact!
      const cleared = await clearSampleReviews();
      expect(cleared.removed).toBe(6);
      expect(cleared.index.counts.total).toBe(1);
      expect(await hasLoadedSamples(cleared.index)).toBe(false);

      // Delete the user's single note into workspace/.trash/
      const userCard = cleared.index.documents[0].card;
      const del = await deleteVaultDocument(userCard);
      expect(del.ok).toBe(true);
      if (del.ok) {
        expect(del.index.counts.total).toBe(0);
        const trashedContent = await readFile(path.join(tmp, del.trashedTo), "utf8");
        expect(trashedContent).toContain("我的实盘笔记");
      }
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("loads all 5 built-in cross-market Skills and protects them from overwrite", async () => {
    const tmp = await mkdtemp(path.join(E_TMP_BASE, "tl-skills5-"));
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;
    try {
      const skills = await loadSkills();
      const ids = skills.map((s) => s.id);
      expect(ids).toEqual(["general", "short-term", "fundamental", "trend-swing", "macro-cycle"]);
      const blocked = await saveCustomSkill({
        id: "trend-swing",
        name: "覆盖测试",
        content: "# 不允许覆盖内置趋势波段模板的正文内容测试",
      });
      expect(blocked.ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("parses rule lifecycle/conflict_note and verifies evidence_ids on anti-mouth-trading discipline_audit", () => {
    const doc: MaterializedDoc = {
      doc_id: "d1",
      title: "2025-09-12 周期股复盘",
      kind: "实盘日记",
      carrier: "md",
      event_date: "2025-09-12",
      card: "20-卡片/2025-09-12_周期股复盘.md",
      source_rel: "2025-09-12_周期股复盘.md",
      sha256: "abc",
      chars: 60,
      body: "昨日刚立下绝不融资满仓的规矩，今天看到锂矿高开又忍不住融资打满，收盘大跌8%教训惨痛。",
      status: "ready",
      reason: null,
    };
    const { evidence } = buildPrecheck([doc]);
    const validId = evidence[0].evidence_id;

    const raw = JSON.stringify({
      overview: { summary: "周期风控复盘", conditions: ["低库存"], counterexamples: ["高开追涨满融"] },
      timeline: [{ period: "2025-09", label: "杠杆教训", change: "识别冲动满融危害", evidence_ids: [validId] }],
      manual: [
        {
          id: "M1",
          title: "高开脉冲满融追涨（旧习）",
          lifecycle: "deprecated",
          conflict_note: "已被9月实盘单日大亏8%证伪，改为回踩分批且禁用追高融资",
          context: "资源股情绪高开日",
          condition: "早盘高开5%以上",
          action: "严禁动用融资追涨",
          exit: "次日不及预期减半",
          counterexample: "9月12日满融追高当日大面",
          evidence_ids: [validId],
        },
      ],
      discipline_audit: [
        {
          id: "D1",
          stated_rule: "绝不融资满仓追高",
          actual_deviation: "次日见锂矿高开立刻融资打满导致大跌8%",
          trigger_psychology: "怕踏空主升浪FOMO情绪",
          fix_guardrail: "关闭早盘9:45前的融资买入权限或设置单日最大买入上限",
          evidence_ids: [validId, "ev_hallucinated_999"],
        },
        {
          id: "D2",
          stated_rule: "无证据编造项",
          actual_deviation: "应当被过滤",
          evidence_ids: ["ev_fake_only"],
        },
      ],
    });

    const parsed = parseSynthesisResponse(raw, evidence);
    expect(parsed.ok).toBe(true);
    expect(parsed.manual[0].lifecycle).toBe("deprecated");
    expect(parsed.manual[0].conflict_note).toContain("证伪");
    expect(parsed.discipline_audit).toHaveLength(1);
    expect(parsed.discipline_audit[0].evidence).toHaveLength(1);
    expect(parsed.discipline_audit[0].stated_rule).toBe("绝不融资满仓追高");

    const md = exportReportToObsidianMarkdown({
      id: "manual-test",
      schema: "tradeloom-playbook@v1",
      created_at: "2026-11-21T12:00:00Z",
      title: "测试手册",
      skill_id: "macro-cycle",
      skill_name: "资源周期与仓位杠杆风控 Skill",
      model: "deepseek-chat",
      fingerprint: "fp1234",
      date_range: { from: "2025-09-12", to: "2025-09-12" },
      source_docs: [{ doc_id: "d1", title: doc.title, event_date: doc.event_date, card: doc.card }],
      overview: parsed.overview,
      timeline: parsed.timeline,
      manual: parsed.manual,
      discipline_audit: parsed.discipline_audit,
      statistics: { docs_count: 1, timeline_count: 1, rules_count: 1, evidence_used: 1, multi_date_rules: 0 },
      warnings: parsed.warnings,
      usage: { promptTokens: 100, completionTokens: 100 },
    });
    expect(md).toContain("【⚠ 已证伪废弃】");
    expect(md).toContain("知行偏离与重复违纪审计");
  });
});