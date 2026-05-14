# Multi-stage build for CofounderAgent
# Stage 1: dependencies
FROM python:3.11-slim AS deps

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Stage 2: runtime
FROM python:3.11-slim AS runtime

WORKDIR /app/user_agent
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Copy only installed packages from deps stage
COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy application code
COPY --chown=appuser:appgroup . .

# Health probe port + agent port
EXPOSE 8080 8088

USER appuser

# Graceful shutdown on SIGTERM
STOPSIGNAL SIGTERM

CMD ["python", "main.py"]
