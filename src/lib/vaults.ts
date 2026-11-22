import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONCEPT_RULES, loadConceptRules, saveConceptRules, type ConceptRule } from "./concepts";
import { buildStaticDemoManual } from "./demo-manual";
import { buildPeriodQuantBrief, loadLedger, saveLedger } from "./ledger";
import { generateDemoLedgerRows } from "./ledger-demo";
import { getMaskedProviderStatus } from "./provider";
import { exportReportToObsidianMarkdown, type SynthesisReport } from "./synthesis";
import { rebuildVault } from "./vault";
import type { VaultIndex } from "./vault-builder";
import {
  DEFAULT_VAULT_ID,
  ensureWorkspace,
  fileExists,
  getGlobalWorkspaceRoot,
  getWorkspacePaths,
  isValidVaultId,
  runWithVault,
  writeAtomic,
} from "./workspace";

import {
  DEMO_VAULT_ID,
  VAULT_ACCENT_COLORS,
  type VaultConnectorFilterMap,
  type VaultMeta,
  type VaultOnboardingSteps,
  type VaultRegistry,
  type VaultStats,
  type VaultSummary,
  type VaultTemplateId,
  type VaultTemplatePublic,
  type VaultsOverview,
} from "./vault-types";
export {
  DEMO_VAULT_ID,
  VAULT_ACCENT_COLORS,
  type VaultConnectorFilterMap,
  type VaultMeta,
  type VaultOnboardingSteps,
  type VaultRegistry,
  type VaultStats,
  type VaultSummary,
  type VaultTemplateId,
  type VaultTemplatePublic,
  type VaultsOverview,
};

export type VaultTemplate = {
  id: VaultTemplateId;
  name: string;
  badge: string;
  description: string;
  color: string;
  defaultSkillId: string;
  conceptRules: ConceptRule[];
};

const SHORT_TERM_RULES: ConceptRule[] = [
  { id: "emotion-cycle", concept: "情绪周期", keywords: ["情绪周期", "冰点", "高潮", "情绪修复", "发酵期"], enabled: true, builtin: true },
  { id: "ebb-risk", concept: "退潮风控", keywords: ["退潮", "核按钮", "炸板率", "连亏降档", "负反馈"], enabled: true, builtin: true },
  { id: "leader-tier", concept: "龙头与梯队", keywords: ["龙头", "梯队", "中军", "跟风", "补涨", "连板"], enabled: true, builtin: true },
  { id: "entry-setup", concept: "买点结构", keywords: ["弱转强", "分歧转一致", "首板", "回踩", "放量突破", "竞价"], enabled: true, builtin: true },
  { id: "position-stop", concept: "仓位与止损", keywords: ["止损", "仓位", "单笔风险", "回撤", "空仓", "T+1"], enabled: true, builtin: true },
  { id: "chase-counter", concept: "追高反例", keywords: ["追高", "追涨", "半路", "接盘", "反例"], enabled: true, builtin: true },
];

const FUNDAMENTAL_RULES: ConceptRule[] = [
  { id: "sector-cycle", concept: "行业景气", keywords: ["景气", "渗透率", "产能", "订单", "资本开支", "竞争格局", "CR3"], enabled: true, builtin: true },
  { id: "financial-quality", concept: "财务质量", keywords: ["现金流", "应收账款", "存货", "毛利率", "扣非", "三表", "ROE"], enabled: true, builtin: true },
  { id: "valuation-anchor", concept: "估值锚", keywords: ["估值", "PE", "PB", "分位", "DCF", "赔率", "安全边际"], enabled: true, builtin: true },
  { id: "fundamental-trap", concept: "基本面排雷", keywords: ["商誉", "质押", "减持", "排雷", "证伪", "财务洗澡"], enabled: true, builtin: true },
  { id: "moat-business", concept: "商业模式与壁垒", keywords: ["护城河", "壁垒", "定价权", "复购", "市占率", "渠道", "研发"], enabled: true, builtin: true },
  { id: "position-stop", concept: "仓位与止损", keywords: ["仓位", "建仓", "加仓", "清仓", "回撤", "分批"], enabled: true, builtin: true },
];

