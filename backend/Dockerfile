FROM python:3.12-slim

# ffmpeg is optional: media_service degrades to a single keyframe without it,
# but video keyframe extraction and audio demux need it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY pyproject.toml ./
RUN pip install --no-cache-dir \
    "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9" \
    "pydantic-settings>=2.6" "python-multipart>=0.0.12"

COPY app ./app

ENV PARTLI_DATA_DIR=/data \
    PARTLI_STORAGE_DIR=/srv/.storage \
    PARTLI_CACHE_DIR=/srv/.cache \
    PYTHONUNBUFFERED=1

EXPOSE 8080

# Startup preloads every catalogue before binding the port (spec 4.5), so the
# container is not ready until the first request can be served at full speed.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s \
    CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8080/healthz')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
