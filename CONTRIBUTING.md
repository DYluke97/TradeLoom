# 参与贡献（Contributing to TradeLoom）

感谢你对 **TradeLoom** 的兴趣！本项目采用 MIT 协议，非常欢迎提交 Issue、PR 或贡献新的交易分析 Skill。

## 贡献新的分析 Skill

在 `skills/` 目录下新建一个 `.md` 文件（如 `skills/convertible-bond.md`），按如下 YAML frontmatter 格式编写即可被系统自动发现：

```markdown
---
id: convertible-bond
name: 可转债波段 Skill
summary: 面向双低轮动、强赎博弈与正股联动的复盘提炼框架。
tags: [可转债, 双低, 强赎]
---

# 可转债波段 Skill

（写清你的分析维度、风控边界与提示词聚焦要求）
```

## 提交代码前请确认

1. 绝不提交任何真实个人账户数据、实盘持仓记录、真实复盘原文或 API Key；
2. 运行以下检查全部通过：
   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   ```
