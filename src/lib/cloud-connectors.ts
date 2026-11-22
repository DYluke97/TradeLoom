import { readFile } from "node:fs/promises";
import { importPastedReview } from "./cloud-ingest";
import {
  detectLarkCliStatus,
  fetchLarkCliDocMarkdown,
  searchLarkCliDocs,
} from "./feishu-agent";
import {
  consumePendingOAuthSession,
  createPkcePair,
  discoverMcpOAuth,
  exchangeOAuthCode,
  McpHttpClient,
  McpSseClient,
  MCP_ENDPOINTS,
  refreshOAuthToken,
  registerDynamicOAuthClient,
  resolveMcpUrl,
  savePendingOAuthSession,
  type McpOAuthConnectorId,
  type McpToolInfo,
} from "./mcp-client";
import { maskSecret } from "./provider";
import { rebuildVault } from "./vault";
import type { VaultIndex } from "./vault-builder";
import {
  createTencentDocsClient,
  discoverTencentDocsStructure,
  fetchTencentDocsItems,
  formatTencentDocsError,
  normalizeTencentDocsMcpUrl,
  normalizeTencentDocsToken,
  type TencentDocsScope,
} from "./tencent-docs-mcp";
import {
  discoverImaWorkspace,
  fetchImaItems,
  IMA_DEFAULT_BASE_URL,
  normalizeImaBaseUrl,
} from "./tencent-ima";
import { ensureWorkspace, fileExists, getWorkspacePaths, writeAtomic } from "./workspace";

export type ConnectorId = "notion" | "feishu" | "yuque" | "dida365" | "youdao" | "tencent_docs" | "ima";
export type ConnectorAuthMode = "api_token" | "mcp_oauth" | "mcp_api_key";

export type DidaProjectSummary = {
  id: string;
  name: string;
  kind?: string;
  isInbox?: boolean;
  isWelcome?: boolean;
};

