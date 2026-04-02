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

| Layer     | Technology               |
| --------- | ------------------------ |
| Frontend  | Next.js 16 + TailwindCSS |
| Backend   | Python 3.11 + FastAPI    |
| Database  | Supabase (PostgreSQL)    |
| AI Agent  | Claude-compatible        |
| Scheduler | APScheduler              |

## 📁 Project Structure (Current)

```
ventage/
├── README.md              # 项目说明
├── .gitignore
├── .env.example           # 环境变量模板
├── docs/
│   ├── ARCHITECTURE.md    # 历史架构文档 (v1.1)
│   └── SYSTEM_DESIGN.md   # 当前执行版系统设计 (v1)
├── python/                # Python 后端
│   ├── agents/            # AI Agents
│   ├── alerting/          # 警报系统
│   ├── etl/               # 数据管道
│   └── api/               # FastAPI
├── src/                   # Next.js 应用
├── scripts/               # 本地一键启动脚本
└── (supabase 迁移目录将按迭代补齐)
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
cd ..
npm install
npm run dev
```

## 📖 Documentation

- [System Design (v1.1)](docs/SYSTEM_DESIGN.md) - 当前执行版系统设计（推荐）
- [API Contract (v1)](docs/API_CONTRACT.md) - 接口契约清单
- [Data Migration Plan](docs/DATA_MIGRATION_PLAN.md) - 旧新字段迁移策略
- [Demo Checklist](docs/DEMO_CHECKLIST.md) - 演示步骤与检查项
- [Architecture Overview (v1.1)](docs/ARCHITECTURE.md) - 历史架构设计文档

## 🔒 Security

This is a private repository. Do not commit:

- API keys
- Database credentials
- Personal access tokens

Use environment variables for all secrets.

## 📄 License

Private — All rights reserved.

---

_Built with ❤️ by George & James (AI Assistant)_
