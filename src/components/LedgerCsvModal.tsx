"use client";

import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CsvColumnMapping, CsvImportKind, CsvPreviewResult } from "@/lib/ledger-csv";

export default function LedgerCsvModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (payload: Record<string, unknown>, message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<CsvPreviewResult | null>(null);
  const [kind, setKind] = useState<CsvImportKind>("trades");
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr("");
  }, [open]);

  if (!open) return null;

  async function handleFileSelect(f: File | null) {
    if (!f) return;
    setFile(f);
    setPasteText("");
    setErr("");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("action", "preview");
      const res = await fetch("/api/ledger", { method: "POST", body: form });
      const data = await res.json();
      if (data.ok) {
        setPreview(data);
        setKind(data.detectedKind);
        setMapping(data.mapping || {});
      } else {
        setPreview(null);
        setErr(data.error || "预览解析失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handlePreviewPaste() {
    if (!pasteText.trim()) return;
    setFile(null);
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview-csv-text", text: pasteText }),
      });
      const data = await res.json();
      if (data.ok) {
        setPreview(data);
        setKind(data.detectedKind);
        setMapping(data.mapping || {});
      } else {
        setPreview(null);
        setErr(data.error || "文本解析失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setErr("");
    setBusy(true);
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("action", "commit");
        form.append("kind", kind);
        form.append("mapping", JSON.stringify(mapping));
        res = await fetch("/api/ledger", { method: "POST", body: form });
      } else {
        res = await fetch("/api/ledger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "commit-csv-text", text: pasteText, kind, mapping }),
        });
      }
      const data = await res.json();
      if (data.ok) {
        const typeLabel = kind === "trades" ? "笔股票成交" : "天净值记录";
        const msg = `成功导入 ${data.imported ?? ""} ${typeLabel}${data.skipped ? `（跳过 ${data.skipped} 条重复或非交易行）` : ""}，已自动更新曲线与 K 线买卖点。`;
        onImported(data, msg);
        setPreview(null);
        setFile(null);
        setPasteText("");
        onClose();
      } else {
        setErr(data.error || "导入失败");
      }
    } finally {
      setBusy(false);
    }
  }

  const fields: Array<{ key: keyof CsvColumnMapping; label: string; required?: boolean }> =
    kind === "trades"
      ? [
          { key: "date", label: "成交日期", required: true },
          { key: "symbol", label: "证券代码", required: true },
          { key: "name", label: "证券名称" },
          { key: "side", label: "买卖方向", required: true },
          { key: "price", label: "成交价格" },
          { key: "quantity", label: "成交股数" },
          { key: "amount", label: "成交金额" },
          { key: "fee", label: "手续费/税" },
          { key: "tag", label: "操作标签" },
          { key: "note", label: "备注" },
        ]
      : [
          { key: "date", label: "交易日期", required: true },
          { key: "dailyReturnPct", label: "当日收益率%" },
          { key: "nav", label: "单位净值" },
          { key: "positionPct", label: "总仓位%" },
          { key: "benchmarkPct", label: "基准涨跌幅%" },
          { key: "note", label: "备注" },
        ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
            <FileSpreadsheet className="h-[19px] w-[19px] text-[var(--emerald)]" />
            智能导入券商交割单 / 每日净值表（兼容同花顺 / 通达信 / 东财 / 华泰 / 富途 / Excel）
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--ink-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-strong)]"
          >
            <X className="h-[19px] w-[19px]" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-deep)]/85 px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-[11px] text-[var(--ink-muted)]">
              <ShieldCheck className="h-[19px] w-[19px] text-[var(--emerald)]" />
              <span>纯本地解析（自动识别 GBK / UTF-8），自动丢弃「资金账号 / 股东代码 / 合同号」等敏感列</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/api/ledger/template?kind=trades"
                className="inline-flex items-center gap-1 rounded border border-[var(--cyan)]/40 bg-[var(--cyan-soft)] px-2 py-1 text-[11px] text-[var(--cyan)] hover:bg-[var(--cyan)]/20"
              >
                <Download className="h-4 w-4" />
                交割单模板
              </a>
              <a
                href="/api/ledger/template?kind=daily"
                className="inline-flex items-center gap-1 rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--accent)]/20"
              >
                <Download className="h-4 w-4" />
                每日净值模板
              </a>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-deep)]/65 p-5 text-center transition hover:border-[var(--cyan)]/60"
            >
              <Upload className="h-6 w-6 text-[var(--cyan)]" />
              <div className="mt-2 font-medium text-[var(--ink)]">
                {file ? `已选文件：${file.name}` : "点击选择券商导出的 .csv / .tsv / .txt 文件"}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ink-dim)]">支持逗号 / 制表符 / 分号分隔，GB18030 自动转码</div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-deep)]/65 p-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
                <span>或直接从 Excel / Notion 复制表格粘贴</span>
                <button
                  type="button"
                  onClick={handlePreviewPaste}
                  disabled={!pasteText.trim() || busy}
                  className="rounded border border-[var(--cyan)]/45 bg-[var(--cyan-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--cyan)] disabled:opacity-40"
                >
                  解析预览
                </button>
              </div>
              <textarea
                rows={4}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="粘贴含表头的表格文本（支持 Tab 或逗号分隔）..."
                className="w-full flex-1 rounded border border-[var(--border)] bg-[var(--chart-bg)] p-2 font-mono text-[11px] text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
              />
            </div>
          </div>

          {preview && (
            <div className="space-y-3 rounded-xl border border-[var(--cyan)]/35 bg-[var(--bg-deep)]/90 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CheckCircle2 className="h-[19px] w-[19px] text-[var(--emerald)]" />
                  <span className="font-semibold text-[var(--ink-strong)]">
                    识别成功：共 {preview.totalRows} 行 · 编码 {preview.encoding.toUpperCase()}
                  </span>
                  {preview.redactedColumns.length > 0 && (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-[var(--emerald)]">
                      已自动脱敏丢弃：{preview.redactedColumns.join("、")}
                    </span>
                  )}
                </div>

                <div className="inline-flex rounded border border-[var(--border)] bg-[var(--surface)] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setKind("trades")}
                    className={`rounded px-2.5 py-0.5 ${
                      kind === "trades" ? "bg-[var(--cyan-soft)] font-medium text-[var(--cyan)]" : "text-[var(--ink-muted)]"
                    }`}
                  >
                    股票交割单流水
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind("daily")}
                    className={`rounded px-2.5 py-0.5 ${
                      kind === "daily" ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "text-[var(--ink-muted)]"
                    }`}
                  >
                    每日净值/盈亏表
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {fields.map((f) => (
                  <label key={f.key} className="block space-y-1">
                    <span className="text-[10px] text-[var(--ink-muted)]">
                      {f.label}
                      {f.required && <span className="text-[var(--rose)]"> *</span>}
                    </span>
                    <select
                      value={mapping[f.key] !== undefined ? String(mapping[f.key]) : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMapping((prev) => ({
                          ...prev,
                          [f.key]: v === "" ? undefined : Number(v),
                        }));
                      }}
                      className="w-full rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--ink)] focus:border-[var(--cyan)] focus:outline-none"
                    >
                      <option value="">-- 忽略 --</option>
                      {preview.headers.map((h, idx) => (
                        <option key={idx} value={String(idx)}>
                          [{idx + 1}] {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div className="overflow-x-auto rounded border border-[var(--border)]">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-[var(--surface)] text-[var(--ink-dim)]">
                    <tr>
                      {preview.headers.map((h, i) => (
                        <th key={i} className="whitespace-nowrap px-2 py-1.5">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]/50">
                    {preview.sampleRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {preview.headers.map((_, cIdx) => (
                          <td key={cIdx} className="whitespace-nowrap px-2 py-1 text-[var(--ink-muted)]">
                            {row[cIdx] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[var(--rose)]">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs text-[var(--ink-muted)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!preview || busy}
            onClick={handleCommit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent)] disabled:opacity-45"
          >
            {busy && <Loader2 className="h-[17px] w-[17px] animate-spin" />}
            确认入账 ({preview?.totalRows ?? 0} 行)
          </button>
        </div>
      </div>
    </div>
  );
}