# Ventage

> AI-Powered Fintech Dashboard — 智能金融数据分析平台

## 🎯 Overview

Ventage 是一个 AI 驱动的金融仪表盘，整合多维度市场信号，提供：

- 🤖 **AI 选股** — 基于技术面/基本面/情绪的智能筛选
- 📊 **期权异动** — 追踪大额期权交易和异常活动
- 🔮 **财报预测** — 预测 EPS/营收 vs 分析师共识
- 💬 **情绪分析** — 社交媒体和新闻情绪监控
- 👔 **内部交易** — C-suite 买卖追踪
- 🌑 **Dark Pool** — 大宗交易监控
- 🔔 **实时警报** — Telegram 推送重要信号

## 🏗️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 + Shadcn/UI + TailwindCSS |
| Backend | Python 3.11 + FastAPI |
| Database | Supabase (PostgreSQL) |
| AI Agent | OpenClaw (Claude) |
| Scheduler | APScheduler |

## 📁 Project Structure

```
ventage/
├── README.md              # 项目说明
├── .gitignore
├── .env.example           # 环境变量模板
├── docs/
│   └── ARCHITECTURE.md    # 完整架构文档 (v1.1)
├── database/
│   └── schema.sql         # 数据库脚本
├── python/                # Python 后端
│   ├── agents/            # AI Agents
│   ├── alerting/          # 警报系统
│   ├── etl/               # 数据管道
│   ├── api/               # FastAPI
│   └── scheduler/         # 任务调度
├── frontend/              # Next.js 前端
└── .github/workflows/     # CI/CD
```

## 🚀 Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- Supabase account
- OpenClaw instance

### Setup

```bash
# Clone
git clone https://github.com/georgewu612/Ventage.git
cd Ventage

# Python backend
cd python
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
npm run dev
```

## 📖 Documentation

- [Architecture Overview (v1.1)](docs/ARCHITECTURE.md) - 完整架构设计 + 生产优化

## 🔒 Security

This is a private repository. Do not commit:
- API keys
- Database credentials
- Personal access tokens

Use environment variables for all secrets.

## 📄 License

Private — All rights reserved.

---

*Built with ❤️ by George & James (AI Assistant)*
