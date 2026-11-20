import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { carrierOf, convertFile, guessTitle, MAX_INPUT_BYTES } from "./convert";
import { buildVault, type VaultDoc, type VaultIndex } from "./vault-builder";
import { ensureWorkspace, fileExists, getWorkspacePaths, insideRoot, writeAtomic } from "./workspace";

const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

export async function loadOrBuildVault(): Promise<{ index: VaultIndex; workspaceRoot: string; vaultDir: string; sourceDir: string }> {
  const paths = await ensureWorkspace();
  const indexPath = path.join(paths.vault, "index.json");
  if (await fileExists(indexPath)) {
    try {
      const raw = JSON.parse(await readFile(indexPath, "utf8")) as VaultIndex;
      if (raw && raw.schema === "tradeloom-vault@v2" && Array.isArray(raw.documents)) {
        return { index: raw, workspaceRoot: paths.root, vaultDir: paths.vault, sourceDir: paths.sources };
      }
    } catch {
      /* rebuild below */
    }
  }
  const index = await buildVault(paths.sources, paths.vault, paths.manuals);
  return { index, workspaceRoot: paths.root, vaultDir: paths.vault, sourceDir: paths.sources };
}

export async function rebuildVault(): Promise<VaultIndex> {
  const paths = await ensureWorkspace();
  return buildVault(paths.sources, paths.vault, paths.manuals);
}

/**
 * Loads the built-in synthetic sample reviews from `<repo>/samples/` into `workspace/sources/` and rebuilds the vault.
 */
export async function loadSampleReviews(): Promise<{ copied: number; index: VaultIndex }> {
  const paths = await ensureWorkspace();
  const sampleDir = path.join(process.cwd(), "samples");
  const entries = await readdir(sampleDir, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const dest = path.join(paths.sources, entry.name);
    await copyFile(path.join(sampleDir, entry.name), dest);
    copied++;
  }
  const index = await buildVault(paths.sources, paths.vault, paths.manuals);
  return { copied, index };
}

export async function readVaultCard(cardRel: string): Promise<{ text: string; sha256: string } | null> {
  const paths = getWorkspacePaths();
  const full = await insideRoot(paths.vault, cardRel);
  if (!full) return null;
  try {
    const info = await stat(full);
    if (!info.isFile() || info.size > 4 * 1024 * 1024) return null;
    const text = await readFile(full, "utf8");
    return { text, sha256: sha(text) };
  } catch {
    return null;
  }
}

export async function readOriginalSource(sourceRel: string): Promise<{
  text: string | null;
  utf8: boolean;
  bytes: number;
  sha256: string;
} | null> {
  const paths = getWorkspacePaths();
  const full = await insideRoot(paths.sources, sourceRel);
  if (!full) return null;
  try {
    const info = await stat(full);
    if (!info.isFile() || info.size > 8 * 1024 * 1024) return null;
    const buf = await readFile(full);
    let text: string | null = null;
    let utf8 = true;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      utf8 = false;
    }
    return { text, utf8, bytes: info.size, sha256: sha(buf) };
  } catch {
    return null;
  }
}

export async function readOriginalBytes(sourceRel: string, maxBytes = 64 * 1024 * 1024): Promise<{
  bytes: ArrayBuffer;
  byteLength: number;
  sha256: string;
} | null> {
  const paths = getWorkspacePaths();
  const full = await insideRoot(paths.sources, sourceRel);
  if (!full) return null;
  try {
    const info = await stat(full);
    if (!info.isFile() || info.size > maxBytes) return null;
    const buf = await readFile(full);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { bytes, byteLength: buf.byteLength, sha256: sha(buf) };
  } catch {
    return null;
  }
}

export type SaveSourceOutcome =
  | { ok: true; sha256: string; bytes: number; backup: string; index: VaultIndex }
  | { ok: false; status: number; error: string; currentSha?: string };

/**
 * Safe atomic source editor:
 * 1) Verifies `sourceRel` exists in vault index & stays inside source root;
 * 2) Optimistic lock via `expectSha` (returns 409 on conflict);
 * 3) Writes backup into `.vault-history/` before overwriting;
 * 4) Atomically writes new text & rebuilds the Obsidian vault.
 */
