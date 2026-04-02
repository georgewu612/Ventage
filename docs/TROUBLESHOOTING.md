# Ventage Troubleshooting

## 1) Page not reachable (`ERR_CONNECTION_REFUSED`)

1. Check service status:

```bash
cd /Users/georgewu/Documents/Ventage
./scripts/dev_status.sh
```

2. If either API/Web is down, restart:

```bash
./scripts/dev_restart.sh
```

3. Open:

- `http://127.0.0.1:3000/dashboard`
- `http://127.0.0.1:8000/docs`

## 2) API returns 503 (missing Supabase env)

1. Ensure `.env` exists in repo root.
2. Verify required keys:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

3. Restart services:

```bash
./scripts/dev_restart.sh
```

## 3) Frontend loads but no data

1. Seed mock data:

```bash
cd /Users/georgewu/Documents/Ventage/python
python3 scripts/generate_mock_data.py
```

2. Verify API endpoint manually:

```bash
curl -sS 'http://127.0.0.1:8000/v1/signals?limit=3'
```

## 4) Port conflict

Check listeners:

```bash
lsof -iTCP:3000 -sTCP:LISTEN -n -P
lsof -iTCP:8000 -sTCP:LISTEN -n -P
```

Kill conflicting process if needed, then restart:

```bash
./scripts/dev_restart.sh
```

## 5) Build or lint failure

```bash
cd /Users/georgewu/Documents/Ventage
npm run lint
npm run build
```

If it fails, inspect last logs:

- `.web.log`
- `.api.log`
- `/tmp/ventage_api_test.log` (for API smoke tests)
