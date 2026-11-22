import { readFile } from "node:fs/promises";
import { importPastedReview } from "./cloud-ingest";
import {
  consumePendingOAuthSession,
  createPkcePair,
  discoverMcpOAuth,
  exchangeOAuthCode,
  McpHttpClient,
  MCP_ENDPOINTS,
  refreshOAuthToken,
  registerDynamicOAuthClient,
  resolveMcpUrl,
  savePendingOAuthSession,
  type McpOAuthConnectorId,
} from "./mcp-client";
import { maskSecret } from "./provider";
import { rebuildVault } from "./vault";
import type { VaultIndex } from "./vault-builder";
import { ensureWorkspace, fileExists, getWorkspacePaths, writeAtomic } from "./workspace";

export type ConnectorId = "notion" | "feishu" | "yuque" | "dida365";
export type ConnectorAuthMode = "api_token" | "mcp_oauth";

export type DidaProjectSummary = {
  id: string;
  name: string;
  kind?: string;
  isInbox?: boolean;
  isWelcome?: boolean;
};

export type NotionConnectorConfig = {
  token: string;
  targetId: string; // Database ID or Page ID (optional: blank searches shared pages)
  maxItems?: number;
  authMode?: ConnectorAuthMode;
  mcpUrl?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
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
  projectId: string; // Comma-separated project IDs/names (blank syncs all personal lists + inbox)
  baseUrl?: string; // default https://api.dida365.com/open/v1
  authMode?: ConnectorAuthMode;
  region?: "cn" | "global";
  mcpUrl?: string;
  includeCompleted?: boolean;
  skipWelcome?: boolean;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  discoveredProjects?: DidaProjectSummary[];
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
  authMode?: ConnectorAuthMode;
  supportsMcpOAuth?: boolean;
  discoveredProjects?: DidaProjectSummary[];
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
      badge: store.notion?.authMode === "mcp_oauth" ? "MCP OAuth" : "MCP / Official API",
      configured: Boolean(store.notion?.token),
      maskedSecret: maskSecret(store.notion?.token ?? ""),
      authMode: store.notion?.authMode ?? "api_token",
      supportsMcpOAuth: true,
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
      authMode: "api_token",
      supportsMcpOAuth: false,
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
      authMode: "api_token",
      supportsMcpOAuth: false,
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
      badge: store.dida365?.authMode === "mcp_oauth" ? "MCP OAuth" : "MCP / API 口令",
      configured: Boolean(store.dida365?.token),
      maskedSecret: maskSecret(store.dida365?.token ?? ""),
      authMode: store.dida365?.authMode ?? "api_token",
      supportsMcpOAuth: true,
      discoveredProjects: store.dida365?.discoveredProjects ?? [],
      fields: {
        projectId: store.dida365?.projectId ?? "",
        region: store.dida365?.region ?? "cn",
        includeCompleted: store.dida365?.includeCompleted === false ? "false" : "true",
        skipWelcome: store.dida365?.skipWelcome === false ? "false" : "true",
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
    const incomingToken = (payload.token ?? "").trim();
    const token = incomingToken || store.notion?.token || "";
    if (!token) return { ok: false, error: "请先通过一键登录 Notion，或填写 Integration Token" };
    store.notion = {
      ...(store.notion ?? {}),
      token,
      authMode: incomingToken ? "api_token" : store.notion?.authMode ?? "api_token",
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
    const incomingToken = (payload.token ?? "").trim();
    const token = incomingToken || store.dida365?.token || "";
    if (!token) return { ok: false, error: "请先一键登录滴答清单账号，或填写滴答网页版 API 口令" };
    const region = payload.region === "global" ? "global" : "cn";
    const defaultRestBase = region === "global" ? "https://api.ticktick.com/open/v1" : "https://api.dida365.com/open/v1";
    const baseUrl = (payload.baseUrl ?? defaultRestBase).trim().replace(/\/+$/, "") || defaultRestBase;
    if (!baseUrl.startsWith("https://")) {
      return { ok: false, error: "滴答清单 API 地址必须为 https://" };
    }
    store.dida365 = {
      ...(store.dida365 ?? {}),
      token,
      authMode: incomingToken ? "api_token" : store.dida365?.authMode ?? "api_token",
      region,
      mcpUrl: resolveMcpUrl("dida365", region),
      projectId: (payload.projectId ?? "").trim(),
      includeCompleted: payload.includeCompleted !== "false",
      skipWelcome: payload.skipWelcome !== "false",
      baseUrl,
    };
  }

  await writeStore(store);
  return { ok: true, connectors: await getMaskedConnectors() };
}

export async function disconnectConnector(
  id: ConnectorId,
): Promise<{ ok: true; connectors: MaskedConnectorSummary[] }> {
  const store = await readStore();
  delete store[id];
  if (store.lastSync) delete store.lastSync[id];
  await writeStore(store);
  return { ok: true, connectors: await getMaskedConnectors() };
}

/* ==================== Standard MCP OAuth 2.1 One-Click Login ==================== */

export async function startConnectorMcpOAuth(args: {
  id: McpOAuthConnectorId;
  origin: string;
  region?: "cn" | "global";
}): Promise<{ ok: true; authUrl: string } | { ok: false; error: string }> {
  try {
    const region: "cn" | "global" = args.region === "global" ? "global" : "cn";
    const mcpUrl = resolveMcpUrl(args.id, region);
    const redirectUri = `${args.origin.replace(/\/+$/, "")}/api/connectors/oauth/callback`;
    const discovery = await discoverMcpOAuth(mcpUrl);
    const { clientId, clientSecret } = await registerDynamicOAuthClient({
      registrationEndpoint: discovery.registrationEndpoint,
      redirectUri,
      grantTypesSupported: discovery.grantTypesSupported,
    });
    const { codeVerifier, codeChallenge, state } = createPkcePair();

    await savePendingOAuthSession({
      state,
      connectorId: args.id,
      mcpUrl,
      region,
      redirectUri,
      codeVerifier,
      clientId,
      clientSecret,
      tokenEndpoint: discovery.tokenEndpoint,
      createdAt: Date.now(),
    });

    const auth = new URL(discovery.authorizationEndpoint);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("code_challenge", codeChallenge);
    auth.searchParams.set("code_challenge_method", "S256");
    auth.searchParams.set("state", state);

    if (args.id === "dida365") {
      const scopes =
        discovery.scopesSupported.length > 0 ? discovery.scopesSupported.join(" ") : "tasks:read tasks:write";
      auth.searchParams.set("scope", scopes);
    }

    return { ok: true, authUrl: auth.toString() };
  } catch (err) {
    return {
      ok: false,
      error: `发起 MCP OAuth 登录失败：${err instanceof Error ? err.message : "网络或接口异常"}`,
    };
  }
}

export async function completeConnectorMcpOAuth(args: {
  state: string;
  code: string;
}): Promise<{ ok: true; connectorId: McpOAuthConnectorId; discoveredCount?: number } | { ok: false; error: string }> {
  try {
    const session = await consumePendingOAuthSession(args.state);
    if (!session) {
      return { ok: false, error: "OAuth 授权会话已过期或无效，请重新点击登录按钮" };
    }

    const tok = await exchangeOAuthCode({
      tokenEndpoint: session.tokenEndpoint,
      code: args.code,
      redirectUri: session.redirectUri,
      codeVerifier: session.codeVerifier,
      clientId: session.clientId,
      clientSecret: session.clientSecret,
    });

    const expiresAt = tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined;
    const store = await readStore();

    if (session.connectorId === "dida365") {
      const region = session.region === "global" ? "global" : "cn";
      const restBase = region === "global" ? "https://api.ticktick.com/open/v1" : "https://api.dida365.com/open/v1";
      store.dida365 = {
        ...(store.dida365 ?? { projectId: "" }),
        token: tok.access_token,
        refreshToken: tok.refresh_token || store.dida365?.refreshToken,
        expiresAt,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        tokenEndpoint: session.tokenEndpoint,
        authMode: "mcp_oauth",
        region,
        mcpUrl: session.mcpUrl,
        baseUrl: restBase,
        includeCompleted: store.dida365?.includeCompleted ?? true,
        skipWelcome: store.dida365?.skipWelcome ?? true,
      };
      let discoveredCount = 0;
      try {
        const projects = await fetchDidaProjects(store.dida365);
        store.dida365.discoveredProjects = projects;
        discoveredCount = projects.length;
      } catch {
        /* non-fatal */
      }
      await writeStore(store);
      return { ok: true, connectorId: "dida365", discoveredCount };
    }

    store.notion = {
      ...(store.notion ?? { targetId: "", maxItems: 25 }),
      token: tok.access_token,
      refreshToken: tok.refresh_token || store.notion?.refreshToken,
      expiresAt,
      clientId: session.clientId,
      clientSecret: session.clientSecret,
      tokenEndpoint: session.tokenEndpoint,
      authMode: "mcp_oauth",
      mcpUrl: session.mcpUrl || MCP_ENDPOINTS.notion,
    };
    await writeStore(store);
    return { ok: true, connectorId: "notion" };
  } catch (err) {
    return {
      ok: false,
      error: `完成 MCP OAuth 授权失败：${err instanceof Error ? err.message : "未知错误"}`,
    };
  }
}

async function ensureFreshOAuthToken(store: ConnectorsStore, id: McpOAuthConnectorId): Promise<void> {
  const cfg = store[id];
  if (!cfg || cfg.authMode !== "mcp_oauth") return;
  if (!cfg.refreshToken || !cfg.tokenEndpoint || !cfg.clientId) return;
  if (!cfg.expiresAt || Date.now() < cfg.expiresAt - 120_000) return;

  try {
    const refreshed = await refreshOAuthToken({
      tokenEndpoint: cfg.tokenEndpoint,
      refreshToken: cfg.refreshToken,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    });
    cfg.token = refreshed.access_token;
    if (refreshed.refresh_token) cfg.refreshToken = refreshed.refresh_token;
    if (refreshed.expires_in) cfg.expiresAt = Date.now() + refreshed.expires_in * 1000;
    await writeStore(store);
  } catch {
    /* keep existing token */
  }
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

const DIDA_WELCOME_PROJECT_PATTERNS = [
  /^欢迎使用/i,
  /^welcome$/i,
  /^getting\s*started$/i,
  /^新手指南$/,
  /^快速入门$/,
];

const DIDA_WELCOME_TASK_PATTERNS = [
  /关联微信公众号.*从微信保存任务/,
  /观看\s*1\s*分钟视频教程/,
  /开启番茄专注和习惯打卡/,
  /还想了解更多[？?].*帮助中心看看/,
  /点此快速入门/,
  /团队共享协作/,
  /^[^\w\u4e00-\u9fff]*高级会员$/,
  /快速了解滴答清单/,
  /智能时间识别/,
  /用日历视图安排任务/,
  /向左滑动任务来设置日期和提醒/,
  /(?:按住|长按)右下角.*语音添加任务/,
  /点击任务进入详情.*写更多备注/,
  /点击任务前的小方框来完成任务/,
  /点击右下角.*添加任务/,
];

export function isDidaWelcomeProject(name: string): boolean {
  const clean = name.trim();
  return DIDA_WELCOME_PROJECT_PATTERNS.some((re) => re.test(clean));
}

export function isDidaWelcomeTask(title: string): boolean {
  const clean = title.trim();
  if (!clean) return false;
  return DIDA_WELCOME_TASK_PATTERNS.some((re) => re.test(clean));
}

function toBeijingDateStr(isoLike?: string): string {
  if (!isoLike) return "";
  const s = String(isoLike).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m ? m[1] : "";
  }
  const bj = new Date(parsed.getTime() + 8 * 60 * 60 * 1000);
  return bj.toISOString().slice(0, 10);
}

type DidaTaskRaw = {
  id?: string;
  projectId?: string;
  title?: string;
  content?: string;
  desc?: string;
  tags?: string[];
  kind?: string;
  status?: number;
  startDate?: string;
  dueDate?: string;
  completedTime?: string;
  modifiedTime?: string;
  createdTime?: string;
  items?: Array<{ title?: string; status?: number }>;
};

function unwrapArray<T>(data: unknown, keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of keys) {
      if (Array.isArray(obj[k])) return obj[k] as T[];
    }
  }
  return [];
}

