import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OneNoteFolderSummary = {
  id: string;
  name: string;
  isRoot?: boolean;
};

export type OneNoteNotebookInfo = {
  id: string;
  name: string;
  nickname?: string;
};

export type OneNoteSectionInfo = {
  id: string;
  name: string;
  notebookId: string;
  notebookName: string;
  groupPath?: string;
};

export type OneNotePageMeta = {
  id: string;
  name: string;
  notebookId: string;
  notebookName: string;
  sectionId: string;
  sectionName: string;
  groupPath?: string;
  dateTime?: string;
  lastModifiedTime?: string;
  pageLevel?: number;
};

export type OneNoteHierarchyResult = {
  notebooks: OneNoteNotebookInfo[];
  sections: OneNoteSectionInfo[];
  pages: OneNotePageMeta[];
  folders: OneNoteFolderSummary[];
};

export type OneNoteFetchedPage = {
  id: string;
  title: string;
  content: string;
  notebookName: string;
  sectionName: string;
  groupPath?: string;
  eventDate?: string;
  tags: string[];
};

export function encodePowerShellScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function formatOneNoteLocalError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "未知错误");
  if (/NON_WINDOWS_PLATFORM|ENOENT.*powershell/i.test(msg)) {
    return "本机 OneNote 直连仅支持 Windows 系统；macOS / Linux 用户可在 OneNote 中将页面导出为 .docx 或 .pdf 后，拖入 TradeLoom 知识库本地导入。";
  }
  if (/80040154|REGDB_E_CLASSNOTREG|Class not registered|Retrieving the COM class factory|Cannot create ActiveX|未能创建.*OneNote|无法创建.*OneNote/i.test(msg)) {
    return "未检测到 Windows 桌面版 OneNote（旧版微软商店 UWP 版不开放本机接口）。请点击上方「免费下载桌面版 OneNote」安装微软官方桌面版，打开并同步您的笔记本后再点检测。";
  }
  if (/800706BE|800706BA|80080005|RPC|CO_E_SERVER_EXEC_FAILURE|0x80042001/i.test(msg)) {
    return "本机 OneNote COM 通信被系统拦截（常见原因：OneNote 与 TradeLoom 权限级别不一致，例如一侧用了管理员权限、另一侧为普通权限，或 OneNote 正在初始化）。请先手动启动桌面版 OneNote 并确保两者同为普通用户权限后重试。";
  }
  if (/ETIMEDOUT|timeout|killed/i.test(msg)) {
    return "读取本机 OneNote 超时，请先手动打开桌面版 OneNote 等待笔记本加载完成，再点击「检测并浏览笔记本」。";
  }
  return `连接本机 OneNote 失败：${msg.slice(0, 260)}`;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&amp;/g, "&");
}

function parseXmlAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/**
 * Pure TypeScript parser for OneNote COM GetHierarchy($null, 4) XML.
 * Automatically skips Recycle Bin SectionGroups and deleted Sections.
 */
