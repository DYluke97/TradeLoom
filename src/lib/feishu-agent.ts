import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { ensureWorkspace, fileExists, getWorkspacePaths, writeAtomic } from "./workspace";

const execFileAsync = promisify(execFile);

/* ==================== Part 1: Feishu One-Click App Registration (RFC 8628) ==================== */

export const FEISHU_REGISTRATION_DOMAINS = {
  feishu: "https://accounts.feishu.cn",
  lark: "https://accounts.larksuite.com",
} as const;

const REGISTRATION_ENDPOINT = "/oauth/v1/app/registration";

export type FeishuAppAddons = {
  preset?: boolean;
  scopes?: {
    tenant?: string[];
    user?: string[];
  };
};

export const TRADELOOM_FEISHU_ADDONS: FeishuAppAddons = {
  preset: false,
  scopes: {
    tenant: [
      "docx:document:readonly",
      "wiki:node:read",
      "drive:drive.metadata:readonly",
      "search:docs:read",
    ],
    user: [
      "offline_access",
      "docx:document:readonly",
      "wiki:node:read",
      "drive:drive.metadata:readonly",
      "search:docs:read",
    ],
  },
};

/**
 * Exact encoding pipeline used by @larksuiteoapi/node-sdk registerApp():
 * JSON.stringify -> gzip -> base64url (no padding).
 */
