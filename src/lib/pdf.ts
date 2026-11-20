import { createHash } from "node:crypto";

export type PdfPageText = {
  page: number;
  text: string;
  chars: number;
  sha256: string;
  head: string;
};

export type PdfExtractResult =
  | { ok: true; pages: PdfPageText[]; body: string; pageCount: number }
  | { ok: false; status: "encrypted" | "scanned" | "damaged"; reason: string };

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function extractPdfText(buf: Buffer): Promise<PdfExtractResult> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    const pages: PdfPageText[] = [];
    const parts: string[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const raw = content.items
        .map((it) => ("str" in it && typeof it.str === "string" ? it.str : ""))
        .join(" ")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      if (raw) {
        pages.push({
          page: p,
          text: raw,
          chars: raw.length,
          sha256: sha(raw),
          head: raw.slice(0, 120),
        });
        parts.push(`[第 ${p} 页]\n${raw}`);
      }
    }

    const pageCount = doc.numPages;
    await loadingTask.destroy();

    if (pages.length === 0) {
      return { ok: false, status: "scanned", reason: "PDF 未提取到可选文字（可能是纯图片扫描件）" };
    }
    return {
      ok: true,
      pages,
      body: parts.join("\n\n"),
      pageCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password/i.test(msg)) {
      return { ok: false, status: "encrypted", reason: "PDF 受密码保护，无法提取正文" };
    }
    return { ok: false, status: "damaged", reason: `PDF 解析失败：${msg}` };
  }
}
