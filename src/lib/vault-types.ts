export const DEMO_VAULT_ID = "demo-sandbox";

export type VaultTemplateId = "short-term" | "fundamental" | "trend-swing" | "custom";

export const VAULT_ACCENT_COLORS = [
  "#7c4dff",
  "#22d3ee",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#38bdf8",
  "#a855f7",
];

export type VaultConnectorFilterMap = Record<string, Record<string, string>>;

export type VaultMeta = {
  id: string;
  name: string;
  description: string;
  color: string;
  templateId: VaultTemplateId;
  defaultSkillId: string;
  isDefault?: boolean;
  isDemo?: boolean;
  externalSourceDir?: string;
  skipLedgerStep?: boolean;
  connectorFilters?: VaultConnectorFilterMap;
  createdAt: string;
  lastOpenedAt: string;
};

export type VaultRegistry = {
  schema: "tradeloom-vaults@v1";
  activeVaultId: string;
  vaults: VaultMeta[];
};

export type VaultStats = {
  docsCount: number;
  yearsCount: number;
  topicsCount: number;
  linksCount: number;
  manualsCount: number;
  tradesCount: number;
  dailyRecordsCount: number;
  latestManualTitle: string | null;
  latestManualAt: string | null;
};

export type VaultSummary = VaultMeta & {
  paths: {
    vaultDir: string;
    sourceDir: string;
    isExternal: boolean;
  };
  stats: VaultStats;
};

export type VaultOnboardingSteps = {
  hasReviews: boolean;
  hasLedgerOrSkipped: boolean;
  hasLlm: boolean;
  hasManual: boolean;
  completedCount: number;
  totalCount: number;
};

export type VaultTemplatePublic = {
  id: VaultTemplateId;
  name: string;
  badge: string;
  description: string;
  color: string;
  defaultSkillId: string;
  conceptCount: number;
};

export type VaultsOverview = {
  activeVaultId: string;
  activeVault: VaultSummary;
  vaults: VaultSummary[];
  templates: VaultTemplatePublic[];
  onboarding: {
    isFreshInstall: boolean;
    hasAnyPersonalData: boolean;
    hasDemoVault: boolean;
    llmConfigured: boolean;
    activeVaultSteps: VaultOnboardingSteps;
  };
};