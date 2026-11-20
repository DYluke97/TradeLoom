"use client";

import React from "react";
import type { Block, Inline, ParsedMarkdown } from "@/lib/markdown";

function renderInlines(
  inlines: Inline[],
  onWikiClick?: (target: string) => void,
  onTagClick?: (tag: string) => void,
): React.ReactNode {
  return inlines.map((part, idx) => {
    if ("text" in part) return <React.Fragment key={idx}>{part.text}</React.Fragment>;
    if ("strong" in part) return <strong key={idx} className="font-semibold text-[var(--ink)]">{part.strong}</strong>;
    if ("em" in part) return <em key={idx} className="italic text-[var(--ink-muted)]">{part.em}</em>;
    if ("del" in part) return <del key={idx} className="text-[var(--ink-dim)]">{part.del}</del>;
    if ("code" in part) {
      return (
        <code
          key={idx}
          className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[0.86em] text-[var(--accent)]"
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
          className="text-sky-400 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-300"
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
          className="mx-0.5 inline-flex items-center rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[0.9em] text-[var(--accent)] hover:bg-[var(--accent)]/25"
        >
          [[{part.wiki.label}]]
        </button>
      );
    }
    if ("tag" in part) {
      return (
        <button
          key={idx}
          type="button"
          onClick={() => onTagClick?.(part.tag)}
          className="mx-0.5 inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
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
        <h1 key={idx} className="mb-3 mt-1 text-xl font-bold tracking-tight text-[var(--ink)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </h1>
      );
    case "h2":
      return (
        <h2 key={idx} className="mb-2 mt-6 border-b border-[var(--border)] pb-1.5 text-base font-semibold text-[var(--ink)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </h2>
      );
    case "h3":
      return (
        <h3 key={idx} className="mb-1.5 mt-4 text-sm font-semibold text-[var(--accent)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </h3>
      );
    case "h4":
      return (
        <h4 key={idx} className="mb-1 mt-3 text-sm font-medium text-[var(--ink)]">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </h4>
      );
    case "p":
      return (
        <p key={idx} className="my-2.5 text-sm leading-7 text-[var(--ink)]/90">
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </p>
      );
    case "quote":
      return (
        <blockquote
          key={idx}
          className="my-3 border-l-2 border-[var(--accent)]/60 bg-[var(--surface-2)]/60 px-3.5 py-2 text-sm leading-6 text-[var(--ink-muted)]"
        >
          {renderInlines(block.inlines, onWikiClick, onTagClick)}
        </blockquote>
      );
    case "hr":
      return <hr key={idx} className="my-5 border-[var(--border)]" />;
    case "code":
      return (
        <pre
          key={idx}
          className="my-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[#090c10] p-3 text-xs leading-6 text-slate-300"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "ul":
      return (
        <ul key={idx} className="my-2.5 space-y-1.5 text-sm leading-6 text-[var(--ink)]/90">
          {block.items.map((item, j) => (
            <li key={j} style={{ paddingLeft: `${item.depth * 18 + 14}px` }} className="relative">
              <span className="absolute left-1.5 top-2.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]/70" />
              {renderInlines(item.inlines, onWikiClick, onTagClick)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={idx} className="my-2.5 list-decimal space-y-1.5 pl-6 text-sm leading-6 text-[var(--ink)]/90">
          {block.items.map((item, j) => (
            <li key={j} style={{ marginLeft: `${item.depth * 14}px` }}>
              {renderInlines(item.inlines, onWikiClick, onTagClick)}
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={idx} className="my-4 overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-[var(--surface-2)] text-[var(--ink-muted)]">
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
                <tr key={ri} className="hover:bg-[var(--surface-2)]/40">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{ textAlign: block.align[ci] ?? "left" }}
                      className="px-3 py-2 text-[var(--ink)]/90"
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
  return (
    <div>
      {parsed.props.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/50 p-2.5 text-xs">
          {parsed.props
            .filter(([, v]) => Boolean(v) && v !== "[]")
            .map(([k, v]) => (
              <span key={k} className="rounded bg-[var(--bg)] px-2 py-0.5 text-[var(--ink-muted)]">
                <span className="text-[var(--ink-dim)]">{k}: </span>
                <span className="text-[var(--ink)]">{v}</span>
              </span>
            ))}
        </div>
      )}
      {parsed.blocks.map((block, idx) => renderBlock(block, idx, onWikiClick, onTagClick))}
    </div>
  );
}