async function fetchDidaProjects(cfg: DidaConnectorConfig): Promise<DidaProjectSummary[]> {
  const mcpUrl = cfg.mcpUrl || resolveMcpUrl("dida365", cfg.region);
  const restBase = (cfg.baseUrl || "https://api.dida365.com/open/v1").replace(/\/+$/, "");

  let rawProjects: Array<{ id?: string; name?: string; kind?: string; closed?: boolean }> = [];
  let fetched = false;

  try {
    const mcp = new McpHttpClient(mcpUrl, cfg.token);
    const res = await mcp.callTool("list_projects", {});
    const list = unwrapArray<{ id?: string; name?: string; kind?: string; closed?: boolean }>(res.json, [
      "projects",
      "data",
      "items",
    ]);
    if (list.length > 0 || res.json !== null) {
      rawProjects = list;
      fetched = true;
    }
  } catch {
    /* fallback to Open API REST */
  }

  if (!fetched) {
    const res = await fetch(`${restBase}/project`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      throw new Error(`滴答清单认证失败 (HTTP ${res.status})，请重新一键登录或检查 API 口令`);
    }
    const json = (await res.json()) as Array<{ id?: string; name?: string; kind?: string; closed?: boolean }>;
    rawProjects = Array.isArray(json) ? json : [];
  }

  const out: DidaProjectSummary[] = [
    { id: "inbox", name: "收集箱 (Inbox)", kind: "INBOX", isInbox: true, isWelcome: false },
  ];
  const seen = new Set<string>(["inbox"]);

  for (const p of rawProjects) {
    const pid = String(p.id ?? "").trim();
    const pname = String(p.name ?? "").trim();
    if (!pid || !pname || p.closed || seen.has(pid)) continue;
    seen.add(pid);
    out.push({
      id: pid,
      name: pname,
      kind: p.kind || "TASK",
      isInbox: false,
      isWelcome: isDidaWelcomeProject(pname),
    });
  }
  return out;
}

