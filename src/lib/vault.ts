import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { loadConceptRules } from "./concepts";
import { carrierOf, convertFile, guessTitle, MAX_INPUT_BYTES } from "./convert";
import { buildVault, wrapFirstUnlinkedOccurrence, type VaultDoc, type VaultIndex } from "./vault-builder";
import {
  DEFAULT_VAULT_ID,
  ensureWorkspace,
  fileExists,
  getActiveVaultId,
  getWorkspacePaths,
  insideRoot,
  isValidVaultId,
  runWithVault,
  writeAtomic,
} from "./workspace";
import { createZipBuffer, type ZipInputEntry } from "./zip";

const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

const vaultBuildQueues = new Map<string, Promise<unknown>>();

async function buildVaultWithUserConcepts(): Promise<VaultIndex> {
  const vaultId = getActiveVaultId();
  const prev = vaultBuildQueues.get(vaultId) ?? Promise.resolve();
  const run = async (): Promise<VaultIndex> =>
    runWithVault(vaultId, async () => {
      const paths = await ensureWorkspace(vaultId);
      const { rules } = await loadConceptRules();
      return buildVault(paths.sources, paths.vault, paths.manuals, rules);
    });
  const next = prev.then(run, run);
  vaultBuildQueues.set(vaultId, next.catch(() => {}));
  return next;
}

export async function loadOrBuildVault(): Promise<{ index: VaultIndex; workspaceRoot: string; vaultDir: string; sourceDir: string }> {
  const paths = await ensureWorkspace();
  const indexPath = path.join(paths.vault, "index.json");
  if (await fileExists(indexPath)) {
    try {
      const raw = JSON.parse(await readFile(indexPath, "utf8")) as VaultIndex;
      if (raw && raw.schema === "tradeloom-vault@v3" && Array.isArray(raw.documents)) {
        return { index: raw, workspaceRoot: paths.root, vaultDir: paths.vault, sourceDir: paths.sources };
      }
    } catch {
      /* rebuild below */
    }
  }
  const index = await buildVaultWithUserConcepts();
  return { index, workspaceRoot: paths.root, vaultDir: paths.vault, sourceDir: paths.sources };
}

export async function rebuildVault(): Promise<VaultIndex> {
  return buildVaultWithUserConcepts();
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
  const index = await buildVaultWithUserConcepts();
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
  const index = await buildVaultWithUserConcepts();

  return { ok: true, sha256: sha(nextBuf), bytes: nextBuf.byteLength, backup: backupRel, index };
}

/**
 * Converts an Obsidian Unlinked Mention inside `sourceDoc` into a real `[[target|match]]` wikilink,
 * backing up the original source into `.vault-history/` before atomic write and vault rebuild.
 */
export async function materializeUnlinkedMention(args: {
  sourceCard: string;
  targetRel: string;
  match: string;
}): Promise<
  | { ok: true; backup: string; index: VaultIndex }
  | { ok: false; status: number; error: string }
> {
  const { index } = await loadOrBuildVault();
  const sourceDoc = index.documents.find((d) => d.card === args.sourceCard);
  if (!sourceDoc) {
    return { ok: false, status: 404, error: "找不到来源笔记" };
  }
  if (sourceDoc.carrier !== "md" && sourceDoc.carrier !== "txt") {
    return { ok: false, status: 400, error: "仅支持在 Markdown / TXT 源文件中插入双链" };
  }
  if (!index.files.some((f) => f.rel === args.targetRel)) {
    return { ok: false, status: 404, error: "找不到目标卡片" };
  }

  const src = await readOriginalSource(sourceDoc.source_rel);
  if (!src || !src.utf8 || src.text === null) {
    return { ok: false, status: 400, error: "源文件非 UTF-8 文本，无法自动插入双链" };
  }

  const targetWithoutExt = args.targetRel.replace(/\.md$/, "");
  const wrapped = wrapFirstUnlinkedOccurrence(src.text, args.match, targetWithoutExt);
  if (!wrapped.changed) {
    return { ok: false, status: 409, error: "原文中已不存在未链接的匹配词，可能已建立链接" };
  }

  const saved = await saveOriginalSource(sourceDoc, wrapped.nextText, src.sha256);
  if (!saved.ok) {
    return { ok: false, status: saved.status, error: saved.error };
  }
  return { ok: true, backup: saved.backup, index: saved.index };
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
 * - Automatically rebuilds the Obsidian bi-directional vault unless `options.skipRebuild` is true
 *   (used by batch upload to write all files first and rebuild ONCE at the end).
 */
export async function importUploadedFile(
  fileName: string,
  buf: Buffer,
  options?: { skipRebuild?: boolean },
): Promise<ImportOutcome> {
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
    const destRel = `_导入/${datePrefix}${safeBase}_${shortHash}.pdf`;
    await writeAtomic(path.join(paths.sources, destRel), buf);
    const index = options?.skipRebuild ? (null as unknown as VaultIndex) : await buildVaultWithUserConcepts();
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

  const destRel = `_导入/${datePrefix}${safeBase}_${shortHash}.md`;
  await writeAtomic(path.join(paths.sources, destRel), mdBody);
  const index = options?.skipRebuild ? (null as unknown as VaultIndex) : await buildVaultWithUserConcepts();

  return { ok: true, sourceRel: destRel, carrier, warnings: converted.warnings, index };
}

export async function listBuiltinSampleNames(): Promise<Set<string>> {
  try {
    const sampleDir = path.join(process.cwd(), "samples");
    const entries = await readdir(sampleDir, { withFileTypes: true });
    return new Set(entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name));
  } catch {
    return new Set();
  }
}

