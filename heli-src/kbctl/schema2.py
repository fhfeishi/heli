"""新协议（精简规格 §3）的表结构：五张核心表 + 当前关系表 + 引用快照表。

与旧 schema.py（documents/chunks 先删后写模型）并存：旧模型是 Phase 1 的交付物，
本文件是「精简实施方案」的落地。两者不共用表，互不影响。

纪律：
- 外键开启；WAL/FULL（9P 挂载点降级 DELETE 并提示，同 schema.connect 的处理）。
- 更新明确列，不整行 REPLACE 人工字段（sources.title/tags 是人工元数据）。
- versions / chunks 不可变：发布后不可改写，内容或配置变化只新增行。
"""

from __future__ import annotations

import sqlite3
import sys

from .core import KbError

SCHEMA_FORMAT = 2

DDL = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 来源：稳定 source_id；相同内容的不同来源分别建行。
-- title/tags 是人工元数据，扫描只写 auto_title，绝不覆盖人工列。
CREATE TABLE IF NOT EXISTS sources (
    source_id         TEXT PRIMARY KEY,
    path              TEXT,                    -- 当前相对路径（本地文件来源）
    url               TEXT,
    title             TEXT,                    -- 人工标题（可空）
    auto_title        TEXT,                    -- 扫描得到的标题（h1/文件名）
    tags              TEXT NOT NULL DEFAULT '[]',
    searchable        INTEGER NOT NULL DEFAULT 1,
    online            INTEGER NOT NULL DEFAULT 1,  -- 完整扫描才允许置 0；访问失败不动
    kind              TEXT NOT NULL DEFAULT 'doc', -- doc / nav_source
    last_seen_sha256  TEXT,                    -- 扫描最近看到的原文 sha（变更检测）
    active_version_id TEXT REFERENCES versions(version_id),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

-- 外部解析正文的当前登记；文件保持原位，阅读与检索共用冻结文本。
CREATE TABLE IF NOT EXISTS readable_documents (
    source_id TEXT PRIMARY KEY REFERENCES sources(source_id),
    source_sha256 TEXT NOT NULL,
    text_sha256 TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,
    parsed_path TEXT NOT NULL
);

-- 不可变处理版本：version_id = 规范化 JSON{内容sha256, 解析配置, 分块配置} 的完整摘要。
-- 模型更新不改变文本版本（embedding 不在摘要里）。
CREATE TABLE IF NOT EXISTS versions (
    version_id   TEXT PRIMARY KEY,
    sha256       TEXT NOT NULL,              -- 完整原文 SHA-256
    source_path  TEXT NOT NULL,              -- source/.snapshots/ 下的不可变快照
    parse_key    TEXT NOT NULL,              -- parsed/<parse_key>/ 复用键
    parse_config TEXT NOT NULL,              -- JSON 完整解析配置
    chunk_config TEXT NOT NULL,              -- JSON 完整分块配置
    chunk_count  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id   TEXT PRIMARY KEY,             -- <version_id>-<seq 4 位>
    version_id TEXT NOT NULL REFERENCES versions(version_id),
    seq        INTEGER NOT NULL,
    text       TEXT NOT NULL,
    char_start INTEGER,
    char_end   INTEGER,
    breadcrumb TEXT,
    UNIQUE (version_id, seq)
);

-- 单行：当前 collection 实例、完整 embedding/index 配置、最后提交任务。
-- 这是发布指针的唯一权威；_engine.json 只是摘要导出。
CREATE TABLE IF NOT EXISTS kb_state (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    collection    TEXT NOT NULL,
    embedding     TEXT NOT NULL,             -- JSON 完整 embedding + index 配置
    last_committed_job TEXT
);

-- 更新任务：building / committed / done / failed 四阶段。
-- retry_plan 固定格式 {"resume_from": "build|switch|cleanup"}。
CREATE TABLE IF NOT EXISTS jobs (
    job_id              TEXT PRIMARY KEY,
    kind                TEXT NOT NULL,       -- update / model_switch
    stage               TEXT NOT NULL,
    sources             TEXT NOT NULL,       -- JSON [source_id]
    candidate_versions  TEXT NOT NULL,       -- JSON {source_id: version_id}
    candidate_collection TEXT,
    error               TEXT,
    retry_plan          TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

-- 当前导航位置（一棵树的当前关系，不复制历史）。同一来源可出现在多个位置。
CREATE TABLE IF NOT EXISTS nav_positions (
    source_id TEXT NOT NULL REFERENCES sources(source_id),
    section   TEXT NOT NULL,
    nav_order INTEGER,
    PRIMARY KEY (source_id, section)
);

-- 当前链接关系（随来源切换同事务更新）。
CREATE TABLE IF NOT EXISTS links (
    src_source_id TEXT NOT NULL REFERENCES sources(source_id),
    dst_source_id TEXT NOT NULL REFERENCES sources(source_id),
    anchor        TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (src_source_id, dst_source_id, anchor)
);

-- 引用快照（会话/成果侧引用记录的最小落点）：
-- 保存当时的 source_id/version_id/chunk_id 与标题/URL/摘录/位置；
-- 读取历史引用不回取 sources 的最新标题或 URL。
CREATE TABLE IF NOT EXISTS citations (
    citation_id TEXT PRIMARY KEY,
    source_id   TEXT NOT NULL,
    version_id  TEXT NOT NULL,
    chunk_id    TEXT NOT NULL,
    title       TEXT,
    url         TEXT,
    excerpt     TEXT,
    char_start  INTEGER,
    char_end    INTEGER,
    created_at  TEXT NOT NULL
);

-- 人工组织与扫描导航分开；章节自身为树，文档可以有多个归属。
CREATE TABLE IF NOT EXISTS sections (
    section_id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES sections(section_id),
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS section_documents (
    section_id TEXT NOT NULL REFERENCES sections(section_id),
    source_id TEXT NOT NULL REFERENCES sources(source_id),
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(section_id, source_id)
);

CREATE INDEX IF NOT EXISTS ix_chunks_version ON chunks(version_id);
CREATE INDEX IF NOT EXISTS ix_sources_active ON sources(active_version_id);
"""


def connect2(db_path, verbose: bool = True) -> sqlite3.Connection:
    """打开新协议 kb.db：外键 ON、WAL、synchronous=FULL；建表并登记格式版本。"""
    conn = sqlite3.connect(str(db_path))
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )}
    if tables:
        version = None
        if "meta" in tables:
            try:
                row = conn.execute(
                    "SELECT value FROM meta WHERE key='schema_format'"
                ).fetchone()
                version = row[0] if row else None
            except sqlite3.DatabaseError:
                pass
        if version != str(SCHEMA_FORMAT):
            conn.close()
            raise KbError(
                f"已有数据库格式 {version or '未标记'}；不能用 v2 命令原地接管，请先在独立副本演练"
            )
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
    except sqlite3.OperationalError as e:
        if verbose:
            print(f"warn: journal_mode=WAL 不可用（{e}），降级为 DELETE；"
                  f"请在 WSL 原生 ext4 上运行后端", file=sys.stderr)
        conn.execute("PRAGMA journal_mode=DELETE;")
    conn.execute("PRAGMA synchronous=FULL;")
    conn.executescript(DDL)
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_format', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(SCHEMA_FORMAT),),
    )
    conn.commit()
    return conn


def read_state(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute(
        "SELECT collection, embedding, last_committed_job FROM kb_state WHERE id=1"
    ).fetchone()
    if not row:
        return None
    import json

    return {"collection": row[0], "embedding": json.loads(row[1]),
            "last_committed_job": row[2]}


def ensure_state(conn: sqlite3.Connection, collection: str, embedding: dict) -> None:
    import json

    conn.execute(
        "INSERT INTO kb_state (id, collection, embedding, last_committed_job) "
        "VALUES (1, ?, ?, NULL) "
        "ON CONFLICT(id) DO UPDATE SET collection=excluded.collection, "
        "embedding=excluded.embedding",
        (collection, json.dumps(embedding, ensure_ascii=False)),
    )
