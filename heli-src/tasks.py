"""tasks：会话、运行与任务处理。

首期进程内串行执行。状态持久化，前端只订阅；失败/取消不冒充完成。
"""
from __future__ import annotations

import json
import re
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

import artifacts, catalog, config, llm, retrieval, templates
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


def shutdown(wait: bool = False) -> None:
    """退出前收掉线程池。默认不等运行中的任务——Ctrl+C 必须当场返回，
    否则解释器退出时会 join 非守护线程，进程卡住、端口继续被占。"""
    global _pool
    with _lock:
        pool, _pool = _pool, None
    if pool is not None:
        pool.shutdown(wait=wait, cancel_futures=True)


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
    """任务摘要。带上最新运行状态与产出数——列表页要能一眼看出「跑完没有」。"""
    with store.read() as conn:
        rows = conn.execute("SELECT * FROM tasks ORDER BY updated_at DESC").fetchall()
        latest = {row["task_id"]: {"id": row["id"], "kind": row["kind"], "status": row["status"],
                                   "finished_at": row["finished_at"]}
                  for row in conn.execute(
                      "SELECT r.task_id, r.id, r.kind, r.status, r.finished_at FROM runs r "
                      "WHERE r.created_at = (SELECT MAX(created_at) FROM runs WHERE task_id = r.task_id)"
                  ).fetchall()}
        counts = {row["task_id"]: row["total"] for row in conn.execute(
            "SELECT task_id, COUNT(*) AS total FROM artifacts WHERE task_id IS NOT NULL "
            "GROUP BY task_id").fetchall()}
    return [{"id": row["id"], "title": row["title"], "goal": row["goal"],
             "scope": json.loads(row["scope_json"]), "template_id": row["template_id"],
             "created_at": row["created_at"], "updated_at": row["updated_at"],
             "last_run": latest.get(row["id"]), "artifact_count": counts.get(row["id"], 0)}
            for row in rows]


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
        "model_channel": config.llm_config().label,
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


# ---------------------------------------------------------------- 模型通道
#
# 纪律：模型只能依据我们给的摘录作答。输出里的引用会被逐条核查，
# 编造的序号与编造的引文都要暴露在运行记录里，不能靠「看起来像」过关。

_SYSTEM_RESEARCH = """你是 heli 的资料研究助手。你只能依据用户给出的「资料摘录」作答，不能用摘录之外的知识补充事实。

规则：
1. 每条事实性陈述后用 [n] 标注来源，n 必须是给出的摘录序号；不要编造序号。
2. 摘录不足以支撑判断时，直接写「现有资料不足以判断：<缺什么>」，不要猜测。
3. 明确区分「资料明确说的」与「你的推断」，推断要标注（推断）。
4. 输出中文 Markdown，直接从结论开始，不要写「根据您提供的资料」这类开场套话。
5. 不要复述摘录原文，要归纳、对比、指出冲突与空白。"""

_SYSTEM_EXTRACT = """你是 heli 的资料提取助手。只能依据给出的摘录抽取字段值：
- 摘录里没有的字段一律填 null，不要用常识补全。
- 每个非空值必须附带摘录里的原文片段作为证据（逐字复制，不要改写）。
- 输出严格的 JSON，不要加解释文字。"""

_SYSTEM_REVIEW = """你是 heli 的资料审查助手。只能依据给出的摘录判断检查项：
- 证据不足就判「未验证」，不要为了给结论而推测。
- 判「通过」或「存疑」时必须写出依据，并标注引用的摘录序号。
- 输出严格的 JSON，不要加解释文字。"""

_CITE_PATTERN = re.compile(r"\[(\d{1,3})\]")


