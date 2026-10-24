"""retrieval：范围解析、检索、证据定位。

Agent 与普通搜索共用这三个函数，不各写一套。
"""
from __future__ import annotations

import re

from errors import Conflict, Invalid, NotFound
from models import ResolvedScope, Scope, SearchHit
from storage import Store

MAX_LIMIT = 100

# 文件名里的年份区间：`2021_2024_...`（起_止）。这批资料的命名规律，
# 也是目前唯一可靠的「资料覆盖哪几年」信号——正文里的年份是叙述性的，不可聚合。
_YEAR_SPAN = re.compile(r"^((?:19|20)\d{2})_((?:19|20)\d{2})")

# 查询切分：标点、空白、常见分隔符
_QUERY_SPLIT = re.compile(r"[\s，。！？；：、,.!?;:（）()\[\]【】\"'“”‘’《》<>/\\|\-—_=+*#@&]+")
_ASCII_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.\-]*")
_CN_RUN = re.compile(r"[\u4e00-\u9fff]+")

# 问句里的疑问词与指令词：对检索没有信息量，留着只会稀释匹配
_STOP_PHRASES = (
    "是什么", "有哪些", "怎么样", "为什么", "如何", "怎么", "哪些", "什么", "是否",
    "请帮我", "帮我", "总结一下", "总结", "介绍一下", "说明一下", "分析一下",
    "的主要", "相关的", "方面的", "以及", "还有", "是什么样",
)


def _cn_pieces(run: str) -> list[str]:
    """中文片段：短的整体保留，长的切成 4 字滑窗（步长 2，保证尾部覆盖）。"""
    for phrase in _STOP_PHRASES:
        run = run.replace(phrase, " ")
    pieces: list[str] = []
    for part in run.split():
        if len(part) < 2:
            continue
        if len(part) <= 6:
            pieces.append(part)
            continue
        for start in range(0, len(part) - 2, 2):
            window = part[start:start + 4]
            if len(window) >= 3:
                pieces.append(window)
    return pieces


def _tokens(text: str) -> list[str]:
    """把自然语言查询切成检索单元。用户不会用空格写关键词，他们会写一句话。"""
    raw = str(text or "").strip()
    if not raw:
        return []
    tokens: list[str] = []
    for chunk in _QUERY_SPLIT.split(raw):
        chunk = chunk.strip()
        if not chunk:
            continue
        for word in _ASCII_WORD.findall(chunk):
            if len(word) >= 2:
                tokens.append(word)
        for run in _CN_RUN.findall(chunk):
            tokens.extend(_cn_pieces(run))
    seen: set[str] = set()
    unique: list[str] = []
    for token in tokens:
        key = token.lower()
        if key not in seen:
            seen.add(key)
            unique.append(token)
    return unique


def resolve_scope(store: Store, scope: Scope) -> ResolvedScope:
    with store.read() as conn:
        if scope.kind == "all":
            rows = conn.execute("SELECT id FROM libraries WHERE archived_at IS NULL").fetchall()
            return ResolvedScope([row["id"] for row in rows], None, "全部资料库")

        if scope.kind == "multi":
            # 多选：每一项按自己的 kind 解析，再取并集。
            # 任一选择都不存在/已下线时不让整个范围静默变空——那种「跑出来没结果」
            # 比直接报错难查得多。
            library_ids: list[str] = []
            source_ids: list[str] | None = None
            missing: list[str] = []
            picked_sources: list[str] = []
            for item in scope.ids:
                kind, _, ident = item.partition(":")
                sub = resolve_scope(store, Scope(kind or "library", ident or None))
                for lib in sub.library_ids:
                    if lib not in library_ids:
                        library_ids.append(lib)
                if sub.source_ids:
                    picked_sources.extend(sub.source_ids)
                    source_ids = picked_sources
                if not sub.library_ids and not sub.source_ids:
                    missing.append(item)
            if not scope.ids:
                raise Invalid("多选范围里没有选任何库或组")
            if not library_ids and not source_ids:
                raise Conflict("选中的范围里没有可用资料：" + "、".join(missing or scope.ids))
            label = f"多选 {len(scope.ids)} 项（{len(library_ids)} 个库）"
            if missing:
                label += f"，{len(missing)} 项无可用资料"
            return ResolvedScope(library_ids, source_ids, label)

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