const TREND_SWING_RULES: ConceptRule[] = [
  { id: "trend-structure", concept: "趋势结构", keywords: ["均线", "右侧", "趋势", "多头排列", "箱体", "平台", "突破", "波段"], enabled: true, builtin: true },
  { id: "volume-price", concept: "量价信号", keywords: ["放量", "缩量", "背离", "换手", "承接", "突破回踩"], enabled: true, builtin: true },
  { id: "entry-exit", concept: "加减仓节奏", keywords: ["试错", "底仓", "加仓", "减仓", "止盈", "滚仓", "做T"], enabled: true, builtin: true },
  { id: "risk-control", concept: "止损与资金管理", keywords: ["止损", "回撤", "盈亏比", "单笔风险", "杠杆", "融资", "仓位"], enabled: true, builtin: true },
  { id: "macro-cycle", concept: "宏观与周期", keywords: ["美联储", "利率", "汇率", "大宗", "供需", "库存周期", "政策"], enabled: true, builtin: true },
  { id: "counterexample", concept: "逆势反例", keywords: ["抄底", "扛单", "逆势", "追高", "违纪", "反例"], enabled: true, builtin: true },
];

export const VAULT_TEMPLATES: VaultTemplate[] = [
  {
    id: "short-term",
    name: "A 股短线 / 龙头情绪",
    badge: "情绪周期 · 梯队 · 止损",
    description: "适合打板、龙头低吸、题材轮动等短线复盘，预置情绪周期/退潮风控/追高反例词典与短线提炼规则。",
    color: "#2d5f8b",
    defaultSkillId: "short-term",
    conceptRules: SHORT_TERM_RULES,
  },
  {
    id: "fundamental",
    name: "中长线价值 / 财报基本面",
    badge: "行业景气 · 现金流 · 估值锚",
    description: "适合财报跟踪、行业研报、公司深度研究，预置财务质量/基本面排雷/护城河词典与基本面提炼规则。",
    color: "#0f766e",
    defaultSkillId: "fundamental",
    conceptRules: FUNDAMENTAL_RULES,
  },
  {
    id: "trend-swing",
    name: "趋势波段 / 期货与右侧",
    badge: "右侧趋势 · 量价 · 盈亏比",
    description: "适合右侧趋势交易、商品期货、美股/ETF 波段复盘，预置趋势结构/量价信号/资金管理词典。",
    color: "#b4690e",
    defaultSkillId: "trend-swing",
    conceptRules: TREND_SWING_RULES,
  },
  {
    id: "custom",
    name: "大师体系拆解 / 通用空白",
    badge: "综合词典 · 自由定制",
    description: "适合拆解某位大 V/前辈的完整复盘体系、读书笔记或跨市场综合复盘，保留通用全量词典随时自定义。",
    color: "#157f57",
    defaultSkillId: "general",
    conceptRules: DEFAULT_CONCEPT_RULES,
  },
];

function makeDefaultVaultMeta(now = new Date().toISOString()): VaultMeta {
  return {
    id: DEFAULT_VAULT_ID,
    name: "我的主复盘库",
    description: "默认本地 Obsidian 双链复盘知识库",
    color: "#2d5f8b",
    templateId: "custom",
    defaultSkillId: "short-term",
    isDefault: true,
    createdAt: now,
    lastOpenedAt: now,
  };
}

function sanitizeVaultName(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, 48);
}

function makeSlugVaultId(name: string, existingIds: Set<string>): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = ascii && /^[a-z0-9]/.test(ascii) ? ascii : "vault";
  const stamp = Date.now().toString(36).slice(-5);
  let candidate = `${base}-${stamp}`;
  let idx = 1;
  while (existingIds.has(candidate) || !isValidVaultId(candidate)) {
    candidate = `${base}-${stamp}-${idx++}`;
  }
  return candidate;
}

