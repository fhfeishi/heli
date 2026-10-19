"""存储底座：连接、事务、文件写入。

约定：
- 数据库负责身份、关系、版本、状态；文件负责原件与大内容。
- 跨文件操作先落文件、后发布数据库记录；失败不留下半条记录。
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from config import DB_NAME

SCHEMA_VERSION = "1"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS libraries(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS groups(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES groups(id),
  order_index INTEGER NOT NULL DEFAULT 0,
  hue TEXT NOT NULL DEFAULT 'neutral',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships(
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(group_id, library_id)
);

CREATE TABLE IF NOT EXISTS backgrounds(
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS sources(
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id),
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE(library_id, path)
);

CREATE TABLE IF NOT EXISTS versions(
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, sha256)
);

CREATE TABLE IF NOT EXISTS derived(
  version_id TEXT PRIMARY KEY REFERENCES versions(id),
  text TEXT NOT NULL,
  locator TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  body, title, version_id UNINDEXED, source_id UNINDEXED, library_id UNINDEXED,
  tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  scope_json TEXT NOT NULL DEFAULT '{}',
  template_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts(
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  run_id TEXT REFERENCES runs(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'report',
  status TEXT NOT NULL DEFAULT 'draft',
  body_md TEXT NOT NULL DEFAULT '',
  citations_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_revisions(
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  body_md TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  body_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_templates(
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  PRIMARY KEY(library_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_sources_library ON sources(library_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_members_group ON memberships(group_id, order_index);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, created_at);
"""


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Store:
    def __init__(self, root: Path | str, *, fast_writes: bool = False):
        self.root = Path(root)
        self.db_path = self.root / DB_NAME
        # 一次性批量导入时打开：跳过每次提交的 fsync。
        # 只用于可重跑的迁移场景（导入本身幂等），日常写入不要开。
        self.fast_writes = fast_writes
        # 批量模式下的共享连接；非 None 时 read/tx 都复用它
        self._shared: sqlite3.Connection | None = None

    # -- 目录 ------------------------------------------------------------
    @property
    def sources_dir(self) -> Path:
        return self.root / "sources"

    @property
    def derived_dir(self) -> Path:
        return self.root / "derived"

    @property
    def artifacts_dir(self) -> Path:
        return self.root / "artifacts"

    @property
    def temp_dir(self) -> Path:
        return self.root / "temp"

    def ensure_dirs(self) -> None:
        for path in (self.root, self.sources_dir, self.derived_dir, self.artifacts_dir, self.temp_dir):
            path.mkdir(parents=True, exist_ok=True)

    # -- 连接 ------------------------------------------------------------
    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        if self.fast_writes:
            conn.execute("PRAGMA synchronous = OFF")
        return conn

    def init(self) -> None:
        self.ensure_dirs()
        conn = self.connect()
        try:
            conn.executescript(SCHEMA)
            conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)", (SCHEMA_VERSION,))
            conn.commit()
        finally:
            conn.close()

    @contextlib.contextmanager
    def tx(self):
        # 批量模式：用 SAVEPOINT 保证单个文件失败不拖垮整批
        if self._shared is not None:
            self._shared.execute("SAVEPOINT sp")
            try:
                yield self._shared
            except Exception:
                self._shared.execute("ROLLBACK TO sp")
                self._shared.execute("RELEASE sp")
                raise
            self._shared.execute("RELEASE sp")
            return
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @contextlib.contextmanager
    def read(self):
        if self._shared is not None:
            yield self._shared
            return
        conn = self.connect()
        try:
            yield conn
        finally:
            conn.close()

    @contextlib.contextmanager
    def batch(self):
        """整批共用一个连接、最后提交一次。

        上千个文件逐个提交时，DrvFs 上每次 commit 都要一次昂贵的 fsync，
        总量会变成几十分钟。整批提交把它压回可接受范围；中途失败整批回滚，
        重跑即可（导入幂等）。
        """
        if self._shared is not None:
            yield self._shared
            return
        conn = self.connect()
        self._shared = conn
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._shared = None
            conn.close()

    # -- 文件 ------------------------------------------------------------
    def write_bytes(self, path: Path, data: bytes) -> None:
        """临时文件 + 原子替换；覆盖失败直接抛错，不半写。"""
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".tmp")
        with open(temp, "wb") as handle:
            handle.write(data)
            # 批量导入（fast_writes）跳过 fsync：DrvFs 上每个文件一次 fsync 会让导入慢数倍。
            # 导入幂等、可重跑，这里牺牲的是「掉电后最多重跑一次」，不是数据正确性。
            if not self.fast_writes:
                handle.flush()
                os.fsync(handle.fileno())
        os.replace(temp, path)

    def delete_file(self, path: Path) -> None:
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