def search(store: Store, scope: Scope, query: str, limit: int = 20,
           filters: dict | None = None) -> list[dict]:
    """检索。filters 支持结构化过滤，与关键词是「与」的关系。

    filters:
      year_from / year_to  int  按文件名年份区间筛（资料的覆盖期与区间有交集即算命中）
      library_ids          list 在 scope 之上再收窄到这些库

    为什么年份走文件名而不是正文：正文里的「2023 年」是叙述的一部分，
    拿来聚合会把「本文引用 2019 年的文献」也算成「这份资料覆盖 2019 年」。
    文件名的「起_止」才是这份资料的覆盖期。
    """
    text = str(query or "").strip()
    opts = filters or {}
    year_from = opts.get("year_from")
    year_to = opts.get("year_to")
    # 只给时间不给关键词是合法查询（「2020-2025 年医学方向」里的时间部分）
    if not text and year_from is None and year_to is None:
        raise Invalid("检索词与时间范围不能同时为空")
    limit = max(1, min(int(limit or 20), MAX_LIMIT))
    resolved = resolve_scope(store, scope)
    if not resolved.library_ids:
        return []
    if opts.get("library_ids"):
        keep = set(opts["library_ids"])
        resolved = ResolvedScope([lib for lib in resolved.library_ids if lib in keep],
                                 resolved.source_ids, resolved.description)
        if not resolved.library_ids:
            return []

    tokens = _tokens(text) if text else []
    # 只有时间条件时不需要关键词：走一条纯元数据查询
    if not tokens and year_from is None and year_to is None:
        return []
    # trigram 索引要求每个词至少 3 个字符；更短的词走 LIKE，避免 FTS 报错或漏检
    use_fts = all(len(token) >= 3 for token in tokens)

    marks = ",".join("?" for _ in resolved.library_ids)
    # 两个分支都 join 了 sources，用 s.library_id；FTS 分支里 search_index 也 join 得到
    where = [f"s.library_id IN ({marks})", "s.archived_at IS NULL", "l.archived_at IS NULL"]
    params: list = list(resolved.library_ids)
    if resolved.source_ids is not None:
        if not resolved.source_ids:
            return []
        where.append("s.id IN (" + ",".join("?" for _ in resolved.source_ids) + ")")
        params.extend(resolved.source_ids)

    # 年份过滤：从文件名取「起_止」（s.path 形如 2021_2024_编号_姓名_标题.pdf）。
    # 判定「区间有交集」而不是「包含」：找 2023 年的资料，
    # 2021–2024 的结题报告应该算命中。
    if year_from is not None:
        where.append("CAST(substr(s.path, 6, 4) AS INTEGER) >= ?")
        params.append(int(year_from))
    if year_to is not None:
        where.append("CAST(substr(s.path, 1, 4) AS INTEGER) <= ?")
        params.append(int(year_to))

    if not tokens:
        # 只有时间条件：直接列元数据，不做全文匹配
        sql = (
            "SELECT s.id AS source_id, s.title, s.library_id, v.id AS version_id, d.text AS body, "
            "       0 AS score, '' AS snip "
            "FROM sources s "
            "JOIN versions v ON v.id = (SELECT id FROM versions WHERE source_id=s.id "
            "                          ORDER BY created_at DESC LIMIT 1) "
            "LEFT JOIN derived d ON d.version_id = v.id "
            "JOIN libraries l ON l.id = s.library_id "
            "WHERE " + " AND ".join(where) +
            " ORDER BY s.path LIMIT ?"
        )
        args = params + [limit]
    elif use_fts:
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
            "WHERE (" + " OR ".join("d.text LIKE ?" for _ in tokens) + ") AND "
            + " AND ".join(where) +
            " ORDER BY s.updated_at DESC LIMIT ?"
        )
        args = [f"%{token}%" for token in tokens] + params + [limit]

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
    """FTS5 查询串：多词用 OR，靠 bm25 排序区分相关度。

    隐式 AND 对自然语言问句过严——要求所有片段同时出现，等于筛掉大部分命中。
    """
    return " OR ".join('"' + token.replace('"', '""') + '"' for token in tokens)


def _snippet(body: str, position: int | None, length: int = 160) -> str:
    if position is None:
        return body[:length].replace("\n", " ")
    start = max(0, position - length // 4)
    return body[start:start + length].replace("\n", " ")


def _position(body: str, query: str) -> int | None:
    """只有逐字命中才给字符位置；找不到就返回 None，不猜。

    用最长的检索单元定位：滑窗切出来的碎片即使命中，也不是用户真正找的内容。
    """
    lowered = body.lower()
    for token in sorted(_tokens(query), key=len, reverse=True):
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
