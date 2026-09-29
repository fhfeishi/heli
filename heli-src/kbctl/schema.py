"""datadb/kb.db 的表结构与「列级写所有权」写入助手。

I3：一张表的每一列只能由一个流水线写；跨流水线写入必须
`ON CONFLICT DO UPDATE SET <仅本流水线的列>`，禁止整行 REPLACE（schema.py 只暴露
upsert_columns，不提供 REPLACE 入口）。
"""

from __future__ import annotations

import sqlite3
import sys

PRAGMAS = (
    "PRAGMA journal_mode=WAL;",
    "PRAGMA synchronous=NORMAL;",
    "PRAGMA busy_timeout=5000;",
)

DDL = """
CREATE TABLE IF NOT EXISTS documents (
    doc_id            TEXT PRIMARY KEY,
    path              TEXT,
    sha256            TEXT,
    bytes             INTEGER,
    mime              TEXT,
    title             TEXT,
    -- 结构列（唯一写入者：scan）
    section           TEXT,
    nav_order         INTEGER,
    url               TEXT,
    product           TEXT,
    pkg               TEXT,
    value_class       TEXT,
    kind              TEXT,
    superseded_by     TEXT,
    -- 流水线列
    version_signature TEXT,
    chunking_signature TEXT,
    parser_version    TEXT,
    embedding_model   TEXT,
    parse_status      TEXT,
    parsed_at         TEXT,
    chunk_count       INTEGER,
    status            TEXT,
    updated_at        TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id   TEXT PRIMARY KEY,
    doc_id     TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    text       TEXT NOT NULL,
    char_start INTEGER,
    char_end   INTEGER,
    breadcrumb TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_chunks_doc_seq ON chunks(doc_id, seq);
CREATE INDEX IF NOT EXISTS ix_chunks_doc_id ON chunks(doc_id);
"""

# 列级写所有权（§3.5）。改列的归属只改这里。
SCAN_COLS = ("path", "sha256", "bytes", "mime", "section", "nav_order", "url",
             "product", "pkg", "value_class", "kind", "superseded_by")
PARSE_COLS = ("parser_version", "parse_status", "parsed_at")
CHUNK_COLS = ("chunking_signature", "chunk_count")
EMBED_COLS = ("embedding_model", "version_signature", "status")

OWNERSHIP = {"scan": SCAN_COLS, "parse": PARSE_COLS, "chunk": CHUNK_COLS, "embed": EMBED_COLS}


def connect(db_path, verbose: bool = True) -> sqlite3.Connection:
    """打开 kb.db 并建表。

    WAL 在 WSL 原生 ext4 上正常；从 Windows 侧经 9P 挂载点访问时不支持
    （`database is locked`，§7.9 已记录后端必须跑在 WSL 内）。这里降级为 DELETE 并提示，
    而不是让整条管道挂掉——降级只影响并发写吞吐，不影响数据正确性。
    """
    conn = sqlite3.connect(str(db_path))
    conn.execute(PRAGMAS[2])
    try:
        conn.execute(PRAGMAS[0])
    except sqlite3.OperationalError as e:
        if verbose:
            print(f"warn: journal_mode=WAL 不可用（{e}），降级为 DELETE；"
                  f"请在 WSL 原生 ext4 上运行后端", file=sys.stderr)
        conn.execute("PRAGMA journal_mode=DELETE;")
    conn.execute(PRAGMAS[1])
    conn.executescript(DDL)
    return conn


def upsert_columns(conn: sqlite3.Connection, table: str, key: str, cols: dict,
                   stage: str = "") -> None:
    """只更新本次流水线拥有的列。

    stage 给出时校验列归属，防止 scan 整行覆盖 status 这类静默事故
    （§3.5：那会让已入库文档回到 pending，触发重复 embedding 花费）。
    """
    if not cols:
        return
    if stage:
        owned = set(OWNERSHIP.get(stage, ()))
        alien = set(cols) - owned
        if alien:
            raise ValueError(f"{stage} 试图写入不属于它的列：{sorted(alien)}")
    names = list(cols)
    ph = ", ".join("?" for _ in names)
    sets = ", ".join(f"{n}=excluded.{n}" for n in names)
    conn.execute(
        f"INSERT INTO {table} (doc_id, {', '.join(names)}) VALUES (?, {ph}) "
        f"ON CONFLICT(doc_id) DO UPDATE SET {sets}",
        [key, *[cols[n] for n in names]],
    )
