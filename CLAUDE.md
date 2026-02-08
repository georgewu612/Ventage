# CLAUDE.md - Ventage 开发规范

> 本文件供 AI 编码助手参考，请严格遵守。

---

## 📁 项目结构

```
ventage/
├── src/                    # Next.js 前端
│   ├── app/               # App Router 页面
│   ├── components/        # React 组件
│   └── lib/               # 工具函数、hooks、客户端
├── python/                 # Python 后端
│   ├── agents/            # AI Agents
│   ├── alerting/          # 警报系统
│   ├── etl/               # 数据管道
│   ├── api/               # FastAPI
│   └── config/            # 配置管理
├── supabase/
│   └── migrations/        # 数据库迁移脚本
├── docs/                   # 架构文档
└── database/              # 数据库相关脚本
```

---

## 🔐 环境变量管理

### 规则

1. **根目录必须存在 `.env.example`** — 模板文件，包含所有需要的变量名
2. **严禁将 `.env` 或 `.env.local` 提交至 Git**
3. `.gitignore` 必须包含：
   ```
   .env*
   !.env.example
   ```

### 命名规范

| 前缀 | 可见性 | 示例 |
|-----|-------|------|
| `NEXT_PUBLIC_` | 客户端可见（会打包进前端） | `NEXT_PUBLIC_SUPABASE_URL` |
| 无前缀 | 仅服务端可见 | `SUPABASE_SERVICE_ROLE_KEY` |

### 敏感度分层

```bash
# ✅ 低风险（有 RLS 保护，泄露影响有限）
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY

# ⚠️ 高风险（绕过 RLS，泄露即 GG）
SUPABASE_SERVICE_ROLE_KEY

# 🚨 极高风险（涉及支付/认证）
STRIPE_SECRET_KEY
OPENAI_API_KEY
```

### 生产环境

- **不要**在服务器上放 `.env` 文件
- 使用 Vercel Environment Variables 或 secret manager（Doppler, Infisical）

---

## 🎨 前端规范

### 技术栈

- Next.js 16 (App Router)
- React 19
- TailwindCSS 4
- TypeScript
- Supabase SSR

### 组件规范

```tsx
// ✅ 正确：使用 "use client" 指令
"use client";

import { useState } from "react";

export function MyComponent() {
  // ...
}
```

```tsx
// ✅ 正确：服务端组件不需要 "use client"
export default async function Page() {
  const data = await fetchData();
  return <div>{data}</div>;
}
```

### 样式规范

- 使用 TailwindCSS utility classes
- 深色主题优先（`bg-slate-900`、`text-white`）
- 使用 `backdrop-blur` 和 `bg-white/10` 做玻璃效果

---

## 🐍 Python 规范

### 技术栈

- Python 3.11+
- Pydantic v2（数据模型）
- pydantic-settings（配置管理）
- supabase-py（数据库客户端）

### 代码风格

```python
# ✅ 正确：使用类型注解
def process_data(items: list[dict]) -> int:
    return len(items)

# ✅ 正确：使用 Pydantic 模型
from pydantic import BaseModel

class MarketSignal(BaseModel):
    symbol: str
    direction: Literal["bullish", "bearish", "neutral"]
    confidence: Decimal
```

### 配置管理

```python
# ✅ 正确：使用 pydantic-settings
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    
    model_config = SettingsConfigDict(env_file=".env")
```

---

## 🗄️ 数据库规范

### Supabase

- 所有表启用 RLS（Row Level Security）
- 使用 `gen_random_uuid()` 生成主键
- 时间字段使用 `TIMESTAMP WITH TIME ZONE`
- 创建适当的索引

### 迁移脚本

- 放在 `supabase/migrations/` 目录
- 文件名格式：`YYYYMMDD_description.sql`
- 使用 `IF NOT EXISTS` 避免重复创建

---

## 🚨 AI 幻觉控制

> **金融数据极度敏感，AI 绝不能编造数字。**

### 核心原则

- **AI 只负责归纳分析，不负责计算**
- **所有数字由代码计算后传给 AI**
- 使用 Structured Outputs / tool_use 强制格式

### 示例

```python
# ✅ 正确：数字由代码提供
context = f"""
分析数据（直接引用，不要修改）：
- 当前价格: ${data['price']:.2f}
- RSI: {data['rsi']:.1f}
"""

# ❌ 错误：让 AI 自己算
context = "请计算这只股票的涨跌幅"
```

---

## 📝 Git 规范

### Commit Message

```
feat: 添加期权异动监控
fix: 修复信号卡片样式问题
docs: 更新架构文档
refactor: 重构数据加载器
```

### 分支

- `main` / `master` — 主分支
- `feat/xxx` — 功能分支
- `fix/xxx` — 修复分支

---

## ✅ Checklist

提交代码前确认：

- [ ] `.env` 没有被提交
- [ ] 没有硬编码的 API keys
- [ ] TypeScript 无类型错误
- [ ] Python 有类型注解
- [ ] 新表有 RLS 策略

---

*最后更新: 2026-02-08*