export function encodeFeishuAddons(addons: FeishuAppAddons): string {
  const json = JSON.stringify(addons);
  return gzipSync(Buffer.from(json, "utf8"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type PendingFeishuRegSession = {
  sessionId: string;
  deviceCode: string;
  userCode: string;
  authUrl: string;
  baseUrl: string;
  larkBaseUrl: string;
  domainSwitched: boolean;
  interval: number;
  expiresAt: number;
  createdAt: number;
};

type FeishuBeginResp = {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
};

type FeishuPollResp = {
  client_id?: string;
  client_secret?: string;
  user_info?: {
    open_id?: string;
    tenant_brand?: "feishu" | "lark" | string;
  };
  error?: string;
  error_description?: string;
};

function getRegSessionsFile(): string {
  return path.join(getWorkspacePaths().root, "feishu-reg-pending.json");
}

async function readRegSessions(): Promise<Record<string, PendingFeishuRegSession>> {
  const file = getRegSessionsFile();
  if (!(await fileExists(file))) return {};
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, PendingFeishuRegSession>;
    const now = Date.now();
    const fresh: Record<string, PendingFeishuRegSession> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.expiresAt === "number" && v.expiresAt > now - 60_000) {
        fresh[k] = v;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

async function writeRegSessions(sessions: Record<string, PendingFeishuRegSession>): Promise<void> {
  await ensureWorkspace();
  await writeAtomic(getRegSessionsFile(), JSON.stringify(sessions, null, 2));
}

async function postRegistrationForm<T>(baseUrl: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${baseUrl}${REGISTRATION_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`飞书应用注册服务返回异常 (HTTP ${res.status}): ${text.slice(0, 180)}`);
  }
}

export async function beginFeishuAppRegistration(options?: {
  brand?: "feishu" | "lark";
  baseUrlOverride?: string;
  existingAppId?: string;
}): Promise<{
  sessionId: string;
  authUrl: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}> {
  const brand = options?.brand === "lark" ? "lark" : "feishu";
  const baseUrl = (options?.baseUrlOverride || FEISHU_REGISTRATION_DOMAINS[brand]).replace(/\/+$/, "");
  const larkBaseUrl = (options?.baseUrlOverride || FEISHU_REGISTRATION_DOMAINS.lark).replace(/\/+$/, "");

  const beginRes = await postRegistrationForm<FeishuBeginResp>(baseUrl, {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });

  if (!beginRes.device_code || !beginRes.verification_uri_complete) {
    throw new Error(
      `发起飞书扫码建应用失败：${beginRes.error_description || beginRes.error || "未返回授权链接"}`,
    );
  }

  const qrUrl = new URL(beginRes.verification_uri_complete);
  qrUrl.searchParams.set("from", "sdk");
  qrUrl.searchParams.set("source", "node-sdk/tradeloom");
  qrUrl.searchParams.set("tp", "sdk");
  qrUrl.searchParams.set("name", "TradeLoom 织脉投研复盘");
  qrUrl.searchParams.set("desc", "本地优先投研复盘工作台，只读同步个人飞书云文档与知识库");
  qrUrl.searchParams.set("addons", encodeFeishuAddons(TRADELOOM_FEISHU_ADDONS));
  if (options?.existingAppId?.trim()) {
    qrUrl.searchParams.set("clientID", options.existingAppId.trim());
  }

  const expiresIn = Math.max(60, Number(beginRes.expires_in) || 600);
  const interval = Math.max(2, Number(beginRes.interval) || 5);
  const sessionId = randomBytes(12).toString("hex");
  const now = Date.now();

  const sessions = await readRegSessions();
  sessions[sessionId] = {
    sessionId,
    deviceCode: beginRes.device_code,
    userCode: beginRes.user_code || "",
    authUrl: qrUrl.toString(),
    baseUrl,
    larkBaseUrl,
    domainSwitched: brand === "lark",
    interval,
    expiresAt: now + expiresIn * 1000,
    createdAt: now,
  };
  await writeRegSessions(sessions);

  return {
    sessionId,
    authUrl: qrUrl.toString(),
    userCode: beginRes.user_code || "",
    expiresIn,
    interval,
  };
}

export type FeishuRegPollOutcome =
  | { status: "pending"; interval: number; remainingSec: number }
  | {
      status: "completed";
      appId: string;
      appSecret: string;
      domain: "open.feishu.cn" | "open.larksuite.com";
      openId?: string;
    }
  | { status: "expired" | "denied" | "error"; error: string };

export async function pollFeishuAppRegistration(sessionId: string): Promise<FeishuRegPollOutcome> {
  const sessions = await readRegSessions();
  const session = sessions[sessionId];
  if (!session) {
    return { status: "expired", error: "扫码会话不存在或已过期，请重新发起" };
  }

  const remainingSec = Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000));
  if (remainingSec <= 0) {
    delete sessions[sessionId];
    await writeRegSessions(sessions);
    return { status: "expired", error: "扫码链接已过期（10 分钟），请重新点击发起" };
  }

  let pollRes = await postRegistrationForm<FeishuPollResp>(session.baseUrl, {
    action: "poll",
    device_code: session.deviceCode,
  });

  // Auto-switch to Lark accounts domain if international Lark tenant is detected
  if (pollRes.user_info?.tenant_brand === "lark" && !session.domainSwitched) {
    session.baseUrl = session.larkBaseUrl;
    session.domainSwitched = true;
    await writeRegSessions(sessions);
    pollRes = await postRegistrationForm<FeishuPollResp>(session.baseUrl, {
      action: "poll",
      device_code: session.deviceCode,
    });
  }

  if (pollRes.client_id && pollRes.client_secret) {
    const isLark =
      pollRes.user_info?.tenant_brand === "lark" || session.baseUrl.includes("larksuite.com");
    delete sessions[sessionId];
    await writeRegSessions(sessions);
    return {
      status: "completed",
      appId: pollRes.client_id,
      appSecret: pollRes.client_secret,
      domain: isLark ? "open.larksuite.com" : "open.feishu.cn",
      openId: pollRes.user_info?.open_id,
    };
  }

  if (pollRes.error === "authorization_pending") {
    return { status: "pending", interval: session.interval, remainingSec };
  }

  if (pollRes.error === "slow_down") {
    session.interval = Math.min(20, session.interval + 5);
    await writeRegSessions(sessions);
    return { status: "pending", interval: session.interval, remainingSec };
  }

  delete sessions[sessionId];
  await writeRegSessions(sessions);

  if (pollRes.error === "access_denied") {
    return { status: "denied", error: "用户取消或拒绝了飞书应用授权" };
  }
  if (pollRes.error === "expired_token") {
    return { status: "expired", error: "飞书扫码链接已过期，请重新发起" };
  }
  return {
    status: "error",
    error: pollRes.error_description || pollRes.error || "飞书应用创建未完成",
  };
}

/* ==================== Part 2: Official lark-cli Local Bridge ==================== */

export type LarkCliEnvelope<T = unknown> = {
  ok?: boolean;
  identity?: string;
  data?: T;
  meta?: Record<string, unknown>;
  error?: {
    type?: string;
    subtype?: string;
    code?: number;
    message?: string;
    hint?: string;
    missing_scopes?: string[];
  };
};

export type LarkCliStatus = {
  installed: boolean;
  executable?: string;
  version?: string;
  loggedIn: boolean;
  identity?: string;
  userName?: string;
  appId?: string;
  brand?: string;
  profile?: string;
  profiles?: Array<{ name: string; appId?: string; active?: boolean; user?: string; tokenStatus?: string }>;
  message: string;
};

export type LarkCliDocHit = {
  token: string;
  title: string;
  url: string;
  docType: string;
  editTime?: string;
};

export function parseLarkCliJson<T = unknown>(raw: string): LarkCliEnvelope<T> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as LarkCliEnvelope<T>;
  } catch {
    // Sometimes CLI prints notices before/after JSON
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as LarkCliEnvelope<T>;
      } catch {
        return null;
      }
    }
    const arrStart = trimmed.indexOf("[");
    const arrEnd = trimmed.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      try {
        const arr = JSON.parse(trimmed.slice(arrStart, arrEnd + 1)) as T;
        return { ok: true, data: arr };
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function stripHighlightTags(text: string): string {
  return text.replace(/<\/?h[b]?>/gi, "").trim();
}

export function extractLarkCliDocsFromSearch(data: unknown): LarkCliDocHit[] {
  let rawList: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    rawList = data as Record<string, unknown>[];
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of ["results", "items", "docs", "files", "list", "data"]) {
      if (Array.isArray(obj[k])) {
        rawList = obj[k] as Record<string, unknown>[];
        break;
      }
    }
  }

  const hits: LarkCliDocHit[] = [];
  const seen = new Set<string>();
  for (const r of rawList) {
    if (!r || typeof r !== "object") continue;
    const docType = String(r.doc_type ?? r.obj_type ?? r.type ?? "docx").toLowerCase();
    // Focus on readable documents (docx, wiki, doc, markdown)
    if (!["docx", "wiki", "doc", "markdown", "file", ""].includes(docType)) continue;

    const url = String(r.url ?? r.doc_url ?? r.wiki_url ?? "").trim();
    const token = String(
      r.doc_token ?? r.obj_token ?? r.wiki_token ?? r.node_token ?? r.token ?? r.id ?? "",
    ).trim();
    const key = token || url;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const rawTitle = String(
      r.title ?? r.name ?? r.title_highlighted ?? r.doc_title ?? "",
    );
    const title = stripHighlightTags(rawTitle) || `飞书文档_${key.slice(0, 8)}`;
    const editTime = String(
      r.edit_time_iso ?? r.update_time_iso ?? r.create_time_iso ?? r.edit_time ?? "",
    ).trim();

    hits.push({
      token: token || url,
      title,
      url: url || (docType === "wiki" ? `https://feishu.cn/wiki/${token}` : `https://feishu.cn/docx/${token}`),
      docType: docType || "docx",
      editTime: editTime || undefined,
    });
  }
  return hits;
}

