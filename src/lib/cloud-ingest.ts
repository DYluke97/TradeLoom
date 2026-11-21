import { createHash } from "node:crypto";
import path from "node:path";
import { decodeText, guessTitle, htmlToMd } from "./convert";
import { rebuildVault } from "./vault";
import type { VaultIndex } from "./vault-builder";
import { ensureWorkspace, writeAtomic } from "./workspace";

const MAX_URL_BYTES = 4 * 1024 * 1024;
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
  if (!raw) return new Date().toISOString().slice(0, 10);
  const m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(raw.trim());
  if (!m) return new Date().toISOString().slice(0, 10);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) {
    return new Date().toISOString().slice(0, 10);
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
    if (host.includes("yinxiang.com") || host.includes("evernote.com")) return "印象笔记";
    if (host.includes("dida365.com") || host.includes("ticktick.com")) return "滴答清单";
    if (host.includes("mp.weixin.qq.com")) return "微信公众号";
    if (host.includes("zhihu.com")) return "知乎";
    if (host.includes("github.com") || host.includes("raw.githubusercontent.com")) return "GitHub";
    return host.replace(/^www\./, "");
  } catch {
    return "网页抓取";
  }
}

function isPrivateIpOrHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localhost")
  ) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    return true;
  }
  const m172 = /^172\.(\d+)\./.exec(h);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^(fc|fd|fe80)/i.test(h)) return true;
  return false;
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

export type ExtractedArticle = {
  ok: true;
  title: string;
  md: string;
  eventDate: string;
  platform: string;
  warnings: string[];
} | {
  ok: false;
  error: string;
  requiresLogin?: boolean;
};

/**
 * Extracts main readable article content from an HTML document, with platform-aware selectors
 * for WeChat Official Accounts, Xueqiu, Yuque, and generic blogs/docs.
 */
export function extractArticleFromHtml(html: string, sourceUrl: string): ExtractedArticle {
  const platform = detectPlatformFromUrl(sourceUrl);

  const ogTitle =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html)?.[1] ||
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ||
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "") ||
    "";

  const title = decodeHtmlEntities(ogTitle).replace(/\s*[-–_|·]\s*(雪球|语雀|飞书云文档|Notion|知乎|微信公众平台).*$/i, "").trim();

  const dateHint =
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|publishdate|pubdate|date)["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
    /var\s+publish_time\s*=\s*["'](\d{4}-\d{2}-\d{2})/i.exec(html)?.[1] ||
    /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ||
    "";

  // Strip noisy structural chrome before extraction
  const preCleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, "");

  // Platform-specific main body extraction
  const mainChunk =
    extractBalancedElementByAttr(preCleaned, /<div\b[^>]*id=["']js_content["'][^>]*>/i) ||
    extractBalancedElementByAttr(preCleaned, /<div\b[^>]*class=["'][^"']*article__bd__detail[^"']*["'][^>]*>/i) ||
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
      error: `未能从 ${platform} 页面提取到正文（可能是需要登录、动态 JS 渲染或防爬拦截）。建议直接在原页面全选复制后使用「快捷粘贴入库」，或使用「云端连接器 / 浏览器剪藏」。`,
    };
  }

  const md = converted.md.trim();
  const loginWallPattern =
    /(请先登录|登录后查看|扫码登录|安全验证|访问过于频繁|Access Denied|Enable JavaScript|验证码)/i;
  if (md.length < 60 && loginWallPattern.test(md + " " + title)) {
    return {
      ok: false,
      requiresLogin: true,
      error: `${platform} 页面触发了登录墙或人机校验，无法直接抓取。请在已登录浏览器中复制内容使用「快捷粘贴入库」，或点击「浏览器一键剪藏」。`,
    };
  }

  const eventDate = normalizeDate(dateHint || md.slice(0, 300));
  return {
    ok: true,
    title: title || guessTitle(md, `${platform}复盘`),
    md,
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
    const converted = htmlToMd(input.html);
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

/**
 * Fetches a public web/share URL safely, converts readable article content to Markdown,
 * archives it in `sources/_云端/`, and rebuilds the Obsidian vault.
 */
export async function importFromUrl(input: {
  url: string;
  title?: string;
  eventDate?: string;
  tags?: string[];
}): Promise<CloudIngestOutcome> {
  const valid = validatePublicFetchUrl(input.url);
  if (!valid.ok) {
    return { ok: false, status: 400, error: valid.error };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(valid.href, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,text/markdown,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });

    if (!res.ok) {
      const platform = detectPlatformFromUrl(valid.href);
      return {
        ok: false,
        status: 422,
        requiresLogin: res.status === 401 || res.status === 403,
        error: `${platform} 返回 HTTP ${res.status}，无法直接抓取。若该页面需要登录或有反爬限制，请复制内容使用「快捷粘贴入库」或「浏览器一键剪藏」。`,
      };
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > MAX_URL_BYTES) {
      return { ok: false, status: 413, error: "网页体积超过 4 MB 上限" };
    }

    const buf = Buffer.from(arrayBuf);
    const { text } = decodeText(buf);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();

    // Direct Markdown or plain text URL (e.g. GitHub raw, Gist)
    if (contentType.includes("text/markdown") || contentType.includes("text/plain") || valid.href.endsWith(".md")) {
      const platform = detectPlatformFromUrl(valid.href);
      return importPastedReview({
        title: input.title?.trim() || guessTitle(text, `${platform}笔记`),
        content: text,
        eventDate: input.eventDate,
        sourcePlatform: platform,
        sourceUrl: valid.href,
        tags: input.tags,
        folder: "_云端",
      });
    }

    const extracted = extractArticleFromHtml(text, valid.href);
    if (!extracted.ok) {
      return {
        ok: false,
        status: 422,
        error: extracted.error,
        requiresLogin: extracted.requiresLogin,
      };
    }

    return importPastedReview({
      title: input.title?.trim() || extracted.title,
      content: extracted.md,
      eventDate: input.eventDate || extracted.eventDate,
      sourcePlatform: extracted.platform,
      sourceUrl: valid.href,
      tags: input.tags,
      folder: "_云端",
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: 502,
      error: isTimeout
        ? "抓取网页超时（12秒），请检查网络或改用「快捷粘贴入库」"
        : `抓取失败：${err instanceof Error ? err.message : "网络错误"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
