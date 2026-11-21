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

  it("imports long pasted review (>4000 chars) without truncating Obsidian card body", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-cloud-"));
    const prevDir = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;
    try {
      const longTailMarker = "结尾完整校验标记_END_OF_LONG_ARTICLE_999";
      const longBody = `${"复盘段落：严格控制仓位与杠杆，关注情绪周期与股息率估值锚。\n\n".repeat(140)}${longTailMarker}`;
      const outcome = await importPastedReview({
        title: "长文复盘完整性测试",
        content: longBody,
        eventDate: "2025-11-20",
        sourcePlatform: "雪球",
        tags: ["仓位与止损", "估值锚"],
      });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.eventDate).toBe("2025-11-20");
        expect(outcome.index.counts.total).toBe(1);
        expect(outcome.index.topics).toContain("情绪周期");
        const { readFile } = await import("node:fs/promises");
        const cardContent = await readFile(path.join(tmp, "vault", outcome.cardRel), "utf8");
        expect(cardContent.length).toBeGreaterThan(3500);
        expect(cardContent).toContain(longTailMarker);
      }
    } finally {
      if (prevDir === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prevDir;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("prefers concise H1 over bloated Xueqiu title and extracts created_at timestamp", () => {
    const html = `
      <html>
        <head><title>聪明人破产只有三种方式：酒、美色、杠杆 巴菲特说查理芒格说这句话加上了酒和美色... - 雪球</title></head>
        <body>
          <script>window.SNOWMAN_STATUS = {"created_at": 1763683200000};</script>
          <h1 class="article__bd__title">聪明人破产只有三种方式：酒、美色、杠杆</h1>
          <div class="article__bd__detail"><p>完整正文内容测试。</p></div>
        </body>
      </html>
    `;
    const res = extractArticleFromHtml(html, "https://www.xueqiu.com/1674052027/417954856");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.title).toBe("聪明人破产只有三种方式：酒、美色、杠杆");
      expect(res.eventDate).toBe("2025-11-21");
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