export function parseOneNoteHierarchyXml(xml: string): OneNoteHierarchyResult {
  const notebooks: OneNoteNotebookInfo[] = [];
  const sections: OneNoteSectionInfo[] = [];
  const pages: OneNotePageMeta[] = [];

  const tokenRe = /<(\/?)(?:[a-zA-Z0-9_-]+:)?(Notebook|SectionGroup|Section|Page)\b([^>]*?)(\/?)>/gi;

  let currentNotebook: OneNoteNotebookInfo | null = null;
  let currentSection: OneNoteSectionInfo | null = null;
  const groupStack: Array<{ name: string; isRecycle: boolean }> = [];
  let inDeletedSection = false;

  const isInRecycle = () => groupStack.some((g) => g.isRecycle) || inDeletedSection;

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    const isClosing = m[1] === "/";
    const tag = m[2];
    const attrStr = m[3] ?? "";
    const isSelfClosing = m[4] === "/";

    if (isClosing) {
      if (tag === "Notebook") {
        currentNotebook = null;
        currentSection = null;
        groupStack.length = 0;
        inDeletedSection = false;
      } else if (tag === "SectionGroup") {
        groupStack.pop();
      } else if (tag === "Section") {
        currentSection = null;
        inDeletedSection = false;
      }
      continue;
    }

    const attrs = parseXmlAttributes(attrStr);

    if (tag === "Notebook") {
      const nb: OneNoteNotebookInfo = {
        id: attrs.ID || "",
        name: attrs.nickname || attrs.name || "未命名笔记本",
        nickname: attrs.nickname || undefined,
      };
      if (nb.id) notebooks.push(nb);
      currentNotebook = isSelfClosing ? null : nb;
      currentSection = null;
      groupStack.length = 0;
      inDeletedSection = false;
    } else if (tag === "SectionGroup") {
      const isRecycle = attrs.isRecycleBin === "true";
      if (!isSelfClosing) {
        groupStack.push({ name: attrs.name || "分区组", isRecycle });
      }
    } else if (tag === "Section") {
      const deleted = attrs.isInRecycleBin === "true" || attrs.isDeletedPages === "true";
      if (deleted || isInRecycle() || !currentNotebook) {
        if (!isSelfClosing) inDeletedSection = true;
        currentSection = null;
      } else {
        const groupPath = groupStack
          .filter((g) => !g.isRecycle && g.name)
          .map((g) => g.name)
          .join("/");
        const sec: OneNoteSectionInfo = {
          id: attrs.ID || "",
          name: attrs.name || "未命名分区",
          notebookId: currentNotebook.id,
          notebookName: currentNotebook.name,
          groupPath: groupPath || undefined,
        };
        if (sec.id) sections.push(sec);
        currentSection = isSelfClosing ? null : sec;
      }
    } else if (tag === "Page") {
      if (isInRecycle() || !currentNotebook || !currentSection) continue;
      if (attrs.isInRecycleBin === "true") continue;
      const id = attrs.ID || "";
      if (!id) continue;
      pages.push({
        id,
        name: attrs.name || `OneNote页面_${id.slice(0, 8)}`,
        notebookId: currentNotebook.id,
        notebookName: currentNotebook.name,
        sectionId: currentSection.id,
        sectionName: currentSection.name,
        groupPath: currentSection.groupPath,
        dateTime: attrs.dateTime || undefined,
        lastModifiedTime: attrs.lastModifiedTime || attrs.dateTime || undefined,
        pageLevel: Number(attrs.pageLevel) || 1,
      });
    }
  }

  const folders: OneNoteFolderSummary[] = [];
  for (const nb of notebooks) {
    folders.push({ id: `nb:${nb.id}`, name: `笔记本 · ${nb.name}`, isRoot: true });
  }
  for (const sec of sections) {
    const label = sec.groupPath
      ? `[${sec.notebookName}/${sec.groupPath}] ${sec.name}`
      : `[${sec.notebookName}] ${sec.name}`;
    folders.push({ id: `sec:${sec.id}`, name: label, isRoot: false });
  }

  return {
    notebooks,
    sections,
    pages,
    folders: folders.slice(0, 40),
  };
}

function inlineOneNoteHtmlToMarkdown(raw: string): string {
  if (!raw) return "";
  let s = raw
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_, h1, h2, inner) => {
      const href = decodeXmlEntities(h1 ?? h2 ?? "").trim();
      const label = inlineOneNoteHtmlToMarkdown(inner).trim();
      if (!href || href.startsWith("onenote:")) return label;
      return label ? `[${label}](${href})` : href;
    })
    .replace(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, (_, inner) => {
      const text = inlineOneNoteHtmlToMarkdown(inner).trim();
      return text ? `**${text}**` : "";
    })
    .replace(/<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, (_, inner) => {
      const text = inlineOneNoteHtmlToMarkdown(inner).trim();
      return text ? `*${text}*` : "";
    })
    .replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (_, attr, inner) => {
      const text = inlineOneNoteHtmlToMarkdown(inner);
      if (!text.trim()) return text;
      const style = String(attr ?? "");
      if (/font-weight\s*:\s*bold/i.test(style)) return `**${text.trim()}**`;
      return text;
    })
    .replace(/<[^>]+>/g, "");

  s = decodeXmlEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").trim();
}

