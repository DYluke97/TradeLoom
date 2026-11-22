import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConceptRules, saveConceptRules } from "../src/lib/concepts";
import { loadLedger, saveLedger } from "../src/lib/ledger";
import { listSavedManuals } from "../src/lib/synthesis";
import { exportVaultZipBuffer, importUploadedFile, loadOrBuildVault } from "../src/lib/vault";
import {
  createOrResetDemoVault,
  createVault,
  deleteVault,
  DEMO_VAULT_ID,
  getVaultsOverview,
  switchActiveVault,
  updateVaultMeta,
} from "../src/lib/vaults";
import { DEFAULT_VAULT_ID, getWorkspacePaths, runWithVault } from "../src/lib/workspace";

describe("Multi-Vault Parallel Isolation & Demo Sandbox Engine", () => {
  it("isolates sources, Obsidian graphs, concepts, ledgers, and manuals per vault while sharing global config/connectors/skills/marketCache", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-multivault-"));
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;

    try {
      // 1. Fresh install state
      const initial = await getVaultsOverview();
      expect(initial.activeVaultId).toBe(DEFAULT_VAULT_ID);
      expect(initial.onboarding.isFreshInstall).toBe(true);
      expect(initial.onboarding.hasAnyPersonalData).toBe(false);

      const defaultPaths = getWorkspacePaths(DEFAULT_VAULT_ID);

      // 2. Create Vault A (short-term) and Vault B (fundamental)
      const resA = await createVault({
        name: "A股短线情绪",
        description: "短线龙头战法库",
        templateId: "short-term",
        activate: true,
      });
      expect(resA.ok).toBe(true);
      if (!resA.ok) return;
      const vaultA = resA.vault;

      const resB = await createVault({
        name: "美股财报基本面",
        description: "中长线基本面库",
        templateId: "fundamental",
        activate: false,
      });
      expect(resB.ok).toBe(true);
      if (!resB.ok) return;
      const vaultB = resB.vault;

      // Global shared paths must be identical across default, A, and B
      const pathsA = getWorkspacePaths(vaultA.id);
      const pathsB = getWorkspacePaths(vaultB.id);
      expect(pathsA.configFile).toBe(defaultPaths.configFile);
      expect(pathsA.connectorsFile).toBe(defaultPaths.connectorsFile);
      expect(pathsA.skills).toBe(defaultPaths.skills);
      expect(pathsA.marketCache).toBe(defaultPaths.marketCache);
      expect(pathsB.configFile).toBe(defaultPaths.configFile);
      expect(pathsB.connectorsFile).toBe(defaultPaths.connectorsFile);

      // Per-vault paths must be completely isolated
      expect(pathsA.sources).not.toBe(pathsB.sources);
      expect(pathsA.vault).not.toBe(pathsB.vault);
      expect(pathsA.manuals).not.toBe(pathsB.manuals);
      expect(pathsA.ledgerFile).not.toBe(pathsB.ledgerFile);
      expect(pathsA.conceptsFile).not.toBe(pathsB.conceptsFile);

      // Template concepts should differ between short-term and fundamental vaults
      const conceptsA = await runWithVault(vaultA.id, () => loadConceptRules());
      const conceptsB = await runWithVault(vaultB.id, () => loadConceptRules());
      expect(conceptsA.rules.some((r) => r.concept === "情绪周期")).toBe(true);
      expect(conceptsA.rules.some((r) => r.concept === "商业模式与壁垒")).toBe(false);
      expect(conceptsB.rules.some((r) => r.concept === "商业模式与壁垒")).toBe(true);
      expect(conceptsB.rules.some((r) => r.concept === "情绪周期")).toBe(false);

      // Customize concepts in A; verify B stays untouched
      await runWithVault(vaultA.id, () =>
        saveConceptRules([
          ...conceptsA.rules,
          { id: "custom-a", concept: "一进二弱转强", keywords: ["一进二"], enabled: true },
        ]),
      );
      const conceptsBAfter = await runWithVault(vaultB.id, () => loadConceptRules());
      expect(conceptsBAfter.rules.some((r) => r.concept === "一进二弱转强")).toBe(false);

      // 3. Import a review & trade into Vault A (currently active)
      const upA = await importUploadedFile(
        "2026-03-10_短线复盘.md",
        Buffer.from("# 2026-03-10 短线复盘\n\n今日情绪周期回暖，聚焦一进二弱转强龙头。\n", "utf8"),
      );
      expect(upA.ok).toBe(true);

      const ledgerA = await loadLedger();
      await saveLedger({
        ...ledgerA,
        trades: [
          {
            id: "t-a-1",
            date: "2026-03-10",
            symbol: "002460",
            name: "赣锋锂业",
            side: "BUY",
            price: 40,
            quantity: 1000,
            amount: 40000,
            source: "manual",
          },
        ],
      });

      // 4. Use runWithVault to import a different review into Vault B WITHOUT switching activeVaultId
      const upB = await runWithVault(vaultB.id, () =>
        importUploadedFile(
          "2026-03-11_财报研究.md",
          Buffer.from("# 2026-03-11 财报研究\n\n公司护城河深厚，现金流优秀，ROE 稳定在 25%。\n", "utf8"),
        ),
      );
      expect(upB.ok).toBe(true);

      // Verify Vault A still active and only sees Vault A's doc and trade
      const activeA = await loadOrBuildVault();
      expect(activeA.index.counts.total).toBe(1);
      expect(activeA.index.documents[0].title).toContain("短线复盘");
      expect((await loadLedger()).trades).toHaveLength(1);

      // Switch active vault to Vault B and verify complete isolation
      const swB = await switchActiveVault(vaultB.id);
      expect(swB.ok).toBe(true);
      const activeB = await loadOrBuildVault();
      expect(activeB.index.counts.total).toBe(1);
      expect(activeB.index.documents[0].title).toContain("财报研究");
      expect((await loadLedger()).trades).toHaveLength(0);

      // Update skipLedgerStep & name on Vault B
      const updB = await updateVaultMeta(vaultB.id, { name: "美股基本面研究 v2", skipLedgerStep: true });
      expect(updB.ok).toBe(true);
      if (updB.ok) {
        expect(updB.overview.activeVault.name).toBe("美股基本面研究 v2");
        expect(updB.overview.onboarding.activeVaultSteps.hasLedgerOrSkipped).toBe(true);
      }

      // Export zip independently for Vault A while Vault B is active
      const zipA = await exportVaultZipBuffer(vaultA.id);
      expect(zipA.length).toBeGreaterThan(200);
      expect(zipA.toString("utf8")).toContain(`TradeLoom-Vault-${vaultA.id}/`);

      // Default vault remains untouched (0 docs, 0 trades)
      const defOverview = await getVaultsOverview();
      const defSummary = defOverview.vaults.find((v) => v.id === DEFAULT_VAULT_ID);
      expect(defSummary?.stats.docsCount).toBe(0);
      expect(defSummary?.stats.tradesCount).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("mounts an external local Obsidian folder safely and preserves external files upon vault deletion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-extvault-"));
    const externalDir = path.join(tmp, "my-existing-obsidian");
    const wsDir = path.join(tmp, "ws");
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = wsDir;

    try {
      await mkdir(externalDir, { recursive: true });
      const extNote = path.join(externalDir, "2026-01-15_外部复盘.md");
      await writeFile(extNote, "# 2026-01-15 外部目录复盘\n\n测试挂载外部 Obsidian 目录的龙头与止损分析。\n", "utf8");

      const created = await createVault({
        name: "外部挂载测试库",
        templateId: "short-term",
        externalSourceDir: externalDir,
        activate: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.vault.paths.isExternal).toBe(true);
      expect(created.vault.stats.docsCount).toBe(1);

      // Deleting the mounted vault must NOT touch the user's external source files
      const del = await deleteVault(created.vault.id);
      expect(del.ok).toBe(true);
      if (del.ok) {
        expect(del.overview.activeVaultId).toBe(DEFAULT_VAULT_ID);
      }
      const stillThere = await readFile(extNote, "utf8");
      expect(stillThere).toContain("外部目录复盘");
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("creates an isolated Demo Sandbox Vault with 6 sample reviews, demo ledger, and static playable manual without polluting default vault", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tradeloom-demo-"));
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;

    try {
      const demo = await createOrResetDemoVault({ activate: true });
      expect(demo.ok).toBe(true);
      expect(demo.vault.id).toBe(DEMO_VAULT_ID);
      expect(demo.vault.isDemo).toBe(true);
      expect(demo.vault.stats.docsCount).toBeGreaterThanOrEqual(6);
      expect(demo.vault.stats.tradesCount).toBeGreaterThan(0);
      expect(demo.vault.stats.dailyRecordsCount).toBeGreaterThan(0);
      expect(demo.vault.stats.manualsCount).toBe(1);
      expect(demo.vault.stats.latestManualTitle).toContain("示范成品");

      // Inspect saved static manual inside Demo Sandbox
      const manuals = await listSavedManuals();
      expect(manuals).toHaveLength(1);
      expect(manuals[0].schema).toBe("tradeloom-playbook@v1");
      expect(manuals[0].timeline.length).toBe(3);
      expect(manuals[0].manual.length).toBe(4);
      expect(manuals[0].discipline_audit?.length).toBe(2);
      expect(manuals[0].quant_anchor).not.toBeNull();

      // Verify default vault is 100% clean (0 docs, 0 trades, 0 manuals)
      const defSummary = demo.overview.vaults.find((v) => v.id === DEFAULT_VAULT_ID);
      expect(defSummary?.stats.docsCount).toBe(0);
      expect(defSummary?.stats.tradesCount).toBe(0);
      expect(defSummary?.stats.manualsCount).toBe(0);

      // Delete Demo Sandbox -> switches cleanly back to default
      const del = await deleteVault(DEMO_VAULT_ID);
      expect(del.ok).toBe(true);
      if (del.ok) {
        expect(del.overview.activeVaultId).toBe(DEFAULT_VAULT_ID);
        expect(del.overview.onboarding.hasDemoVault).toBe(false);
      }
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  }, 20000);
});