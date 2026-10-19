"""tasks：会话、运行与任务处理。

首期进程内串行执行。状态持久化，前端只订阅；失败/取消不冒充完成。
"""
from __future__ import annotations

import json
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

import artifacts, retrieval
from errors import Conflict, Invalid, NotFound
from models import Scope
from storage import Store, new_id, now

QUEUED, RUNNING, CANCELLING = "queued", "running", "cancelling"
DONE, FAILED, CANCELLED, INTERRUPTED = "done", "failed", "cancelled", "interrupted"
TERMINAL = {DONE, FAILED, CANCELLED, INTERRUPTED}
KINDS = ("research", "extract", "review", "background")

_pool: ThreadPoolExecutor | None = None
_lock = threading.Lock()


def _executor() -> ThreadPoolExecutor:
    global _pool
    with _lock:
        if _pool is None:
            _pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="heli-run")
        return _pool


# ---------------------------------------------------------------- 任务


def create_task(store: Store, *, title: str, goal: str = "", scope: dict | None = None,
                template_id: str | None = None) -> dict:
    name = str(title or "").strip()
    if not name:
        raise Invalid("任务标题不能为空")
    task_id = new_id("task")
    stamp = now()
    with store.tx() as conn:
        conn.execute("INSERT INTO tasks(id, title, goal, scope_json, template_id, created_at, updated_at) "
                     "VALUES(?,?,?,?,?,?,?)",
                     (task_id, name, str(goal or ""), json.dumps(scope or {"kind": "all"}, ensure_ascii=False),
                      template_id, stamp, stamp))
    return get_task(store, task_id)


def list_tasks(store: Store) -> list[dict]:
    with store.read() as conn:
        rows = conn.execute("SELECT * FROM tasks ORDER BY updated_at DESC").fetchall()
    return [{"id": row["id"], "title": row["title"], "goal": row["goal"],
             "scope": json.loads(row["scope_json"]), "template_id": row["template_id"],
             "created_at": row["created_at"], "updated_at": row["updated_at"]} for row in rows]


def get_task(store: Store, task_id: str) -> dict:
    with store.read() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if row is None:
            raise NotFound(f"任务不存在：{task_id}")
        messages = [dict(item) for item in conn.execute(
            "SELECT id, role, content, created_at FROM messages WHERE task_id=? ORDER BY created_at", (task_id,))]
        runs = [{"id": item["id"], "task_id": item["task_id"], "kind": item["kind"],
                 "status": item["status"], "error": item["error"],
                 "input": _loads(item["input_json"], {}), "output": _loads(item["output_json"], {}),
                 "created_at": item["created_at"], "started_at": item["started_at"],
                 "finished_at": item["finished_at"]}
                for item in conn.execute(
                    "SELECT * FROM runs WHERE task_id=? ORDER BY created_at", (task_id,))]
        artifacts_rows = [{"id": item["id"], "title": item["title"], "kind": item["kind"],
                           "status": item["status"], "revision": item["revision"]}
                          for item in conn.execute(
                              "SELECT * FROM artifacts WHERE task_id=? ORDER BY updated_at DESC", (task_id,))]
    return {"id": row["id"], "title": row["title"], "goal": row["goal"],
            "scope": json.loads(row["scope_json"]), "template_id": row["template_id"],
            "created_at": row["created_at"], "updated_at": row["updated_at"],
            "messages": messages, "runs": runs, "artifacts": artifacts_rows}


def add_message(store: Store, task_id: str, content: str, role: str = "user") -> dict:
    text = str(content or "").strip()
    if not text:
        raise Invalid("消息不能为空")
    if role not in ("user", "assistant"):
        raise Invalid("role 只能是 user 或 assistant")
    with store.tx() as conn:
        if conn.execute("SELECT 1 FROM tasks WHERE id=?", (task_id,)).fetchone() is None:
            raise NotFound(f"任务不存在：{task_id}")
        message_id = new_id("msg")
        conn.execute("INSERT INTO messages(id, task_id, role, content, created_at) VALUES(?,?,?,?,?)",
                     (message_id, task_id, role, text, now()))
        conn.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now(), task_id))
    return {"id": message_id, "task_id": task_id, "role": role, "content": text}


# ---------------------------------------------------------------- 运行


def start_run(store: Store, task_id: str, kind: str = "research") -> dict:
    if kind not in KINDS:
        raise Invalid(f"未知运行类型：{kind}")
    task = get_task(store, task_id)
    scope = Scope.parse(task["scope"])
    resolved = retrieval.resolve_scope(store, scope)
    if not resolved.library_ids and kind == "research":
        raise Conflict("范围内没有可用资料")

    with store.read() as conn:
        source_total = conn.execute(
            "SELECT COUNT(*) FROM sources WHERE archived_at IS NULL AND library_id IN (" +
            ",".join("?" for _ in resolved.library_ids) + ")",
            resolved.library_ids).fetchone()[0] if resolved.library_ids else 0
        as_of = now()

    payload = {
        "scope": {"kind": scope.kind, "id": scope.id},
        "resolved": {"library_ids": resolved.library_ids, "source_ids": resolved.source_ids,
                     "source_total": source_total},
        "as_of": as_of,
        "template_id": task["template_id"],
        "model_channel": "none",
    }
    run_id = new_id("run")
    with store.tx() as conn:
        conn.execute("INSERT INTO runs(id, task_id, kind, status, input_json, created_at) "
                     "VALUES(?,?,?,?,?,?)",
                     (run_id, task_id, kind, QUEUED, json.dumps(payload, ensure_ascii=False), now()))
    _executor().submit(_execute, store, run_id)
    return get_run(store, run_id)


