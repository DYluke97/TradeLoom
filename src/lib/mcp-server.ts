import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { importFromUrl, importPastedReview, parseBatchUrls } from "./cloud-ingest";
import { carrierOf, MAX_INPUT_BYTES } from "./convert";
import { buildPeriodQuantBrief, importLedgerCsv } from "./ledger";
import { loadSkills } from "./skills";
import {
  exportSynthesisPromptPack,
  importExternalSynthesisResult,
  listSavedManuals,
} from "./synthesis";
import { importUploadedFile, loadOrBuildVault, readOriginalSource, readVaultCard, rebuildVault } from "./vault";
import type { VaultIndex } from "./vault-builder";
import {
  createVault,
  DEMO_VAULT_ID,
  getVaultsOverview,
  type VaultSummary,
  type VaultTemplateId,
} from "./vaults";
import {
  fileExists,
  getActiveVaultId,
  getGlobalWorkspaceRoot,
  getWorkspacePaths,
  runWithVault,
} from "./workspace";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_INFO = {
  name: "tradeloom-mcp",
  version: "1.2.1",
};

const MAX_LOCAL_IMPORT_FILES = 200;
const MAX_LOCAL_SCAN_DEPTH = 5;
const MAX_MCP_BATCH_URLS = 20;
const IGNORED_SCAN_DIRS = new Set(["node_modules", ".git", ".next", "dist", "__pycache__", ".trash", ".vault-history"]);

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const TRADELOOM_MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "tradeloom_list_vaults",
    description:
      "列出本机所有 TradeLoom 交易复盘知识库（含 id、名称、简介、模板、高频主题标签 topTopics、文档/实盘/手册统计及当前激活库）。在写入复盘、导入本地文件、抓取链接或导入账本前，应先调用本工具识别是否存在多个复盘库。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_create_vault",
    description:
      "新建一个独立的 TradeLoom 交易复盘知识库（支持指定模板与简介，或直接外挂本机已有 Obsidian 文件夹）。当现有复盘库都不匹配或用户明确要求新建库时调用。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "必填，新知识库名称（例如：2026 美股财报复盘）" },
        description: { type: "string", description: "可选，知识库定位与用途说明（有助于后续自动匹配归类）" },
        templateId: {
          type: "string",
          enum: ["short-term", "fundamental", "trend-swing", "custom"],
          description: "可选，预置概念词典模板：short-term（A股短线情绪）/ fundamental（价值基本面）/ trend-swing（趋势波段）/ custom（通用空白，默认）",
        },
        defaultSkillId: { type: "string", description: "可选，默认方法论提炼 Skill ID" },
        externalSourceDir: { type: "string", description: "可选，外挂本机已有复盘/Obsidian 文件夹绝对路径" },
        activate: { type: "boolean", description: "可选，创建后是否设为当前激活库（默认 true）" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_search_reviews",
    description: "按关键词、年份、标签或笔记类型检索 TradeLoom 复盘笔记与双链概念。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID 或准确名称（默认当前激活库）" },
        query: { type: "string", description: "可选，标题/标签/概念关键词" },
        year: { type: "string", description: "可选，四位年份，如 2025" },
        kind: { type: "string", description: "可选，笔记类型筛选" },
        limit: { type: "number", description: "返回条数上限（1-100，默认 30）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_read_review",
    description: "读取指定复盘文档（docId）或知识库卡片路径（cardRel）的完整原文与双向链接关系。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID 或准确名称" },
        docId: { type: "string", description: "文档 doc_id（与 cardRel 二选一）" },
        cardRel: { type: "string", description: "知识库相对卡片路径，如 20-卡片/2025-03-01_复盘.md" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_import_local_files",
    description:
      "直接将本机文件或文件夹导入 TradeLoom 知识库（原生解析 .md/.txt/.pdf/.docx/.html，单批最多 200 份，自动重建 Obsidian 双链与星图，无需 Agent 搬运正文）。若本机存在多个复盘库且未传入 vaultId，服务端将拒绝盲写并返回所有可选库列表，须先向用户确认目标库后再传入 vaultId 执行。",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "必填，本机文件或文件夹的绝对路径数组（支持混合传入文件与目录）",
        },
        vaultId: {
          type: "string",
          description: "目标知识库 ID 或准确名称。存在多个复盘库时必填（请先调用 tradeloom_list_vaults 并向用户确认）。",
        },
        recursive: { type: "boolean", description: "传入文件夹时是否递归扫描子目录（默认 true，最多 5 层）" },
        dryRun: {
          type: "boolean",
          description: "可选，设为 true 仅预览扫描到的文件与可选知识库清单，不执行写入（默认 false）",
        },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_import_review",
    description:
      "将对话中生成的或纯文本交易复盘写入 TradeLoom 知识库，并自动重建 Obsidian 双链与星图索引（若来源为本机文件，请优先使用 tradeloom_import_local_files）。存在多个复盘库且未传入 vaultId 时服务端将拒绝盲写并提示选库。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: {
          type: "string",
          description: "目标知识库 ID 或准确名称。存在多个复盘库时必填（请先确认后再写入）。",
        },
        title: { type: "string", description: "复盘标题" },
        content: { type: "string", description: "复盘正文（支持 Markdown）" },
        eventDate: { type: "string", description: "可选，复盘日期 YYYY-MM-DD" },
        tags: { type: "array", items: { type: "string" }, description: "可选，标签数组" },
        sourcePlatform: { type: "string", description: "可选，来源标注，默认 External Agent (MCP)" },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_import_url",
    description:
      "抓取公开网页或云端分享链接（支持雪球、微信公众号、新浪博客、语雀/飞书/Notion 公开分享、GitHub Raw 等，最多 20 条）并入库重建双链。存在多个复盘库且未传入 vaultId 时将拒绝盲写并提示选库。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "单个公开网页链接（与 urls 二选一）" },
        urls: {
          type: "array",
          items: { type: "string" },
          description: "多个公开网页链接数组（单批最多 20 条，与 url 二选一）",
        },
        vaultId: {
          type: "string",
          description: "目标知识库 ID 或准确名称。存在多个复盘库时必填。",
        },
        title: { type: "string", description: "可选，仅导入单条链接时的自定义标题" },
        eventDate: { type: "string", description: "可选，自定义复盘日期 YYYY-MM-DD" },
        tags: { type: "array", items: { type: "string" }, description: "可选，标签数组" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_import_ledger",
    description:
      "将券商交割单或每日净值表（CSV/TSV 本机文件路径或文本）导入指定复盘库的实盘账本，自动适配 UTF-8/GB18030/UTF-16LE 并双重脱敏资金账号与股东代码。存在多个复盘库且未传入 vaultId 时将拒绝盲写并提示选库。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: {
          type: "string",
          description: "目标知识库 ID 或准确名称。存在多个复盘库时必填。",
        },
        filePath: { type: "string", description: "本机 CSV/TSV 文件绝对路径（与 csvText 二选一）" },
        csvText: { type: "string", description: "CSV/TSV 原始文本内容（与 filePath 二选一）" },
        kind: {
          type: "string",
          enum: ["trades", "daily"],
          description: "可选，指定 trades（券商交割单）或 daily（每日净值表）；留空则自动识别",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_get_ledger_summary",
    description:
      "读取指定时间区间的脱敏实盘量化绩效锚点（收益%、超额 Alpha%、最大回撤 MDD%、胜率、盈亏比、个股已实现盈亏%，不含绝对金额与账号）。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID 或准确名称" },
        fromDate: { type: "string", description: "可选，起始日期 YYYY-MM-DD" },
        toDate: { type: "string", description: "可选，截止日期 YYYY-MM-DD" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_list_skills",
    description: "列出 TradeLoom 内置与用户自定义的方法论提炼 Skill 模板。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_prepare_synthesis",
    description:
      "按日期区间、文档 ID 或已有阶段手册 ID 装箱复盘原文切片与同期实盘锚点，返回带确定性 evidence_id 的完整提炼材料与 JSON 输出契约。外部 Agent 可直接用自身大模型推理，再调用 tradeloom_save_manual 防幻觉校验落库。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID 或准确名称" },
        docIds: { type: "array", items: { type: "string" }, description: "可选，指定复盘 doc_id 列表" },
        manualIds: { type: "array", items: { type: "string" }, description: "可选，二次综合已有阶段手册 ID 列表" },
        fromDate: { type: "string", description: "可选，按起始日期自动筛选文档（YYYY-MM-DD）" },
        toDate: { type: "string", description: "可选，按截止日期自动筛选文档（YYYY-MM-DD）" },
        skillId: { type: "string", description: "可选，分析 Skill ID（默认 short-term）" },
        stageTitle: { type: "string", description: "可选，阶段手册标题" },
        includeQuantAudit: { type: "boolean", description: "是否注入同期脱敏实盘量化锚点（默认 true）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_save_manual",
    description:
      "接收外部 Agent 根据 tradeloom_prepare_synthesis 产出的 JSON 提炼结果，执行逐字 evidence_id 防幻觉核验，生成正式个人交易手册（.json + Obsidian .md）并重建双链星图。存在多个复盘库时必须携带与 prepare_synthesis 一致的 vaultId。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: {
          type: "string",
          description: "目标知识库 ID 或准确名称。存在多个复盘库时必填（须与 prepare_synthesis 一致）。",
        },
        docIds: { type: "array", items: { type: "string" }, description: "与 prepare_synthesis 一致的文档 ID 列表" },
        manualIds: { type: "array", items: { type: "string" }, description: "与 prepare_synthesis 一致的阶段手册 ID 列表" },
        fromDate: { type: "string", description: "若未传 docIds，按日期区间匹配文档" },
        toDate: { type: "string", description: "若未传 docIds，按日期区间匹配文档" },
        skillId: { type: "string", description: "分析 Skill ID（默认 short-term）" },
        stageTitle: { type: "string", description: "可选，阶段手册标题" },
        includeQuantAudit: { type: "boolean", description: "是否注入实盘量化锚点（默认 true）" },
        rawResponse: { type: "string", description: "Agent 生成的完整 JSON 字符串（允许包裹 markdown 代码块）" },
        modelLabel: { type: "string", description: "可选，署名标注（如 mcp:claude-desktop / mcp:cursor）" },
      },
      required: ["rawResponse"],
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_list_manuals",
    description: "列出当前知识库已沉淀的个人交易手册摘要与规则条数。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID 或准确名称" },
      },
      additionalProperties: false,
    },
  },
] as const;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type VaultOptionItem = {
  id: string;
  name: string;
  description: string;
  templateId: VaultTemplateId;
  defaultSkillId: string;
  isActive: boolean;
  isDefault: boolean;
  isDemo: boolean;
  topTopics: string[];
  stats: VaultSummary["stats"];
};