export async function hasLoadedSamples(index: VaultIndex): Promise<boolean> {
  const sampleNames = await listBuiltinSampleNames();
  if (sampleNames.size === 0) return false;
  return index.documents.some((d) => sampleNames.has(d.source_rel));
}

async function moveFileToTrash(sourceFullPath: string, labelRel: string): Promise<string> {
  const paths = await ensureWorkspace();
  const trashDir = path.join(paths.vaultRoot, ".trash");
  await mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const flatName = labelRel.replace(/[\\/]+/g, "__");
  const trashRel = `.trash/${stamp}_${flatName}`;
  const destFullPath = path.join(paths.vaultRoot, trashRel);
  try {
    await rename(sourceFullPath, destFullPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EXDEV") {
      await copyFile(sourceFullPath, destFullPath);
      await rm(sourceFullPath, { force: true });
    } else {
      throw err;
    }
  }
  return trashRel;
}

export async function deleteVaultDocument(
  cardRel: string,
): Promise<
  | { ok: true; title: string; trashedTo: string; index: VaultIndex }
  | { ok: false; status: number; error: string }
> {
  const { index } = await loadOrBuildVault();
  const doc = index.documents.find((d) => d.card === cardRel);
  if (!doc) {
    return { ok: false, status: 404, error: "仅支持删除复盘笔记卡片（总览、主题索引或交易手册请在对应页面管理）" };
  }
  const paths = await ensureWorkspace();
  const full = await insideRoot(paths.sources, doc.source_rel);
  if (!full) return { ok: false, status: 404, error: "未找到对应的原始笔记文件" };

  const trashedTo = await moveFileToTrash(full, doc.source_rel);
  const nextIndex = await buildVaultWithUserConcepts();
  return { ok: true, title: doc.title, trashedTo, index: nextIndex };
}

export async function clearSampleReviews(): Promise<{ removed: number; index: VaultIndex }> {
  const paths = await ensureWorkspace();
  const sampleNames = await listBuiltinSampleNames();
  let removed = 0;
  for (const name of sampleNames) {
    const full = await insideRoot(paths.sources, name);
    if (full) {
      await moveFileToTrash(full, name);
      removed++;
    }
  }
  const index = await buildVaultWithUserConcepts();
  return { removed, index };
}

async function collectFilesRecursively(
  dir: string,
  zipRootName = "TradeLoom-Vault",
  prefix = "",
): Promise<ZipInputEntry[]> {
  const out: ZipInputEntry[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFilesRecursively(full, zipRootName, rel)));
    } else if (entry.isFile() && rel !== "index.json") {
      const [data, info] = await Promise.all([readFile(full), stat(full)]);
      out.push({ path: `${zipRootName}/${rel}`, data, mtime: info.mtime });
    }
  }
  return out;
}

export async function exportVaultZipBuffer(vaultId?: string): Promise<Buffer> {
  const targetId = vaultId && isValidVaultId(vaultId) ? vaultId.trim() : getActiveVaultId();
  const zipRootName = targetId === DEFAULT_VAULT_ID ? "TradeLoom-Vault" : `TradeLoom-Vault-${targetId}`;
  return runWithVault(targetId, async () => {
    const { vaultDir } = await loadOrBuildVault();
    const entries = await collectFilesRecursively(vaultDir, zipRootName);
    return createZipBuffer(entries);
  });
}
