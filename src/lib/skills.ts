import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type SkillSpec = {
  id: string;
  name: string;
  summary: string;
  tags: string[];
  builtin: boolean;
  fileName: string | null;
  content: string;
};

const GENERAL_SKILL: SkillSpec = {
  id: "general",
  name: "综合阶段归纳",
  summary: "不预设交易流派，完全基于所选复盘笔记提炼阶段演变时间轴与个人交易规则。",
  tags: ["通用", "阶段复盘"],
  builtin: true,
  fileName: null,
  content: "",
};

function parseSkillMarkdown(raw: string, fallbackId: string, fileName: string): SkillSpec {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const meta: Record<string, string> = {};
  let body = normalized;

  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---", 4);
    if (end > 0) {
      for (const line of normalized.slice(4, end).split("\n")) {
        const at = line.indexOf(":");
        if (at > 0) {
          const k = line.slice(0, at).trim();
          const v = line.slice(at + 1).trim();
          meta[k] = v.replace(/^["']|["']$/g, "");
        }
      }
      body = normalized.slice(end + 4).trim();
    }
  }

  const tagsRaw = meta.tags ?? "";
  const tags = tagsRaw
    .replace(/^\[|\]$/g, "")
    .split(/[,，]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return {
    id: meta.id || fallbackId,
    name: meta.name || fallbackId,
    summary: meta.summary || "自定义复盘提炼 Skill",
    tags,
    builtin: fallbackId === "short-term" || fallbackId === "fundamental",
    fileName,
    content: body,
  };
}

/**
 * Loads all `.md` Skills from `<repo>/skills/` plus the built-in `general` mode.
 * Community contributors can drop a new `.md` file into `skills/` and it appears automatically.
 */
export async function loadSkills(): Promise<SkillSpec[]> {
  const skillsDir = path.join(process.cwd(), "skills");
  const loaded: SkillSpec[] = [];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.toLowerCase() === "readme.md") continue;
      const raw = await readFile(path.join(skillsDir, entry.name), "utf8");
      const fallbackId = path.basename(entry.name, ".md");
      loaded.push(parseSkillMarkdown(raw, fallbackId, entry.name));
    }
  } catch {
    /* directory optional */
  }

  const order = new Map([
    ["short-term", 0],
    ["fundamental", 1],
  ]);
  loaded.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || a.id.localeCompare(b.id));
  return [GENERAL_SKILL, ...loaded];
}

export async function getSkillById(id: string): Promise<SkillSpec> {
  const all = await loadSkills();
  return all.find((s) => s.id === id) ?? GENERAL_SKILL;
}
