"""第 8、9 步：verify（双向对账）与 doctor（_status.json + 注册表自检）。

陷阱 2：核对前必须 `store.refresh()` 重开会话。同一会话内删完立刻 `count()`
在 PersistentClient 上可能返回陈旧值，会把「删除成功」误判成「删除失败」。
"""

from __future__ import annotations

import json
import os
import random
import sqlite3
from datetime import datetime, timezone

from . import schema
from .core import F_REGISTRY, Kb, iter_kb_slugs, registry_path
from .pipeline import load_manifest
from .vstore import open_store


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def verify(kb: Kb, sample: int = 20, seed: int = 7) -> dict:
    fp = kb.emb_fp()
    store = open_store(kb)
    store.refresh()                      # 陷阱 2
    conn = schema.connect(kb.db_path)

    table_ids = {r[0]: r[1] for r in conn.execute("SELECT chunk_id, doc_id FROM chunks")}
    per_doc_table: dict[str, int] = {}
    for _cid, did in table_ids.items():
        per_doc_table[did] = per_doc_table.get(did, 0) + 1

    # chroma 侧：按 doc_id 分组（metadata 里的 doc_id 是兜底枚举路径）
    chroma_ids = set(store.get_ids_where({"doc_id": {"$ne": ""}})) if table_ids else set()
    per_doc_chroma: dict[str, int] = {}
    for did in per_doc_table:
        per_doc_chroma[did] = len(store.get_ids_where({"doc_id": did}))

    orphan = sorted(chroma_ids - set(table_ids))       # chroma 有、表无
    missing = sorted(set(table_ids) - chroma_ids)      # 表有、chroma 无
    per_doc_diff = {
        d: {"table": per_doc_table[d], "chroma": per_doc_chroma.get(d, 0)}
        for d in per_doc_table
        if per_doc_table[d] != per_doc_chroma.get(d, 0)
    }

    old_model = 0
    try:
        old_model = len(store.get_ids_where({"embedding_model": {"$ne": fp}}))
    except Exception:
        old_model = -1

    # 换模型会产生新 collection，旧的必须被作废；否则只是「看不见」，不是「清理了」
    try:
        stale_collections = [c for c in store.list_collections() if c != kb.collection_name]
    except Exception:
        stale_collections = []

    # 抽样反查原文：chunk text 必须能在 parsed 文档里按 char_span 定位
    rng = random.Random(seed)
    picked = []
    rows = conn.execute(
        "SELECT chunk_id, doc_id, char_start, char_end, text FROM chunks").fetchall()
    if rows and sample:
        picked = rng.sample(rows, min(sample, len(rows)))
    bad_span = []
    for cid, did, s, e, text in picked:
        dpath = kb.parsed_doc_dir(did) / "document.md"
        if not dpath.exists():
            bad_span.append({"chunk_id": cid, "reason": "parsed 缺失"})
            continue
        doc = dpath.read_text(encoding="utf-8")
        if doc[s:e].strip() != text.strip():
            bad_span.append({"chunk_id": cid, "reason": "char_span 定位不一致"})

    engine_state = "missing"
    if kb.engine_json_path.exists():
        ej = json.loads(kb.engine_json_path.read_text(encoding="utf-8"))
        engine_state = "match" if ej.get("embedding", {}).get("fingerprint") == fp else "mismatch"

    store.close()
    conn.close()
    return {
        "slug": kb.slug, "checked_at": _now(),
        "chunks_table": len(table_ids), "chunks_chroma": len(chroma_ids),
        "orphan_chunks": orphan, "missing_vectors": missing,
        "per_doc_diff": per_doc_diff,
        "old_model_chunks": old_model,
        "stale_collections": stale_collections,
        "engine_fingerprint": engine_state,
        "sampled": len(picked), "bad_span": bad_span,
        "ok": not orphan and not missing and not per_doc_diff and not bad_span
              and old_model == 0 and not stale_collections and engine_state == "match",
    }


