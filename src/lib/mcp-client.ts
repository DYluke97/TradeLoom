import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ensureWorkspace, fileExists, getWorkspacePaths, writeAtomic } from "./workspace";

export type McpOAuthConnectorId = "dida365" | "notion";

export const MCP_ENDPOINTS = {
  dida365_cn: "https://mcp.dida365.com",
  dida365_global: "https://mcp.ticktick.com",
  notion: "https://mcp.notion.com/mcp",
} as const;

export type OAuthDiscovery = {
  mcpUrl: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  scopesSupported: string[];
  grantTypesSupported: string[];
};

export type PendingOAuthSession = {
  state: string;
  connectorId: McpOAuthConnectorId;
  mcpUrl: string;
  region?: "cn" | "global";
  redirectUri: string;
  returnOrigin?: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  createdAt: number;
};

export type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string; state: string } {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const state = base64Url(randomBytes(18));
  return { codeVerifier, codeChallenge, state };
}

export function resolveMcpUrl(id: McpOAuthConnectorId, region?: string): string {
  if (id === "notion") return MCP_ENDPOINTS.notion;
  return region === "global" ? MCP_ENDPOINTS.dida365_global : MCP_ENDPOINTS.dida365_cn;
}

export async function discoverMcpOAuth(mcpUrl: string): Promise<OAuthDiscovery> {
  const parsed = new URL(mcpUrl);
  const origin = parsed.origin;
  const pathname = parsed.pathname.replace(/\/+$/, "");

  // Step 1: Protected Resource Metadata (RFC 9728)
  const prCandidates = [
    ...(pathname ? [`${origin}/.well-known/oauth-protected-resource${pathname}`] : []),
    `${origin}/.well-known/oauth-protected-resource`,
  ];

  let resource = mcpUrl;
  let authServerOrigin = origin;
  let scopesSupported: string[] = [];

  for (const url of prCandidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        resource?: string;
        authorization_servers?: string[];
        scopes_supported?: string[];
      };
      if (json.resource) resource = json.resource;
      if (Array.isArray(json.scopes_supported)) scopesSupported = json.scopes_supported;
      if (Array.isArray(json.authorization_servers) && json.authorization_servers[0]) {
        // Keep origin of MCP if auth server itself hosts metadata on MCP origin (Dida365 hosts .well-known on mcp.dida365.com)
        authServerOrigin = new URL(json.authorization_servers[0]).origin;
      }
      break;
    } catch {
      /* try next */
    }
  }

  // Step 2: Authorization Server Metadata (RFC 8414)
  const asCandidates = Array.from(
    new Set([
      `${origin}/.well-known/oauth-authorization-server`,
      `${authServerOrigin}/.well-known/oauth-authorization-server`,
    ]),
  );

  for (const url of asCandidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const meta = (await res.json()) as {
        authorization_endpoint?: string;
        token_endpoint?: string;
        registration_endpoint?: string;
        scopes_supported?: string[];
        grant_types_supported?: string[];
      };
      if (meta.authorization_endpoint && meta.token_endpoint && meta.registration_endpoint) {
        return {
          mcpUrl,
          resource,
          authorizationEndpoint: meta.authorization_endpoint,
          tokenEndpoint: meta.token_endpoint,
          registrationEndpoint: meta.registration_endpoint,
          scopesSupported:
            scopesSupported.length > 0
              ? scopesSupported
              : Array.isArray(meta.scopes_supported)
                ? meta.scopes_supported
                : [],
          grantTypesSupported: Array.isArray(meta.grant_types_supported)
            ? meta.grant_types_supported
            : ["authorization_code"],
        };
      }
    } catch {
      /* try next */
    }
  }

  throw new Error(`无法获取 ${mcpUrl} 的 MCP OAuth 元数据`);
}

export async function registerDynamicOAuthClient(args: {
  registrationEndpoint: string;
  redirectUri: string;
  returnOrigin?: string;
  grantTypesSupported: string[];
}): Promise<{ clientId: string; clientSecret?: string }> {
  const grantTypes = ["authorization_code"];
  if (args.grantTypesSupported.includes("refresh_token")) {
    grantTypes.push("refresh_token");
  }

  const res = await fetch(args.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "TradeLoom Local",
      redirect_uris: [args.redirectUri],
      grant_types: grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    signal: AbortSignal.timeout(10000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP OAuth 客户端注册失败 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  const json = JSON.parse(text) as { client_id?: string; client_secret?: string };
  if (!json.client_id) {
    throw new Error("MCP OAuth 动态注册未返回 client_id");
  }
  return { clientId: json.client_id, clientSecret: json.client_secret };
}

function getPendingFilePath(): string {
  return path.join(getWorkspacePaths().root, ".oauth_pending.json");
}

export async function savePendingOAuthSession(session: PendingOAuthSession): Promise<void> {
  await ensureWorkspace();
  const file = getPendingFilePath();
  let sessions: PendingOAuthSession[] = [];
  if (await fileExists(file)) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as PendingOAuthSession[];
      if (Array.isArray(parsed)) sessions = parsed;
    } catch {
      sessions = [];
    }
  }
  const now = Date.now();
  // Prune sessions older than 15 minutes
  sessions = sessions.filter((s) => now - s.createdAt < 15 * 60 * 1000 && s.state !== session.state);
  sessions.push(session);
  await writeAtomic(file, JSON.stringify(sessions, null, 2));
}