export type YoudaoFolderSummary = {
  id: string;
  name: string;
  isRoot?: boolean;
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

export type FeishuAuthMode = "open_api" | "lark_cli";

export type FeishuConnectorConfig = {
  appId: string;
  appSecret: string;
  docTokens: string; // Comma or newline separated Feishu docx/wiki URLs or tokens
  domain?: string; // open.feishu.cn (default) or open.larksuite.com
  mode?: FeishuAuthMode; // "open_api" (default, supports QR one-click app creation) or "lark_cli"
  cliProfile?: string; // optional lark-cli --profile name
  searchQuery?: string; // optional search keyword (<=30 chars) for lark-cli drive +search
  maxItems?: number; // default 20
};

export type YuqueRepoSummary = {
  id: string;
  namespace: string;
  name: string;
  description?: string;
  itemsCount?: number;
};

export type YuqueConnectorConfig = {
  token: string;
  namespace: string; // Comma-separated repo namespaces (e.g. login/repo1, login/repo2); blank syncs all discovered repos
  keyword?: string; // Optional full-text search query via GET /search?q=...&type=doc
  includeNotes?: boolean; // Sync Yuque Notes (语雀小记) via GET /notes (default true)
  baseUrl?: string; // default https://www.yuque.com/api/v2 (auto-normalizes team host like https://team.yuque.com)
  maxItems?: number;
  discoveredRepos?: YuqueRepoSummary[];
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

export type YoudaoConnectorConfig = {
  apiKey: string;
  folderId: string; // Comma-separated folder IDs or names (blank syncs root + top-level folders)
  keyword: string; // Optional keyword for searchNotes
  maxItems?: number; // default 30
  sseUrl?: string; // default https://open.mail.163.com/api/ynote/mcp/sse
  discoveredFolders?: YoudaoFolderSummary[];
};

export type TencentDocsConnectorConfig = {
  token: string;
  scope?: TencentDocsScope; // "all" | "space" | "drive"
  parentId?: string; // Comma-separated space:<node_id> / drive:<folder_id> / raw IDs
  keyword?: string; // Optional search keyword
  mcpUrl?: string; // default https://docs.qq.com/openapi/mcp
  maxItems?: number; // default 25
  discoveredFolders?: YoudaoFolderSummary[];
};

export type ImaConnectorConfig = {
  clientId: string;
  apiKey: string;
  includeNotes?: boolean; // Sync ima Notebooks (/openapi/note/v1) - default true
  includeWiki?: boolean; // Sync ima Knowledge Bases (/openapi/wiki/v1) - default true
  folderId?: string; // Comma-separated notebook folder IDs or names
  wikiId?: string; // Comma-separated knowledge base IDs or names
  keyword?: string; // Optional search keyword
  baseUrl?: string; // default https://ima.qq.com
  maxItems?: number; // default 30
  discoveredFolders?: YoudaoFolderSummary[];
  discoveredRepos?: YuqueRepoSummary[];
};

export type ConnectorsStore = {
  notion?: NotionConnectorConfig;
  feishu?: FeishuConnectorConfig;
  yuque?: YuqueConnectorConfig;
  dida365?: DidaConnectorConfig;
  youdao?: YoudaoConnectorConfig;
  tencent_docs?: TencentDocsConnectorConfig;
  ima?: ImaConnectorConfig;
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
  discoveredFolders?: YoudaoFolderSummary[];
  discoveredRepos?: YuqueRepoSummary[];
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
      name: "飞书文档 (Feishu / Lark)",
      badge: store.feishu?.mode === "lark_cli" ? "飞书 CLI" : "扫码建应用 / API",
      configured:
        store.feishu?.mode === "lark_cli"
          ? true
          : Boolean(store.feishu?.appId && store.feishu?.appSecret),
      maskedSecret:
        store.feishu?.mode === "lark_cli"
          ? store.feishu?.cliProfile
            ? `profile:${store.feishu.cliProfile}`
            : "本机 lark-cli"
          : maskSecret(store.feishu?.appSecret ?? ""),
      authMode: store.feishu?.mode === "lark_cli" ? "mcp_api_key" : "api_token",
      supportsMcpOAuth: false,
      fields: {
        mode: store.feishu?.mode || "open_api",
        appId: store.feishu?.appId ?? "",
        docTokens: store.feishu?.docTokens ?? "",
        domain: store.feishu?.domain || "open.feishu.cn",
        cliProfile: store.feishu?.cliProfile ?? "",
        searchQuery: store.feishu?.searchQuery ?? "",
        maxItems: String(store.feishu?.maxItems ?? 20),
      },
      lastSync: store.lastSync?.feishu,
    },
    {
      id: "yuque",
      name: "语雀 (Yuque)",
      badge: "API v2 · 小记/知识库",
      configured: Boolean(store.yuque?.token),
      maskedSecret: maskSecret(store.yuque?.token ?? ""),
      authMode: "api_token",
      supportsMcpOAuth: false,
      discoveredRepos: store.yuque?.discoveredRepos ?? [],
      fields: {
        namespace: store.yuque?.namespace ?? "",
        keyword: store.yuque?.keyword ?? "",
        includeNotes: store.yuque?.includeNotes === false ? "false" : "true",
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
    {
      id: "youdao",
      name: "有道云笔记 (YoudaoNote)",
      badge: "官方 MCP (SSE)",
      configured: Boolean(store.youdao?.apiKey),
      maskedSecret: maskSecret(store.youdao?.apiKey ?? ""),
      authMode: "mcp_api_key",
      supportsMcpOAuth: false,
      discoveredFolders: store.youdao?.discoveredFolders ?? [],
      fields: {
        folderId: store.youdao?.folderId ?? "",
        keyword: store.youdao?.keyword ?? "",
        maxItems: String(store.youdao?.maxItems ?? 30),
        sseUrl: store.youdao?.sseUrl || MCP_ENDPOINTS.youdao,
      },
      lastSync: store.lastSync?.youdao,
    },
    {
      id: "tencent_docs",
      name: "腾讯文档 (Tencent Docs)",
      badge: "官方 MCP · 免费 2k/天",
      configured: Boolean(store.tencent_docs?.token),
      maskedSecret: maskSecret(store.tencent_docs?.token ?? ""),
      authMode: "mcp_api_key",
      supportsMcpOAuth: false,
      discoveredFolders: store.tencent_docs?.discoveredFolders ?? [],
      fields: {
        scope: store.tencent_docs?.scope ?? "all",
        parentId: store.tencent_docs?.parentId ?? "",
        keyword: store.tencent_docs?.keyword ?? "",
        maxItems: String(store.tencent_docs?.maxItems ?? 25),
        mcpUrl: store.tencent_docs?.mcpUrl || MCP_ENDPOINTS.tencent_docs,
      },
      lastSync: store.lastSync?.tencent_docs,
    },
    {
      id: "ima",
      name: "腾讯 ima (笔记 + 知识库)",
      badge: "官方 OpenAPI · 免费",
      configured: Boolean(store.ima?.clientId && store.ima?.apiKey),
      maskedSecret: maskSecret(store.ima?.apiKey ?? ""),
      authMode: "api_token",
      supportsMcpOAuth: false,
      discoveredFolders: store.ima?.discoveredFolders ?? [],
      discoveredRepos: store.ima?.discoveredRepos ?? [],
      fields: {
        clientId: store.ima?.clientId ?? "",
        includeNotes: store.ima?.includeNotes === false ? "false" : "true",
        includeWiki: store.ima?.includeWiki === false ? "false" : "true",
        folderId: store.ima?.folderId ?? "",
        wikiId: store.ima?.wikiId ?? "",
        keyword: store.ima?.keyword ?? "",
        maxItems: String(store.ima?.maxItems ?? 30),
        baseUrl: store.ima?.baseUrl || IMA_DEFAULT_BASE_URL,
      },
      lastSync: store.lastSync?.ima,
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
    const mode: FeishuAuthMode = payload.mode === "lark_cli" ? "lark_cli" : "open_api";
    const appId = (payload.appId ?? "").trim() || store.feishu?.appId || "";
    const appSecret = (payload.appSecret ?? "").trim() || store.feishu?.appSecret || "";
    if (mode === "open_api" && (!appId || !appSecret)) {
      return { ok: false, error: "请先点击「飞书扫码一键创建应用」，或手动填写 App ID 和 App Secret" };
    }
    const domain = (payload.domain ?? store.feishu?.domain ?? "open.feishu.cn")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "") || "open.feishu.cn";
    if (domain !== "open.feishu.cn" && domain !== "open.larksuite.com") {
      return { ok: false, error: "飞书域名仅支持 open.feishu.cn 或 open.larksuite.com" };
    }
    store.feishu = {
      ...(store.feishu ?? {}),
      mode,
      appId,
      appSecret,
      docTokens: (payload.docTokens ?? store.feishu?.docTokens ?? "").trim(),
      domain,
      cliProfile: (payload.cliProfile ?? store.feishu?.cliProfile ?? "").trim(),
      searchQuery: (payload.searchQuery ?? store.feishu?.searchQuery ?? "").trim(),
      maxItems: Math.min(60, Math.max(1, Number(payload.maxItems) || store.feishu?.maxItems || 20)),
    };
  } else if (id === "yuque") {
    const token = (payload.token ?? "").trim() || store.yuque?.token || "";
    if (!token) {
      return { ok: false, error: "请填写语雀 API Token（超级会员可在 yuque.com/settings/tokens 创建；免费用户推荐用剪藏或导出 MD 导入）" };
    }
    const baseUrl = normalizeYuqueBaseUrl(payload.baseUrl ?? store.yuque?.baseUrl);
    if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(baseUrl)) {
      return { ok: false, error: "语雀 API 地址或团队空间域名必须为 https://" };
    }
    store.yuque = {
      ...(store.yuque ?? {}),
      token,
      namespace: (payload.namespace ?? "").trim(),
      keyword: (payload.keyword ?? "").trim(),
      includeNotes: payload.includeNotes !== "false",
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
  } else if (id === "youdao") {
    const incomingKey = (payload.apiKey ?? payload.token ?? "").trim();
    const apiKey = incomingKey || store.youdao?.apiKey || "";
    if (!apiKey) {
      return { ok: false, error: "请先填写有道云笔记 API Key（在 mopen.163.com「API 管理」免费创建）" };
    }
    const sseUrl = (payload.sseUrl ?? store.youdao?.sseUrl ?? MCP_ENDPOINTS.youdao).trim() || MCP_ENDPOINTS.youdao;
    if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(sseUrl)) {
      return { ok: false, error: "有道云笔记 MCP SSE 地址必须为 https://" };
    }
    store.youdao = {
      ...(store.youdao ?? {}),
      apiKey,
      folderId: (payload.folderId ?? "").trim(),
      keyword: (payload.keyword ?? "").trim(),
      maxItems: Math.min(100, Math.max(1, Number(payload.maxItems) || 30)),
      sseUrl,
    };
  } else if (id === "tencent_docs") {
    const incomingToken = normalizeTencentDocsToken(payload.token ?? "");
    const token = incomingToken || store.tencent_docs?.token || "";
    if (!token) {
      return { ok: false, error: "请先填写腾讯文档个人 MCP Token（访问 docs.qq.com/open/auth/mcp.html 免费领取）" };
    }
    const mcpUrl = normalizeTencentDocsMcpUrl(payload.mcpUrl ?? store.tencent_docs?.mcpUrl);
    if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(mcpUrl)) {
      return { ok: false, error: "腾讯文档 MCP 服务地址必须为 https://" };
    }
    const scope: TencentDocsScope =
      payload.scope === "space" || payload.scope === "drive" ? payload.scope : "all";
    store.tencent_docs = {
      ...(store.tencent_docs ?? {}),
      token,
      scope,
      parentId: (payload.parentId ?? "").trim(),
      keyword: (payload.keyword ?? "").trim(),
      maxItems: Math.min(80, Math.max(1, Number(payload.maxItems) || 25)),
      mcpUrl,
    };
  } else if (id === "ima") {
    const clientId = (payload.clientId ?? store.ima?.clientId ?? "").trim();
    const incomingKey = (payload.apiKey ?? payload.token ?? "").trim();
    const apiKey = incomingKey || store.ima?.apiKey || "";
    if (!clientId || !apiKey) {
      return { ok: false, error: "请先填写腾讯 ima 的 Client ID 与 API Key（在 ima.qq.com/agent-interface 扫码免费获取）" };
    }
    const baseUrl = normalizeImaBaseUrl(payload.baseUrl ?? store.ima?.baseUrl);
    if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?/i.test(baseUrl)) {
      return { ok: false, error: "腾讯 ima OpenAPI 地址必须为 https://" };
    }
    store.ima = {
      ...(store.ima ?? {}),
      clientId,
      apiKey,
      includeNotes: payload.includeNotes !== "false",
      includeWiki: payload.includeWiki !== "false",
      folderId: (payload.folderId ?? "").trim(),
      wikiId: (payload.wikiId ?? "").trim(),
      keyword: (payload.keyword ?? "").trim(),
      maxItems: Math.min(80, Math.max(1, Number(payload.maxItems) || 30)),
      baseUrl,
    };
  }

  await writeStore(store);
  return { ok: true, connectors: await getMaskedConnectors() };
}

