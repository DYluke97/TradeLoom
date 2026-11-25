# TradeLoom · 织脉 `v1.2.1` 正式版发布说明（MCP 多库智能入库与全量工具升级）

> **Local-First 投研复盘双链知识库 × A 股实盘投资账本 × Agent 原生交易方法论演化引擎**

- **Windows 免安装绿色便携包**：`TradeLoom-v1.2.1-win-x64.zip`（**63.17 MB**，内置独立 `Node.js` 运行时、原生无黑框 `TradeLoom.exe` 启动器、零依赖 Local MCP Stdio 桥接与标准 `SKILL.md`）
- **隐私门禁校验**：`workspace=0 files`、`symlinks=0`（严格排除一切个人笔记、实盘交割单与 API Key）
- **SHA-256 校验值**：`17a283a19b948161dd636d34c2b60a469c2d9c7e173a82a2e5bb97f4601d0341`

---

## `v1.2.1` 核心升级（基于 `v1.2.0` 完整功能）

### 1. Local MCP Server 工具扩展（`9 → 13` 个工具）与多复盘库防误写护栏
- **服务端多库防盲写护栏**：当本机存在 **≥ 2 个个人复盘库** 且外部 Agent 调用任意写入类工具未传 `vaultId` 时，服务端主动拒绝盲写并返回结构化 `MULTIPLE_VAULTS_REQUIRE_SELECTION` 及全部可选复盘库列表（含库名、简介、模板、高频双链主题 `topTopics` 与文档统计），倒逼 Agent 先结合文件内容向用户推荐并确认目标库后再写入。
- **智能 `vaultId` 解析**：支持精确 ID 或精确库名匹配；传入不存在的库名时显式报错 `VAULT_NOT_FOUND`，不再静默退回默认库。
- **新增 `tradeloom_import_local_files`**：支持自然语言直接传本机单个/多个文件或文件夹绝对路径（原生无损解析 `.md` / `.txt` / `.pdf` / `.docx` / `.html`，最多 200 份，自动一次性重建双链与星图），支持 `dryRun: true` 扫描预览，遇到 `.csv`/`.tsv` 自动引导改用账本工具。
- **新增 `tradeloom_create_vault`**：支持通过自然语言按需新建独立复盘库（可选模板 `short-term` / `fundamental` / `trend-swing` / `custom` 或外挂本地 Obsidian 目录）并立即写入。
- **新增 `tradeloom_import_url`**：支持通过 MCP 单条或批量（最多 20 条）抓取雪球、微信公众号、新浪博客、语雀/飞书/Notion 等公开链接入库（复用逐跳 DNS 防 SSRF 校验）。
- **新增 `tradeloom_import_ledger`**：支持传本机券商交割单/每日净值 CSV/TSV 路径或文本直接入账本，自动兼容 UTF-8 / GB18030 / UTF-16LE 并强制脱敏资金账号与股东代码。
- **同步升级标准 `SKILL.md` 与设置页集成面板**：明确“多库必先查库推荐并征求确认、本地文件优先传路径”的跨 Agent 行为规范。

### 2. 完整包含 `v1.2.0` 全部核心特性
- 曜石投研终端暗色主题 + 温润纸本亮色主题、方正极细 `2px–4px` 精密排版
- 100% 全画幅 4 环同心星轨双链图谱 + 悬浮玻璃 HUD 搜寻 + 单击右侧 380px 玻璃预览抽屉
- 16+ 款本机 CLI Agent 免 API Key 直连（含 `agy` 原生 `stream-json` 与 `zcode --mode plan` 只读沙盒）、免 API 网页订阅协作、17 项国内外云厂商与本机 Ollama / LM Studio API 预设
- 单次提炼装箱容量 20 万 / 50 万（默认）/ 120 万 / 300 万字四档可调、最多 1,500 篇
- 9 大云端笔记连接器两级同步中心 & A 股实盘账本前复权日 K 线 `B/S` 买卖点复盘

---

## Windows 便携版 30 秒上手 / 无损升级

1. 下载 `TradeLoom-v1.2.1-win-x64.zip` 并**完整解压到普通目录**（如桌面或 `D:\TradeLoom`）。
2. 双击 **`TradeLoom.exe`**，2~5 秒后自动拉起本地引擎并打开独立桌面窗口。
3. **从 `v1.0.0` / `v1.2.0` 无损升级**：将旧版本目录下的 `workspace\` 文件夹整体复制到新版解压目录即可无损继承全部复盘、双链、实盘账本、连接器授权与交易手册。
