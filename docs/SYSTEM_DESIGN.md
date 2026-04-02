# Ventage System Design (V1.1)

**版本**: 1.1  
**日期**: 2026-02-11  
**目标**: 交付可落地、可迭代、可运营的金融信号系统设计（MVP -> Production）

## 1. 设计目标

### 1.1 业务目标

- 将多源市场数据转换为可操作信号。
- 支持 Dashboard 被动查看 + Telegram 主动告警。
- 保证信号可追溯，避免 AI 编造数字。

### 1.2 非目标（MVP 阶段）

- 不做高频交易执行。
- 不做完整移动端。
- 不做复杂多租户权限体系（先单团队内部使用）。

## 2. 总体架构

```text
External APIs -> ETL Jobs -> Supabase(Postgres) -> Signal Engine -> FastAPI -> Next.js Dashboard
                                                           |              |
                                                           |              -> Telegram Alert Service
                                                           -> AI Analyzer (summary only, no raw calc)
```

## 3. 逻辑模块拆分

### 3.1 ETL 层 (`python/etl`)

- `collectors`: 每个数据源一个 collector（options/insider/sentiment/darkpool）。
- `normalizers`: 统一字段、时区、symbol 格式。
- `loaders`: Upsert 到 Supabase 原始表与标准表。
- `quality_checks`: 缺失率、重复率、延迟监控。

### 3.2 信号层 (`python/agents`)

- `rules_engine`: 纯代码规则生成信号与分数。
- `scoring`: 标准化 0-100 分，支持权重配置。
- `signal_writer`: 将信号写入 `market_signals`。
- `ai_summary`: 仅消费已计算结果，生成中文摘要与风险提示。

### 3.3 API 层 (`python/api`)

- 提供统一读接口、筛选、分页、聚合统计。
- 提供健康检查与系统状态接口。
- 提供告警预览和回放接口（便于调试策略）。

### 3.4 告警层 (`python/alerting`)

- `alert_rules`: 阈值规则 + 组合规则。
- `dedup`: 同一 symbol+rule 冷却窗口去重（默认 30 分钟）。
- `dispatcher`: Telegram 发送与失败重试。
- `audit`: 每条告警写入 `alerts_history`。

### 3.5 前端层（`src` 或 `frontend`，二选一后统一）

- `Dashboard`: 信号总览与过滤。
- `Module Pages`: options / insider / sentiment / darkpool。
- `Signal Detail Drawer`: 展示因子、来源、更新时间、解释摘要。
- `Realtime`: 通过 Supabase Realtime 或轮询刷新。

## 4. 数据模型（MVP 必备）

### 4.1 原始层（Raw）

- `raw_options_flow`
- `raw_insider_trades`
- `raw_sentiment_events`
- `raw_darkpool_trades`

用途: 保存外部 API 原始载荷（JSONB），用于回放与审计。

### 4.2 标准层（Normalized）

- `options_flow`
- `insider_trades`
- `market_sentiment`
- `dark_pool_orders`

用途: 统一字段后用于查询、聚合、计算。

### 4.3 信号层（Derived）

- `market_signals`
- `signal_factors`（每个信号的细项因子）
- `alerts_history`

用途: 前端展示与告警推送的直接数据源。

### 4.4 最低约束

- 主键统一 `UUID`。
- 时间统一 `TIMESTAMPTZ`（UTC 存储，前端本地化展示）。
- 高频查询字段建索引：`symbol`, `created_at desc`, `signal_score desc`。
- 每张业务表至少一个 `created_at` 和 `source` 字段。

## 5. API 契约（V1）

### 5.1 系统接口

- `GET /healthz`: 基础健康检查。
- `GET /v1/system/status`: 数据延迟、任务状态、错误计数。

### 5.2 信号接口

- `GET /v1/signals`
  - query: `symbol`, `module`, `min_score`, `from`, `to`, `limit`, `cursor`
- `GET /v1/signals/{signal_id}`
- `GET /v1/signals/summary`
  - 返回近 24h/7d 的 bullish/bearish 分布与 top movers。

### 5.3 告警接口

- `POST /v1/alerts/preview`
  - 输入阈值与过滤条件，返回将被触发的信号样本（不实际推送）。
  - 当前阶段范围: preview-only，不触发 Telegram 外部发送。

## 6. 调度与运行策略

### 6.1 Job 频率（MVP）

- options flow: 每 5 分钟
- sentiment: 每 10 分钟
- insider/darkpool: 每 15 分钟
- signal aggregation: 每 5 分钟
- alert dispatch: 每 1 分钟扫描

### 6.2 失败处理

- 失败重试 3 次（指数退避）。
- 连续失败超过阈值触发系统告警（Telegram dev channel）。
- ETL 与告警各自隔离，互不阻塞。

## 7. AI 使用边界（硬约束）

- AI 不直接读取外部 API，不直接算指标。
- AI 输入仅来自代码算好的结构化结果。
- 输出格式固定（JSON schema）：`summary`, `key_risks`, `confidence_note`。
- 任何数值字段必须从数据库记录映射，不允许自由生成。

## 8. 安全与权限

- 服务端使用 `SUPABASE_SERVICE_ROLE_KEY`，前端仅 `anon key`。
- 所有业务表启用 RLS；服务端写入走受控后端。
- 敏感环境变量只在部署平台注入，不进仓库。
- 外部 API Key 按数据源分开，支持独立轮换。

