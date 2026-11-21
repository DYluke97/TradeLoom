import { htmlToMd } from "./convert";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CRAWLER_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const RESOLVER_TIMEOUT_MS = 12_000;

export type ResolvedCloudDoc =
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
      handled: true; // Resolver owned this URL and produced a definitive error
    }
  | {
      ok: false;
      handled: false; // Not matched or should fall back to generic HTML fetch
    };

/**
 * Formats a Unix timestamp (seconds or milliseconds) as YYYY-MM-DD in Asia/Shanghai (UTC+8).
 */
export function formatChinaDateFromEpoch(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const shifted = new Date(ms + 8 * 3600_000);
  if (Number.isNaN(shifted.getTime())) return "";
  const y = shifted.getUTCFullYear();
  if (y < 2000 || y > 2100) return "";
  return shifted.toISOString().slice(0, 10);
}

/**
 * Extracts a balanced JSON object starting from the first `{` at or after `startIndex`.
 */
export function extractBalancedJsonObject(src: string, startIndex: number): string | null {
  const openIdx = src.indexOf("{", startIndex);
  if (openIdx < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return src.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVER_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ==================== 1. 语雀 (Yuque) ==================== */

async function resolveYuqueUrl(parsed: URL): Promise<ResolvedCloudDoc> {
  if (!parsed.hostname.toLowerCase().endsWith("yuque.com")) return { ok: false, handled: false };

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return { ok: false, handled: false };

  // Book index URL (e.g. /user/book without doc slug)
  if (segments.length === 2) {
    return {
      ok: false,
      handled: true,
      error:
        "这是语雀知识库目录首页链接。请粘贴具体某篇文档的链接（形如 yuque.com/用户名/知识库/文档slug），或在「设置 → 云端平台连接器」配置语雀 Token 一键同步整本知识库。",
    };
  }

  const [ns, book, slug] = segments;
  const docBase = `${parsed.origin}/${ns}/${book}/${slug}`;

  try {
    // Fetch HTML for appData metadata (title, book_id, published_at) AND raw markdown in parallel
    const [htmlRes, mdRes] = await Promise.all([
      fetchWithTimeout(docBase, { headers: { "User-Agent": BROWSER_UA } }),
      fetchWithTimeout(`${docBase}/markdown?plain=true&linebreak=false&anchor=false`, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/plain,*/*" },
      }),
    ]);

    let title = "";
    let eventDate = "";
    let bookId: number | string | null = null;
    let docSlug = slug;

    if (htmlRes.ok) {
      const html = await htmlRes.text();
      const appDataMatch = /window\.appData\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/.exec(html);
      if (appDataMatch) {
        try {
          const appData = JSON.parse(decodeURIComponent(appDataMatch[1])) as {
            doc?: { title?: string; slug?: string; book_id?: number; published_at?: string; updated_at?: string };
          };
          if (appData.doc) {
            title = appData.doc.title?.trim() ?? "";
            docSlug = appData.doc.slug || slug;
            bookId = appData.doc.book_id ?? null;
            const rawDate = appData.doc.published_at || appData.doc.updated_at || "";
            if (rawDate) {
              const ms = Date.parse(rawDate);
              if (!Number.isNaN(ms)) eventDate = formatChinaDateFromEpoch(ms);
            }
          }
        } catch {
          /* ignore appData parse errors */
        }
      }
    }

    // 1) Prefer raw Markdown endpoint
    if (mdRes.ok) {
      const ctype = (mdRes.headers.get("content-type") || "").toLowerCase();
      const rawMd = await mdRes.text();
      if (!ctype.includes("text/html") && rawMd.trim().length > 20) {
        const cleaned = rawMd
          .replace(/<font[^>]*>/gi, "")
          .replace(/<\/font>/gi, "")
          .replace(/<a\s+name="[^"]*"><\/a>/gi, "")
          .replace(/\r\n?/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return {
          ok: true,
          title: title || slug,
          md: cleaned,
          eventDate,
          platform: "语雀",
          warnings: [],
        };
      }
    }

    // 2) Fallback to public Lake JSON API if book_id was extracted
    if (bookId) {
      const apiRes = await fetchWithTimeout(
        `https://www.yuque.com/api/docs/${encodeURIComponent(docSlug)}?book_id=${encodeURIComponent(String(bookId))}&merge_dynamic_data=false`,
        { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } },
      );
      if (apiRes.ok) {
        const json = (await apiRes.json()) as {
          data?: { title?: string; content?: string; published_at?: string; updated_at?: string };
        };
        if (json.data?.content) {
          const converted = htmlToMd(json.data.content);
          if (converted.ok) {
            const rawDate = json.data.published_at || json.data.updated_at || "";
            const dateFromApi = rawDate && !Number.isNaN(Date.parse(rawDate)) ? formatChinaDateFromEpoch(Date.parse(rawDate)) : "";
            return {
              ok: true,
              title: json.data.title?.trim() || title || slug,
              md: converted.md,
              eventDate: dateFromApi || eventDate,
              platform: "语雀",
              warnings: converted.warnings,
            };
          }
        }
      }
    }

    return {
      ok: false,
      handled: true,
      requiresLogin: true,
      error:
        "未能抓取该语雀文档（可能是私密知识库或未开启公开阅读）。请在「设置 → 云端平台连接器」配置语雀 Token 直连同步，或复制正文使用「快捷粘贴入库」。",
    };
  } catch (err) {
    return {
      ok: false,
      handled: true,
      error: `语雀文档抓取失败：${err instanceof Error ? err.message : "网络错误"}`,
    };
  }
}

/* ==================== 2. 飞书公开文档 (Feishu / Lark) ==================== */

type FeishuBlock = {
  id?: string;
  data?: {
    type?: string;
    children?: string[];
    text?: {
      initialAttributedTexts?: {
        text?: Record<string, string>;
      };
    };
    language?: string;
  };
};

export function parseFeishuBlockMapToMarkdown(blockMap: Record<string, FeishuBlock>): {
  title: string;
  md: string;
} {
  const entries = Object.values(blockMap);
  const root = entries.find((b) => b?.data?.type === "page") ?? entries[0];
  if (!root) return { title: "", md: "" };

  const blockText = (b?: FeishuBlock): string => {
    const map = b?.data?.text?.initialAttributedTexts?.text;
    if (!map || typeof map !== "object") return "";
    return Object.keys(map)
      .sort((a, bKey) => Number(a) - Number(bKey))
      .map((k) => map[k] ?? "")
      .join("")
      .trim();
  };

  const title = blockText(root);
  const lines: string[] = [];
  const visited = new Set<string>();

  const walk = (id: string, depth: number) => {
    if (!id || visited.has(id) || depth > 24) return;
    visited.add(id);
    const b = blockMap[id];
    if (!b?.data) return;
    const type = b.data.type ?? "";
    const txt = blockText(b);
    const children = Array.isArray(b.data.children) ? b.data.children : [];

    switch (type) {
      case "heading1":
        if (txt) lines.push(`# ${txt}`, "");
        break;
      case "heading2":
        if (txt) lines.push(`## ${txt}`, "");
        break;
      case "heading3":
        if (txt) lines.push(`### ${txt}`, "");
        break;
      case "heading4":
        if (txt) lines.push(`#### ${txt}`, "");
        break;
      case "heading5":
      case "heading6":
        if (txt) lines.push(`##### ${txt}`, "");
        break;
      case "bullet":
        if (txt) lines.push(`- ${txt}`);
        break;
      case "ordered":
        if (txt) lines.push(`1. ${txt}`);
        break;
      case "todo":
        if (txt) lines.push(`- [ ] ${txt}`);
        break;
      case "quote":
      case "callout":
        if (txt) lines.push(`> ${txt}`, "");
        break;
      case "code":
        if (txt) lines.push(`\`\`\`${b.data.language ?? ""}`, txt, "```", "");
        break;
      case "divider":
        lines.push("---", "");
        break;
      case "image":
        lines.push("（图）", "");
        break;
      case "page":
        break;
      default:
        if (txt) lines.push(txt, "");
        break;
    }

    for (const childId of children) {
      walk(childId, depth + 1);
    }
  };

  for (const childId of root.data?.children ?? []) {
    walk(childId, 0);
  }

  return {
    title,
    md: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

async function resolveFeishuUrl(parsed: URL): Promise<ResolvedCloudDoc> {
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith("feishu.cn") && !host.endsWith("larksuite.com")) {
    return { ok: false, handled: false };
  }

  try {
    // Crawler UA bypasses Feishu's guest-SSO JS redirect and returns full SSR HTML with clientVars.data.block_map
    const res = await fetchWithTimeout(parsed.href, {
      headers: {
        "User-Agent": CRAWLER_UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
    });

    if (!res.ok || res.url.includes("accounts.feishu.cn") || res.url.includes("accounts.larksuite.com")) {
      return {
        ok: false,
        handled: true,
        requiresLogin: true,
        error:
          "该飞书文档未开启「互联网获得链接的人可阅读」或需要企业登录。请在「设置 → 云端平台连接器」配置飞书应用直连，或在飞书内复制正文使用「快捷粘贴入库」。",
      };
    }

    const html = await res.text();
    if (html.includes('"isPermitted":false')) {
      return {
        ok: false,
        handled: true,
        requiresLogin: true,
        error: "该飞书文档暂无公开访问权限，请使用「快捷粘贴入库」或「飞书连接器」读取。",
      };
    }

    let title = "";
    let eventDate = "";
    const metaTitle = /"title"\s*:\s*"((?:[^"\\]|\\.)+)"/.exec(html);
    if (metaTitle) {
      try {
        title = JSON.parse(`"${metaTitle[1]}"`) as string;
      } catch {
        title = metaTitle[1];
      }
    }
    const timeMatch = /"(?:edit_time|create_time)"\s*:\s*"?(\d{10})"?/.exec(html);
    if (timeMatch) {
      eventDate = formatChinaDateFromEpoch(Number(timeMatch[1]));
    }

    // Parse full structured block_map from clientVars
    const cvIdx = html.indexOf("clientVars:");
    if (cvIdx >= 0) {
      const jsonStr = extractBalancedJsonObject(html, cvIdx);
      if (jsonStr) {
        try {
          const clientVars = JSON.parse(jsonStr) as {
            data?: { block_map?: Record<string, FeishuBlock> };
          };
          const blockMap = clientVars?.data?.block_map;
          if (blockMap && Object.keys(blockMap).length > 0) {
            const parsedDoc = parseFeishuBlockMapToMarkdown(blockMap);
            if (parsedDoc.md.length > 0) {
              return {
                ok: true,
                title: parsedDoc.title || title || "飞书文档",
                md: parsedDoc.md,
                eventDate,
                platform: "飞书文档",
                warnings: [],
              };
            }
          }
        } catch {
          /* fall through to DOM */
        }
      }
    }

    return {
      ok: false,
      handled: true,
      requiresLogin: true,
      error:
        "未能从该飞书页面解析出完整文档结构（可能是多维表格/私密文档）。推荐使用「设置 → 飞书连接器」或直接复制正文使用「快捷粘贴入库」。",
    };
  } catch (err) {
    return {
      ok: false,
      handled: true,
      error: `飞书文档抓取失败：${err instanceof Error ? err.message : "网络错误"}`,
    };
  }
}

/* ==================== 3. Notion 公开页 (loadCachedPageChunkV2) ==================== */

type NotionTextSegment = [string, Array<[string, ...string[]]>?];
type NotionRecordBlock = {
  id?: string;
  type?: string;
  properties?: {
    title?: NotionTextSegment[];
    checked?: string[][];
    language?: string[][];
  };
  content?: string[];
  created_time?: number;
  last_edited_time?: number;
};

function renderNotionRichText(segments?: NotionTextSegment[]): string {
  if (!Array.isArray(segments)) return "";
  return segments
    .map(([text, marks]) => {
      if (!text) return "";
      if (!Array.isArray(marks) || marks.length === 0) return text;
      let out = text;
      for (const mark of marks) {
        if (!Array.isArray(mark)) continue;
        const [kind, arg] = mark;
        if (kind === "b") out = `**${out}**`;
        else if (kind === "i") out = `*${out}*`;
        else if (kind === "c") out = `\`${out}\``;
        else if (kind === "s") out = `~~${out}~~`;
        else if (kind === "a" && arg) out = `[${out}](${arg})`;
      }
      return out;
    })
    .join("")
    .trim();
}

export function parseNotionRecordMapToMarkdown(
  blockMap: Record<string, { value?: { value?: NotionRecordBlock } | NotionRecordBlock }>,
  pageUuid: string,
): { title: string; md: string; eventDate: string } {
  const unwrap = (id: string): NotionRecordBlock | null => {
    const entry = blockMap[id];
    if (!entry?.value) return null;
    const v = entry.value as { value?: NotionRecordBlock } & NotionRecordBlock;
    return v.value && typeof v.value === "object" && "type" in v.value ? v.value : v;
  };

  const root = unwrap(pageUuid) ?? Object.keys(blockMap).map(unwrap).find((b) => b?.type === "page") ?? null;
  if (!root) return { title: "", md: "", eventDate: "" };

  const title = renderNotionRichText(root.properties?.title);
  const eventDate = formatChinaDateFromEpoch(root.last_edited_time || root.created_time || 0);
  const lines: string[] = [];
  const visited = new Set<string>();

  const walk = (id: string, depth: number) => {
    if (!id || visited.has(id) || depth > 20) return;
    visited.add(id);
    const b = unwrap(id);
    if (!b?.type) return;
    const txt = renderNotionRichText(b.properties?.title);

    switch (b.type) {
      case "header":
        if (txt) lines.push(`# ${txt}`, "");
        break;
      case "sub_header":
        if (txt) lines.push(`## ${txt}`, "");
        break;
      case "sub_sub_header":
        if (txt) lines.push(`### ${txt}`, "");
        break;
      case "bulleted_list":
        if (txt) lines.push(`- ${txt}`);
        break;
      case "numbered_list":
        if (txt) lines.push(`1. ${txt}`);
        break;
      case "to_do": {
        const checked = b.properties?.checked?.[0]?.[0] === "Yes";
        if (txt) lines.push(`- [${checked ? "x" : " "}] ${txt}`);
        break;
      }
      case "quote":
      case "callout":
        if (txt) lines.push(`> ${txt}`, "");
        break;
      case "code": {
        const lang = b.properties?.language?.[0]?.[0] ?? "";
        if (txt) lines.push(`\`\`\`${lang.toLowerCase()}`, txt, "```", "");
        break;
      }
      case "divider":
        lines.push("---", "");
        break;
      case "image":
        lines.push("（图）", "");
        break;
      case "toggle":
        if (txt) lines.push(`**${txt}**`, "");
        break;
      case "page":
        if (depth > 0 && txt) lines.push(`- ${txt}`);
        return; // Don't recurse into nested sub-pages
      default:
        if (txt) lines.push(txt, "");
        break;
    }

    for (const childId of b.content ?? []) {
      walk(childId, depth + 1);
    }
  };

  for (const childId of root.content ?? []) {
    walk(childId, 0);
  }

  return {
    title,
    md: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    eventDate,
  };
}

function extractNotionUuid(url: string): string | null {
  const m = /([0-9a-f]{32})(?:[?#]|$)/i.exec(url) || /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(url);
  if (!m) return null;
  const hex = m[1].replace(/-/g, "").toLowerCase();
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function resolveNotionPublicUrl(parsed: URL): Promise<ResolvedCloudDoc> {
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith("notion.site") && !host.endsWith("notion.so")) {
    return { ok: false, handled: false };
  }

  const pageUuid = extractNotionUuid(parsed.pathname);
  if (!pageUuid) {
    return {
      ok: false,
      handled: true,
      requiresLogin: true,
      error:
        "未能从该 Notion 短链中解析出 32 位页面 ID。请粘贴带页面 ID 的公开链接，或使用「设置 → Notion 连接器」/「快捷粘贴入库」。",
    };
  }

  try {
    const mergedBlocks: Record<string, { value?: { value?: NotionRecordBlock } | NotionRecordBlock }> = {};
    let cursor: { stack: unknown[] } = { stack: [] };

    for (let chunkNumber = 0; chunkNumber < 4; chunkNumber++) {
      const res = await fetchWithTimeout("https://www.notion.so/api/v3/loadCachedPageChunkV2", {
        method: "POST",
        headers: {
          "User-Agent": BROWSER_UA,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page: { id: pageUuid },
          limit: 100,
          cursor,
          chunkNumber,
          verticalColumns: false,
        }),
      });

      if (!res.ok) {
        if (chunkNumber === 0) {
          return {
            ok: false,
            handled: true,
            requiresLogin: true,
            error:
              "该 Notion 页面未开启「Publish to Web」或需要登录权限。请在「设置 → Notion 连接器」配置 Integration Token 同步，或直接复制正文使用「快捷粘贴入库」。",
          };
        }
        break;
      }

      const json = (await res.json()) as {
        recordMap?: { block?: Record<string, { value?: { value?: NotionRecordBlock } | NotionRecordBlock }> };
        cursor?: { stack?: unknown[] };
      };
      if (json.recordMap?.block) {
        Object.assign(mergedBlocks, json.recordMap.block);
      }
      if (!json.cursor?.stack || json.cursor.stack.length === 0) break;
      cursor = { stack: json.cursor.stack };
    }

    const parsedDoc = parseNotionRecordMapToMarkdown(mergedBlocks, pageUuid);
    if (!parsedDoc.md) {
      return {
        ok: false,
        handled: true,
        requiresLogin: true,
        error:
          "该 Notion 页面正文为空或需要登录授权（若为数据库视图，请使用「设置 → Notion 连接器」按 Database ID 同步）。",
      };
    }

    return {
      ok: true,
      title: parsedDoc.title || "Notion 公开笔记",
      md: parsedDoc.md,
      eventDate: parsedDoc.eventDate,
      platform: "Notion",
      warnings: [],
    };
  } catch (err) {
    return {
      ok: false,
      handled: true,
      error: `Notion 公开页抓取失败：${err instanceof Error ? err.message : "网络错误"}`,
    };
  }
}

/* ==================== 4. 有道云笔记公开分享 (Youdao Note) ==================== */

async function resolveYoudaoPublicUrl(parsed: URL): Promise<ResolvedCloudDoc> {
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith("note.youdao.com") && !host.endsWith("youdao.com")) {
    return { ok: false, handled: false };
  }

  try {
    let noteId = parsed.searchParams.get("id") || "";

    // Follow /s/<shortKey> redirect to extract ?id=<32hex>
    if (!noteId && /\/s\/[A-Za-z0-9_-]+/.test(parsed.pathname)) {
      const r = await fetchWithTimeout(parsed.href, {
        headers: { "User-Agent": BROWSER_UA },
      });
      const finalUrl = new URL(r.url);
      noteId = finalUrl.searchParams.get("id") || "";
    }

    if (!noteId) {
      return {
        ok: false,
        handled: true,
        requiresLogin: true,
        error:
          "未能识别有道云笔记分享 ID。请确认粘贴的是有道云笔记「公开分享链接」（如 note.youdao.com/s/...），或复制正文使用「快捷粘贴入库」。",
      };
    }

    // CRITICAL: sev=j1 ensures newer JSON-editor (.note v2) notes render as clean HTML instead of XML fallback
    const apiRes = await fetchWithTimeout(
      `https://note.youdao.com/yws/public/note/${encodeURIComponent(noteId)}?sev=j1&editorType=0`,
      { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } },
    );

    if (!apiRes.ok) {
      return {
        ok: false,
        handled: true,
        requiresLogin: true,
        error: "有道云笔记分享链接已失效或需要密码/登录，请使用「快捷粘贴入库」或「浏览器一键剪藏」。",
      };
    }

    const json = (await apiRes.json()) as {
      tl?: string;
      content?: string;
      ct?: number;
      mt?: number;
    };

    const title = (json.tl ?? "").trim();
    const rawContent = (json.content ?? "").trim();
    if (!rawContent) {
      if (/\.(pdf|docx?|xlsx?|pptx?|zip)$/i.test(title)) {
        return {
          ok: false,
          handled: true,
          error: `该有道云笔记分享的是附件文件（${title}）而非文本笔记，请下载后使用左上角「本地」上传。`,
        };
      }
      return {
        ok: false,
        handled: true,
        requiresLogin: true,
        error: "该有道云笔记分享内容为空或暂不支持公开读取，请使用「快捷粘贴入库」或「浏览器一键剪藏」。",
      };
    }

    const converted = htmlToMd(rawContent);
    if (!converted.ok) {
      return {
        ok: false,
        handled: true,
        error: "有道云笔记正文转换失败，建议使用「快捷粘贴入库」。",
      };
    }

    const eventDate = formatChinaDateFromEpoch(json.mt || json.ct || 0);
    return {
      ok: true,
      title: title || "有道云笔记复盘",
      md: converted.md,
      eventDate,
      platform: "有道云笔记",
      warnings: converted.warnings,
    };
  } catch (err) {
    return {
      ok: false,
      handled: true,
      error: `有道云笔记抓取失败：${err instanceof Error ? err.message : "网络错误"}`,
    };
  }
}

