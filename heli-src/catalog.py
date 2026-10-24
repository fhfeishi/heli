"""catalog：资料组织与背景。不读文件内容，不做解析。"""
from __future__ import annotations

import sources_meta
from errors import Conflict, Invalid, NotFound
from storage import Store, new_id, now

MAX_DEPTH = 3
NAME_LIMIT = 60
_UNSET = object()


def _name(value, what="名称") -> str:
    text = str(value or "").strip()
    if not text:
        raise Invalid(f"{what}不能为空")
    if len(text) > NAME_LIMIT:
        raise Invalid(f"{what}不超过 {NAME_LIMIT} 字")
    return text


# ---------------------------------------------------------------- 资料库


def create_library(store: Store, name: str, description: str = "") -> dict:
    lib_id = new_id("lib")
    stamp = now()
    with store.tx() as conn:
        conn.execute(
            "INSERT INTO libraries(id, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
            (lib_id, _name(name), str(description or ""), stamp, stamp),
        )
    return get_library(store, lib_id)


def get_library(store: Store, lib_id: str, *, include_archived: bool = False) -> dict:
    with store.read() as conn:
        row = conn.execute("SELECT * FROM libraries WHERE id=?", (lib_id,)).fetchone()
        if row is None or (row["archived_at"] and not include_archived):
            raise NotFound(f"资料库不存在：{lib_id}")
        groups = [item["group_id"] for item in conn.execute(
            "SELECT group_id FROM memberships WHERE library_id=? ORDER BY order_index", (lib_id,))]
        counts = _counts(conn, lib_id)
    return {
        "id": row["id"], "name": row["name"], "description": row["description"],
        "archived_at": row["archived_at"], "group_ids": groups,
        "created_at": row["created_at"], "updated_at": row["updated_at"], **counts,
    }


def update_library(store: Store, lib_id: str, *, name=_UNSET, description=_UNSET) -> dict:
    current = get_library(store, lib_id, include_archived=True)
    fields, values = [], []
    if name is not _UNSET:
        fields.append("name=?")
        values.append(_name(name))
    if description is not _UNSET:
        fields.append("description=?")
        values.append(str(description or ""))
    if fields:
        fields.append("updated_at=?")
        values.append(now())
        values.append(lib_id)
        with store.tx() as conn:
            conn.execute(f"UPDATE libraries SET {', '.join(fields)} WHERE id=?", values)
    return get_library(store, lib_id, include_archived=True) if current else {}


def archive_library(store: Store, lib_id: str, archived: bool = True) -> dict:
    get_library(store, lib_id, include_archived=True)
    with store.tx() as conn:
        conn.execute("UPDATE libraries SET archived_at=?, updated_at=? WHERE id=?",
                     (now() if archived else None, now(), lib_id))
        # 归档同时让来源退出检索；恢复时按未归档来源重建索引由 reindex 负责
        conn.execute("UPDATE sources SET archived_at=? WHERE library_id=?",
                     (now() if archived else None, lib_id))
        if archived:
            conn.execute("DELETE FROM search_index WHERE library_id=?", (lib_id,))
    return get_library(store, lib_id, include_archived=True)


def list_libraries(store: Store, *, include_archived: bool = False) -> list[dict]:
    with store.read() as conn:
        rows = conn.execute(
            "SELECT * FROM libraries" + ("" if include_archived else " WHERE archived_at IS NULL") +
            " ORDER BY name").fetchall()
        result = []
        for row in rows:
            groups = [item["group_id"] for item in conn.execute(
                "SELECT group_id FROM memberships WHERE library_id=?", (row["id"],))]
            result.append({
                "id": row["id"], "name": row["name"], "description": row["description"],
                "archived_at": row["archived_at"], "group_ids": groups,
                "created_at": row["created_at"], "updated_at": row["updated_at"],
                **_counts(conn, row["id"]),
            })
    return result



def _counts(conn, lib_id: str) -> dict:
    source = conn.execute("SELECT COUNT(*) FROM sources WHERE library_id=? AND archived_at IS NULL",
                          (lib_id,)).fetchone()[0]
    # 数「资料」而不是「版本」：一个资料可能有多个历史版本，按 version 计数会超过资料总数。
    # 状态由导入 / 重解析维护：indexed=有可检索正文，registered=仅登记（如扫描版 PDF）。
    indexed = conn.execute(
        "SELECT COUNT(*) FROM sources WHERE library_id=? AND archived_at IS NULL AND status='indexed'",
        (lib_id,)).fetchone()[0]
    # 年份跨度：同类库的资料数与可检索数差异不大，卡片上分不出彼此；
    # 而这批资料的文件名带「起_止」年份，跨度是真实且可区分的信号。
    span = None
    for row in conn.execute(
            "SELECT path FROM sources WHERE library_id=? AND archived_at IS NULL LIMIT 4000", (lib_id,)):
        found = sources_meta.year_span(row["path"])
        if not found:
            continue
        span = list(found) if span is None else [min(span[0], found[0]), max(span[1], found[1])]
    return {"source_count": source, "indexed_count": indexed,
            "year_span": f"{span[0]}–{span[1]}" if span else None}


