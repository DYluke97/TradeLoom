import { readFile } from "node:fs/promises";
import { ensureWorkspace, fileExists, getWorkspacePaths, writeAtomic } from "./workspace";

export type ConceptRule = {
  id: string;
  concept: string;
  keywords: string[];
  enabled: boolean;
  builtin?: boolean;
};

/**
 * Default trading concept taxonomy for untagged legacy reviews.
 * Users can freely edit, toggle, add, or delete rules in `workspace/concepts.json`
 * and re-weave their Obsidian bi-directional vault with one click.
 */
export const DEFAULT_CONCEPT_RULES: ConceptRule[] = [
  { id: "emotion-cycle", concept: "情绪周期", keywords: ["情绪周期", "冰点", "高潮", "情绪修复", "发酵期"], enabled: true, builtin: true },
  { id: "ebb-risk", concept: "退潮风控", keywords: ["退潮", "核按钮", "炸板率", "连亏降档", "负反馈"], enabled: true, builtin: true },
  { id: "leader-tier", concept: "龙头与梯队", keywords: ["龙头", "梯队", "中军", "跟风", "补涨", "连板"], enabled: true, builtin: true },
  { id: "entry-setup", concept: "买点结构", keywords: ["弱转强", "分歧转一致", "首板", "回踩", "放量突破", "竞价"], enabled: true, builtin: true },
  { id: "position-stop", concept: "仓位与止损", keywords: ["止损", "仓位", "单笔风险", "回撤", "空仓", "T+1"], enabled: true, builtin: true },
  { id: "chase-counter", concept: "追高反例", keywords: ["追高", "追涨", "半路", "接盘", "反例"], enabled: true, builtin: true },
  { id: "sector-cycle", concept: "行业景气", keywords: ["景气", "渗透率", "产能", "订单", "资本开支", "竞争格局"], enabled: true, builtin: true },
  { id: "financial-quality", concept: "财务质量", keywords: ["现金流", "应收账款", "存货", "毛利率", "扣非", "三表", "ROE"], enabled: true, builtin: true },
  { id: "valuation-anchor", concept: "估值锚", keywords: ["估值", "PE", "PB", "分位", "DCF", "赔率", "安全边际"], enabled: true, builtin: true },
  { id: "fundamental-trap", concept: "基本面排雷", keywords: ["商誉", "质押", "减持", "排雷", "证伪", "财务洗澡"], enabled: true, builtin: true },
];

function sanitizeConceptName(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1f#[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export function normalizeConceptRules(input: unknown): ConceptRule[] {
  if (!Array.isArray(input)) return DEFAULT_CONCEPT_RULES.map((r) => ({ ...r, keywords: [...r.keywords] }));

  const out: ConceptRule[] = [];
  const seenName = new Set<string>();
  input.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const obj = raw as Record<string, unknown>;
    const concept = sanitizeConceptName(typeof obj.concept === "string" ? obj.concept : "");
    if (!concept || seenName.has(concept)) return;
    seenName.add(concept);

    const rawKeywords = Array.isArray(obj.keywords)
      ? obj.keywords
      : typeof obj.keywords === "string"
        ? obj.keywords.split(/[,，、\n]+/)
        : [];
    const keywords = [...new Set(rawKeywords.map((k) => (typeof k === "string" ? k.trim() : "")).filter(Boolean))].slice(0, 40);
    if (keywords.length === 0) return;

    const id =
      typeof obj.id === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(obj.id.trim())
        ? obj.id.trim()
        : `custom-${idx + 1}-${Date.now().toString(36)}`;

    out.push({
      id,
      concept,
      keywords,
      enabled: obj.enabled !== false,
      builtin: Boolean(obj.builtin),
    });
  });

  return out;
}

export async function loadConceptRules(): Promise<{ rules: ConceptRule[]; customized: boolean }> {
  const paths = getWorkspacePaths();
  if (await fileExists(paths.conceptsFile)) {
    try {
      const parsed = JSON.parse(await readFile(paths.conceptsFile, "utf8")) as {
        schema?: string;
        rules?: unknown;
      };
      if (parsed && Array.isArray(parsed.rules)) {
        return { rules: normalizeConceptRules(parsed.rules), customized: true };
      }
    } catch {
      /* fallback to defaults */
    }
  }
  return {
    rules: DEFAULT_CONCEPT_RULES.map((r) => ({ ...r, keywords: [...r.keywords] })),
    customized: false,
  };
}

export async function saveConceptRules(input: unknown): Promise<ConceptRule[]> {
  const paths = await ensureWorkspace();
  const rules = normalizeConceptRules(input);
  await writeAtomic(
    paths.conceptsFile,
    JSON.stringify(
      {
        schema: "tradeloom-concepts@v1",
        updated_at: new Date().toISOString(),
        rules,
      },
      null,
      2,
    ),
  );
  return rules;
}

export async function resetConceptRules(): Promise<ConceptRule[]> {
  return saveConceptRules(DEFAULT_CONCEPT_RULES);
}

/**
 * Matches enabled concept rules against note text (case-insensitive literal substring matching).
 */
export function extractAutoConcepts(text: string, rules: ConceptRule[] = DEFAULT_CONCEPT_RULES): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.keywords.length === 0) continue;
    if (rule.keywords.some((kw) => kw.length > 0 && lower.includes(kw.toLowerCase()))) {
      hits.push(rule.concept);
    }
  }
  return hits;
}