function normalizeVaultMeta(raw: Partial<VaultMeta>, fallbackId: string, now: string): VaultMeta {
  const id = isValidVaultId(raw.id) ? raw.id.trim() : fallbackId;
  const tplId: VaultTemplateId =
    raw.templateId === "short-term" ||
    raw.templateId === "fundamental" ||
    raw.templateId === "trend-swing" ||
    raw.templateId === "custom"
      ? raw.templateId
      : "custom";
  const tpl = VAULT_TEMPLATES.find((t) => t.id === tplId) ?? VAULT_TEMPLATES[3];
  return {
    id,
    name: sanitizeVaultName(raw.name || "") || (id === DEFAULT_VAULT_ID ? "我的主复盘库" : id),
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 160) : "",
    color:
      typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color.trim())
        ? raw.color.trim()
        : tpl.color,
    templateId: tplId,
    defaultSkillId: typeof raw.defaultSkillId === "string" && raw.defaultSkillId.trim() ? raw.defaultSkillId.trim() : tpl.defaultSkillId,
    isDefault: id === DEFAULT_VAULT_ID ? true : undefined,
    isDemo: raw.isDemo ? true : undefined,
    externalSourceDir:
      typeof raw.externalSourceDir === "string" && raw.externalSourceDir.trim()
        ? path.resolve(raw.externalSourceDir.trim())
        : undefined,
    skipLedgerStep: raw.skipLedgerStep ? true : undefined,
    connectorFilters:
      raw.connectorFilters && typeof raw.connectorFilters === "object" ? raw.connectorFilters : undefined,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : now,
    lastOpenedAt: typeof raw.lastOpenedAt === "string" && raw.lastOpenedAt ? raw.lastOpenedAt : now,
  };
}

export async function loadVaultRegistry(): Promise<VaultRegistry> {
  const root = getGlobalWorkspaceRoot();
  const vaultsFile = path.join(root, "vaults.json");
  const now = new Date().toISOString();

  if (await fileExists(vaultsFile)) {
    try {
      const parsed = JSON.parse(await readFile(vaultsFile, "utf8")) as Partial<VaultRegistry>;
      if (parsed && Array.isArray(parsed.vaults) && parsed.vaults.length > 0) {
        const seen = new Set<string>();
        const vaults: VaultMeta[] = [];
        for (const item of parsed.vaults) {
          if (!item || typeof item !== "object" || !isValidVaultId(item.id)) continue;
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          vaults.push(normalizeVaultMeta(item, item.id, now));
        }
        if (!seen.has(DEFAULT_VAULT_ID)) {
          vaults.unshift(makeDefaultVaultMeta(now));
        }
        const activeVaultId =
          parsed.activeVaultId && vaults.some((v) => v.id === parsed.activeVaultId)
            ? parsed.activeVaultId
            : DEFAULT_VAULT_ID;
        return { schema: "tradeloom-vaults@v1", activeVaultId, vaults };
      }
    } catch {
      /* fallback to default registry */
    }
  }

  return {
    schema: "tradeloom-vaults@v1",
    activeVaultId: DEFAULT_VAULT_ID,
    vaults: [makeDefaultVaultMeta(now)],
  };
}

export async function saveVaultRegistry(registry: VaultRegistry): Promise<VaultRegistry> {
  const root = getGlobalWorkspaceRoot();
  await mkdir(root, { recursive: true });
  const vaultsFile = path.join(root, "vaults.json");
  await writeAtomic(vaultsFile, JSON.stringify(registry, null, 2));
  return registry;
}

async function countSourceFilesFast(dir: string): Promise<number> {
  let count = 0;
  async function walk(current: string, depth: number) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile() && /\.(md|markdown|txt|docx|html|htm|pdf)$/i.test(e.name)) {
        count++;
      }
    }
  }
  await walk(dir, 0);
  return count;
}