export async function saveFeishuCredentialsFromRegistration(args: {
  appId: string;
  appSecret: string;
  domain: "open.feishu.cn" | "open.larksuite.com";
}): Promise<MaskedConnectorSummary[]> {
  const store = await readStore();
  store.feishu = {
    ...(store.feishu ?? { docTokens: "" }),
    mode: "open_api",
    appId: args.appId,
    appSecret: args.appSecret,
    domain: args.domain,
    docTokens: store.feishu?.docTokens ?? "",
    maxItems: store.feishu?.maxItems ?? 20,
  };
  await writeStore(store);
  return getMaskedConnectors();
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
    // Normalize 127.0.0.1 -> localhost for OAuth redirect_uri because Dida365's WAF rejects IP literals with 403 Forbidden
    const normalizedOrigin = args.origin.replace(/\/+$/, "");
    const callbackOrigin = normalizedOrigin.replace(/^(https?:\/\/)127\.0\.0\.1(?=[:/]|$)/i, "$1localhost");
    const redirectUri = `${callbackOrigin}/api/connectors/oauth/callback`;
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
      returnOrigin: normalizedOrigin,
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
}): Promise<{ ok: true; connectorId: McpOAuthConnectorId; discoveredCount?: number; returnOrigin?: string } | { ok: false; error: string }> {
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
      return { ok: true, connectorId: "dida365", discoveredCount, returnOrigin: session.returnOrigin };
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
    return { ok: true, connectorId: "notion", returnOrigin: session.returnOrigin };
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

/* ==================== YoudaoNote Official MCP-over-SSE Helpers ==================== */

export type YoudaoEntryRaw = {
  id: string;
  name: string;
  isDir: boolean;
  parentId?: string;
  eventDate?: string;
  folderName?: string;
};

export function cleanYoudaoNoteTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\.(?:note|md|markdown)$/i, "").trim() || trimmed;
}

export function parseYoudaoTimestamp(val: unknown): string {
  if (val === undefined || val === null || val === "") return "";
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    const ms = val < 10_000_000_000 ? val * 1000 : val;
    const bj = new Date(ms + 8 * 60 * 60 * 1000);
    if (!Number.isNaN(bj.getTime())) return bj.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{10,13}$/.test(s)) {
    const num = Number(s);
    const ms = s.length <= 10 ? num * 1000 : num;
    const bj = new Date(ms + 8 * 60 * 60 * 1000);
    if (!Number.isNaN(bj.getTime())) return bj.toISOString().slice(0, 10);
  }
  return toBeijingDateStr(s);
}

export function extractYoudaoEntries(data: unknown): YoudaoEntryRaw[] {
  let list = unwrapArray<Record<string, unknown>>(data, [
    "notes",
    "entries",
    "files",
    "items",
    "list",
    "records",
    "data",
    "result",
  ]);
  if (list.length === 0 && data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    for (const nestedKey of ["data", "result", "body"]) {
      const nested = obj[nestedKey];
      if (nested && typeof nested === "object") {
        list = unwrapArray<Record<string, unknown>>(nested, [
          "notes",
          "entries",
          "files",
          "items",
          "list",
          "records",
          "data",
        ]);
        if (list.length > 0) break;
      }
    }
  }

  const out: YoudaoEntryRaw[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id ?? raw.fileId ?? raw.entryId ?? raw.noteId ?? "").trim();
    const name = String(raw.name ?? raw.title ?? raw.fileName ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const typeStr = String(raw.type ?? "").toLowerCase();
    const isDir =
      raw.dir === true ||
      raw.isDir === true ||
      raw.isFolder === true ||
      typeStr === "dir" ||
      typeStr === "folder" ||
      typeStr === "directory";

    const eventDate =
      parseYoudaoTimestamp(raw.modifyTime) ||
      parseYoudaoTimestamp(raw.modifiedTime) ||
      parseYoudaoTimestamp(raw.updateTime) ||
      parseYoudaoTimestamp(raw.createTime) ||
      parseYoudaoTimestamp(raw.createdTime);

    out.push({
      id,
      name: name || id,
      isDir,
      parentId: raw.parentId ? String(raw.parentId) : undefined,
      eventDate: eventDate || undefined,
    });
  }
  return out;
}

