from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from supabase import Client, create_client

from config.settings import get_settings

router = APIRouter()

TABLES = ["market_signals", "options_flow", "insider_trades", "market_sentiment"]

JOB_NAMES = [
    "dark_pool",
    "insider_trades",
    "market_news",
    "options_flow",
    "market_sentiment",
    "signal_engine",
    "alert_check",
]


def _get_supabase_client() -> Client:
    settings = get_settings()
    if not settings.has_supabase_config:
        raise HTTPException(
            status_code=503,
            detail="Supabase environment variables are missing. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _iso_to_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@router.get("/system/status")
def get_system_status() -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        now = datetime.now(timezone.utc)

        tables: list[dict[str, Any]] = []
        for table in TABLES:
            rows = supabase.table(table).select("created_at").order("created_at", desc=True).limit(1).execute().data or []
            latest_created_at = rows[0].get("created_at") if rows else None
            latest_dt = _iso_to_dt(latest_created_at)

            count_rows = supabase.table(table).select("id", count="exact").limit(1).execute()
            total = int(count_rows.count or 0)

            lag_seconds = int((now - latest_dt).total_seconds()) if latest_dt else None

            tables.append(
                {
                    "table": table,
                    "total": total,
                    "latest_created_at": latest_created_at,
                    "lag_seconds": lag_seconds,
                }
            )

        healthy_tables = sum(1 for row in tables if row["total"] > 0)

        # Fetch last run per job from job_runs table
        collectors: list[dict[str, Any]] = []
        try:
            for job_name in JOB_NAMES:
                rows = (
                    supabase.table("job_runs")
                    .select("status, ran_at, duration_ms, error_message")
                    .eq("job_name", job_name)
                    .order("ran_at", desc=True)
                    .limit(1)
                    .execute()
                    .data or []
                )
                if rows:
                    row = rows[0]
                    ran_at = row.get("ran_at")
                    ran_dt = _iso_to_dt(ran_at)
                    lag_seconds = int((now - ran_dt).total_seconds()) if ran_dt else None
                    collectors.append({
                        "job": job_name,
                        "status": row.get("status"),
                        "ran_at": ran_at,
                        "lag_seconds": lag_seconds,
                        "duration_ms": row.get("duration_ms"),
                        "error_message": row.get("error_message"),
                    })
                else:
                    collectors.append({
                        "job": job_name,
                        "status": "never",
                        "ran_at": None,
                        "lag_seconds": None,
                        "duration_ms": None,
                        "error_message": None,
                    })
        except Exception:
            pass  # job_runs table may not exist yet; non-critical

        return {
            "status": "ok" if healthy_tables == len(TABLES) else "degraded",
            "checked_at": now.isoformat(),
            "healthy_tables": healthy_tables,
            "total_tables": len(TABLES),
            "tables": tables,
            "collectors": collectors,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch system status: {exc}") from exc
