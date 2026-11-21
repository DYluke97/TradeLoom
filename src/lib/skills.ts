import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ensureWorkspace, getWorkspacePaths, insideRoot, writeAtomic } from "@/lib/workspace";

export type SkillSource = "builtin" | "repo" | "workspace";

export type SkillSpec = {
  id: string;
  name: string;
  summary: string;
  tags: string[];
  builtin: boolean;
  editable: boolean;
  source: SkillSource;
  fileName: string | null;
  content: string;
};

export type SaveSkillInput = {
  id: string;
  name: string;
  summary?: string;
  tags?: string[] | string;
  content: string;
};

export const BUILTIN_SKILL_IDS = new Set(["general", "short-term", "fundamental"]);
const SKILL_ID_RE = /^[a-z0-9][a-z0-9_-]{1,47}$/;
const MAX_SKILL_CONTENT_CHARS = 30_000;

const GENERAL_SKILL: SkillSpec = {
  id: "general",
  name: "综合阶段归纳",
  summary: "不预设交易流派，完全基于所选复盘笔记提炼阶段演变时间轴与个人交易规则。",
  tags: ["通用", "阶段复盘"],
  builtin: true,
  editable: false,
  source: "builtin",
  fileName: null,
  content: "",
};

export const DEFAULT_CUSTOM_SKILL_TEMPLATE = `# 我的自定义交易分析 Skill

> 这份 Skill 为大模型提炼复盘提供专属分析框架，所有提炼出的规则都必须有复盘原文证据支持，原文未提及的维度不得脑补。

## 核心审视维度

1. **市场环境与周期定位**：界定当前所处的市场阶段、主线强弱与风险偏好。
2. **选股与标的筛选标准**：提炼核心驱动逻辑、基本面/技术面门槛及排除条件。
3. **买入触发与仓位分配**：明确可观测的入场信号、分批节奏与单票/总仓位上限。
4. **退出、止损与风控红线**：写清不及预期退出、回撤降仓或去杠杆的硬性纪律。
5. **情绪心态与高频反例**：记录导致大亏的心理误区、追高/扛单模式及纠偏动作。

## 提示词聚焦要求

- 每条规则必须写清 \`context\`（适用环境）、\`condition\`（可观测触发条件）、\`action\`（仓位与动作）、\`exit\`（退出/止损纪律）与 \`counterexample\`（失败反例）；
- 原文未涉及的维度保持留白或如实标注缺口，绝不编造原文未出现的数据、标的或收益。
`;