function extractTextFromElement(fragment: string): string {
  const parts: string[] = [];
  const tRe = /<(?:[a-zA-Z0-9_-]+:)?T\b[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/(?:[a-zA-Z0-9_-]+:)?T>/gi;
  let m: RegExpExecArray | null;
  while ((m = tRe.exec(fragment)) !== null) {
    const raw = m[1] !== undefined ? m[1] : decodeXmlEntities(m[2] ?? "");
    const md = inlineOneNoteHtmlToMarkdown(raw);
    if (md) parts.push(md);
  }
  const fileRe = /<(?:[a-zA-Z0-9_-]+:)?InsertedFile\b([^>]*)\/?>/gi;
  while ((m = fileRe.exec(fragment)) !== null) {
    const attrs = parseXmlAttributes(m[1] ?? "");
    if (attrs.preferredName) parts.push(`[附件: ${attrs.preferredName}]`);
  }
  const imgRe = /<(?:[a-zA-Z0-9_-]+:)?Image\b([^>]*)>/gi;
  while ((m = imgRe.exec(fragment)) !== null) {
    const attrs = parseXmlAttributes(m[1] ?? "");
    if (attrs.alt) parts.push(`[图片: ${attrs.alt}]`);
  }
  return parts.join(" ").trim();
}

function renderOneNoteTable(tableXml: string): string {
  const rows: string[][] = [];
  const rowRe = /<(?:[a-zA-Z0-9_-]+:)?Row\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?Row>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(tableXml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<(?:[a-zA-Z0-9_-]+:)?Cell\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?Cell>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const cellText = extractTextFromElement(cm[1]).replace(/\|/g, "\\|").replace(/\n+/g, " ");
      cells.push(cellText);
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return "";
  const colCount = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: colCount }, (_, i) => r[i] ?? "");
  const header = `| ${pad(rows[0]).join(" | ")} |`;
  const sep = `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`;
  const body = rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

/**
 * Converts OneNote COM GetPageContent(pageId, [ref]$xml, 0) XML directly into clean Markdown
 * without requiring Microsoft Word or Pandoc.
 */
export function parseOneNotePageXmlToMarkdown(xml: string): string {
  if (!xml || !xml.trim()) return "";

  // Remove <one:Title> block so we don't duplicate the page title inside the body
  let bodyXml = xml.replace(/<(?:[a-zA-Z0-9_-]+:)?Title\b[^>]*>[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?Title>/gi, "");

  // Extract <one:Table> blocks into placeholders first so inner <one:OE> aren't double-counted
  const tables: string[] = [];
  bodyXml = bodyXml.replace(/<(?:[a-zA-Z0-9_-]+:)?Table\b[^>]*>[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?Table>/gi, (match) => {
    const rendered = renderOneNoteTable(match);
    if (!rendered) return "";
    const idx = tables.length;
    tables.push(rendered);
    return `<one:OE><one:T><![CDATA[__ONENOTE_TABLE_${idx}__]]></one:T></one:OE>`;
  });

  // Walk OE / OEChildren depth to preserve bullet/numbered/checkbox indentation
  const lines: string[] = [];
  const tokenRe =
    /<(\/?)(?:[a-zA-Z0-9_-]+:)?(OEChildren|OE)\b([^>]*?)(\/?)>|<(?:[a-zA-Z0-9_-]+:)?(List|Tag|T|InsertedFile|Image)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?\5>)/gi;

  let depth = 0;
  let inOe = false;
  let oePrefix = "";
  let oeParts: string[] = [];
  let oeStyle = "";

  const flushOe = () => {
    const joined = oeParts.join(" ").trim();
    if (joined) {
      const tableMatch = /^__ONENOTE_TABLE_(\d+)__$/.exec(joined);
      if (tableMatch) {
        const tbl = tables[Number(tableMatch[1])];
        if (tbl) lines.push(`\n${tbl}\n`);
      } else {
        const indent = depth > 1 ? "  ".repeat(Math.min(4, depth - 1)) : "";
        if (oePrefix) {
          lines.push(`${indent}${oePrefix}${joined}`);
        } else if (/^h[1-6]$/i.test(oeStyle)) {
          const level = Math.min(6, Math.max(1, Number(oeStyle.slice(1)) || 2));
          lines.push(`\n${"#".repeat(level)} ${joined}`);
        } else {
          lines.push(`${indent}${joined}`);
        }
      }
    }
    oePrefix = "";
    oeParts = [];
    oeStyle = "";
  };

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(bodyXml)) !== null) {
    if (m[2]) {
      const isClosing = m[1] === "/";
      const tag = m[2];
      const isSelfClosing = m[4] === "/";
      if (tag === "OEChildren") {
        if (isClosing) {
          depth = Math.max(0, depth - 1);
        } else if (!isSelfClosing) {
          if (inOe) {
            flushOe();
            inOe = false;
          }
          depth++;
        }
      } else if (tag === "OE") {
        if (isClosing) {
          if (inOe) flushOe();
          inOe = false;
        } else if (!isSelfClosing) {
          if (inOe) flushOe();
          inOe = true;
          const attrs = parseXmlAttributes(m[3] ?? "");
          oeStyle = attrs.quickStyleIndex ? "" : "";
          oePrefix = "";
          oeParts = [];
        }
      }
      continue;
    }

    const innerTag = m[5];
    const attrStr = m[6] ?? "";
    const innerBody = m[7] ?? "";
    if (!inOe && innerTag !== "T") continue;

    if (innerTag === "List") {
      if (/<(?:[a-zA-Z0-9_-]+:)?Number\b/i.test(innerBody)) {
        oePrefix = "1. ";
      } else if (/<(?:[a-zA-Z0-9_-]+:)?Bullet\b/i.test(innerBody)) {
        oePrefix = "- ";
      }
    } else if (innerTag === "Tag") {
      const attrs = parseXmlAttributes(attrStr);
      if (attrs.completed === "true") oePrefix = "- [x] ";
      else if (attrs.completed === "false") oePrefix = "- [ ] ";
    } else if (innerTag === "T") {
      const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(innerBody.trim());
      const raw = cdata ? cdata[1] : decodeXmlEntities(innerBody);
      const md = inlineOneNoteHtmlToMarkdown(raw);
      if (md) {
        if (!inOe) {
          lines.push(md);
        } else {
          oeParts.push(md);
        }
      }
    } else if (innerTag === "InsertedFile") {
      const attrs = parseXmlAttributes(attrStr);
      if (attrs.preferredName) oeParts.push(`[附件: ${attrs.preferredName}]`);
    } else if (innerTag === "Image") {
      const attrs = parseXmlAttributes(attrStr);
      if (attrs.alt) oeParts.push(`[图片: ${attrs.alt}]`);
    }
  }
  if (inOe) flushOe();

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function runWindowsPowerShell(script: string, timeoutMs = 35000): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("NON_WINDOWS_PLATFORM");
  }
  const encoded = encodePowerShellScript(script);
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (!stdout.trim() && stderr.trim()) {
    throw new Error(stderr.trim());
  }
  return stdout;
}

