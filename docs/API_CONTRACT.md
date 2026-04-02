# Ventage API Contract (V1 Baseline)

**Date**: 2026-02-11

## Common Rules

- Base URL: `http://localhost:8000`
- Response format:
  - List: `{ items: [], pagination: { limit, offset, returned, total } }`
  - Error: `{ detail: string }`

## Health

### `GET /healthz`

- 200:

```json
{ "status": "ok" }
```

## Signals

### `GET /v1/signals`

Query:

- `symbol` (optional)
- `module` (optional)
- `min_score` (optional)
- `limit` (default 20)
- `offset` (default 0)

### `GET /v1/signals/{signal_id}`

- 200: single signal
- 404: not found

### `GET /v1/signals/summary`

- 200:

```json
{
  "window": "24h",
  "total_signals": 12,
  "bullish": 5,
  "bearish": 7,
  "average_score": 54.58,
  "by_module": { "options_flow": 4 }
}
```

## Market Data

### `GET /v1/options-flow`

Query:

- `symbol`, `option_type`, `limit`, `offset`

### `GET /v1/insider-trades`

Query:

- `symbol`, `trade_type`, `limit`, `offset`

### `GET /v1/market-sentiment`

Query:

- `symbol`, `source`, `limit`, `offset`

## Alerts

> Scope note: `POST /v1/alerts/preview` is preview-only in this phase. No external message will be sent.

### `POST /v1/alerts/preview`

Body:

- `min_score` (default 70)
- `directions` (default `["bullish","bearish"]`)
- `modules` (optional array)
- `limit` (default 20)

Response:

```json
{
  "total_candidates": 5,
  "threshold": 75,
  "directions": ["bullish", "bearish"],
  "modules": ["options_flow"],
  "candidates": [
    {
      "id": "...",
      "symbol": "AAPL",
      "module": "options_flow",
      "signal_type": "bullish",
      "signal_score": 92,
      "summary": "大量看涨期权流入",
      "created_at": "2026-02-11T01:00:00Z",
      "reasons": ["score >= 75", "direction=bullish"]
    }
  ]
}
```

## System

### `GET /v1/system/status`

- 200:

```json
{
  "status": "ok",
  "checked_at": "2026-02-11T04:03:37.597329+00:00",
  "healthy_tables": 4,
  "total_tables": 4,
  "tables": [
    {
      "table": "market_signals",
      "total": 103,
      "latest_created_at": "2026-02-11T01:38:50.290934+00:00",
      "lag_seconds": 8687
    }
  ]
}
```