export async function readVaultStatsFast(vaultId: string): Promise<VaultStats> {
  const paths = getWorkspacePaths(vaultId);

  let docsCount = 0;
  let yearsCount = 0;
  let topicsCount = 0;
  let linksCount = 0;

  const indexFile = path.join(paths.vault, "index.json");
  if (await fileExists(indexFile)) {
    try {
      const idx = JSON.parse(await readFile(indexFile, "utf8")) as Partial<VaultIndex>;
      if (idx?.counts) {
        docsCount = Number(idx.counts.total) || 0;
        yearsCount = Number(idx.counts.years) || 0;
        topicsCount = Number(idx.counts.topics) || 0;
        linksCount = Number(idx.counts.links) || 0;
      }
    } catch {
      docsCount = await countSourceFilesFast(paths.sources);
    }
  } else {
    docsCount = await countSourceFilesFast(paths.sources);
  }

  let manualsCount = 0;
  let latestManualTitle: string | null = null;
  let latestManualAt: string | null = null;
  try {
    const manualFiles = await readdir(paths.manuals, { withFileTypes: true });
    for (const f of manualFiles) {
      if (!f.isFile() || !f.name.endsWith(".json")) continue;
      try {
        const rep = JSON.parse(await readFile(path.join(paths.manuals, f.name), "utf8")) as Partial<SynthesisReport>;
        if (rep && rep.schema === "tradeloom-playbook@v1") {
          manualsCount++;
          const created = typeof rep.created_at === "string" ? rep.created_at : "";
          if (!latestManualAt || created > latestManualAt) {
            latestManualAt = created;
            latestManualTitle = rep.title || f.name;
          }
        }
      } catch {
        /* skip corrupt */
      }
    }
  } catch {
    /* manuals dir may not exist yet */
  }

  let tradesCount = 0;
  let dailyRecordsCount = 0;
  if (await fileExists(paths.ledgerFile)) {
    try {
      const ledger = JSON.parse(await readFile(paths.ledgerFile, "utf8")) as {
        trades?: unknown[];
        dailyRecords?: unknown[];
      };
      tradesCount = Array.isArray(ledger.trades) ? ledger.trades.length : 0;
      dailyRecordsCount = Array.isArray(ledger.dailyRecords) ? ledger.dailyRecords.length : 0;
    } catch {
      /* ignore */
    }
  }

  return {
    docsCount,
    yearsCount,
    topicsCount,
    linksCount,
    manualsCount,
    tradesCount,
    dailyRecordsCount,
    latestManualTitle,
    latestManualAt,
  };
}

export async function getVaultsOverview(): Promise<VaultsOverview> {
  const [reg, provider] = await Promise.all([loadVaultRegistry(), getMaskedProviderStatus()]);

  const vaults: VaultSummary[] = await Promise.all(
    reg.vaults.map(async (meta) => {
      const paths = getWorkspacePaths(meta.id);
      const stats = await readVaultStatsFast(meta.id);
      return {
        ...meta,
        paths: {
          vaultDir: paths.vault,
          sourceDir: paths.sources,
          isExternal: Boolean(meta.externalSourceDir),
        },
        stats,
      };
    }),
  );

  const activeVault = vaults.find((v) => v.id === reg.activeVaultId) ?? vaults[0];
  const hasDemoVault = vaults.some((v) => v.isDemo || v.id === DEMO_VAULT_ID);
  const personalVaults = vaults.filter((v) => !v.isDemo && v.id !== DEMO_VAULT_ID);
  const hasAnyPersonalData = personalVaults.some(
    (v) =>
      v.stats.docsCount > 0 ||
      v.stats.manualsCount > 0 ||
      v.stats.tradesCount > 0 ||
      v.stats.dailyRecordsCount > 0 ||
      v.id !== DEFAULT_VAULT_ID,
  );
  const isFreshInstall = !hasAnyPersonalData && !hasDemoVault;

  const hasReviews = activeVault.stats.docsCount > 0;
  const hasLedgerOrSkipped =
    activeVault.stats.tradesCount > 0 ||
    activeVault.stats.dailyRecordsCount > 0 ||
    Boolean(activeVault.skipLedgerStep);
  const hasLlm = Boolean(provider.configured);
  const hasManual = activeVault.stats.manualsCount > 0;
  const completedCount = [hasReviews, hasLedgerOrSkipped, hasLlm, hasManual].filter(Boolean).length;

  return {
    activeVaultId: activeVault.id,
    activeVault,
    vaults,
    templates: VAULT_TEMPLATES.map(({ conceptRules, ...rest }) => ({
      ...rest,
      conceptCount: conceptRules.length,
    })),
    onboarding: {
      isFreshInstall,
      hasAnyPersonalData,
      hasDemoVault,
      llmConfigured: hasLlm,
      activeVaultSteps: {
        hasReviews,
        hasLedgerOrSkipped,
        hasLlm,
        hasManual,
        completedCount,
        totalCount: 4,
      },
    },
  };
}

