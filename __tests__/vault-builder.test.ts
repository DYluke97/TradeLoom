import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildVault,
  extractAutoConcepts,
  wrapFirstUnlinkedOccurrence,
  type ConceptRule,
} from "@/lib/vault-builder";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("built-in Obsidian vault builder (v3)", () => {
  it("extracts trading concepts from untagged legacy notes and supports custom taxonomies", () => {
    const concepts = extractAutoConcepts("今天情绪冰点后出现弱转强，但午后炸板率飙升属于退潮期，严格执行止损控制仓位。");
    expect(concepts).toContain("情绪周期");
    expect(concepts).toContain("买点结构");
    expect(concepts).toContain("退潮风控");
    expect(concepts).toContain("仓位与止损");

    const customRules: ConceptRule[] = [
      { id: "cb", concept: "可转债套利", keywords: ["强赎", "双低", "溢价率"], enabled: true },
      { id: "disabled", concept: "停用规则", keywords: ["双低"], enabled: false },
    ];
    const customHits = extractAutoConcepts("今天布局双低可转债，回避强赎风险。", customRules);
    expect(customHits).toEqual(["可转债套利"]);
  });

  it("wraps first unlinked mention safely without corrupting frontmatter, code blocks, or existing links", () => {
    const raw = [
      "---",
      'title: "情绪周期复盘"',
      "---",
      "",
      "```",
      "情绪周期 inside code block should stay untouched",
      "```",
      "",
      "已链接的 [[30-主题/情绪周期|情绪周期]] 不会被重复包裹。",
      "这里是一段普通正文提到的情绪周期变化。",
    ].join("\n");

    const res = wrapFirstUnlinkedOccurrence(raw, "情绪周期", "30-主题/情绪周期");
    expect(res.changed).toBe(true);
    expect(res.nextText).toContain('title: "情绪周期复盘"');
    expect(res.nextText).toContain("情绪周期 inside code block should stay untouched");
    expect(res.nextText).toContain("这里是一段普通正文提到的[[30-主题/情绪周期]]变化。");
  });

  it("builds multi-year MOCs, custom concept hubs, bi-directional links, synced manuals, and unlinked mentions", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "tradeloom-vault-"));
    tempDirs.push(base);
    const sources = path.join(base, "sources");
    const vault = path.join(base, "vault");
    const manuals = path.join(base, "manuals");

    await mkdir(sources, { recursive: true });
    await mkdir(manuals, { recursive: true });

    await writeFile(
      path.join(sources, "2024-11-12_旧笔记_无标签复盘.txt"),
      "2024年11月12日复盘：今天追高半路接盘吃了大面，后续要坚持双低可转债防守。",
      "utf8",
    );
    await writeFile(
      path.join(sources, "2025-03-01_收盘复盘_情绪冰点.md"),
      "# 情绪冰点记录\n\n标签：#情绪周期 #短线\n关联：[[龙头战法]]\n\n冰点期控仓。",
      "utf8",
    );
    await writeFile(
      path.join(sources, "2025-03-05_收盘复盘_龙头确认.md"),
      "# 龙头确认\n\n标签：#短线\n复盘前日 [[2025-03-01_收盘复盘_情绪冰点]] 并确认主线，但正文里顺手提到了龙头战法却没有加双链。",
      "utf8",
    );
    await writeFile(
      path.join(manuals, "manual-demo.md"),
      '---\ntitle: "2025春季短线手册"\n---\n\n# 2025春季短线手册\n\n> 证据：[[20-卡片/2025-03-05_收盘复盘_龙头确认|龙头确认]]\n',
      "utf8",
    );

    const customRules: ConceptRule[] = [
      { id: "cb", concept: "可转债防守", keywords: ["双低", "可转债"], enabled: true },
      { id: "chase", concept: "追高反例", keywords: ["追高", "接盘"], enabled: true },
    ];

    const index = await buildVault(sources, vault, manuals, customRules);
    expect(index.schema).toBe("tradeloom-vault@v3");
    expect(index.counts.total).toBe(3);
    expect(index.counts.years).toBe(2);
    expect(index.counts.days).toBe(3);
    expect(index.counts.manuals).toBe(1);
    expect(index.years).toEqual(["2025", "2024"]);

    // Custom concept hub generated & old default not injected
    await expect(stat(path.join(vault, "30-主题", "可转债防守.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(vault, "30-主题", "追高反例.md"))).resolves.toBeTruthy();

    // Unlinked mentions: card2 mentions "龙头战法" in plain text without linking to 30-主题/龙头战法.md
    const topicRel = "30-主题/龙头战法.md";
    const card2 = "20-卡片/2025-03-05_收盘复盘_龙头确认.md";
    expect(index.unlinked[topicRel]?.some((m) => m.source === card2 && m.match === "龙头战法")).toBe(true);
    expect(index.counts.unlinked).toBeGreaterThan(0);

    // Bi-directional links + manual back-sync
    const manualFile = "40-交易手册/manual-demo.md";
    const card1 = "20-卡片/2025-03-01_收盘复盘_情绪冰点.md";
    expect(index.links[card2].out).toContain(card1);
    expect(index.links[card1].in).toContain(card2);
    expect(index.links[manualFile].out).toContain(card2);
    expect(index.links[card2].in).toContain(manualFile);
  });
});
