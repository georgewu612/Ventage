# Ventage 用户教材

> 面向：团队培训 / 客户上手
> 目标：让一个完全没用过 Ventage 的人，能在 1 小时内学会主要工作流
> 风格：白话讲解 + 真实截图 + 操作示例

---

## 推荐阅读路径

### 🚀 第一次用 Ventage（30 分钟入门）

1. [`00-overview.md`](00-overview.md) — Ventage 是什么 · 解决什么问题
2. [`L2-01-dashboard.md`](L2-01-dashboard.md) — 首页 My Desk（每天进来先看这里）
3. [`L2-02-stock-workbench.md`](L2-02-stock-workbench.md) — 单股工作台（核心功能）
4. [`L2-03-portfolio.md`](L2-03-portfolio.md) — 持仓管理

### 📚 进阶深度（90 分钟）

5. [`L2-04-portfolio-builder.md`](L2-04-portfolio-builder.md) — AI 组合构建器
6. [`L3-01-strategies.md`](L3-01-strategies.md) — 策略库
7. [`L3-02-quant-lab.md`](L3-02-quant-lab.md) — Quant Lab 量化研究室（6 个 Tab）
8. [`L3-03-signals.md`](L3-03-signals.md) — 信号 + 复盘

### 🔍 数据情报模块（按需查看）

9. [`L4-data-intelligence.md`](L4-data-intelligence.md) — 期权 / 内部人 / 暗池 / 新闻 / 情绪 / 技术 / 多智能体

### ⚙️ 运营 & 设置

10. [`L5-operations.md`](L5-operations.md) — 报告 / 执行 / 后台 / 设置
11. [`L1-onboarding.md`](L1-onboarding.md) — 注册 / 登录 / 定价 / 会员

---

## 总目录（25 个页面）

| 层     | 页面                                  | 教材文件                     | 状态        |
| ------ | ------------------------------------- | ---------------------------- | ----------- |
| L1     | 首页落地 /                            | `L1-onboarding.md`           | ⬜ 待写     |
| L1     | 定价 /pricing                         | `L1-onboarding.md`           | ⬜          |
| L1     | 登录 /login                           | `L1-onboarding.md`           | ⬜          |
| L1     | 注册 /signup                          | `L1-onboarding.md`           | ⬜          |
| L1     | 会员 /membership                      | `L1-onboarding.md`           | ⬜          |
| **L2** | **My Desk /dashboard**                | **`L2-01-dashboard.md`**     | **✅ 已写** |
| L2     | 单股工作台 /dashboard/stocks/[symbol] | `L2-02-stock-workbench.md`   | ⬜          |
| L2     | 持仓 /dashboard/portfolio             | `L2-03-portfolio.md`         | ⬜          |
| L2     | AI 组合 /dashboard/portfolio-builder  | `L2-04-portfolio-builder.md` | ⬜          |
| L2     | 告警 /dashboard/alerts                | `L2-05-alerts.md`            | ⬜          |
| L3     | 策略列表 /dashboard/strategies        | `L3-01-strategies.md`        | ⬜          |
| L3     | 策略详情 /dashboard/strategies/[id]   | `L3-01-strategies.md`        | ⬜          |
| L3     | Quant Lab /dashboard/quant-lab        | `L3-02-quant-lab.md`         | ⬜          |
| L3     | 信号 /dashboard/signals               | `L3-03-signals.md`           | ⬜          |
| L3     | 信号复盘 /dashboard/signals/journal   | `L3-03-signals.md`           | ⬜          |
| L4     | 技术分析 /dashboard/technical         | `L4-data-intelligence.md`    | ⬜          |
| L4     | 期权 /dashboard/options               | `L4-data-intelligence.md`    | ⬜          |
| L4     | 内部人 /dashboard/insider             | `L4-data-intelligence.md`    | ⬜          |
| L4     | 暗池 /dashboard/darkpool              | `L4-data-intelligence.md`    | ⬜          |
| L4     | 新闻 /dashboard/news                  | `L4-data-intelligence.md`    | ⬜          |
| L4     | 情绪 /dashboard/sentiment             | `L4-data-intelligence.md`    | ⬜          |
| L4     | 多智能体 /dashboard/multi-agent       | `L4-data-intelligence.md`    | ⬜          |
| L5     | 报告 /dashboard/reports               | `L5-operations.md`           | ⬜          |
| L5     | 执行 /dashboard/execution             | `L5-operations.md`           | ⬜          |
| L5     | 后台 /dashboard/admin                 | `L5-operations.md`           | ⬜          |
| L5     | 设置 /dashboard/settings              | `L5-operations.md`           | ⬜          |

---

## 文档约定

- 📸 **[建议截图]** 标记：用户阅读时建议自己截一张当前页面的图嵌入到正文
- 🐛 **bug / 改进** 不写在教材中，统一放到 `docs/audit/PAGE_AUDIT.md`
- 🎯 **白话原则**：先讲业务意义，再讲怎么用，最后才提技术细节（API、数据库表）