export async function fetchLocalOneNoteHierarchy(): Promise<OneNoteHierarchyResult> {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$oneNote = $null
try {
  $oneNote = New-Object -ComObject OneNote.Application
  $xmlOut = ""
  $oneNote.GetHierarchy($null, 4, [ref]$xmlOut)
  [Console]::Out.Write($xmlOut)
} finally {
  if ($null -ne $oneNote) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($oneNote)
  }
}
`;
  const xml = await runWindowsPowerShell(script, 30000);
  return parseOneNoteHierarchyXml(xml);
}

async function fetchLocalOneNotePageXmlBatch(pageIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (pageIds.length === 0) return result;

  const idsJsonB64 = Buffer.from(JSON.stringify(pageIds), "utf8").toString("base64");
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$idsJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${idsJsonB64}'))
$ids = $idsJson | ConvertFrom-Json
$oneNote = $null
try {
  $oneNote = New-Object -ComObject OneNote.Application
  foreach ($pageId in $ids) {
    try {
      $pageXml = ""
      $oneNote.GetPageContent([string]$pageId, [ref]$pageXml, 0)
      $b64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($pageXml))
      [Console]::Out.WriteLine(([string]$pageId) + "\`t" + $b64)
    } catch {
      # skip single unreadable page
    }
  }
} finally {
  if ($null -ne $oneNote) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($oneNote)
  }
}
`;
  const out = await runWindowsPowerShell(script, 60000);
  for (const line of out.split(/\r?\n/)) {
    const tabIdx = line.indexOf("\t");
    if (tabIdx <= 0) continue;
    const id = line.slice(0, tabIdx).trim();
    const b64 = line.slice(tabIdx + 1).trim();
    if (!id || !b64) continue;
    try {
      result.set(id, Buffer.from(b64, "base64").toString("utf8"));
    } catch {
      /* ignore malformed line */
    }
  }
  return result;
}