function okTool(payload: unknown): McpToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errTool(payload: string | Record<string, unknown>): McpToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    isError: true,
  };
}

function isDemoVault(v: VaultSummary): boolean {
  return Boolean(v.isDemo || v.id === DEMO_VAULT_ID);
}

async function readVaultTopTopics(vaultId: string, limit = 8): Promise<string[]> {
  const paths = getWorkspacePaths(vaultId);
  const indexFile = path.join(paths.vault, "index.json");
  if (!(await fileExists(indexFile))) return [];
  try {
    const raw = JSON.parse(await readFile(indexFile, "utf8")) as Partial<VaultIndex>;
    if (!Array.isArray(raw.topics)) return [];
    return raw.topics
      .filter((t): t is string => typeof t === "string" && Boolean(t.trim()))
      .map((t) => t.trim())
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function buildVaultOptionsList(): Promise<{
  activeVaultId: string;
  vaults: VaultOptionItem[];
  personalVaults: VaultOptionItem[];
}> {
  const overview = await getVaultsOverview();
  const vaults: VaultOptionItem[] = await Promise.all(
    overview.vaults.map(async (v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      templateId: v.templateId,
      defaultSkillId: v.defaultSkillId,
      isActive: v.id === overview.activeVaultId,
      isDefault: Boolean(v.isDefault),
      isDemo: isDemoVault(v),
      topTopics: await readVaultTopTopics(v.id),
      stats: v.stats,
    })),
  );
  const personalVaults = vaults.filter((v) => !v.isDemo);
  return { activeVaultId: overview.activeVaultId, vaults, personalVaults };
}

function matchVaultByIdOrName(
  rawInput: string,
  vaults: VaultOptionItem[],
): { ok: true; vault: VaultOptionItem } | { ok: false; reason: "not_found" | "ambiguous_name"; candidates?: VaultOptionItem[] } {
  const key = rawInput.trim();
  const byId = vaults.find((v) => v.id === key);
  if (byId) return { ok: true, vault: byId };

  const lower = key.toLowerCase();
  const byName = vaults.filter((v) => v.name.trim().toLowerCase() === lower);
  if (byName.length === 1) return { ok: true, vault: byName[0] };
  if (byName.length > 1) return { ok: false, reason: "ambiguous_name", candidates: byName };

  return { ok: false, reason: "not_found" };
}

type VaultResolution =
  | { ok: true; vault: VaultOptionItem; totalPersonalVaults: number }
  | { ok: false; response: McpToolResult };

/**
 * Resolves target vault for READ operations:
 * - If `vaultId` is given: validates against real vaults (by id or exact name); errors clearly if unknown.
 * - If omitted: uses activeVaultId cleanly.
 */
async function resolveTargetVaultForRead(rawVaultId: unknown): Promise<VaultResolution> {
  const { activeVaultId, vaults, personalVaults } = await buildVaultOptionsList();
  const raw = typeof rawVaultId === "string" ? rawVaultId.trim() : "";

  if (!raw) {
    const active = vaults.find((v) => v.id === activeVaultId) ?? vaults[0];
    return { ok: true, vault: active, totalPersonalVaults: personalVaults.length };
  }

  const matched = matchVaultByIdOrName(raw, vaults);
  if (matched.ok) {
    return { ok: true, vault: matched.vault, totalPersonalVaults: personalVaults.length };
  }

  return {
    ok: false,
    response: errTool({
      ok: false,
      code: matched.reason === "ambiguous_name" ? "AMBIGUOUS_VAULT_NAME" : "VAULT_NOT_FOUND",
      message:
        matched.reason === "ambiguous_name"
          ? `存在多个同名知识库「${raw}」，请使用唯一的 vaultId。`
          : `未找到目标知识库「${raw}」，请从下方可选知识库中选择正确的 vaultId。`,
      activeVaultId,
      availableVaults: vaults,
    }),
  };
}

/**
 * Resolves target vault for WRITE operations with strict multi-vault anti-blind-write guardrail:
 * - If `vaultId` is given: matches by exact id or unique name; errors clearly if not found.
 * - If omitted AND >= 2 personal vaults exist: REFUSES blind write and returns structured
 *   `requiresVaultSelection: true` payload with all vaults (names, descriptions, topTopics, stats),
 *   forcing the Agent to recommend & confirm the destination vault with the user before retrying.
 * - If omitted AND only 1 personal vault exists: targets that sole personal vault seamlessly.
 */
async function resolveTargetVaultForWrite(
  rawVaultId: unknown,
  actionLabel: string,
): Promise<VaultResolution> {
  const { activeVaultId, vaults, personalVaults } = await buildVaultOptionsList();
  const raw = typeof rawVaultId === "string" ? rawVaultId.trim() : "";

  if (raw) {
    const matched = matchVaultByIdOrName(raw, vaults);
    if (matched.ok) {
      return { ok: true, vault: matched.vault, totalPersonalVaults: personalVaults.length };
    }
    return {
      ok: false,
      response: errTool({
        ok: false,
        code: matched.reason === "ambiguous_name" ? "AMBIGUOUS_VAULT_NAME" : "VAULT_NOT_FOUND",
        message:
          matched.reason === "ambiguous_name"
            ? `存在多个同名知识库「${raw}」，请改传唯一的 vaultId。`
            : `未找到目标知识库「${raw}」，请从下方可选知识库列表中确认正确的 vaultId（或调用 tradeloom_create_vault 新建库）。`,
        activeVaultId,
        availableVaults: personalVaults.length > 0 ? personalVaults : vaults,
      }),
    };
  }

  if (personalVaults.length >= 2) {
    return {
      ok: false,
      response: errTool({
        ok: false,
        requiresVaultSelection: true,
        code: "MULTIPLE_VAULTS_REQUIRE_SELECTION",
        message: `检测到本机存在 ${personalVaults.length} 个 TradeLoom 复盘知识库，且本次「${actionLabel}」未指定目标 vaultId。为防止误入错误的复盘库，服务端已暂停写入。请先结合待导入内容与下方各库的名称、简介和主题标签向用户推荐最匹配的库，待用户确认目标库（或要求新建库时先调用 tradeloom_create_vault）后，再携带明确的 vaultId 重新调用。`,
        activeVaultId,
        vaults: personalVaults,
      }),
    };
  }

  const fallback = personalVaults[0] ?? vaults.find((v) => v.id === activeVaultId) ?? vaults[0];
  return { ok: true, vault: fallback, totalPersonalVaults: personalVaults.length };
}

function normalizePathForCompare(p: string): string {
  return path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isInsideTradeLoomWorkspace(targetPath: string): boolean {
  const rootNorm = normalizePathForCompare(getGlobalWorkspaceRoot());
  const targetNorm = normalizePathForCompare(targetPath);
  return targetNorm === rootNorm || targetNorm.startsWith(`${rootNorm}/`);
}

function isFilesystemRoot(resolvedPath: string): boolean {
  return path.dirname(resolvedPath) === resolvedPath;
}

type ScannedLocalFile = {
  fullPath: string;
  fileName: string;
  carrier: string;
  bytes: number;
};

type LocalScanResult = {
  files: ScannedLocalFile[];
  skipped: Array<{ path: string; reason: string }>;
  truncated: boolean;
};

async function scanLocalPathsForImport(rawPaths: string[], recursive: boolean): Promise<LocalScanResult> {
  const files: ScannedLocalFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const seen = new Set<string>();
  let truncated = false;

  async function considerFile(fullPath: string, size: number) {
    const key = normalizePathForCompare(fullPath);
    if (seen.has(key)) return;
    seen.add(key);

    const fileName = path.basename(fullPath);
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "csv" || ext === "tsv") {
      skipped.push({
        path: fullPath,
        reason: "检测到 CSV/TSV 表格文件：如为券商交割单或每日净值，请改用 tradeloom_import_ledger 导入实盘账本。",
      });
      return;
    }

    const carrier = carrierOf(fileName);
    if (!carrier) {
      skipped.push({
        path: fullPath,
        reason: `不支持的文件格式（.${ext || "未知"}），复盘入库仅支持 .md / .txt / .pdf / .docx / .html`,
      });
      return;
    }
    if (size === 0) {
      skipped.push({ path: fullPath, reason: "文件为空（0 字节）" });
      return;
    }
    if (size > MAX_INPUT_BYTES) {
      skipped.push({
        path: fullPath,
        reason: `文件大小 ${(size / 1024 / 1024).toFixed(2)} MB 超过单文件 ${MAX_INPUT_BYTES / 1024 / 1024} MB 上限`,
      });
      return;
    }
    if (files.length >= MAX_LOCAL_IMPORT_FILES) {
      truncated = true;
      return;
    }
    files.push({ fullPath, fileName, carrier, bytes: size });
  }

  async function walkDir(dirPath: string, depth: number) {
    if (depth > MAX_LOCAL_SCAN_DEPTH || truncated) return;
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      skipped.push({
        path: dirPath,
        reason: `无法读取目录：${err instanceof Error ? err.message : "权限不足"}`,
      });
      return;
    }
    for (const entry of entries) {
      if (truncated) break;
      if (entry.name.startsWith(".") || IGNORED_SCAN_DIRS.has(entry.name)) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (recursive && depth < MAX_LOCAL_SCAN_DEPTH) {
          await walkDir(full, depth + 1);
        }
      } else if (entry.isFile()) {
        try {
          const info = await stat(full);
          const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
          // Inside directories, silently skip irrelevant binary/media files unless explicitly supported or CSV
          if (!carrierOf(entry.name) && ext !== "csv" && ext !== "tsv") continue;
          await considerFile(full, info.size);
        } catch {
          skipped.push({ path: full, reason: "无法读取文件属性" });
        }
      }
    }
  }

  for (const raw of rawPaths) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed || trimmed.includes("\0")) {
      skipped.push({ path: String(raw), reason: "路径为空或包含非法字符" });
      continue;
    }
    const resolved = path.resolve(trimmed);
    if (isInsideTradeLoomWorkspace(resolved)) {
      skipped.push({
        path: resolved,
        reason: "安全限制：不能直接从 TradeLoom 内部 workspace 目录反向导入，避免重复嵌套入库",
      });
      continue;
    }
    let info;
    try {
      info = await stat(resolved);
    } catch {
      skipped.push({ path: resolved, reason: "本机找不到该文件或文件夹（请确认绝对路径正确）" });
      continue;
    }

    if (info.isDirectory()) {
      if (isFilesystemRoot(resolved)) {
        skipped.push({ path: resolved, reason: "安全限制：不允许直接扫描整个磁盘根目录，请指定具体复盘子目录" });
        continue;
      }
      await walkDir(resolved, 0);
    } else if (info.isFile()) {
      await considerFile(resolved, info.size);
    } else {
      skipped.push({ path: resolved, reason: "仅支持常规文件或目录" });
    }
  }

  return { files, skipped, truncated };
}

