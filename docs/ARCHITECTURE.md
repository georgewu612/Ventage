# Ventage - AI Fintech Dashboard
## 完整架构设计报告

**版本**: 1.1  
**日期**: 2026-02-06  
**作者**: James (AI Assistant)  
**更新**: 整合生产环境优化建议（表分区、幻觉控制、警报聚合）

---

## 📋 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [数据库设计](#3-数据库设计)
4. [后端服务](#4-后端服务)
5. [前端应用](#5-前端应用)
6. [AI Agent 集成](#6-ai-agent-集成)
7. [警报系统](#7-警报系统)
8. [实施计划](#8-实施计划)
9. [成本估算](#9-成本估算)
10. [⚠️ 重要优化建议](#10-重要优化建议)

---

## 1. 项目概述

### 1.1 产品定位

AdaApp 是一个 **AI 驱动的金融数据分析平台**，整合多维度市场信号，帮助用户做出更明智的投资决策。

> 项目代号已更名为 **Ventage**

### 1.2 核心功能

| 功能模块 | 描述 | 数据来源 |
|---------|------|----------|
| 🤖 AI 选股 | 基于技术面/基本面/情绪的智能筛选 | 综合分析 |
| 📊 期权异动 | 追踪大额期权交易和异常活动 | Options Flow API |
| 🔮 财报预测 | 预测 EPS/营收 vs 分析师共识 | Historical + ML |
| 💬 情绪分析 | 社交媒体和新闻情绪监控 | Reddit/Twitter/News |
| 👔 内部交易 | C-suite 买卖追踪 | SEC Form 4 |
| 🌑 Dark Pool | 大宗交易监控 | Dark Pool Feed |

### 1.3 核心理念

> **"信息找人，而非人找信息"**

- 被动模式：Dashboard 展示数据
- 主动模式：异常信号实时推送到 Telegram

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户层                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   Web App    │    │   Telegram   │    │  Mobile App  │          │
│  │  (Next.js)   │    │   (Alerts)   │    │   (Future)   │          │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘          │
└─────────┼───────────────────┼──────────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API 层                                      │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐                       │
│  │   Supabase API   │    │  OpenClaw Agent  │                       │
│  │   (REST/Realtime)│    │   (MCP Server)   │                       │
│  └────────┬─────────┘    └────────┬─────────┘                       │
└───────────┼───────────────────────┼─────────────────────────────────┘
            │                       │
            ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         处理层                                       │
├─────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐       │
│  │   Stock    │ │  Options   │ │  Earnings  │ │ Sentiment  │       │
│  │  Selector  │ │  Watcher   │ │ Predictor  │ │  Analyzer  │       │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘       │
│        │              │              │              │               │
│        └──────────────┴──────────────┴──────────────┘               │
│                              │                                       │
│                    ┌─────────▼─────────┐                            │
│                    │    ETL Loader     │                            │
│                    │  (Data Pipeline)  │                            │
│                    └─────────┬─────────┘                            │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         数据层                                       │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      Supabase (PostgreSQL)                    │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │   │
│  │  │ market_  │ │ options_ │ │ earnings_│ │ insider_ │        │   │
│  │  │ signals  │ │  flow    │ │ forecasts│ │  trades  │        │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │   │
│  │  │ market_  │ │dark_pool_│ │ put_call_│                     │   │
│  │  │sentiment │ │  orders  │ │  ratios  │                     │   │
│  │  └──────────┘ └──────────┘ └──────────┘                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术选型 | 说明 |
|-----|---------|------|
| 前端 | Next.js 14 + Shadcn/UI + TailwindCSS | 现代 React 框架 |
| 后端 | Python 3.11 + FastAPI | 数据处理 agents |
| 数据库 | Supabase (PostgreSQL) | 托管数据库 + Realtime |
| AI Agent | OpenClaw (Claude) | 报告生成 + 分析 |
| 任务调度 | APScheduler / Cron | 定时数据抓取 |
| 缓存 | Redis (可选) | 热数据缓存 |

---

## 3. 数据库设计

### 3.1 ER 图

```
┌─────────────────┐       ┌─────────────────┐
│  market_signals │       │   options_flow  │
├─────────────────┤       ├─────────────────┤
│ id (PK)         │       │ id (PK)         │
│ symbol          │───┐   │ symbol          │
│ signal_type     │   │   │ option_type     │
│ direction       │   │   │ strike          │
│ confidence      │   │   │ expiration      │
│ analysis        │   │   │ premium         │
│ factors (JSONB) │   │   │ volume          │
│ created_at      │   │   │ open_interest   │
└─────────────────┘   │   │ unusual_score   │
                      │   │ created_at      │
┌─────────────────┐   │   └─────────────────┘
│ earnings_       │   │
│ forecasts       │   │   ┌─────────────────┐
├─────────────────┤   │   │ dark_pool_orders│
│ id (PK)         │   │   ├─────────────────┤
│ symbol          │───┼───│ id (PK)         │
│ report_date     │   │   │ symbol          │
│ predicted_eps   │   │   │ price           │
│ actual_eps      │   │   │ size            │
│ predicted_rev   │   │   │ value           │
│ actual_rev      │   │   │ exchange        │
│ surprise_pct    │   │   │ created_at      │
│ created_at      │   │   └─────────────────┘
└─────────────────┘   │
                      │   ┌─────────────────┐
┌─────────────────┐   │   │ market_sentiment│
│ insider_trades  │   │   ├─────────────────┤
├─────────────────┤   │   │ id (PK)         │
│ id (PK)         │   └───│ symbol          │
│ symbol          │───────│ source          │
│ insider_name    │       │ sentiment_score │
│ insider_title   │       │ volume          │
│ trade_type      │       │ keywords (JSONB)│
│ shares          │       │ created_at      │
│ price           │       └─────────────────┘
│ value           │
│ filing_date     │       ┌─────────────────┐
│ created_at      │       │ put_call_ratios │
└─────────────────┘       ├─────────────────┤
                          │ id (PK)         │
                          │ symbol          │
                          │ ratio           │
                          │ put_volume      │
                          │ call_volume     │
                          │ date            │
                          │ created_at      │
                          └─────────────────┘
```

### 3.2 表结构详细定义

```sql
-- ================================================
-- AdaApp Database Schema
-- ================================================

-- 1. AI 市场信号
CREATE TABLE market_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    signal_type VARCHAR(20) NOT NULL, -- 'technical', 'fundamental', 'sentiment', 'composite'
    direction VARCHAR(10) NOT NULL,   -- 'bullish', 'bearish', 'neutral'
    confidence DECIMAL(5,4) NOT NULL, -- 0.0000 to 1.0000
    analysis TEXT,                    -- AI 生成的分析文本
    factors JSONB,                    -- 触发因素详情
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_signals_symbol ON market_signals(symbol);
CREATE INDEX idx_signals_confidence ON market_signals(confidence DESC);
CREATE INDEX idx_signals_created ON market_signals(created_at DESC);

-- 2. 期权异动
CREATE TABLE options_flow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    option_type VARCHAR(4) NOT NULL,  -- 'call', 'put'
    strike DECIMAL(12,2) NOT NULL,
    expiration DATE NOT NULL,
    premium DECIMAL(15,2) NOT NULL,   -- 总权利金
    volume INTEGER NOT NULL,
    open_interest INTEGER,
    implied_volatility DECIMAL(6,4),
    unusual_score DECIMAL(5,2),       -- 异常程度评分
    trade_type VARCHAR(20),           -- 'sweep', 'block', 'split'
    sentiment VARCHAR(10),            -- 'bullish', 'bearish'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_options_symbol ON options_flow(symbol);
CREATE INDEX idx_options_premium ON options_flow(premium DESC);
CREATE INDEX idx_options_created ON options_flow(created_at DESC);

-- 3. Dark Pool 订单
CREATE TABLE dark_pool_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    price DECIMAL(12,4) NOT NULL,
    size INTEGER NOT NULL,
    value DECIMAL(15,2) GENERATED ALWAYS AS (price * size) STORED,
    exchange VARCHAR(20),
    trade_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_darkpool_symbol ON dark_pool_orders(symbol);
CREATE INDEX idx_darkpool_value ON dark_pool_orders(value DESC);
CREATE INDEX idx_darkpool_created ON dark_pool_orders(created_at DESC);

-- 4. 财报预测
CREATE TABLE earnings_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    report_date DATE NOT NULL,
    fiscal_quarter VARCHAR(10),       -- 'Q1 2026'
    predicted_eps DECIMAL(10,4),
    actual_eps DECIMAL(10,4),
    consensus_eps DECIMAL(10,4),
    predicted_revenue DECIMAL(15,2),
    actual_revenue DECIMAL(15,2),
    consensus_revenue DECIMAL(15,2),
    surprise_pct DECIMAL(8,4),
    prediction_confidence DECIMAL(5,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_earnings_symbol_date ON earnings_forecasts(symbol, report_date);

-- 5. 市场情绪
CREATE TABLE market_sentiment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    source VARCHAR(20) NOT NULL,      -- 'reddit', 'twitter', 'news', 'stocktwits'
    sentiment_score DECIMAL(5,4),     -- -1.0 to 1.0
    magnitude DECIMAL(5,4),           -- 情绪强度
    volume INTEGER,                   -- 提及次数
    keywords JSONB,                   -- 热门关键词
    sample_posts JSONB,               -- 示例帖子
    analysis_window VARCHAR(10),      -- '1h', '4h', '24h'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sentiment_symbol ON market_sentiment(symbol);
CREATE INDEX idx_sentiment_source ON market_sentiment(source);
CREATE INDEX idx_sentiment_created ON market_sentiment(created_at DESC);

-- 6. 内部交易
CREATE TABLE insider_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    insider_name VARCHAR(100) NOT NULL,
    insider_title VARCHAR(100),       -- 'CEO', 'CFO', 'Director'
    relationship VARCHAR(50),         -- 与公司关系
    trade_type VARCHAR(10) NOT NULL,  -- 'BUY', 'SELL', 'GIFT'
    shares INTEGER NOT NULL,
    price DECIMAL(12,4),
    value DECIMAL(15,2),
    shares_owned_after INTEGER,
    filing_date DATE NOT NULL,
    transaction_date DATE,
    sec_form VARCHAR(10),             -- 'Form 4', 'Form 144'
    footnotes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_insider_symbol ON insider_trades(symbol);
CREATE INDEX idx_insider_type ON insider_trades(trade_type);
CREATE INDEX idx_insider_value ON insider_trades(value DESC);
CREATE INDEX idx_insider_date ON insider_trades(filing_date DESC);

-- 7. Put/Call 比率
CREATE TABLE put_call_ratios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10),               -- NULL = 整体市场
    ratio DECIMAL(6,4) NOT NULL,
    put_volume INTEGER NOT NULL,
    call_volume INTEGER NOT NULL,
    date DATE NOT NULL,
    ratio_type VARCHAR(20),           -- 'equity', 'index', 'total'
    percentile DECIMAL(5,2),          -- 历史百分位
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pcr_symbol_date ON put_call_ratios(symbol, date);

-- ================================================
-- Row Level Security (RLS)
-- ================================================

ALTER TABLE market_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE options_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE dark_pool_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_sentiment ENABLE ROW LEVEL SECURITY;
ALTER TABLE insider_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE put_call_ratios ENABLE ROW LEVEL SECURITY;

-- 读取策略：认证用户可读
CREATE POLICY "Authenticated users can read" ON market_signals
    FOR SELECT USING (auth.role() = 'authenticated');
    
-- 写入策略：仅 service_role 可写
CREATE POLICY "Service role can insert" ON market_signals
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- 其他表同理...

-- ================================================
-- 触发器：内部交易警报
-- ================================================

CREATE OR REPLACE FUNCTION notify_large_insider_trade()
RETURNS TRIGGER AS $$
BEGIN
    -- 大额买入警报 (> $100,000)
    IF NEW.trade_type = 'BUY' AND NEW.value > 100000 THEN
        PERFORM pg_notify('insider_alert', json_build_object(
            'type', 'large_buy',
            'symbol', NEW.symbol,
            'insider', NEW.insider_name,
            'title', NEW.insider_title,
            'value', NEW.value,
            'shares', NEW.shares
        )::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER insider_trade_alert_trigger
AFTER INSERT ON insider_trades
FOR EACH ROW EXECUTE FUNCTION notify_large_insider_trade();
```

---

## 4. 后端服务

### 4.1 目录结构

```
python/
├── agents/
│   ├── __init__.py
│   ├── stock_selector.py      # AI 选股逻辑
│   ├── options_watcher.py     # 期权异动监控
│   ├── earnings_predictor.py  # 财报预测模型
│   ├── sentiment_analyzer.py  # 情绪分析
│   └── insider_tracker.py     # 内部交易追踪
├── etl/
│   ├── __init__.py
│   ├── data_loader.py         # Supabase 数据写入
│   ├── mock_generator.py      # Mock 数据生成器
│   └── transformers.py        # 数据转换工具
├── alerting/
│   ├── __init__.py
│   ├── telegram_notifier.py   # Telegram 推送
│   ├── webhook_handler.py     # Webhook 处理
│   └── alert_rules.py         # 警报规则定义
├── api/
│   ├── __init__.py
│   ├── main.py                # FastAPI 入口
│   └── routes/
│       ├── signals.py
│       ├── options.py
│       └── reports.py
├── config/
│   ├── settings.py            # 配置管理
│   └── constants.py
├── requirements.txt
└── Dockerfile
```

### 4.2 核心 Agent 示例

```python
# agents/stock_selector.py
"""
AI Stock Selector Agent
基于多因子分析生成交易信号
"""

from dataclasses import dataclass
from typing import Literal
import pandas as pd
from supabase import Client

@dataclass
class Signal:
    symbol: str
    direction: Literal['bullish', 'bearish', 'neutral']
    confidence: float
    factors: dict
    analysis: str

class StockSelector:
    def __init__(self, supabase: Client):
        self.db = supabase
        
    async def analyze(self, symbol: str) -> Signal:
        """综合分析股票并生成信号"""
        
        # 1. 技术分析
        technical_score = await self._technical_analysis(symbol)
        
        # 2. 基本面分析
        fundamental_score = await self._fundamental_analysis(symbol)
        
        # 3. 情绪分析
        sentiment_score = await self._sentiment_analysis(symbol)
        
        # 4. 期权流向
        options_score = await self._options_flow_analysis(symbol)
        
        # 5. 综合评分
        weights = {
            'technical': 0.25,
            'fundamental': 0.25,
            'sentiment': 0.25,
            'options': 0.25
        }
        
        composite_score = (
            technical_score * weights['technical'] +
            fundamental_score * weights['fundamental'] +
            sentiment_score * weights['sentiment'] +
            options_score * weights['options']
        )
        
        # 6. 生成信号
        if composite_score > 0.6:
            direction = 'bullish'
        elif composite_score < 0.4:
            direction = 'bearish'
        else:
            direction = 'neutral'
            
        return Signal(
            symbol=symbol,
            direction=direction,
            confidence=abs(composite_score - 0.5) * 2,
            factors={
                'technical': technical_score,
                'fundamental': fundamental_score,
                'sentiment': sentiment_score,
                'options': options_score
            },
            analysis=await self._generate_analysis(symbol, direction, composite_score)
        )
    
    async def _generate_analysis(self, symbol: str, direction: str, score: float) -> str:
        """调用 OpenClaw 生成详细分析"""
        # 这里可以调用 OpenClaw API 生成自然语言分析
        pass
```

### 4.3 警报服务

```python
# alerting/telegram_notifier.py
"""
Telegram Alert Service
通过 OpenClaw 发送 Telegram 消息
"""

import httpx
from typing import Optional

class TelegramNotifier:
    def __init__(self, openclaw_url: str = "http://localhost:18789"):
        self.openclaw_url = openclaw_url
        
    async def send_insider_alert(
        self,
        symbol: str,
        insider: str,
        title: str,
        trade_type: str,
        value: float,
        shares: int
    ):
        """发送内部交易警报"""
        
        emoji = "🚨" if trade_type == "BUY" else "📉"
        action = "买入" if trade_type == "BUY" else "卖出"
        
        message = f"""
{emoji} **内部人士{action}警报**

**股票**: ${symbol}
**内部人**: {insider}
**职位**: {title}
**金额**: ${value:,.2f}
**股数**: {shares:,}

📊 正在生成详细分析...
        """.strip()
        
        # 通过 OpenClaw 发送
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{self.openclaw_url}/v1/chat/completions",
                json={
                    "messages": [
                        {"role": "user", "content": f"发送这条消息给我: {message}"}
                    ]
                }
            )
```

---

## 5. 前端应用

### 5.1 目录结构

```
frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # Landing page
│   ├── dashboard/
│   │   ├── page.tsx                # 主仪表盘
│   │   ├── signals/page.tsx        # AI 信号详情
│   │   ├── options/page.tsx        # 期权异动
│   │   ├── earnings/page.tsx       # 财报预测
│   │   ├── sentiment/page.tsx      # 情绪分析
│   │   └── insider/page.tsx        # 内部交易
│   └── analysis/
│       ├── page.tsx                # 深度分析
│       └── [symbol]/page.tsx       # 个股分析
├── components/
│   ├── ui/                         # Shadcn 组件
│   ├── dashboard/
│   │   ├── SignalCard.tsx          # 信号卡片
│   │   ├── SignalTable.tsx         # 信号列表
│   │   ├── OptionsFlow.tsx         # 期权流表格
│   │   ├── SentimentGauge.tsx      # 情绪仪表盘
│   │   ├── InsiderChart.tsx        # 内部交易图表
│   │   └── DarkPoolMonitor.tsx     # Dark Pool 监控
│   ├── charts/
│   │   ├── CandlestickChart.tsx    # K线图
│   │   ├── VolumeChart.tsx         # 成交量图
│   │   └── HeatMap.tsx             # 热力图
│   └── layout/
│       ├── Sidebar.tsx
│       ├── Header.tsx
│       └── AlertBanner.tsx
├── lib/
│   ├── supabase.ts                 # Supabase 客户端
│   ├── hooks/
│   │   ├── useSignals.ts
│   │   ├── useOptions.ts
│   │   └── useRealtime.ts          # 实时订阅
│   └── utils.ts
├── styles/
│   └── globals.css
├── package.json
└── next.config.js
```

### 5.2 核心组件示例

```tsx
// components/dashboard/SignalCard.tsx
"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Signal {
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  analysis: string;
}

export function SignalCard({ signal }: { signal: Signal }) {
  const directionConfig = {
    bullish: { icon: TrendingUp, color: "text-green-500", bg: "bg-green-500/10" },
    bearish: { icon: TrendingDown, color: "text-red-500", bg: "bg-red-500/10" },
    neutral: { icon: Minus, color: "text-yellow-500", bg: "bg-yellow-500/10" },
  };

  const config = directionConfig[signal.direction];
  const Icon = config.icon;

  return (
    <Card className={`${config.bg} border-none`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold">${signal.symbol}</span>
          <Icon className={`h-5 w-5 ${config.color}`} />
        </div>
        <Badge variant="outline">
          {(signal.confidence * 100).toFixed(0)}% 置信度
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{signal.analysis}</p>
      </CardContent>
    </Card>
  );
}
```

### 5.3 实时数据订阅

```tsx
// lib/hooks/useRealtime.ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export function useRealtimeSignals() {
  const [signals, setSignals] = useState<any[]>([]);

  useEffect(() => {
    // 初始加载
    fetchSignals();

    // 订阅实时更新
    const channel = supabase
      .channel("signals")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "market_signals" },
        (payload) => {
          setSignals((prev) => [payload.new, ...prev].slice(0, 50));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchSignals() {
    const { data } = await supabase
      .from("market_signals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    
    if (data) setSignals(data);
  }

  return signals;
}
```

---

## 6. AI Agent 集成

### 6.1 OpenClaw 作为 MCP Server

```python
# api/mcp_server.py
"""
MCP Server - 让外部工具调用 AI 能力
"""

from mcp import Server
from agents.stock_selector import StockSelector

server = Server("ada-trading-agent")

@server.tool("generate_trading_report")
async def generate_trading_report(
    symbols: list[str] = None,
    period: str = "daily",
    include_options: bool = True,
    include_sentiment: bool = True
) -> str:
    """
    生成交易报告
    
    Args:
        symbols: 股票列表，为空则使用所有有信号的股票
        period: 报告周期 ('daily', 'weekly', 'monthly')
        include_options: 是否包含期权分析
        include_sentiment: 是否包含情绪分析
    
    Returns:
        Markdown 格式的交易报告
    """
    # 调用 OpenClaw 生成报告
    pass

@server.tool("analyze_symbol")
async def analyze_symbol(symbol: str) -> dict:
    """
    深度分析单个股票
    
    Returns:
        包含技术面、基本面、情绪等多维度分析
    """
    selector = StockSelector(supabase)
    signal = await selector.analyze(symbol)
    return {
        "symbol": symbol,
        "signal": signal.direction,
        "confidence": signal.confidence,
        "factors": signal.factors,
        "analysis": signal.analysis
    }

@server.tool("get_insider_summary")
async def get_insider_summary(days: int = 7) -> str:
    """获取内部交易摘要"""
    pass
```

### 6.2 报告生成示例

当你让我生成报告时，我会：

1. 查询 `market_signals` 表获取最新信号
2. 关联 `options_flow` 分析期权异动
3. 关联 `market_sentiment` 分析情绪变化
4. 综合生成报告

**示例报告格式**：

```markdown
# 📊 AdaApp 每日交易报告
**日期**: 2026-02-06

## 🎯 今日 AI 信号

### 🟢 看多信号 (3只)

| 股票 | 置信度 | 主要因素 |
|-----|-------|---------|
| NVDA | 87% | 期权异动 + 情绪飙升 |
| META | 75% | 财报预期上调 |
| TSLA | 68% | 内部人士买入 |

### 🔴 看空信号 (1只)

| 股票 | 置信度 | 主要因素 |
|-----|-------|---------|
| COIN | 72% | Put/Call 比率异常 |

## 📈 期权异动

过去 24 小时大额异动：
- **NVDA** Feb 28 $900C - $2.3M 权利金 (Sweep)
- **AAPL** Mar 15 $180P - $1.8M 权利金 (Block)

## 👔 内部交易

| 股票 | 内部人 | 操作 | 金额 |
|-----|-------|-----|-----|
| NVDA | Jensen Huang (CEO) | 买入 | $2.5M |
| MSFT | Satya Nadella (CEO) | 卖出 | $1.2M |

## 💬 情绪摘要

| 股票 | Reddit | Twitter | 综合 |
|-----|--------|---------|------|
| NVDA | 🟢 0.82 | 🟢 0.75 | 🟢 看多 |
| TSLA | 🟡 0.12 | 🔴 -0.25 | 🟡 中性 |

---
*由 James (AI Assistant) 自动生成*
```

---

## 7. 警报系统

### 7.1 警报规则配置

```python
# alerting/alert_rules.py

ALERT_RULES = [
    {
        "name": "large_insider_buy",
        "table": "insider_trades",
        "condition": "trade_type = 'BUY' AND value > 100000",
        "priority": "high",
        "template": """
🚨 **内部人士大额买入**

股票: ${symbol}
内部人: {insider_name} ({insider_title})
金额: ${value:,.2f}
股数: {shares:,}
"""
    },
    {
        "name": "unusual_options",
        "table": "options_flow",
        "condition": "premium > 500000 AND unusual_score > 8",
        "priority": "high",
        "template": """
📊 **大额期权异动**

股票: ${symbol}
类型: {option_type} ${strike} {expiration}
权利金: ${premium:,.2f}
异常评分: {unusual_score}/10
"""
    },
    {
        "name": "sentiment_spike",
        "table": "market_sentiment",
        "condition": "ABS(sentiment_score) > 0.7 AND volume > 1000",
        "priority": "medium",
        "template": """
💬 **情绪异常波动**

股票: ${symbol}
来源: {source}
情绪分数: {sentiment_score:+.2f}
提及量: {volume}
"""
    },
    {
        "name": "dark_pool_large",
        "table": "dark_pool_orders",
        "condition": "size > 50000 OR value > 1000000",
        "priority": "medium",
        "template": """
🌑 **Dark Pool 大单**

股票: ${symbol}
规模: {size:,} 股
金额: ${value:,.2f}
"""
    },
    {
        "name": "high_confidence_signal",
        "table": "market_signals",
        "condition": "confidence > 0.85",
        "priority": "high",
        "template": """
🎯 **高置信度 AI 信号**

股票: ${symbol}
方向: {direction}
置信度: {confidence:.0%}

分析: {analysis}
"""
    }
]
```

### 7.2 警报流程图

```
┌─────────────────┐
│  数据插入触发   │
│  (Supabase)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  触发器检查条件  │
│  (PostgreSQL)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  发送 pg_notify │
│  或 Webhook     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Alert Handler  │
│  (Python/Node)  │
└────────┬────────┘
         │
         ├──────────────────┐
         ▼                  ▼
┌─────────────────┐ ┌─────────────────┐
│  Telegram 推送  │ │  Dashboard 通知 │
│  (via OpenClaw) │ │  (Realtime)     │
└─────────────────┘ └─────────────────┘
```

---

## 8. 实施计划

### Phase 1: 基础架构 (Week 1)
- [ ] 创建 Supabase 项目
- [ ] 执行数据库 Schema
- [ ] 配置 RLS 策略
- [ ] 编写 Mock Data Generator
- [ ] 验证数据插入

### Phase 2: 后端 Agents (Week 2)
- [ ] 实现 StockSelector Agent
- [ ] 实现 OptionsWatcher Agent
- [ ] 实现 SentimentAnalyzer
- [ ] 配置定时任务 (APScheduler)
- [ ] 编写单元测试

### Phase 3: 前端 Dashboard (Week 3)
- [ ] 初始化 Next.js 项目
- [ ] 安装配置 Shadcn/UI
- [ ] 实现 Dashboard 布局
- [ ] 实现核心组件
- [ ] 接入 Supabase Realtime

### Phase 4: AI 集成 (Week 4)
- [ ] 配置 OpenClaw Webhook
- [ ] 实现报告生成功能
- [ ] MCP Server 封装 (可选)
- [ ] 测试 AI 分析质量

### Phase 5: 警报系统 (Week 5)
- [ ] 实现 Telegram 警报
- [ ] 配置触发规则
- [ ] Dashboard 通知集成
- [ ] 警报历史记录

### Phase 6: 优化上线 (Week 6)
- [ ] 性能优化
- [ ] 安全审计
- [ ] 文档完善
- [ ] 部署生产环境

---

## 9. 成本估算

### 9.1 基础设施

| 项目 | 月成本 | 说明 |
|-----|-------|------|
| Supabase Pro | $25 | 8GB 数据库, 50GB 带宽 |
| VPS (已有) | $0 | 你的 srv1339024 |
| OpenClaw | $0 | 自托管 |

### 9.2 数据源 (可选)

| 数据源 | 月成本 | 数据类型 |
|-------|-------|---------|
| Polygon.io Starter | $29 | 延迟 15min 市场数据 |
| Polygon.io Developer | $79 | 实时数据 |
| Unusual Whales | $57 | 期权异动 |
| Quiver Quant | $25 | 内部交易 |
| **总计 (基础版)** | **$25** | 仅 Supabase |
| **总计 (专业版)** | **$190** | 全部数据源 |

### 9.3 开发时间估算

| 阶段 | 时间 | 说明 |
|-----|------|-----|
| Phase 1-2 | 2 周 | 后端开发 |
| Phase 3-4 | 2 周 | 前端 + AI 集成 |
| Phase 5-6 | 2 周 | 警报 + 优化 |
| **总计** | **6 周** | MVP 版本 |

---

## 📎 附录

### A. 环境变量

```bash
# .env.local (Frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx

# .env (Backend)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
OPENCLAW_API_URL=http://localhost:18789
TELEGRAM_CHAT_ID=7845535760
```

### B. 相关链接

- [Supabase 文档](https://supabase.com/docs)
- [Next.js 文档](https://nextjs.org/docs)
- [Shadcn/UI](https://ui.shadcn.com)
- [OpenClaw 文档](https://docs.openclaw.ai)

---

**文档结束**

*如有问题，随时问我。*

---

## 10. ⚠️ 重要优化建议

> 以下是针对生产环境的关键优化，必须在开发初期就考虑。

### 10.1 数据量与索引优化（表分区）

**问题**: `options_flow` 和 `dark_pool_orders` 在交易高峰期数据量极其庞大，查询历史数据会变慢。

**解决方案**: PostgreSQL 时间分区

```sql
-- ================================================
-- 期权异动表 - 按月分区
-- ================================================

-- 创建分区父表
CREATE TABLE options_flow (
    id UUID DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    option_type VARCHAR(4) NOT NULL,
    strike DECIMAL(12,2) NOT NULL,
    expiration DATE NOT NULL,
    premium DECIMAL(15,2) NOT NULL,
    volume INTEGER NOT NULL,
    open_interest INTEGER,
    implied_volatility DECIMAL(6,4),
    unusual_score DECIMAL(5,2),
    trade_type VARCHAR(20),
    sentiment VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (id, created_at)  -- 分区键必须包含在主键中
) PARTITION BY RANGE (created_at);

-- 创建月度分区
CREATE TABLE options_flow_2026_01 PARTITION OF options_flow
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE options_flow_2026_02 PARTITION OF options_flow
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE options_flow_2026_03 PARTITION OF options_flow
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
-- ... 以此类推

-- 自动创建分区的函数（可用 pg_cron 调度）
CREATE OR REPLACE FUNCTION create_monthly_partition()
RETURNS void AS $$
DECLARE
    partition_date DATE;
    partition_name TEXT;
    start_date TEXT;
    end_date TEXT;
BEGIN
    partition_date := DATE_TRUNC('month', NOW() + INTERVAL '1 month');
    partition_name := 'options_flow_' || TO_CHAR(partition_date, 'YYYY_MM');
    start_date := TO_CHAR(partition_date, 'YYYY-MM-DD');
    end_date := TO_CHAR(partition_date + INTERVAL '1 month', 'YYYY-MM-DD');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF options_flow 
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
END;
$$ LANGUAGE plpgsql;

-- ================================================
-- Dark Pool 表 - 同样按月分区
-- ================================================

CREATE TABLE dark_pool_orders (
    id UUID DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    price DECIMAL(12,4) NOT NULL,
    size INTEGER NOT NULL,
    value DECIMAL(15,2) GENERATED ALWAYS AS (price * size) STORED,
    exchange VARCHAR(20),
    trade_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 分区策略同上...
```

**分区优势**:
- 查询最近数据时只扫描相关分区
- 历史数据可归档或删除整个分区
- 索引体积更小，维护更快

**Supabase 注意事项**:
- Supabase 支持分区表，但需要在 SQL Editor 中手动创建
- RLS 策略需要在父表上设置，会自动继承到分区

---

### 10.2 AI 幻觉控制（Structured Outputs）

**问题**: 金融数据极度敏感，AI 可能在分析报告中"编造"数据。

**核心原则**: 
> **AI 只负责归纳分析，不负责计算。所有数字由代码计算后传给 AI。**

**解决方案**: 强制使用 JSON Schema 约束输出

```python
# agents/stock_selector.py

from pydantic import BaseModel, Field
from typing import Literal, List

# 定义结构化输出 Schema
class AnalysisFactor(BaseModel):
    """单个分析因素"""
    name: str = Field(description="因素名称，如'RSI超卖'")
    impact: Literal["positive", "negative", "neutral"]
    weight: float = Field(ge=0, le=1, description="权重 0-1，由代码预计算")

class StockAnalysis(BaseModel):
    """AI 分析输出的严格格式"""
    summary: str = Field(
        max_length=200, 
        description="一句话总结，不要包含任何数字"
    )
    reasoning: str = Field(
        max_length=500,
        description="分析逻辑，引用我提供的数据，不要自己计算"
    )
    key_factors: List[AnalysisFactor] = Field(
        max_items=5,
        description="关键因素，所有数值由我提供"
    )
    risk_notes: str = Field(
        max_length=200,
        description="风险提示"
    )

async def generate_analysis(self, symbol: str, data: dict) -> StockAnalysis:
    """
    调用 AI 生成分析，使用 Structured Output
    """
    
    # 1. 所有数字由 Python 预计算
    context = f"""
    分析以下股票数据，只使用我提供的数字，不要自己计算任何数值：
    
    股票: {symbol}
    
    ## 预计算数据（直接引用，不要修改）
    - 当前价格: ${data['price']:.2f}
    - 5日涨跌: {data['change_5d']:+.2f}%
    - RSI(14): {data['rsi']:.1f}
    - 期权 Put/Call 比: {data['pcr']:.2f}
    - 情绪分数: {data['sentiment']:+.2f}
    - 内部人士本月买入: ${data['insider_buys']:,.0f}
    - 综合得分: {data['composite_score']:.2f} (由系统计算)
    
    ## 你的任务
    1. 根据以上数据写一段分析
    2. 不要编造任何数字
    3. 不要计算任何百分比
    4. 引用数据时使用我提供的原始值
    """
    
    # 2. 使用 OpenAI/Anthropic 的 Structured Output
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": context}],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "stock_analysis",
                "schema": StockAnalysis.model_json_schema()
            }
        }
    )
    
    # 3. 解析并验证
    analysis = StockAnalysis.model_validate_json(response.choices[0].message.content)
    
    return analysis
```

**对于 Claude (Anthropic)**:

```python
# 使用 tool_use 模式强制结构化输出
response = await anthropic.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    tools=[{
        "name": "submit_analysis",
        "description": "提交股票分析结果",
        "input_schema": StockAnalysis.model_json_schema()
    }],
    tool_choice={"type": "tool", "name": "submit_analysis"},
    messages=[{"role": "user", "content": context}]
)

# 从 tool_use 中提取结果
analysis = StockAnalysis.model_validate(response.content[0].input)
```

**验证层**:

```python
# utils/validators.py

def validate_analysis(analysis: StockAnalysis, source_data: dict) -> bool:
    """
    二次验证：确保 AI 输出没有编造数字
    """
    text = analysis.summary + analysis.reasoning
    
    # 检查是否包含未提供的数字
    import re
    numbers_in_text = re.findall(r'\d+\.?\d*%?', text)
    
    allowed_numbers = {
        str(source_data['price']),
        f"{source_data['change_5d']:.2f}",
        f"{source_data['rsi']:.1f}",
        # ... 所有允许的数字
    }
    
    for num in numbers_in_text:
        if num not in allowed_numbers and float(num.rstrip('%')) > 1:
            logging.warning(f"AI 可能编造了数字: {num}")
            return False
    
    return True
```

---

### 10.3 警报疲劳管理（聚合逻辑）

**问题**: 市场波动大时，可能一分钟发 50 条消息，用户会关掉通知。

**解决方案**: 警报聚合 + 冷却期 + 优先级队列

```python
# alerting/alert_aggregator.py

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from collections import defaultdict
import asyncio

@dataclass
class Alert:
    symbol: str
    alert_type: str
    priority: str  # 'high', 'medium', 'low'
    data: dict
    timestamp: datetime = field(default_factory=datetime.utcnow)

class AlertAggregator:
    """
    警报聚合器
    - 相同股票的多个警报在时间窗口内合并
    - 根据优先级决定发送策略
    - 全局冷却期防止刷屏
    """
    
    def __init__(
        self,
        aggregation_window: int = 300,  # 5分钟聚合窗口
        cooldown_per_symbol: int = 600,  # 每股票10分钟冷却
        max_alerts_per_minute: int = 5,  # 每分钟最多5条
    ):
        self.aggregation_window = aggregation_window
        self.cooldown_per_symbol = cooldown_per_symbol
        self.max_alerts_per_minute = max_alerts_per_minute
        
        self.pending_alerts: dict[str, list[Alert]] = defaultdict(list)
        self.last_sent: dict[str, datetime] = {}
        self.sent_this_minute: int = 0
        self.minute_reset: datetime = datetime.utcnow()
        
        self._lock = asyncio.Lock()
    
    async def add_alert(self, alert: Alert) -> None:
        """添加警报到聚合队列"""
        async with self._lock:
            key = f"{alert.symbol}:{alert.alert_type}"
            self.pending_alerts[key].append(alert)
    
    async def process_alerts(self) -> list[dict]:
        """
        处理聚合队列，返回要发送的消息
        每隔一定时间调用一次
        """
        async with self._lock:
            now = datetime.utcnow()
            
            # 重置每分钟计数器
            if (now - self.minute_reset).seconds >= 60:
                self.sent_this_minute = 0
                self.minute_reset = now
            
            messages_to_send = []
            keys_to_clear = []
            
            for key, alerts in self.pending_alerts.items():
                if not alerts:
                    continue
                
                symbol = alerts[0].symbol
                oldest = min(a.timestamp for a in alerts)
                
                # 检查是否在聚合窗口内
                if (now - oldest).seconds < self.aggregation_window:
                    # 还在聚合中，除非是高优先级
                    if not any(a.priority == 'high' for a in alerts):
                        continue
                
                # 检查冷却期
                if symbol in self.last_sent:
                    if (now - self.last_sent[symbol]).seconds < self.cooldown_per_symbol:
                        # 冷却中，除非是高优先级
                        if not any(a.priority == 'high' for a in alerts):
                            continue
                
                # 检查每分钟限制
                if self.sent_this_minute >= self.max_alerts_per_minute:
                    # 只让高优先级通过
                    if not any(a.priority == 'high' for a in alerts):
                        continue
                
                # 生成聚合消息
                message = self._aggregate_message(alerts)
                messages_to_send.append(message)
                
                # 更新状态
                self.last_sent[symbol] = now
                self.sent_this_minute += 1
                keys_to_clear.append(key)
            
            # 清理已处理的警报
            for key in keys_to_clear:
                self.pending_alerts[key] = []
            
            return messages_to_send
    
    def _aggregate_message(self, alerts: list[Alert]) -> dict:
        """将多个警报合并成一条消息"""
        
        symbol = alerts[0].symbol
        count = len(alerts)
        
        if count == 1:
            # 单条警报，直接返回
            return self._format_single_alert(alerts[0])
        
        # 多条警报，生成聚合消息
        alert_types = set(a.alert_type for a in alerts)
        highest_priority = 'high' if any(a.priority == 'high' for a in alerts) else 'medium'
        
        # 汇总数据
        total_value = sum(a.data.get('value', 0) for a in alerts)
        
        message = f"""
🔔 **{symbol} 多重信号聚合** ({count} 条警报)

**触发类型**:
{self._format_alert_types(alerts)}

**关键数据**:
- 累计金额: ${total_value:,.2f}
- 时间跨度: {self._format_time_span(alerts)}

**建议**: 多重信号叠加，建议重点关注
        """.strip()
        
        return {
            "symbol": symbol,
            "message": message,
            "priority": highest_priority,
            "alert_count": count
        }
    
    def _format_alert_types(self, alerts: list[Alert]) -> str:
        """格式化警报类型列表"""
        type_counts = defaultdict(int)
        for a in alerts:
            type_counts[a.alert_type] += 1
        
        lines = []
        type_emojis = {
            'insider_buy': '👔 内部买入',
            'options_unusual': '📊 期权异动',
            'dark_pool': '🌑 Dark Pool',
            'sentiment_spike': '💬 情绪异动',
            'ai_signal': '🤖 AI 信号'
        }
        
        for alert_type, count in type_counts.items():
            emoji_name = type_emojis.get(alert_type, alert_type)
            lines.append(f"  • {emoji_name} x{count}")
        
        return '\n'.join(lines)
    
    def _format_time_span(self, alerts: list[Alert]) -> str:
        """格式化时间跨度"""
        times = [a.timestamp for a in alerts]
        span = max(times) - min(times)
        minutes = span.seconds // 60
        return f"{minutes} 分钟内"

# 使用示例
aggregator = AlertAggregator(
    aggregation_window=300,     # 5分钟聚合
    cooldown_per_symbol=600,    # 每股票10分钟冷却
    max_alerts_per_minute=5     # 每分钟最多5条
)

# 后台任务：每30秒处理一次聚合队列
async def alert_processor():
    while True:
        messages = await aggregator.process_alerts()
        for msg in messages:
            await telegram_notifier.send(msg)
        await asyncio.sleep(30)
```

**配置建议**:

| 场景 | 聚合窗口 | 冷却期 | 每分钟上限 |
|-----|---------|-------|----------|
| 激进型 | 2分钟 | 5分钟 | 10条 |
| 平衡型（推荐） | 5分钟 | 10分钟 | 5条 |
| 保守型 | 15分钟 | 30分钟 | 3条 |

---

### 10.4 Python Agents 部署方案

**问题**: 多个 Python Agents 需要稳定的定时运行环境。

**解决方案**: 3 种方案按复杂度排序

#### 方案 A: 直接 Cron（简单）

```bash
# /etc/cron.d/ventage

# 每5分钟运行期权监控
*/5 * * * * root cd /root/ventage && /usr/bin/python3 -m agents.options_watcher >> /var/log/ventage/options.log 2>&1

# 每小时运行情绪分析
0 * * * * root cd /root/ventage && /usr/bin/python3 -m agents.sentiment_analyzer >> /var/log/ventage/sentiment.log 2>&1

# 每天9:30运行选股（美东开盘前）
30 13 * * 1-5 root cd /root/ventage && /usr/bin/python3 -m agents.stock_selector >> /var/log/ventage/selector.log 2>&1

# 每天18:00运行内部交易检查（SEC Form 4 通常下午发布）
0 22 * * 1-5 root cd /root/ventage && /usr/bin/python3 -m agents.insider_tracker >> /var/log/ventage/insider.log 2>&1
```

#### 方案 B: APScheduler + Systemd（推荐）

```python
# scheduler/main.py

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import asyncio

scheduler = AsyncIOScheduler()

# 期权监控 - 每5分钟
scheduler.add_job(
    options_watcher.run,
    CronTrigger(minute='*/5'),
    id='options_watcher',
    name='Options Flow Watcher'
)

# 情绪分析 - 每小时
scheduler.add_job(
    sentiment_analyzer.run,
    CronTrigger(minute=0),
    id='sentiment_analyzer',
    name='Sentiment Analyzer'
)

# 选股 - 每天9:30 ET (13:30 UTC)
scheduler.add_job(
    stock_selector.run,
    CronTrigger(hour=13, minute=30, day_of_week='mon-fri'),
    id='stock_selector',
    name='Stock Selector'
)

# 警报处理 - 每30秒
scheduler.add_job(
    alert_processor.run,
    'interval',
    seconds=30,
    id='alert_processor',
    name='Alert Processor'
)

if __name__ == '__main__':
    scheduler.start()
    asyncio.get_event_loop().run_forever()
```

Systemd 服务:

```ini
# /etc/systemd/system/ventage-scheduler.service

[Unit]
Description=Ventage Agent Scheduler
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/ventage
ExecStart=/usr/bin/python3 -m scheduler.main
Restart=always
RestartSec=10
Environment=PYTHONPATH=/root/ventage

[Install]
WantedBy=multi-user.target
```

#### 方案 C: Docker Compose（完整）

```yaml
# docker-compose.yml

version: '3.8'

services:
  scheduler:
    build: .
    command: python -m scheduler.main
    restart: always
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_KEY=${SUPABASE_KEY}
      - OPENCLAW_URL=http://host.docker.internal:18789
    volumes:
      - ./logs:/app/logs
    
  api:
    build: .
    command: uvicorn api.main:app --host 0.0.0.0 --port 8000
    ports:
      - "8000:8000"
    restart: always
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_KEY=${SUPABASE_KEY}
```

---

### 10.5 优化清单总结

| 优化项 | 优先级 | 复杂度 | 阶段 |
|-------|-------|-------|------|
| 表分区 | 高 | 中 | Phase 1 |
| AI 幻觉控制 | 高 | 低 | Phase 2 |
| 警报聚合 | 高 | 中 | Phase 5 |
| Scheduler 部署 | 中 | 低 | Phase 2 |
| 日志监控 | 中 | 低 | Phase 6 |

---

*文档版本 1.1 - 完整架构 + 生产环境优化建议*
