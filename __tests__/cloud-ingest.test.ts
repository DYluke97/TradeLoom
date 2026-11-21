import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractFeishuToken, notionBlocksToMarkdown } from "../src/lib/cloud-connectors";
import {
  detectPlatformFromUrl,
  extractArticleFromHtml,
  importPastedReview,
  validatePublicFetchUrl,
} from "../src/lib/cloud-ingest";

describe("cloud-ingest", () => {
  it("blocks private/local URLs for SSRF safety and accepts public HTTPS URLs", () => {
    expect(validatePublicFetchUrl("http://127.0.0.1:3200/api/vault").ok).toBe(false);
    expect(validatePublicFetchUrl("http://localhost:8080/secret").ok).toBe(false);
    expect(validatePublicFetchUrl("http://192.168.1.1/admin").ok).toBe(false);
    expect(validatePublicFetchUrl("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(validatePublicFetchUrl("file:///etc/passwd").ok).toBe(false);

    const ok = validatePublicFetchUrl("https://xueqiu.com/123456/789012");
    expect(ok.ok).toBe(true);
    expect(detectPlatformFromUrl("https://xueqiu.com/123456/789012")).toBe("雪球");
    expect(detectPlatformFromUrl("https://my.feishu.cn/docx/AbCdEf123")).toBe("飞书文档");
    expect(detectPlatformFromUrl("https://www.yuque.com/u1/trading/abc")).toBe("语雀");
  });

  it("extracts readable Markdown from WeChat and Xueqiu HTML pages", () => {
    const html = `
      <html>
        <head>
          <title>2025-11-18 情绪冰点反核复盘 - 雪球</title>
          <meta property="article:published_time" content="2025-11-18T15:30:00Z" />
        </head>
        <body>
          <nav>导航栏杂项</nav>
          <div class="article__bd__detail">
            <h2>盘面结构</h2>
            <p>今天情绪周期进入<strong>退潮冰点</strong>，尾盘出现分歧转一致试错信号。</p>
            <ul><li>龙头反核承接强</li><li>严格执行止损纪律</li></ul>
          </div>
        </body>
      </html>
    `;
    const res = extractArticleFromHtml(html, "https://xueqiu.com/123/456");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.title).toBe("2025-11-18 情绪冰点反核复盘");
      expect(res.eventDate).toBe("2025-11-18");
      expect(res.platform).toBe("雪球");
      expect(res.md).toContain("盘面结构");
      expect(res.md).toContain("**退潮冰点**");
      expect(res.md).not.toContain("导航栏杂项");
    }
  });

  it("imports pasted rich HTML review into workspace and rebuilds Obsidian bi-directional vault", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-cloud-"));
    const prevDir = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;
    try {
      const outcome = await importPastedReview({
        title: "飞书盘后复盘测试",
        html: "<h1>飞书盘后复盘测试</h1><p>今日观察到<strong>情绪周期</strong>切换与<strong>龙头战法</strong>回流。</p>",
        eventDate: "2025-11-20",
        sourcePlatform: "飞书文档",
        tags: ["龙头战法", "情绪周期"],
      });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.eventDate).toBe("2025-11-20");
        expect(outcome.index.counts.total).toBe(1);
        expect(outcome.index.topics).toContain("情绪周期");
        expect(outcome.index.topics).toContain("龙头战法");
      }
    } finally {
      if (prevDir === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prevDir;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("parses Notion blocks and Feishu URLs cleanly", () => {
    const md = notionBlocksToMarkdown([
      { type: "heading_2", heading_2: { rich_text: [{ plain_text: "交易复盘" }] } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "控制仓位" }] } },
      { type: "to_do", to_do: { checked: true, rich_text: [{ plain_text: "盘前写好止损位" }] } },
    ]);
    expect(md).toContain("## 交易复盘");
    expect(md).toContain("- 控制仓位");
    expect(md).toContain("- [x] 盘前写好止损位");

    expect(extractFeishuToken("https://example.feishu.cn/docx/DoCxToken123")).toEqual({
      kind: "docx",
      token: "DoCxToken123",
    });
    expect(extractFeishuToken("https://example.feishu.cn/wiki/WiKiNode999")).toEqual({
      kind: "wiki",
      token: "WiKiNode999",
    });
  });
});