export function extractYoudaoNoteContent(res: { text: string; json: unknown }): string {
  if (res.json && typeof res.json === "object" && !Array.isArray(res.json)) {
    const obj = res.json as Record<string, unknown>;
    for (const k of ["content", "text", "body", "markdown", "noteContent"]) {
      if (typeof obj[k] === "string" && (obj[k] as string).trim()) {
        return (obj[k] as string).trim();
      }
    }
    if (obj.data && typeof obj.data === "object") {
      const inner = obj.data as Record<string, unknown>;
      for (const k of ["content", "text", "body", "markdown"]) {
        if (typeof inner[k] === "string" && (inner[k] as string).trim()) {
          return (inner[k] as string).trim();
        }
      }
    }
    if (typeof obj.data === "string" && obj.data.trim()) {
      return obj.data.trim();
    }
  }
  if (typeof res.json === "string" && res.json.trim()) {
    return res.json.trim();
  }
  return res.text.trim();
}

function resolveYoudaoToolNames(tools: McpToolInfo[]): {
  listTool: string;
  readTool: string;
  searchTool: string;
  readParamKey: string;
} {
  const listTool =
    tools.find((t) => /^listNotes$/i.test(t.name))?.name ||
    tools.find((t) => /list.*note/i.test(t.name))?.name ||
    "listNotes";
  const readInfo =
    tools.find((t) => /^getNoteTextContent$/i.test(t.name)) ||
    tools.find((t) => /get.*note.*(?:text|content)/i.test(t.name));
  const readTool = readInfo?.name || "getNoteTextContent";
  const searchTool =
    tools.find((t) => /^searchNotes$/i.test(t.name))?.name ||
    tools.find((t) => /search.*note/i.test(t.name))?.name ||
    "searchNotes";

  let readParamKey = "fileId";
  const props = (readInfo?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (props && !("fileId" in props)) {
    if ("noteId" in props) readParamKey = "noteId";
    else if ("id" in props) readParamKey = "id";
  }

  return { listTool, readTool, searchTool, readParamKey };
}

async function listYoudaoFolderEntries(
  mcp: McpSseClient,
  listTool: string,
  parentId: string,
  maxPages = 3,
): Promise<YoudaoEntryRaw[]> {
  const all: YoudaoEntryRaw[] = [];
  const seen = new Set<string>();
  let lastId: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const args: Record<string, unknown> = { parentId };
    if (lastId) args.lastId = lastId;
    const res = await mcp.callTool(listTool, args);
    const batch = extractYoudaoEntries(res.json);
    if (batch.length === 0) break;

    let added = 0;
    for (const item of batch) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
      added++;
    }
    if (added === 0 || batch.length < 15) break;
    lastId = batch[batch.length - 1].id;
  }

  return all;
}

function formatYoudaoError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "网络或接口异常";
  if (/HTTP\s*(401|403)|authentication failed|10002/i.test(msg)) {
    return `有道云笔记 API Key 鉴权失败，请确认已复制网易开发者平台 (mopen.163.com)「API 管理」中绑定同一手机号的 API Key（原始信息：${msg.slice(0, 140)}）`;
  }
  return msg;
}

/* ==================== Yuque Official API v2 / MCP-Parity Helpers ==================== */

export function normalizeYuqueBaseUrl(raw?: string): string {
  const cleaned = (raw ?? "").trim().replace(/\/+$/, "");
  if (!cleaned) return "https://www.yuque.com/api/v2";
  if (/\/api\/v2$/i.test(cleaned)) return cleaned;
  return `${cleaned}/api/v2`;
}

export function extractYuqueNoteText(note: Record<string, unknown>): string {
  for (const k of ["body_markdown", "markdown", "body", "abstract", "description"]) {
    if (typeof note[k] === "string" && (note[k] as string).trim()) {
      const val = (note[k] as string).trim();
      // Strip HTML/Lake tags if the field returned HTML
      if (val.startsWith("<") && /<\/[a-z]+>/i.test(val)) {
        const plain = val
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, "\n\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (plain) return plain;
      }
      return val;
    }
  }
  const contentObj = note.content as Record<string, unknown> | undefined;
  if (contentObj && typeof contentObj === "object") {
    for (const k of ["abstract", "body", "markdown", "html"]) {
      if (typeof contentObj[k] === "string" && (contentObj[k] as string).trim()) {
        return (contentObj[k] as string)
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(?:p|div|li)>/gi, "\n\n")
          .replace(/<[^>]+>/g, "")
          .trim();
      }
    }
  }
  return "";
}

