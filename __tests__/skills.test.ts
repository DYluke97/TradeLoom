import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteCustomSkill,
  getSkillById,
  loadSkills,
  saveCustomSkill,
  validateCustomSkillId,
} from "../src/lib/skills";

describe("skills loader & custom workspace CRUD", () => {
  it("validates custom Skill IDs and blocks built-ins and path traversal", () => {
    expect(validateCustomSkillId("convertible-arb")).toEqual({ ok: true, id: "convertible-arb" });
    expect(validateCustomSkillId("my_short_term_2")).toEqual({ ok: true, id: "my_short_term_2" });

    expect(validateCustomSkillId("short-term").ok).toBe(false);
    expect(validateCustomSkillId("fundamental").ok).toBe(false);
    expect(validateCustomSkillId("general").ok).toBe(false);
    expect(validateCustomSkillId("../evil").ok).toBe(false);
    expect(validateCustomSkillId("bad id!").ok).toBe(false);
    expect(validateCustomSkillId("a").ok).toBe(false);
  });

  it("creates, edits, loads, and deletes custom Skills in workspace/skills without touching built-ins", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-skills-"));
    const prevDir = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;

    try {
      const initial = await loadSkills();
      expect(initial.map((s) => s.id)).toContain("general");
      expect(initial.map((s) => s.id)).toContain("short-term");
      expect(initial.map((s) => s.id)).toContain("fundamental");
      expect(initial.find((s) => s.id === "short-term")?.editable).toBe(false);

      // Create custom skill with colons/quotes in metadata to verify YAML round-trip safety
      const created = await saveCustomSkill({
        id: "convertible-arb",
        name: "资源周期: 仓位与融资风控 Skill",
        summary: "面向有色/锂矿与融资融券的风控框架：严控杠杆",
        tags: "周期股, 融资风控, 知行合一",
        content: "# 资源周期 Skill\n\n## 核心维度\n1. 供需周期定位\n2. 融资杠杆红线与回撤控制\n3. 情绪心态纠偏",
      });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      expect(created.skill.id).toBe("convertible-arb");
      expect(created.skill.builtin).toBe(false);
      expect(created.skill.editable).toBe(true);
      expect(created.skill.source).toBe("workspace");
      expect(created.skill.name).toBe("资源周期: 仓位与融资风控 Skill");
      expect(created.skill.tags).toEqual(["周期股", "融资风控", "知行合一"]);

      const diskContent = await readFile(path.join(tmp, "skills", "convertible-arb.md"), "utf8");
      expect(diskContent).toContain("id: convertible-arb");
      expect(diskContent).toContain("融资杠杆红线与回撤控制");

      // Lookup via getSkillById
      const fetched = await getSkillById("convertible-arb");
      expect(fetched.name).toBe("资源周期: 仓位与融资风控 Skill");
      expect(fetched.content).toContain("供需周期定位");

      // Edit in place
      const updated = await saveCustomSkill({
        id: "convertible-arb",
        name: "资源周期 Skill v2",
        summary: "升级版周期风控框架",
        tags: ["周期股", "回撤控制"],
        content: "# 资源周期 Skill v2\n\n## 核心维度\n1. 供需周期与库存\n2. 最大回撤 15% 强制减仓",
      });
      expect(updated.ok).toBe(true);
      if (updated.ok) {
        expect(updated.skill.name).toBe("资源周期 Skill v2");
        expect(updated.skill.content).toContain("最大回撤 15% 强制减仓");
      }

      // Built-in delete protection
      const blockedDel = await deleteCustomSkill("short-term");
      expect(blockedDel.ok).toBe(false);

      // Delete custom skill
      const deleted = await deleteCustomSkill("convertible-arb");
      expect(deleted.ok).toBe(true);
      if (deleted.ok) {
        expect(deleted.skills.some((s) => s.id === "convertible-arb")).toBe(false);
      }
    } finally {
      if (prevDir === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prevDir;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
