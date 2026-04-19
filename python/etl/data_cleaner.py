"""Automated data cleanup — removes old records to stay within Supabase limits.

Runs daily via the scheduler. Retains recent data and purges older records
based on configurable retention periods per table.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from supabase import Client

logger = structlog.get_logger()

# Retention periods per table (in days)
RETENTION_DAYS = {
    "insider_trades": 90,  # Keep 3 months of insider trades
    "options_flow": 30,  # Keep 1 month of options data
    "market_sentiment": 30,  # Keep 1 month of sentiment data
    "market_news": 14,  # Keep 2 weeks of news (high volume)
    "market_signals": 60,  # Keep 2 months of signals
    "alert_history": 60,  # Keep 2 months of alert history
}


async def cleanup_old_data(db: Client) -> dict[str, Any]:
    """Delete records older than the retention period for each table.

    Returns a summary of how many rows were deleted per table.
    """
    log = logger.bind(component="data_cleaner")
    summary: dict[str, int] = {}
    now = datetime.now(UTC)

    for table, days in RETENTION_DAYS.items():
        cutoff = (now - timedelta(days=days)).isoformat()

        # Determine the date column name
        date_column = "filing_date" if table == "insider_trades" else "created_at"

        try:
            # Count records to be deleted
            count_result = (
                db.table(table).select("id", count="exact").lt(date_column, cutoff).execute()
            )
            old_count = count_result.count if count_result.count else 0

            if old_count == 0:
                summary[table] = 0
                continue

            # Delete old records in batches
            deleted = 0
            batch_size = 500

            while deleted < old_count:
                # Fetch IDs of old records
                id_result = (
                    db.table(table).select("id").lt(date_column, cutoff).limit(batch_size).execute()
                )

                if not id_result.data:
                    break

                ids = [row["id"] for row in id_result.data]

                # Delete by IDs
                db.table(table).delete().in_("id", ids).execute()
                deleted += len(ids)

                log.debug("batch_deleted", table=table, batch=len(ids), total=deleted)

            summary[table] = deleted
            if deleted > 0:
                log.info("table_cleaned", table=table, deleted=deleted, retention_days=days)

        except Exception as exc:
            log.error("cleanup_failed", table=table, error=str(exc))
            summary[table] = -1  # -1 indicates error

    total_deleted = sum(v for v in summary.values() if v > 0)
    log.info(
        "cleanup_complete",
        total_deleted=total_deleted,
        summary=summary,
    )

    return {"total_deleted": total_deleted, "by_table": summary}
