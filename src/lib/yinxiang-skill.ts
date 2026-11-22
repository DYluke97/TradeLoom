import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { htmlToMd } from "./convert";
import type { YoudaoFolderSummary } from "./cloud-connectors";

export const YINXIANG_DEFAULT_BASE_URL = "https://app.yinxiang.com";
export const YINXIANG_OAUTH_URL = "https://app.yinxiang.com/third/skills-oauth/";
export const YINXIANG_GUIDE_URL = "https://guide.yinxiang.com/docs/yxai/skill.html";

const SEARCH_API_PREFIX = "/third/ai-chat-note/grpc-api/search";
const DEFAULT_TIMEOUT_MS = 20_000;

export type YinxiangNotebook = {
  guid: string;
  name: string;
  stack?: string;
  defaultNotebook?: boolean;
};

export type YinxiangTag = {
  guid: string;
  name: string;
};

export type YinxiangNoteSummary = {
  guid: string;
  title: string;
  notebookGuid?: string;
  notebookName?: string;
  tagNames: string[];
  eventDate?: string;
  updatedMs?: number;
  createdMs?: number;
  snippet?: string;
};

export type YinxiangFetchedNote = {
  guid: string;
  title: string;
  content: string;
  eventDate?: string;
  notebookName?: string;
  tags: string[];
  sourceUrl: string;
};

export class YinxiangApiError extends Error {
  code?: number;
  httpStatus?: number;
  constructor(message: string, opts?: { code?: number; httpStatus?: number }) {
    super(message);
    this.name = "YinxiangApiError";
    this.code = opts?.code;
    this.httpStatus = opts?.httpStatus;
  }
}

