import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrBuildVault } from "../src/lib/vault";
import { getFullLedgerWithBenchmark, buildPeriodQuantBrief } from "../src/lib/ledger";
import { listSavedManuals } from "../src/lib/synthesis";
import { getMaskedProviderStatus, getOrCreateClipToken } from "../src/lib/provider";
import { loadSkills } from "../src/lib/skills";

describe("Cold-boot empty workspace safety for first-time trial users", () => {
  it("initializes every subsystem cleanly with zero crashes on a brand-new empty workspace", async () => {
    await mkdir("E:/.dev-cache/tmp", { recursive: true });
    const tmp = await mkdtemp(path.join("E:/.dev-cache/tmp", "tl-cold-"));
    const prev = process.env.TRADELOOM_WORKSPACE_DIR;
    process.env.TRADELOOM_WORKSPACE_DIR = tmp;
    try {
      const vault = await loadOrBuildVault();
      expect(vault.index.documents).toEqual([]);
      expect(vault.index.years).toEqual([]);

      const ledger = await getFullLedgerWithBenchmark(true);
      expect(ledger.analytics.hasData).toBe(false);
      expect(ledger.analytics.stocks).toEqual([]);

      const brief = await buildPeriodQuantBrief();
      expect(brief).toBeNull();

      const manuals = await listSavedManuals();
      expect(manuals).toEqual([]);

      const provider = await getMaskedProviderStatus();
      expect(provider.configured).toBe(false);

      const token = await getOrCreateClipToken();
      expect(token).toMatch(/^[a-f0-9]{32}$/);

      const skills = await loadSkills();
      expect(skills.length).toBeGreaterThanOrEqual(2);
    } finally {
      if (prev === undefined) delete process.env.TRADELOOM_WORKSPACE_DIR;
      else process.env.TRADELOOM_WORKSPACE_DIR = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});