async function selectDocsForSynthesis(args: Record<string, unknown>) {
  const { index } = await loadOrBuildVault();
  const docIds = Array.isArray(args.docIds)
    ? args.docIds.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    : [];
  const manualIds = Array.isArray(args.manualIds)
    ? args.manualIds.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    : [];
  const fromDate = typeof args.fromDate === "string" ? args.fromDate.trim() : "";
  const toDate = typeof args.toDate === "string" ? args.toDate.trim() : "";

  if (docIds.length > 0) {
    const byId = new Map(index.documents.map((d) => [d.doc_id, d]));
    return {
      docs: docIds.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => Boolean(d)),
      manualIds,
    };
  }
  if (manualIds.length > 0 && !fromDate && !toDate) {
    return { docs: [], manualIds };
  }

  const filtered = index.documents.filter((d) => {
    if (fromDate && (!d.event_date || d.event_date < fromDate)) return false;
    if (toDate && (!d.event_date || d.event_date > toDate)) return false;
    return true;
  });
  return { docs: filtered, manualIds };
}

async function executeMcpTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  switch (name) {
    case "tradeloom_list_vaults": {
      const { activeVaultId, vaults, personalVaults } = await buildVaultOptionsList();
      return okTool({
        activeVaultId,
        vaultCount: vaults.length,
        personalVaultCount: personalVaults.length,
        requiresExplicitVaultIdOnWrite: personalVaults.length >= 2,
        vaults,
      });
    }

    case "tradeloom_create_vault": {
      const vaultName = typeof args.name === "string" ? args.name.trim() : "";
      if (!vaultName) return errTool("请提供新知识库名称 name");
      const tplRaw = typeof args.templateId === "string" ? args.templateId.trim() : "";
      const templateId: VaultTemplateId =
        tplRaw === "short-term" || tplRaw === "fundamental" || tplRaw === "trend-swing" || tplRaw === "custom"
          ? tplRaw
          : "custom";
      const created = await createVault({
        name: vaultName,
        description: typeof args.description === "string" ? args.description : undefined,
        templateId,
        defaultSkillId: typeof args.defaultSkillId === "string" ? args.defaultSkillId : undefined,
        externalSourceDir: typeof args.externalSourceDir === "string" ? args.externalSourceDir : undefined,
        activate: typeof args.activate === "boolean" ? args.activate : true,
      });
      if (!created.ok) return errTool(created.error);
      return okTool({
        ok: true,
        activeVaultId: created.overview.activeVaultId,
        vault: {
          id: created.vault.id,
          name: created.vault.name,
          description: created.vault.description,
          templateId: created.vault.templateId,
          defaultSkillId: created.vault.defaultSkillId,
          isExternal: created.vault.paths.isExternal,
          stats: created.vault.stats,
        },
      });
    }

    case "tradeloom_search_reviews": {
      const resolved = await resolveTargetVaultForRead(args.vaultId);
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      return runWithVault(vaultId, async () => {
        const { index } = await loadOrBuildVault();
        const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
        const year = typeof args.year === "string" ? args.year.trim() : "";
        const kind = typeof args.kind === "string" ? args.kind.trim() : "";
        const limit = Math.min(100, Math.max(1, typeof args.limit === "number" ? Math.floor(args.limit) : 30));

        const matched = index.documents
          .filter((d) => {
            if (year && !(d.event_date ?? "").startsWith(year)) return false;
            if (kind && d.kind !== kind) return false;
            if (q) {
              const hay = [d.title, d.kind, ...(d.tags ?? []), ...(d.auto_concepts ?? [])].join(" ").toLowerCase();
              if (!hay.includes(q)) return false;
            }
            return true;
          })
          .sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? ""))
          .slice(0, limit);

        return okTool({
          vaultId,
          vaultName: resolved.vault.name,
          totalPersonalVaults: resolved.totalPersonalVaults,
          totalInVault: index.counts.total,
          matchedCount: matched.length,
          topics: index.topics.slice(0, 20),
          documents: matched.map((d) => ({
            doc_id: d.doc_id,
            title: d.title,
            event_date: d.event_date,
            kind: d.kind,
            card: d.card,
            tags: d.tags,
            auto_concepts: d.auto_concepts,
          })),
        });
      });
    }

    case "tradeloom_read_review": {
      const resolved = await resolveTargetVaultForRead(args.vaultId);
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      return runWithVault(vaultId, async () => {
        const { index } = await loadOrBuildVault();
        const docId = typeof args.docId === "string" ? args.docId.trim() : "";
        const cardRelInput = typeof args.cardRel === "string" ? args.cardRel.trim() : "";
        const doc = docId
          ? index.documents.find((d) => d.doc_id === docId)
          : cardRelInput
            ? index.documents.find((d) => d.card === cardRelInput)
            : undefined;
        const rel = doc?.card || cardRelInput;
        if (!rel) return errTool("请提供有效的 docId 或 cardRel");

        const card = await readVaultCard(rel);
        const orig = doc?.source_rel ? await readOriginalSource(doc.source_rel) : null;
        if (!card && !orig) return errTool(`未找到文档或卡片：${rel}`);

        return okTool({
          vaultId,
          vaultName: resolved.vault.name,
          doc_id: doc?.doc_id ?? null,
          title: doc?.title ?? rel,
          event_date: doc?.event_date ?? null,
          card: rel,
          links: index.links[rel] ?? { in: [], out: [] },
          content: orig?.text ?? card?.text ?? "",
        });
      });
    }

    case "tradeloom_import_local_files": {
      const rawPaths = Array.isArray(args.paths)
        ? args.paths.filter((p): p is string => typeof p === "string" && Boolean(p.trim()))
        : typeof args.paths === "string" && args.paths.trim()
          ? [args.paths.trim()]
          : [];
      if (rawPaths.length === 0) {
        return errTool("请提供至少一个本机文件或文件夹路径 paths");
      }
      const recursive = args.recursive !== false;
      const dryRun = args.dryRun === true;

      if (dryRun) {
        const [scan, vaultState] = await Promise.all([
          scanLocalPathsForImport(rawPaths, recursive),
          buildVaultOptionsList(),
        ]);
        const rawVaultId = typeof args.vaultId === "string" ? args.vaultId.trim() : "";
        const matched = rawVaultId ? matchVaultByIdOrName(rawVaultId, vaultState.vaults) : null;
        return okTool({
          ok: true,
          dryRun: true,
          matchedFilesCount: scan.files.length,
          skippedCount: scan.skipped.length,
          truncated: scan.truncated,
          files: scan.files,
          skipped: scan.skipped,
          requiresVaultSelection: !rawVaultId && vaultState.personalVaults.length >= 2,
          selectedVault: matched?.ok ? matched.vault : null,
          availableVaults: vaultState.personalVaults.length > 0 ? vaultState.personalVaults : vaultState.vaults,
        });
      }

      const resolved = await resolveTargetVaultForWrite(args.vaultId, "导入本机文件");
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      const scan = await scanLocalPathsForImport(rawPaths, recursive);
      if (scan.files.length === 0) {
        return errTool({
          ok: false,
          code: "NO_IMPORTABLE_FILES",
          message: "未扫描到可导入的复盘文件（支持 .md / .txt / .pdf / .docx / .html）。",
          skipped: scan.skipped,
        });
      }

      return runWithVault(vaultId, async () => {
        const imported: Array<{
          path: string;
          fileName: string;
          sourceRel: string;
          carrier: string;
          warnings: string[];
        }> = [];
        const failed: Array<{ path: string; fileName: string; error: string }> = [];

        for (const f of scan.files) {
          try {
            const buf = await readFile(f.fullPath);
            const outcome = await importUploadedFile(f.fileName, buf, { skipRebuild: true });
            if (outcome.ok) {
              imported.push({
                path: f.fullPath,
                fileName: f.fileName,
                sourceRel: outcome.sourceRel,
                carrier: outcome.carrier,
                warnings: outcome.warnings,
              });
            } else {
              failed.push({ path: f.fullPath, fileName: f.fileName, error: outcome.error });
            }
          } catch (err) {
            failed.push({
              path: f.fullPath,
              fileName: f.fileName,
              error: err instanceof Error ? err.message : "读取或写入文件失败",
            });
          }
        }

        if (imported.length === 0) {
          return errTool({
            ok: false,
            vaultId,
            vaultName: resolved.vault.name,
            message: "所有待导入文件均处理失败",
            failed,
            skipped: scan.skipped,
          });
        }

        const index = await rebuildVault();
        return okTool({
          ok: true,
          vaultId,
          vaultName: resolved.vault.name,
          importedCount: imported.length,
          failedCount: failed.length,
          skippedCount: scan.skipped.length,
          truncated: scan.truncated,
          imported,
          failed,
          skipped: scan.skipped,
          totalDocs: index.counts.total,
          totalLinks: index.counts.links,
        });
      });
    }

    case "tradeloom_import_review": {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content.trim()) return errTool("content 不能为空");

      const resolved = await resolveTargetVaultForWrite(args.vaultId, "写入复盘正文");
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      return runWithVault(vaultId, async () => {
        const outcome = await importPastedReview({
          title: typeof args.title === "string" ? args.title : undefined,
          content,
          eventDate: typeof args.eventDate === "string" ? args.eventDate : undefined,
          sourcePlatform: typeof args.sourcePlatform === "string" ? args.sourcePlatform : "External Agent (MCP)",
          tags: Array.isArray(args.tags) ? args.tags.filter((x): x is string => typeof x === "string") : [],
        });
        if (!outcome.ok) return errTool(outcome.error);
        return okTool({
          ok: true,
          vaultId,
          vaultName: resolved.vault.name,
          sourceRel: outcome.sourceRel,
          cardRel: outcome.cardRel,
          totalDocs: outcome.index.counts.total,
          totalLinks: outcome.index.counts.links,
        });
      });
    }

    case "tradeloom_import_url": {
      const rawInputs: string[] = [];
      if (typeof args.url === "string" && args.url.trim()) rawInputs.push(args.url.trim());
      if (Array.isArray(args.urls)) {
        for (const u of args.urls) {
          if (typeof u === "string" && u.trim()) rawInputs.push(u.trim());
        }
      }
      const urls = parseBatchUrls(rawInputs).slice(0, MAX_MCP_BATCH_URLS);
      if (urls.length === 0) {
        return errTool("请提供至少一个有效的 http:// 或 https:// 网页链接（url 或 urls）");
      }

      const resolved = await resolveTargetVaultForWrite(args.vaultId, "抓取网页链接入库");
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      const tags = Array.isArray(args.tags) ? args.tags.filter((x): x is string => typeof x === "string") : undefined;
      const customTitle = urls.length === 1 && typeof args.title === "string" ? args.title : undefined;
      const customDate = typeof args.eventDate === "string" ? args.eventDate : undefined;

      return runWithVault(vaultId, async () => {
        const imported: Array<{ url: string; title: string; eventDate: string; sourceRel: string; warnings: string[] }> = [];
        const failed: Array<{ url: string; error: string; requiresLogin?: boolean }> = [];

        for (const url of urls) {
          const outcome = await importFromUrl(
            { url, title: customTitle, eventDate: customDate, tags },
            { skipRebuild: true },
          );
          if (outcome.ok) {
            imported.push({
              url,
              title: outcome.title,
              eventDate: outcome.eventDate,
              sourceRel: outcome.sourceRel,
              warnings: outcome.warnings,
            });
          } else {
            failed.push({ url, error: outcome.error, requiresLogin: outcome.requiresLogin });
          }
        }

        if (imported.length === 0) {
          return errTool({
            ok: false,
            vaultId,
            vaultName: resolved.vault.name,
            message: "所有网页链接均未能成功抓取",
            failed,
          });
        }

        const index = await rebuildVault();
        return okTool({
          ok: true,
          vaultId,
          vaultName: resolved.vault.name,
          importedCount: imported.length,
          failedCount: failed.length,
          imported,
          failed,
          totalDocs: index.counts.total,
          totalLinks: index.counts.links,
        });
      });
    }

    case "tradeloom_import_ledger": {
      const filePathRaw = typeof args.filePath === "string" ? args.filePath.trim() : "";
      const csvTextRaw = typeof args.csvText === "string" ? args.csvText : "";
      if (!filePathRaw && !csvTextRaw.trim()) {
        return errTool("请提供本机 CSV/TSV 文件路径 filePath，或直接传入文本内容 csvText");
      }

      const resolved = await resolveTargetVaultForWrite(args.vaultId, "导入实盘交割单/净值账本");
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      let buf: Buffer;
      if (filePathRaw) {
        if (filePathRaw.includes("\0")) return errTool("文件路径包含非法字符");
        const resolvedFile = path.resolve(filePathRaw);
        try {
          const info = await stat(resolvedFile);
          if (!info.isFile()) return errTool(`指定路径不是文件：${resolvedFile}`);
          if (info.size === 0) return errTool("指定 CSV/TSV 文件为空");
          if (info.size > MAX_INPUT_BYTES) return errTool(`文件超过 ${MAX_INPUT_BYTES / 1024 / 1024} MB 上限`);
          buf = await readFile(resolvedFile);
        } catch {
          return errTool(`找不到或无法读取本机文件：${resolvedFile}`);
        }
      } else {
        buf = Buffer.from(csvTextRaw, "utf8");
      }

      const kind = args.kind === "trades" || args.kind === "daily" ? args.kind : undefined;

      return runWithVault(vaultId, async () => {
        const outcome = await importLedgerCsv({ buf, kind });
        if (!outcome.ok) return errTool(outcome.error);
        return okTool({
          ok: true,
          vaultId,
          vaultName: resolved.vault.name,
          kind: outcome.kind,
          imported: outcome.imported,
          skipped: outcome.skipped,
          redactedColumns: outcome.redactedColumns,
          totalTradesInVault: outcome.store.trades.length,
          totalDailyRecordsInVault: outcome.store.dailyRecords.length,
        });
      });
    }

    case "tradeloom_get_ledger_summary": {
      const resolved = await resolveTargetVaultForRead(args.vaultId);
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      return runWithVault(vaultId, async () => {
        const fromDate = typeof args.fromDate === "string" ? args.fromDate.trim() || undefined : undefined;
        const toDate = typeof args.toDate === "string" ? args.toDate.trim() || undefined : undefined;
        const brief = await buildPeriodQuantBrief(fromDate, toDate);
        if (!brief) {
          return okTool({
            vaultId,
            vaultName: resolved.vault.name,
            hasData: false,
            message: "该知识库在指定时间区间内暂无实盘净值或交割记录。",
          });
        }
        return okTool({ vaultId, vaultName: resolved.vault.name, hasData: true, quantBrief: brief });
      });
    }

    case "tradeloom_list_skills": {
      const skills = await loadSkills();
      return okTool({
        skills: skills.map((s) => ({
          id: s.id,
          name: s.name,
          summary: s.summary,
          tags: s.tags,
          builtin: s.builtin,
        })),
      });
    }

    case "tradeloom_prepare_synthesis": {
      const resolved = await resolveTargetVaultForRead(args.vaultId);
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      return runWithVault(vaultId, async () => {
        const { docs, manualIds } = await selectDocsForSynthesis(args);
        if (docs.length === 0 && manualIds.length === 0) {
          return errTool("未匹配到任何可提炼的复盘笔记或阶段手册，请先导入复盘或检查筛选条件。");
        }
        const packed = await exportSynthesisPromptPack({
          docs,
          manualIds,
          skillId: typeof args.skillId === "string" && args.skillId.trim() ? args.skillId.trim() : "short-term",
          stageTitle: typeof args.stageTitle === "string" ? args.stageTitle : undefined,
          includeQuantAudit: args.includeQuantAudit !== false,
        });
        if (!packed.ok) return errTool(packed.error);
        return okTool({
          vaultId,
          vaultName: resolved.vault.name,
          docIds: packed.snapshot.included_ids,
          skillId: packed.skillId,
          skillName: packed.skillName,
          dateRange: packed.snapshot.date_range,
          evidenceCount: packed.evidenceCount,
          charCount: packed.charCount,
          quantBrief: packed.quantBrief,
          instructions:
            "请依据 promptText 中的规则与证据目录生成严格合法的 JSON，随后调用 tradeloom_save_manual（带上相同的 vaultId / docIds / skillId 与 rawResponse）完成防幻觉溯源校验并落库。",
          promptText: packed.promptText,
        });
      });
    }

    case "tradeloom_save_manual": {
      const rawResponse = typeof args.rawResponse === "string" ? args.rawResponse : "";
      if (!rawResponse.trim()) return errTool("rawResponse 不能为空");

      const resolved = await resolveTargetVaultForWrite(args.vaultId, "保存正式交易手册");
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      return runWithVault(vaultId, async () => {
        const { docs, manualIds } = await selectDocsForSynthesis(args);
        if (docs.length === 0 && manualIds.length === 0) {
          return errTool("未找到用于核验 evidence_id 的源复盘文档或阶段手册，请传入与 prepare_synthesis 一致的 docIds / manualIds。");
        }
        const saved = await importExternalSynthesisResult({
          docs,
          manualIds,
          skillId: typeof args.skillId === "string" && args.skillId.trim() ? args.skillId.trim() : "short-term",
          stageTitle: typeof args.stageTitle === "string" ? args.stageTitle : undefined,
          includeQuantAudit: args.includeQuantAudit !== false,
          rawResponse,
          modelLabel: typeof args.modelLabel === "string" && args.modelLabel.trim() ? args.modelLabel.trim() : "mcp:external-agent",
        });
        if (!saved.ok) {
          return errTool(`手册校验落库失败：${saved.error}`);
        }
        return okTool({
          ok: true,
          vaultId,
          vaultName: resolved.vault.name,
          manualId: saved.report.id,
          title: saved.report.title,
          statistics: saved.report.statistics,
          warnings: saved.report.warnings,
          markdownCard: `40-交易手册/${saved.report.id}.md`,
        });
      });
    }

    case "tradeloom_list_manuals": {
      const resolved = await resolveTargetVaultForRead(args.vaultId);
      if (!resolved.ok) return resolved.response;
      const vaultId = resolved.vault.id;

      return runWithVault(vaultId, async () => {
        const manuals = await listSavedManuals();
        return okTool({
          vaultId,
          vaultName: resolved.vault.name,
          count: manuals.length,
          manuals: manuals.map((m) => ({
            id: m.id,
            title: m.title,
            created_at: m.created_at,
            date_range: m.date_range,
            skill_name: m.skill_name,
            model: m.model,
            statistics: m.statistics,
            rules: m.manual.map((r) => ({ id: r.id, title: r.title, lifecycle: r.lifecycle })),
          })),
        });
      });
    }

    default:
      return errTool(`未知 MCP 工具：${name}`);
  }
}

