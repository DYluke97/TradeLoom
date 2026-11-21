import { mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

export type WorkspacePaths = {
  root: string;
  sources: string;
  vault: string;
  manuals: string;
  configFile: string;
  conceptsFile: string;
};

export function getWorkspacePaths(): WorkspacePaths {
  const root = path.resolve(
    process.env.TRADELOOM_WORKSPACE_DIR?.trim() || path.join(process.cwd(), "workspace"),
  );
  const sources = process.env.TRADELOOM_SOURCE_DIR?.trim()
    ? path.resolve(process.env.TRADELOOM_SOURCE_DIR.trim())
    : path.join(root, "sources");
  return {
    root,
    sources,
    vault: path.join(root, "vault"),
    manuals: path.join(root, "manuals"),
    configFile: path.join(root, "config.json"),
    conceptsFile: path.join(root, "concepts.json"),
  };
}

export async function ensureWorkspace(): Promise<WorkspacePaths> {
  const p = getWorkspacePaths();
  await Promise.all([
    mkdir(p.root, { recursive: true }),
    mkdir(p.sources, { recursive: true }),
    mkdir(p.vault, { recursive: true }),
    mkdir(p.manuals, { recursive: true }),
  ]);
  return p;
}

const normPath = (p: string) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

/**
 * Ensures `rel` stays strictly inside `root` both lexically and after resolving symlinks.
 */
export async function insideRoot(root: string, rel: string): Promise<string | null> {
  if (!rel || rel.includes("\0")) return null;
  const rootLex = path.resolve(root);
  const full = path.resolve(rootLex, rel);
  const rootNorm = normPath(rootLex);
  const fullNorm = normPath(full);
  if (fullNorm !== rootNorm && !fullNorm.startsWith(rootNorm + "/")) return null;

  try {
    const rootReal = normPath(await realpath(rootLex));
    const fullRealPath = await realpath(full);
    const fullReal = normPath(fullRealPath);
    if (fullReal !== rootReal && !fullReal.startsWith(rootReal + "/")) return null;
    return fullRealPath;
  } catch {
    return null;
  }
}

/**
 * Atomic file write: write temp file in same directory -> fsync -> rename.
 */
export async function writeAtomic(targetPath: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  const fh = await open(tmp, "w");
  try {
    if (typeof content === "string") {
      await fh.writeFile(content, "utf8");
    } else {
      await fh.writeFile(content);
    }
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, targetPath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
