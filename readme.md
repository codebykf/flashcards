# Flashcards

A small self-hosted web app for writing flashcards, sorting them into groups, and testing yourself with a multiple-choice quiz.

It is a single Flask app that serves both a JSON API and a plain HTML/CSS/JS front end. All data is kept in one SQLite database file.

## Features

- **Flashcards**: each card has a title (the front, up to 200 characters) and a body (the back, up to 5,000 characters). Click or press Enter/Space on a card to flip it. Cards can be edited or deleted.
- **Groups**: put cards into named groups (up to 60 characters, case-insensitive and unique). A `Default` group always exists and cannot be deleted. Deleting any other group keeps its cards and moves them to `Default`.
- **Filter and search**: pick a group in the sidebar to show only its cards, and use the search box to match text in titles and bodies (case-insensitive).
- **Quiz**: **Play quiz** asks up to 10 questions drawn from the cards currently shown, so you can quiz yourself on one group or on a search result. Each question shows part of a card's body, with the title blanked out if the body contains it, and asks which of 4 titles it belongs to. The quiz needs at least 4 cards with different titles.
- **Backup and restore**: **Download backup** in the sidebar saves every card and group to a JSON file. **Restore from backup** loads one of those files, after asking you to confirm, and **replaces** all current cards and groups. A file that isn't a valid backup is rejected without changing anything.
- **Light and dark mode**: the choice is remembered in the browser.

## Project layout

```
flashcards/
├── app.py              Flask app: API, database setup, serves the front end
├── static/             Front end (index.html, app.js, style.css, favicon.svg)
├── requirements.txt    Python dependencies (Flask, Gunicorn)
├── Dockerfile          Production image (Gunicorn, runs as a non-root user)
└── docker-compose.yml  Runs the image on port 8080 with a named data volume
```

## API

All endpoints take and return JSON. Errors come back as `{"error": "message"}` with a 4xx status.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/groups` | List groups with their card counts (`Default` first) |
| `POST` | `/api/groups` | Create a group: `{"name": "..."}`. Returns `409` if the name is taken |
| `DELETE` | `/api/groups/<id>` | Delete a group and move its cards to `Default` |
| `GET` | `/api/cards` | List all cards, newest first |
| `POST` | `/api/cards` | Create a card: `{"title": "...", "body": "...", "group_id": 1}`. `group_id` is optional and defaults to `Default` |
| `PUT` | `/api/cards/<id>` | Replace a card's title, body and group (same body as `POST`) |
| `DELETE` | `/api/cards/<id>` | Delete a card |
| `GET` | `/api/backup` | Download all groups and cards as a JSON backup file |
| `POST` | `/api/restore` | Replace all groups and cards with the contents of a backup (the JSON from `/api/backup`). Returns the restored counts |

A backup looks like this. Cards refer to groups by name, so a backup can be restored into any instance:

```json
{
  "app": "flashcards",
  "version": 1,
  "groups": ["Default", "Spanish"],
  "cards": [
    {"title": "Hola", "body": "Hello", "group": "Spanish", "created_at": "2026-10-27 14:15:09"}
  ]
}
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_PATH` | `/data/flashcards.db` | Location of the SQLite database. The directory and tables are created on startup if missing |

The app listens on port `8080`.

## Deploying

### With Docker Compose (recommended)

Requires Docker with the Compose plugin.

1. Copy the `flashcards` folder to the machine that will host it.
2. From inside the folder, build and start the container:

   ```bash
   docker compose up -d --build
   ```

3. Open http://localhost:8080 (or `http://<server-ip>:8080` from another machine).

To use a different host port, change the left side of the port mapping in `docker-compose.yml`, for example `"3000:8080"`.

The container restarts automatically unless you stop it. Useful commands:

```bash
docker compose logs -f        # follow the logs
docker compose down           # stop and remove the container (data is kept)
```

### Updating

After pulling or copying in new code, rebuild and restart:

```bash
docker compose up -d --build
```

The database lives in the `flashcards-data` volume, so it survives rebuilds and `docker compose down`. Only `docker compose down -v` or `docker volume rm` deletes it.

### Backing up and restoring

The easiest way is the **Download backup** and **Restore from backup** buttons in the app. To script a backup instead:

```bash
curl -o flashcards-backup.json http://localhost:8080/api/backup
curl -X POST -H "Content-Type: application/json" \
     --data @flashcards-backup.json http://localhost:8080/api/restore
```

You can also copy the SQLite database itself. It is a single file, `flashcards.db`, inside the `flashcards-data` volume. To copy it out to the current directory:

```bash
docker compose cp flashcards:/data/flashcards.db ./flashcards-backup.db
```

To restore, stop the app, copy the file back, and start it again:

```bash
docker compose stop
docker compose cp ./flashcards-backup.db flashcards:/data/flashcards.db
docker compose start
```

If you would rather keep the database in a normal folder on the host, replace the volume with a bind mount in `docker-compose.yml`, for example `./data:/data`. The container runs as a non-root user, so that folder must be writable by it.

### Without Docker

Requires Python 3.13 (other recent 3.x versions should also work).

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export DB_PATH=./data/flashcards.db
gunicorn --bind 0.0.0.0:8080 --workers 1 --threads 4 app:app
```

Keep it to a single worker: SQLite handles writes from one process most simply, and the threads handle concurrent requests. For local development you can run `python app.py` instead, which starts Flask's built-in server on port 8080 (still set `DB_PATH`, as the default `/data` is usually not writable outside the container).

### Exposing it to the internet

The app has **no login or access control**: Anyone who can reach it can read, edit and delete every card. Keep it on a private network or VPN, or put it behind a reverse proxy (such as Nginx, Caddy or Traefik) that adds HTTPS and authentication.