def _collect_citations(store: Store, hits: list, length: int = 1400,
                       with_head: bool = False) -> list[dict]:
    """把检索命中整理成模型可用的证据：带库名、定位与摘录。

    with_head=True 时把文档开头 600 字拼在摘录前——项目名称/负责人/研究期限
    这类字段在 frontmatter 里，只取命中位置会整片缺失（实测提取会大面积「未找到」）。
    """
    if not hits:
        return []
    ids = sorted({hit["library_id"] for hit in hits})
    marks = ",".join("?" for _ in ids)
    with store.read() as conn:
        name_of = {row["id"]: row["name"] for row in conn.execute(
            f"SELECT id, name FROM libraries WHERE id IN ({marks})", tuple(ids)).fetchall()}
    items = []
    for index, hit in enumerate(hits, start=1):
        excerpt = retrieval.excerpt(store, hit["version_id"], hit["position"], length=length) or ""
        if with_head:
            head = (retrieval.read(store, hit["version_id"])["text"] or "")[:600]
            if head and head[:80] not in excerpt:
                excerpt = head + "\n…\n" + excerpt
        items.append({
            "index": index,
            "source_id": hit["source_id"],
            "version_id": hit["version_id"],
            "title": hit["title"],
            "library": name_of.get(hit["library_id"], hit["library_id"]),
            "position": hit["position"],
            "excerpt": excerpt,
        })
    return items


def _evidence_block(citations: list[dict], per: int = 1400) -> str:
    blocks = []
    for item in citations:
        where = f"第 {item['position']} 字符处" if item["position"] is not None else "未定位到逐字位置"
        excerpt = llm.budget(item["excerpt"], per).replace("\n", "\n> ")
        blocks.append(f"### [{item['index']}] 《{item['title']}》\n"
                      f"库：{item['library']}　定位：{where}\n\n> {excerpt}")
    return "\n\n".join(blocks) if blocks else "（本次没有命中资料）"


def _background_block(run: dict, per: int = 1000) -> str:
    items = run["input"].get("backgrounds") or []
    if not items:
        return ""
    lines = ["## 范围背景（用户维护，运行时冻结）", ""]
    for item in items:
        lines += [f"### {item['library_name']}", "",
                  "> " + llm.budget(item["text"], per).replace("\n", "\n> "), ""]
    return "\n".join(lines)


def _citation_check(text: str, total: int) -> dict:
    """核查正文里的引用序号：越界的就是编造，必须暴露。"""
    used = sorted({int(match) for match in _CITE_PATTERN.findall(text or "")})
    valid = [index for index in used if 1 <= index <= total]
    invalid = [index for index in used if index < 1 or index > total]
    return {"cited": used, "invalid": invalid, "ok": bool(valid) and not invalid,
            "uncited_sources": total - len(valid)}


def _citation_payload(citations: list[dict]) -> list[dict]:
    return [{"index": item["index"], "source_id": item["source_id"], "version_id": item["version_id"],
             "title": item["title"], "quote": (item["excerpt"] or "")[:200],
             "position": item["position"]} for item in citations]


def _sources_block(citations: list[dict]) -> str:
    if not citations:
        return ""
    # 逐条成行必须是列表：单换行在 Markdown 里会被合并成一段，
    # 十几条引用挤成一块没法扫读。
    lines = ["## 来源", ""]
    for item in citations:
        where = f"，第 {item['position']} 字符" if item["position"] is not None else ""
        lines.append(f"- [{item['index']}] 《{item['title']}》 —— {item['library']}{where}")
    return "\n".join(lines)


def _model_header(result: llm.Result, check: dict | None = None, note: str = "") -> str:
    usage = result.usage or {}
    tokens = ""
    if usage:
        tokens = (f"，提示 {usage.get('prompt_tokens', '?')} / 生成 "
                  f"{usage.get('completion_tokens', '?')} tokens")
    lines = [f"> 由 `{result.model}` 生成（{result.latency_ms} ms{tokens}）。"
             "模型只依据下方来源作答，未经人工复核——引用前请自行核对。"]
    if check and check.get("invalid"):
        lines += [">", "> ⚠️ 正文引用了不存在的来源序号：" +
                  "、".join(f"[{number}]" for number in check["invalid"]) + "，这些标注不可信。"]
    if check and check.get("uncited_sources"):
        lines += [">", f"> 另有 {check['uncited_sources']} 条来源未被正文引用。"]
    if note:
        lines += [">", "> " + note]
    return "\n".join(lines)


