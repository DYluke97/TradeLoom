import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildVault } from "@/lib/vault-builder";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("built-in Obsidian vault builder", () => {
  it("builds daily hubs, topic hubs, cards, and bi-directional backlinks", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "tradeloom-vault-"));
    tempDirs.push(base);
    const sources = path.join(base, "sources");
    const vault = path.join(base, "vault");

    await rm(sources, { recursive: true, force: true });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sources, { recursive: true });

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

    const index = await buildVault(sources, vault);
    expect(index.counts.total).toBe(2);
    expect(index.counts.days).toBe(2);
    expect(index.counts.topics).toBeGreaterThanOrEqual(3);
    expect(index.counts.links).toBeGreaterThan(0);

    // Check Obsidian files exist
    await expect(stat(path.join(vault, "00-总览.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(vault, "10-每日", "2025-03-01.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(vault, "30-主题", "短线.md"))).resolves.toBeTruthy();

    // Check bi-directional link between note 2 -> note 1
    const card1 = "20-卡片/2025-03-01_收盘复盘_情绪冰点.md";
    const card2 = "20-卡片/2025-03-05_收盘复盘_龙头确认.md";
    expect(index.links[card2].out).toContain(card1);
    expect(index.links[card1].in).toContain(card2);
  });
});
