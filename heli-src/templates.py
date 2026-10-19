"""templates：五类模板的存储、校验与「库 → 模板」关联。

设计现代 §10：模板轻量、共用 templates 表、不同 kind 各自校验字段，不建模板平台。
body_json 的形状按 kind 固定：
  research    {"sections": ["..."]}                        任务要求与步骤提示
  extract     {"fields": [{"name","desc","granularity"}], "missing_policy": "..."}
  review      {"checks": [{"item","basis","severity"}]}
  report      {"outline": ["..."], "required": ["..."]}
  background  {"prompts": ["..."]}
"""
from __future__ import annotations

import json

from errors import Invalid, NotFound
from storage import Store, new_id, now

KINDS = ("research", "extract", "review", "report", "background")

KIND_LABEL = {
    "research": "研究",
    "extract": "提取",
    "review": "审查",
    "report": "报告",
    "background": "背景",
}

_SEVERITIES = ("info", "minor", "major")


def _require_kind(kind: str) -> None:
    if kind not in KINDS:
        raise Invalid(f"模板类型只能是 {' / '.join(KINDS)}")


def _nonempty_str(value, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise Invalid(f"{field_name} 不能为空")
    return text


def validate_body(kind: str, body: dict) -> dict:
    """按 kind 校验并规范化 body；不合格直接抛 Invalid（不静默修正用户数据）。"""
    _require_kind(kind)
    data = body if isinstance(body, dict) else {}
    if kind == "research":
        sections = [_nonempty_str(item, "sections 里的条目") for item in (data.get("sections") or [])]
        if not sections:
            raise Invalid("research 模板至少要有一个 sections 条目")
        return {"sections": sections}
    if kind == "extract":
        fields = []
        for item in data.get("fields") or []:
            if not isinstance(item, dict):
                raise Invalid("fields 里每项必须是对象")
            fields.append({
                "name": _nonempty_str(item.get("name"), "field.name"),
                "desc": str(item.get("desc") or "").strip(),
                "granularity": _nonempty_str(item.get("granularity") or "文档", "field.granularity"),
            })
        if not fields:
            raise Invalid("extract 模板至少要定义一个字段")
        return {"fields": fields, "missing_policy": str(data.get("missing_policy") or "留空并说明").strip()}
    if kind == "review":
        checks = []
        for item in data.get("checks") or []:
            if not isinstance(item, dict):
                raise Invalid("checks 里每项必须是对象")
            severity = str(item.get("severity") or "minor").strip()
            if severity not in _SEVERITIES:
                raise Invalid(f"severity 只能是 {' / '.join(_SEVERITIES)}")
            checks.append({
                "item": _nonempty_str(item.get("item"), "check.item"),
                "basis": str(item.get("basis") or "").strip(),
                "severity": severity,
            })
        if not checks:
            raise Invalid("review 模板至少要有一个检查项")
        return {"checks": checks}
    if kind == "report":
        outline = [_nonempty_str(item, "outline 里的条目") for item in (data.get("outline") or [])]
        if not outline:
            raise Invalid("report 模板至少要有一个大纲条目")
        required = [_nonempty_str(item, "required 里的条目") for item in (data.get("required") or [])]
        return {"outline": outline, "required": required}
    prompts = [_nonempty_str(item, "prompts 里的条目") for item in (data.get("prompts") or [])]
    if not prompts:
        raise Invalid("background 模板至少要有一个引导字段")
    return {"prompts": prompts}


def _row(row) -> dict:
    return {"id": row["id"], "kind": row["kind"], "name": row["name"], "version": row["version"],
            "body": json.loads(row["body_json"]), "created_at": row["created_at"],
            "updated_at": row["updated_at"]}


def list_templates(store: Store, kind: str | None = None) -> list[dict]:
    if kind:
        _require_kind(kind)
    _seed_if_empty(store)
    sql = "SELECT * FROM templates"
    args: tuple = ()
    if kind:
        sql += " WHERE kind=?"
        args = (kind,)
    with store.read() as conn:
        rows = conn.execute(sql + " ORDER BY kind, name", args).fetchall()
    return [_row(row) for row in rows]


def get_template(store: Store, template_id: str) -> dict:
    with store.read() as conn:
        row = conn.execute("SELECT * FROM templates WHERE id=?", (template_id,)).fetchone()
    if row is None:
        raise NotFound(f"模板不存在：{template_id}")
    return _row(row)


def create_template(store: Store, *, kind: str, name: str, body: dict) -> dict:
    clean_name = _nonempty_str(name, "模板名称")
    clean_body = validate_body(kind, body)
    template_id = new_id("tpl")
    stamp = now()
    with store.tx() as conn:
        conn.execute("INSERT INTO templates(id, kind, name, version, body_json, created_at, updated_at) "
                     "VALUES(?,?,?,?,?,?,?)",
                     (template_id, kind, clean_name, 1, json.dumps(clean_body, ensure_ascii=False), stamp, stamp))
    return get_template(store, template_id)


def update_template(store: Store, template_id: str, *, name: str | None = None,
                    body: dict | None = None) -> dict:
    current = get_template(store, template_id)
    updates = []
    args: list = []
    if name is not None:
        updates.append("name=?")
        args.append(_nonempty_str(name, "模板名称"))
    if body is not None:
        clean = validate_body(current["kind"], body)
        updates.append("body_json=?")
        updates.append("version=version+1")
        args.append(json.dumps(clean, ensure_ascii=False))
    if not updates:
        return current
    args.append(now())
    args.append(template_id)
    with store.tx() as conn:
        conn.execute(f"UPDATE templates SET {', '.join(updates)}, updated_at=? WHERE id=?", args)
    return get_template(store, template_id)


def delete_template(store: Store, template_id: str) -> dict:
    get_template(store, template_id)
    with store.tx() as conn:
        conn.execute("DELETE FROM templates WHERE id=?", (template_id,))
    return {"deleted": template_id}


def library_templates(store: Store, library_id: str) -> list[dict]:
    _require_library(store, library_id)
    with store.read() as conn:
        rows = conn.execute(
            "SELECT t.* FROM templates t JOIN library_templates lt ON lt.template_id=t.id "
            "WHERE lt.library_id=? ORDER BY t.kind, t.name", (library_id,)).fetchall()
    return [_row(row) for row in rows]


def attach(store: Store, library_id: str, template_id: str) -> dict:
    _require_library(store, library_id)
    get_template(store, template_id)
    with store.tx() as conn:
        conn.execute("INSERT OR IGNORE INTO library_templates(library_id, template_id) VALUES(?,?)",
                     (library_id, template_id))
    return {"library_id": library_id, "template_ids": [item["id"] for item in library_templates(store, library_id)]}


def detach(store: Store, library_id: str, template_id: str) -> dict:
    with store.tx() as conn:
        conn.execute("DELETE FROM library_templates WHERE library_id=? AND template_id=?",
                     (library_id, template_id))
    return {"library_id": library_id, "template_ids": [item["id"] for item in library_templates(store, library_id)]}


def _require_library(store: Store, library_id: str) -> None:
    with store.read() as conn:
        if conn.execute("SELECT 1 FROM libraries WHERE id=?", (library_id,)).fetchone() is None:
            raise NotFound(f"资料库不存在：{library_id}")


# ---------------------------------------------------------------- 内置种子

BUILTIN: list[dict] = [
    {"kind": "research", "name": "一般研究", "body": {
        "sections": ["问题与判断", "证据（逐条引用）", "不确定点与下一步"],
    }},
    {"kind": "research", "name": "方案对比", "body": {
        "sections": ["候选方案", "对比维度", "取舍依据", "推荐与保留意见"],
    }},
    {"kind": "extract", "name": "项目要素提取", "body": {
        "fields": [
            {"name": "项目名称", "desc": "原文里的正式名称", "granularity": "文档"},
            {"name": "负责人", "desc": "牵头人姓名与单位", "granularity": "文档"},
            {"name": "立项时间", "desc": "起止年份", "granularity": "文档"},
            {"name": "技术要点", "desc": "原文提到的关键技术，逐条列出", "granularity": "段落"},
        ],
        "missing_policy": "留空并说明原文未给出",
    }},
    {"kind": "report", "name": "结论摘要", "body": {
        "outline": ["背景", "结论", "证据", "下一步"],
        "required": ["结论", "证据"],
    }},
    {"kind": "review", "name": "引用可追溯审查", "body": {
        "checks": [
            {"item": "每条结论都有可定位引用", "basis": "证据包 citations", "severity": "major"},
            {"item": "未把『仅登记』资料当可检索正文使用", "basis": "sources.status", "severity": "major"},
            {"item": "摘要用词不超出原文表述", "basis": "命中摘录", "severity": "minor"},
        ],
    }},
    {"kind": "background", "name": "库背景引导", "body": {
        "prompts": ["这个库主要收什么？", "已知缺哪些资料？", "哪些结论需要交叉验证？"],
    }},
]


def _seed_if_empty(store: Store) -> None:
    """首次使用补内置模板；之后不覆盖用户改动（按 id 去重）。"""
    with store.tx() as conn:
        existing = conn.execute("SELECT COUNT(*) FROM templates").fetchone()[0]
        if existing:
            return
        stamp = now()
        for item in BUILTIN:
            conn.execute(
                "INSERT INTO templates(id, kind, name, version, body_json, created_at, updated_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (new_id("tpl"), item["kind"], item["name"], 1,
                 json.dumps(item["body"], ensure_ascii=False), stamp, stamp))