export async function getVaultMetaById(vaultId: string): Promise<VaultMeta | null> {
  const reg = await loadVaultRegistry();
  return reg.vaults.find((v) => v.id === vaultId) ?? null;
}

export async function getVaultConnectorFilters(
  vaultId: string,
  connectorId: string,
): Promise<Record<string, string> | null> {
  const meta = await getVaultMetaById(vaultId);
  const filters = meta?.connectorFilters?.[connectorId];
  return filters && typeof filters === "object" ? filters : null;
}

async function validateExternalSourceDir(rawDir: string): Promise<{ ok: true; resolved: string } | { ok: false; error: string }> {
  const trimmed = rawDir.trim();
  if (!trimmed) return { ok: false, error: "外部目录路径不能为空" };
  const resolved = path.resolve(trimmed);
  const root = getGlobalWorkspaceRoot();
  const norm = (p: string) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
  if (norm(resolved) === norm(root) || norm(resolved) === norm(path.join(root, "vaults"))) {
    return { ok: false, error: "不能将 TradeLoom 全局 workspace 根目录直接挂载为外部素材目录" };
  }
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      return { ok: false, error: "指定路径不是有效的文件夹目录" };
    }
    return { ok: true, resolved };
  } catch {
    return { ok: false, error: `找不到本机目录：${resolved}（请确认文件夹已存在且可读）` };
  }
}

export type CreateVaultInput = {
  name: string;
  description?: string;
  color?: string;
  templateId?: VaultTemplateId;
  defaultSkillId?: string;
  externalSourceDir?: string;
  cloneConceptsFromVaultId?: string;
  activate?: boolean;
};

export async function createVault(
  input: CreateVaultInput,
): Promise<{ ok: true; vault: VaultSummary; overview: VaultsOverview } | { ok: false; error: string }> {
  const name = sanitizeVaultName(input.name || "");
  if (!name) {
    return { ok: false, error: "请填写知识库名称（例如：A股短线实盘、美股财报基本面）" };
  }

  let externalSourceDir: string | undefined;
  if (input.externalSourceDir && input.externalSourceDir.trim()) {
    const checked = await validateExternalSourceDir(input.externalSourceDir);
    if (!checked.ok) return checked;
    externalSourceDir = checked.resolved;
  }

  const reg = await loadVaultRegistry();
  const existingIds = new Set(reg.vaults.map((v) => v.id));
  const id = makeSlugVaultId(name, existingIds);

  const tpl = VAULT_TEMPLATES.find((t) => t.id === input.templateId) ?? VAULT_TEMPLATES[0];
  const now = new Date().toISOString();
  const meta: VaultMeta = {
    id,
    name,
    description: (input.description ?? "").trim().slice(0, 160),
    color:
      input.color && /^#[0-9a-fA-F]{6}$/.test(input.color.trim())
        ? input.color.trim()
        : tpl.color,
    templateId: tpl.id,
    defaultSkillId: input.defaultSkillId?.trim() || tpl.defaultSkillId,
    externalSourceDir,
    createdAt: now,
    lastOpenedAt: now,
  };

  let conceptRules = tpl.conceptRules;
  if (input.cloneConceptsFromVaultId && existingIds.has(input.cloneConceptsFromVaultId)) {
    const cloned = await runWithVault(input.cloneConceptsFromVaultId, () => loadConceptRules());
    if (cloned.rules.length > 0) conceptRules = cloned.rules;
  }

  reg.vaults.push(meta);
  if (input.activate !== false) {
    reg.activeVaultId = id;
  }
  await saveVaultRegistry(reg);

  await runWithVault(id, async () => {
    await ensureWorkspace(id);
    await saveConceptRules(conceptRules);
    await rebuildVault();
  });

  const overview = await getVaultsOverview();
  const created = overview.vaults.find((v) => v.id === id) ?? overview.activeVault;
  return { ok: true, vault: created, overview };
}

