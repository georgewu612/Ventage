# Ventage Data Migration Plan (Legacy to Target)

**Date**: 2026-02-11

## 1. Problem

Current `market_signals` table stores legacy fields:

- `signal_type`, `direction`, `confidence`, `analysis`, `factors`

Target frontend model expects:

- `module`, `signal_score`, `summary`

## 2. Current Strategy (Implemented)

- Keep DB schema unchanged for now.
- Normalize in API layer:
  - `module <- factors.module`
  - `signal_score <- factors.signal_score or confidence * 100`
  - `summary <- analysis`

## 3. Migration Goal

Move compatibility from API code to database schema.

## 4. Proposed Steps

1. Add new columns (nullable initially):

- `module TEXT`
- `signal_score NUMERIC`
- `summary TEXT`

2. Backfill existing rows from legacy fields.

3. Update writers to dual-write (legacy + new fields).

4. Switch readers to prefer new fields.

5. Remove fallback mapping code after observation window.

## 5. Rollback

- Keep legacy columns untouched during migration.
- Feature-flag reader switch in API.
- Rollback by toggling reader to legacy mapping path.
