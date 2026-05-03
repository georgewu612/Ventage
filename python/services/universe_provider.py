"""Universe Provider — fetch SP500 / Russell 1000 / custom symbol lists.

Sources:
    - SP500: Wikipedia "List_of_S%26P_500_companies" (refreshed monthly)
    - Fallback: hardcoded snapshot baked into this file
    - Cache: 7-day TTL in /tmp/ventage_cache/sp500.txt

Public API:
    get_sp500() -> list[str]
    get_universe(name) -> list[str]
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Literal

import pandas as pd

logger = logging.getLogger(__name__)

UniverseName = Literal["core50", "sp500"]

_CACHE_DIR = Path(os.environ.get("VENTAGE_CACHE_DIR", "/tmp/ventage_cache"))
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_SP500_CACHE = _CACHE_DIR / "sp500.txt"
_SP500_TTL_SECONDS = 7 * 24 * 3600


# ── Hardcoded SP500 fallback (snapshot 2026-04, ~500 symbols) ───────────────
# Updated periodically. yfinance-friendly (uses '-' instead of '.').

SP500_FALLBACK: list[str] = [
    "A","AAL","AAPL","ABBV","ABNB","ABT","ACGL","ACN","ADBE","ADI",
    "ADM","ADP","ADSK","AEE","AEP","AES","AFL","AIG","AIZ","AJG",
    "AKAM","ALB","ALGN","ALL","ALLE","AMAT","AMCR","AMD","AME","AMGN",
    "AMP","AMT","AMZN","ANET","ANSS","AON","AOS","APA","APD","APH",
    "APTV","ARE","ATO","AVB","AVGO","AVY","AWK","AXON","AXP","AZO",
    "BA","BAC","BALL","BAX","BBY","BDX","BEN","BF-B","BG","BIIB",
    "BIO","BK","BKNG","BKR","BLDR","BLK","BMY","BR","BRK-B","BRO",
    "BSX","BWA","BX","BXP","C","CAG","CAH","CARR","CAT","CB",
    "CBOE","CBRE","CCI","CCL","CDNS","CDW","CE","CEG","CF","CFG",
    "CHD","CHRW","CHTR","CI","CINF","CL","CLX","CMA","CMCSA","CME",
    "CMG","CMI","CMS","CNC","CNP","COF","COO","COP","COR","COST",
    "CPB","CPRT","CPT","CRL","CRM","CSCO","CSGP","CSX","CTAS","CTLT",
    "CTRA","CTSH","CTVA","CVS","CVX","CZR","D","DAL","DAY","DD",
    "DE","DECK","DFS","DG","DGX","DHI","DHR","DIS","DLR","DLTR",
    "DOC","DOV","DOW","DPZ","DRI","DTE","DUK","DVA","DVN","DXCM",
    "EA","EBAY","ECL","ED","EFX","EG","EIX","EL","ELV","EMN",
    "EMR","ENPH","EOG","EPAM","EQIX","EQR","EQT","ES","ESS","ETN",
    "ETR","ETSY","EVRG","EW","EXC","EXPD","EXPE","EXR","F","FANG",
    "FAST","FCX","FDS","FDX","FE","FFIV","FI","FIS","FITB","FMC",
    "FOX","FOXA","FRT","FSLR","FTNT","FTV","GD","GDDY","GE","GEHC",
    "GEN","GEV","GILD","GIS","GL","GLW","GM","GNRC","GOOG","GOOGL",
    "GPC","GPN","GRMN","GS","GWW","HAL","HAS","HBAN","HCA","HD",
    "HES","HIG","HII","HLT","HOLX","HON","HPE","HPQ","HRL","HSIC",
    "HST","HSY","HUBB","HUM","HWM","IBM","ICE","IDXX","IEX","IFF",
    "INCY","INTC","INTU","INVH","IP","IPG","IQV","IR","IRM","ISRG",
    "IT","ITW","IVZ","J","JBHT","JBL","JCI","JKHY","JNJ","JNPR",
    "JPM","K","KDP","KEY","KEYS","KHC","KIM","KKR","KLAC","KMB",
    "KMI","KMX","KO","KR","KVUE","L","LDOS","LEN","LH","LHX",
    "LIN","LKQ","LLY","LMT","LNT","LOW","LRCX","LULU","LUV","LVS",
    "LW","LYB","LYV","MA","MAA","MAR","MAS","MCD","MCHP","MCK",
    "MCO","MDLZ","MDT","MET","META","MGM","MHK","MKC","MKTX","MLM",
    "MMC","MMM","MNST","MO","MOH","MOS","MPC","MPWR","MRK","MRNA",
    "MRO","MS","MSCI","MSFT","MSI","MTB","MTCH","MTD","MU","NCLH",
    "NDAQ","NDSN","NEE","NEM","NFLX","NI","NKE","NOC","NOW","NRG",
    "NSC","NTAP","NTRS","NUE","NVDA","NVR","NWS","NWSA","NXPI","O",
    "ODFL","OKE","OMC","ON","ORCL","ORLY","OTIS","OXY","PANW","PARA",
    "PAYC","PAYX","PCAR","PCG","PEG","PEP","PFE","PFG","PG","PGR",
    "PH","PHM","PKG","PLD","PLTR","PM","PNC","PNR","PNW","PODD",
    "POOL","PPG","PPL","PRU","PSA","PSX","PTC","PWR","PYPL","QCOM",
    "QRVO","RCL","REG","REGN","RF","RJF","RL","RMD","ROK","ROL",
    "ROP","ROST","RSG","RTX","RVTY","SBAC","SBUX","SCHW","SHW","SJM",
    "SLB","SMCI","SNA","SNPS","SO","SPG","SPGI","SRE","STE","STLD",
    "STT","STX","STZ","SWK","SWKS","SYF","SYK","SYY","T","TAP",
    "TDG","TDY","TECH","TEL","TER","TFC","TFX","TGT","TJX","TMO",
    "TMUS","TPR","TRGP","TRMB","TROW","TRV","TSCO","TSLA","TSN","TT",
    "TTWO","TXN","TXT","TYL","UAL","UBER","UDR","UHS","ULTA","UNH",
    "UNP","UPS","URI","USB","V","VICI","VLO","VMC","VRSK","VRSN",
    "VRTX","VST","VTR","VTRS","VZ","WAB","WAT","WBA","WBD","WDC",
    "WEC","WELL","WFC","WM","WMB","WMT","WRB","WST","WTW","WY",
    "WYNN","XEL","XOM","XYL","YUM","ZBH","ZBRA","ZTS",
]


# ── Wikipedia fetcher ────────────────────────────────────────────────────────

def _fetch_sp500_wikipedia() -> list[str] | None:
    """Pull current SP500 components from Wikipedia. Returns None on failure."""
    try:
        # pandas.read_html parses the first table
        tables = pd.read_html("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
        if not tables:
            return None
        df = tables[0]
        if "Symbol" not in df.columns:
            return None
        symbols = df["Symbol"].astype(str).tolist()
        # yfinance uses '-' instead of '.' (e.g. BRK.B → BRK-B)
        symbols = [s.strip().replace(".", "-") for s in symbols]
        symbols = [s for s in symbols if s and s != "nan"]
        if len(symbols) < 400:
            logger.warning("Wikipedia returned only %d symbols, sus", len(symbols))
            return None
        return symbols
    except Exception as exc:
        logger.warning("Wikipedia SP500 fetch failed: %s", exc)
        return None


# ── Public API ───────────────────────────────────────────────────────────────

def get_sp500() -> list[str]:
    """Return current S&P 500 ticker list with fallbacks.

    Priority:
        1. /tmp/ventage_cache/sp500.txt if fresh (<7 days)
        2. Wikipedia
        3. SP500_FALLBACK hardcoded snapshot
    """
    # Check cache
    if _SP500_CACHE.exists():
        try:
            stat = _SP500_CACHE.stat()
            if time.time() - stat.st_mtime < _SP500_TTL_SECONDS:
                with open(_SP500_CACHE, "r") as f:
                    cached = [s.strip() for s in f if s.strip()]
                if len(cached) >= 400:
                    logger.info("SP500 cache hit (%d symbols)", len(cached))
                    return cached
        except Exception as exc:
            logger.warning("SP500 cache read failed: %s", exc)

    # Try Wikipedia
    fresh = _fetch_sp500_wikipedia()
    if fresh:
        try:
            with open(_SP500_CACHE, "w") as f:
                f.write("\n".join(fresh))
        except Exception as exc:
            logger.warning("SP500 cache write failed: %s", exc)
        logger.info("SP500 from Wikipedia: %d symbols", len(fresh))
        return fresh

    # Fallback to hardcoded
    logger.warning("Using hardcoded SP500 fallback (%d symbols)", len(SP500_FALLBACK))
    return list(SP500_FALLBACK)


def get_universe(name: UniverseName = "core50") -> list[str]:
    """Get a named universe by key."""
    if name == "sp500":
        return get_sp500()
    if name == "core50":
        from services.factor_universe import DEFAULT_UNIVERSE
        return list(DEFAULT_UNIVERSE)
    raise ValueError(f"Unknown universe: {name}")
