# Ventage Demo Checklist (2026-02-11)

## 1. Seed Mock Data

```bash
cd /Users/georgewu/Documents/Ventage/python
python3 scripts/generate_mock_data.py
```

Expected inserts:

- `market_signals`: 50
- `options_flow`: 30
- `insider_trades`: 30
- `market_sentiment`: 30

## 2. Start Services (One Command)

```bash
cd /Users/georgewu/Documents/Ventage
./scripts/dev_up.sh
```

Quick checks:

- `GET http://localhost:8000/healthz`
- `GET http://localhost:8000/docs`
- `GET http://localhost:8000/v1/signals?limit=5`
- `POST http://localhost:8000/v1/alerts/preview`
- `GET http://localhost:8000/v1/options-flow?limit=5`
- `GET http://localhost:8000/v1/insider-trades?limit=5`
- `GET http://localhost:8000/v1/market-sentiment?limit=5`

Open:

- `http://localhost:3000/dashboard`
- `http://localhost:3000/dashboard/options`
- `http://localhost:3000/dashboard/insider`
- `http://localhost:3000/dashboard/sentiment`

## 4. Demo Talking Points

- End-to-end mock pipeline is running (`Mock -> FastAPI -> Dashboard`).
- Dashboard data no longer reads Supabase directly in browser for core pages.
- Left sidebar supports language switch (`中文/English`) with persistence.
- API layer now provides unified read endpoints for four data domains.
- Dashboard supports live filters (`symbol`, `module`, `min score`) with 24h summary cards.
- Options/Insider/Sentiment pages now render real API data (not placeholders).
- Dashboard includes **Alert Preview** panel to simulate trigger candidates.
- Current scope is **preview-only** (`no external send`).