function parseFilterTokens(raw?: string): string[] {
  return (raw ?? "")
    .split(/[\n,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchesOneNoteFilter(page: OneNotePageMeta, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith("nb:")) {
      if (page.notebookId.toLowerCase() === lower.slice(3)) return true;
    } else if (lower.startsWith("sec:")) {
      if (page.sectionId.toLowerCase() === lower.slice(4)) return true;
    } else {
      if (
        page.notebookId.toLowerCase() === lower ||
        page.notebookName.toLowerCase() === lower ||
        page.sectionId.toLowerCase() === lower ||
        page.sectionName.toLowerCase() === lower ||
        `${page.notebookName}/${page.sectionName}`.toLowerCase() === lower
      ) {
        return true;
      }
    }
  }
  return false;
}

export async function fetchOneNoteLocalPages(opts: {
  notebookFilter?: string;
  keyword?: string;
  maxItems: number;
}): Promise<{ pages: OneNoteFetchedPage[]; hierarchy: OneNoteHierarchyResult }> {
  const limit = Math.min(80, Math.max(1, opts.maxItems || 30));
  const hierarchy = await fetchLocalOneNoteHierarchy();
  const tokens = parseFilterTokens(opts.notebookFilter);
  const keyword = (opts.keyword ?? "").trim().toLowerCase();

  let candidates = hierarchy.pages.filter((p) => matchesOneNoteFilter(p, tokens));

  // Sort by lastModifiedTime descending so latest trading reviews sync first
  candidates.sort((a, b) => {
    const ta = a.lastModifiedTime ? Date.parse(a.lastModifiedTime) : 0;
    const tb = b.lastModifiedTime ? Date.parse(b.lastModifiedTime) : 0;
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });

  if (keyword) {
    const titleMatches = candidates.filter(
      (p) =>
        p.name.toLowerCase().includes(keyword) ||
        p.sectionName.toLowerCase().includes(keyword) ||
        p.notebookName.toLowerCase().includes(keyword),
    );
    // If title matches are enough, fetch them directly; otherwise inspect up to 60 recent pages for body match
    candidates = titleMatches.length >= limit ? titleMatches.slice(0, limit) : candidates.slice(0, Math.max(limit, 60));
  } else {
    candidates = candidates.slice(0, limit);
  }

  const xmlMap = await fetchLocalOneNotePageXmlBatch(candidates.map((c) => c.id));
  const pages: OneNoteFetchedPage[] = [];

  for (const meta of candidates) {
    if (pages.length >= limit) break;
    const pageXml = xmlMap.get(meta.id);
    if (!pageXml) continue;
    const md = parseOneNotePageXmlToMarkdown(pageXml);
    if (!md) continue;

    if (keyword) {
      const hay = `${meta.name}\n${meta.notebookName}\n${meta.sectionName}\n${md}`.toLowerCase();
      if (!hay.includes(keyword)) continue;
    }

    const dateFromMeta = meta.lastModifiedTime ? /\b(20\d{2}-\d{2}-\d{2})\b/.exec(meta.lastModifiedTime)?.[1] : undefined;
    const dateFromText = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(`${meta.name}\n${md.slice(0, 400)}`)?.[1];

    pages.push({
      id: meta.id,
      title: meta.name,
      content: md,
      notebookName: meta.notebookName,
      sectionName: meta.sectionName,
      groupPath: meta.groupPath,
      eventDate: dateFromText || dateFromMeta,
      tags: Array.from(new Set(["OneNote", meta.notebookName, meta.sectionName])),
    });
  }

  return { pages, hierarchy };
}