import mammoth from "mammoth";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export type ConvertKind = "md" | "txt" | "docx" | "html";
export type CarrierKind = ConvertKind | "pdf";
export type ConvertOk = { ok: true; kind: ConvertKind; md: string; warnings: string[] };
export type ConvertFail = { ok: false; error: string };
export type ConvertOutcome = ConvertOk | ConvertFail;

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export const SUPPORTED_CONVERT_EXT: Record<string, ConvertKind> = {
  md: "md",
  markdown: "md",
  txt: "txt",
  text: "txt",
  log: "txt",
  docx: "docx",
  html: "html",
  htm: "html",
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});
turndown.use(gfm);
turndown.addRule("hr", { filter: "hr", replacement: () => "\n\n---\n\n" });

function cleanHtml(html: string): { html: string; images: number } {
  let images = 0;
  let out = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
      images++;
      const alt = /alt\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.trim();
      return `<span>${alt ? `（图：${alt}）` : "（图）"}</span>`;
    });
  out = out.replace(/<span><\/span>/g, "");
  return { html: out, images };
}

function tidy(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToMd(html: string): ConvertOutcome {
  try {
    const { html: clean, images } = cleanHtml(html);
    const md = tidy(turndown.turndown(clean));
    if (!md) return { ok: false, error: "这份 HTML 转出来是空的（可能整页仅包含脚本或样式）" };
    const warnings: string[] = [];
    if (images) warnings.push(`页面里 ${images} 张图片未内嵌进 Markdown，已保留占位文字`);
    return { ok: true, kind: "html", md, warnings };
  } catch (error) {
    return { ok: false, error: `HTML 转换失败：${error instanceof Error ? error.message : "未知错误"}` };
  }
}

const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='caption'] => em",
  "p[style-name='Caption'] => em",
];

export async function docxToMd(buf: Buffer): Promise<ConvertOutcome> {
  try {
    const { value, messages } = await mammoth.convertToHtml({ buffer: buf }, { styleMap: DOCX_STYLE_MAP });
    const { html, images } = cleanHtml(value);
    const md = tidy(turndown.turndown(html));
    if (!md) return { ok: false, error: "这份 Word 文档转出来是空的（可能是纯扫描图片）" };
    const warnings = messages
      .map((m) => m.message)
      .filter((m) => !/Unrecognised paragraph style/i.test(m));
    if (images) warnings.push(`文档里 ${images} 张图片未内嵌进 Markdown，已保留占位文字`);
    return { ok: true, kind: "docx", md, warnings };
  } catch (error) {
    return { ok: false, error: `Word 转换失败：${error instanceof Error ? error.message : "未知错误"}` };
  }
}

export function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8 (BOM)" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString("utf16le"), encoding: "utf-16le" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" };
  } catch {
    /* fallback to GB18030 */
  }
  try {
    return { text: new TextDecoder("gb18030").decode(buf), encoding: "gb18030" };
  } catch {
    /* fallback to latin1 */
  }
  return { text: buf.toString("latin1"), encoding: "latin1" };
}

function joinLines(lines: string[]): string {
  let out = "";
  for (const line of lines) {
    if (!out) {
      out = line;
      continue;
    }
    const cjk = /[\u4e00-\u9fff]$/.test(out) && /^[\u4e00-\u9fff]/.test(line);
    out += (cjk ? "" : " ") + line;
  }
  return out;
}

export function textToMd(text: string): ConvertOutcome {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push(joinLines(para));
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*(#{1,6})\s+/.test(line) || /^\s*\|/.test(line) || /^\s*>/.test(line) || /^\s*```/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    if (/^\s*[-*•·]\s+/.test(line) || /^\s*\d{1,3}[.)]\s+/.test(line)) {
      flush();
      blocks.push(line.replace(/^(\s*)[•·]\s+/, "$1- "));
      continue;
    }
    para.push(line.trim());
  }
  flush();

  const md = tidy(blocks.join("\n\n"));
  if (!md) return { ok: false, error: "这个文本文件是空的" };
  return { ok: true, kind: "txt", md, warnings: [] };
}

export function txtToMd(buf: Buffer): ConvertOutcome {
  const { text, encoding } = decodeText(buf);
  const result = textToMd(text);
  if (!result.ok) return result;
  const warnings = encoding === "latin1" ? ["未能识别 UTF-8 / GB18030 编码，中文可能存在乱码"] : [];
  return { ...result, warnings };
}

export function carrierOf(fileName: string): CarrierKind | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  return SUPPORTED_CONVERT_EXT[ext] ?? null;
}

export async function convertFile(fileName: string, buf: Buffer): Promise<ConvertOutcome> {
  if (buf.length === 0) return { ok: false, error: "文件是空的" };
  if (buf.length > MAX_INPUT_BYTES) return { ok: false, error: `文件超过 ${MAX_INPUT_BYTES / 1024 / 1024} MB 上限` };
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const kind = SUPPORTED_CONVERT_EXT[ext];
  if (!kind) return { ok: false, error: "不支持该转换格式（文本转换支持 md / txt / docx / html，pdf 保留原件）" };
  if (kind === "docx") return docxToMd(buf);
  if (kind === "html") return htmlToMd(decodeText(buf).text);
  if (kind === "txt") return txtToMd(buf);
  const md = tidy(decodeText(buf).text);
  return md ? { ok: true, kind: "md", md, warnings: [] } : { ok: false, error: "Markdown 文件为空" };
}

export function guessTitle(md: string, fallback: string): string {
  const normalized = md.replace(/\r\n?/g, "\n");
  let body = normalized;

  // 1) Parse YAML frontmatter if present: prefer explicit `title:` field and never leak raw YAML keys
  const fmMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (fmMatch) {
    const fmBlock = fmMatch[1];
    const titleMatch = /^[ \t]*title[ \t]*:[ \t]*(.+?)[ \t]*$/m.exec(fmBlock);
    if (titleMatch) {
      let rawTitle = titleMatch[1].trim();
      if (
        (rawTitle.startsWith('"') && rawTitle.endsWith('"') && rawTitle.length >= 2) ||
        (rawTitle.startsWith("'") && rawTitle.endsWith("'") && rawTitle.length >= 2)
      ) {
        rawTitle = rawTitle.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").trim();
      }
      if (rawTitle) return rawTitle.slice(0, 120);
    }
    body = normalized.slice(fmMatch[0].length);
  }

  let firstLine: string | null = null;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t === "---") continue;
    if (firstLine === null) firstLine = t;
    const h = /^#{1,6}\s+(.+)$/.exec(t);
    if (h) return h[1].trim().slice(0, 120) || fallback;
  }
  return (firstLine ?? "").replace(/^[>*\-\s]+/, "").slice(0, 120) || fallback;
}