export async function handleMcpJsonRpc(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const method = request.method ?? "";
  const params = (request.params && typeof request.params === "object" ? request.params : {}) as Record<string, unknown>;

  // Notifications without id return no response body
  if (method.startsWith("notifications/")) {
    return null;
  }

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
              resources: { listChanged: false },
              prompts: { listChanged: false },
            },
            serverInfo: MCP_SERVER_INFO,
            instructions: [
              "TradeLoom 本地交易复盘与个人方法论底座：支持多复盘库管理、本地文件/文件夹直传（.md/.txt/.pdf/.docx/.html）、网页链接抓取、券商交割单/净值账本脱敏入库、双链检索，以及外部 Agent 防幻觉手册凝练落盘。",
              "【多复盘库强约束】执行任何写入/导入操作前，请先调用 tradeloom_list_vaults。若本机存在多个复盘知识库且用户未明确指明目标库，必须先结合待导入文档内容与各库的名称、简介及高频主题（topTopics）向用户推荐最匹配的库并征求确认（若用户需要新建库，先调用 tradeloom_create_vault），切勿猜测或盲写。",
              "【文件入库优先规则】当用户指向本机文件或文件夹时，优先调用 tradeloom_import_local_files 直接传路径（支持 PDF/DOCX/MD/HTML/TXT 无损入库）；券商交割单/每日净值 CSV/TSV 使用 tradeloom_import_ledger；公开网页链接使用 tradeloom_import_url。",
            ].join("\n"),
          },
        };

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: TRADELOOM_MCP_TOOLS },
        };

      case "tools/call": {
        const toolName = typeof params.name === "string" ? params.name : "";
        const toolArgs =
          params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        if (!toolName) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "缺少工具名称 params.name" } };
        }
        const toolResult = await executeMcpTool(toolName, toolArgs);
        return { jsonrpc: "2.0", id, result: toolResult };
      }

      case "resources/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: "tradeloom://vault/overview",
                name: "当前复盘知识库总览",
                description: "当前激活知识库的文档统计、年份分布与高频双链概念主题。",
                mimeType: "application/json",
              },
              {
                uri: "tradeloom://manuals/list",
                name: "已沉淀交易手册清单",
                description: "当前知识库所有经过原文证据核验的交易方法论手册列表。",
                mimeType: "application/json",
              },
            ],
          },
        };

      case "resources/read": {
        const uri = typeof params.uri === "string" ? params.uri : "";
        if (uri === "tradeloom://vault/overview") {
          const { index } = await loadOrBuildVault();
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(
                    {
                      vaultId: getActiveVaultId(),
                      counts: index.counts,
                      years: index.years,
                      topics: index.topics.slice(0, 30),
                    },
                    null,
                    2,
                  ),
                },
              ],
            },
          };
        }
        if (uri === "tradeloom://manuals/list") {
          const manuals = await listSavedManuals();
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(manuals, null, 2),
                },
              ],
            },
          };
        }
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `未知资源 URI：${uri}` } };
      }

      case "prompts/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            prompts: [
              {
                name: "synthesize-trading-playbook",
                description: "基于 TradeLoom 复盘切片与实盘账本锚点，凝练经过逐字溯源校验的个人交易手册。",
                arguments: [
                  { name: "vaultId", description: "可选，目标知识库 ID", required: false },
                  { name: "fromDate", description: "可选，起始日期 YYYY-MM-DD", required: false },
                  { name: "toDate", description: "可选，截止日期 YYYY-MM-DD", required: false },
                  { name: "skillId", description: "可选，分析 Skill ID（默认 short-term）", required: false },
                ],
              },
            ],
          },
        };

      case "prompts/get": {
        const promptName = typeof params.name === "string" ? params.name : "";
        if (promptName !== "synthesize-trading-playbook") {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: `未知 Prompt：${promptName}` } };
        }
        const pArgs = (params.arguments && typeof params.arguments === "object"
          ? params.arguments
          : {}) as Record<string, unknown>;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            description: "执行 TradeLoom 防幻觉交易方法论提炼闭环",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: [
                    "请使用 TradeLoom MCP 工具为我凝练交易方法论手册：",
                    "0. 若未指定 vaultId，请先调用 tradeloom_list_vaults 确认目标复盘库（存在多个库时先询问我确认）。",
                    `1. 调用 tradeloom_prepare_synthesis（vaultId=${String(pArgs.vaultId ?? "") || "已确认库"}，fromDate=${String(pArgs.fromDate ?? "") || "不限"}，toDate=${String(pArgs.toDate ?? "") || "不限"}，skillId=${String(pArgs.skillId ?? "short-term")}）获取复盘证据切片与实盘锚点。`,
                    "2. 严格依据返回的 promptText 与 evidence_id 目录生成合法 JSON，绝不编造任何 evidence_id 或数据。",
                    "3. 调用 tradeloom_save_manual（带上相同 vaultId / docIds / skillId）将 JSON 校验落库为正式个人交易手册，并向我汇报生成的核心规则与知行偏离警示。",
                  ].join("\n"),
                },
              },
            ],
          },
        };
      }

      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `未支持的 MCP 方法：${method}` } };
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : "MCP 服务端内部错误",
      },
    };
  }
}

