---
name: tradeloom-trading-playbook
description: Connect your AI Agent to local TradeLoom to search trading reviews, audit real PnL vs review notes, import new reviews, and synthesize evidence-verified trading playbooks without extra API keys.
---

# TradeLoom Trading Review & Playbook Skill

When the user asks to analyze their trading reviews, cross-check trading discipline against real ledger PnL, import a new review, or synthesize a personal trading playbook in **TradeLoom**, follow this workflow.

## Connection

- **Preferred (MCP)**: Connect to the `tradeloom` MCP server:
  - Stdio: `node <TradeLoom-Repo>/scripts/tradeloom-mcp-server.mjs`
  - Streamable HTTP: `http://127.0.0.1:3200/api/mcp`
- **Requirement**: Local TradeLoom server running at `http://127.0.0.1:3200`.

## Core Workflows

### 1. Search & Inspect Trading Memory
1. Call `tradeloom_list_vaults` to discover available vaults and active vault.
2. Call `tradeloom_search_reviews` with `query`, `year`, or `kind` to locate relevant reviews and `#concepts`.
3. Call `tradeloom_read_review` to inspect the full review text and bi-directional Obsidian links.
4. Call `tradeloom_get_ledger_summary` to retrieve sanitized percentage-only ledger metrics (period return%, Alpha%, MDD%, win rate, profit factor, per-stock realized PnL%).

### 2. Zero-API Evidence-Verified Playbook Synthesis
1. Call `tradeloom_prepare_synthesis` with `fromDate`/`toDate` or `docIds` and desired `skillId` (e.g. `short-term`, `fundamental`, `trend-swing`, `general`).
2. Read the returned `promptText` and deterministic `evidence_id` catalog carefully.
3. Produce **strict JSON** matching the output schema in `promptText`:
   - Every `timeline`, `manual`, and `discipline_audit` entry MUST cite exact `evidence_id` values from the catalog.
   - Never fabricate tickers, returns, or `evidence_id` strings.
4. Call `tradeloom_save_manual` passing the same `docIds`/`skillId` and your JSON in `rawResponse`.
5. TradeLoom verifies every citation verbatim, saves `.json` + Obsidian `.md` to `40-交易手册/`, and updates the knowledge graph.

### 3. Capture a New Review
- Call `tradeloom_import_review` with `title`, `content`, optional `eventDate` (`YYYY-MM-DD`), and `tags`.