function sanitizeYamlScalar(value: string): string {
  const singleLine = value.replace(/\r?\n+/g, " ").trim();
  if (!singleLine) return '""';
  if (/[:#[\]{}&*!|>'"%@`,]/.test(singleLine)) {
    return JSON.stringify(singleLine);
  }
  return singleLine;
}

export function normalizeSkillTags(tags: string[] | string | undefined): string[] {
  const rawList = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(/[,，\n#]+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawList) {
    const clean = item.trim().replace(/^["']|["']$/g, "").slice(0, 24);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 12) break;
  }
  return out;
}

export function validateCustomSkillId(rawId: string): { ok: true; id: string } | { ok: false; error: string } {
  const id = rawId.trim().toLowerCase();
  if (!id) {
    return { ok: false, error: "请填写 Skill ID（仅支持小写字母、数字、连字符 - 或下划线 _）" };
  }
  if (!SKILL_ID_RE.test(id)) {
    return {
      ok: false,
      error: "Skill ID 需为 2-48 位，以小写字母或数字开头，仅允许小写字母、数字、- 和 _（例如 macro-cycle）",
    };
  }
  if (BUILTIN_SKILL_IDS.has(id)) {
    return {
      ok: false,
      error: `「${id}」为系统内置 Skill ID，受保护不可覆盖，请换一个自定义 ID（例如 my-${id}）`,
    };
  }
  return { ok: true, id };
}

export function serializeSkillMarkdown(input: {
  id: string;
  name: string;
  summary: string;
  tags: string[];
  content: string;
}): string {
  const tagsLine = `[${input.tags.map((t) => sanitizeYamlScalar(t)).join(", ")}]`;
  const body = input.content.replace(/\r\n?/g, "\n").trim();
  return [
    "---",
    `id: ${input.id}`,
    `name: ${sanitizeYamlScalar(input.name)}`,
    `summary: ${sanitizeYamlScalar(input.summary)}`,
    `tags: ${tagsLine}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed) as string;
      } catch {
        /* fallback below */
      }
    }
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSkillMarkdown(
  raw: string,
  fallbackId: string,
  fileName: string,
  source: SkillSource,
): SkillSpec {
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
          meta[k] = unquoteYamlScalar(v);
        }
      }
      body = normalized.slice(end + 4).trim();
    }
  }

  const tagsRaw = meta.tags ?? "";
  const tags = tagsRaw
    .replace(/^\[|\]$/g, "")
    .split(/[,，]/)
    .map((s) => unquoteYamlScalar(s))
    .filter(Boolean);

  const id = meta.id || fallbackId;
  const isBuiltin = source === "builtin" || BUILTIN_SKILL_IDS.has(id);

  return {
    id,
    name: meta.name || fallbackId,
    summary: meta.summary || "自定义复盘提炼 Skill",
    tags,
    builtin: isBuiltin,
    editable: source === "workspace" && !isBuiltin,
    source: isBuiltin ? "builtin" : source,
    fileName,
    content: body,
  };
}

async function scanSkillsDir(dirPath: string, source: "repo" | "workspace"): Promise<SkillSpec[]> {
  const loaded: SkillSpec[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.toLowerCase() === "readme.md") continue;
      const raw = await readFile(path.join(dirPath, entry.name), "utf8");
      const fallbackId = path.basename(entry.name, ".md");
      const resolvedSource: SkillSource =
        source === "repo" && BUILTIN_SKILL_IDS.has(fallbackId) ? "builtin" : source;
      loaded.push(parseSkillMarkdown(raw, fallbackId, entry.name, resolvedSource));
    }
  } catch {
    /* directory optional */
  }
  return loaded;
}

/**
 * Loads all Skills from:
 * 1) Built-in `general` mode
 * 2) `<repo>/skills/*.md` (built-in presets & community repo skills)
 * 3) `<workspace>/skills/*.md` (user-created custom skills, git-ignored & editable in UI)
 */
export async function loadSkills(): Promise<SkillSpec[]> {
  const repoSkillsDir = path.join(process.cwd(), "skills");
  const workspaceSkillsDir = getWorkspacePaths().skills;

  const [repoSkills, workspaceSkills] = await Promise.all([
    scanSkillsDir(repoSkillsDir, "repo"),
    scanSkillsDir(workspaceSkillsDir, "workspace"),
  ]);

  const byId = new Map<string, SkillSpec>();
  for (const sk of repoSkills) {
    byId.set(sk.id, sk);
  }
  for (const sk of workspaceSkills) {
    if (BUILTIN_SKILL_IDS.has(sk.id)) continue;
    byId.set(sk.id, sk);
  }

  const order = new Map([
    ["short-term", 0],
    ["fundamental", 1],
  ]);

  const merged = [...byId.values()].sort((a, b) => {
    const oa = order.get(a.id) ?? (a.source === "repo" ? 50 : 99);
    const ob = order.get(b.id) ?? (b.source === "repo" ? 50 : 99);
    return oa - ob || a.id.localeCompare(b.id);
  });

  return [GENERAL_SKILL, ...merged];
}

export async function getSkillById(id: string): Promise<SkillSpec> {
  const all = await loadSkills();
  return all.find((s) => s.id === id) ?? GENERAL_SKILL;
}

export async function saveCustomSkill(
  input: SaveSkillInput,
): Promise<{ ok: true; skill: SkillSpec; skills: SkillSpec[] } | { ok: false; error: string }> {
  const idCheck = validateCustomSkillId(input.id ?? "");
  if (!idCheck.ok) return idCheck;

  const name = (input.name ?? "").trim();
  if (!name) {
    return { ok: false, error: "请填写 Skill 显示名称" };
  }
  if (name.length > 80) {
    return { ok: false, error: "Skill 名称不能超过 80 个字符" };
  }

  const summary = (input.summary ?? "").trim() || "自定义复盘提炼 Skill";
  const content = (input.content ?? "").replace(/\r\n?/g, "\n").trim();
  if (content.length < 20) {
    return { ok: false, error: "Skill 提示词框架正文太短（至少 20 个字符），请补充你的分析维度或提炼要求" };
  }
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    return { ok: false, error: `Skill 正文超过 ${MAX_SKILL_CONTENT_CHARS} 字符上限` };
  }

  // Prevent shadowing a non-editable repo skill file
  const repoSkills = await scanSkillsDir(path.join(process.cwd(), "skills"), "repo");
  if (repoSkills.some((s) => s.id === idCheck.id)) {
    return {
      ok: false,
      error: `「${idCheck.id}」与仓库目录 skills/ 中的只读 Skill 重名，请使用其他自定义 ID`,
    };
  }

  const tags = normalizeSkillTags(input.tags);
  const paths = await ensureWorkspace();
  const fileName = `${idCheck.id}.md`;
  const targetPath = path.join(paths.skills, fileName);

  const md = serializeSkillMarkdown({
    id: idCheck.id,
    name,
    summary,
    tags,
    content,
  });

  await writeAtomic(targetPath, md);

  const skills = await loadSkills();
  const saved = skills.find((s) => s.id === idCheck.id) ?? parseSkillMarkdown(md, idCheck.id, fileName, "workspace");
  return { ok: true, skill: saved, skills };
}

export async function deleteCustomSkill(
  rawId: string,
): Promise<{ ok: true; skills: SkillSpec[] } | { ok: false; status: number; error: string }> {
  const idCheck = validateCustomSkillId(rawId ?? "");
  if (!idCheck.ok) {
    return { ok: false, status: 400, error: idCheck.error };
  }

  const paths = await ensureWorkspace();
  const safePath = await insideRoot(paths.skills, `${idCheck.id}.md`);
  if (!safePath) {
    return { ok: false, status: 404, error: `未找到自定义 Skill「${idCheck.id}」` };
  }

  await unlink(safePath);
  const skills = await loadSkills();
  return { ok: true, skills };
}