export async function consumePendingOAuthSession(state: string): Promise<PendingOAuthSession | null> {
  const file = getPendingFilePath();
  if (!(await fileExists(file))) return null;
  let sessions: PendingOAuthSession[] = [];
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as PendingOAuthSession[];
    if (Array.isArray(parsed)) sessions = parsed;
  } catch {
    return null;
  }
  const now = Date.now();
  const match = sessions.find((s) => s.state === state && now - s.createdAt < 15 * 60 * 1000) ?? null;
  const remaining = sessions.filter((s) => s.state !== state && now - s.createdAt < 15 * 60 * 1000);
  await writeAtomic(file, JSON.stringify(remaining, null, 2));
  return match;
}

export async function exchangeOAuthCode(args: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  returnOrigin?: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
}): Promise<OAuthTokenResponse> {
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", args.code);
  form.set("redirect_uri", args.redirectUri);
  form.set("code_verifier", args.codeVerifier);
  form.set("client_id", args.clientId);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (args.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${args.clientId}:${args.clientSecret}`).toString("base64")}`;
  }

  const res = await fetch(args.tokenEndpoint, {
    method: "POST",
    headers,
    body: form.toString(),
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`换取 OAuth Token 失败 (HTTP ${res.status}): ${text.slice(0, 240)}`);
  }
  const json = JSON.parse(text) as OAuthTokenResponse;
  if (!json.access_token) {
    throw new Error("OAuth 令牌接口未返回 access_token");
  }
  return json;
}

export async function refreshOAuthToken(args: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<OAuthTokenResponse> {
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", args.refreshToken);
  form.set("client_id", args.clientId);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (args.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${args.clientId}:${args.clientSecret}`).toString("base64")}`;
  }

  const res = await fetch(args.tokenEndpoint, {
    method: "POST",
    headers,
    body: form.toString(),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`刷新 OAuth Token 失败 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text) as OAuthTokenResponse;
  if (!json.access_token) {
    throw new Error("刷新令牌未返回 access_token");
  }
  return json;
}

/* ==================== Streamable HTTP MCP JSON-RPC 2.0 Client ==================== */

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export function parseStreamableHttpBody(raw: string, contentType: string, expectedId?: number): JsonRpcMessage {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (contentType.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const messages: JsonRpcMessage[] = [];
    let dataLines: string[] = [];

    const flush = () => {
      if (dataLines.length === 0) return;
      const joined = dataLines.join("\n").trim();
      dataLines = [];
      if (!joined || joined === "[DONE]") return;
      try {
        messages.push(JSON.parse(joined) as JsonRpcMessage);
      } catch {
        /* skip non-json SSE comment/chunk */
      }
    };

    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      } else if (line.trim() === "") {
        flush();
      }
    }
    flush();

    if (expectedId !== undefined) {
      const exact = messages.find((m) => m.id === expectedId);
      if (exact) return exact;
    }
    return messages[messages.length - 1] ?? {};
  }

  return JSON.parse(trimmed) as JsonRpcMessage;
}

export class McpHttpClient {
  private readonly mcpUrl: string;
  private readonly accessToken: string;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(mcpUrl: string, accessToken: string) {
    this.mcpUrl = mcpUrl;
    this.accessToken = accessToken;
  }

  private async postJsonRpc(
    method: string,
    params?: Record<string, unknown>,
    isNotification = false,
  ): Promise<unknown> {
    const id = isNotification ? undefined : this.nextId++;
    const payload = isNotification
      ? { jsonrpc: "2.0", method, ...(params ? { params } : {}) }
      : { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.accessToken}`,
      "MCP-Protocol-Version": "2025-03-26",
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const res = await fetch(this.mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (isNotification && (res.status === 202 || res.status === 204 || res.status === 200)) {
      return null;
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`MCP 请求 ${method} 失败 (HTTP ${res.status}): ${raw.slice(0, 240)}`);
    }

    if (!raw.trim()) return null;
    const msg = parseStreamableHttpBody(raw, res.headers.get("content-type") || "", id);
    if (msg.error) {
      throw new Error(`MCP 错误 (${msg.error.code ?? -1}): ${msg.error.message ?? "未知错误"}`);
    }
    return msg.result;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.postJsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "TradeLoom", version: "0.7.0" },
    });
    this.initialized = true;
    try {
      await this.postJsonRpc("notifications/initialized", undefined, true);
    } catch {
      /* some servers omit notification ack */
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialize();
    const result = (await this.postJsonRpc("tools/list", {})) as { tools?: McpToolInfo[] } | null;
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; json: unknown }> {
    await this.initialize();
    const result = (await this.postJsonRpc("tools/call", { name, arguments: args })) as {
      isError?: boolean;
      content?: Array<{ type?: string; text?: string }>;
      structuredContent?: unknown;
    } | null;

    const textParts = (result?.content ?? [])
      .filter((c) => c && typeof c.text === "string")
      .map((c) => c.text as string);
    const text = textParts.join("\n").trim();

    if (result?.isError) {
      throw new Error(`MCP 工具 ${name} 执行失败：${text.slice(0, 240) || "未知错误"}`);
    }

    if (result?.structuredContent !== undefined) {
      return { text, json: result.structuredContent };
    }

    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Sometimes MCP tools wrap JSON inside markdown fenced blocks
        const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
        if (fence) {
          try {
            parsed = JSON.parse(fence[1].trim());
          } catch {
            parsed = null;
          }
        }
      }
    }
    return { text, json: parsed };
  }
}