async function fetchDidaProjectTasks(
  cfg: DidaConnectorConfig,
  proj: DidaProjectSummary,
  mcp: McpHttpClient | null,
): Promise<DidaTaskRaw[]> {
  const restBase = (cfg.baseUrl || "https://api.dida365.com/open/v1").replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${cfg.token}` };
  const collected: DidaTaskRaw[] = [];
  const seenIds = new Set<string>();

  const pushTasks = (items: DidaTaskRaw[]) => {
    for (const t of items) {
      const key = t.id || `${t.title ?? ""}__${t.startDate ?? t.completedTime ?? ""}`;
      if (!key || seenIds.has(key)) continue;
      seenIds.add(key);
      collected.push(t);
    }
  };

  let gotUndone = false;
  if (mcp) {
    try {
      const res = await mcp.callTool("get_project_with_undone_tasks", { projectId: proj.id });
      const tasks = unwrapArray<DidaTaskRaw>(res.json, ["tasks", "data", "items"]);
      pushTasks(tasks);
      gotUndone = true;
    } catch {
      /* fallback to REST */
    }
  }
  if (!gotUndone) {
    try {
      const dataRes = await fetch(`${restBase}/project/${encodeURIComponent(proj.id)}/data`, {
        headers,
        signal: AbortSignal.timeout(12000),
      });
      if (dataRes.ok) {
        const projData = (await dataRes.json()) as { tasks?: DidaTaskRaw[] };
        pushTasks(projData.tasks ?? []);
      }
    } catch {
      /* ignore individual project error */
    }
  }

  if (cfg.includeCompleted !== false) {
    const now = new Date();
    const start = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000);
    const startIso = start.toISOString().replace("Z", "+0000");
    const endIso = now.toISOString().replace("Z", "+0000");

    let gotCompleted = false;
    if (mcp) {
      try {
        const res = await mcp.callTool("list_completed_tasks_by_date", {
          projectIds: [proj.id],
          startDate: startIso,
          endDate: endIso,
        });
        const tasks = unwrapArray<DidaTaskRaw>(res.json, ["tasks", "data", "items"]);
        pushTasks(tasks);
        gotCompleted = true;
      } catch {
        /* fallback to REST */
      }
    }
    if (!gotCompleted) {
      try {
        const compRes = await fetch(`${restBase}/task/completed`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            projectIds: [proj.id],
            startDate: startIso,
            endDate: endIso,
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (compRes.ok) {
          const json = (await compRes.json()) as DidaTaskRaw[] | { tasks?: DidaTaskRaw[] };
          pushTasks(unwrapArray<DidaTaskRaw>(json, ["tasks", "data", "items"]));
        }
      } catch {
        /* optional */
      }
    }
  }

  return collected;
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
  return `Notion 复盘 ${String(page.id ?? "").slice(0, 8)}`;
}

function extractNotionPageTags(page: Record<string, unknown>): string[] {
  const tags: string[] = [];
  const props = (page.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const val of Object.values(props)) {
    if (val?.type === "multi_select" && Array.isArray(val.multi_select)) {
      for (const opt of val.multi_select as Array<{ name?: string }>) {
        if (opt?.name) tags.push(opt.name);
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

async function syncNotionViaMcp(cfg: NotionConnectorConfig): Promise<number> {
  const mcp = new McpHttpClient(cfg.mcpUrl || MCP_ENDPOINTS.notion, cfg.token);
  const tools = await mcp.listTools();
  const searchTool = tools.find((t) => /search/i.test(t.name))?.name || "notion-search";
  const fetchTool = tools.find((t) => /fetch/i.test(t.name))?.name || "notion-fetch";
  const limit = cfg.maxItems || 25;

  const targetIds: Array<{ id: string; title?: string; url?: string }> = [];

  if (cfg.targetId.trim()) {
    for (const raw of cfg.targetId.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
      targetIds.push({ id: raw });
    }
  } else {
    const searchRes = await mcp.callTool(searchTool, { query: "" });
    const items = unwrapArray<Record<string, unknown>>(searchRes.json, ["results", "pages", "items", "data"]);
    for (const it of items.slice(0, limit)) {
      const id = String(it.id || it.url || "").trim();
      if (!id) continue;
      targetIds.push({
        id,
        title: typeof it.title === "string" ? it.title : undefined,
        url: typeof it.url === "string" ? it.url : undefined,
      });
    }
    if (targetIds.length === 0 && searchRes.text) {
      const urlMatches = searchRes.text.match(/https:\/\/www\.notion\.so\/[^\s)>\]]+/g) ?? [];
      for (const u of Array.from(new Set(urlMatches)).slice(0, limit)) {
        targetIds.push({ id: u, url: u });
      }
    }
  }

  let synced = 0;
  for (const item of targetIds.slice(0, limit)) {
    try {
      const fetched = await mcp.callTool(fetchTool, { id: item.id });
      let title = item.title || "";
      let body = fetched.text;
      let sourceUrl = item.url;
      if (fetched.json && typeof fetched.json === "object") {
        const obj = fetched.json as Record<string, unknown>;
        if (typeof obj.title === "string" && obj.title.trim()) title = obj.title.trim();
        if (typeof obj.text === "string" && obj.text.trim()) body = obj.text.trim();
        else if (typeof obj.content === "string" && obj.content.trim()) body = obj.content.trim();
        if (typeof obj.url === "string") sourceUrl = obj.url;
      }
      if (!body.trim()) continue;
      if (!title) {
        const h1 = /^#\s+(.+)$/m.exec(body);
        title = h1 ? h1[1].trim() : `Notion 页面 ${item.id.slice(0, 8)}`;
      }
      const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(`${title}\n${body.slice(0, 400)}`);
      const saved = await importPastedReview(
        {
          title,
          content: body,
          eventDate: dateMatch ? dateMatch[1] : undefined,
          sourcePlatform: "Notion (MCP)",
          sourceUrl,
          folder: "_云端_Notion",
        },
        { skipRebuild: true },
      );
      if (saved.ok) synced++;
    } catch {
      /* continue */
    }
  }
  return synced;
}

/* ==================== Test & Sync Implementations ==================== */

export async function testConnector(
  id: ConnectorId,
): Promise<{ ok: true; message: string; connectors?: MaskedConnectorSummary[] } | { ok: false; error: string }> {
  const store = await readStore();
  try {
    if (id === "notion") {
      await ensureFreshOAuthToken(store, "notion");
      const cfg = store.notion;
      if (!cfg?.token) return { ok: false, error: "请先一键登录 Notion，或保存 Integration Token" };

      if (cfg.authMode === "mcp_oauth") {
        const mcp = new McpHttpClient(cfg.mcpUrl || MCP_ENDPOINTS.notion, cfg.token);
        const tools = await mcp.listTools();
        return {
          ok: true,
          message: `已通过官方 MCP OAuth 连接 Notion（已就绪 ${tools.length} 个 MCP 工具）`,
          connectors: await getMaskedConnectors(),
        };
      }

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
      await ensureFreshOAuthToken(store, "dida365");
      const cfg = store.dida365;
      if (!cfg?.token) return { ok: false, error: "请先一键登录滴答清单，或填写网页版 API 口令" };

      const projects = await fetchDidaProjects(cfg);
      cfg.discoveredProjects = projects;
      await writeStore(store);

      const personalLists = projects.filter((p) => !p.isInbox && !p.isWelcome);
      const welcomeLists = projects.filter((p) => p.isWelcome);
      const previewNames = personalLists.slice(0, 6).map((p) => p.name).join("、");
      const warnEmpty =
        personalLists.length === 0
          ? "（未发现自建清单；若主号有自建清单，请点「断开重登」确认授权的是主号）"
          : `：${previewNames}${personalLists.length > 6 ? " 等" : ""}`;

      return {
        ok: true,
        message: `已连接滴答清单（收集箱 + ${personalLists.length} 个个人清单${welcomeLists.length > 0 ? `，已自动标记 ${welcomeLists.length} 个官方欢迎清单` : ""}）${warnEmpty}`,
        connectors: await getMaskedConnectors(),
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
  let skippedWelcome = 0;

  try {
    if (id === "notion") {
      await ensureFreshOAuthToken(store, "notion");
      const cfg = store.notion;
      if (!cfg?.token) return { ok: false, error: "请先一键登录或保存 Notion 配置" };

      if (cfg.authMode === "mcp_oauth") {
        synced = await syncNotionViaMcp(cfg);
      } else {
        const headers = {
          Authorization: `Bearer ${cfg.token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        };
        const limit = cfg.maxItems || 25;
        let pages: Array<Record<string, unknown>> = [];

        if (cfg.targetId) {
          const cleanId = cfg.targetId.replace(/-/g, "");
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
      await ensureFreshOAuthToken(store, "dida365");
      const cfg = store.dida365;
      if (!cfg?.token) return { ok: false, error: "请先一键登录滴答清单或保存 API 口令" };

      const allProjects = await fetchDidaProjects(cfg);
      cfg.discoveredProjects = allProjects;

      const selectedTokens = (cfg.projectId ?? "")
        .split(/[\n,;，；]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const skipWelcome = cfg.skipWelcome !== false;

      let targetProjects: DidaProjectSummary[];
      if (selectedTokens.length > 0) {
        const tokenSet = new Set(selectedTokens.map((s) => s.toLowerCase()));
        targetProjects = allProjects.filter(
          (p) =>
            tokenSet.has(p.id.toLowerCase()) ||
            tokenSet.has(p.name.toLowerCase()) ||
            (p.isInbox && (tokenSet.has("收集箱") || tokenSet.has("inbox"))),
        );
      } else {
        targetProjects = allProjects.filter((p) => !(skipWelcome && p.isWelcome));
      }

      if (targetProjects.length === 0) {
        return {
          ok: false,
          error: "未匹配到要同步的滴答清单（请点击「测试并刷新清单」核对名称，或留空同步全部个人清单）",
        };
      }

      let mcp: McpHttpClient | null = null;
      try {
        mcp = new McpHttpClient(cfg.mcpUrl || resolveMcpUrl("dida365", cfg.region), cfg.token);
        await mcp.initialize();
      } catch {
        mcp = null;
      }

      const seenGlobal = new Set<string>();
      for (const proj of targetProjects) {
        const tasks = await fetchDidaProjectTasks(cfg, proj, mcp);
        for (const task of tasks.slice(0, 120)) {
          const title = (task.title ?? "").trim();
          if (skipWelcome && isDidaWelcomeTask(title)) {
            skippedWelcome++;
            continue;
          }
          const dedupeKey = task.id || `${proj.id}::${title}::${task.completedTime || task.startDate || ""}`;
          if (seenGlobal.has(dedupeKey)) continue;
          seenGlobal.add(dedupeKey);

          const checklist = (task.items ?? [])
            .map((it) => `- [${it.status === 1 || it.status === 2 ? "x" : " "}] ${it.title ?? ""}`)
            .join("\n");
          const body = [task.content?.trim(), task.desc?.trim(), checklist].filter(Boolean).join("\n\n");
          if (!title && !body) continue;

          const eventDate =
            toBeijingDateStr(task.completedTime) ||
            toBeijingDateStr(task.startDate) ||
            toBeijingDateStr(task.dueDate) ||
            toBeijingDateStr(task.modifiedTime) ||
            toBeijingDateStr(task.createdTime);

          const saved = await importPastedReview(
            {
              title: title || `${proj.name}清单记录`,
              content: body || title,
              eventDate,
              sourcePlatform: `滴答清单 · ${proj.name}`,
              tags: Array.from(new Set([...(task.tags ?? []), proj.isInbox ? "收集箱" : proj.name])),
              folder: "_云端_滴答清单",
            },
            { skipRebuild: true },
          );
          if (saved.ok) synced++;
        }
      }
    }

    const index = await rebuildVault();
    const skipNote = skippedWelcome > 0 ? `（已自动跳过 ${skippedWelcome} 条官方新手教程）` : "";
    const message =
      synced > 0
        ? `成功拉取 ${synced} 篇云端复盘并重建 Obsidian 双链图谱${skipNote}`
        : `连接正常，但未拉取到个人复盘正文${skipNote}（请核对是否授权对了主号，或在清单列表中勾选目标清单）`;

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
