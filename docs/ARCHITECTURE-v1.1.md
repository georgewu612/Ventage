# AdaApp - AI Fintech Dashboard
## 完整架构设计报告

**版本**: 1.1  
**日期**: 2026-02-06  
**作者**: James (AI Assistant)  
**更新**: 加入数据分区、幻觉控制、警报聚合优化

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
10. [⚠️ 重要优化建议](#10-重要优化建议) ← 新增

---

## 1. 项目概述

### 1.1 产品定位

AdaApp 是一个 **AI 驱动的金融数据分析平台**，整合多维度市场信号，帮助用户做出更明智的投资决策。

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
# /etc/cron.d/adaapp

# 每5分钟运行期权监控
*/5 * * * * root cd /root/adaapp && /usr/bin/python3 -m agents.options_watcher >> /var/log/adaapp/options.log 2>&1

# 每小时运行情绪分析
0 * * * * root cd /root/adaapp && /usr/bin/python3 -m agents.sentiment_analyzer >> /var/log/adaapp/sentiment.log 2>&1

# 每天9:30运行选股（美东开盘前）
30 13 * * 1-5 root cd /root/adaapp && /usr/bin/python3 -m agents.stock_selector >> /var/log/adaapp/selector.log 2>&1

# 每天18:00运行内部交易检查（SEC Form 4 通常下午发布）
0 22 * * 1-5 root cd /root/adaapp && /usr/bin/python3 -m agents.insider_tracker >> /var/log/adaapp/insider.log 2>&1
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
# /etc/systemd/system/adaapp-scheduler.service

[Unit]
Description=AdaApp Agent Scheduler
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/adaapp
ExecStart=/usr/bin/python3 -m scheduler.main
Restart=always
RestartSec=10
Environment=PYTHONPATH=/root/adaapp

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

*文档版本 1.1 - 已整合生产环境优化建议*