async function fetchYuqueUserAndRepos(
  base: string,
  headers: Record<string, string>,
): Promise<{ login: string; name: string; repos: YuqueRepoSummary[] }> {
  const userRes = await fetch(`${base}/user`, { headers, signal: AbortSignal.timeout(12000) });
  const userData = (await userRes.json().catch(() => ({}))) as {
    data?: { name?: string; login?: string };
    message?: string;
  };
  if (!userRes.ok || !userData.data?.login) {
    throw new Error(`语雀认证失败 (${userRes.status})：${userData.message ?? "Token 无效或已过期"}`);
  }
  const login = userData.data.login;
  const name = userData.data.name || login;

  const repos: YuqueRepoSummary[] = [];
  const seen = new Set<string>();
  try {
    const reposRes = await fetch(`${base}/users/${encodeURIComponent(login)}/repos?limit=100`, {
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (reposRes.ok) {
      const reposJson = (await reposRes.json()) as {
        data?: Array<{
          id?: number | string;
          namespace?: string;
          name?: string;
          description?: string;
          items_count?: number;
        }>;
      };
      for (const r of reposJson.data ?? []) {
        const ns = String(r.namespace ?? "").trim();
        if (!ns || seen.has(ns)) continue;
        seen.add(ns);
        repos.push({
          id: String(r.id ?? ns),
          namespace: ns,
          name: String(r.name ?? ns).trim(),
          description: r.description ? String(r.description).trim() : undefined,
          itemsCount: typeof r.items_count === "number" ? r.items_count : undefined,
        });
      }
    }
  } catch {
    /* non-fatal */
  }
  return { login, name, repos };
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
      if (cfg?.mode === "lark_cli") {
        const status = await detectLarkCliStatus(cfg.cliProfile);
        if (!status.installed || !status.loggedIn) {
          return { ok: false, error: status.message };
        }
        return { ok: true, message: status.message, connectors: await getMaskedConnectors() };
      }
      if (!cfg?.appId || !cfg?.appSecret) {
        return { ok: false, error: "请先扫码一键创建飞书应用，或保存 App ID 和 App Secret" };
      }
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
      const base = normalizeYuqueBaseUrl(cfg.baseUrl);
      const headers = { "X-Auth-Token": cfg.token, "User-Agent": "TradeLoom/1.0" };
      const { name, repos } = await fetchYuqueUserAndRepos(base, headers);
      cfg.discoveredRepos = repos;
      await writeStore(store);

      const preview = repos.slice(0, 6).map((r) => r.name).join("、");
      const repoHint =
        repos.length > 0
          ? `，发现 ${repos.length} 个知识库（${preview}${repos.length > 6 ? " 等" : ""}）`
          : "（未发现知识库，仍可同步「语雀小记」或手动填写知识库路径）";
      return {
        ok: true,
        message: `已连接语雀账号：${name}${repoHint}`,
        connectors: await getMaskedConnectors(),
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

    if (id === "youdao") {
      const cfg = store.youdao;
      if (!cfg?.apiKey) {
        return { ok: false, error: "请先填写并保存有道云笔记 API Key（在 mopen.163.com 获取）" };
      }
      const mcp = new McpSseClient(cfg.sseUrl || MCP_ENDPOINTS.youdao, { "x-api-key": cfg.apiKey });
      try {
        const tools = await mcp.listTools();
        const { listTool } = resolveYoudaoToolNames(tools);
        const rootEntries = await listYoudaoFolderEntries(mcp, listTool, "0", 2);
        const folders: YoudaoFolderSummary[] = [
          { id: "0", name: "根目录全部笔记", isRoot: true },
          ...rootEntries.filter((e) => e.isDir).map((e) => ({ id: e.id, name: e.name, isRoot: false })),
        ];
        const rootNotes = rootEntries.filter((e) => !e.isDir);
        cfg.discoveredFolders = folders;
        await writeStore(store);

        const realFolders = folders.filter((f) => !f.isRoot);
        const preview = realFolders.slice(0, 6).map((f) => f.name).join("、");
        const folderHint =
          realFolders.length > 0
            ? `，发现 ${realFolders.length} 个顶层文件夹（${preview}${realFolders.length > 6 ? " 等" : ""}）与 ${rootNotes.length} 篇根目录笔记`
            : `，发现 ${rootNotes.length} 篇根目录笔记`;

        return {
          ok: true,
          message: `已通过官方 MCP (SSE) 连接有道云笔记（就绪 ${tools.length} 个工具${folderHint}）`,
          connectors: await getMaskedConnectors(),
        };
      } catch (err) {
        return { ok: false, error: formatYoudaoError(err) };
      } finally {
        mcp.close();
      }
    }

    if (id === "tencent_docs") {
      const cfg = store.tencent_docs;
      if (!cfg?.token) {
        return { ok: false, error: "尚未配置腾讯文档 MCP Token（访问 docs.qq.com/open/auth/mcp.html 免费获取）" };
      }
      try {
        const client = createTencentDocsClient(cfg.token, cfg.mcpUrl);
        const tools = await client.listTools();
        const { folders, sampleDocCount } = await discoverTencentDocsStructure(client, tools);
        cfg.discoveredFolders = folders;
        await writeStore(store);

        const realFolders = folders.filter((f) => !f.isRoot);
        const preview = realFolders.slice(0, 5).map((f) => f.name).join("、");
        const hint =
          realFolders.length > 0
            ? `，发现 ${realFolders.length} 个空间/目录（${preview}${realFolders.length > 5 ? " 等" : ""}）`
            : sampleDocCount > 0
              ? `，根目录发现 ${sampleDocCount} 篇可读文档`
              : "";
        return {
          ok: true,
          message: `已通过官方远程 MCP 连接腾讯文档（就绪 ${tools.length} 个工具${hint}）`,
          connectors: await getMaskedConnectors(),
        };
      } catch (err) {
        return { ok: false, error: formatTencentDocsError(err) };
      }
    }

    if (id === "ima") {
      const cfg = store.ima;
      if (!cfg?.clientId || !cfg?.apiKey) {
        return { ok: false, error: "尚未配置腾讯 ima Client ID / API Key（在 ima.qq.com/agent-interface 扫码免费获取）" };
      }
      try {
        const { folders, repos } = await discoverImaWorkspace(cfg.clientId, cfg.apiKey, cfg.baseUrl);
        cfg.discoveredFolders = folders;
        cfg.discoveredRepos = repos;
        await writeStore(store);

        const folderNames = folders.slice(0, 4).map((f) => f.name).join("、");
        const repoNames = repos.slice(0, 4).map((r) => r.name).join("、");
        const parts: string[] = [];
        parts.push(
          folders.length > 0
            ? `${folders.length} 个笔记本（${folderNames}${folders.length > 4 ? " 等" : ""}）`
            : "0 个自定义笔记本（可同步全部笔记）",
        );
        parts.push(
          repos.length > 0
            ? `${repos.length} 个知识库（${repoNames}${repos.length > 4 ? " 等" : ""}）`
            : "0 个知识库",
        );
        return {
          ok: true,
          message: `已通过官方 OpenAPI 连接腾讯 ima：发现 ${parts.join("，")}`,
          connectors: await getMaskedConnectors(),
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "连接腾讯 ima 失败" };
      }
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
  let extraNotice = "";

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
      if (cfg?.mode === "lark_cli") {
        const cliStatus = await detectLarkCliStatus(cfg.cliProfile);
        if (!cliStatus.installed || !cliStatus.loggedIn) {
          return { ok: false, error: cliStatus.message };
        }

        const rawTokens = (cfg.docTokens ?? "")
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const limit = Math.min(60, Math.max(1, cfg.maxItems || 20));

        const targets: Array<{ target: string; title?: string; url?: string; eventDate?: string }> = [];
        if (rawTokens.length > 0) {
          for (const entry of rawTokens.slice(0, limit)) {
            targets.push({
              target: entry,
              url: entry.startsWith("http") ? entry : undefined,
            });
          }
        } else {
          const searchRes = await searchLarkCliDocs({
            query: cfg.searchQuery ?? "",
            maxItems: limit,
            profile: cfg.cliProfile,
          });
          if (!searchRes.ok) {
            return { ok: false, error: `lark-cli 搜索个人云文档失败：${searchRes.error}` };
          }
          for (const hit of searchRes.docs.slice(0, limit)) {
            targets.push({
              target: hit.url || hit.token,
              title: hit.title,
              url: hit.url,
              eventDate: hit.editTime ? toBeijingDateStr(hit.editTime) : undefined,
            });
          }
        }

        for (const item of targets) {
          const fetched = await fetchLarkCliDocMarkdown(item.target, cfg.cliProfile);
          if (!fetched.ok || !fetched.markdown) continue;
          const title = fetched.title || item.title || `飞书复盘_${item.target.slice(-8)}`;
          const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(`${title}\n${fetched.markdown.slice(0, 400)}`);
          const saved = await importPastedReview(
            {
              title,
              content: fetched.markdown,
              eventDate: item.eventDate || (dateMatch ? dateMatch[1] : undefined),
              sourcePlatform: "飞书文档 (lark-cli)",
              sourceUrl: item.url,
              folder: "_云端_飞书",
            },
            { skipRebuild: true },
          );
          if (saved.ok) synced++;
        }
      } else {
      if (!cfg?.appId || !cfg?.appSecret) return { ok: false, error: "请先扫码一键创建飞书应用，或保存飞书 App ID / Secret" };
      const rawTokens = cfg.docTokens
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (rawTokens.length === 0) {
        return { ok: false, error: "Open API 模式请填写飞书文档/知识库链接；如需自动搜索个人全部文档，请切换为「本机 lark-cli 直连」模式" };
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
      }
    } else if (id === "yuque") {
      const cfg = store.yuque;
      if (!cfg?.token) return { ok: false, error: "请先保存语雀配置" };
      const base = normalizeYuqueBaseUrl(cfg.baseUrl);
      const siteOrigin = base.replace(/\/api\/v2$/i, "");
      const headers = { "X-Auth-Token": cfg.token, "User-Agent": "TradeLoom/1.0" };
      const limit = Math.min(100, Math.max(1, cfg.maxItems || 30));
      const keyword = (cfg.keyword ?? "").trim();
      const includeNotes = cfg.includeNotes !== false;

      const { repos: discoveredRepos } = await fetchYuqueUserAndRepos(base, headers);
      cfg.discoveredRepos = discoveredRepos;

      const seenDocKeys = new Set<string>();
      const importYuqueDoc = async (
        repoNamespace: string,
        repoLabel: string,
        slugOrId: string,
        fallbackTitle: string,
        fallbackDate?: string,
        numericDocId?: number,
      ) => {
        const key = `${repoNamespace}/${slugOrId}`;
        if (seenDocKeys.has(key) || synced >= limit) return;
        seenDocKeys.add(key);

        let title = fallbackTitle;
        let md = "";
        let eventDate = fallbackDate || "";
        let slug = slugOrId;

        const detailRes = await fetch(
          `${base}/repos/${repoNamespace}/docs/${encodeURIComponent(slugOrId)}`,
          { headers, signal: AbortSignal.timeout(15000) },
        );
        if (detailRes.ok) {
          const detailData = (await detailRes.json()) as {
            data?: { id?: number; slug?: string; title?: string; body?: string; created_at?: string; updated_at?: string };
          };
          if (detailData.data) {
            title = detailData.data.title || title;
            md = (detailData.data.body ?? "").trim();
            slug = detailData.data.slug || slug;
            eventDate = toBeijingDateStr(detailData.data.updated_at || detailData.data.created_at) || eventDate;
            if (!md && detailData.data.id) numericDocId = detailData.data.id;
          }
        }

        // YFM reader fallback (same endpoint as official yuque-mcp-server getYmdDoc)
        if (!md && numericDocId) {
          try {
            const yfmRes = await fetch(`${base}/yfm/docs?doc_id=${numericDocId}`, {
              headers,
              signal: AbortSignal.timeout(12000),
            });
            if (yfmRes.ok) {
              const yfmJson = (await yfmRes.json()) as { data?: { yfm?: string; markdown?: string; body?: string } };
              md = (yfmJson.data?.yfm || yfmJson.data?.markdown || yfmJson.data?.body || "").trim();
            }
          } catch {
            /* ignore */
          }
        }

        if (!md) return;
        const saved = await importPastedReview(
          {
            title: title || `语雀复盘_${slug}`,
            content: md,
            eventDate: eventDate || undefined,
            sourcePlatform: repoLabel ? `语雀 · ${repoLabel}` : "语雀",
            sourceUrl: `${siteOrigin}/${repoNamespace}/${slug}`,
            tags: repoLabel ? [repoLabel, "语雀"] : ["语雀"],
            folder: "_云端_语雀",
          },
          { skipRebuild: true },
        );
        if (saved.ok) synced++;
      };

      if (keyword) {
        for (let page = 1; page <= 4 && synced < limit; page++) {
          const searchRes = await fetch(
            `${base}/search?q=${encodeURIComponent(keyword)}&type=doc&page=${page}`,
            { headers, signal: AbortSignal.timeout(15000) },
          );
          if (!searchRes.ok) break;
          const searchJson = (await searchRes.json()) as {
            data?: Array<{
              id?: number;
              title?: string;
              url?: string;
              target?: { id?: number; slug?: string; title?: string; updated_at?: string; book?: { namespace?: string; name?: string } };
            }>;
          };
          const hits = Array.isArray(searchJson.data) ? searchJson.data : [];
          if (hits.length === 0) break;
          for (const hit of hits) {
            if (synced >= limit) break;
            const ns = hit.target?.book?.namespace || "";
            const slug = hit.target?.slug || "";
            if (!ns || !slug) continue;
            await importYuqueDoc(
              ns,
              hit.target?.book?.name || ns,
              slug,
              (hit.target?.title || hit.title || "").replace(/<\/?em>/gi, ""),
              toBeijingDateStr(hit.target?.updated_at),
              hit.target?.id || hit.id,
            );
          }
          if (hits.length < 20) break;
        }
      } else {
        const selectedTokens = (cfg.namespace ?? "")
          .split(/[\n,;，；]+/)
          .map((s) => s.trim())
          .filter(Boolean);

        let targetRepos: YuqueRepoSummary[] = [];
        if (selectedTokens.length > 0) {
          const tokenSet = new Set(selectedTokens.map((s) => s.toLowerCase()));
          targetRepos = discoveredRepos.filter(
            (r) => tokenSet.has(r.namespace.toLowerCase()) || tokenSet.has(r.name.toLowerCase()),
          );
          for (const tok of selectedTokens) {
            if (tok.includes("/") && !targetRepos.some((r) => r.namespace.toLowerCase() === tok.toLowerCase())) {
              targetRepos.push({ id: tok, namespace: tok, name: tok });
            }
          }
        } else {
          targetRepos = discoveredRepos.slice(0, 8);
        }

        for (const repo of targetRepos) {
          if (synced >= limit) break;
          const docsRes = await fetch(
            `${base}/repos/${repo.namespace}/docs?limit=${Math.min(100, limit)}`,
            { headers, signal: AbortSignal.timeout(15000) },
          );
          if (!docsRes.ok) continue;
          const docsData = (await docsRes.json()) as {
            data?: Array<{ id?: number; slug: string; title: string; created_at?: string; updated_at?: string }>;
          };
          for (const doc of docsData.data ?? []) {
            if (synced >= limit) break;
            await importYuqueDoc(
              repo.namespace,
              repo.name,
              doc.slug,
              doc.title,
              toBeijingDateStr(doc.updated_at || doc.created_at),
              doc.id,
            );
          }
        }
      }

      // Sync Yuque Notes (语雀小记) via GET /notes (official yuque-mcp-server route)
      if (includeNotes && synced < limit) {
        try {
          const notesRes = await fetch(`${base}/notes?page=1&limit=${Math.min(30, limit - synced)}`, {
            headers,
            signal: AbortSignal.timeout(15000),
          });
          if (notesRes.ok) {
            const notesJson = (await notesRes.json()) as {
              data?: { notes?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
            };
            const noteList = Array.isArray(notesJson.data)
              ? notesJson.data
              : Array.isArray(notesJson.data?.notes)
                ? notesJson.data.notes
                : [];
            for (const note of noteList) {
              if (synced >= limit) break;
              const noteId = note.id ? Number(note.id) : 0;
              let body = extractYuqueNoteText(note);
              if (!body && noteId) {
                try {
                  const detailRes = await fetch(`${base}/notes/${noteId}`, {
                    headers,
                    signal: AbortSignal.timeout(12000),
                  });
                  if (detailRes.ok) {
                    const detailJson = (await detailRes.json()) as { data?: Record<string, unknown> };
                    if (detailJson.data) body = extractYuqueNoteText(detailJson.data);
                  }
                } catch {
                  /* ignore */
                }
              }
              if (!body) continue;
              const eventDate = toBeijingDateStr(
                String(note.updated_at ?? note.published_at ?? note.created_at ?? ""),
              );
              const firstLine = body.split(/\r?\n/)[0]?.replace(/^#+\s*/, "").trim().slice(0, 36);
              const title = firstLine || `语雀小记_${eventDate || noteId || synced + 1}`;
              const saved = await importPastedReview(
                {
                  title,
                  content: body,
                  eventDate: eventDate || undefined,
                  sourcePlatform: "语雀 · 小记",
                  sourceUrl: `${siteOrigin}/dashboard/notes`,
                  tags: ["语雀小记", "语雀"],
                  folder: "_云端_语雀",
                },
                { skipRebuild: true },
              );
              if (saved.ok) synced++;
            }
          }
        } catch {
          /* non-fatal if account/plan does not expose /notes */
        }
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
    } else if (id === "youdao") {
      const cfg = store.youdao;
      if (!cfg?.apiKey) {
        return { ok: false, error: "请先填写并保存有道云笔记 API Key（在 mopen.163.com 获取）" };
      }

      const limit = Math.min(100, Math.max(1, cfg.maxItems || 30));
      const mcp = new McpSseClient(cfg.sseUrl || MCP_ENDPOINTS.youdao, { "x-api-key": cfg.apiKey });

      try {
        const tools = await mcp.listTools();
        const { listTool, readTool, searchTool, readParamKey } = resolveYoudaoToolNames(tools);

        const candidateNotes: YoudaoEntryRaw[] = [];
        const seenIds = new Set<string>();
        const pushNote = (entry: YoudaoEntryRaw, folderName?: string) => {
          if (entry.isDir || seenIds.has(entry.id) || candidateNotes.length >= limit) return;
          seenIds.add(entry.id);
          candidateNotes.push({ ...entry, folderName: folderName || entry.folderName });
        };

        const keyword = (cfg.keyword ?? "").trim();
        if (keyword) {
          for (let startIndex = 0; candidateNotes.length < limit && startIndex < 150; startIndex += 15) {
            const searchRes = await mcp.callTool(searchTool, { keyword, startIndex });
            const batch = extractYoudaoEntries(searchRes.json);
            if (batch.length === 0) break;
            let added = 0;
            for (const item of batch) {
              if (!item.isDir && !seenIds.has(item.id)) {
                pushNote(item, `搜索:${keyword}`);
                added++;
              }
            }
            if (added === 0 || batch.length < 15) break;
          }
        } else {
          const rootEntries = await listYoudaoFolderEntries(mcp, listTool, "0", 2);
          const folders: YoudaoFolderSummary[] = [
            { id: "0", name: "根目录全部笔记", isRoot: true },
            ...rootEntries.filter((e) => e.isDir).map((e) => ({ id: e.id, name: e.name, isRoot: false })),
          ];
          cfg.discoveredFolders = folders;

          const selectedTokens = (cfg.folderId ?? "")
            .split(/[\n,;，；]+/)
            .map((s) => s.trim())
            .filter(Boolean);

          if (selectedTokens.length > 0) {
            const tokenSet = new Set(selectedTokens.map((s) => s.toLowerCase()));
            const matchedFolders = folders.filter(
              (f) =>
                tokenSet.has(f.id.toLowerCase()) ||
                tokenSet.has(f.name.toLowerCase()) ||
                (f.isRoot && (tokenSet.has("0") || tokenSet.has("根目录") || tokenSet.has("root"))),
            );
            // Also allow raw folder IDs not in top-level root
            const matchedIds = new Set(matchedFolders.map((f) => f.id));
            for (const tok of selectedTokens) {
              if (!matchedFolders.some((f) => f.id.toLowerCase() === tok.toLowerCase() || f.name.toLowerCase() === tok.toLowerCase())) {
                if (!matchedIds.has(tok)) {
                  matchedFolders.push({ id: tok, name: tok, isRoot: tok === "0" });
                  matchedIds.add(tok);
                }
              }
            }

            for (const folder of matchedFolders) {
              if (candidateNotes.length >= limit) break;
              const entries =
                folder.id === "0"
                  ? rootEntries
                  : await listYoudaoFolderEntries(mcp, listTool, folder.id, 3);
              for (const entry of entries) {
                if (candidateNotes.length >= limit) break;
                if (!entry.isDir) {
                  pushNote(entry, folder.isRoot ? "根目录" : folder.name);
                } else if (!folder.isRoot) {
                  // Depth-2 subfolder scan for selected folder
                  const subEntries = await listYoudaoFolderEntries(mcp, listTool, entry.id, 2);
                  for (const sub of subEntries) {
                    if (candidateNotes.length >= limit) break;
                    if (!sub.isDir) pushNote(sub, `${folder.name}/${entry.name}`);
                  }
                }
              }
            }
          } else {
            // Blank folder filter: sync root notes + top 10 folders (depth 1) up to maxItems
            for (const entry of rootEntries) {
              if (candidateNotes.length >= limit) break;
              if (!entry.isDir) pushNote(entry, "根目录");
            }
            const topFolders = rootEntries.filter((e) => e.isDir).slice(0, 10);
            for (const folder of topFolders) {
              if (candidateNotes.length >= limit) break;
              const entries = await listYoudaoFolderEntries(mcp, listTool, folder.id, 2);
              for (const entry of entries) {
                if (candidateNotes.length >= limit) break;
                if (!entry.isDir) pushNote(entry, folder.name);
              }
            }
          }
        }

        for (const note of candidateNotes) {
          try {
            const detailRes = await mcp.callTool(readTool, { [readParamKey]: note.id });
            const body = extractYoudaoNoteContent(detailRes);
            if (!body) continue;

            const title = cleanYoudaoNoteTitle(note.name) || `有道复盘_${note.id.slice(0, 8)}`;
            const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(`${title}\n${body.slice(0, 400)}`);
            const eventDate = note.eventDate || (dateMatch ? dateMatch[1] : undefined);
            const tagList = note.folderName ? [note.folderName, "有道云笔记"] : ["有道云笔记"];

            const saved = await importPastedReview(
              {
                title,
                content: body,
                eventDate,
                sourcePlatform: note.folderName ? `有道云笔记 · ${note.folderName}` : "有道云笔记",
                tags: Array.from(new Set(tagList)),
                folder: "_云端_有道云笔记",
              },
              { skipRebuild: true },
            );
            if (saved.ok) synced++;
          } catch {
            /* skip unreadable note and continue */
          }
        }
      } catch (err) {
        return { ok: false, error: `同步失败：${formatYoudaoError(err)}` };
      } finally {
        mcp.close();
      }
    } else if (id === "tencent_docs") {
      const cfg = store.tencent_docs;
      if (!cfg?.token) {
        return { ok: false, error: "尚未配置腾讯文档 MCP Token（访问 docs.qq.com/open/auth/mcp.html 免费领取）" };
      }
      try {
        const client = createTencentDocsClient(cfg.token, cfg.mcpUrl);
        const tools = await client.listTools();
        const docs = await fetchTencentDocsItems(client, tools, {
          scope: cfg.scope ?? "all",
          parentId: cfg.parentId,
          keyword: cfg.keyword,
          maxItems: cfg.maxItems ?? 25,
        });

        for (const doc of docs) {
          const tags = Array.from(
            new Set([
              "腾讯文档",
              ...(doc.docType ? [doc.docType] : []),
              ...(doc.folderName ? [doc.folderName.split("/")[0]] : []),
            ]),
          );
          const saved = await importPastedReview(
            {
              title: doc.title,
              content: doc.content,
              eventDate: doc.eventDate,
              sourceUrl: doc.url,
              sourcePlatform: doc.folderName ? `腾讯文档 · ${doc.folderName}` : "腾讯文档",
              tags,
              folder: "_云端_腾讯文档",
            },
            { skipRebuild: true },
          );
          if (saved.ok) synced++;
        }
      } catch (err) {
        return { ok: false, error: `同步失败：${formatTencentDocsError(err)}` };
      }
    } else if (id === "ima") {
      const cfg = store.ima;
      if (!cfg?.clientId || !cfg?.apiKey) {
        return { ok: false, error: "尚未配置腾讯 ima Client ID / API Key" };
      }
      const includeNotes = cfg.includeNotes !== false;
      const includeWiki = cfg.includeWiki !== false;
      if (!includeNotes && !includeWiki) {
        return { ok: false, error: "请至少勾选「同步笔记本」或「同步知识库」中的一项" };
      }
      try {
        const { items, warnings } = await fetchImaItems(cfg.clientId, cfg.apiKey, {
          baseUrl: cfg.baseUrl,
          includeNotes,
          includeWiki,
          folderId: cfg.folderId,
          wikiId: cfg.wikiId,
          keyword: cfg.keyword,
          maxItems: cfg.maxItems ?? 30,
          discoveredFolders: cfg.discoveredFolders,
          discoveredRepos: cfg.discoveredRepos,
        });

        for (const item of items) {
          const saved = await importPastedReview(
            {
              title: item.title,
              content: item.content,
              eventDate: item.eventDate,
              sourceUrl: item.sourceUrl,
              sourcePlatform: item.sourceLabel,
              tags: item.tags,
              folder: "_云端_腾讯ima",
            },
            { skipRebuild: true },
          );
          if (saved.ok) synced++;
        }
        if (warnings.length > 0) {
          extraNotice = `（${warnings.join("；")}）`;
        }
      } catch (err) {
        return { ok: false, error: `同步失败：${err instanceof Error ? err.message : "腾讯 ima 接口异常"}` };
      }
    }

    const index = await rebuildVault();
    const skipNote = skippedWelcome > 0 ? `（已自动跳过 ${skippedWelcome} 条官方新手教程）` : "";
    const message =
      synced > 0
        ? `成功拉取 ${synced} 篇云端复盘并重建 Obsidian 双链图谱${skipNote}${extraNotice}`
        : `连接正常，但未拉取到个人复盘正文${skipNote}${extraNotice}（请核对是否授权对了主号，或在目录/知识库列表中勾选目标范围）`;

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
