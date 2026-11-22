import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_VAULT_ID = "default";
const SAFE_VAULT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

const vaultContext = new AsyncLocalStorage<string>();

type StoredVaultEntry = {
  id?: string;
  externalSourceDir?: string;
};

type StoredVaultRegistry = {
  activeVaultId?: string;
  vaults?: StoredVaultEntry[];
};

export type WorkspacePaths = {
  /** Global TradeLoom workspace root (shared config/connectors/skills/market-cache live here) */
  root: string;
  /** Currently resolved vault identifier ("default" or custom vault id) */
  vaultId: string;
  /** Root directory for the active vault (equals `root` for "default", or `<root>/vaults/<vaultId>`) */
  vaultRoot: string;
  /** Registry file tracking all parallel Obsidian vaults */
  vaultsFile: string;
  /** Parent directory holding non-default managed vaults */
  vaultsDir: string;
  /** Per-vault isolated source documents directory */
  sources: string;
  /** Per-vault isolated built Obsidian bi-directional vault directory */
  vault: string;
  /** Per-vault isolated methodology manuals directory */
  manuals: string;
  /** Global shared Skill templates directory */
  skills: string;
  /** Per-vault isolated ledger directory */
  ledger: string;
  /** Global shared A-share market K-line cache directory */
  marketCache: string;
  /** Per-vault isolated ledger data file */
  ledgerFile: string;
  /** Global shared BYOK LLM provider config file */
  configFile: string;
  /** Per-vault isolated concept taxonomy file */
  conceptsFile: string;
  /** Global shared cloud platform connectors auth file */
  connectorsFile: string;
};

export function isValidVaultId(id: string | undefined | null): id is string {
  return typeof id === "string" && SAFE_VAULT_ID_RE.test(id.trim());
}

/**
 * Runs an async operation scoped to a specific vault ID so every nested helper
 * (`getWorkspacePaths`, `ensureWorkspace`, `loadLedger`, `rebuildVault`, etc.)
 * transparently targets that vault without mutating the global active vault.
 */
export function runWithVault<T>(vaultId: string, fn: () => T): T {
  const clean = isValidVaultId(vaultId) ? vaultId.trim() : DEFAULT_VAULT_ID;
  return vaultContext.run(clean, fn);
}

export function getGlobalWorkspaceRoot(): string {
  return path.resolve(
    process.env.TRADELOOM_WORKSPACE_DIR?.trim() || path.join(process.cwd(), "workspace"),
  );
}

function readRegistrySync(root: string): StoredVaultRegistry | null {
  const vaultsFile = path.join(root, "vaults.json");
  if (!existsSync(vaultsFile)) return null;
  try {
    const raw = JSON.parse(readFileSync(vaultsFile, "utf8")) as StoredVaultRegistry;
    if (raw && typeof raw === "object") return raw;
  } catch {
    /* ignore malformed registry on sync read */
  }
  return null;
}

export function getActiveVaultId(): string {
  const scoped = vaultContext.getStore();
  if (scoped && isValidVaultId(scoped)) return scoped;

  const root = getGlobalWorkspaceRoot();
  const reg = readRegistrySync(root);
  const candidate = reg?.activeVaultId?.trim();
  if (candidate && isValidVaultId(candidate)) {
    if (candidate === DEFAULT_VAULT_ID) return DEFAULT_VAULT_ID;
    if (Array.isArray(reg?.vaults) && reg.vaults.some((v) => v?.id === candidate)) {
      return candidate;
    }
  }
  return DEFAULT_VAULT_ID;
}

export function getWorkspacePaths(overrideVaultId?: string): WorkspacePaths {
  const root = getGlobalWorkspaceRoot();
  const vaultsFile = path.join(root, "vaults.json");
  const vaultsDir = path.join(root, "vaults");
  const reg = readRegistrySync(root);

  let vaultId = DEFAULT_VAULT_ID;
  if (overrideVaultId && isValidVaultId(overrideVaultId)) {
    vaultId = overrideVaultId.trim();
  } else {
    const scoped = vaultContext.getStore();
    if (scoped && isValidVaultId(scoped)) {
      vaultId = scoped;
    } else if (reg?.activeVaultId && isValidVaultId(reg.activeVaultId)) {
      const candidate = reg.activeVaultId.trim();
      if (candidate === DEFAULT_VAULT_ID || reg.vaults?.some((v) => v?.id === candidate)) {
        vaultId = candidate;
      }
    }
  }

  const entry = Array.isArray(reg?.vaults) ? reg.vaults.find((v) => v?.id === vaultId) : undefined;
  const externalSource = entry?.externalSourceDir?.trim();

  // Global shared infrastructure (configured once, shared across all vaults)
  const skills = path.join(root, "skills");
  const marketCache = path.join(root, "ledger", "market-cache");
  const configFile = path.join(root, "config.json");
  const connectorsFile = path.join(root, "connectors.json");

  if (vaultId === DEFAULT_VAULT_ID) {
    const sources = externalSource
      ? path.resolve(externalSource)
      : process.env.TRADELOOM_SOURCE_DIR?.trim()
        ? path.resolve(process.env.TRADELOOM_SOURCE_DIR.trim())
        : path.join(root, "sources");
    return {
      root,
      vaultId: DEFAULT_VAULT_ID,
      vaultRoot: root,
      vaultsFile,
      vaultsDir,
      sources,
      vault: path.join(root, "vault"),
      manuals: path.join(root, "manuals"),
      skills,
      ledger: path.join(root, "ledger"),
      marketCache,
      ledgerFile: path.join(root, "ledger", "ledger.json"),
      configFile,
      conceptsFile: path.join(root, "concepts.json"),
      connectorsFile,
    };
  }

  const vaultRoot = path.join(vaultsDir, vaultId);
  const sources = externalSource ? path.resolve(externalSource) : path.join(vaultRoot, "sources");
  return {
    root,
    vaultId,
    vaultRoot,
    vaultsFile,
    vaultsDir,
    sources,
    vault: path.join(vaultRoot, "vault"),
    manuals: path.join(vaultRoot, "manuals"),
    skills,
    ledger: path.join(vaultRoot, "ledger"),
    marketCache,
    ledgerFile: path.join(vaultRoot, "ledger", "ledger.json"),
    configFile,
    conceptsFile: path.join(vaultRoot, "concepts.json"),
    connectorsFile,
  };
}

export async function ensureWorkspace(overrideVaultId?: string): Promise<WorkspacePaths> {
  const p = getWorkspacePaths(overrideVaultId);
  await Promise.all([
    mkdir(p.root, { recursive: true }),
    mkdir(p.vaultRoot, { recursive: true }),
    mkdir(p.sources, { recursive: true }),
    mkdir(p.vault, { recursive: true }),
    mkdir(p.manuals, { recursive: true }),
    mkdir(p.skills, { recursive: true }),
    mkdir(p.ledger, { recursive: true }),
    mkdir(p.marketCache, { recursive: true }),
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