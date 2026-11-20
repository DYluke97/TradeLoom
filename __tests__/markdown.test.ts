import { describe, expect, it } from "vitest";
import { extractTags, extractWikiLinks, parseInline, parseMarkdown } from "@/lib/markdown";

describe("markdown & obsidian wikilinks", () => {
  it("parses frontmatter, headings, tables, wikilinks, and tags", () => {
    const md = [
      "---",
      'title: "测试复盘"',
      'event_date: "2025-05-01"',
      "---",
      "",
      "# 标题",
      "",
      "关联 [[情绪周期|周期]] 与 #短线 笔记，拒绝 [危险](javascript:alert(1))",
      "",
      "| 维度 | 状态 |",
      "| :--- | ---: |",
      "| 情绪 | 修复 |",
    ].join("\n");

    const parsed = parseMarkdown(md);
    expect(parsed.props).toEqual([
      ["title", "测试复盘"],
      ["event_date", "2025-05-01"],
    ]);
    expect(parsed.blocks.some((b) => b.type === "table")).toBe(true);

    const inlines = parseInline("[[情绪周期|周期]] #短线 [坏链](javascript:alert(1))");
    expect(inlines).toContainEqual({ wiki: { target: "情绪周期", label: "周期" } });
    expect(inlines).toContainEqual({ tag: "短线" });
    expect(inlines).toContainEqual({ text: "坏链" });
  });

  it("extracts unique wikilinks and tags while skipping code fences", () => {
    const text = "参见 [[A]] 和 [[A|别名]] #情绪周期\n```\n#代码里不算\n```";
    expect(extractWikiLinks(text)).toEqual(["A"]);
    expect(extractTags(text)).toEqual(["情绪周期"]);
  });
});