export function extractLarkCliDocBody(envelope: LarkCliEnvelope<unknown> | null, rawStdout: string): {
  title?: string;
  markdown: string;
} {
  if (envelope?.data !== undefined) {
    const d = envelope.data;
    if (typeof d === "string") {
      return { markdown: d.trim() };
    }
    if (d && typeof d === "object") {
      const obj = d as Record<string, unknown>;
      const title =
        typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : undefined;
      for (const key of ["markdown", "content", "body", "text", "raw_content", "document"]) {
        const val = obj[key];
        if (typeof val === "string" && val.trim()) {
          return { title, markdown: val.trim() };
        }
        if (val && typeof val === "object") {
          const inner = val as Record<string, unknown>;
          for (const ik of ["markdown", "content", "body", "text"]) {
            if (typeof inner[ik] === "string" && (inner[ik] as string).trim()) {
              return {
                title: title || (typeof inner.title === "string" ? inner.title.trim() : undefined),
                markdown: (inner[ik] as string).trim(),
              };
            }
          }
        }
      }
    }
  }
  return { markdown: rawStdout.trim() };
}

const SAFE_PROFILE_RE = /^[a-zA-Z0-9_-]{1,48}$/;
const CMD_METACHAR_RE = /[\r\n\0"&|<>^%]/;

async function resolveLarkCliCommand(): Promise<{ bin: string; prefixArgs: string[] } | null> {
  const candidates: Array<{ bin: string; prefixArgs: string[] }> = [];
  if (process.platform === "win32") {
    candidates.push({ bin: "lark-cli.exe", prefixArgs: [] });
    if (process.env.APPDATA) {
      // Prefer invoking the @larksuite/cli JS entrypoint directly via node.exe (avoids cmd.exe batch parsing)
      const pkgDir = path.join(process.env.APPDATA, "npm", "node_modules", "@larksuite", "cli");
      try {
        const pkgRaw = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8")) as {
          bin?: string | Record<string, string>;
        };
        const binRel =
          typeof pkgRaw.bin === "string"
            ? pkgRaw.bin
            : pkgRaw.bin?.["lark-cli"] ?? Object.values(pkgRaw.bin ?? {})[0];
        if (binRel) {
          candidates.push({ bin: process.execPath, prefixArgs: [path.resolve(pkgDir, binRel)] });
        }
      } catch {
        /* fallback to .cmd with strict arg sanitization below */
      }
      candidates.push({
        bin: "cmd.exe",
        prefixArgs: ["/d", "/s", "/c", path.join(process.env.APPDATA, "npm", "lark-cli.cmd")],
      });
    }
    candidates.push({ bin: "cmd.exe", prefixArgs: ["/d", "/s", "/c", "lark-cli"] });
  } else {
    candidates.push({ bin: "lark-cli", prefixArgs: [] });
  }

  for (const cand of candidates) {
    try {
      await execFileAsync(cand.bin, [...cand.prefixArgs, "--version"], {
        timeout: 4000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      });
      return cand;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export async function runLarkCli(
  args: string[],
  options?: { profile?: string; timeoutMs?: number },
): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  envelope: LarkCliEnvelope<unknown> | null;
  errorMessage?: string;
}> {
  const cleanProfile = options?.profile?.trim() ?? "";
  if (cleanProfile && !SAFE_PROFILE_RE.test(cleanProfile)) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      envelope: null,
      errorMessage: "飞书 CLI Profile 名称仅允许字母、数字、下划线与连字符",
    };
  }

  const resolved = await resolveLarkCliCommand();
  if (!resolved) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      envelope: null,
      errorMessage:
        "本机未检测到 lark-cli。请先在终端运行 `npx @larksuite/cli@latest install` 安装，或改用上方的「飞书扫码一键创建应用」。",
    };
  }

  const isCmdShell = resolved.bin.toLowerCase().endsWith("cmd.exe");
  if (isCmdShell && args.some((a) => CMD_METACHAR_RE.test(a))) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      envelope: null,
      errorMessage: "安全拦截：飞书 CLI 参数包含非法特殊字符",
    };
  }

  const finalArgs = [...resolved.prefixArgs];
  if (cleanProfile) {
    finalArgs.push("--profile", cleanProfile);
  }
  finalArgs.push(...args);

  try {
    const { stdout, stderr } = await execFileAsync(resolved.bin, finalArgs, {
      timeout: options?.timeoutMs ?? 25000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const env = parseLarkCliJson(stdout) ?? parseLarkCliJson(stderr);
    if (env && env.ok === false) {
      return {
        ok: false,
        stdout,
        stderr,
        envelope: env,
        errorMessage: formatLarkCliError(env),
      };
    }
    return { ok: true, stdout, stderr, envelope: env };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const stdout = String(e.stdout ?? "");
    const stderr = String(e.stderr ?? "");
    const env = parseLarkCliJson(stderr) ?? parseLarkCliJson(stdout);
    return {
      ok: false,
      stdout,
      stderr,
      envelope: env,
      errorMessage: env ? formatLarkCliError(env) : (stderr || stdout || e.message || "lark-cli 执行失败").slice(0, 260),
    };
  }
}

function formatLarkCliError(env: LarkCliEnvelope<unknown>): string {
  const e = env.error;
  if (!e) return "lark-cli 返回错误";
  const parts: string[] = [];
  if (e.message) parts.push(e.message);
  if (Array.isArray(e.missing_scopes) && e.missing_scopes.length > 0) {
    parts.push(`缺少权限：${e.missing_scopes.join(", ")}`);
  }
  if (e.hint) parts.push(`建议：${e.hint}`);
  return parts.join("；") || `lark-cli 错误 (${e.code ?? e.subtype ?? "unknown"})`;
}

export async function detectLarkCliStatus(profile?: string): Promise<LarkCliStatus> {
  const resolved = await resolveLarkCliCommand();
  if (!resolved) {
    return {
      installed: false,
      loggedIn: false,
      message:
        "本机未检测到飞书官方 CLI (`lark-cli`)。如需使用 CLI 模式，请在终端运行 `npx @larksuite/cli@latest install`；不想装命令行工具可直接切回「扫码一键创建应用」。",
    };
  }

  let version = "";
  try {
    const { stdout } = await execFileAsync(resolved.bin, [...resolved.prefixArgs, "--version"], {
      timeout: 4000,
      windowsHide: true,
    });
    version = stdout.trim().split(/\r?\n/)[0] || "";
  } catch {
    /* ignore */
  }

  const statusRes = await runLarkCli(["auth", "status", "--format", "json"], { profile, timeoutMs: 8000 });
  const profilesRes = await runLarkCli(["profile", "list", "--format", "json"], { timeoutMs: 8000 });

  const profilesRaw = Array.isArray(profilesRes.envelope?.data)
    ? (profilesRes.envelope?.data as Array<Record<string, unknown>>)
    : [];
  const profiles = profilesRaw.map((p) => ({
    name: String(p.name ?? ""),
    appId: p.appId ? String(p.appId) : undefined,
    active: Boolean(p.active),
    user: p.user ? String(p.user) : undefined,
    tokenStatus: p.tokenStatus ? String(p.tokenStatus) : undefined,
  }));

  const data = (statusRes.envelope?.data ?? {}) as Record<string, unknown>;
  const tokenStatus = String(data.tokenStatus ?? data.token_status ?? data.status ?? "").toLowerCase();
  const loggedIn =
    statusRes.ok &&
    (data.loggedIn === true ||
      data.logged_in === true ||
      data.authenticated === true ||
      tokenStatus === "valid" ||
      tokenStatus === "active" ||
      Boolean(data.user || data.userName || data.user_name || data.open_id || data.openId));

  const userName = String(data.user ?? data.userName ?? data.user_name ?? data.name ?? "").trim() || undefined;
  const appId = String(data.appId ?? data.app_id ?? "").trim() || undefined;
  const brand = String(data.brand ?? "feishu").trim();
  const identity = statusRes.envelope?.identity || (loggedIn ? "user" : undefined);

  if (loggedIn) {
    return {
      installed: true,
      executable: resolved.bin,
      version,
      loggedIn: true,
      identity,
      userName,
      appId,
      brand,
      profile: profile || profiles.find((p) => p.active)?.name,
      profiles,
      message: `已检测到本机 lark-cli${version ? ` (${version})` : ""} 且已登录${userName ? `：${userName}` : ""}${appId ? ` (${appId})` : ""}，可直接拉取个人飞书云文档与知识库。`,
    };
  }

  return {
    installed: true,
    executable: resolved.bin,
    version,
    loggedIn: false,
    appId,
    brand,
    profile: profile || profiles.find((p) => p.active)?.name,
    profiles,
    message: `已检测到本机 lark-cli${version ? ` (${version})` : ""}，但尚未完成个人账号授权。请点击下方「发起 CLI 浏览器授权」，或在终端运行 \`lark-cli auth login --domain docs,wiki,drive\`。`,
  };
}

export async function startLarkCliUserLogin(profile?: string): Promise<{
  ok: boolean;
  authUrl?: string;
  deviceCode?: string;
  message: string;
}> {
  const res = await runLarkCli(
    ["auth", "login", "--domain", "docs,wiki,drive", "--no-wait", "--format", "json"],
    { profile, timeoutMs: 15000 },
  );

  const data = (res.envelope?.data ?? {}) as Record<string, unknown>;
  const combined = `${res.stdout}\n${res.stderr}`;
  const urlFromJson =
    String(
      data.verification_uri_complete ?? data.verification_url ?? data.auth_url ?? data.url ?? "",
    ).trim();
  const urlMatch = /https:\/\/[^\s"'<>]+/.exec(combined);
  const authUrl = urlFromJson || (urlMatch ? urlMatch[0] : "");
  const deviceCode = String(data.device_code ?? data.deviceCode ?? "").trim() || undefined;

  if (authUrl) {
    return {
      ok: true,
      authUrl,
      deviceCode,
      message: "已生成飞书 CLI 个人授权链接，请在浏览器打开并确认授权；完成后点「检测本机 lark-cli 状态」即可。",
    };
  }

  return {
    ok: false,
    message:
      res.errorMessage ||
      "未能获取 CLI 授权链接（若尚未初始化应用，请先在终端运行 `lark-cli config init --new`）。",
  };
}

export async function searchLarkCliDocs(args: {
  query?: string;
  maxItems?: number;
  profile?: string;
}): Promise<{ ok: true; docs: LarkCliDocHit[] } | { ok: false; error: string }> {
  const limit = Math.min(60, Math.max(1, args.maxItems || 20));
  // Feishu drive +search strictly enforces --query <= 30 Unicode code points
  const query = Array.from((args.query ?? "").trim()).slice(0, 30).join("");
  const docs: LarkCliDocHit[] = [];
  const seen = new Set<string>();
  let pageToken = "";

  for (let page = 0; page < 4 && docs.length < limit; page++) {
    const cliArgs = [
      "drive",
      "+search",
      "--query",
      query,
      "--doc-types",
      "docx,wiki",
      "--page-size",
      String(Math.min(20, limit)),
      "--as",
      "user",
      "--format",
      "json",
    ];
    if (pageToken) {
      cliArgs.push("--page-token", pageToken);
    }

    const res = await runLarkCli(cliArgs, { profile: args.profile, timeoutMs: 25000 });
    if (!res.ok) {
      if (docs.length > 0) break;
      return { ok: false, error: res.errorMessage || "lark-cli 搜索云文档失败" };
    }

    const batch = extractLarkCliDocsFromSearch(res.envelope?.data);
    for (const item of batch) {
      if (docs.length >= limit) break;
      const k = item.token || item.url;
      if (seen.has(k)) continue;
      seen.add(k);
      docs.push(item);
    }

    const dataObj = (res.envelope?.data ?? {}) as Record<string, unknown>;
    const hasMore = Boolean(dataObj.has_more);
    const nextToken = String(dataObj.page_token ?? "").trim();
    if (!hasMore || !nextToken || batch.length === 0) break;
    pageToken = nextToken;
  }

  return { ok: true, docs };
}

export async function fetchLarkCliDocMarkdown(
  docTarget: string,
  profile?: string,
): Promise<{ ok: true; title?: string; markdown: string } | { ok: false; error: string }> {
  const res = await runLarkCli(
    ["docs", "+fetch", "--doc", docTarget, "--doc-format", "markdown", "--scope", "full", "--as", "user", "--format", "json"],
    { profile, timeoutMs: 30000 },
  );
  if (!res.ok) {
    return { ok: false, error: res.errorMessage || `读取飞书文档 ${docTarget} 失败` };
  }
  const parsed = extractLarkCliDocBody(res.envelope, res.stdout);
  if (!parsed.markdown) {
    return { ok: false, error: "文档正文为空" };
  }
  return { ok: true, title: parsed.title, markdown: parsed.markdown };
}