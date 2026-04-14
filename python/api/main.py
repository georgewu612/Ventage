from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes.alerts import router as alerts_router
from api.routes.market_data import router as market_data_router
from api.routes.news import router as news_router
from api.routes.signals import router as signals_router
from api.routes.system import router as system_router
from config.settings import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Ventage API — AI-powered fintech signals",
    docs_url="/docs" if settings.app_env == "development" else None,
    redoc_url=None,
)

# CORS: production uses FRONTEND_URL env var, dev allows localhost
_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_frontend_url = os.getenv("FRONTEND_URL", "")
if _frontend_url:
    _cors_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(signals_router, prefix="/v1", tags=["signals"])
app.include_router(market_data_router, prefix="/v1", tags=["market-data"])
app.include_router(system_router, prefix="/v1", tags=["system"])
app.include_router(alerts_router, prefix="/v1", tags=["alerts"])
app.include_router(news_router, prefix="/v1", tags=["news"])
