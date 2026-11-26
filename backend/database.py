"""PostgreSQL connection and initialization for StudentWallet."""

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()


class DatabaseConfigurationError(RuntimeError):
    """Raised when the PostgreSQL connection string is not configured."""


@contextmanager
def get_connection() -> Iterator[psycopg2.extensions.connection]:
    """Open a PostgreSQL connection and commit/rollback it safely."""
    if not DATABASE_URL:
        raise DatabaseConfigurationError(
            "DATABASE_URL no está configurada. Copia .env.example a .env y agrega tus credenciales."
        )

    connection = psycopg2.connect(DATABASE_URL)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


CHAT_HISTORY_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS chat_conversations (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL
        REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (LENGTH(BTRIM(content)) > 0),
    model_used VARCHAR(120),
    period VARCHAR(20) CHECK (period IS NULL OR period IN ('general', 'week', 'month')),
    reference_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at
    ON chat_conversations (updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
    ON chat_messages (conversation_id, created_at, id);
"""


def initialize_database() -> None:
    """Create the application tables and indexes if they do not exist."""
    schema_path = PROJECT_ROOT / "docs" / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(schema_sql)
            # The chat tables are created automatically on startup. Existing
            # transactions and financial data are not modified.
            cursor.execute(CHAT_HISTORY_SCHEMA_SQL)


def check_database_connection() -> bool:
    """Return True when PostgreSQL accepts a simple query."""
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT 1 AS ok")
            row = cursor.fetchone()
    return bool(row and row["ok"] == 1)