export async function switchActiveVault(
  vaultId: string,
): Promise<{ ok: true; overview: VaultsOverview } | { ok: false; error: string }> {
  const reg = await loadVaultRegistry();
  const target = reg.vaults.find((v) => v.id === vaultId);
  if (!target) {
    return { ok: false, error: `找不到知识库：${vaultId}` };
  }
  target.lastOpenedAt = new Date().toISOString();
  reg.activeVaultId = target.id;
  await saveVaultRegistry(reg);
  await ensureWorkspace(target.id);
  const overview = await getVaultsOverview();
  return { ok: true, overview };
}

export async function updateVaultMeta(
  vaultId: string,
  patch: {
    name?: string;
    description?: string;
    color?: string;
    defaultSkillId?: string;
    skipLedgerStep?: boolean;
  },
): Promise<{ ok: true; overview: VaultsOverview } | { ok: false; error: string }> {
  const reg = await loadVaultRegistry();
  const target = reg.vaults.find((v) => v.id === vaultId);
  if (!target) {
    return { ok: false, error: `找不到知识库：${vaultId}` };
  }
  if (typeof patch.name === "string") {
    const clean = sanitizeVaultName(patch.name);
    if (!clean) return { ok: false, error: "知识库名称不能为空" };
    target.name = clean;
  }
  if (typeof patch.description === "string") {
    target.description = patch.description.trim().slice(0, 160);
  }
  if (typeof patch.color === "string" && /^#[0-9a-fA-F]{6}$/.test(patch.color.trim())) {
    target.color = patch.color.trim();
  }
  if (typeof patch.defaultSkillId === "string" && patch.defaultSkillId.trim()) {
    target.defaultSkillId = patch.defaultSkillId.trim();
  }
  if (typeof patch.skipLedgerStep === "boolean") {
    target.skipLedgerStep = patch.skipLedgerStep || undefined;
  }

  await saveVaultRegistry(reg);
  const overview = await getVaultsOverview();
  return { ok: true, overview };
}

export async function saveVaultConnectorFilters(
  vaultId: string,
  connectorId: string,
  filters: Record<string, string>,
): Promise<{ ok: true; overview: VaultsOverview } | { ok: false; error: string }> {
  const reg = await loadVaultRegistry();
  const target = reg.vaults.find((v) => v.id === vaultId);
  if (!target) {
    return { ok: false, error: `找不到知识库：${vaultId}` };
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (typeof v === "string") clean[k] = v.trim();
  }
  target.connectorFilters = {
    ...(target.connectorFilters ?? {}),
    [connectorId]: clean,
  };
  await saveVaultRegistry(reg);
  const overview = await getVaultsOverview();
  return { ok: true, overview };
}

