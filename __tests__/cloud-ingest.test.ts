import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractFeishuToken, notionBlocksToMarkdown } from "../src/lib/cloud-connectors";
import {
  detectPlatformFromUrl,
  extractArticleFromHtml,
  importPastedReview,
  isXueqiuWafChallenge,
  parseBatchUrls,
  validatePublicFetchUrl,
} from "../src/lib/cloud-ingest";
import {
  formatChinaDateFromEpoch,
  parseFeishuBlockMapToMarkdown,
  parseNotionRecordMapToMarkdown,
  unwrapYinxiangHtml,
} from "../src/lib/cloud-resolvers";

describe("cloud-ingest & platform resolvers", () => {
  it("blocks private/local URLs for SSRF safety and detects platforms accurately", () => {
    expect(validatePublicFetchUrl("http://127.0.0.1:3200/api/vault").ok).toBe(false);
    expect(validatePublicFetchUrl("http://localhost:8080/secret").ok).toBe(false);
    expect(validatePublicFetchUrl("http://192.168.1.1/admin").ok).toBe(false);
    expect(validatePublicFetchUrl("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(validatePublicFetchUrl("file:///etc/passwd").ok).toBe(false);

    expect(validatePublicFetchUrl("https://xueqiu.com/123456/789012").ok).toBe(true);
    expect(detectPlatformFromUrl("https://xueqiu.com/123456/789012")).toBe("雪球");
    expect(detectPlatformFromUrl("https://my.feishu.cn/docx/AbCdEf123")).toBe("飞书文档");
    expect(detectPlatformFromUrl("https://www.yuque.com/u1/trading/abc")).toBe("语雀");
    expect(detectPlatformFromUrl("https://app.yinxiang.com/fx/abc")).toBe("印象笔记");
    expect(detectPlatformFromUrl("https://share.evernote.com/note/abc")).toBe("Evernote");
  });

  it("extracts Xueqiu SNOWMAN_STATUS JSON cleanly with quoted retweet and +08:00 date (zero hidden watermark)", () => {
    // 2026-09-28 00:30:00 CST = 2026-09-27 16:30:00 UTC -> 1790526600000
    const statusJson = JSON.stringify({
      title: "",
      created_at: 1790526600000,
      user: { screen_name: "短线复盘手" },
      text: '<p style="display:none;">来源：雪球App，作者：短线复盘手</p><p>今天情绪周期进入<strong>退潮冰点</strong>，严格执行止损。</p>',
      retweeted_status: {
        user: { screen_name: "提问球友" },
        title: "",
        text: "<p>请问退潮期如何控制回撤？</p>",
      },
    });
    const html = `<html><head><title>雪球</title></head><body><script>window.SNOWMAN_STATUS = ${statusJson};</script></body></html>`;

    const res = extractArticleFromHtml(html, "https://xueqiu.com/1247347556/410686155");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.eventDate).toBe("2026-09-28");
      expect(res.title).toContain("短线复盘手");
      expect(res.md).toContain("**退潮冰点**");
      expect(res.md).toContain("转发自 @提问球友");
      expect(res.md).toContain("请问退潮期如何控制回撤");
      expect(res.md).not.toContain("来源：雪球App");
    }
  });

  it("extracts WeChat publish date from var ct (+08:00) and rejects violated/deleted pages", () => {
    // 2025-08-08 18:25:18 CST = 1754648718
    const okHtml = `
      <html>
        <head><title>盘后深度复盘 - 微信公众平台</title></head>
        <body>
          <script>var ct = "1754648718"; var nickname = htmlDecode("量化复盘笔记");</script>
          <div id="js_content"><p>今天市场完成了从冰点到分歧转一致的关键切换，龙头承接非常强势。</p></div>
        </body>
      </html>
    `;
    const okRes = extractArticleFromHtml(okHtml, "https://mp.weixin.qq.com/s/test123");
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.eventDate).toBe("2025-08-08");
      expect(okRes.md).toContain("公众号：量化复盘笔记");
      expect(okRes.md).toContain("分歧转一致");
    }

    const violatedHtml = `
      <html><head><title>此内容因违规无法查看</title></head>
      <body><h2 class="weui-msg__title">此内容因违规无法查看</h2><div>视频 小程序 赞 分享</div></body></html>
    `;
    const failRes = extractArticleFromHtml(violatedHtml, "https://mp.weixin.qq.com/s/deleted999");
    expect(failRes.ok).toBe(false);
  });

  it("rejects empty SPA shells, image-only placeholder pages, and Zhihu zse_ck anti-bot pages", () => {
    const yinxiangSpa = `<html><body><div id="root"></div><img src="/fx/assets/yx-icon@300.png" style="display:none"/></body></html>`;
    expect(extractArticleFromHtml(yinxiangSpa, "https://app.yinxiang.com/fx/123").ok).toBe(false);

    const zhihuBot = `<html><head><meta id="zh-zse-ck" content="1"/></head><body>知乎，让每一次点击都充满意义</body></html>`;
    expect(extractArticleFromHtml(zhihuBot, "https://zhuanlan.zhihu.com/p/446274572").ok).toBe(false);
  });

  it("parses Feishu block_map, Notion double-wrapped recordMap, and Yinxiang SuperNote CDATA", () => {
    const feishu = parseFeishuBlockMapToMarkdown({
      root: { id: "root", data: { type: "page", children: ["h1", "p1", "b1"], text: { initialAttributedTexts: { text: { "0": "飞书交易体系" } } } } },
      h1: { id: "h1", data: { type: "heading2", text: { initialAttributedTexts: { text: { "0": "核心纪律" } } } } },
      p1: { id: "p1", data: { type: "text", text: { initialAttributedTexts: { text: { "0": "永不重仓单一题材" } } } } },
      b1: { id: "b1", data: { type: "bullet", text: { initialAttributedTexts: { text: { "0": "冰点轻仓试错" } } } } },
    });
    expect(feishu.title).toBe("飞书交易体系");
    expect(feishu.md).toContain("## 核心纪律");
    expect(feishu.md).toContain("- 冰点轻仓试错");

    const notion = parseNotionRecordMapToMarkdown(
      {
        "11111111-1111-1111-1111-111111111111": {
          value: {
            value: {
              id: "11111111-1111-1111-1111-111111111111",
              type: "page",
              properties: { title: [["Notion 复盘框架"]] },
              content: ["b1", "b2"],
              created_time: 1763683200000,
            },
          },
        },
        b1: { value: { value: { id: "b1", type: "sub_header", properties: { title: [["估值锚检查"]] } } } },
        b2: { value: { value: { id: "b2", type: "to_do", properties: { title: [["核对现金流", [["b"]]]], checked: [["Yes"]] } } } },
      },
      "11111111-1111-1111-1111-111111111111",
    );
    expect(notion.title).toBe("Notion 复盘框架");
    expect(notion.eventDate).toBe("2025-11-21");
    expect(notion.md).toContain("## 估值锚检查");
    expect(notion.md).toContain("- [x] **核对现金流**");

    const enex = `<?xml version="1.0"?><en-export><note><content><![CDATA[<en-note><p>印象超级笔记正文</p></en-note>]]></content></note></en-export>`;
    expect(unwrapYinxiangHtml(enex)).toBe("<p>印象超级笔记正文</p>");
    expect(formatChinaDateFromEpoch(1763683200)).toBe("2025-11-21");
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

  it("parses official Notion blocks and Feishu connector URLs cleanly", () => {
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

  it("parses, deduplicates, cleans, and caps multi-line batch URLs", () => {
    const raw = `
      - https://xueqiu.com/4600361796/351477201
      1. https://xueqiu.com/4600361796/351477201
      2. 复盘链接：https://mp.weixin.qq.com/s/demo123。
      invalid line without url
      https://www.yuque.com/u1/book/doc1)
    `;
    const urls = parseBatchUrls(raw);
    expect(urls).toEqual([
      "https://xueqiu.com/4600361796/351477201",
      "https://mp.weixin.qq.com/s/demo123",
      "https://www.yuque.com/u1/book/doc1",
    ]);

    const hugeList = Array.from({ length: 80 }, (_, i) => `https://xueqiu.com/1/${1000 + i}`).join("\n");
    expect(parseBatchUrls(hugeList)).toHaveLength(50);
  });

  it("detects Xueqiu Aliyun WAF challenge shells without false positives on real posts", () => {
    const wafHtml = `<html><head><script>var arg1='ABCDEF123456'; document.cookie='acw_sc__v2='+arg1;</script></head><body></body></html>`;
    const shortShell = `<html><head><script>location.reload()</script></head><body></body></html>`;
    const realPostHtml = `<html><body><script>window.SNOWMAN_STATUS = {"id":351477201,"text":"今日复盘"};</script></body></html>`;

    expect(isXueqiuWafChallenge(wafHtml)).toBe(true);
    expect(isXueqiuWafChallenge(shortShell)).toBe(true);
    expect(isXueqiuWafChallenge(realPostHtml)).toBe(false);
  });

  it("extracts Sina Blog real title, publish date, and body while ignoring placeholder h1", () => {
    const sinaHtml = `
      <html>
        <head><title>11.20收盘：极致的指数与个股背离_复盘专栏_新浪博客</title></head>
        <body>
          <h1 id="blogname" class="blogtitle"><span id="blognamespan">加载中...</span></h1>
          <h2 id="t_599d75180102zxfb" class="titName SG_txta">11.20收盘：极致的“指数与个股背离”</h2>
          <span class="time SG_txtc">(2026-11-20 15:17:24)</span>
          <div id="sina_keyword_ad_area2" class="articalContent">
            <p>今日大盘缩量震荡，科技股冲高回落，短线注意控制仓位避免追高。</p>
          </div>
        </body>
      </html>
    `;
    const res = extractArticleFromHtml(sinaHtml, "https://blog.sina.com.cn/s/blog_599d75180102zxfb.html");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.platform).toBe("新浪博客");
      expect(res.title).toBe("11.20收盘：极致的“指数与个股背离”");
      expect(res.eventDate).toBe("2026-11-20");
      expect(res.md).toContain("科技股冲高回落");
    }
  });

  it("blocks IPv4-mapped IPv6 hex literals, expanded loopback, and CGNAT/cloud metadata ranges", () => {
    expect(validatePublicFetchUrl("http://[::ffff:127.0.0.1]/secret").ok).toBe(false);
    expect(validatePublicFetchUrl("http://[0:0:0:0:0:0:0:1]:8080/").ok).toBe(false);
    expect(validatePublicFetchUrl("http://100.100.100.200/latest/meta-data/").ok).toBe(false);
  });
});