export function normalizeYinxiangBaseUrl(raw?: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return YINXIANG_DEFAULT_BASE_URL;
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") return "";
    // If user accidentally pasted https://app.yinxiang.com/third/skills-oauth/, keep origin only.
    if (parsed.pathname.includes("/third/")) {
      return parsed.origin;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

export function normalizeYinxiangToken(raw?: string): string {
  let s = (raw ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(?:auth|authorization)\s*:\s*/i, "").trim();
  s = s.replace(/^bearer\s+/i, "").trim();
  return s;
}

/**
 * Checks the official yinxiang-skill token locations (~/.config/yinxiang-skill/token and $YX_AUTH_TOKEN)
 * so users who already authorized Yinxiang Skill in OpenClaw / Cursor / Claude Code can reuse it directly.
 */
export function readLocalYinxiangSkillToken(): string | null {
  const fromEnv = normalizeYinxiangToken(process.env.YX_AUTH_TOKEN);
  if (fromEnv) return fromEnv;
  try {
    const tokenPath = path.join(os.homedir(), ".config", "yinxiang-skill", "token");
    if (existsSync(tokenPath)) {
      const fromFile = normalizeYinxiangToken(readFileSync(tokenPath, "utf8"));
      if (fromFile) return fromFile;
    }
  } catch {
    // Ignore local filesystem read errors
  }
  return null;
}

export function parseYinxiangTimestamp(val: unknown): { date?: string; ms?: number } {
  if (val == null || val === "") return {};
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    const ms = val > 1e11 ? val : val > 1e9 ? val * 1000 : NaN;
    if (!Number.isFinite(ms)) return {};
    const cnDate = new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
    return { date: cnDate, ms };
  }
  if (typeof val === "string") {
    const s = val.trim();
    if (/^\d{10,13}$/.test(s)) {
      return parseYinxiangTimestamp(Number(s));
    }
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (isoMatch) {
      const parsed = Date.parse(s);
      return {
        date: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`,
        ms: Number.isFinite(parsed) ? parsed : undefined,
      };
    }
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) {
      const cnDate = new Date(parsed + 8 * 3600_000).toISOString().slice(0, 10);
      return { date: cnDate, ms: parsed };
    }
  }
  return {};
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function pickStringArray(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      const out = v
        .map((item) => {
          if (typeof item === "string") return item.trim();
          const rec = asRecord(item);
          return rec ? pickString(rec, ["tagName", "name", "title"]) : "";
        })
        .filter(Boolean);
      if (out.length > 0) return Array.from(new Set(out));
    }
  }
  return [];
}

export function extractYinxiangNotebooks(payload: unknown): YinxiangNotebook[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) return [];

  const rawList =
    (Array.isArray(data.noteBookList) && data.noteBookList) ||
    (Array.isArray(data.notebookList) && data.notebookList) ||
    (Array.isArray(data.notebooks) && data.notebooks) ||
    (Array.isArray(data.list) && data.list) ||
    [];

  const seen = new Set<string>();
  const out: YinxiangNotebook[] = [];
  for (const item of rawList) {
    const rec = asRecord(item);
    if (!rec) continue;
    const guid = pickString(rec, ["guid", "notebookGuid", "id"]);
    const name = pickString(rec, ["name", "notebookName", "title"]) || guid;
    if (!guid || seen.has(guid)) continue;
    seen.add(guid);
    const stack = pickString(rec, ["stack", "stackName"]) || undefined;
    const defaultNotebook = Boolean(rec.defaultNotebook ?? rec.isDefault);
    out.push({ guid, name, stack, defaultNotebook });
  }
  return out;
}

export function extractYinxiangTags(payload: unknown): YinxiangTag[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) return [];

  const rawList =
    (Array.isArray(data.tagList) && data.tagList) ||
    (Array.isArray(data.tags) && data.tags) ||
    (Array.isArray(data.list) && data.list) ||
    [];

  const seen = new Set<string>();
  const out: YinxiangTag[] = [];
  for (const item of rawList) {
    const rec = asRecord(item);
    if (!rec) continue;
    const guid = pickString(rec, ["tagGuid", "guid", "id"]);
    const name = pickString(rec, ["tagName", "name"]);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ guid: guid || name, name });
  }
  return out;
}

export function extractYinxiangSearchNotes(payload: unknown): {
  total: number;
  notes: YinxiangNoteSummary[];
} {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) return { total: 0, notes: [] };

  const rawList =
    (Array.isArray(data.noteDetailList) && data.noteDetailList) ||
    (Array.isArray(data.noteList) && data.noteList) ||
    (Array.isArray(data.notes) && data.notes) ||
    (Array.isArray(data.list) && data.list) ||
    (Array.isArray(data.items) && data.items) ||
    [];

  const seen = new Set<string>();
  const notes: YinxiangNoteSummary[] = [];
  for (const item of rawList) {
    const rec = asRecord(item);
    if (!rec) continue;
    const guid = pickString(rec, ["noteGuid", "guid", "noteId", "id"]);
    if (!guid || seen.has(guid)) continue;
    seen.add(guid);

    const title = pickString(rec, ["noteTitle", "title", "name"]) || `印象笔记-${guid.slice(0, 8)}`;
    const notebookGuid = pickString(rec, ["notebookGuid", "bookGuid"]) || undefined;
    const notebookName = pickString(rec, ["notebookName", "bookName"]) || undefined;
    const tagNames = pickStringArray(rec, ["tagNames", "tags"]);
    const updated = parseYinxiangTimestamp(rec.updated ?? rec.updateTime ?? rec.updatedTime ?? rec.modifyTime);
    const created = parseYinxiangTimestamp(rec.created ?? rec.createTime ?? rec.createdTime);
    const snippet = pickString(rec, ["content", "snippet", "summary", "abstract"]) || undefined;

    notes.push({
      guid,
      title,
      notebookGuid,
      notebookName,
      tagNames,
      eventDate: updated.date ?? created.date,
      updatedMs: updated.ms,
      createdMs: created.ms,
      snippet,
    });
  }

  const totalRaw = Number(data.total ?? data.totalNotes ?? notes.length);
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : notes.length;
  return { total, notes };
}

/**
 * Converts Yinxiang note content (ENML XML, HTML, or already-Markdown/plain text) into clean Markdown.
 */
export function yinxiangContentToMarkdown(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  const looksLikeEnml = /<en-note\b/i.test(trimmed) || /<!DOCTYPE\s+en-note/i.test(trimmed);
  const looksLikeHtml =
    looksLikeEnml ||
    /<(?:div|p|br|span|ul|ol|li|h[1-6]|table|tr|td|blockquote|pre|code|a|strong|em)\b[^>]*>/i.test(trimmed);

  if (!looksLikeHtml) {
    return trimmed
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  let html = trimmed
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<en-note\b[^>]*>/gi, "<div>")
    .replace(/<\/en-note>/gi, "</div>")
    .replace(/<en-todo\b([^>]*?)\/?>/gi, (_m, attrs: string) => {
      const checked = /checked\s*=\s*["']?true["']?/i.test(attrs);
      return checked ? "<span>YXTODOCHECKED </span>" : "<span>YXTODOOPEN </span>";
    })
    .replace(/<en-crypt\b[^>]*>[\s\S]*?<\/en-crypt>/gi, "<span>（已加密内容）</span>")
    .replace(/<en-media\b([^>]*?)\/?>/gi, (_m, attrs: string) => {
      const alt = /(?:alt|title)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.trim();
      const mime = /type\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.trim();
      if (alt) return `<span>（附件：${alt}）</span>`;
      if (mime && mime.startsWith("image/")) return "<span>（图片）</span>";
      return "<span>（附件）</span>";
    });

  // Unwrap redundant nested empty divs with just <br/>
  html = html.replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, "<p></p>");

  const converted = htmlToMd(html);
  if (converted.ok && converted.md.trim()) {
    return converted.md
      .replace(/YXTODOCHECKED\s*/g, "- [x] ")
      .replace(/YXTODOOPEN\s*/g, "- [ ] ")
      .trim();
  }

  // Fallback plain text extraction when HTML is minimal or non-standard
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractYinxiangNoteDetail(
  payload: unknown,
  fallback?: YinxiangNoteSummary,
): {
  title: string;
  content: string;
  tags: string[];
  notebookName?: string;
  eventDate?: string;
} {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const rawDetail = data?.dataDetail ?? data?.noteDetail ?? data?.note ?? data;

  let title = fallback?.title ?? "印象笔记复盘";
  let notebookName = fallback?.notebookName;
  let tags = [...(fallback?.tagNames ?? [])];
  let eventDate = fallback?.eventDate;
  let rawContent = "";

  if (typeof rawDetail === "string") {
    rawContent = rawDetail;
  } else {
    const rec = asRecord(rawDetail);
    if (rec) {
      const detailTitle = pickString(rec, ["noteTitle", "title", "name"]);
      if (detailTitle) title = detailTitle;
      const detailBook = pickString(rec, ["notebookName", "bookName"]);
      if (detailBook) notebookName = detailBook;
      const detailTags = pickStringArray(rec, ["tagNames", "tags"]);
      if (detailTags.length > 0) tags = Array.from(new Set([...tags, ...detailTags]));
      const updated = parseYinxiangTimestamp(rec.updated ?? rec.updateTime ?? rec.updatedTime);
      const created = parseYinxiangTimestamp(rec.created ?? rec.createTime ?? rec.createdTime);
      eventDate = updated.date ?? created.date ?? eventDate;
      rawContent = pickString(rec, [
        "content",
        "noteContent",
        "markdown",
        "mdContent",
        "htmlContent",
        "html",
        "text",
        "body",
        "dataDetail",
      ]);
    }
  }

  if (!rawContent && fallback?.snippet) {
    rawContent = fallback.snippet;
  }

  return {
    title,
    content: yinxiangContentToMarkdown(rawContent),
    tags,
    notebookName,
    eventDate,
  };
}

function isSuccessCode(code: unknown): boolean {
  if (code == null) return true;
  const n = Number(code);
  return n === 0 || n === 200 || n === 8200;
}

export async function callYinxiangSearchApi(args: {
  token: string;
  endpoint: "listNoteBooks" | "listTags" | "searchNotesByFilter" | "getNoteDetail";
  body: Record<string, unknown>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ empty: boolean; payload: Record<string, unknown> }> {
  const token = normalizeYinxiangToken(args.token);
  if (!token) {
    throw new YinxiangApiError("尚未填写印象笔记 AuthToken", { code: 8403 });
  }
  const baseUrl = normalizeYinxiangBaseUrl(args.baseUrl);
  if (!baseUrl) {
    throw new YinxiangApiError("印象笔记接口地址必须为有效的 https:// 地址");
  }

  const fetchFn = args.fetchImpl ?? fetch;
  const url = `${baseUrl}${SEARCH_API_PREFIX}/${args.endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        auth: token,
      },
      body: JSON.stringify({ ...args.body, source: "skill" }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      const json = JSON.parse(rawText);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        parsed = json as Record<string, unknown>;
      }
    } catch {
      if (!res.ok) {
        throw new YinxiangApiError(`HTTP ${res.status}: ${rawText.slice(0, 180)}`, { httpStatus: res.status });
      }
      throw new YinxiangApiError("印象笔记返回了非 JSON 响应，请稍后重试");
    }

    const statusObj = asRecord(parsed.status);
    const statusCode = statusObj?.code ?? parsed.code;
    const statusMsg =
      (typeof statusObj?.msg === "string" && statusObj.msg) ||
      (typeof statusObj?.message === "string" && statusObj.message) ||
      (typeof parsed.message === "string" && parsed.message) ||
      (typeof parsed.msg === "string" && parsed.msg) ||
      "";

    // Official yinxiang-skill spec: status.code == 1107 means backend explicitly returned no matching notes.
    if (Number(statusCode) === 1107) {
      return { empty: true, payload: parsed };
    }

    if (!res.ok || !isSuccessCode(statusCode)) {
      throw new YinxiangApiError(statusMsg || `接口异常 (code=${String(statusCode ?? res.status)})`, {
        code: typeof statusCode === "number" ? statusCode : Number(statusCode) || undefined,
        httpStatus: res.status,
      });
    }

    return { empty: false, payload: parsed };
  } catch (err) {
    if (err instanceof YinxiangApiError) throw err;
    throw new YinxiangApiError(err instanceof Error ? err.message : "请求印象笔记接口失败");
  } finally {
    clearTimeout(timer);
  }
}

export function formatYinxiangError(err: unknown): string {
  const code = err instanceof YinxiangApiError ? err.code : undefined;
  const httpStatus = err instanceof YinxiangApiError ? err.httpStatus : undefined;
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();

  if (
    code === 8403 ||
    httpStatus === 401 ||
    lower.includes("invalid authtoken") ||
    lower.includes("unauth") ||
    lower.includes("token") && (lower.includes("invalid") || lower.includes("expire") || lower.includes("过期"))
  ) {
    return "印象笔记 AuthToken 无效或已过期（code 8403）。请点击「去印象笔记获取 AuthToken」前往 app.yinxiang.com/third/skills-oauth/ 重新生成 1 年期令牌（注意：仅支持国内版印象笔记付费会员，且不要填老版 7 天 DeveloperToken）。";
  }

  if (
    httpStatus === 403 ||
    lower.includes("vip") ||
    lower.includes("member") ||
    lower.includes("privilege") ||
    lower.includes("permission")
  ) {
    return "当前印象笔记账号权限不足或会员已过期。官方 Skill API 需国内版印象笔记会员；免费版用户可直接使用客户端导出 .html 拖入 TradeLoom 或浏览器一键剪藏。";
  }

  if (httpStatus === 429 || lower.includes("rate") || lower.includes("too many") || lower.includes("限流")) {
    return "印象笔记接口触发频率限制，请稍等片刻后重试（可适当调小「单次最多同步篇数」）。";
  }

  if (
    lower.includes("abort") ||
    lower.includes("timeout") ||
    lower.includes("fetch failed") ||
    lower.includes("econn") ||
    lower.includes("enotfound")
  ) {
    return "无法连接印象笔记国内版服务器（app.yinxiang.com），请检查本机网络连接或代理设置后重试。";
  }

  return raw || "连接印象笔记国内版失败";
}

export function notebooksToFolderSummaries(notebooks: YinxiangNotebook[]): YoudaoFolderSummary[] {
  return notebooks.map((nb) => ({
    id: nb.guid,
    name: nb.stack ? `${nb.stack} / ${nb.name}` : nb.name,
  }));
}

export async function discoverYinxiangWorkspace(
  token: string,
  opts?: { baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<{
  notebooks: YinxiangNotebook[];
  tags: YinxiangTag[];
  folders: YoudaoFolderSummary[];
}> {
  const nbRes = await callYinxiangSearchApi({
    token,
    endpoint: "listNoteBooks",
    body: {},
    baseUrl: opts?.baseUrl,
    fetchImpl: opts?.fetchImpl,
  });
  const notebooks = extractYinxiangNotebooks(nbRes.payload);

  // Tags are best-effort; never fail notebook discovery if listTags errors.
  let tags: YinxiangTag[] = [];
  try {
    const tagRes = await callYinxiangSearchApi({
      token,
      endpoint: "listTags",
      body: {},
      baseUrl: opts?.baseUrl,
      fetchImpl: opts?.fetchImpl,
    });
    if (!tagRes.empty) {
      tags = extractYinxiangTags(tagRes.payload);
    }
  } catch {
    tags = [];
  }

  return {
    notebooks,
    tags,
    folders: notebooksToFolderSummaries(notebooks),
  };
}

function splitFilterList(raw?: string): string[] {
  return (raw ?? "")
    .split(/[\n,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function fetchYinxiangItems(
  token: string,
  opts?: {
    notebookFilter?: string;
    tagFilter?: string;
    keyword?: string;
    maxItems?: number;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<{
  items: YinxiangFetchedNote[];
  notebooks: YinxiangNotebook[];
  tags: YinxiangTag[];
  folders: YoudaoFolderSummary[];
  totalMatched: number;
  warnings: string[];
}> {
  const maxItems = Math.min(100, Math.max(1, Number(opts?.maxItems) || 30));
  const warnings: string[] = [];

  const { notebooks, tags, folders } = await discoverYinxiangWorkspace(token, {
    baseUrl: opts?.baseUrl,
    fetchImpl: opts?.fetchImpl,
  });

  const nbByGuid = new Map<string, YinxiangNotebook>();
  const nbByLowerName = new Map<string, YinxiangNotebook>();
  for (const nb of notebooks) {
    nbByGuid.set(nb.guid.toLowerCase(), nb);
    nbByLowerName.set(nb.name.toLowerCase(), nb);
    if (nb.stack) {
      nbByLowerName.set(`${nb.stack} / ${nb.name}`.toLowerCase(), nb);
    }
  }

  const filterTokens = splitFilterList(opts?.notebookFilter);
  const resolvedTargets: Array<{ notebookGuid?: string; notebookName?: string }> = [];

  if (filterTokens.length === 0) {
    resolvedTargets.push({});
  } else {
    for (const tokenItem of filterTokens) {
      const lower = tokenItem.toLowerCase();
      const matched = nbByGuid.get(lower) ?? nbByLowerName.get(lower);
      if (matched) {
        // Per official yinxiang-skill spec: when GUID is known, pass ONLY notebookGuid (do not pass notebookName).
        resolvedTargets.push({ notebookGuid: matched.guid });
      } else {
        resolvedTargets.push({ notebookName: tokenItem });
      }
    }
  }

  const tagNames = splitFilterList(opts?.tagFilter);
  const keyword = (opts?.keyword ?? "").trim();

  const seenGuids = new Set<string>();
  const summaries: YinxiangNoteSummary[] = [];
  let totalMatched = 0;

  for (const target of resolvedTargets) {
    const body: Record<string, unknown> = {
      resultSpec: {
        includeContent: false,
        includeResources: false,
        includeTags: true,
        includeResourceContent: false,
      },
    };
    if (keyword) body.keyword = keyword;
    if (tagNames.length > 0) body.tagNames = tagNames;
    if (target.notebookGuid) {
      body.notebookGuid = target.notebookGuid;
    } else if (target.notebookName) {
      body.notebookName = target.notebookName;
    }

    const searchRes = await callYinxiangSearchApi({
      token,
      endpoint: "searchNotesByFilter",
      body,
      baseUrl: opts?.baseUrl,
      fetchImpl: opts?.fetchImpl,
    });

    if (searchRes.empty) continue;
    const { total, notes } = extractYinxiangSearchNotes(searchRes.payload);
    totalMatched += total;

    for (const note of notes) {
      if (seenGuids.has(note.guid)) continue;
      seenGuids.add(note.guid);
      const nb = note.notebookGuid ? nbByGuid.get(note.notebookGuid.toLowerCase()) : undefined;
      summaries.push({
        ...note,
        notebookName: note.notebookName || (nb ? (nb.stack ? `${nb.stack}/${nb.name}` : nb.name) : undefined),
      });
    }
  }

  if (totalMatched >= 100 && summaries.length < totalMatched) {
    warnings.push(`共匹配 ${totalMatched} 篇（印象笔记接口单次最多返回 100 条），本次按上限拉取前 ${Math.min(maxItems, summaries.length)} 篇`);
  }

  // Sort most recently updated/created first when timestamps are available.
  summaries.sort((a, b) => {
    const ta = a.updatedMs ?? a.createdMs ?? 0;
    const tb = b.updatedMs ?? b.createdMs ?? 0;
    return tb - ta;
  });

  const selected = summaries.slice(0, maxItems);
  const items: YinxiangFetchedNote[] = [];

  for (const note of selected) {
    try {
      const detailRes = await callYinxiangSearchApi({
        token,
        endpoint: "getNoteDetail",
        body: {
          guid: note.guid,
          resultSpec: {
            includeContent: true,
            includeResources: false,
            includeTags: true,
            includeResourceContent: false,
          },
        },
        baseUrl: opts?.baseUrl,
        fetchImpl: opts?.fetchImpl,
      });

      const detail = extractYinxiangNoteDetail(detailRes.payload, note);
      if (!detail.content.trim()) continue;

      const resolvedBase = normalizeYinxiangBaseUrl(opts?.baseUrl) || YINXIANG_DEFAULT_BASE_URL;
      items.push({
        guid: note.guid,
        title: detail.title,
        content: detail.content,
        eventDate: detail.eventDate,
        notebookName: detail.notebookName,
        tags: detail.tags,
        sourceUrl: `${resolvedBase}/Home.action#n=${encodeURIComponent(note.guid)}`,
      });
    } catch (err) {
      warnings.push(`笔记「${note.title}」正文读取跳过：${formatYinxiangError(err)}`);
    }
  }

  return {
    items,
    notebooks,
    tags,
    folders,
    totalMatched,
    warnings,
  };
}