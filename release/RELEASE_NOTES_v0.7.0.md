# TradeLoom · 织脉 v0.7.0 轻量绿色版发布说明

- **发布包**：`TradeLoom-v0.7.0-win-x64.zip`（63.41 MB，免安装解压即用，内置精简 Node.js 运行时与原生 `TradeLoom.exe` 启动器）
- **隐私闸门**：`workspace=0 files`、`symlinks=0`（不含任何个人笔记、交割单或 API Key）
- **SHA-256**：`d5170f81b406ee8fd14436d62ef6246af921eaaaa5a9bcfc3d5f2f0e4f88e01e`

## 核心特性一览

1. **多 Obsidian 双链知识库并行**：
   - 每个知识库独立隔离原始复盘（支持挂载本地已有 Obsidian 文件夹）、双链星图、专属概念词典、**独立实盘交割账本（/ledger）** 与交易手册存档。
   - 全局共享 BYOK 大模型配置、**9 大云端连接器授权**、分析 Skill 工坊与 A 股 K 线行情缓存。
2. **零配置新手体验闭环**：
   - 全新空库提供「一键进入体验示范库（6 篇复盘 + 示例交割账本 + 静态完整交易手册）」与「30 秒新建第 1 个知识库」双主线。
   - 老用户默认直达上次使用的工作台，顶部支持随时切库与 `Ctrl+K` 跨库搜索。
3. **9 大云端笔记平台直连与汇聚（/sync）**：
   - 支持滴答清单 / TickTick（官方 MCP OAuth）、Notion（官方 MCP OAuth）、飞书（扫码一键建应用 + lark-cli）、有道云笔记（官方远程 MCP）、腾讯文档（官方远程 MCP）、腾讯 ima（OpenAPI）、Windows OneNote（本机 COM 零配置直连）、语雀（Open API）、印象笔记国内版（官方 Skill RESTful API + 免费导出导入）。
4. **现代投研极简双主题 UI**：
   - 默认「暖白炭墨 + 矿石蓝」护眼浅色主题，右上角支持一键切换「低反差柔炭深色」夜间模式；双链星图与 A 股 K 线/净值图全双主题自适应。

## 快速使用

1. 解压 `TradeLoom-v0.7.0-win-x64.zip` 到任意目录（当前已预解压至同目录 `TradeLoom-v0.7.0-win-x64/`）。
2. 双击 `TradeLoom.exe`，自动在本地 `http://127.0.0.1:3200` 启动并打开浏览器。