export function buildTradeLoomAgentSkillMarkdown(baseUrl = "http://127.0.0.1:3200"): string {
  return `---
name: tradeloom-trading-playbook
description: Connect your AI Agent to local TradeLoom to import local files/folders/URLs/broker ledgers with multi-vault confirmation, search trading reviews, audit real PnL vs review notes, and synthesize evidence-verified trading playbooks without extra API keys.
---

# TradeLoom Trading Review & Playbook Skill

When the user asks to upload/import local files, folders, web links, or broker statements into **TradeLoom**, analyze their trading reviews, cross-check trading discipline against their ledger, or synthesize a personal trading playbook, follow this workflow.

## Connection

- **Preferred (MCP)**: Connect to the \`tradeloom\` MCP server (stdio via \`node <repo>/scripts/tradeloom-mcp-server.mjs\` or Streamable HTTP at \`${baseUrl}/api/mcp\`).
- **Fallback (Local HTTP)**: TradeLoom runs locally at \`${baseUrl}\` (localhost only).

## Core Workflows

### 1. Smart Multi-Vault Import (Files, Folders, Reviews, URLs & Broker Ledgers)
1. **Always check vaults first**: Call \`tradeloom_list_vaults\` to inspect all vaults (\`id\`, \`name\`, \`description\`, \`topTopics\`, and \`stats\`).
2. **Multi-vault confirmation rule (CRITICAL)**:
   - If \`personalVaultCount >= 2\` and the user did NOT explicitly name the destination vault, **DO NOT guess or blindly write**. (The MCP server also enforces this guardrail and rejects writes without \`vaultId\`.)
   - Inspect the file name / brief topic (for local paths you may call \`tradeloom_import_local_files\` with \`dryRun: true\` first).
   - List the available vaults to the user, **recommend the best-matching vault with a brief reason**, and ask whether to import there, pick another vault, or create a new vault (\`tradeloom_create_vault\`).
3. **Choose the right import tool once the target \`vaultId\` is confirmed** (or immediately when only 1 vault exists):
   - **Local files or folders (\`.md\` / \`.txt\` / \`.pdf\` / \`.docx\` / \`.html\`)**: Prefer \`tradeloom_import_local_files\` with absolute \`paths\` — zero-token lossless ingestion with automatic PDF/DOCX/HTML conversion and graph rebuild.
   - **Chat-composed text / snippets**: Call \`tradeloom_import_review\` with \`vaultId\`, \`title\`, \`content\`, \`eventDate\` (\`YYYY-MM-DD\`), and \`tags\`.
   - **Public web/cloud links (Xueqiu, WeChat, Yuque, Feishu, Notion, blogs)**: Call \`tradeloom_import_url\` with \`vaultId\` and \`url\` / \`urls\`.
   - **Broker CSV/TSV trade statements or daily NAV tables**: Call \`tradeloom_import_ledger\` with \`vaultId\` and \`filePath\` (or \`csvText\`); TradeLoom automatically strips sensitive account/shareholder columns.

### 2. Search & Inspect Trading Memory
1. Call \`tradeloom_list_vaults\` to discover available vaults and active vault.
2. Call \`tradeloom_search_reviews\` with \`vaultId\`, \`query\`, \`year\`, or \`kind\` to locate relevant reviews and \`#concepts\`.
3. Call \`tradeloom_read_review\` to read the full original review and its Obsidian bi-directional links.
4. Call \`tradeloom_get_ledger_summary\` to compare what the user wrote with real percentage returns, MDD, Alpha, profit factor, and per-stock realized PnL% (no raw capital or account numbers are ever exposed).

### 3. Zero-API Evidence-Verified Playbook Synthesis (No Extra API Key Needed)
1. Confirm the target \`vaultId\` via \`tradeloom_list_vaults\`.
2. Call \`tradeloom_prepare_synthesis\` (with \`vaultId\`, \`fromDate\`/\`toDate\` or \`docIds\`, and \`skillId\`).
3. Read the returned \`promptText\` and deterministic \`evidence_id\` catalog carefully.
4. Produce **strict JSON** adhering to the output contract in \`promptText\`:
   - Every \`timeline\`, \`manual\`, and \`discipline_audit\` entry MUST cite exact \`evidence_id\` values from the catalog.
   - Never fabricate tickers, returns, or \`evidence_id\` strings.
5. Call \`tradeloom_save_manual\` with the same \`vaultId\`/\`docIds\`/\`skillId\` and your JSON in \`rawResponse\`.
6. TradeLoom verifies every citation verbatim, persists \`.json\` + Obsidian \`.md\` into \`40-交易手册/\`, and rebuilds the bi-directional knowledge graph.
`;
}