export async function deleteVault(
  vaultId: string,
): Promise<{ ok: true; trashedTo: string | null; overview: VaultsOverview } | { ok: false; error: string }> {
  if (vaultId === DEFAULT_VAULT_ID) {
    return { ok: false, error: "默认主知识库不支持直接删除（可重命名或清空其中文档）" };
  }
  const reg = await loadVaultRegistry();
  const idx = reg.vaults.findIndex((v) => v.id === vaultId);
  if (idx < 0) {
    return { ok: false, error: `找不到知识库：${vaultId}` };
  }

  const [removed] = reg.vaults.splice(idx, 1);
  if (reg.activeVaultId === vaultId) {
    const sorted = [...reg.vaults].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    reg.activeVaultId = sorted[0]?.id ?? DEFAULT_VAULT_ID;
  }
  await saveVaultRegistry(reg);

  const root = getGlobalWorkspaceRoot();
  const managedDir = path.join(root, "vaults", removed.id);
  let trashedTo: string | null = null;
  if (await fileExists(managedDir)) {
    const trashParent = path.join(root, ".trash", "vaults");
    await mkdir(trashParent, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
    const trashRel = `.trash/vaults/${stamp}_${removed.id}`;
    await rename(managedDir, path.join(root, trashRel));
    trashedTo = trashRel;
  }

  const overview = await getVaultsOverview();
  return { ok: true, trashedTo, overview };
}

/**
 * Creates (or cleanly resets) the isolated Demo Sandbox Vault (`demo-sandbox`) containing:
 * 1) 6 built-in sample reviews (with full Obsidian bi-directional links & graph)
 * 2) Complete demo trading ledger (daily NAV curve + A-share buy/sell executions)
 * 3) 1 rich static demonstration playbook manual (viewable BEFORE configuring any LLM API key)
 * Never touches `default` or any personal user vault.
 */
export async function createOrResetDemoVault(opts?: {
  activate?: boolean;
}): Promise<{ ok: true; vault: VaultSummary; overview: VaultsOverview }> {
  const reg = await loadVaultRegistry();
  const now = new Date().toISOString();
  let meta = reg.vaults.find((v) => v.id === DEMO_VAULT_ID);

  if (!meta) {
    meta = {
      id: DEMO_VAULT_ID,
      name: "体验示范库（A 股双轨实盘）",
      description: "内置 6 篇复盘 + 示例交割账本 + 免配模型即可预览的示范交易手册，随时可删绝不污染正式库。",
      color: "#06b6d4",
      templateId: "short-term",
      defaultSkillId: "short-term",
      isDemo: true,
      createdAt: now,
      lastOpenedAt: now,
    };
    reg.vaults.push(meta);
  } else {
    meta.isDemo = true;
    meta.lastOpenedAt = now;
  }

  if (opts?.activate !== false) {
    reg.activeVaultId = DEMO_VAULT_ID;
  }
  await saveVaultRegistry(reg);

  const root = getGlobalWorkspaceRoot();
  const demoDir = path.join(root, "vaults", DEMO_VAULT_ID);
  await rm(demoDir, { recursive: true, force: true }).catch(() => {});

  await runWithVault(DEMO_VAULT_ID, async () => {
    const paths = await ensureWorkspace(DEMO_VAULT_ID);

    // 1. Copy 6 built-in sample reviews into demo-sandbox/sources/
    const sampleDir = path.join(process.cwd(), "samples");
    try {
      const entries = await readdir(sampleDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        await copyFile(path.join(sampleDir, entry.name), path.join(paths.sources, entry.name));
      }
    } catch {
      /* tolerate missing samples dir in minimal test environments */
    }

    // 2. Save full default concept rules & build initial Obsidian vault index
    await saveConceptRules(DEFAULT_CONCEPT_RULES);
    const firstIndex = await rebuildVault();

    // 3. Populate isolated demo ledger (daily NAV + A-share executions)
    const demoRows = await generateDemoLedgerRows();
    const currentLedger = await loadLedger();
    await saveLedger({
      ...currentLedger,
      dailyRecords: demoRows.dailyRecords,
      trades: demoRows.trades,
    });
    const quantAnchor = await buildPeriodQuantBrief();

    // 4. Write schema-valid static demonstration manual (.json + .md) & re-weave into Obsidian graph
    const demoReport = buildStaticDemoManual(firstIndex, quantAnchor);
    await writeAtomic(path.join(paths.manuals, `${demoReport.id}.json`), JSON.stringify(demoReport, null, 2));
    await writeAtomic(path.join(paths.manuals, `${demoReport.id}.md`), exportReportToObsidianMarkdown(demoReport));

    await rebuildVault();
  });

  const overview = await getVaultsOverview();
  const demoSummary = overview.vaults.find((v) => v.id === DEMO_VAULT_ID) ?? overview.activeVault;
  return { ok: true, vault: demoSummary, overview };
}