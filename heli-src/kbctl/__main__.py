"""CLI：`python -m kbctl <cmd> --root <.knowledge> --kb <slug>`

第 3b / 5 / 6 / 7 / 8 步必须串行单写入者：本 CLI 单进程执行，不提供并发入口。
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import pipeline, pipeline2, verify, management, search
from .config import get_settings
from .core import Kb, KbError
from .vstore import open_store

# 默认库根：--root（命令行）> HELI_KNOWLEDGE/KNOWLEDGE_ROOT（环境变量）
# > 项目根 .env 的 KNOWLEDGE_ROOT > <项目根>/.knowledge。路径按运行环境自动换算。
# 用 str() 而不是 Path：--root 是字符串参数，拼 slug 时行为不变。
DEFAULT_ROOT = str(get_settings().knowledge_root)


def _kb(a) -> Kb:
    if not a.kb:
        raise KbError("需要 --kb <slug>")
    return Kb(os.path.join(a.root, a.kb))


def _store(a, kb):
    return open_store(kb, engine=a.engine) if getattr(a, "engine", None) else None


def cmd_init(a) -> int:
    over = {}
    if a.model:
        over["embedding"] = {"provider": a.provider, "model": a.model, "dim": a.dim,
                            "normalized": True}
    if a.site:
        over["site"] = a.site
    kb = Kb.init(os.path.join(a.root, a.kb), name=a.name, **over)
    print(f"init: {kb.root}")
    return 0


def cmd_scan(a) -> int:
    kb = _kb(a)
    r = pipeline.scan(kb, site=a.site or kb.cfg.get("site"),
                      with_db=not getattr(a, "no_db", False))
    print(json.dumps(r, ensure_ascii=False))
    return 0


def cmd_parse(a) -> int:
    print(json.dumps(pipeline.parse(_kb(a), only=a.only), ensure_ascii=False))
    return 0


def cmd_chunk(a) -> int:
    kb = _kb(a)
    store = _store(a, kb)
    r = pipeline.chunk(kb, only=a.only, store=store)
    print(json.dumps(r, ensure_ascii=False))
    return 0


def cmd_embed(a) -> int:
    kb = _kb(a)
    store = _store(a, kb)
    r = pipeline.embed(kb, only=a.only, store=store, keep_old=a.keep_old)
    print(json.dumps(r, ensure_ascii=False))
    return 0


def cmd_gc(a) -> int:
    kb = _kb(a)
    store = _store(a, kb)
    print(json.dumps(pipeline.gc(kb, store=store, include_gone=a.include_gone),
                     ensure_ascii=False))
    return 0


def cmd_pipeline(a) -> int:
    kb = _kb(a)
    store = _store(a, kb)
    out = {"scan": pipeline.scan(kb, site=a.site or kb.cfg.get("site")),
           "parse": pipeline.parse(kb),
           "chunk": pipeline.chunk(kb, store=store),
           "embed": pipeline.embed(kb, store=store),
           "gc": pipeline.gc(kb, store=store)}
    out["verify"] = verify.verify(kb)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0 if out["verify"]["ok"] else 2


def cmd_verify(a) -> int:
    r = verify.verify(_kb(a), sample=a.sample)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    return 0 if r["ok"] else 2


def cmd_doctor(a) -> int:
    print(json.dumps(verify.doctor(_kb(a), knowledge_root=a.root), ensure_ascii=False, indent=1))
    return 0


def cmd_registry(a) -> int:
    print(json.dumps(verify.sync_registry(a.root), ensure_ascii=False, indent=1))
    return 0


# ---------------------------------------------------------- 新协议（v2）


def cmd_v2_scan(a) -> int:
    print(json.dumps(pipeline2.scan_sources(_kb(a), full=not a.partial,
                                            site=a.site or None),
                     ensure_ascii=False, indent=1))
    return 0


def cmd_v2_inventory(a) -> int:
    print(json.dumps(pipeline2.inventory(_kb(a)), ensure_ascii=False, indent=1))
    return 0


def cmd_v2_update(a) -> int:
    print(json.dumps(pipeline2.update(_kb(a)), ensure_ascii=False, indent=1))
    return 0


def cmd_v2_rename(a) -> int:
    print(json.dumps(pipeline2.rename_source(_kb(a), a.source_id, a.new_path),
                     ensure_ascii=False, indent=1))
    return 0


def cmd_v2_query(a) -> int:
    scope = {}
    if a.source_ids is not None:
        scope["source_ids"] = a.source_ids
    if a.sections is not None:
        scope["sections"] = a.sections
    print(json.dumps(pipeline2.query(_kb(a), a.text, n=a.n,
                                     scope=scope or None),
                     ensure_ascii=False, indent=1))
    return 0


def cmd_v2_cite(a) -> int:
    print(json.dumps(pipeline2.save_citation(_kb(a), a.source_id, a.chunk_id),
                     ensure_ascii=False, indent=1))
    return 0


def cmd_v2_recover(a) -> int:
    print(json.dumps(pipeline2.recover(_kb(a)), ensure_ascii=False, indent=1))
    return 0


def cmd_v2_gc(a) -> int:
    print(json.dumps(pipeline2.gc(_kb(a)), ensure_ascii=False, indent=1))
    return 0


def cmd_v2_backup(a) -> int:
    print(json.dumps(pipeline2.backup(_kb(a), a.dest), ensure_ascii=False, indent=1))
    return 0


def cmd_v2_restore_check(a) -> int:
    r = pipeline2.restore_check(_kb(a))
    print(json.dumps(r, ensure_ascii=False, indent=1))
    return 0 if r["ok"] else 2


def cmd_manage(a):
    kb = _kb(a)
    action = a.action
    if action == "adopt":
        result = management.adopt(kb)
    elif action == "organize":
        result = management.organize(kb)
    elif action == "tree":
        result = management.tree(kb)
    elif action == "export":
        result = management.export_structure(kb)
    elif action == "name":
        result = management.rename_library(kb, a.name)
    elif action == "section":
        result = management.edit_section(kb, a.title, a.id, a.parent, a.position)
    elif action == "place":
        result = management.place_document(kb, a.source_id, a.section, a.remove, a.position)
    elif action == "list":
        result = management.list_documents(kb, a.section, a.text, a.offset, a.limit)
    elif action == "read":
        result = management.read_document(kb, a.source_id, a.offset, a.limit, a.sha256)
    elif action == "outline":
        result = management.document_outline(kb, a.source_id, a.sha256)
    elif action == "read-section":
        result = management.read_section(kb, a.source_id, a.index, a.sha256)
    elif action == "links":
        result = management.follow_links(kb, a.source_id, a.offset, a.limit)
    elif action == "search-index":
        result = search.build_index(kb)
    elif action == "search-status":
        result = search.status(kb)
    elif action == "search":
        result = search.search(kb, a.text, a.section, a.limit, a.offset)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="kbctl")
    p.add_argument("--root", default=DEFAULT_ROOT,
                help=".knowledge 根目录；缺省取自环境变量或项目根 .env 的 KNOWLEDGE_ROOT")
    p.add_argument("--kb", default="", help="库 slug（目录名）")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp, with_site=False, with_only=True):
        sp.add_argument("--engine", default=None, help="覆盖向量引擎：chroma | memory")
        if with_only:
            sp.add_argument("--only", nargs="*", default=None)
        if with_site:
            sp.add_argument("--site", default="", help="站点前缀，用于把 url 还原成相对路径")

    s = sub.add_parser("init", help="建库：kb.json + 空骨架（已存在则报错，不覆盖）")
    s.add_argument("--name", default="")
    s.add_argument("--model", default="")
    s.add_argument("--provider", default="hash")
    s.add_argument("--dim", type=int, default=1024)
    s.add_argument("--site", default="")
    s.set_defaults(fn=cmd_init)

    sp = sub.add_parser("scan", help="3a 清单三件套 + 3b 回写结构列")
    common(sp, with_site=True, with_only=False)
    sp.add_argument("--no-db", action="store_true",
                    help="跳过 3b（仅在 SQLite 不可写的环境下临时使用，需在 WSL 内补跑）")
    sp.set_defaults(fn=cmd_scan)

    sp = sub.add_parser("parse", help="4 解析层（可并行）")
    common(sp)
    sp.set_defaults(fn=cmd_parse)

    sp = sub.add_parser("chunk", help="5 先删后插重建 chunks 表")
    common(sp)
    sp.set_defaults(fn=cmd_chunk)

    sp = sub.add_parser("embed", help="6 先清旧向量再写入")
    common(sp)
    sp.add_argument("--keep-old", action="store_true", help="换模型时保留旧 collection 做灰度")
    sp.set_defaults(fn=cmd_embed)

    sp = sub.add_parser("gc", help="7 淘汰 superseded 版本的 chunk")
    common(sp, with_only=False)
    sp.add_argument("--include-gone", action="store_true", help="连站点删页（gone）一起清")
    sp.set_defaults(fn=cmd_gc)

    sp = sub.add_parser("pipeline", help="scan→parse→chunk→embed→gc→verify")
    common(sp, with_site=True, with_only=False)
    sp.set_defaults(fn=cmd_pipeline)

    sp = sub.add_parser("verify", help="8 双向对账")
    common(sp, with_only=False)
    sp.add_argument("--sample", type=int, default=20)
    sp.set_defaults(fn=cmd_verify)

    sp = sub.add_parser("doctor", help="9 写 _status.json + 同步注册表")
    common(sp, with_only=False)
    sp.set_defaults(fn=cmd_doctor)

    sp = sub.add_parser("registry", help="重建 _registry.json（磁盘为权威）")
    sp.set_defaults(fn=cmd_registry)

    sp = sub.add_parser("v2-inventory", help="[新协议] 旧库只读盘点，不写入数据库或向量")
    sp.set_defaults(fn=cmd_v2_inventory)

    sp = sub.add_parser("v2-scan", help="[新协议] 写入 sources/nav/links（默认完整扫描）")
    sp.add_argument("--partial", action="store_true", help="部分扫描：不下线缺失来源")
    sp.add_argument("--site", default="")
    sp.set_defaults(fn=cmd_v2_scan)

    sp = sub.add_parser("v2-update", help="[新协议] 五步更新流（含自动换模型切换）")
    sp.set_defaults(fn=cmd_v2_update)

    sp = sub.add_parser("v2-rename", help="[新协议] 显式改名，保留来源 ID")
    sp.add_argument("source_id")
    sp.add_argument("new_path")
    sp.set_defaults(fn=cmd_v2_rename)

    sp = sub.add_parser("v2-query", help="[新协议] 检索（DISTINCT version 前置过滤）")
    sp.add_argument("text")
    sp.add_argument("--n", type=int, default=5)
    sp.add_argument("--source-ids", nargs="*", default=None)
    sp.add_argument("--sections", nargs="*", default=None)
    sp.set_defaults(fn=cmd_v2_query)

    sp = sub.add_parser("v2-cite", help="[新协议] 保存引用快照")
    sp.add_argument("source_id")
    sp.add_argument("chunk_id")
    sp.set_defaults(fn=cmd_v2_cite)

    sp = sub.add_parser("v2-recover", help="[新协议] 启动核对：续旧版/补清理/缺向量上报")
    sp.set_defaults(fn=cmd_v2_recover)

    sp = sub.add_parser("v2-gc", help="[新协议] 安全点手动 GC")
    sp.set_defaults(fn=cmd_v2_gc)

    sp = sub.add_parser("v2-backup", help="[新协议] 停写整库副本")
    sp.add_argument("dest")
    sp.set_defaults(fn=cmd_v2_backup)

    sp = sub.add_parser("v2-restore-check", help="[新协议] 独立位置恢复核对")
    sp.set_defaults(fn=cmd_v2_restore_check)
    sp = sub.add_parser("v2-manage", help="资料组织与阅读，不依赖向量")
    actions = sp.add_subparsers(dest="action", required=True)
    for action in ("adopt", "organize", "tree", "export", "name", "section", "place", "list", "read", "outline", "read-section", "links", "search-index", "search-status", "search"):
        ap = actions.add_parser(action)
        ap.set_defaults(fn=cmd_manage)
        if action == "name":
            ap.add_argument("name")
        if action == "section":
            ap.add_argument("title")
            ap.add_argument("--id", default=None)
            ap.add_argument("--parent", default="@keep", help="父章节 ID；root 表示顶层；省略保留原位置")
            ap.add_argument("--position", type=int, default=None)
        if action in ("place", "read", "outline", "read-section", "links"):
            ap.add_argument("source_id")
        if action == "read-section":
            ap.add_argument("index", type=int)
        if action in ("place", "list"):
            ap.add_argument("--section", required=action=="place", default=None)
        if action == "place":
            ap.add_argument("--remove", action="store_true")
            ap.add_argument("--position", type=int, default=0)
        if action == "list":
            ap.add_argument("--text", default="")
        if action in ("read", "outline", "read-section"):
            ap.add_argument("--sha256", default=None)
        if action in ("list", "read", "links", "search"):
            ap.add_argument("--offset", type=int, default=0)
            ap.add_argument("--limit", type=int, default=12000 if action=="read" else 50)
        if action == "search":
            ap.add_argument("text")
            ap.add_argument("--section", default=None)
    return p


def main(argv=None) -> int:
    a = build_parser().parse_args(argv)
    try:
        return a.fn(a)
    except KbError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
