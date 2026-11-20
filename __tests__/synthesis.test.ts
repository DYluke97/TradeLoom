import { describe, expect, it } from "vitest";
import {
  buildPrecheck,
  exportReportToObsidianMarkdown,
  parseSynthesisResponse,
  type MaterializedDoc,
  type SynthesisReport,
} from "@/lib/synthesis";

const makeDoc = (id: string, date: string, body: string): MaterializedDoc => ({
  doc_id: id,
  title: `复盘 ${date}`,
  kind: "收盘复盘",
  carrier: "md",
  event_date: date,
  card: `20-卡片/${date}_复盘.md`,
  source_rel: `${date}_复盘.md`,
  sha256: `sha-${id}`,
  chars: body.length,
  body,
  status: "ready",
  reason: null,
});

describe("stage precheck & evidence-grounded synthesis", () => {
  it("packs whole documents in chronological order and enforces char limit without truncating", () => {
    const docs = [
      makeDoc("d2", "2025-04-10", "B".repeat(60)),
      makeDoc("d1", "2025-02-10", "A".repeat(60)),
      makeDoc("d3", "2025-06-10", "C".repeat(60)),
    ];
    const { snapshot, packedDocs, evidence } = buildPrecheck(docs, 130);
    expect(packedDocs.map((d) => d.doc_id)).toEqual(["d1", "d2"]);
    expect(snapshot.over_limit_ids).toEqual(["d3"]);
    expect(snapshot.date_range).toEqual({ from: "2025-02-10", to: "2025-04-10" });
    expect(evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects hallucinated evidence_ids and keeps only verbatim-verified rules", () => {
    const docs = [makeDoc("d1", "2025-03-01", "情绪冰点期严禁追高跟风票，总仓位不超过两成。")];
    const { evidence } = buildPrecheck(docs);
    const validId = evidence[0].evidence_id;

    const rawModelOutput = JSON.stringify({
      overview: {
        summary: "测试总览",
        conditions: ["冰点期"],
        counterexamples: ["追高跟风"],
      },
      timeline: [
        { period: "2025-03", label: "冰点控仓", change: "不再追高跟风", evidence_ids: [validId] },
        { period: "2025-04", label: "幻觉节点", change: "无据编造", evidence_ids: ["ev_fake_999999"] },
      ],
      manual: [
        {
          id: "M1",
          title: "冰点期控仓纪律",
          context: "冰点期",
          condition: "无主线梯队",
          action: "总仓位 <= 2 成",
          exit: "次日不及预期止损",
          counterexample: "半路追跟风炸板",
          evidence_ids: [validId, "ev_hallucinated"],
        },
        {
          id: "M2",
          title: "完全编造的规则",
          context: "任意",
          condition: "任意",
          action: "满仓",
          exit: "",
          counterexample: "",
          evidence_ids: ["ev_nonexistent"],
        },
      ],
    });

    const parsed = parseSynthesisResponse(rawModelOutput, evidence);
    expect(parsed.ok).toBe(true);
    expect(parsed.timeline).toHaveLength(1);
    expect(parsed.manual).toHaveLength(1);
    expect(parsed.manual[0].id).toBe("M1");
    expect(parsed.manual[0].evidence).toHaveLength(1);
    expect(parsed.manual[0].evidence[0].quote).toContain("情绪冰点期");
    expect(parsed.warnings.length).toBeGreaterThan(0);

    // Check Obsidian Markdown export contains wikilinks
    const report: SynthesisReport = {
      id: "manual-test",
      schema: "tradeloom-playbook@v1",
      created_at: "2025-03-02T00:00:00Z",
      title: "测试手册",
      skill_id: "short-term",
      skill_name: "短线博弈 Skill",
      model: "deepseek-chat",
      fingerprint: "abc",
      date_range: { from: "2025-03-01", to: "2025-03-01" },
      source_docs: [{ doc_id: "d1", title: "复盘 2025-03-01", event_date: "2025-03-01", card: "20-卡片/2025-03-01_复盘.md" }],
      overview: parsed.overview,
      timeline: parsed.timeline,
      manual: parsed.manual,
      statistics: { docs_count: 1, timeline_count: 1, rules_count: 1, evidence_used: 1, multi_date_rules: 0 },
      warnings: parsed.warnings,
      usage: { promptTokens: 100, completionTokens: 100 },
    };
    const md = exportReportToObsidianMarkdown(report);
    expect(md).toContain("[[20-卡片/2025-03-01_复盘|复盘 2025-03-01]]");
    expect(md).toContain("### M1：冰点期控仓纪律");
  });
});