/* ==================== 5. 印象笔记公开分享 (Yinxiang CN) & Evernote Intl ==================== */

export function unwrapYinxiangHtml(raw: string): string {
  const trimmed = raw.trim();
  // SuperNote / ENEX XML wraps inner HTML inside <content><![CDATA[...]]></content>
  const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(trimmed);
  if (cdataMatch) {
    const inner = cdataMatch[1];
    const enNote = /<en-note\b[^>]*>([\s\S]*?)<\/en-note>/i.exec(inner);
    return enNote ? enNote[1] : inner;
  }
  const enNoteDirect = /<en-note\b[^>]*>([\s\S]*?)<\/en-note>/i.exec(trimmed);
  return enNoteDirect ? enNoteDirect[1] : trimmed;
}

async function resolveYinxiangOrEvernoteUrl(parsed: URL): Promise<ResolvedCloudDoc> {
  const host = parsed.hostname.toLowerCase();

  // International Evernote (Bending Spoons SPA, no public unauth REST JSON)
  if (host.endsWith("evernote.com")) {
    return {
      ok: false,
      handled: true,
      requiresLogin: true,
      error:
        "Evernote 国际版公开分享页为纯前端加密 SPA，不支持后端直抓。请在浏览器打开该页面后使用「浏览器一键剪藏」或复制正文使用「快捷粘贴入库」（也可导出 .html 批量上传）。",
    };
  }

  if (!host.endsWith("yinxiang.com")) return { ok: false, handled: false };

  const guidMatch = /\/fx\/([0-9a-f-]{32,40})/i.exec(parsed.pathname);
  if (!guidMatch) {
    return {
      ok: false,
      handled: true,
      requiresLogin: true,
      error:
        "未能识别印象笔记公开分享链接（标准格式为 app.yinxiang.com/fx/<guid>）。请使用「快捷粘贴入库」或「浏览器一键剪藏」。",
    };
  }

  try {
    const guid = guidMatch[1];
    const apiRes = await fetchWithTimeout(
      `https://app.yinxiang.com/third/share/note/detailForPublic?guid=${encodeURIComponent(guid)}`,
      { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } },
    );

    if (!apiRes.ok) {
      return {
        ok: false,
        handled: true,
        requiresLogin: true,
        error: "印象笔记分享链接已失效或已取消公开分享，请使用「快捷粘贴入库」或「浏览器一键剪藏」。",
      };
    }

    const json = (await apiRes.json()) as {
      code?: number;
      content?: {
        title?: string;
        html?: string;
        created?: number;
        updated?: number;
      };
    };

    if (json.code !== 200 || !json.content?.html) {
      return {
        ok: false,
        handled: true,
        requiresLogin: true,
        error: "印象笔记接口未返回正文（可能需要登录或链接已过期），请使用「快捷粘贴入库」或「浏览器一键剪藏」。",
      };
    }

    const unwrapped = unwrapYinxiangHtml(json.content.html);
    const converted = htmlToMd(unwrapped);
    if (!converted.ok) {
      return {
        ok: false,
        handled: true,
        error: "印象笔记内容转换失败，请使用「快捷粘贴入库」。",
      };
    }

    const eventDate = formatChinaDateFromEpoch(json.content.updated || json.content.created || 0);
    return {
      ok: true,
      title: json.content.title?.trim() || "印象笔记复盘",
      md: converted.md,
      eventDate,
      platform: "印象笔记",
      warnings: converted.warnings,
    };
  } catch (err) {
    return {
      ok: false,
      handled: true,
      error: `印象笔记抓取失败：${err instanceof Error ? err.message : "网络错误"}`,
    };
  }
}

/* ==================== Dispatcher ==================== */

/**
 * Attempts platform-specific unauthenticated public API / SSR resolvers before generic HTML scraping.
 * Covers: Yuque, Feishu/Lark, Notion, Youdao Note, Yinxiang/Evernote.
 */
export async function resolveCloudPlatformUrl(rawUrl: string): Promise<ResolvedCloudDoc> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, handled: false };
  }

  for (const resolver of [
    resolveYuqueUrl,
    resolveFeishuUrl,
    resolveNotionPublicUrl,
    resolveYoudaoPublicUrl,
    resolveYinxiangOrEvernoteUrl,
  ]) {
    const out = await resolver(parsed);
    if (out.ok || out.handled) return out;
  }

  return { ok: false, handled: false };
}
