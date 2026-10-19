"""tasks：会话、运行与任务处理。

首期进程内串行执行。状态持久化，前端只订阅；失败/取消不冒充完成。
"""
from __future__ import annotations

import json
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

import artifacts, catalog, retrieval, templates
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
    if not resolved.library_ids:
        raise Conflict("范围内没有可用资料")

    with store.read() as conn:
        source_total = conn.execute(
            "SELECT COUNT(*) FROM sources WHERE archived_at IS NULL AND library_id IN (" +
            ",".join("?" for _ in resolved.library_ids) + ")",
            resolved.library_ids).fetchone()[0] if resolved.library_ids else 0
        as_of = now()

    # 背景随运行冻结：之后改背景不影响已建与进行中的运行
    backgrounds = []
    with store.read() as conn:
        name_of = {row["id"]: row["name"] for row in
                   conn.execute("SELECT id, name FROM libraries").fetchall()}
    for lib_id in resolved.library_ids:
        item = catalog.get_background(store, "library", lib_id)
        if item["text"].strip():
            backgrounds.append({"library_id": lib_id, "library_name": name_of.get(lib_id, lib_id),
                                "text": item["text"]})

    # 模板快照：之后改模板不影响这次运行；模板被删则不捏造，直接不带
    template = None
    if task["template_id"]:
        try:
            row = templates.get_template(store, task["template_id"])
        except NotFound:
            row = None
        if row:
            template = {"id": row["id"], "kind": row["kind"], "name": row["name"],
                        "version": row["version"], "body": row["body"]}

    payload = {
        "scope": {"kind": scope.kind, "id": scope.id},
        "resolved": {"library_ids": resolved.library_ids, "source_ids": resolved.source_ids,
                     "source_total": source_total},
        "backgrounds": backgrounds,
        "template": template,
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
        handler = {"research": _research, "extract": _extract, "review": _review}.get(
            run["kind"], _not_implemented)
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

    backgrounds = run["input"].get("backgrounds") or []
    if backgrounds:
        lines += ["## 范围背景（运行时冻结）", ""]
        for item in backgrounds:
            lines += [f"### {item['library_name']}", "", "> " + item["text"].strip().replace("\n", "\n> "), ""]

    citations = []
    for index, hit in enumerate(hits, start=1):
        excerpt = retrieval.excerpt(store, hit["version_id"], hit["position"])
        where = f"第 {hit['position']} 字符处" if hit["position"] is not None else "未定位到逐字位置"
        lines += [f"### {index}. {hit['title']}", "", f"- 位置：{where}", "",
                  "> " + (excerpt or "").replace("\n", "\n> "), ""]
        citations.append({"index": index, "source_id": hit["source_id"], "version_id": hit["version_id"],
                          "title": hit["title"], "quote": (excerpt or "")[:200],
                          "position": hit["position"]})
    snapshot = run["input"].get("template")
    if snapshot and snapshot.get("kind") == "research":
        lines += ["## 模板要求", "",
                  f"> 模板：{snapshot['name']}（v{snapshot.get('version', 1)}）", ""]
        for section in snapshot.get("body", {}).get("sections", []):
            lines += [f"- {section}", ""]

    if not hits:
        lines += ["范围内没有命中资料。", ""]

    body = "\n".join(lines).strip()
    artifact = artifacts.create(
        store, title=f"{task['title']} · 证据包", body_md=body, kind="evidence_pack",
        task_id=run["task_id"], run_id=run["id"], citations=citations, status="draft")
    return {"artifact_id": artifact["id"], "hits": len(hits),
            "versions": [item["version_id"] for item in citations],
            "resolved_libraries": resolved["library_ids"]}


def _query_of(store: Store, task: dict, run: dict) -> str:
    """检索词优先级：任务目标 > 任务里最后一条用户消息。"""
    if (task.get("goal") or "").strip():
        return task["goal"].strip()
    with store.read() as conn:
        row = conn.execute("SELECT content FROM messages WHERE task_id=? AND role='user' "
                           "ORDER BY created_at DESC LIMIT 1", (run["task_id"],)).fetchone()
    return row["content"] if row else ""


def _extract(store: Store, run: dict) -> dict:
    """按模板字段给每份命中资料一个候选定位；取值留给人工或后续模型，不冒充提取结果。"""
    scope = Scope.parse(run["input"]["scope"])
    task = get_task(store, run["task_id"])
    snapshot = run["input"].get("template")
    if snapshot and snapshot["kind"] != "extract":
        raise Conflict(f"模板「{snapshot['name']}」不是 extract 模板")
    if not snapshot:
        raise Invalid("extract 运行需要指定 extract 模板")
    fields = snapshot["body"]["fields"]
    missing_policy = snapshot["body"].get("missing_policy") or "留空并说明"

    query = _query_of(store, task, run)
    hits = retrieval.search(store, scope, query, limit=12) if query else []

    lines = ["> 本次运行未接模型：以下是按模板字段给出的候选定位，取值待确认，不是提取结果。", "",
             f"## 提取：{query or '（未提供检索词）'}", "",
             f"- 模板：{snapshot['name']}（v{snapshot.get('version', 1)}）",
             f"- 字段缺失处理：{missing_policy}", ""]
    citations = []
    rows = []

    if not hits:
        lines += ["范围内没有命中资料，候选表为空。", ""]
    for hit in hits:
        excerpt = retrieval.excerpt(store, hit["version_id"], hit["position"], length=180)
        where = f"第 {hit['position']} 字符处" if hit["position"] is not None else "未定位"
        lines += [f"### {hit['title']}", "", f"- 候选位置：{where}", "",
                  "> " + (excerpt or "").replace("\n", "\n> ").replace("\n", " "), ""]
        for field in fields:
            lines += [f"- `{field['name']}`（粒度 {field['granularity']}）：待确认"
                      + (f" —— {field['desc']}" if field.get("desc") else "")]
        lines += [""]
        citations.append({"index": len(citations) + 1, "source_id": hit["source_id"],
                          "version_id": hit["version_id"], "title": hit["title"],
                          "quote": (excerpt or "")[:200], "position": hit["position"]})
        rows.append({"source_id": hit["source_id"], "title": hit["title"],
                     "fields": [item["name"] for item in fields]})

    artifact = artifacts.create(
        store, title=f"{task['title']} · 提取候选", body_md="\n".join(lines).strip(),
        kind="note", task_id=run["task_id"], run_id=run["id"], citations=citations,
        status="draft")
    return {"artifact_id": artifact["id"], "hits": len(hits),
            "versions": [item["version_id"] for item in citations],
            "resolved_libraries": run["input"]["resolved"]["library_ids"], "rows": len(rows)}


def _review(store: Store, run: dict) -> dict:
    """检查清单：能靠数据判定的判定，其余诚实标未验证。"""
    scope = Scope.parse(run["input"]["scope"])
    task = get_task(store, run["task_id"])
    snapshot = run["input"].get("template")
    if snapshot and snapshot["kind"] != "review":
        raise Conflict(f"模板「{snapshot['name']}」不是 review 模板")
    checks = snapshot["body"]["checks"] if snapshot else []
    if not checks:
        raise Invalid("review 运行需要带检查项的 review 模板")

    resolved = run["input"]["resolved"]
    query = _query_of(store, task, run)
    hits = retrieval.search(store, scope, query, limit=8) if query else []

    # 判定依据：命中资料的索引状态 + 是否都能给出可定位引用
    citations, unlocatable, not_searchable = [], 0, 0
    with store.read() as conn:
        status_of = {row["id"]: row["status"] for row in conn.execute(
            "SELECT id, status FROM sources").fetchall()}
    for hit in hits:
        if hit["position"] is None:
            unlocatable += 1
        if status_of.get(hit["source_id"], "indexed") != "indexed":
            not_searchable += 1
        excerpt = retrieval.excerpt(store, hit["version_id"], hit["position"], length=160)
        citations.append({"index": len(citations) + 1, "source_id": hit["source_id"],
                          "version_id": hit["version_id"], "title": hit["title"],
                          "quote": (excerpt or "")[:200], "position": hit["position"]})

    lines = ["> 本次运行未接模型：能判定的已判定，判定不了的标「未验证」，不给结论。", "",
             f"## 审查：{query or '（未提供检索词）'}", "",
             f"- 模板：{snapshot['name']}（v{snapshot.get('version', 1)}）",
             f"- 范围内命中 {len(hits)} 份资料", ""]

    verdicts = []
    for check in checks:
        item, basis = check["item"], check.get("basis") or ""
        looks_traceable = "引用" in item or "引用" in basis or "citation" in basis
        looks_status = "仅登记" in item or "状态" in item or "status" in basis
        if looks_traceable:
            ok = hits and unlocatable == 0
            verdict = "通过" if ok else "存疑"
            detail = ("每条命中都能给出逐字位置" if ok
                      else f"{unlocatable} 份命中无法定位到逐字位置")
        elif looks_status:
            ok = not_searchable == 0
            verdict = "通过" if ok else "存疑"
            detail = ("引用的资料都可检索" if ok
                      else f"{not_searchable} 份被引资料不可检索（多为扫描件）")
        else:
            verdict = "未验证"
            detail = "需要模型或人工判断，本次不判定"
        verdicts.append({"item": item, "severity": check["severity"], "verdict": verdict,
                         "detail": detail})
        lines += [f"- [{verdict}] {item}（{check['severity']}）—— {detail}"]
    lines += [""]

    for citation in citations:
        lines += [f"> [{citation['index']}] {citation['title']}"
                  + (f"（第 {citation['position']} 字符）" if citation["position"] is not None else ""),
                  ">"]

    artifact = artifacts.create(
        store, title=f"{task['title']} · 审查记录", body_md="\n".join(lines).strip(),
        kind="review", task_id=run["task_id"], run_id=run["id"], citations=citations,
        status="draft")
    return {"artifact_id": artifact["id"], "hits": len(hits),
            "versions": [item["version_id"] for item in citations],
            "resolved_libraries": resolved["library_ids"], "verdicts": verdicts}


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
