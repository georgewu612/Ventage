# Ventage Release Checklist (Demo Candidate)

## 1. Environment

- [ ] `.env` includes valid Supabase credentials.
- [ ] `.env` includes `NEXT_PUBLIC_API_BASE_URL`.

## 2. Data

- [ ] Run `python/scripts/generate_mock_data.py` successfully.
- [ ] Verify inserts for `market_signals`, `options_flow`, `insider_trades`, `market_sentiment`.

## 3. Backend

- [ ] `GET /healthz` returns `{ "status": "ok" }`.
- [ ] `GET /v1/signals` returns paginated results.
- [ ] `POST /v1/alerts/preview` returns candidates.
- [ ] Alert flow remains preview-only (no external Telegram send).
- [ ] `GET /v1/system/status` returns table health.

## 4. Frontend

- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] `/dashboard` renders summary cards + filters.
- [ ] `/dashboard/options`, `/dashboard/insider`, `/dashboard/sentiment` render API data.
- [ ] Locale switch (`zh/en`) works and persists.

## 5. Demo Flow

- [ ] Start services via `scripts/dev_up.sh`.
- [ ] Open `/dashboard`, show filters + module distribution + status panel.
- [ ] Open Swagger `/docs`, show `alerts/preview` call.
- [ ] Stop services via `scripts/dev_down.sh`.