def get_run(store: Store, run_id: str) -> dict:
    with store.read() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    if row is None:
        raise NotFound(f"运行不存在：{run_id}")
    return {"id": row["id"], "task_id": row["task_id"], "kind": row["kind"], "status": row["status"],
            "input": json.loads(row["input_json"]), "output": json.loads(row["output_json"]),
            "error": row["error"], "started_at": row["started_at"], "finished_at": row["finished_at"],
            "created_at": row["created_at"]}


def cancel_run(store: Store, run_id: str) -> dict:
    run = get_run(store, run_id)
    if run["status"] in TERMINAL:
        return run
    with store.tx() as conn:
        if run["status"] == RUNNING:
            conn.execute("UPDATE runs SET status=? WHERE id=?", (CANCELLING, run_id))
        else:
            conn.execute("UPDATE runs SET status=?, finished_at=? WHERE id=?",
                         (CANCELLED, now(), run_id))
    return get_run(store, run_id)


def recover(store: Store) -> dict:
    """启动时把上次未结束的运行标为中断；不静默重跑。"""
    with store.tx() as conn:
        rows = conn.execute("SELECT id FROM runs WHERE status IN (?,?,?)",
                            (QUEUED, RUNNING, CANCELLING)).fetchall()
        for row in rows:
            conn.execute("UPDATE runs SET status=?, finished_at=?, error=COALESCE(error, ?) WHERE id=?",
                         (INTERRUPTED, now(), "进程退出时未完成", row["id"]))
    return {"interrupted": len(rows)}


# ---------------------------------------------------------------- 执行


def _execute(store: Store, run_id: str) -> None:
    try:
        run = get_run(store, run_id)
        if run["status"] != QUEUED:
            return
        with store.tx() as conn:
            conn.execute("UPDATE runs SET status=?, started_at=? WHERE id=?", (RUNNING, now(), run_id))
        if _cancelling(store, run_id):
            _finish(store, run_id, CANCELLED)
            return
        handler = {"research": _research}.get(run["kind"], _not_implemented)
        output = handler(store, run)
        if _cancelling(store, run_id):
            _finish(store, run_id, CANCELLED, output=output)
            return
        _finish(store, run_id, DONE, output=output)
    except Exception as error:  # 失败必须留痕，不吞
        traceback.print_exc()
        _finish(store, run_id, FAILED, error=str(error))


def _research(store: Store, run: dict) -> dict:
    resolved = run["input"]["resolved"]
    scope = Scope.parse(run["input"]["scope"])
    task = get_task(store, run["task_id"])
    query = (task["goal"] or "").strip()
    if not query:
        with store.read() as conn:
            row = conn.execute("SELECT content FROM messages WHERE task_id=? AND role='user' "
                               "ORDER BY created_at DESC LIMIT 1", (run["task_id"],)).fetchone()
        query = row["content"] if row else ""

    hits = retrieval.search(store, scope, query, limit=8) if query else []
    lines = ["> 本次运行未接模型：以下是检索证据，不是结论。", "",
             f"## 检索：{query or '（未提供检索词）'}", ""]
    citations = []
    for index, hit in enumerate(hits, start=1):
        excerpt = retrieval.excerpt(store, hit["version_id"], hit["position"])
        where = f"第 {hit['position']} 字符处" if hit["position"] is not None else "未定位到逐字位置"
        lines += [f"### {index}. {hit['title']}", "", f"- 位置：{where}", "",
                  "> " + (excerpt or "").replace("\n", "\n> "), ""]
        citations.append({"index": index, "source_id": hit["source_id"], "version_id": hit["version_id"],
                          "title": hit["title"], "quote": (excerpt or "")[:200],
                          "position": hit["position"]})
    if not hits:
        lines += ["范围内没有命中资料。", ""]

    body = "\n".join(lines).strip()
    artifact = artifacts.create(
        store, title=f"{task['title']} · 证据包", body_md=body, kind="evidence_pack",
        task_id=run["task_id"], run_id=run["id"], citations=citations, status="draft")
    return {"artifact_id": artifact["id"], "hits": len(hits),
            "versions": [item["version_id"] for item in citations],
            "resolved_libraries": resolved["library_ids"]}


def _not_implemented(store: Store, run: dict) -> dict:
    raise NotImplementedError(f"运行类型尚未实现：{run['kind']}")


def _cancelling(store: Store, run_id: str) -> bool:
    with store.read() as conn:
        row = conn.execute("SELECT status FROM runs WHERE id=?", (run_id,)).fetchone()
    return bool(row) and row["status"] == CANCELLING


def _loads(text: str, fallback):
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return fallback


def _finish(store: Store, run_id: str, status: str, *, output: dict | None = None, error: str | None = None) -> None:
    with store.tx() as conn:
        conn.execute("UPDATE runs SET status=?, output_json=?, error=?, finished_at=? WHERE id=?",
                     (status, json.dumps(output or {}, ensure_ascii=False), error, now(), run_id))
