import os
import sqlite3
from datetime import date

from flask import Flask, g, jsonify, request

DB_PATH = os.environ.get("DB_PATH", "/data/flashcards.db")
DEFAULT_GROUP = "Default"
BACKUP_VERSION = 1
MAX_NAME = 60
MAX_TITLE = 200
MAX_BODY = 5000

app = Flask(__name__, static_folder="static", static_url_path="")


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def get_db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    directory = os.path.dirname(DB_PATH)
    if directory:
        os.makedirs(directory, exist_ok=True)
    db = connect()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS groups (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE
        );
        CREATE TABLE IF NOT EXISTS cards (
            id         INTEGER PRIMARY KEY,
            title      TEXT NOT NULL,
            body       TEXT NOT NULL,
            group_id   INTEGER NOT NULL REFERENCES groups(id),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    db.execute("INSERT OR IGNORE INTO groups (name) VALUES (?)", (DEFAULT_GROUP,))
    db.commit()
    db.close()


def default_group_id(db):
    return db.execute(
        "SELECT id FROM groups WHERE name = ?", (DEFAULT_GROUP,)
    ).fetchone()["id"]


def error(message, status=400):
    return jsonify({"error": message}), status


def text_field(data, key, limit):
    value = data.get(key)
    return value.strip()[:limit] if isinstance(value, str) else ""


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/groups")
def list_groups():
    rows = get_db().execute(
        """
        SELECT g.id, g.name, COUNT(c.id) AS count
        FROM groups g LEFT JOIN cards c ON c.group_id = g.id
        GROUP BY g.id
        ORDER BY g.name != ?, g.name COLLATE NOCASE
        """,
        (DEFAULT_GROUP,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/groups")
def create_group():
    name = text_field(request.get_json(silent=True) or {}, "name", MAX_NAME)
    if not name:
        return error("Group name is required.")
    db = get_db()
    try:
        cur = db.execute("INSERT INTO groups (name) VALUES (?)", (name,))
    except sqlite3.IntegrityError:
        return error("A group with that name already exists.", 409)
    db.commit()
    return jsonify({"id": cur.lastrowid, "name": name, "count": 0}), 201


@app.delete("/api/groups/<int:group_id>")
def delete_group(group_id):
    db = get_db()
    fallback = default_group_id(db)
    if group_id == fallback:
        return error("The Default group cannot be deleted.")
    # Cards in a deleted group are kept and moved to Default.
    db.execute("UPDATE cards SET group_id = ? WHERE group_id = ?", (fallback, group_id))
    db.execute("DELETE FROM groups WHERE id = ?", (group_id,))
    db.commit()
    return "", 204


@app.get("/api/cards")
def list_cards():
    rows = get_db().execute(
        """
        SELECT c.id, c.title, c.body, c.group_id, g.name AS group_name
        FROM cards c JOIN groups g ON g.id = c.group_id
        ORDER BY c.id DESC
        """
    ).fetchall()
    return jsonify([dict(r) for r in rows])


def card_fields(db):
    """Validate the request's card payload. Returns (fields, None) or (None, error)."""
    data = request.get_json(silent=True) or {}
    title = text_field(data, "title", MAX_TITLE)
    body = text_field(data, "body", MAX_BODY)
    if not title or not body:
        return None, error("Title and body are both required.")

    group_id = data.get("group_id")
    if group_id is None:
        group_id = default_group_id(db)
    group = db.execute(
        "SELECT id, name FROM groups WHERE id = ?", (group_id,)
    ).fetchone()
    if group is None:
        return None, error("That group no longer exists.")

    return {
        "title": title,
        "body": body,
        "group_id": group["id"],
        "group_name": group["name"],
    }, None


@app.post("/api/cards")
def create_card():
    db = get_db()
    fields, err = card_fields(db)
    if err:
        return err
    cur = db.execute(
        "INSERT INTO cards (title, body, group_id) VALUES (?, ?, ?)",
        (fields["title"], fields["body"], fields["group_id"]),
    )
    db.commit()
    return jsonify(dict(fields, id=cur.lastrowid)), 201


@app.put("/api/cards/<int:card_id>")
def update_card(card_id):
    db = get_db()
    fields, err = card_fields(db)
    if err:
        return err
    cur = db.execute(
        "UPDATE cards SET title = ?, body = ?, group_id = ? WHERE id = ?",
        (fields["title"], fields["body"], fields["group_id"], card_id),
    )
    if cur.rowcount == 0:
        return error("That flashcard no longer exists.", 404)
    db.commit()
    return jsonify(dict(fields, id=card_id))


@app.delete("/api/cards/<int:card_id>")
def delete_card(card_id):
    db = get_db()
    db.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    db.commit()
    return "", 204


@app.get("/api/backup")
def backup():
    db = get_db()
    groups = db.execute(
        "SELECT name FROM groups ORDER BY name != ?, name COLLATE NOCASE",
        (DEFAULT_GROUP,),
    ).fetchall()
    cards = db.execute(
        """
        SELECT c.title, c.body, g.name AS "group", c.created_at
        FROM cards c JOIN groups g ON g.id = c.group_id
        ORDER BY c.id
        """
    ).fetchall()
    response = jsonify(
        {
            "app": "flashcards",
            "version": BACKUP_VERSION,
            "groups": [g["name"] for g in groups],
            "cards": [dict(c) for c in cards],
        }
    )
    filename = f"flashcards-backup-{date.today().isoformat()}.json"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def backup_contents(data):
    """Validate a backup payload. Returns ((groups, cards), None) or (None, error)."""
    if not isinstance(data, dict) or data.get("app") != "flashcards":
        return None, error("That file is not a flashcards backup.")
    if data.get("version") != BACKUP_VERSION:
        return None, error("That backup was made by an unsupported version.")
    raw_groups, raw_cards = data.get("groups"), data.get("cards")
    if not isinstance(raw_groups, list) or not isinstance(raw_cards, list):
        return None, error("The backup is missing its groups or cards.")

    # Group names are unique ignoring case, as in the groups table.
    groups = {DEFAULT_GROUP.lower(): DEFAULT_GROUP}
    for name in raw_groups:
        name = name.strip()[:MAX_NAME] if isinstance(name, str) else ""
        if name:
            groups.setdefault(name.lower(), name)

    cards = []
    for raw in raw_cards:
        if not isinstance(raw, dict):
            return None, error("The backup contains an invalid flashcard.")
        title = text_field(raw, "title", MAX_TITLE)
        body = text_field(raw, "body", MAX_BODY)
        if not title or not body:
            return None, error("Every flashcard in the backup needs a title and body.")
        group = text_field(raw, "group", MAX_NAME) or DEFAULT_GROUP
        group = groups.setdefault(group.lower(), group)
        created_at = raw.get("created_at")
        cards.append(
            (title, body, group, created_at if isinstance(created_at, str) else None)
        )

    return (list(groups.values()), cards), None


@app.post("/api/restore")
def restore():
    contents, err = backup_contents(request.get_json(silent=True))
    if err:
        return err
    groups, cards = contents
    db = get_db()
    # Replace everything in one transaction, so a failure leaves the data untouched.
    try:
        db.execute("DELETE FROM cards")
        db.execute("DELETE FROM groups")
        db.executemany("INSERT INTO groups (name) VALUES (?)", [(n,) for n in groups])
        db.executemany(
            """
            INSERT INTO cards (title, body, group_id, created_at)
            SELECT ?, ?, id, COALESCE(?, CURRENT_TIMESTAMP)
            FROM groups WHERE name = ?
            """,
            [(title, body, created_at, group) for title, body, group, created_at in cards],
        )
        db.commit()
    except sqlite3.Error:
        db.rollback()
        return error("The backup could not be restored.", 500)
    return jsonify({"groups": len(groups), "cards": len(cards)})


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
