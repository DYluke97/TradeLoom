import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import path from "node:path";
import {
  extractBalancedJsonObject,
  formatChinaDateFromEpoch,
  resolveCloudPlatformUrl,
} from "./cloud-resolvers";
import { decodeText, guessTitle, htmlToMd } from "./convert";
import { rebuildVault } from "./vault";
import type { VaultIndex } from "./vault-builder";
import { ensureWorkspace, writeAtomic } from "./workspace";

// WeChat articles often exceed 3.6 MB of inline CSS/JS; allow up to 10 MB safely.
const MAX_URL_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

function sanitizeSlug(raw: string): string {
  return (
    raw
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 72) || "cloud_note"
  );
}

function normalizeDate(raw?: string): string {
  if (!raw) return formatChinaDateFromEpoch(Date.now());
  const m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(raw.trim());
  if (!m) return formatChinaDateFromEpoch(Date.now());
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) {
    return formatChinaDateFromEpoch(Date.now());
  }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function detectPlatformFromUrl(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host.includes("feishu.cn") || host.includes("larksuite.com")) return "飞书文档";
    if (host.includes("notion.so") || host.includes("notion.site")) return "Notion";
    if (host.includes("yuque.com")) return "语雀";
    if (host.includes("xueqiu.com")) return "雪球";
    if (host.includes("note.youdao.com") || host.includes("youdao.com")) return "有道云笔记";
    if (host.includes("yinxiang.com")) return "印象笔记";
    if (host.includes("evernote.com")) return "Evernote";
    if (host.includes("dida365.com") || host.includes("ticktick.com")) return "滴答清单";
    if (host.includes("mp.weixin.qq.com")) return "微信公众号";
    if (host.includes("zhihu.com")) return "知乎";
    if (host.includes("blog.sina.com.cn")) return "新浪博客";
    if (host.includes("github.com") || host.includes("raw.githubusercontent.com")) return "GitHub";
    return host.replace(/^www\./, "");
  } catch {
    return "网页抓取";
  }
}

export function isPrivateIpOrHost(hostname: string): boolean {
  const cleanHost = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (cleanHost.startsWith("::ffff:")) {
    const tail = cleanHost.slice(7);
    // WHATWG URL serializes IPv4-mapped IPv6 in hex (e.g. `::ffff:7f00:1` for 127.0.0.1)
    if (/^(?:0+|7f[0-9a-f]{0,2}|0?a[0-9a-f]{0,2}|c0a8|a9fe|64(?:4[0-9a-f]|[5-7][0-9a-f])|ac1[0-9a-f]):/i.test(tail)) {
      return true;
    }
    return isPrivateIpOrHost(tail);
  }
  if (cleanHost === "::" || cleanHost === "::1" || /^(?:0+:){7}0*1$/i.test(cleanHost) || /^0\./.test(cleanHost)) {
    return true;
  }
  const h = cleanHost;
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localhost")
  ) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    return true;
  }
  // Carrier-grade NAT 100.64.0.0/10 (includes Aliyun ECS metadata 100.100.100.200)
  const m100 = /^100\.(\d+)\./.exec(h);
  if (m100) {
    const second = Number(m100[1]);
    if (second >= 64 && second <= 127) return true;
  }
  const m172 = /^172\.(\d+)\./.exec(h);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^(fc|fd|fe80)/i.test(h)) return true;
  return false;
}

export async function assertSafePublicDns(
  hostname: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isPrivateIpOrHost(hostname)) {
    return { ok: false, error: "安全限制：不允许抓取本机或内网私有地址" };
  }
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      return { ok: false, error: `无法解析目标域名（${hostname}），请检查链接是否正确` };
    }
    for (const rec of records) {
      if (isPrivateIpOrHost(rec.address)) {
        return { ok: false, error: "安全限制：目标域名解析指向本机或内网私有地址，已自动拦截" };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: `域名解析失败（${hostname}），请检查网络连接或链接拼写` };
  }
}

