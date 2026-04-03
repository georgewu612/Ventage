# Ventage 部署指南

## 架构

```
[Vercel] ← Next.js 前端
    ↓ API calls
[Railway] ← FastAPI + ETL Scheduler
    ↓ DB queries
[Supabase] ← PostgreSQL + Auth
```

---

## 1. Supabase 配置

### Auth Redirect URLs

在 Supabase Dashboard → Authentication → URL Configuration 中添加：

```
Site URL:        https://ventage.vercel.app
Redirect URLs:   https://ventage.vercel.app/auth/callback
```

### 确认 RLS 已启用

所有表应已启用 RLS（迁移脚本已处理）。

---

## 2. 前端部署（Vercel）

### 步骤

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录
vercel login

# 3. 关联项目
vercel link

# 4. 部署
vercel --prod
```

### 环境变量（在 Vercel Dashboard 设置）

| 变量                            | 值                             |
| ------------------------------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://xxx.supabase.co`      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key              |
| `NEXT_PUBLIC_API_BASE_URL`      | `https://your-api.railway.app` |

> 注意：不要在 Vercel 中设置 `SUPABASE_SERVICE_ROLE_KEY`，前端不需要。

---

## 3. 后端部署（Railway）

### 步骤

```bash
# 1. 安装 Railway CLI
npm i -g @railway/cli

# 2. 登录
railway login

# 3. 初始化项目（在 python/ 目录下）
cd python
railway init

# 4. 部署
railway up
```

### 环境变量（在 Railway Dashboard 设置）

| 变量                        | 值                           | 说明                  |
| --------------------------- | ---------------------------- | --------------------- |
| `SUPABASE_URL`              | `https://xxx.supabase.co`    |                       |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...`                     | ⚠️ 高风险，仅后端使用 |
| `SUPABASE_ANON_KEY`         | `eyJ...`                     |                       |
| `FRONTEND_URL`              | `https://ventage.vercel.app` | CORS 白名单           |
| `TELEGRAM_BOT_TOKEN`        | Bot token                    | 可选                  |
| `TELEGRAM_CHAT_ID`          | Chat ID                      | 可选                  |
| `APP_ENV`                   | `production`                 | 关闭 /docs            |
| `PORT`                      | Railway 自动设置             |                       |

---

## 4. 验证

部署完成后检查：

1. **前端**: `https://ventage.vercel.app` → 应显示登录页
2. **API Health**: `https://your-api.railway.app/healthz` → `{"status": "ok"}`
3. **注册测试**: 创建账号 → 收到验证邮件 → 验证后登录
4. **数据流**: Dashboard 应显示从 Supabase 加载的数据

---

## 5. 常见问题

### CORS 错误

确保 Railway 的 `FRONTEND_URL` 设置为 Vercel 部署的完整 URL（含 https）。

### Auth Callback 失败

确保 Supabase Dashboard 的 Redirect URLs 包含 `https://your-domain/auth/callback`。

### ETL 不运行

检查 Railway logs，确认 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 已正确设置。