# ---------------------------------------------------------------- 组


def create_group(store: Store, name: str, parent_id: str | None = None, hue: str = "neutral") -> dict:
    with store.tx() as conn:
        if parent_id:
            _require_group(conn, parent_id)
            if _depth(conn, parent_id) + 1 > MAX_DEPTH:
                raise Invalid(f"组最多 {MAX_DEPTH} 层")
        order = conn.execute("SELECT COALESCE(MAX(order_index), -1) + 1 FROM groups WHERE parent_id IS ?",
                             (parent_id,)).fetchone()[0]
        group_id = new_id("grp")
        stamp = now()
        conn.execute(
            "INSERT INTO groups(id, name, parent_id, order_index, hue, created_at, updated_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (group_id, _name(name), parent_id, order, str(hue or "neutral"), stamp, stamp),
        )
    return get_group(store, group_id)


def get_group(store: Store, group_id: str) -> dict:
    with store.read() as conn:
        row = _require_group(conn, group_id)
        members = [item["library_id"] for item in conn.execute(
            "SELECT library_id FROM memberships WHERE group_id=? ORDER BY order_index", (group_id,))]
        children = [item["id"] for item in conn.execute(
            "SELECT id FROM groups WHERE parent_id=? ORDER BY order_index", (group_id,))]
        background = conn.execute(
            "SELECT text FROM backgrounds WHERE subject_type='group' AND subject_id=?", (group_id,)).fetchone()
    return {"id": row["id"], "name": row["name"], "parent_id": row["parent_id"],
            "order_index": row["order_index"], "hue": row["hue"],
            "library_ids": members, "child_ids": children,
            "background": background["text"] if background else ""}


def update_group(store: Store, group_id: str, *, name=_UNSET, parent_id=_UNSET, hue=_UNSET) -> dict:
    with store.tx() as conn:
        _require_group(conn, group_id)
        if parent_id is not _UNSET:
            if parent_id:
                _require_group(conn, parent_id)
                if parent_id == group_id or group_id in _ancestors(conn, parent_id):
                    raise Conflict("父组不能是自己或自己的子组")
                if _depth(conn, parent_id) + 1 > MAX_DEPTH:
                    raise Invalid(f"组最多 {MAX_DEPTH} 层")
            conn.execute("UPDATE groups SET parent_id=?, updated_at=? WHERE id=?",
                         (parent_id or None, now(), group_id))
        if name is not _UNSET:
            conn.execute("UPDATE groups SET name=?, updated_at=? WHERE id=?",
                         (_name(name), now(), group_id))
        if hue is not _UNSET:
            conn.execute("UPDATE groups SET hue=?, updated_at=? WHERE id=?", (str(hue), now(), group_id))
    return get_group(store, group_id)


def delete_group(store: Store, group_id: str) -> dict:
    with store.tx() as conn:
        _require_group(conn, group_id)
        children = conn.execute("SELECT COUNT(*) FROM groups WHERE parent_id=?", (group_id,)).fetchone()[0]
        if children:
            raise Conflict("先移走或删除子组")
        members = conn.execute("SELECT COUNT(*) FROM memberships WHERE group_id=?", (group_id,)).fetchone()[0]
        conn.execute("DELETE FROM groups WHERE id=?", (group_id,))
        conn.execute("DELETE FROM backgrounds WHERE subject_type='group' AND subject_id=?", (group_id,))
    return {"deleted": group_id, "released_members": members}


def list_groups(store: Store) -> list[dict]:
    with store.read() as conn:
        rows = conn.execute("SELECT * FROM groups ORDER BY parent_id IS NOT NULL, order_index, name").fetchall()
        # 背景一并取回：列表页要能看出「这个组写过背景没有」，
        # 否则用户只能逐组点开才知道，写了也白写
        backgrounds = {item["subject_id"]: item["text"] for item in conn.execute(
            "SELECT subject_id, text FROM backgrounds WHERE subject_type='group'")}
        result = []
        for row in rows:
            members = [item["library_id"] for item in conn.execute(
                "SELECT library_id FROM memberships WHERE group_id=? ORDER BY order_index", (row["id"],))]
            result.append({"id": row["id"], "name": row["name"], "parent_id": row["parent_id"],
                           "order_index": row["order_index"], "hue": row["hue"],
                           "library_ids": members,
                           "background": backgrounds.get(row["id"], "")})
    return result


