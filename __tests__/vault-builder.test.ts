import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildVault, extractAutoConcepts } from "@/lib/vault-builder";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("built-in Obsidian vault builder (v2)", () => {
  it("extracts trading concepts from untagged legacy notes", () => {
    const concepts = extractAutoConcepts("今天情绪冰点后出现弱转强，但午后炸板率飙升属于退潮期，严格执行止损控制仓位。");
    expect(concepts).toContain("情绪周期");
    expect(concepts).toContain("买点结构");
    expect(concepts).toContain("退潮风控");
    expect(concepts).toContain("仓位与止损");
  });

  it("builds multi-year MOCs, auto-concept hubs, bi-directional links, and synced manuals", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "tradeloom-vault-"));
    tempDirs.push(base);
    const sources = path.join(base, "sources");
    const vault = path.join(base, "vault");
    const manuals = path.join(base, "manuals");

    await mkdir(sources, { recursive: true });
    await mkdir(manuals, { recursive: true });

    await writeFile(
      path.join(sources, "2024-11-12_旧笔记_无标签复盘.txt"),
      "2024年11月12日复盘：今天追高半路接盘吃了大面，以后退潮期坚决空仓止损。",
      "utf8",
    );
    await writeFile(
      path.join(sources, "2025-03-01_收盘复盘_情绪冰点.md"),
      "# 情绪冰点记录\n\n标签：#情绪周期 #短线\n关联：[[龙头战法]]\n\n冰点期控仓。",
      "utf8",
    );
    await writeFile(
      path.join(sources, "2025-03-05_收盘复盘_龙头确认.md"),
      "# 龙头确认\n\n标签：#短线\n复盘前日 [[2025-03-01_收盘复盘_情绪冰点]] 并确认主线。",
      "utf8",
    );
    await writeFile(
      path.join(manuals, "manual-demo.md"),
      "---\ntitle: \"2025春季短线手册\"\n---\n\n# 2025春季短线手册\n\n> 证据：[[20-卡片/2025-03-05_收盘复盘_龙头确认|龙头确认]]\n",
      "utf8",
    );

    const index = await buildVault(sources, vault, manuals);
    expect(index.schema).toBe("tradeloom-vault@v2");
    expect(index.counts.total).toBe(3);
    expect(index.counts.years).toBe(2);
    expect(index.counts.days).toBe(3);
    expect(index.counts.manuals).toBe(1);
    expect(index.years).toEqual(["2025", "2024"]);
    expect(index.timelineTree).toHaveLength(2);
    expect(index.heatmap["2025-03-01"]).toBe(1);

    // Multi-year hierarchical MOCs
    await expect(stat(path.join(vault, "00-总览.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(vault, "10-时间轴", "2024年.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(vault, "10-时间轴", "2025年.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(vault, "10-时间轴", "2025-03.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(vault, "10-每日", "2025-03-01.md"))).resolves.toBeTruthy();

    // Auto-concept linking for untagged 2024 .txt note
    await expect(stat(path.join(vault, "30-主题", "追高反例.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(vault, "30-主题", "退潮风控.md"))).resolves.toBeTruthy();

    // Synced manual & live backlink to cited review card
    const manualFile = "40-交易手册/manual-demo.md";
    const card1 = "20-卡片/2025-03-01_收盘复盘_情绪冰点.md";
    const card2 = "20-卡片/2025-03-05_收盘复盘_龙头确认.md";
    await expect(stat(path.join(vault, "40-交易手册", "manual-demo.md"))).resolves.toBeTruthy();

    expect(index.links[card2].out).toContain(card1);
    expect(index.links[card1].in).toContain(card2);
    expect(index.links[manualFile].out).toContain(card2);
    expect(index.links[card2].in).toContain(manualFile);
  });
});