def doctor(kb: Kb, knowledge_root: str | os.PathLike | None = None) -> dict:
    status = {"slug": kb.slug, "checked_at": _now(), "layers": {}, "consistency": {}, "stale": {}}

    def stat(d):
        if not d.exists():
            return {"exists": False}
        files = [f for f in d.rglob("*") if f.is_file() and ":" not in f.name]
        return {"exists": True, "files": len(files), "bytes": sum(f.stat().st_size for f in files)}

    status["layers"]["source"] = stat(kb.source_dir)
    pd = stat(kb.parsed_dir)
    if pd.get("exists"):
        pd["docs"] = len({p.parent.name for p in kb.parsed_dir.glob("*/*") if p.is_dir()})
    status["layers"]["parsed"] = pd
    vd = stat(kb.vectordb_dir)
    if kb.engine_json_path.exists():
        ej = json.loads(kb.engine_json_path.read_text(encoding="utf-8"))
        vd["collection"] = ej.get("collection")
        try:
            st = open_store(kb)
            st.refresh()
            vd["vectors"] = st.count()
            st.close()
        except Exception:
            vd["vectors"] = None
    status["layers"]["vectordb"] = vd

    db = {"exists": kb.db_path.exists()}
    if db["exists"]:
        try:
            conn = schema.connect(kb.db_path)
            db["documents"] = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            db["chunks"] = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
            db["gone"] = conn.execute(
                "SELECT COUNT(*) FROM documents WHERE kind='gone'").fetchone()[0]
            conn.close()
        except sqlite3.OperationalError as e:
            # 9P 挂载点上 SQLite 不可写（§7.9）：体检其余项目照常产出，这一层记为 unavailable
            db["unavailable"] = str(e)
    status["layers"]["datadb"] = db

    fp = kb.emb_fp()
    if kb.engine_json_path.exists():
        ej = json.loads(kb.engine_json_path.read_text(encoding="utf-8"))
        status["consistency"]["engine_fingerprint"] = (
            "match" if ej.get("embedding", {}).get("fingerprint") == fp else "mismatch")
    else:
        status["consistency"]["engine_fingerprint"] = "no_vectordb"

    try:
        v = verify(kb, sample=10)
        status["consistency"]["orphan_chunks"] = len(v["orphan_chunks"])
        status["consistency"]["missing_vectors"] = len(v["missing_vectors"])
    except Exception as e:
        status["consistency"]["orphan_chunks"] = None
        status["consistency"]["missing_vectors"] = None
        status["consistency"]["verify_error"] = str(e)

    status["stale"] = {"documents": status["layers"]["datadb"].get("gone", 0), "jobs_failed": 0}

    kb.status_path.write_text(json.dumps(status, ensure_ascii=False, indent=1) + "\n",
                              encoding="utf-8")

    if knowledge_root is not None:
        status["registry"] = sync_registry(knowledge_root)
    return status


def sync_registry(knowledge_root: str | os.PathLike) -> dict:
    """启动自检：磁盘为权威，`_registry.json` 只是缓存（§4.5）。

    磁盘有、表里无 → 登记；表里有、磁盘无 → 摘除登记（**不删数据**，只提示）。
    文件不存在 → 全量重建，不算错误。
    """
    root = str(knowledge_root)
    reg_file = registry_path(root)
    on_disk = iter_kb_slugs(root)
    reg = {"kbs": {}}
    if reg_file.exists():
        try:
            reg = json.loads(reg_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            reg = {"kbs": {}}
    known = set(reg.get("kbs", {}))
    added = sorted(set(on_disk) - known)
    removed = sorted(known - set(on_disk))

    kbs = {}
    for slug in on_disk:
        kb = Kb(os.path.join(root, slug))
        cfg = kb.cfg
        kbs[slug] = {"name": cfg.get("name", slug), "tags": cfg.get("tags", []),
                     "schema_version": cfg.get("schema_version"),
                     "engine": cfg.get("vector_store", {}).get("engine")}
    out = {"updated_at": _now(), "root": root, "kbs": kbs,
           "changes": {"added": added, "removed": removed}}
    reg_file.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return out
