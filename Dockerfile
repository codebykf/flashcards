FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_PATH=/data/flashcards.db

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static ./static

# Run unprivileged; /data holds the SQLite database and is meant to be a volume.
RUN useradd --system app && mkdir /data && chown app /data
USER app
VOLUME /data

EXPOSE 8080

# A single worker keeps SQLite writes simple; threads handle concurrent requests.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "app:app"]