export function buildAgentIntegrationBundle(baseUrl = "http://127.0.0.1:3200") {
  const repoRoot = process.cwd();
  const mcpScriptPath = path.join(repoRoot, "scripts", "tradeloom-mcp-server.mjs");
  const skillFilePath = path.join(repoRoot, "docs", "tradeloom-agent-skill", "SKILL.md");
  const workspaceRoot = getWorkspacePaths().root;
  const mcpHttpUrl = `${baseUrl.replace(/\/+$/, "")}/api/mcp`;

  const stdioConfigJson = JSON.stringify(
    {
      mcpServers: {
        tradeloom: {
          command: "node",
          args: [mcpScriptPath],
          env: {
            TRADELOOM_URL: baseUrl,
          },
        },
      },
    },
    null,
    2,
  );

  const httpConfigJson = JSON.stringify(
    {
      mcpServers: {
        tradeloom: {
          url: mcpHttpUrl,
        },
      },
    },
    null,
    2,
  );

  const cliInstallCommands = [
    {
      id: "claude",
      label: "Claude Code",
      command: `claude mcp add tradeloom -- node "${mcpScriptPath}"`,
    },
    {
      id: "codex",
      label: "OpenAI Codex CLI",
      command: `codex mcp add tradeloom -- node "${mcpScriptPath}"`,
    },
    {
      id: "agy",
      label: "Antigravity CLI (agy)",
      command: `agy mcp add tradeloom -- node "${mcpScriptPath}"`,
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      command: `gemini mcp add tradeloom node "${mcpScriptPath}"`,
    },
  ];

  return {
    baseUrl,
    mcpHttpUrl,
    mcpScriptPath,
    skillFilePath,
    workspaceRoot,
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: MCP_SERVER_INFO,
    stdioConfigJson,
    httpConfigJson,
    cliInstallCommands,
    tools: TRADELOOM_MCP_TOOLS,
    skillMarkdown: buildTradeLoomAgentSkillMarkdown(baseUrl),
  };
}
