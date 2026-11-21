import { readFile } from "node:fs/promises";
import { importPastedReview } from "./cloud-ingest";
import { maskSecret } from "./provider";
import { rebuildVault } from "./vault";
import type { VaultIndex } from "./vault-builder";
import { ensureWorkspace, fileExists, getWorkspacePaths, writeAtomic } from "./workspace";

export type ConnectorId = "notion" | "feishu" | "yuque" | "dida365";

export type NotionConnectorConfig = {
  token: string;
  targetId: string; // Database ID or Page ID (optional: blank searches shared pages)
  maxItems?: number;
};

export type FeishuConnectorConfig = {
  appId: string;
  appSecret: string;
  docTokens: string; // Comma or newline separated Feishu docx/wiki URLs or tokens
  domain?: string; // open.feishu.cn (default) or open.larksuite.com
};

export type YuqueConnectorConfig = {
  token: string;
  namespace: string; // e.g. login/repo_slug (optional: blank syncs first repo)
  baseUrl?: string; // default https://www.yuque.com/api/v2
  maxItems?: number;
};

export type DidaConnectorConfig = {
  token: string;
  projectId: string; // Optional project ID (blank syncs all projects)
  baseUrl?: string; // default https://api.dida365.com/open/v1
};

export type ConnectorsStore = {
  notion?: NotionConnectorConfig;
  feishu?: FeishuConnectorConfig;
  yuque?: YuqueConnectorConfig;
  dida365?: DidaConnectorConfig;
  lastSync?: Partial<Record<ConnectorId, { at: string; synced: number; message: string }>>;
};

export type MaskedConnectorSummary = {
  id: ConnectorId;
  name: string;
  badge: string;
  configured: boolean;
  maskedSecret: string;
  fields: Record<string, string>;
  lastSync?: { at: string; synced: number; message: string };
};