# ---------------------------------------------------------------- 成员关系


def set_group_members(store: Store, group_id: str, library_ids: list[str]) -> dict:
    if not isinstance(library_ids, list):
        raise Invalid("library_ids 必须是数组")
    with store.tx() as conn:
        _require_group(conn, group_id)
        for lib_id in library_ids:
            row = conn.execute("SELECT archived_at FROM libraries WHERE id=?", (lib_id,)).fetchone()
            if row is None:
                raise NotFound(f"资料库不存在：{lib_id}")
            if row["archived_at"]:
                raise Conflict(f"资料库已归档：{lib_id}")
        conn.execute("DELETE FROM memberships WHERE group_id=?", (group_id,))
        for index, lib_id in enumerate(library_ids):
            conn.execute("INSERT INTO memberships(group_id, library_id, order_index) VALUES(?,?,?)",
                         (group_id, lib_id, index))
    return get_group(store, group_id)


def add_member(store: Store, group_id: str, library_id: str) -> dict:
    with store.tx() as conn:
        _require_group(conn, group_id)
        if conn.execute("SELECT 1 FROM libraries WHERE id=? AND archived_at IS NULL", (library_id,)).fetchone() is None:
            raise NotFound(f"资料库不存在或已归档：{library_id}")
        exists = conn.execute("SELECT 1 FROM memberships WHERE group_id=? AND library_id=?",
                              (group_id, library_id)).fetchone()
        if exists:
            return get_group(store, group_id)
        order = conn.execute("SELECT COALESCE(MAX(order_index), -1) + 1 FROM memberships WHERE group_id=?",
                             (group_id,)).fetchone()[0]
        conn.execute("INSERT INTO memberships(group_id, library_id, order_index) VALUES(?,?,?)",
                     (group_id, library_id, order))
    return get_group(store, group_id)


def remove_member(store: Store, group_id: str, library_id: str) -> dict:
    with store.tx() as conn:
        _require_group(conn, group_id)
        conn.execute("DELETE FROM memberships WHERE group_id=? AND library_id=?", (group_id, library_id))
    return get_group(store, group_id)


# ---------------------------------------------------------------- 背景


def get_background(store: Store, subject_type: str, subject_id: str) -> dict:
    if subject_type not in ("group", "library"):
        raise Invalid("subject_type 只能是 group 或 library")
    with store.read() as conn:
        row = conn.execute("SELECT * FROM backgrounds WHERE subject_type=? AND subject_id=?",
                           (subject_type, subject_id)).fetchone()
    return {"subject_type": subject_type, "subject_id": subject_id,
            "text": row["text"] if row else "", "updated_at": row["updated_at"] if row else None}


def set_background(store: Store, subject_type: str, subject_id: str, text: str) -> dict:
    if subject_type not in ("group", "library"):
        raise Invalid("subject_type 只能是 group 或 library")
    with store.tx() as conn:
        if subject_type == "group":
            _require_group(conn, subject_id)
        elif conn.execute("SELECT 1 FROM libraries WHERE id=?", (subject_id,)).fetchone() is None:
            raise NotFound(f"资料库不存在：{subject_id}")
        conn.execute(
            "INSERT INTO backgrounds(subject_type, subject_id, text, updated_at) VALUES(?,?,?,?) "
            "ON CONFLICT(subject_type, subject_id) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at",
            (subject_type, subject_id, str(text or ""), now()))
    return get_background(store, subject_type, subject_id)


# ---------------------------------------------------------------- 内部


def _require_group(conn, group_id: str):
    row = conn.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
    if row is None:
        raise NotFound(f"组不存在：{group_id}")
    return row


def _ancestors(conn, group_id: str) -> set[str]:
    seen: set[str] = set()
    cursor = group_id
    while cursor and cursor not in seen:
        seen.add(cursor)
        row = conn.execute("SELECT parent_id FROM groups WHERE id=?", (cursor,)).fetchone()
        cursor = row["parent_id"] if row else None
    return seen


def _depth(conn, group_id: str) -> int:
    return len(_ancestors(conn, group_id))
