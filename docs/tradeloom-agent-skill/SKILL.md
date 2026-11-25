---
name: tradeloom-trading-playbook
description: Connect your AI Agent to local TradeLoom to import local files/folders/URLs/broker ledgers with multi-vault confirmation, search trading reviews, audit real PnL vs review notes, and synthesize evidence-verified trading playbooks without extra API keys.
---

# TradeLoom Trading Review & Playbook Skill

When the user asks to upload/import local files, folders, web links, or broker statements into **TradeLoom**, analyze their trading reviews, cross-check trading discipline against their ledger, or synthesize a personal trading playbook, follow this workflow.

## Connection

- **Preferred (MCP)**: Connect to the `tradeloom` MCP server:
  - Stdio: `node <TradeLoom-Repo>/scripts/tradeloom-mcp-server.mjs`
  - Streamable HTTP: `http://127.0.0.1:3200/api/mcp`
- **Requirement**: Local TradeLoom server running at `http://127.0.0.1:3200`.

## Core Workflows

### 1. Smart Multi-Vault Import (Files, Folders, Reviews, URLs & Broker Ledgers)
1. **Always check vaults first**: Call `tradeloom_list_vaults` to inspect all vaults (`id`, `name`, `description`, `topTopics`, and `stats`).
2. **Multi-vault confirmation rule (CRITICAL)**:
   - If `personalVaultCount >= 2` and the user did NOT explicitly name the destination vault, **DO NOT guess or blindly write**. (The MCP server also enforces this guardrail and rejects writes without `vaultId`.)
   - Inspect the file name / brief topic (for local paths you may call `tradeloom_import_local_files` with `dryRun: true` first).
   - List the available vaults to the user, **recommend the best-matching vault with a brief reason**, and ask whether to import there, pick another vault, or create a new vault (`tradeloom_create_vault`).
3. **Choose the right import tool once the target `vaultId` is confirmed** (or immediately when only 1 vault exists):
   - **Local files or folders (`.md` / `.txt` / `.pdf` / `.docx` / `.html`)**: Prefer `tradeloom_import_local_files` with absolute `paths` — zero-token lossless ingestion with automatic PDF/DOCX/HTML conversion and graph rebuild.
   - **Chat-composed text / snippets**: Call `tradeloom_import_review` with `vaultId`, `title`, `content`, `eventDate` (`YYYY-MM-DD`), and `tags`.
   - **Public web/cloud links (Xueqiu, WeChat, Yuque, Feishu, Notion, blogs)**: Call `tradeloom_import_url` with `vaultId` and `url` / `urls`.
   - **Broker CSV/TSV trade statements or daily NAV tables**: Call `tradeloom_import_ledger` with `vaultId` and `filePath` (or `csvText`); TradeLoom automatically strips sensitive account/shareholder columns.

### 2. Search & Inspect Trading Memory
1. Call `tradeloom_list_vaults` to discover available vaults and active vault.
2. Call `tradeloom_search_reviews` with `vaultId`, `query`, `year`, or `kind` to locate relevant reviews and `#concepts`.
3. Call `tradeloom_read_review` to read the full original review and its Obsidian bi-directional links.
4. Call `tradeloom_get_ledger_summary` to compare what the user wrote with real percentage returns, MDD, Alpha, profit factor, and per-stock realized PnL% (no raw capital or account numbers are ever exposed).

### 3. Zero-API Evidence-Verified Playbook Synthesis (No Extra API Key Needed)
1. Confirm the target `vaultId` via `tradeloom_list_vaults`.
2. Call `tradeloom_prepare_synthesis` (with `vaultId`, `fromDate`/`toDate` or `docIds`, and `skillId`).
3. Read the returned `promptText` and deterministic `evidence_id` catalog carefully.
4. Produce **strict JSON** adhering to the output contract in `promptText`:
   - Every `timeline`, `manual`, and `discipline_audit` entry MUST cite exact `evidence_id` values from the catalog.
   - Never fabricate tickers, returns, or `evidence_id` strings.
5. Call `tradeloom_save_manual` with the same `vaultId`/`docIds`/`skillId` and your JSON in `rawResponse`.
6. TradeLoom verifies every citation verbatim, persists `.json` + Obsidian `.md` into `40-交易手册/`, and rebuilds the bi-directional knowledge graph.