export async function saveOriginalSource(
  doc: VaultDoc,
  newText: string,
  expectSha: string,
): Promise<SaveSourceOutcome> {
  if (doc.carrier !== "md" && doc.carrier !== "txt") {
    return { ok: false, status: 400, error: "仅支持在线编辑 Markdown / TXT 原文" };
  }
  const paths = getWorkspacePaths();
  const full = await insideRoot(paths.sources, doc.source_rel);
  if (!full) return { ok: false, status: 404, error: "找不到对应源文件" };

  const oldBuf = await readFile(full);
  const currentSha = sha(oldBuf);
  if (currentSha !== expectSha) {
    return { ok: false, status: 409, error: "文件已被外部修改，请重新加载后再保存", currentSha };
  }

  const stamp = new Date().toISOString().slice(0, 23).replace(/[-:]/g, "").replace("T", "-").replace(".", "-");
  const backupRel = `.vault-history/${doc.source_rel}.${stamp}.bak`;
  const backupFull = path.join(paths.sources, backupRel);
  await writeAtomic(backupFull, oldBuf);

  const nextBuf = Buffer.from(newText, "utf8");
  await writeAtomic(full, nextBuf);
  const index = await buildVault(paths.sources, paths.vault, paths.manuals);

  return { ok: true, sha256: sha(nextBuf), bytes: nextBuf.byteLength, backup: backupRel, index };
}

function sanitizeFileName(raw: string): string {
  return raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, "_").slice(0, 100) || "note";
}

export type ImportOutcome =
  | { ok: true; sourceRel: string; carrier: string; warnings: string[]; index: VaultIndex }
  | { ok: false; status: number; error: string };

/**
 * Imports a user-uploaded file (.md / .txt / .docx / .html / .pdf):
 * - PDF: stored verbatim in `sources/_导入/` so it can be viewed inline & extracted page-by-page.
 * - md/txt/docx/html: original archived in `vault/_inbox/`, converted to clean Markdown in `sources/_导入/`.
 * - Automatically rebuilds the Obsidian bi-directional vault.
 */
export async function importUploadedFile(fileName: string, buf: Buffer): Promise<ImportOutcome> {
  if (buf.length === 0) return { ok: false, status: 400, error: "上传的文件为空" };
  if (buf.length > MAX_INPUT_BYTES) {
    return { ok: false, status: 413, error: `文件超过 ${MAX_INPUT_BYTES / 1024 / 1024} MB 上限` };
  }

  const carrier = carrierOf(fileName);
  if (!carrier) {
    return { ok: false, status: 422, error: "不支持该文件格式（支持 .md / .txt / .docx / .html / .pdf）" };
  }

  const paths = await ensureWorkspace();
  const digest = sha(buf);
  const shortHash = digest.slice(0, 8);
  const safeBase = sanitizeFileName(path.basename(fileName, path.extname(fileName)));
  const datePrefix = /^\d{4}-\d{2}-\d{2}/.test(safeBase)
    ? ""
    : `${new Date().toISOString().slice(0, 10)}_导入材料_`;

  if (carrier === "pdf") {
    const destRel = `_导入/${datePrefix}${safeBase}.pdf`;
    await writeAtomic(path.join(paths.sources, destRel), buf);
    const index = await buildVault(paths.sources, paths.vault, paths.manuals);
    return { ok: true, sourceRel: destRel, carrier: "pdf", warnings: [], index };
  }

  const converted = await convertFile(fileName, buf);
  if (!converted.ok) {
    return { ok: false, status: 422, error: converted.error };
  }

  // Keep raw original in vault/_inbox/ as provenance archive
  await mkdir(path.join(paths.vault, "_inbox"), { recursive: true });
  await writeAtomic(path.join(paths.vault, "_inbox", `${shortHash}-${sanitizeFileName(fileName)}`), buf);

  let mdBody = converted.md;
  if (carrier !== "md") {
    const title = guessTitle(mdBody, safeBase);
    const bodyWithoutDupH1 = mdBody.replace(/^#\s+.+\n+/, "");
    mdBody = [
      `# ${title}`,
      "",
      `> 导入来源：\`${fileName}\`（${carrier.toUpperCase()}） · SHA-256: \`${shortHash}\``,
      "",
      "---",
      "",
      bodyWithoutDupH1 || mdBody,
      "",
    ].join("\n");
  }

  const destRel = `_导入/${datePrefix}${safeBase}.md`;
  await writeAtomic(path.join(paths.sources, destRel), mdBody);
  const index = await buildVault(paths.sources, paths.vault, paths.manuals);

  return { ok: true, sourceRel: destRel, carrier, warnings: converted.warnings, index };
}
