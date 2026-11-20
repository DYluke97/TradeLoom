export type Inline =
  | { text: string }
  | { strong: string }
  | { em: string }
  | { del: string }
  | { code: string }
  | { link: { href: string; label: string } }
  | { wiki: { target: string; label: string } }
  | { tag: string };

export type Align = "left" | "center" | "right" | null;
export type ListItem = { inlines: Inline[]; depth: number };

export type Block =
  | { type: "h1" | "h2" | "h3" | "h4"; inlines: Inline[] }
  | { type: "p"; inlines: Inline[] }
  | { type: "quote"; inlines: Inline[] }
  | { type: "ul"; items: ListItem[] }
  | { type: "ol"; items: ListItem[] }
  | { type: "table"; head: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" };

export type ParsedMarkdown = {
  props: [string, string][];
  blocks: Block[];
};

const INLINE_RE =
  /!\[([^\]]*)\]\(([^)\s]*)[^)]*\)|\[([^[\]]+)\]\(([^)\s]+)[^)]*\)|\[\[([^\]|]+)(?:\|([^\]]*))?\]\]|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\n]+)\*|(?<![\w/])#([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_\-/]{0,30})/g;

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  return null;
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  const re = new RegExp(INLINE_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) out.push({ text: source.slice(last, m.index) });
    if (m[1] !== undefined) {
      if (m[1].trim()) out.push({ text: `（图：${m[1].trim()}）` });
    } else if (m[3] !== undefined) {
      const href = safeHref(m[4]);
      if (href) out.push({ link: { href, label: m[3].trim() } });
      else out.push({ text: m[3] });
    } else if (m[5] !== undefined) {
      out.push({ wiki: { target: m[5].trim(), label: (m[6] ?? m[5]).trim() } });
    } else if (m[7] !== undefined) {
      out.push({ code: m[7] });
    } else if (m[8] !== undefined) {
      out.push({ strong: m[8] });
    } else if (m[9] !== undefined) {
      out.push({ del: m[9] });
    } else if (m[10] !== undefined) {
      out.push({ em: m[10] });
    } else if (m[11] !== undefined) {
      out.push({ tag: m[11] });
    }
    last = re.lastIndex;
  }
  if (last < source.length) out.push({ text: source.slice(last) });
  return out;
}

const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d{1,3}[.)]\s+(.*)$/;
const FENCE = /^\s*```(\S*)\s*$/;

const depthOf = (indent: string) => Math.min(3, Math.floor(indent.replace(/\t/g, "  ").length / 2));

function splitRow(line: string): Inline[][] {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/);
  return cells.map((cell) => parseInline(cell.trim().replace(/\\\|/g, "|")));
}

function alignOf(sep: string): Align[] {
  return sep
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => {
      const t = cell.trim();
      const left = t.startsWith(":");
      const right = t.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return null;
    });
}

export function parseMarkdown(text: string): ParsedMarkdown {
  const normalized = text.replace(/\r\n?/g, "\n");
  let body = normalized;
  const props: [string, string][] = [];

  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---", 4);
    if (end > 0) {
      for (const line of normalized.slice(4, end).split("\n")) {
        const at = line.indexOf(":");
        if (at > 0 && /^[\w_-]+$/.test(line.slice(0, at))) {
          props.push([line.slice(0, at), line.slice(at + 1).trim().replace(/^"|"$/g, "")]);
        }
      }
      body = normalized.slice(end + 4);
    }
  }

  const lines = body.split("\n");
  const blocks: Block[] = [];
  let list: { type: "ul" | "ol"; items: ListItem[] } | null = null;
  const flush = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const buf: string[] = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) buf.push(lines[i]);
      blocks.push({ type: "code", lang: fence[1] ?? "", text: buf.join("\n") });
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|/.test(lines[i + 1]) && TABLE_SEP.test(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const align = alignOf(lines[i + 1]);
      const rows: Inline[][][] = [];
      for (i++; i + 1 < lines.length && /^\s*\|/.test(lines[i + 1]); ) {
        i++;
        rows.push(splitRow(lines[i]));
      }
      blocks.push({ type: "table", head, align, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const type = bullet ? "ul" : "ol";
      if (list && list.type !== type) flush();
      const m = (bullet ?? ordered)!;
      (list ??= { type, items: [] }).items.push({ inlines: parseInline(m[2]), depth: depthOf(m[1]) });
      continue;
    }

    flush();
    if (line.startsWith("#### ")) blocks.push({ type: "h4", inlines: parseInline(line.slice(5)) });
    else if (line.startsWith("### ")) blocks.push({ type: "h3", inlines: parseInline(line.slice(4)) });
    else if (line.startsWith("## ")) blocks.push({ type: "h2", inlines: parseInline(line.slice(3)) });
    else if (line.startsWith("# ")) blocks.push({ type: "h1", inlines: parseInline(line.slice(2)) });
    else if (line.startsWith("> ")) blocks.push({ type: "quote", inlines: parseInline(line.slice(2)) });
    else if (/^---+\s*$/.test(line)) blocks.push({ type: "hr" });
    else if (line.trim() === "") continue;
    else blocks.push({ type: "p", inlines: parseInline(line) });
  }
  flush();
  return { props, blocks };
}

export function extractWikiLinks(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const target = m[1].trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

export function extractTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const cleaned = text.replace(/```[\s\S]*?```/g, "");
  for (const m of cleaned.matchAll(/(?<![\w/])#([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_\-/]{0,30})/g)) {
    const tag = m[1].trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}
