import { describe, expect, it } from "vitest";
import { carrierOf, convertFile, guessTitle, htmlToMd, textToMd } from "@/lib/convert";

describe("convert", () => {
  it("recognizes supported carriers including pdf", () => {
    expect(carrierOf("2025-03-01_复盘.md")).toBe("md");
    expect(carrierOf("notes.txt")).toBe("txt");
    expect(carrierOf("report.docx")).toBe("docx");
    expect(carrierOf("clip.html")).toBe("html");
    expect(carrierOf("annual.pdf")).toBe("pdf");
    expect(carrierOf("archive.zip")).toBeNull();
  });

  it("strips scripts and converts html tables to gfm markdown", () => {
    const html = `
      <html><head><title>x</title></head><body>
        <script>alert(1)</script>
        <h1>收盘复盘</h1>
        <img src="data:image/png;base64,AAA" alt="分时图" />
        <table><thead><tr><th>标的</th><th>结论</th></tr></thead>
        <tbody><tr><td>示例A</td><td>分歧转一致</td></tr></tbody></table>
      </body></html>
    `;
    const res = htmlToMd(html);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.md).toContain("# 收盘复盘");
      expect(res.md).toContain("分歧转一致");
      expect(res.md).not.toContain("alert(1)");
      expect(res.md).not.toContain("base64");
      expect(res.warnings.length).toBe(1);
    }
  });

  it("joins hard-wrapped Chinese lines while preserving lists", () => {
    const res = textToMd("第一行中文\n第二行紧接\n\n- 列表一\n- 列表二");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.md).toContain("第一行中文第二行紧接");
      expect(res.md).toContain("- 列表一");
    }
  });

  it("rejects empty buffers and extracts title from first heading", async () => {
    const empty = await convertFile("a.md", Buffer.alloc(0));
    expect(empty.ok).toBe(false);
    expect(guessTitle("\n# 我的复盘标题\n正文", "fallback")).toBe("我的复盘标题");
  });
});
