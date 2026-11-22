"use client";

import { SlidersHorizontal } from "lucide-react";
import React from "react";
import type { Block, Inline, ParsedMarkdown } from "@/lib/markdown";

function renderInlines(
  inlines: Inline[],
  onWikiClick?: (target: string) => void,
  onTagClick?: (tag: string) => void,
): React.ReactNode {
  return inlines.map((part, idx) => {
    if ("text" in part) return <React.Fragment key={idx}>{part.text}</React.Fragment>;
    if ("strong" in part) return <strong key={idx} className="font-semibold text-[var(--ink-strong)]">{part.strong}</strong>;
    if ("em" in part) return <em key={idx} className="italic text-[var(--ink-muted)]">{part.em}</em>;
    if ("del" in part) return <del key={idx} className="text-[var(--ink-dim)]">{part.del}</del>;
    if ("code" in part) {
      return (
        <code
          key={idx}
          className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[0.86em] text-[var(--code-accent)]"
        >
          {part.code}
        </code>
      );
    }
    if ("link" in part) {
      return (
        <a
          key={idx}
          href={part.link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--cyan)] underline decoration-[var(--cyan)]/40 underline-offset-2 hover:opacity-85"
        >
          {part.link.label}
        </a>
      );
    }
    if ("wiki" in part) {
      return (
        <button
          key={idx}
          type="button"
          onClick={() => onWikiClick?.(part.wiki.target)}
          className="mx-0.5 inline items-center rounded px-1 py-0.2 font-medium text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-3 transition hover:bg-[var(--accent-soft)] hover:decoration-[var(--accent)]"
        >
          {part.wiki.label}
        </button>
      );
    }
    if ("tag" in part) {
      return (
        <button
          key={idx}
          type="button"
          onClick={() => onTagClick?.(part.tag)}
          className="mx-0.5 inline-flex items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-2 py-0.2 text-[11px] font-medium text-[var(--accent)] transition hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/20"
        >
          #{part.tag}
        </button>
      );
    }
    return null;
  });
}

function renderBlock(
  block: Block,
  idx: number,
  onWikiClick?: (target: string) => void,
  onTagClick?: (tag: string) => void,
): React.ReactNode {
  switch (block.type) {
    case "h1":
      return (
        <h1 key={idx} className="mb-4 mt-1 text-2xl font-bold tracking-tight text-[var(--ink-strong)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </h1>
      );
    case "h2":
      return (
        <h2 key={idx} className="mb-2.5 mt-7 border-b border-[var(--border)] pb-1.5 text-[17px] font-semibold text-[var(--ink-strong)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </h2>
      );
    case "h3":
      return (
        <h3 key={idx} className="mb-1.5 mt-5 text-[15px] font-semibold text-[var(--accent)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </h3>
      );
    case "h4":
      return (
        <h4 key={idx} className="mb-1 mt-4 text-sm font-medium text-[var(--ink)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </h4>
      );
    case "p":
      return (
        <p key={idx} className="my-2.5 text-[14.5px] leading-7 text-[var(--ink)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </p>
      );
    case "quote":
      return (
        <blockquote
          key={idx}
          className="my-3.5 rounded-r-md border-l-2 border-[var(--accent)] bg-[var(--surface)]/90 px-4 py-2.5 text-[13.5px] leading-6 text-[var(--ink-muted)]"
        >
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </blockquote>
      );
    case "hr":
      return <hr key={idx} className="my-6 border-[var(--border)]" />;
    case "code":
      return (
        <pre
          key={idx}
          className="my-3.5 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--bg-deep)] p-3.5 text-xs leading-6 text-[var(--ink)]"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "ul":
      return (
        <ul key={idx} className="my-2.5 space-y-1.5 text-[14px] leading-6 text-[var(--ink)]">
          {block.items.map((item, j) => (
            <li key={j} style={{ paddingLeft: `${item.depth * 18 + 16}px` }} className="relative">
              <span className="absolute left-1.5 top-[10px] h-1.5 w-1.5 rounded-full bg-[var(--ink-dim)]" />
              {renderInlines(item.inlines, onWikiClick, onTagClick)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={idx} className="my-2.5 list-decimal space-y-1.5 pl-6 text-[14px] leading-6 text-[var(--ink)]">
          {block.items.map((item, j) => (
            <li key={j} style={{ marginLeft: `${item.depth * 14}px` }}>
              {renderInlines(item.inlines, onWikiClick, onTagClick)}
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={idx} className="my-4 overflow-x-auto rounded-md border border-[var(--border)]">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-[var(--surface)] text-[var(--ink-muted)]">
              <tr>
                {block.head.map((cell, ci) => (
                  <th
                    key={ci}
                    style={{ textAlign: block.align[ci] ?? "left" }}
                    className="border-b border-[var(--border)] px-3 py-2 font-medium"
                  >
                    {renderInlines(cell, onWikiClick, onTagClick)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {block.rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-[var(--surface)]/60">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{ textAlign: block.align[ci] ?? "left" }}
                      className="px-3 py-2 text-[var(--ink)]"
                    >
                      {renderInlines(cell, onWikiClick, onTagClick)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export default function MarkdownView({
  parsed,
  onWikiClick,
  onTagClick,
}: {
  parsed: ParsedMarkdown;
  onWikiClick?: (target: string) => void;
  onTagClick?: (tag: string) => void;
}) {
  const visibleProps = parsed.props.filter(([, v]) => Boolean(v) && v !== "[]");

  return (
    <article className="obsidian-markdown">
      {/* Authentic Obsidian Properties Panel */}
      {visibleProps.length > 0 && (
        <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/80 px-3.5 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--ink-dim)]">
            <SlidersHorizontal className="h-4 w-4" />
            Properties
          </div>
          <div className="grid gap-y-1.5 text-xs sm:grid-cols-2 sm:gap-x-6">
            {visibleProps.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2.5 truncate">
                <span className="w-24 shrink-0 truncate font-mono text-[11px] text-[var(--ink-dim)]">{k}</span>
                <span className="truncate text-[var(--ink-muted)]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {parsed.blocks.map((block, idx) => renderBlock(block, idx, onWikiClick, onTagClick))}
    </article>
  );
}
