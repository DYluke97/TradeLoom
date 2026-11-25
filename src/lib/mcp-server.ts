import path from "node:path";
import { importPastedReview } from "./cloud-ingest";
import { buildPeriodQuantBrief } from "./ledger";
import { loadSkills } from "./skills";
import {
  exportSynthesisPromptPack,
  importExternalSynthesisResult,
  listSavedManuals,
} from "./synthesis";
import { loadOrBuildVault, readOriginalSource, readVaultCard } from "./vault";
import { getVaultsOverview } from "./vaults";
import { getActiveVaultId, getWorkspacePaths, isValidVaultId, runWithVault } from "./workspace";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_INFO = {
  name: "tradeloom-mcp",
  version: "1.2.0",
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const TRADELOOM_MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "tradeloom_list_vaults",
    description: "列出本机所有 TradeLoom 交易复盘知识库、当前激活库及各库文档/实盘/手册统计。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_search_reviews",
    description: "按关键词、年份、标签或笔记类型检索 TradeLoom 复盘笔记与双链概念。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID（默认当前激活库）" },
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
        vaultId: { type: "string", description: "可选，目标知识库 ID" },
        docId: { type: "string", description: "文档 doc_id（与 cardRel 二选一）" },
        cardRel: { type: "string", description: "知识库相对卡片路径，如 20-卡片/2025-03-01_复盘.md" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_import_review",
    description: "将交易复盘文本写入 TradeLoom 知识库，并自动重建 Obsidian 双链与星图索引。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID" },
        title: { type: "string", description: "复盘标题" },
        content: { type: "string", description: "复盘正文（支持 Markdown）" },
        eventDate: { type: "string", description: "可选，复盘日期 YYYY-MM-DD" },
        tags: { type: "array", items: { type: "string" }, description: "可选，标签数组" },
        sourcePlatform: { type: "string", description: "可选，来源标注，默认 External Agent" },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "tradeloom_get_ledger_summary",
    description: "读取指定时间区间的脱敏实盘量化绩效锚点（收益%、超额 Alpha%、最大回撤 MDD%、胜率、盈亏比、个股已实现盈亏%，不含绝对金额与账号）。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID" },
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
        vaultId: { type: "string", description: "可选，目标知识库 ID" },
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
      "接收外部 Agent 根据 tradeloom_prepare_synthesis 产出的 JSON 提炼结果，执行逐字 evidence_id 防幻觉核验，生成正式个人交易手册（.json + Obsidian .md）并重建双链星图。",
    inputSchema: {
      type: "object",
      properties: {
        vaultId: { type: "string", description: "可选，目标知识库 ID" },
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
        vaultId: { type: "string", description: "可选，目标知识库 ID" },
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

function okTool(payload: unknown): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errTool(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function resolveTargetVault(rawVaultId: unknown): string {
  if (typeof rawVaultId === "string" && isValidVaultId(rawVaultId)) {
    return rawVaultId.trim();
  }
  return getActiveVaultId();
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

async function executeMcpTool(name: string, args: Record<string, unknown>) {
  const vaultId = resolveTargetVault(args.vaultId);

  switch (name) {
    case "tradeloom_list_vaults": {
      const overview = await getVaultsOverview();
      return okTool({
        activeVaultId: overview.activeVaultId,
        vaults: overview.vaults.map((v) => ({
          id: v.id,
          name: v.name,
          description: v.description,
          defaultSkillId: v.defaultSkillId,
          stats: v.stats,
        })),
      });
    }

    case "tradeloom_search_reviews": {
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
          doc_id: doc?.doc_id ?? null,
          title: doc?.title ?? rel,
          event_date: doc?.event_date ?? null,
          card: rel,
          links: index.links[rel] ?? { in: [], out: [] },
          content: orig?.text ?? card?.text ?? "",
        });
      });
    }

    case "tradeloom_import_review": {
      return runWithVault(vaultId, async () => {
        const content = typeof args.content === "string" ? args.content : "";
        if (!content.trim()) return errTool("content 不能为空");
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
          sourceRel: outcome.sourceRel,
          cardRel: outcome.cardRel,
          totalDocs: outcome.index.counts.total,
          totalLinks: outcome.index.counts.links,
        });
      });
    }

    case "tradeloom_get_ledger_summary": {
      return runWithVault(vaultId, async () => {
        const fromDate = typeof args.fromDate === "string" ? args.fromDate.trim() || undefined : undefined;
        const toDate = typeof args.toDate === "string" ? args.toDate.trim() || undefined : undefined;
        const brief = await buildPeriodQuantBrief(fromDate, toDate);
        if (!brief) {
          return okTool({
            vaultId,
            hasData: false,
            message: "该知识库在指定时间区间内暂无实盘净值或交割记录。",
          });
        }
        return okTool({ vaultId, hasData: true, quantBrief: brief });
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
          docIds: packed.snapshot.included_ids,
          skillId: packed.skillId,
          skillName: packed.skillName,
          dateRange: packed.snapshot.date_range,
          evidenceCount: packed.evidenceCount,
          charCount: packed.charCount,
          quantBrief: packed.quantBrief,
          instructions:
            "请依据 promptText 中的规则与证据目录生成严格合法的 JSON，随后调用 tradeloom_save_manual（带上相同的 docIds / skillId 与 rawResponse）完成防幻觉溯源校验并落库。",
          promptText: packed.promptText,
        });
      });
    }

    case "tradeloom_save_manual": {
      return runWithVault(vaultId, async () => {
        const rawResponse = typeof args.rawResponse === "string" ? args.rawResponse : "";
        if (!rawResponse.trim()) return errTool("rawResponse 不能为空");
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
          manualId: saved.report.id,
          title: saved.report.title,
          statistics: saved.report.statistics,
          warnings: saved.report.warnings,
          markdownCard: `40-交易手册/${saved.report.id}.md`,
        });
      });
    }

    case "tradeloom_list_manuals": {
      return runWithVault(vaultId, async () => {
        const manuals = await listSavedManuals();
        return okTool({
          vaultId,
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
            instructions:
              "TradeLoom 本地交易复盘与个人方法论底座：支持检索双链复盘、查询脱敏实盘量化锚点、打包证据切片，以及将外部 Agent 提炼的 JSON 手册经逐字 evidence_id 核验后正式落盘。",
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
                    `1. 调用 tradeloom_prepare_synthesis（fromDate=${String(pArgs.fromDate ?? "") || "不限"}，toDate=${String(pArgs.toDate ?? "") || "不限"}，skillId=${String(pArgs.skillId ?? "short-term")}）获取复盘证据切片与实盘锚点。`,
                    "2. 严格依据返回的 promptText 与 evidence_id 目录生成合法 JSON，绝不编造任何 evidence_id 或数据。",
                    "3. 调用 tradeloom_save_manual 将 JSON 校验落库为正式个人交易手册，并向我汇报生成的核心规则与知行偏离警示。",
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
description: Connect your AI Agent to local TradeLoom to search trading reviews, audit real PnL vs review notes, import new reviews, and synthesize evidence-verified trading playbooks without extra API keys.
---

# TradeLoom Trading Review & Playbook Skill

When the user asks to analyze their trading reviews, check real trading discipline against their ledger, import a new review, or synthesize a personal trading playbook in **TradeLoom**, follow this workflow.

## Connection

- **Preferred (MCP)**: Connect to the \`tradeloom\` MCP server (stdio via \`node <repo>/scripts/tradeloom-mcp-server.mjs\` or Streamable HTTP at \`${baseUrl}/api/mcp\`).
- **Fallback (Local HTTP)**: TradeLoom runs locally at \`${baseUrl}\` (localhost only).

## Core Workflows

### 1. Search & Inspect Trading Memory
1. Call \`tradeloom_list_vaults\` to see available vaults and active vault.
2. Call \`tradeloom_search_reviews\` with \`query\`, \`year\`, or \`kind\` to locate relevant reviews and \`#concepts\`.
3. Call \`tradeloom_read_review\` to read the full original review and its Obsidian bi-directional links.
4. Call \`tradeloom_get_ledger_summary\` to compare what the user wrote with real percentage returns, MDD, Alpha, profit factor, and per-stock realized PnL% (no raw capital or account numbers are ever exposed).

### 2. Zero-API Evidence-Verified Playbook Synthesis (No Extra API Key Needed)
1. Call \`tradeloom_prepare_synthesis\` (with \`fromDate\`/\`toDate\` or \`docIds\` and \`skillId\`).
2. Read the returned \`promptText\` and deterministic \`evidence_id\` catalog carefully.
3. Produce **strict JSON** adhering to the output contract in \`promptText\`:
   - Every \`timeline\`, \`manual\`, and \`discipline_audit\` entry MUST cite exact \`evidence_id\` values from the catalog.
   - Never fabricate tickers, returns, or \`evidence_id\` strings.
4. Call \`tradeloom_save_manual\` with the same \`docIds\`/\`skillId\` and your JSON in \`rawResponse\`.
5. TradeLoom will verify every citation verbatim, persist \`.json\` + Obsidian \`.md\` into \`40-交易手册/\`, and rebuild the bi-directional knowledge graph.

### 3. Capture a New Review
- Call \`tradeloom_import_review\` with \`title\`, \`content\`, \`eventDate\` (\`YYYY-MM-DD\`), and \`tags\`.
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