export function validatePublicFetchUrl(
  rawUrl: string,
): { ok: true; href: string; hostname: string } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { ok: false, error: "请输入需要抓取的网页链接" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "链接格式不正确，请输入以 https:// 或 http:// 开头的完整 URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "仅支持 http:// 或 https:// 协议的公开网页链接" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "链接中请勿包含用户名或密码" };
  }
  if (isPrivateIpOrHost(parsed.hostname)) {
    return { ok: false, error: "安全限制：不允许抓取本机或内网私有地址" };
  }
  return { ok: true, href: parsed.href, hostname: parsed.hostname };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

function stripHiddenAndJsNoise(html: string): string {
  return html
    .replace(/<(p|div|span)\b[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href=["']javascript:[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");
}

function extractBalancedElementByAttr(html: string, attrPattern: RegExp): string | null {
  const match = attrPattern.exec(html);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const openTagMatch = /^<([a-z0-9]+)/i.exec(html.slice(start));
  if (!openTagMatch) return null;
  const tagName = openTagMatch[1].toLowerCase();
  const tagRe = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagRe.lastIndex = start;
  let depth = 0;
  let end = -1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const token = m[0];
    if (token.startsWith("</")) {
      depth--;
      if (depth <= 0) {
        end = m.index + token.length;
        break;
      }
    } else if (!token.endsWith("/>")) {
      depth++;
    }
  }
  if (end > start) return html.slice(start, end);
  return null;
}

export type ExtractedArticle =
  | {
      ok: true;
      title: string;
      md: string;
      eventDate: string;
      platform: string;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      requiresLogin?: boolean;
    };

type XueqiuStatusJson = {
  title?: string;
  text?: string;
  created_at?: number;
  user?: { screen_name?: string };
  retweeted_status?: {
    title?: string;
    text?: string;
    user?: { screen_name?: string };
  } | null;
};

/**
 * Extracts Xueqiu long articles & short posts directly from embedded `window.SNOWMAN_STATUS` JSON:
 * - Avoids leaked hidden `<p style="display:none;">来源：雪球App...` watermarks
 * - Preserves `retweeted_status` quoted original posts (which SSR DOM leaves empty)
 * - Uses accurate Asia/Shanghai (+08:00) publish date from `created_at`
 */
function tryExtractXueqiuFromStatusJson(html: string): ExtractedArticle | null {
  const markerIdx = html.indexOf("SNOWMAN_STATUS");
  if (markerIdx < 0) return null;
  const jsonStr = extractBalancedJsonObject(html, markerIdx);
  if (!jsonStr) return null;

  let status: XueqiuStatusJson;
  try {
    status = JSON.parse(jsonStr) as XueqiuStatusJson;
  } catch {
    return null;
  }

  if (!status.text || typeof status.text !== "string") return null;
  const mainConv = htmlToMd(stripHiddenAndJsNoise(status.text));
  if (!mainConv.ok) return null;

  const warnings = [...mainConv.warnings];
  const parts: string[] = [];
  const author = status.user?.screen_name?.trim();
  if (author) parts.push(`> 作者：${author}`, "");
  parts.push(mainConv.md);

  const rt = status.retweeted_status;
  if (rt?.text && !rt.text.includes("原帖已删除")) {
    const rtConv = htmlToMd(stripHiddenAndJsNoise(rt.text));
    if (rtConv.ok && rtConv.md.trim()) {
      const rtAuthor = rt.user?.screen_name?.trim() || "原帖";
      const rtHeader = rt.title ? `**转发自 @${rtAuthor}：《${rt.title}》**` : `**转发自 @${rtAuthor}**`;
      const quoted = rtConv.md
        .split("\n")
        .map((line) => (line.trim() ? `> ${line}` : ">"))
        .join("\n");
      parts.push("", "---", "", `> ${rtHeader}`, ">", quoted);
    }
  }

  const rawTitle = (status.title ?? "").trim();
  const plainSnippet = mainConv.md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*`_\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title =
    rawTitle ||
    (author ? `${author}：${plainSnippet.slice(0, 36)}` : plainSnippet.slice(0, 44)) ||
    "雪球复盘笔记";

  const eventDate = status.created_at
    ? formatChinaDateFromEpoch(status.created_at)
    : formatChinaDateFromEpoch(Date.now());

  return {
    ok: true,
    title,
    md: parts.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    eventDate: eventDate || formatChinaDateFromEpoch(Date.now()),
    platform: "雪球",
    warnings,
  };
}

/**
 * Extracts main readable article content from an HTML document, with platform-aware extractors
 * for Xueqiu (`SNOWMAN_STATUS`), WeChat Official Accounts (`#js_content` + `var ct`), Zhihu (`.Post-RichText`),
 * Yuque, and generic blogs/docs.
 */
export function extractArticleFromHtml(html: string, sourceUrl: string): ExtractedArticle {
  const platform = detectPlatformFromUrl(sourceUrl);

  // 0) Reject Zhihu anti-bot JS VM challenge early (avoids false-positive decoy slogan)
  if (/zh-zse-ck|zse_ck|知乎，让每一次点击都充满意义/i.test(html)) {
    return {
      ok: false,
      requiresLogin: true,
      error:
        "知乎触发了人机风控校验（zse_ck），无法通过后端直接抓取。请在已登录浏览器中打开文章，使用「浏览器一键剪藏」或复制正文使用「快捷粘贴入库」。",
    };
  }

  // 1) Xueqiu: prefer embedded `window.SNOWMAN_STATUS` JSON over DOM (clean body + quoted retweet + exact +08:00 date)
  if (platform === "雪球") {
    const xq = tryExtractXueqiuFromStatusJson(html);
    if (xq) return xq;
  }

  // 2) WeChat Official Accounts: fail fast on deleted / violated / captcha pages
  if (platform === "微信公众号") {
    const hasJsContent = /id=["']js_content["']/i.test(html);
    if (
      !hasJsContent &&
      /weui-msg__title|此内容因违规无法查看|该内容已被发布者删除|当前环境异常/i.test(html)
    ) {
      return {
        ok: false,
        requiresLogin: true,
        error: "该微信公众号文章已被删除、违规下架或触发微信安全验证，无法抓取正文。",
      };
    }
  }

  const rawH1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "") || "";
  const cleanH1Raw = decodeHtmlEntities(rawH1).replace(/\s+/g, " ").trim();
  const cleanH1 = /^(?:加载中\.{0,3}|loading\.{0,3}|首页|博客)$/i.test(cleanH1Raw) ? "" : cleanH1Raw;

  const sinaTitleRaw =
    platform === "新浪博客"
      ? /<h2[^>]*class=["'][^"']*titName[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "") || ""
      : "";
  const cleanSinaTitle = decodeHtmlEntities(sinaTitleRaw).replace(/\s+/g, " ").trim();

  const ogOrDocTitle =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html)?.[1] ||
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ||
    "";

  const cleanDocTitle = decodeHtmlEntities(ogOrDocTitle)
    .replace(/\s*[-–_|·]\s*(雪球|语雀|飞书云文档|Notion|知乎|微信公众平台|新浪博客).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Prefer platform-specific title / concise <h1> when available (avoids bloated SEO <title> or placeholder "加载中...")
  const title =
    (cleanSinaTitle && cleanSinaTitle.length >= 2 ? cleanSinaTitle : "") ||
    (cleanH1 && cleanH1.length >= 2 && cleanH1.length <= 80 ? cleanH1 : cleanDocTitle.slice(0, 80));

  let dateHint =
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|publishdate|pubdate|date)["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
    /var\s+publish_time\s*=\s*["'](\d{4}-\d{2}-\d{2})/i.exec(html)?.[1] ||
    /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ||
    /<span[^>]*class=["'][^"']*time\s+SG_txtc[^"']*["'][^>]*>\s*\(?(\d{4}-\d{2}-\d{2})/i.exec(html)?.[1] ||
    "";

  // WeChat publish timestamp: `var ct = "1795073863";` or `ori_create_time: '1795073863'`
  if (!dateHint && platform === "微信公众号") {
    const ctMatch =
      /\bvar\s+ct\s*=\s*["'](\d{10})["']/.exec(html) ||
      /ori_create_time\s*[:=]\s*["']?(\d{10})["']?/.exec(html);
    if (ctMatch) {
      dateHint = formatChinaDateFromEpoch(Number(ctMatch[1]));
    }
  }

  // Generic 13-digit ms timestamp fallback (e.g. Xueqiu created_at when DOM fallback runs)
  if (!dateHint) {
    const tsMatch = /"created_at"\s*:\s*(\d{13})/.exec(html);
    if (tsMatch) {
      dateHint = formatChinaDateFromEpoch(Number(tsMatch[1]));
    }
  }

  // WeChat account nickname
  let wechatNickname = "";
  if (platform === "微信公众号") {
    const nickMatch = /var\s+nickname\s*=\s*htmlDecode\(["']([^"']+)["']\)/.exec(html);
    if (nickMatch) wechatNickname = decodeHtmlEntities(nickMatch[1]);
  }

  // Strip noisy structural chrome & hidden anti-copy watermarks before extraction
  const preCleaned = stripHiddenAndJsNoise(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, ""),
  );

  // Platform-specific main body extraction
  const mainChunk =
    extractBalancedElementByAttr(preCleaned, /<div\b[^>]*id=["']js_content["'][^>]*>/i) ||
    extractBalancedElementByAttr(preCleaned, /<div\b[^>]*id=["']sina_keyword_ad_area2["'][^>]*>/i) ||
    extractBalancedElementByAttr(preCleaned, /<div\b[^>]*class=["'][^"']*articalContent[^"']*["'][^>]*>/i) ||
    extractBalancedElementByAttr(preCleaned, /<div\b[^>]*class=["'][^"']*article__bd__detail[^"']*["'][^>]*>/i) ||
    extractBalancedElementByAttr(preCleaned, /<div\b[^>]*class=["'][^"']*Post-RichText[^"']*["'][^>]*>/i) ||
    extractBalancedElementByAttr(preCleaned, /<div\b[^>]*class=["'][^"']*ne-viewer-body[^"']*["'][^>]*>/i) ||
    extractBalancedElementByAttr(preCleaned, /<article\b[^>]*>/i) ||
    extractBalancedElementByAttr(preCleaned, /<main\b[^>]*>/i) ||
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(preCleaned)?.[1] ||
    preCleaned;

  const converted = htmlToMd(mainChunk);
  if (!converted.ok) {
    return {
      ok: false,
      requiresLogin: true,
      error: `未能从 ${platform} 页面提取到正文（可能是需要登录、动态 JS 渲染或防爬拦截）。建议直接在原页面复制后使用「快捷粘贴入库」，或使用「云端连接器 / 浏览器剪藏」。`,
    };
  }

  const md = converted.md.trim();
  const textWithoutPlaceholders = md.replace(/（图[^）]*）/g, "").trim();
  const isEmptySpaShell =
    /<div\b[^>]*id=["'](?:root|app|__next|ReactApp|notion-app)["'][^>]*>\s*<\/div>/i.test(html) &&
    textWithoutPlaceholders.length < 80;

  const loginWallPattern =
    /(请先登录|登录后查看|扫码登录|安全验证|访问过于频繁|Access Denied|Enable JavaScript|You need to enable JavaScript|验证码)/i;

  if (
    isEmptySpaShell ||
    textWithoutPlaceholders.length < 25 ||
    (textWithoutPlaceholders.length < 80 && loginWallPattern.test(md + " " + title))
  ) {
    return {
      ok: false,
      requiresLogin: true,
      error: `${platform} 页面为前端动态渲染或触发了登录校验，未能直接抓取到正文。请在已登录浏览器中复制内容使用「快捷粘贴入库」，或使用「浏览器一键剪藏」。`,
    };
  }

  const finalMd = wechatNickname ? `> 公众号：${wechatNickname}\n\n${md}` : md;
  const eventDate = normalizeDate(dateHint || md.slice(0, 300));
  return {
    ok: true,
    title: title || guessTitle(md, `${platform}复盘`),
    md: finalMd,
    eventDate,
    platform,
    warnings: converted.warnings,
  };
}

export type CloudIngestOutcome =
  | {
      ok: true;
      sourceRel: string;
      cardRel: string;
      title: string;
      eventDate: string;
      warnings: string[];
      index: VaultIndex;
    }
  | { ok: false; status: number; error: string; requiresLogin?: boolean };

export type PasteImportInput = {
  title?: string;
  content?: string;
  html?: string;
  eventDate?: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  tags?: string[];
  folder?: string;
};

/**
 * Saves pasted rich-text / Markdown or clipped cloud content into `workspace/sources/`
 * and rebuilds the Obsidian bi-directional vault.
 */
export async function importPastedReview(
  input: PasteImportInput,
  options?: { skipRebuild?: boolean },
): Promise<CloudIngestOutcome> {
  const warnings: string[] = [];
  let bodyMd = (input.content ?? "").trim();

  if (input.html && input.html.trim().length > 0) {
    const converted = htmlToMd(stripHiddenAndJsNoise(input.html));
    if (converted.ok && converted.md.trim().length > 0) {
      bodyMd = converted.md.trim();
      warnings.push(...converted.warnings);
    }
  }

  if (!bodyMd) {
    return { ok: false, status: 400, error: "复盘正文不能为空，请粘贴内容后再入库" };
  }

  const eventDate = normalizeDate(input.eventDate || bodyMd.slice(0, 200));
  const platform = (input.sourcePlatform ?? "快捷粘贴").trim() || "快捷粘贴";
  const resolvedTitle = (input.title ?? "").trim() || guessTitle(bodyMd, `${eventDate} ${platform}复盘`);
  const cleanTags = (input.tags ?? [])
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 12);

  const hash = createHash("sha256")
    .update(`${resolvedTitle}\n${input.sourceUrl ?? ""}\n${bodyMd}`)
    .digest("hex")
    .slice(0, 8);

  const folder = input.folder ? sanitizeSlug(input.folder) : "_导入";
  const safeBase = sanitizeSlug(resolvedTitle);
  const fileName = `${eventDate}_${safeBase}_${hash}.md`;
  const sourceRel = `${folder}/${fileName}`;

  const bodyWithoutDupH1 = bodyMd.replace(/^#\s+.+\n+/, "").trim();
  const metaLines = [
    `> 来源平台：${platform} · 复盘日期：\`${eventDate}\``,
    input.sourceUrl ? `> 原始链接：${input.sourceUrl}` : null,
    cleanTags.length > 0 ? `> 标签：${cleanTags.map((t) => `#${t}`).join(" ")}` : null,
  ].filter(Boolean);

  const finalMd = [
    `# ${resolvedTitle}`,
    "",
    ...metaLines,
    "",
    "---",
    "",
    bodyWithoutDupH1 || bodyMd,
    "",
  ].join("\n");

  const paths = await ensureWorkspace();
  await writeAtomic(path.join(paths.sources, sourceRel), finalMd);

  if (options?.skipRebuild) {
    return {
      ok: true,
      sourceRel,
      cardRel: "",
      title: resolvedTitle,
      eventDate,
      warnings,
      index: null as unknown as VaultIndex,
    };
  }

  const index = await rebuildVault();
  const matched = index.documents.find((d) => d.source_rel === sourceRel);

  return {
    ok: true,
    sourceRel,
    cardRel: matched?.card ?? "00-总览.md",
    title: resolvedTitle,
    eventDate,
    warnings,
    index,
  };
}

const MAX_BATCH_URLS = 50;
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Per-host polite pacing state (prevents burst WAF triggers during batch URL migration)
const hostQueues = new Map<string, Promise<unknown>>();
const hostLastFetchAt = new Map<string, number>();

function getHostMinIntervalMs(hostname: string): number {
  const h = hostname.toLowerCase();
  if (h.endsWith("xueqiu.com")) return 1_500;
  if (h.endsWith("mp.weixin.qq.com")) return 900;
  return 450;
}

async function paceHostRequest<T>(hostname: string, task: () => Promise<T>): Promise<T> {
  const key = hostname.toLowerCase().replace(/^www\./, "");
  const prev = hostQueues.get(key) ?? Promise.resolve();
  const minInterval = getHostMinIntervalMs(key);

  const next = prev.then(async () => {
    const last = hostLastFetchAt.get(key) ?? 0;
    const elapsed = Date.now() - last;
    if (last > 0 && elapsed < minInterval) {
      await sleep(minInterval - elapsed);
    }
    hostLastFetchAt.set(key, Date.now());
    try {
      return await task();
    } finally {
      hostLastFetchAt.set(key, Date.now());
    }
  });

  hostQueues.set(
    key,
    next.catch(() => {}),
  );
  return next;
}

// Cached Xueqiu guest session cookie (`xq_a_token` / `xqat`) to reduce Aliyun WAF friction
let xueqiuCookieCache: { cookie: string; fetchedAt: number } | null = null;
const XUEQIU_COOKIE_TTL_MS = 15 * 60_000;

async function getXueqiuCookieHeader(forceRefresh = false): Promise<string> {
  if (!forceRefresh && xueqiuCookieCache && Date.now() - xueqiuCookieCache.fetchedAt < XUEQIU_COOKIE_TTL_MS) {
    return xueqiuCookieCache.cookie;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("https://xueqiu.com/hq", {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": CHROME_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    const rawCookies: string[] =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : (res.headers.get("set-cookie") ?? "")
            .split(/,(?=\s*[A-Za-z0-9_.-]+=)/)
            .filter(Boolean);
    const pairs = rawCookies
      .map((c) => c.split(";")[0]?.trim())
      .filter((kv): kv is string => Boolean(kv && kv.includes("=")));
    const cookie = pairs.join("; ");
    if (cookie) {
      xueqiuCookieCache = { cookie, fetchedAt: Date.now() };
      return cookie;
    }
  } catch {
    /* ignore bootstrap failures, proceed without cookie */
  } finally {
    clearTimeout(timer);
  }
  return xueqiuCookieCache?.cookie ?? "";
}

/**
 * Detects Xueqiu / Aliyun WAF JS-challenge or temporary rate-limit decoy HTML
 * so the fetcher can refresh cookies and back off automatically.
 */
export function isXueqiuWafChallenge(html: string): boolean {
  if (!html) return true;
  if (html.includes("SNOWMAN_STATUS")) return false;
  if (/acw_sc__v2|aliyun_waf|var\s+arg1\s*=|__jsl_clearance|访问过于频繁|安全验证/i.test(html)) {
    return true;
  }
  const trimmed = html.trim();
  return trimmed.length < 4000 && /<script/i.test(trimmed) && !/<article|article__bd__detail/i.test(trimmed);
}

/**
 * Parses single or multi-line URL input into a deduplicated list (up to MAX_BATCH_URLS).
 */
export function parseBatchUrls(raw: string | string[]): string[] {
  const lines = Array.isArray(raw) ? raw : raw.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const cleaned = line
      .trim()
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)、]\s+/, "")
      .trim();
    if (!cleaned) continue;
    const match = cleaned.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
    if (!match) continue;
    const candidate = match[0].replace(/[),.;:!?，。；：！？】》」』'"）]+$/g, "").trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
    if (out.length >= MAX_BATCH_URLS) break;
  }
  return out;
}

/**
 * Fetches a public web/share URL safely with per-host polite pacing,
 * Xueqiu cookie bootstrap, and automatic WAF / rate-limit exponential backoff retry:
 * 1) Runs specialized public API / SSR resolvers for Yuque, Feishu, Notion, Youdao Note, Yinxiang/Evernote.
 * 2) Falls back to SSRF-safe HTML/Markdown fetch with specialized Xueqiu/WeChat/Zhihu extractors.
 */
export async function importFromUrl(
  input: {
    url: string;
    title?: string;
    eventDate?: string;
    tags?: string[];
  },
  options?: { skipRebuild?: boolean },
): Promise<CloudIngestOutcome> {
  const valid = validatePublicFetchUrl(input.url);
  if (!valid.ok) {
    return { ok: false, status: 400, error: valid.error };
  }
  const dnsCheck = await assertSafePublicDns(valid.hostname);
  if (!dnsCheck.ok) {
    return { ok: false, status: 403, error: dnsCheck.error };
  }

  // 1) Specialized public platform resolvers (Yuque / Feishu / Notion / Youdao / Yinxiang / Evernote)
  const resolved = await paceHostRequest(valid.hostname, () => resolveCloudPlatformUrl(valid.href));
  if (resolved.ok) {
    return importPastedReview(
      {
        title: input.title?.trim() || resolved.title,
        content: resolved.md,
        eventDate: input.eventDate || resolved.eventDate,
        sourcePlatform: resolved.platform,
        sourceUrl: valid.href,
        tags: input.tags,
        folder: "_云端",
      },
      options,
    );
  }
  if (resolved.handled) {
    return {
      ok: false,
      status: 422,
      error: resolved.error,
      requiresLogin: resolved.requiresLogin,
    };
  }

  // 2) Generic SSRF-safe HTML / Markdown fetch (WeChat, Xueqiu, GitHub raw, Blogs, etc.)
  const platform = detectPlatformFromUrl(valid.href);
  const isXueqiu = platform === "雪球";
  const maxAttempts = isXueqiu ? 3 : 2;
  const backoffScheduleMs = [4_000, 12_000];

  let lastStatus = 0;
  let lastError = "";
  let lastRequiresLogin = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(backoffScheduleMs[attempt - 1] ?? 12_000);
    }

    const xqCookie = isXueqiu ? await getXueqiuCookieHeader(attempt > 0) : "";

    const fetchOutcome = await paceHostRequest(valid.hostname, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const headers: Record<string, string> = {
          "User-Agent": CHROME_UA,
          Accept: "text/html,text/markdown,text/plain;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        };
        if (isXueqiu) {
          headers.Referer = "https://xueqiu.com/";
          if (xqCookie) headers.Cookie = xqCookie;
        }
        let currentHref = valid.href;
        let res: Response | null = null;
        for (let hop = 0; hop <= 5; hop++) {
          res = await fetch(currentHref, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers,
          });
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location");
            if (!loc || hop === 5) break;
            let nextUrl: string;
            try {
              nextUrl = new URL(loc, currentHref).href;
            } catch {
              return { kind: "network_error" as const, isTimeout: false, message: "重定向链接格式非法" };
            }
            const hopValid = validatePublicFetchUrl(nextUrl);
            if (!hopValid.ok) {
              return { kind: "network_error" as const, isTimeout: false, message: hopValid.error };
            }
            const hopDns = await assertSafePublicDns(hopValid.hostname);
            if (!hopDns.ok) {
              return { kind: "network_error" as const, isTimeout: false, message: hopDns.error };
            }
            currentHref = hopValid.href;
            continue;
          }
          break;
        }
        if (!res || !res.ok) {
          return { kind: "http_error" as const, status: res?.status ?? 502 };
        }
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > MAX_URL_BYTES) {
          return { kind: "too_large" as const };
        }
        return {
          kind: "ok" as const,
          buf: Buffer.from(arrayBuf),
          contentType: (res.headers.get("content-type") || "").toLowerCase(),
        };
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        return {
          kind: "network_error" as const,
          isTimeout,
          message: err instanceof Error ? err.message : "网络错误",
        };
      } finally {
        clearTimeout(timer);
      }
    });

    if (fetchOutcome.kind === "too_large") {
      return { ok: false, status: 413, error: "网页体积超过 10 MB 上限" };
    }

    if (fetchOutcome.kind === "network_error") {
      lastStatus = 502;
      lastError = fetchOutcome.isTimeout
        ? "抓取网页超时（12秒），请检查网络或改用「快捷粘贴入库」"
        : `抓取失败：${fetchOutcome.message}`;
      if (attempt < maxAttempts - 1) continue;
      return { ok: false, status: lastStatus, error: lastError };
    }

    if (fetchOutcome.kind === "http_error") {
      const code = fetchOutcome.status;
      if ((code === 429 || code === 503 || (isXueqiu && code === 403)) && attempt < maxAttempts - 1) {
        continue;
      }
      const zhihuHint =
        platform === "知乎"
          ? "知乎触发了反爬风控校验（HTTP 403），无法直接后端抓取。请在浏览器打开文章后使用「浏览器一键剪藏」或复制正文使用「快捷粘贴入库」。"
          : `${platform} 返回 HTTP ${code}，无法直接抓取。若该页面需要登录或有反爬限制，请复制内容使用「快捷粘贴入库」或「浏览器一键剪藏」。`;
      return {
        ok: false,
        status: 422,
        requiresLogin: code === 401 || code === 403,
        error: zhihuHint,
      };
    }

    const { text } = decodeText(fetchOutcome.buf);
    const contentType = fetchOutcome.contentType;

    // Direct Markdown or plain text URL (e.g. GitHub raw, Gist)
    if (contentType.includes("text/markdown") || contentType.includes("text/plain") || valid.href.endsWith(".md")) {
      return importPastedReview(
        {
          title: input.title?.trim() || guessTitle(text, `${platform}笔记`),
          content: text,
          eventDate: input.eventDate,
          sourcePlatform: platform,
          sourceUrl: valid.href,
          tags: input.tags,
          folder: "_云端",
        },
        options,
      );
    }

    // Retry Xueqiu Aliyun WAF challenge automatically with fresh guest cookie
    if (isXueqiu && isXueqiuWafChallenge(text) && attempt < maxAttempts - 1) {
      continue;
    }

    const extracted = extractArticleFromHtml(text, valid.href);
    if (!extracted.ok) {
      lastStatus = 422;
      lastError = extracted.error;
      lastRequiresLogin = Boolean(extracted.requiresLogin);
      if (isXueqiu && attempt < maxAttempts - 1) continue;
      return {
        ok: false,
        status: lastStatus,
        error: lastError,
        requiresLogin: lastRequiresLogin,
      };
    }

    return importPastedReview(
      {
        title: input.title?.trim() || extracted.title,
        content: extracted.md,
        eventDate: input.eventDate || extracted.eventDate,
        sourcePlatform: extracted.platform,
        sourceUrl: valid.href,
        tags: input.tags,
        folder: "_云端",
      },
      options,
    );
  }

  return {
    ok: false,
    status: lastStatus || 422,
    error: lastError || "网页抓取失败，请稍后重试或改用「快捷粘贴入库」",
    requiresLogin: lastRequiresLogin,
  };
}

export type BatchUrlItemResult = {
  url: string;
  ok: boolean;
  title?: string;
  eventDate?: string;
  sourceRel?: string;
  cardRel?: string;
  error?: string;
};

export type BatchUrlImportOutcome = {
  ok: boolean;
  batch: true;
  total: number;
  succeeded: number;
  failed: number;
  results: BatchUrlItemResult[];
  cardRel: string;
  index?: VaultIndex;
  error?: string;
};

/**
 * Batch URL migration queue:
 * - Processes up to 50 URLs sequentially with per-host polite pacing, Xueqiu cookie cache, and WAF retry
 * - Rebuilds the Obsidian bi-directional vault ONCE at the end (avoiding O(N^2) rebuild overhead)
 */
export async function importFromUrlsBatch(input: {
  urls: string[];
  eventDate?: string;
  tags?: string[];
}): Promise<BatchUrlImportOutcome> {
  const urls = parseBatchUrls(input.urls);
  if (urls.length === 0) {
    return {
      ok: false,
      batch: true,
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      cardRel: "",
      error: "请提供至少 1 条有效的公开网页链接",
    };
  }

  const results: BatchUrlItemResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const url of urls) {
    const out = await importFromUrl(
      {
        url,
        eventDate: input.eventDate,
        tags: input.tags,
      },
      { skipRebuild: true },
    );

    if (out.ok) {
      succeeded++;
      results.push({
        url,
        ok: true,
        title: out.title,
        eventDate: out.eventDate,
        sourceRel: out.sourceRel,
      });
    } else {
      failed++;
      results.push({
        url,
        ok: false,
        error: out.error,
      });
    }
  }

  if (succeeded === 0) {
    return {
      ok: false,
      batch: true,
      total: urls.length,
      succeeded: 0,
      failed,
      results,
      cardRel: "",
      error: results[0]?.error || "批量抓取全部失败，请检查链接是否公开可访问",
    };
  }

  const index = await rebuildVault();
  const bySource = new Map(index.documents.map((d) => [d.source_rel, d.card]));
  let lastCardRel = "00-总览.md";
  for (const r of results) {
    if (r.ok && r.sourceRel) {
      const card = bySource.get(r.sourceRel) ?? "00-总览.md";
      r.cardRel = card;
      lastCardRel = card;
    }
  }

  return {
    ok: true,
    batch: true,
    total: urls.length,
    succeeded,
    failed,
    results,
    cardRel: lastCardRel,
    index,
  };
}
