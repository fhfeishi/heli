"""全文检索（BM25 / SQLite FTS5）——U2 本轮检索通道。

位置与性质：索引是**可重建**的派生物，落在 `vectordb/fts5/fts.db`
（与向量引擎同一层，命名规则一致：vectordb/<engine>/，便于将来换引擎）。
不写进 `datadb/`——那是不可重建的库数据，索引不该污染它。

分词：FTS5 的 trigram 分词器（SQLite ≥ 3.34），中英文都能按子串命中；
查询一律按**短语**处理，用户输入中的 FTS5 语法字符不再被当成运算符。

命中定位：返回 `char_start/char_end`（原文字符区间）与 `section_index`
（所属 ATX 章节序号），前端据此直接打开到那一段。
"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from datetime import datetime, timezone

from . import management
from .core import KbError
from .pipeline2 import storage_operation

ENGINE = "fts5"
INDEX_VERSION = 2
SNIPPET_BEFORE = 90
SNIPPET_AFTER = 210


# ---------------------------------------------------------------- 路径


def fts_dir(kb):
    return kb.vectordb_dir / ENGINE


def fts_db(kb):
    return fts_dir(kb) / "fts.db"


def _connect(kb, create=False):
    if not fts_db(kb).is_file():
        if not create:
            raise KbError("全文索引尚未构建：先跑 v2-manage search-index")
        fts_dir(kb).mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(fts_db(kb)))
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5("
                     "source_id UNINDEXED, path UNINDEXED, title, body, "
                     "tokenize='trigram')")
        conn.execute("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)")
        conn.commit()
        return conn
    return sqlite3.connect(str(fts_db(kb)))


# ---------------------------------------------------------------- 构建


@storage_operation
def build_index(kb) -> dict:
    """重建全文索引：先清后写（I2），整库一致，不做增量。"""
    started = time.time()
    conn = _connect(kb, create=True)
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("CREATE TABLE IF NOT EXISTS source_versions(source_id TEXT PRIMARY KEY, sha256 TEXT)")
        conn.execute("DELETE FROM source_versions")
        conn.execute("DELETE FROM docs")
        conn.execute("DELETE FROM meta")
        with management._connect(kb) as main:
            rows = main.execute(
                "SELECT source_id,path,COALESCE(title,auto_title),last_seen_sha256 "
                "FROM sources WHERE online=1 AND kind='doc' ORDER BY path").fetchall()
        missing = []
        unparsed = []
        indexed = 0
        chars = 0
        for source_id, path, title, sha in rows:
            try:
                if Path(path).suffix.lower() == '.pdf':
                    with management._connect(kb) as main:
                        readable = main.execute('SELECT 1 FROM readable_documents WHERE source_id=? AND source_sha256=?', (source_id, sha)).fetchone()
                    if not readable:
                        unparsed.append(path)
                        continue
                elif Path(path).suffix.lower() not in ('.md', '.txt', '.mdx', '.markdown'):
                    unparsed.append(path)
                    continue
                meta, body = management._frozen_text(kb, source_id)
                sha = meta[2]
            except KbError as error:
                raise KbError(f"正文不可用，保留原索引：{path}：{error}") from error
            conn.execute("INSERT INTO docs(source_id,path,title,body) VALUES (?,?,?,?)",
                         (source_id, path, title or "", body))
            conn.execute("INSERT INTO source_versions VALUES (?,?)", (source_id, sha))
            indexed += 1
            chars += len(body)
        built_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        conn.execute("INSERT INTO meta(key,value) VALUES ('index_version',?)", (str(INDEX_VERSION),))
        conn.execute("INSERT INTO meta(key,value) VALUES ('built_at',?)", (built_at,))
        conn.execute("INSERT INTO meta(key,value) VALUES ('documents',?)", (str(indexed),))
        conn.execute("INSERT INTO meta(key,value) VALUES ('chars',?)", (str(chars),))
        conn.execute("INSERT INTO docs(docs) VALUES ('optimize')")
        conn.commit()
    finally:
        conn.close()
    return {"engine": ENGINE, "indexed": indexed, "chars": chars,
            "missing_snapshot": missing, "unparsed": unparsed, "built_at": built_at,
            "seconds": round(time.time() - started, 2)}


def drop_index(kb) -> dict:
    path = fts_db(kb)
    existed = path.is_file()
    if existed:
        path.unlink()
    return {"removed": existed, "path": str(path)}


def status(kb) -> dict:
    if not fts_db(kb).is_file():
        return {"engine": ENGINE, "built": False, "documents": 0, "built_at": None,
                "path": str(fts_db(kb))}
    with closing(_connect(kb)) as conn:
        meta = dict(conn.execute("SELECT key,value FROM meta").fetchall())
        documents = conn.execute("SELECT count(*) FROM docs").fetchone()[0]
    return {"engine": ENGINE, "built": int(meta.get("index_version", 0)) == INDEX_VERSION, "documents": documents,
            "built_at": meta.get("built_at"), "chars": int(meta.get("chars", 0)),
            "index_version": int(meta.get("index_version", 0)),
            "path": str(fts_db(kb))}


# ---------------------------------------------------------------- 查询


def _phrase(query: str) -> str:
    """把用户输入变成 FTS5 短语：不把标点当运算符。"""
    text = query.strip()
    if not text:
        raise KbError("检索词不能为空")
    return '"' + text.replace('"', '""') + '"'


def _section_of(body: str, char_start: int) -> int:
    for section in management._markdown_sections(body):
        if section["char_start"] <= char_start < section["char_end"]:
            return section["index"]
    return 0


def _snippet(body: str, start: int, end: int) -> tuple[str, int, int]:
    head = max(0, start - SNIPPET_BEFORE)
    tail = min(len(body), end + SNIPPET_AFTER)
    text = body[head:tail]
    if head > 0:
        text = "…" + text
    if tail < len(body):
        text = text + "…"
    shift = 1 if head > 0 else 0
    return text, start - head + shift, end - head + shift


def _candidates(conn, query: str) -> list[sqlite3.Row]:
    """候选集：≥3 字符走 FTS5/BM25；更短的中文词 trigram 匹配不到，退回全表子串扫描。"""
    if len(query.strip()) >= 3:
        return conn.execute(
            "SELECT source_id,path,title,body,bm25(docs) score FROM docs "
            "WHERE docs MATCH ? ORDER BY score,source_id", (_phrase(query),)).fetchall()
    needle = query.strip().lower()
    return conn.execute(
        "SELECT source_id,path,title,body,-1.0 score FROM docs "
        "WHERE instr(lower(body),?)>0 OR instr(lower(title),?)>0 ORDER BY source_id",
        (needle, needle)).fetchall()


def search(kb, query: str, section_id: str | None = None, limit: int = 20,
           offset: int = 0) -> dict:
    """BM25 排序的全文检索；命中给出原文字符区间与所属章节，前端据此直接打开那一段。"""
    if offset < 0 or not 1 <= limit <= 100:
        raise KbError("offset 必须非负，limit 范围 1–100")
    text = query.strip()
    if not text:
        raise KbError("检索词不能为空")
    allowed = None
    if section_id:
        with management._connect(kb) as main:
            if not main.execute("SELECT 1 FROM sections WHERE section_id=?", (section_id,)).fetchone():
                raise KbError("章节不存在")
            allowed = {r[0] for r in main.execute(
                "WITH RECURSIVE subtree(id) AS (SELECT section_id FROM sections WHERE section_id=? "
                "UNION ALL SELECT c.section_id FROM sections c JOIN subtree t ON c.parent_id=t.id) "
                "SELECT source_id FROM section_documents WHERE section_id IN (SELECT id FROM subtree)",
                (section_id,)).fetchall()}
    needle = text.lower()
    hits: list[dict] = []
    with closing(_connect(kb)) as conn:
        conn.row_factory = sqlite3.Row
        meta = dict(conn.execute("SELECT key,value FROM meta"))
        if int(meta.get("index_version", 0)) != INDEX_VERSION:
            raise KbError("全文索引版本已变更，请重新构建索引")
        versions = dict(conn.execute("SELECT source_id,sha256 FROM source_versions"))
        rows = _candidates(conn, text)
    for row in rows:
        if allowed is not None and row["source_id"] not in allowed:
            continue
        body = row["body"]
        at = body.lower().find(needle)
        if at < 0:
            at = body.lower().find(needle[:3]) if len(needle) >= 3 else -1
        if at < 0:
            continue
        snippets = []
        cursor = 0
        while len(snippets) < 2:
            found = body.lower().find(needle, cursor)
            if found < 0:
                break
            snippet, hs, he = _snippet(body, found, found + len(needle))
            snippets.append({"text": snippet, "hit_start": hs, "hit_end": he})
            cursor = found + len(needle)
        if not snippets:
            snippets = [{"text": body[:SNIPPET_AFTER], "hit_start": 0, "hit_end": 0}]
        hits.append({
            "source_id": row["source_id"], "path": row["path"], "title": row["title"],
            "sha256": versions[row["source_id"]],
            "score": round(float(row["score"]), 4),
            "char_start": at, "char_end": at + len(needle),
            "section_index": _section_of(body, at),
            "snippets": snippets,
        })
    page = hits[offset:offset + limit]
    return {"engine": ENGINE, "query": text, "section": section_id, "offset": offset,
            "total": len(hits), "candidates": len(rows),
            "ranked_by": "bm25" if len(text) >= 3 else "substring",
            "hits": page,
            "next_offset": offset + len(page) if offset + len(page) < len(hits) else None}
