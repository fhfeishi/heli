"""retrieval：范围解析、检索、证据定位。

Agent 与普通搜索共用这三个函数，不各写一套。
"""
from __future__ import annotations

import re

from errors import Invalid, NotFound
from models import ResolvedScope, Scope, SearchHit
from storage import Store

MAX_LIMIT = 100
_TOKEN = re.compile(r"\S+")


def resolve_scope(store: Store, scope: Scope) -> ResolvedScope:
    with store.read() as conn:
        if scope.kind == "all":
            rows = conn.execute("SELECT id FROM libraries WHERE archived_at IS NULL").fetchall()
            return ResolvedScope([row["id"] for row in rows], None, "全部资料库")

        if scope.kind == "library":
            row = conn.execute("SELECT id, archived_at FROM libraries WHERE id=?", (scope.id,)).fetchone()
            if row is None:
                raise NotFound(f"资料库不存在：{scope.id}")
            return ResolvedScope([] if row["archived_at"] else [row["id"]], None, f"资料库 {scope.id}")

        if scope.kind == "group":
            group_ids = _group_with_children(conn, str(scope.id))
            if not group_ids:
                raise NotFound(f"组不存在：{scope.id}")
            marks = ",".join("?" for _ in group_ids)
            rows = conn.execute(
                f"SELECT DISTINCT l.id FROM libraries l JOIN memberships m ON m.library_id=l.id "
                f"WHERE m.group_id IN ({marks}) AND l.archived_at IS NULL", group_ids).fetchall()
            return ResolvedScope([row["id"] for row in rows], None, f"组 {scope.id}（含子组）")

        if scope.kind == "source":
            row = conn.execute(
                "SELECT s.id, s.library_id, s.archived_at, l.archived_at AS lib_archived FROM sources s "
                "JOIN libraries l ON l.id=s.library_id WHERE s.id=?", (scope.id,)).fetchone()
            if row is None:
                raise NotFound(f"资料不存在：{scope.id}")
            if row["archived_at"] or row["lib_archived"]:
                return ResolvedScope([], [], f"资料 {scope.id}（已下线）")
            return ResolvedScope([row["library_id"]], [row["id"]], f"资料 {scope.id}")

    raise Invalid(f"未知范围类型：{scope.kind}")


def search(store: Store, scope: Scope, query: str, limit: int = 20) -> list[dict]:
    text = str(query or "").strip()
    if not text:
        raise Invalid("检索词不能为空")
    limit = max(1, min(int(limit or 20), MAX_LIMIT))
    resolved = resolve_scope(store, scope)
    if not resolved.library_ids:
        return []

    tokens = [token for token in _TOKEN.findall(text) if token.strip()]
    # trigram 索引要求每个词至少 3 个字符；更短的词走 LIKE，避免 FTS 报错或漏检
    use_fts = bool(tokens) and all(len(token) >= 3 for token in tokens)

    marks = ",".join("?" for _ in resolved.library_ids)
    # 两个分支都 join 了 sources，用 s.library_id；FTS 分支里 search_index 也 join 得到
    where = [f"s.library_id IN ({marks})", "s.archived_at IS NULL", "l.archived_at IS NULL"]
    params: list = list(resolved.library_ids)
    if resolved.source_ids is not None:
        if not resolved.source_ids:
            return []
        where.append("s.id IN (" + ",".join("?" for _ in resolved.source_ids) + ")")
        params.extend(resolved.source_ids)

    if use_fts:
        sql = (
            "SELECT s.id AS source_id, s.title, s.library_id, v.id AS version_id, d.text AS body, "
            "       bm25(search_index) AS score, snippet(search_index, 0, '<<', '>>', '…', 16) AS snip "
            "FROM search_index "
            "JOIN versions v ON v.id = search_index.version_id "
            "JOIN sources s ON s.id = v.source_id "
            "JOIN libraries l ON l.id = s.library_id "
            "JOIN derived d ON d.version_id = v.id "
            "WHERE search_index MATCH ? AND " + " AND ".join(where) +
            " ORDER BY score LIMIT ?"
        )
        args = [_fts_query(tokens)] + params + [limit]
    else:
        sql = (
            "SELECT s.id AS source_id, s.title, s.library_id, v.id AS version_id, d.text AS body, "
            "       0 AS score, '' AS snip "
            "FROM derived d "
            "JOIN versions v ON v.id = d.version_id "
            "JOIN sources s ON s.id = v.source_id "
            "JOIN libraries l ON l.id = s.library_id "
            "WHERE d.text LIKE ? AND " + " AND ".join(where) +
            " ORDER BY s.updated_at DESC LIMIT ?"
        )
        args = [f"%{text}%"] + params + [limit]

    with store.read() as conn:
        rows = conn.execute(sql, args).fetchall()

    hits = []
    for row in rows:
        position = _position(row["body"], text)
        snippet = row["snip"] or _snippet(row["body"], position)
        hits.append(SearchHit(
            source_id=row["source_id"], version_id=row["version_id"], library_id=row["library_id"],
            title=row["title"], snippet=snippet, position=position, score=float(row["score"]),
        ).__dict__)
    return hits


def read(store: Store, version_id: str) -> dict:
    with store.read() as conn:
        row = conn.execute(
            "SELECT d.text, d.version_id, v.source_id, v.sha256, s.title, s.library_id, s.archived_at "
            "FROM derived d JOIN versions v ON v.id=d.version_id JOIN sources s ON s.id=v.source_id "
            "WHERE d.version_id=?", (version_id,)).fetchone()
    if row is None:
        raise NotFound(f"版本没有可读正文：{version_id}")
    return {"version_id": row["version_id"], "source_id": row["source_id"], "library_id": row["library_id"],
            "title": row["title"], "sha256": row["sha256"], "text": row["text"],
            "source_available": row["archived_at"] is None}


def excerpt(store: Store, version_id: str, position: int | None, length: int = 240) -> str | None:
    text = read(store, version_id)["text"]
    if position is None:
        return text[:length]
    start = max(0, position - length // 4)
    return text[start:start + length]


def _fts_query(tokens: list[str]) -> str:
    return " ".join('"' + token.replace('"', '""') + '"' for token in tokens)


def _snippet(body: str, position: int | None, length: int = 160) -> str:
    if position is None:
        return body[:length].replace("\n", " ")
    start = max(0, position - length // 4)
    return body[start:start + length].replace("\n", " ")


def _position(body: str, query: str) -> int | None:
    """只有逐字命中才给字符位置；找不到就返回 None，不猜。"""
    lowered = body.lower()
    for token in _TOKEN.findall(query):
        index = lowered.find(token.lower())
        if index >= 0:
            return index
    return None


def _group_with_children(conn, group_id: str) -> list[str]:
    row = conn.execute("SELECT id FROM groups WHERE id=?", (group_id,)).fetchone()
    if row is None:
        return []
    found, frontier = [group_id], [group_id]
    while frontier:
        parent = frontier.pop()
        for item in conn.execute("SELECT id FROM groups WHERE parent_id=?", (parent,)):
            if item["id"] not in found:
                found.append(item["id"])
                frontier.append(item["id"])
    return found