def _normalize_for_match(text: str) -> str:
    return re.sub(r"\s+", "", str(text or ""))


def _quote_found(quote: str, excerpt: str) -> bool:
    """引文核对：忽略空白后做子串匹配；长引文退化到前 24 字，容忍模型截断。"""
    needle = _normalize_for_match(quote)
    haystack = _normalize_for_match(excerpt)
    if not needle or not haystack:
        return False
    if needle in haystack:
        return True
    return len(needle) >= 12 and needle[:24] in haystack


def _json_object(result: "llm.Result", label: str) -> dict:
    """取模型的 JSON 输出。宁可让运行失败留痕，也不静默产出空结果。

    模型偶尔会把 JSON 包在 ``` 里，或者被 max_tokens 截断——后者必须当成失败，
    因为它给出的是一份不完整的表，看起来却像是「没抽到东西」。
    """
    if result.truncated:
        raise ValueError(f"模型输出被 max_tokens 截断，{label}结果不完整；"
                         "调高 HELI_LLM_MAX_TOKENS 或改用 deepseek-chat")
    raw = str(result.text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    try:
        data = json.loads(raw)
    except ValueError:
        raise ValueError(f"模型返回的{label}结果不是合法 JSON：{raw[:240]}") from None
    if not isinstance(data, dict):
        raise ValueError(f"模型返回的{label}结果是 {type(data).__name__}，不是 JSON 对象")
    return data


def _review_facts(store: Store, hits: list) -> dict:
    """能靠数据判定的部分：命中是否可定位、被引资料是否可检索。"""
    with store.read() as conn:
        status_of = {row["id"]: row["status"] for row in conn.execute(
            "SELECT id, status FROM sources").fetchall()}
    return {"hits": len(hits),
            "unlocatable": sum(1 for hit in hits if hit["position"] is None),
            "not_searchable": sum(1 for hit in hits
                                  if status_of.get(hit["source_id"], "indexed") != "indexed")}

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


def _research_prompt(query: str, run: dict, citations: list[dict]) -> str:
    snapshot = run["input"].get("template")
    sections = []
    if snapshot and snapshot.get("kind") == "research":
        sections = list(snapshot.get("body", {}).get("sections") or [])
    parts = [f"## 研究目标\n\n{query or '（任务没写目标，按资料内容给出概览）'}", ""]
    background = _background_block(run)
    if background:
        parts += [background, ""]
    parts += [f"## 资料摘录（共 {len(citations)} 条，方括号是引用序号，背景不计序号）", "",
              _evidence_block(citations), ""]
    if sections:
        parts += ["## 要求的结构", ""] + [f"- {name}" for name in sections] + [""]
    parts += ["## 收尾", "",
              "正文最后必须有「## 未能回答」小节，列出现有资料无法支撑的问题与缺口。"]
    return "\n".join(parts)


def _research(store: Store, run: dict) -> dict:
    """research：有模型出真结论（带引用核查），没模型退回证据包草稿。"""
    scope = Scope.parse(run["input"]["scope"])
    resolved = run["input"]["resolved"]
    task = get_task(store, run["task_id"])
    cfg = config.llm_config()
    if not cfg.available:
        return _research_draft(store, run)

    query = _query_of(store, task, run)
    hits = retrieval.search(store, scope, query, limit=8) if query else []
    citations = _collect_citations(store, hits)

    result = llm.chat(
        [{"role": "system", "content": _SYSTEM_RESEARCH},
         {"role": "user", "content": _research_prompt(query, run, citations)}],
        cfg=cfg, temperature=0.25, max_tokens=3200)

    check = _citation_check(result.text, len(citations))
    parts = [_model_header(result, check), "", result.text]
    sources = _sources_block(citations)
    if sources:
        parts += ["", sources]
    artifact = artifacts.create(
        store, title=f"{task['title']} · 研究报告", body_md="\n".join(parts).strip(),
        kind="report", task_id=run["task_id"], run_id=run["id"],
        citations=_citation_payload(citations), status="draft")
    return {"artifact_id": artifact["id"], "hits": len(hits), "mode": "model",
            "llm": result.brief(), "citation_check": check,
            "versions": [item["version_id"] for item in citations],
            "resolved_libraries": resolved["library_ids"]}


def _extract_prompt(query: str, fields: list[dict], missing_policy: str,
                    citations: list[dict]) -> str:
    field_lines = []
    for field in fields:
        desc = f"：{field['desc']}" if field.get("desc") else ""
        field_lines.append(f"- {field['name']}（粒度 {field['granularity']}{desc}）")
    schema = ('{"rows": [{"source_index": 1, "title": "资料标题", "values": '
              '{"字段名": {"value": "抽到的值或 null", "quote": "摘录里的逐字原文"}}}], '
              '"notes": "整体说明与缺失情况"}')
    return "\n".join([
        f"## 任务目标\n\n{query or '（未写目标，按资料主题抽取）'}", "",
        "## 要抽取的字段", "", "\n".join(field_lines), "",
        f"## 缺失处理\n\n{missing_policy}", "",
        f"## 资料摘录（共 {len(citations)} 条）", "",
        _evidence_block(citations, per=1100), "",
        "## 输出 JSON", "", schema, "",
        "要求：source_index 必须是摘录序号；value 为 null 时 quote 留空；"
        "quote 必须逐字来自对应那条摘录，不要改写或拼接。",
    ])


def _extract(store: Store, run: dict) -> dict:
    """extract：有模型按字段真提取（逐条核对引文），没模型退回候选定位表。"""
    scope = Scope.parse(run["input"]["scope"])
    task = get_task(store, run["task_id"])
    snapshot = run["input"].get("template")
    if snapshot and snapshot["kind"] != "extract":
        raise Conflict(f"模板「{snapshot['name']}」不是 extract 模板")
    if not snapshot:
        raise Invalid("extract 运行需要指定 extract 模板")
    cfg = config.llm_config()
    if not cfg.available:
        return _extract_draft(store, run)

    fields = snapshot["body"]["fields"]
    missing_policy = snapshot["body"].get("missing_policy") or "留空并说明"
    query = _query_of(store, task, run)
    hits = retrieval.search(store, scope, query, limit=10) if query else []
    citations = _collect_citations(store, hits, length=1200, with_head=True)

    result = llm.chat(
        [{"role": "system", "content": _SYSTEM_EXTRACT},
         {"role": "user", "content": _extract_prompt(query, fields, missing_policy, citations)}],
        cfg=cfg, temperature=0.1, max_tokens=4000, json_mode=True)
    payload = _json_object(result, "提取")
    rows = payload.get("rows") or []
    audit = _verify_rows(rows, citations)

    lines = [_model_header(result, None,
                           f"逐字段核对引文：{audit['checked']} 条可核对，"
                           f"{audit['fabricated']} 条在摘录里找不到原文（标 ⚠️）。"),
             "", f"## 提取：{query or '（未提供检索词）'}", "",
             f"- 模板：{snapshot['name']}（v{snapshot.get('version', 1)}）",
             f"- 字段缺失处理：{missing_policy}", ""]
    if not rows:
        lines += ["模型没有返回任何行。", ""]
    for row in rows:
        index = row.get("source_index")
        title = row.get("title") or _title_of(citations, index) or f"资料 {index}"
        lines += [f"### [{index}] {title}", ""]
        values = row.get("values") or {}
        for field in fields:
            cell = values.get(field["name"])
            if not isinstance(cell, dict):
                lines.append(f"- **{field['name']}**：未返回（按「{missing_policy}」处理）")
                continue
            value = cell.get("value")
            if value in (None, "", "null"):
                lines.append(f"- **{field['name']}**：未找到")
                continue
            mark = " ⚠️ 引文未在摘录中找到" if cell.get("verified") is False else ""
            quote = str(cell.get("quote") or "").strip()
            hint = f" —— 「{quote}」" if quote else ""
            shown = "；".join(str(part) for part in value) if isinstance(value, list) else str(value)
            lines.append(f"- **{field['name']}**：{shown}{hint}{mark}")
        lines.append("")
    if payload.get("notes"):
        lines += ["## 说明", "", str(payload["notes"]), ""]
    sources = _sources_block(citations)
    if sources:
        lines += [sources, ""]

    artifact = artifacts.create(
        store, title=f"{task['title']} · 提取结果", body_md="\n".join(lines).strip(),
        kind="note", task_id=run["task_id"], run_id=run["id"],
        citations=_citation_payload(citations), status="draft")
    return {"artifact_id": artifact["id"], "hits": len(hits), "mode": "model",
            "llm": result.brief(), "rows": len(rows), "extract_audit": audit,
            "versions": [item["version_id"] for item in citations],
            "resolved_libraries": run["input"]["resolved"]["library_ids"]}


def _title_of(citations: list[dict], index) -> str:
    for item in citations:
        if item["index"] == index:
            return item["title"]
    return ""


def _verify_rows(rows: list[dict], citations: list[dict]) -> dict:
    """逐字段核对模型给的 quote 是否真在对应摘录里——防编造。"""
    excerpt_of = {item["index"]: item["excerpt"] for item in citations}
    checked = fabricated = filled = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        excerpt = excerpt_of.get(row.get("source_index"), "")
        values = row.get("values") or {}
        if not isinstance(values, dict):
            continue
        for cell in values.values():
            if not isinstance(cell, dict):
                continue
            value = cell.get("value")
            if value in (None, "", "null"):
                continue
            filled += 1
            quote = str(cell.get("quote") or "").strip()
            if not quote:
                continue
            checked += 1
            if _quote_found(quote, excerpt):
                cell["verified"] = True
            else:
                cell["verified"] = False
                fabricated += 1
    return {"filled": filled, "checked": checked, "fabricated": fabricated}


def _review_prompt(query: str, checks: list[dict], citations: list[dict], facts: dict) -> str:
    check_lines = []
    for check in checks:
        basis = f"（判定依据：{check['basis']}）" if check.get("basis") else ""
        check_lines.append(f"- {check['item']}｜严重度 {check['severity']}{basis}")
    schema = ('{"verdicts": [{"item": "检查项原文", "verdict": "通过|存疑|未验证", '
              '"reason": "判断依据，含引用序号", "evidence": [1, 2]}]}')
    return "\n".join([
        f"## 审查目标\n\n{query or '（未写目标，按检查项逐条判断）'}", "",
        "## 要判定的检查项", "", "\n".join(check_lines), "",
        "## 已由数据确定的事实", "",
        f"- 范围内命中 {facts['hits']} 份资料",
        f"- 无法定位到逐字位置的命中：{facts['unlocatable']} 份",
        f"- 被引资料中不可检索（多为扫描件）：{facts['not_searchable']} 份", "",
        f"## 资料摘录（共 {len(citations)} 条）", "",
        _evidence_block(citations, per=1000), "",
        "## 输出 JSON", "", schema, "",
        "要求：逐条给出 verdict；判定不了就写「未验证」并在 reason 说明缺什么；"
        "evidence 只填摘录序号，不要编造。",
    ])


def _review(store: Store, run: dict) -> dict:
    """review：数据能判定的直接判定，其余交模型；模型说不够就保持未验证。"""
    scope = Scope.parse(run["input"]["scope"])
    task = get_task(store, run["task_id"])
    snapshot = run["input"].get("template")
    if snapshot and snapshot["kind"] != "review":
        raise Conflict(f"模板「{snapshot['name']}」不是 review 模板")
    checks = snapshot["body"]["checks"] if snapshot else []
    if not checks:
        raise Invalid("review 运行需要带检查项的 review 模板")
    cfg = config.llm_config()
    if not cfg.available:
        return _review_draft(store, run)

    query = _query_of(store, task, run)
    hits = retrieval.search(store, scope, query, limit=8) if query else []
    citations = _collect_citations(store, hits, length=1200)
    facts = _review_facts(store, hits)

    result = llm.chat(
        [{"role": "system", "content": _SYSTEM_REVIEW},
         {"role": "user", "content": _review_prompt(query, checks, citations, facts)}],
        cfg=cfg, temperature=0.1, max_tokens=3000, json_mode=True)
    payload = _json_object(result, "审查")
    by_item = {str(item.get("item", "")).strip(): item
               for item in (payload.get("verdicts") or []) if isinstance(item, dict)}

    lines = [_model_header(result, None,
                           "标「数据」的行由库内状态直接判定，不依赖模型；"
                           "标「模型」的行由模型判断，需人工复核。"),
             "", f"## 审查：{query or '（未提供检索词）'}", "",
             f"- 模板：{snapshot['name']}（v{snapshot.get('version', 1)}）",
             f"- 范围内命中 {facts['hits']} 份资料", "",
             "| 检查项 | 严重度 | 判定 | 依据 | 来源 |", "| --- | --- | --- | --- | --- |"]

    verdicts = []
    for check in checks:
        item = check["item"]
        verdict, detail, origin = "未验证", "需要人工判断，本次不判定", "—"
        if "引用" in item or "引用" in (check.get("basis") or ""):
            ok = bool(hits) and facts["unlocatable"] == 0
            verdict = "通过" if ok else "存疑"
            detail = ("每条命中都能给出逐字位置" if ok
                      else f"{facts['unlocatable']} 份命中无法定位到逐字位置")
            origin = "数据"
        elif "仅登记" in item or "状态" in item or "status" in (check.get("basis") or ""):
            ok = facts["not_searchable"] == 0
            verdict = "通过" if ok else "存疑"
            detail = ("被引资料都可检索" if ok else
                      f"{facts['not_searchable']} 份被引资料不可检索（多为扫描件）")
            origin = "数据"
        else:
            answer = by_item.get(item) or by_item.get(item.strip())
            if answer:
                raw = str(answer.get("verdict") or "").strip()
                verdict = raw if raw in ("通过", "存疑", "未验证") else "未验证"
                detail = str(answer.get("reason") or "").strip() or "模型未给依据"
                origin = "模型"
        verdicts.append({"item": item, "severity": check["severity"], "verdict": verdict,
                         "detail": detail, "origin": origin})
        lines.append(f"| {item} | {check['severity']} | {verdict} | {detail} | {origin} |")
    lines.append("")
    sources = _sources_block(citations)
    if sources:
        lines += [sources, ""]

    artifact = artifacts.create(
        store, title=f"{task['title']} · 审查记录", body_md="\n".join(lines).strip(),
        kind="review", task_id=run["task_id"], run_id=run["id"],
        citations=_citation_payload(citations), status="draft")
    return {"artifact_id": artifact["id"], "hits": len(hits), "mode": "model",
            "llm": result.brief(), "verdicts": verdicts,
            "versions": [item["version_id"] for item in citations],
            "resolved_libraries": run["input"]["resolved"]["library_ids"]}


def _research_draft(store: Store, run: dict) -> dict:
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


def _extract_draft(store: Store, run: dict) -> dict:
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


def _review_draft(store: Store, run: dict) -> dict:
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