## 9. 可观测性与运维

- 日志: `structlog` + 请求 ID + job ID。
- 指标:
  - ETL 延迟（数据时间与入库时间差）
  - 每模块成功率
  - 每小时告警量
  - API p95 延迟
- 最低仪表盘:
  - `jobs_last_run`
  - `jobs_failures_24h`
  - `signals_generated_24h`
  - `alerts_sent_24h`

## 10. 代码目录基线（建议）

```text
ventage/
  docs/
    SYSTEM_DESIGN.md
  python/
    api/
      main.py
      routes/
    agents/
      rules_engine.py
      ai_summary.py
    etl/
      collectors/
      normalizers/
      loaders/
    alerting/
      dispatcher.py
      dedup.py
    config/
      settings.py
  supabase/
    migrations/
  src/ (or frontend/)
```

## 11. 实施计划（4 周）

### Week 1: 基础可运行

- 建立 `supabase/migrations` 初版 schema。
- FastAPI 基础服务 + `healthz` + `signals` 读取接口。
- 单模块 ETL（建议 options）打通入库。

### Week 2: 信号闭环

- 上线 rules engine 与 `market_signals` 写入。
- 接入 Telegram 告警 + 去重冷却。
- Dashboard 展示信号列表与详情。

### Week 3: 扩展模块

- 补齐 insider/sentiment/darkpool 三模块。
- 增加 `signals/summary` 聚合接口。
- 接入 AI 结构化摘要。

### Week 4: 稳定性

- 完成 RLS、日志、指标、错误告警。
- 加入回归测试与基本 CI（lint/test/build）。
- 做一次演练：数据源失败、告警洪峰、数据库慢查询。

## 12. 验收标准（Definition of Done）

- 用户能在 Dashboard 查看近 24h 信号并按条件过滤。
- 至少 1 条真实或 mock 信号可触发 Telegram 告警。
- 每条信号可追溯到原始数据与因子明细。
- 数据链路失败可监控、可重试、可定位。
- AI 输出不包含无法追溯的自由数值。

## 13. 当前实现状态（2026-02-11）

### 13.1 已落地能力

- 数据链路: `Mock Generator -> Supabase -> FastAPI -> Next.js Dashboard`
- FastAPI 已实现:
  - `GET /healthz`
  - `GET /v1/signals`
  - `GET /v1/signals/{signal_id}`
  - `GET /v1/signals/summary`
  - `GET /v1/options-flow`
  - `GET /v1/insider-trades`
  - `GET /v1/market-sentiment`
  - `GET /v1/system/status`
  - `POST /v1/alerts/preview`
- 前端页面已接 API:
  - `/dashboard`
  - `/dashboard/options`
  - `/dashboard/insider`
  - `/dashboard/sentiment`
- Dashboard 已具备:
  - summary 卡片
  - 模块分布图
  - 系统状态面板
  - Alert Preview 预览面板（阈值/方向/模块 -> 候选信号）
- 多语言: `zh/en` 侧边栏切换 + 本地持久化。

### 13.2 现阶段技术债

- 仍存在 legacy schema 与目标 schema 的并存（见第 14 节）。
- 暂未接入 CI Workflow 文件（本地 lint/build 已验证通过）。
- 告警系统、AI structured output 还未进入生产级闭环。

## 14. 数据兼容设计（Legacy -> Target）

### 14.1 现状

- `market_signals` 现有列为 legacy 形态（`direction`, `confidence`, `analysis`）。
- 新前端展示需要 target 字段（`module`, `signal_score`, `summary`）。

### 14.2 兼容策略（已采用）

- API 层做字段映射，不直接改线上表结构:
  - `module <- factors.module`
  - `signal_score <- factors.signal_score or confidence*100`
  - `summary <- analysis`
- 优先保证业务可用与演示稳定，再做 schema migration。

### 14.3 后续迁移策略

- 在 `supabase/migrations` 增加增量迁移脚本，引入 target 列。
- 回填历史数据后，逐步下线 API 兼容映射逻辑。
- 迁移窗口中保持双写/双读可回滚。

## 15. API 契约冻结（Demo Baseline）

### 15.1 列表接口统一返回

- `items: []`
- `pagination: { limit, offset, returned, total }`

### 15.2 错误约定

- 缺失配置: `503`
- 查询异常: `500`
- 资源不存在: `404`

### 15.3 系统状态接口

- `GET /v1/system/status` 返回:
  - `status`: `ok | degraded`
  - `healthy_tables`, `total_tables`
  - `tables[]`: `table`, `total`, `latest_created_at`, `lag_seconds`

## 16. 交付路线（今晚 -> 明早 07:00 ET）

### 16.1 必做

- 完成核心页面交互一致性（筛选器/统计卡/状态卡）。
- 演示脚本稳定化（一键起停、日志定位、故障恢复）。
- 文档冻结（系统设计、Demo Checklist、接口清单）。

### 16.2 选做

- 为 options/insider/sentiment 增加筛选条与 summary 头部。
- 接入简版 Telegram 告警预览接口（只预览不推送）。

### 16.3 演示口径

- 强调“链路已跑通、架构已分层、风险已隔离”，并明确 Week 2 的迁移与运维计划。
