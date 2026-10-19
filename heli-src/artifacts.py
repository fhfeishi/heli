"""artifacts：成果保存、修订与导出。"""
from __future__ import annotations

from errors import Invalid, NotFound
from storage import Store, new_id, now

KINDS = ("report", "note", "comparison", "review", "evidence_pack")
STATUSES = ("draft", "review", "done")


def create(store: Store, *, title: str, body_md: str = "", kind: str = "report",
           task_id: str | None = None, run_id: str | None = None,
           citations: list | None = None, status: str = "draft") -> dict:
    name = str(title or "").strip()
    if not name:
        raise Invalid("成果标题不能为空")
    if kind not in KINDS:
        raise Invalid(f"未知成果类型：{kind}")
    if status not in STATUSES:
        raise Invalid(f"未知成果状态：{status}")
    artifact_id = new_id("art")
    stamp = now()
    with store.tx() as conn:
        conn.execute(
            "INSERT INTO artifacts(id, task_id, run_id, title, kind, status, body_md, citations_json, "
            "revision, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (artifact_id, task_id, run_id, name, kind, status, str(body_md or ""),
             _json(citations or []), 1, stamp, stamp))
        conn.execute(
            "INSERT INTO artifact_revisions(id, artifact_id, revision, body_md, citations_json, created_at) "
            "VALUES(?,?,?,?,?,?)",
            (new_id("rev"), artifact_id, 1, str(body_md or ""), _json(citations or []), stamp))
    return get(store, artifact_id)


def get(store: Store, artifact_id: str) -> dict:
    with store.read() as conn:
        row = conn.execute("SELECT * FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
        if row is None:
            raise NotFound(f"成果不存在：{artifact_id}")
        revisions = [item["revision"] for item in conn.execute(
            "SELECT revision FROM artifact_revisions WHERE artifact_id=? ORDER BY revision", (artifact_id,))]
    return {"id": row["id"], "task_id": row["task_id"], "run_id": row["run_id"], "title": row["title"],
            "kind": row["kind"], "status": row["status"], "body_md": row["body_md"],
            "citations": _loads(row["citations_json"], []), "revision": row["revision"],
            "revisions": revisions, "created_at": row["created_at"], "updated_at": row["updated_at"]}


def update(store: Store, artifact_id: str, *, title=None, body_md=None, status=None, citations=None) -> dict:
    current = get(store, artifact_id)
    revision = current["revision"] + 1
    body = current["body_md"] if body_md is None else str(body_md)
    cites = current["citations"] if citations is None else citations
    if status is not None and status not in STATUSES:
        raise Invalid(f"未知成果状态：{status}")
    with store.tx() as conn:
        conn.execute(
            "UPDATE artifacts SET title=?, body_md=?, status=?, citations_json=?, revision=?, updated_at=? "
            "WHERE id=?",
            (str(title).strip() if title else current["title"], body,
             status or current["status"], _json(cites), revision, now(), artifact_id))
        conn.execute(
            "INSERT INTO artifact_revisions(id, artifact_id, revision, body_md, citations_json, created_at) "
            "VALUES(?,?,?,?,?,?)",
            (new_id("rev"), artifact_id, revision, body, _json(cites), now()))
    return get(store, artifact_id)


def list_artifacts(store: Store, task_id: str | None = None) -> list[dict]:
    sql = "SELECT * FROM artifacts" + (" WHERE task_id=?" if task_id else "") + " ORDER BY updated_at DESC"
    with store.read() as conn:
        rows = conn.execute(sql, ((task_id,) if task_id else ())).fetchall()
    return [{"id": row["id"], "task_id": row["task_id"], "run_id": row["run_id"], "title": row["title"],
             "kind": row["kind"], "status": row["status"], "revision": row["revision"],
             "updated_at": row["updated_at"]} for row in rows]


def export_markdown(store: Store, artifact_id: str) -> str:
    artifact = get(store, artifact_id)
    lines = [f"# {artifact['title']}", ""]
    lines.append(f"> 状态：{artifact['status']}　修订：v{artifact['revision']}　更新：{artifact['updated_at']}")
    lines.append("")
    lines.append(artifact["body_md"].strip())
    citations = artifact["citations"]
    if citations:
        lines += ["", "---", "", "## 引用来源", ""]
        for item in citations:
            position = item.get("position")
            where = f"第 {position} 字符处" if isinstance(position, int) else "未定位"
            lines.append(f"{item.get('index', '?')}. **{item.get('title', '')}** — {where}")
    return "\n".join(lines).rstrip() + "\n"


def _json(value) -> str:
    import json
    return json.dumps(value, ensure_ascii=False)


def _loads(text: str, fallback):
    import json
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return fallback