async function readStore(): Promise<ConnectorsStore> {
  const { connectorsFile } = getWorkspacePaths();
  if (!(await fileExists(connectorsFile))) return {};
  try {
    const raw = JSON.parse(await readFile(connectorsFile, "utf8")) as ConnectorsStore;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function writeStore(store: ConnectorsStore): Promise<void> {
  const { connectorsFile } = await ensureWorkspace();
  await writeAtomic(connectorsFile, JSON.stringify(store, null, 2));
}

export async function getMaskedConnectors(): Promise<MaskedConnectorSummary[]> {
  const store = await readStore();
  return [
    {
      id: "notion",
      name: "Notion",
      badge: "Official API",
      configured: Boolean(store.notion?.token),
      maskedSecret: maskSecret(store.notion?.token ?? ""),
      fields: {
        targetId: store.notion?.targetId ?? "",
        maxItems: String(store.notion?.maxItems ?? 25),
      },
      lastSync: store.lastSync?.notion,
    },
    {
      id: "feishu",
      name: "飞书文档 (Feishu)",
      badge: "Open API",
      configured: Boolean(store.feishu?.appId && store.feishu?.appSecret),
      maskedSecret: maskSecret(store.feishu?.appSecret ?? ""),
      fields: {
        appId: store.feishu?.appId ?? "",
        docTokens: store.feishu?.docTokens ?? "",
        domain: store.feishu?.domain || "open.feishu.cn",
      },
      lastSync: store.lastSync?.feishu,
    },
    {
      id: "yuque",
      name: "语雀 (Yuque)",
      badge: "API v2",
      configured: Boolean(store.yuque?.token),
      maskedSecret: maskSecret(store.yuque?.token ?? ""),
      fields: {
        namespace: store.yuque?.namespace ?? "",
        baseUrl: store.yuque?.baseUrl || "https://www.yuque.com/api/v2",
        maxItems: String(store.yuque?.maxItems ?? 30),
      },
      lastSync: store.lastSync?.yuque,
    },
    {
      id: "dida365",
      name: "滴答清单 (Dida365 / TickTick)",
      badge: "Open API",
      configured: Boolean(store.dida365?.token),
      maskedSecret: maskSecret(store.dida365?.token ?? ""),
      fields: {
        projectId: store.dida365?.projectId ?? "",
        baseUrl: store.dida365?.baseUrl || "https://api.dida365.com/open/v1",
      },
      lastSync: store.lastSync?.dida365,
    },
  ];
}

export async function saveConnectorConfig(
  id: ConnectorId,
  payload: Record<string, string>,
): Promise<{ ok: true; connectors: MaskedConnectorSummary[] } | { ok: false; error: string }> {
  const store = await readStore();

  if (id === "notion") {
    const token = (payload.token ?? "").trim() || store.notion?.token || "";
    if (!token) return { ok: false, error: "请填写 Notion Integration Token" };
    store.notion = {
      token,
      targetId: (payload.targetId ?? "").trim(),
      maxItems: Math.min(100, Math.max(1, Number(payload.maxItems) || 25)),
    };
  } else if (id === "feishu") {
    const appId = (payload.appId ?? "").trim();
    const appSecret = (payload.appSecret ?? "").trim() || store.feishu?.appSecret || "";
    if (!appId || !appSecret) return { ok: false, error: "请填写飞书 App ID 和 App Secret" };
    const domain = (payload.domain ?? "open.feishu.cn").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (domain !== "open.feishu.cn" && domain !== "open.larksuite.com") {
      return { ok: false, error: "飞书域名仅支持 open.feishu.cn 或 open.larksuite.com" };
    }
    store.feishu = {
      appId,
      appSecret,
      docTokens: (payload.docTokens ?? "").trim(),
      domain,
    };
  } else if (id === "yuque") {
    const token = (payload.token ?? "").trim() || store.yuque?.token || "";
    if (!token) return { ok: false, error: "请填写语雀 API Token (X-Auth-Token)" };
    const baseUrl = (payload.baseUrl ?? "https://www.yuque.com/api/v2").trim().replace(/\/+$/, "");
    if (!baseUrl.startsWith("https://")) {
      return { ok: false, error: "语雀 API 地址必须为 https://" };
    }
    store.yuque = {
      token,
      namespace: (payload.namespace ?? "").trim(),
      baseUrl,
      maxItems: Math.min(100, Math.max(1, Number(payload.maxItems) || 30)),
    };
  } else if (id === "dida365") {
    const token = (payload.token ?? "").trim() || store.dida365?.token || "";
    if (!token) return { ok: false, error: "请填写滴答清单 Open API Access Token" };
    const baseUrl = (payload.baseUrl ?? "https://api.dida365.com/open/v1").trim().replace(/\/+$/, "");
    if (!baseUrl.startsWith("https://")) {
      return { ok: false, error: "滴答清单 API 地址必须为 https://" };
    }
    store.dida365 = {
      token,
      projectId: (payload.projectId ?? "").trim(),
      baseUrl,
    };
  }

  await writeStore(store);
  return { ok: true, connectors: await getMaskedConnectors() };
}

/* ==================== Helpers ==================== */

export function extractFeishuToken(raw: string): { kind: "wiki" | "docx"; token: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const wikiMatch = /\/wiki\/([A-Za-z0-9_-]+)/.exec(s);
  if (wikiMatch) return { kind: "wiki", token: wikiMatch[1] };
  const docxMatch = /\/(?:docx|docs)\/([A-Za-z0-9_-]+)/.exec(s);
  if (docxMatch) return { kind: "docx", token: docxMatch[1] };
  if (/^[A-Za-z0-9_-]{8,64}$/.test(s)) return { kind: "docx", token: s };
  return null;
}

type NotionRichText = { plain_text?: string };
type NotionBlock = {
  type?: string;
  [key: string]: unknown;
};

function richTextToPlain(arr: unknown): string {
  if (!Array.isArray(arr)) return "";
  return (arr as NotionRichText[]).map((r) => r?.plain_text ?? "").join("");
}

export function notionBlocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    const t = b.type;
    if (!t) continue;
    const payload = (b[t] ?? {}) as Record<string, unknown>;
    const text = richTextToPlain(payload.rich_text);

    switch (t) {
      case "heading_1":
        if (text) lines.push(`# ${text}`, "");
        break;
      case "heading_2":
        if (text) lines.push(`## ${text}`, "");
        break;
      case "heading_3":
        if (text) lines.push(`### ${text}`, "");
        break;
      case "bulleted_list_item":
        if (text) lines.push(`- ${text}`);
        break;
      case "numbered_list_item":
        if (text) lines.push(`1. ${text}`);
        break;
      case "to_do":
        if (text) lines.push(`- [${payload.checked ? "x" : " "}] ${text}`);
        break;
      case "quote":
      case "callout":
        if (text) lines.push(`> ${text}`, "");
        break;
      case "code":
        if (text) lines.push(`\`\`\`${String(payload.language ?? "")}`, text, "```", "");
        break;
      case "divider":
        lines.push("---", "");
        break;
      default:
        if (text) lines.push(text, "");
        break;
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractNotionPageTitle(page: Record<string, unknown>): string {
  const props = (page.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const val of Object.values(props)) {
    if (val?.type === "title") {
      const t = richTextToPlain(val.title);
      if (t) return t;
    }
  }
  return "Notion复盘笔记";
}

function extractNotionPageTags(page: Record<string, unknown>): string[] {
  const props = (page.properties ?? {}) as Record<string, Record<string, unknown>>;
  const tags: string[] = [];
  for (const val of Object.values(props)) {
    if (val?.type === "multi_select" && Array.isArray(val.multi_select)) {
      for (const item of val.multi_select as Array<{ name?: string }>) {
        if (item?.name) tags.push(item.name);
      }
    } else if (val?.type === "select" && val.select && typeof val.select === "object") {
      const name = (val.select as { name?: string }).name;
      if (name) tags.push(name);
    }
  }
  return tags;
}

function extractNotionPageDate(page: Record<string, unknown>): string {
  const props = (page.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const val of Object.values(props)) {
    if (val?.type === "date" && val.date && typeof val.date === "object") {
      const start = (val.date as { start?: string }).start;
      if (start) return start.slice(0, 10);
    }
  }
  const created = typeof page.created_time === "string" ? page.created_time : "";
  return created ? created.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/* ==================== Test & Sync Implementations ==================== */

export async function testConnector(
  id: ConnectorId,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const store = await readStore();
  try {
    if (id === "notion") {
      const cfg = store.notion;
      if (!cfg?.token) return { ok: false, error: "请先保存 Notion Integration Token" };
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Notion-Version": "2022-06-28",
        },
      });
      const data = (await res.json()) as { name?: string; message?: string };
      if (!res.ok) return { ok: false, error: `Notion 认证失败 (${res.status})：${data.message ?? "Token 无效"}` };
      return { ok: true, message: `已连接 Notion Integration：${data.name || "OK"}` };
    }

    if (id === "feishu") {
      const cfg = store.feishu;
      if (!cfg?.appId || !cfg?.appSecret) return { ok: false, error: "请先保存飞书 App ID 和 App Secret" };
      const domain = cfg.domain || "open.feishu.cn";
      const res = await fetch(`https://${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
      });
      const data = (await res.json()) as { code?: number; msg?: string; expire?: number };
      if (!res.ok || data.code !== 0) {
        return { ok: false, error: `飞书认证失败：${data.msg ?? `HTTP ${res.status}`}` };
      }
      return { ok: true, message: `飞书应用凭证校验通过（Token 有效期 ${data.expire ?? 7200}s）` };
    }

    if (id === "yuque") {
      const cfg = store.yuque;
      if (!cfg?.token) return { ok: false, error: "请先保存语雀 X-Auth-Token" };
      const base = (cfg.baseUrl || "https://www.yuque.com/api/v2").replace(/\/+$/, "");
      const res = await fetch(`${base}/user`, {
        headers: { "X-Auth-Token": cfg.token, "User-Agent": "TradeLoom/1.0" },
      });
      const data = (await res.json()) as { data?: { name?: string; login?: string }; message?: string };
      if (!res.ok) return { ok: false, error: `语雀认证失败 (${res.status})：${data.message ?? "Token 无效"}` };
      return {
        ok: true,
        message: `已连接语雀账号：${data.data?.name || data.data?.login || "OK"}`,
      };
    }

    if (id === "dida365") {
      const cfg = store.dida365;
      if (!cfg?.token) return { ok: false, error: "请先保存滴答清单 Access Token" };
      const base = (cfg.baseUrl || "https://api.dida365.com/open/v1").replace(/\/+$/, "");
      const res = await fetch(`${base}/project`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      if (!res.ok) return { ok: false, error: `滴答清单认证失败 (HTTP ${res.status})，请检查 Open API Token` };
      const projects = (await res.json()) as Array<{ name?: string }>;
      return {
        ok: true,
        message: `已连接滴答清单，检测到 ${Array.isArray(projects) ? projects.length : 0} 个清单项目`,
      };
    }

    return { ok: false, error: "未知连接器类型" };
  } catch (err) {
    return { ok: false, error: `连接异常：${err instanceof Error ? err.message : "网络错误"}` };
  }
}

export type SyncResult =
  | { ok: true; synced: number; message: string; index: VaultIndex; connectors: MaskedConnectorSummary[] }
  | { ok: false; error: string };

export async function syncConnector(id: ConnectorId): Promise<SyncResult> {
  const store = await readStore();
  let synced = 0;

  try {
    if (id === "notion") {
      const cfg = store.notion;
      if (!cfg?.token) return { ok: false, error: "请先保存 Notion 配置" };
      const headers = {
        Authorization: `Bearer ${cfg.token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      };
      const limit = cfg.maxItems || 25;
      let pages: Array<Record<string, unknown>> = [];

      if (cfg.targetId) {
        const cleanId = cfg.targetId.replace(/-/g, "");
        // Try as database first, then fallback to single page
        const dbRes = await fetch(`https://api.notion.com/v1/databases/${cleanId}/query`, {
          method: "POST",
          headers,
          body: JSON.stringify({ page_size: Math.min(limit, 50) }),
        });
        if (dbRes.ok) {
          const dbData = (await dbRes.json()) as { results?: Array<Record<string, unknown>> };
          pages = dbData.results ?? [];
        } else {
          const pageRes = await fetch(`https://api.notion.com/v1/pages/${cleanId}`, { headers });
          if (pageRes.ok) {
            pages = [(await pageRes.json()) as Record<string, unknown>];
          } else {
            return {
              ok: false,
              error: `无法访问 Notion Database/Page (${cleanId})，请确认已在页面右上角 Connections 中添加该 Integration`,
            };
          }
        }
      } else {
        const searchRes = await fetch("https://api.notion.com/v1/search", {
          method: "POST",
          headers,
          body: JSON.stringify({
            filter: { property: "object", value: "page" },
            page_size: Math.min(limit, 50),
          }),
        });
        if (!searchRes.ok) return { ok: false, error: `Notion 搜索页面失败 (HTTP ${searchRes.status})` };
        const data = (await searchRes.json()) as { results?: Array<Record<string, unknown>> };
        pages = data.results ?? [];
      }

      for (const page of pages.slice(0, limit)) {
        const pageId = String(page.id ?? "");
        if (!pageId) continue;
        const blocksRes = await fetch(
          `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
          { headers },
        );
        if (!blocksRes.ok) continue;
        const blocksData = (await blocksRes.json()) as { results?: NotionBlock[] };
        const md = notionBlocksToMarkdown(blocksData.results ?? []);
        if (!md) continue;
        const saved = await importPastedReview(
          {
            title: extractNotionPageTitle(page),
            content: md,
            eventDate: extractNotionPageDate(page),
            sourcePlatform: "Notion",
            sourceUrl: typeof page.url === "string" ? page.url : undefined,
            tags: extractNotionPageTags(page),
            folder: "_云端_Notion",
          },
          { skipRebuild: true },
        );
        if (saved.ok) synced++;
      }
    } else if (id === "feishu") {
      const cfg = store.feishu;
      if (!cfg?.appId || !cfg?.appSecret) return { ok: false, error: "请先保存飞书配置" };
      const rawTokens = cfg.docTokens
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (rawTokens.length === 0) {
        return { ok: false, error: "请至少填写 1 个飞书文档链接或文档 Token（支持多行批量填写）" };
      }

      const domain = cfg.domain || "open.feishu.cn";
      const tokenRes = await fetch(`https://${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
      });
      const tokenData = (await tokenRes.json()) as { code?: number; tenant_access_token?: string; msg?: string };
      if (!tokenRes.ok || tokenData.code !== 0 || !tokenData.tenant_access_token) {
        return { ok: false, error: `获取飞书 Token 失败：${tokenData.msg ?? "凭证错误"}` };
      }
      const authHeaders = { Authorization: `Bearer ${tokenData.tenant_access_token}` };

      for (const entry of rawTokens.slice(0, 40)) {
        const parsed = extractFeishuToken(entry);
        if (!parsed) continue;
        let docId = parsed.token;
        let docTitle = "";

        if (parsed.kind === "wiki") {
          const wikiRes = await fetch(
            `https://${domain}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parsed.token)}`,
            { headers: authHeaders },
          );
          const wikiData = (await wikiRes.json()) as {
            code?: number;
            data?: { node?: { obj_token?: string; title?: string } };
          };
          if (wikiData.code === 0 && wikiData.data?.node?.obj_token) {
            docId = wikiData.data.node.obj_token;
            docTitle = wikiData.data.node.title ?? "";
          }
        }

        const [metaRes, contentRes] = await Promise.all([
          fetch(`https://${domain}/open-apis/docx/v1/documents/${encodeURIComponent(docId)}`, {
            headers: authHeaders,
          }),
          fetch(`https://${domain}/open-apis/docx/v1/documents/${encodeURIComponent(docId)}/raw_content`, {
            headers: authHeaders,
          }),
        ]);
        const metaJson = (await metaRes.json()) as { data?: { document?: { title?: string } } };
        const contentJson = (await contentRes.json()) as { code?: number; data?: { content?: string } };
        const rawText = contentJson.data?.content?.trim() ?? "";
        if (!rawText) continue;

        const title = docTitle || metaJson.data?.document?.title || `飞书复盘_${docId.slice(0, 8)}`;
        const saved = await importPastedReview(
          {
            title,
            content: rawText,
            sourcePlatform: "飞书文档",
            sourceUrl: entry.startsWith("http") ? entry : `https://feishu.cn/docx/${docId}`,
            folder: "_云端_飞书",
          },
          { skipRebuild: true },
        );
        if (saved.ok) synced++;
      }
    } else if (id === "yuque") {
      const cfg = store.yuque;
      if (!cfg?.token) return { ok: false, error: "请先保存语雀配置" };
      const base = (cfg.baseUrl || "https://www.yuque.com/api/v2").replace(/\/+$/, "");
      const headers = { "X-Auth-Token": cfg.token, "User-Agent": "TradeLoom/1.0" };
      let namespace = cfg.namespace.trim();

      if (!namespace) {
        const userRes = await fetch(`${base}/user`, { headers });
        const userData = (await userRes.json()) as { data?: { login?: string } };
        const login = userData.data?.login;
        if (!login) return { ok: false, error: "无法获取语雀用户信息，请手动填写知识库路径 (如 username/repo)" };
        const reposRes = await fetch(`${base}/users/${encodeURIComponent(login)}/repos`, { headers });
        const reposData = (await reposRes.json()) as { data?: Array<{ namespace?: string }> };
        namespace = reposData.data?.[0]?.namespace ?? "";
        if (!namespace) return { ok: false, error: "未找到语雀知识库，请手动填写知识库路径 (如 username/repo)" };
      }

      const docsRes = await fetch(`${base}/repos/${namespace}/docs`, { headers });
      if (!docsRes.ok) return { ok: false, error: `读取语雀知识库 ${namespace} 失败 (HTTP ${docsRes.status})` };
      const docsData = (await docsRes.json()) as {
        data?: Array<{ slug: string; title: string; created_at?: string; updated_at?: string }>;
      };
      const docs = (docsData.data ?? []).slice(0, cfg.maxItems || 30);

      for (const doc of docs) {
        const detailRes = await fetch(`${base}/repos/${namespace}/docs/${encodeURIComponent(doc.slug)}`, {
          headers,
        });
        if (!detailRes.ok) continue;
        const detailData = (await detailRes.json()) as {
          data?: { title?: string; body?: string; created_at?: string };
        };
        const md = detailData.data?.body?.trim() ?? "";
        if (!md) continue;
        const saved = await importPastedReview(
          {
            title: detailData.data?.title || doc.title,
            content: md,
            eventDate: (detailData.data?.created_at || doc.created_at || "").slice(0, 10),
            sourcePlatform: "语雀",
            sourceUrl: `https://www.yuque.com/${namespace}/${doc.slug}`,
            folder: "_云端_语雀",
          },
          { skipRebuild: true },
        );
        if (saved.ok) synced++;
      }
    } else if (id === "dida365") {
      const cfg = store.dida365;
      if (!cfg?.token) return { ok: false, error: "请先保存滴答清单配置" };
      const base = (cfg.baseUrl || "https://api.dida365.com/open/v1").replace(/\/+$/, "");
      const headers = { Authorization: `Bearer ${cfg.token}` };

      const projectsRes = await fetch(`${base}/project`, { headers });
      if (!projectsRes.ok) return { ok: false, error: `读取滴答清单项目失败 (HTTP ${projectsRes.status})` };
      const allProjects = (await projectsRes.json()) as Array<{ id: string; name: string }>;
      const targetProjects = cfg.projectId
        ? allProjects.filter((p) => p.id === cfg.projectId || p.name === cfg.projectId)
        : allProjects.slice(0, 8);

      for (const proj of targetProjects) {
        const dataRes = await fetch(`${base}/project/${encodeURIComponent(proj.id)}/data`, { headers });
        if (!dataRes.ok) continue;
        const projData = (await dataRes.json()) as {
          tasks?: Array<{
            id?: string;
            title?: string;
            content?: string;
            desc?: string;
            tags?: string[];
            startDate?: string;
            dueDate?: string;
            items?: Array<{ title?: string; status?: number }>;
          }>;
        };

        for (const task of (projData.tasks ?? []).slice(0, 40)) {
          const title = (task.title ?? "").trim();
          const checklist = (task.items ?? [])
            .map((it) => `- [${it.status === 1 ? "x" : " "}] ${it.title ?? ""}`)
            .join("\n");
          const body = [task.content?.trim(), task.desc?.trim(), checklist].filter(Boolean).join("\n\n");
          if (!title && !body) continue;

          const saved = await importPastedReview(
            {
              title: title || `${proj.name}清单记录`,
              content: body || title,
              eventDate: (task.startDate || task.dueDate || "").slice(0, 10),
              sourcePlatform: `滴答清单 · ${proj.name}`,
              tags: task.tags ?? [proj.name],
              folder: "_云端_滴答清单",
            },
            { skipRebuild: true },
          );
          if (saved.ok) synced++;
        }
      }
    }

    const index = await rebuildVault();
    const message =
      synced > 0
        ? `成功拉取 ${synced} 篇云端复盘并重建 Obsidian 双链图谱`
        : "连接正常，但未拉取到新的正文内容（请检查目标文档/知识库权限或是否为空）";

    store.lastSync = {
      ...(store.lastSync ?? {}),
      [id]: { at: new Date().toISOString(), synced, message },
    };
    await writeStore(store);

    return {
      ok: true,
      synced,
      message,
      index,
      connectors: await getMaskedConnectors(),
    };
  } catch (err) {
    return {
      ok: false,
      error: `同步失败：${err instanceof Error ? err.message : "网络或接口异常"}`,
    };
  }
}
