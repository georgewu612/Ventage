FROM python:3.12-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# Verify tradingagents is importable. The previous version of this file
# silently swallowed install failures with `|| echo "skipped"`, which
# caused production /v1/reports/multi-agent endpoints to return 503 even
# though the package install command appeared to succeed. Fail the build
# loudly if tradingagents can't be imported.
RUN python -c "import tradingagents; print('tradingagents OK')"

# Copy application code
COPY . .

# Expose API port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

# Start both API server and ETL scheduler
# Use shell form to support multiple processes
CMD ["sh", "-c", "python -m uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} & python -m etl.scheduler"]
