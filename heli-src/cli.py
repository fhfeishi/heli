"""维护入口：与 API 共用同一批业务函数，不另写一套管理逻辑。

    python heli-src/cli.py --data <数据根> init
    python heli-src/cli.py --data <数据根> info
    python heli-src/cli.py --data <数据根> import --from <旧库根> [--library <slug>]
    python heli-src/cli.py --data <数据根> reindex
    python heli-src/cli.py --data <数据根> reparse
    python heli-src/cli.py --data <数据根> search "关键词" [--scope group:<id>]

批量处理（import / reparse / reindex）都会写审计记录到 `<项目根>/datapipe/runs/`。
单次上传由数据库自身记录，不写管道记录——那是用户操作，不是批量转换。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import catalog
import content
import pipeline
import retrieval
from config import Settings
from models import Scope
from storage import Store


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="heli-src/cli.py")
    parser.add_argument("--data", default=None)
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="建数据根与数据库")
    sub.add_parser("info", help="看规模与状态")
    imp = sub.add_parser("import", help="从旧库根一次性导入原件（只读源端）")
    imp.add_argument("--from", dest="source", required=True)
    imp.add_argument("--library", default=None, help="只导入某个 slug")
    sub.add_parser("reindex", help="重建全文索引")
    sub.add_parser("reparse", help="重新尝试解析已登记的资料（如 PDF 文本层）")
    find = sub.add_parser("search", help="命令行检索")
    find.add_argument("text")
    find.add_argument("--scope", default="all", help="all | library:<id> | group:<id> | source:<id>")
    find.add_argument("--limit", type=int, default=10)

    args = parser.parse_args(argv)
    settings = Settings.load(args.data)
    # 导入是一次性迁移，关掉 fsync 能快一个数量级；失败重跑即可（导入幂等）
    store = Store(settings.data_root, fast_writes=(args.cmd == "import"))
    store.init()

    if args.cmd == "init":
        print(f"数据根：{settings.data_root}")
        return 0
    if args.cmd == "info":
        libraries = catalog.list_libraries(store, include_archived=True)
        print(json.dumps({
            "data_root": str(settings.data_root),
            "libraries": len(libraries),
            "sources": sum(item["source_count"] for item in libraries),
            "indexed": sum(item["indexed_count"] for item in libraries),
            "groups": len(catalog.list_groups(store)),
        }, ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "search":
        hits = retrieval.search(store, Scope.parse(args.scope), args.text, args.limit)
        for hit in hits:
            print(f"{hit['title']}　{hit['position']}　{hit['snippet']}")
        return 0
    if args.cmd == "reindex":
        with pipeline.run("reindex", {"data_root": str(settings.data_root)}) as run:
            result = content.reindex(store)
            run.count("indexed", int(result.get("indexed", 0)))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    if args.cmd == "import":
        return _import(store, Path(args.source), args.library)
    if args.cmd == "reparse":
        return _reparse(store)
    return 2


# 库目录本身当源时，这些子目录属于内部结构，不是资料
_INTERNAL_DIRS = {"parsed", "datadb", "vectordb", "target", "temp", "archive", "_scratch", "node_modules"}


def _import(store: Store, source_root: Path, only: str | None) -> int:
    """从旧库根一次性导入原件（只读源端）。

    两种目录都认：
    - 标准旧库：有 `kb.json` 与 `source/`，名字取 kb.json，源取 source/；
    - 普通目录：没有 kb.json 时用目录名当库名，并把库目录本身当源，
      跳过 parsed/datadb/vectordb/target 这类内部目录。
    任何层级里以 `.` 开头的路径（如 source/.snapshots）一律跳过。
    """
    if not source_root.is_dir():
        print(f"error: 源目录不存在：{source_root}", file=sys.stderr)
        return 2

    rules = {
        "accept_in_plain_dir": ["text", "pdf"],
        "skip_hidden_paths": True,
        "internal_dirs": sorted(_INTERNAL_DIRS),
        "parse_pdf": False,
        "empty_file": "skip",
    }
    params = {"source_root": str(source_root), "only": only,
              "data_root": str(store.root), "rules": rules}

    with pipeline.run("import", params) as run:
        known = {item["name"]: item["id"] for item in catalog.list_libraries(store, include_archived=True)}

        for lib_dir in sorted(source_root.iterdir()):
            if not lib_dir.is_dir() or lib_dir.name.startswith((".", "_")):
                continue
            if only and lib_dir.name != only:
                continue

            name, description = lib_dir.name, ""
            config_path = lib_dir / "kb.json"
            if config_path.is_file():
                try:
                    cfg = json.loads(config_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    print(f"跳过（kb.json 不可读）：{lib_dir.name}", file=sys.stderr)
                    run.note(f"跳过 {lib_dir.name}：kb.json 不可读")
                    continue
                name = str(cfg.get("name") or lib_dir.name)
                description = str(cfg.get("description") or "")

            source_dir = lib_dir / "source"
            base = source_dir if source_dir.is_dir() else lib_dir
            skip_root = set() if source_dir.is_dir() else _INTERNAL_DIRS

            library_id = known.get(name)
            if library_id is None:
                library_id = catalog.create_library(store, name, description)["id"]
                known[name] = library_id

            pending = [p for p in sorted(base.rglob("*")) if p.is_file()]
            print(f"· {name}：{len(pending)} 个文件", flush=True)
            item = run.library(library_id, name, files_seen=len(pending))
            # 一个库一个事务：单库失败只回滚这个库，已完成的库不受影响
            with store.batch():
                for path in pending:
                    rel = path.relative_to(base)
                    if any(part.startswith(".") for part in rel.parts):
                        run.skip(item, "hidden", rel)
                        continue
                    if skip_root and rel.parts and rel.parts[0] in skip_root:
                        run.skip(item, "internal_dir", rel)
                        continue
                    # 普通目录里什么都有：网页快照、图表、.db、临时文件都不是资料。
                    # 只收能检索的文档（text / pdf）；标准旧库的 source/ 仍然全收，因为那是人工放进去的。
                    if skip_root and content.detect_kind(rel.name) not in ("text", "pdf"):
                        run.skip(item, "not_document", rel)
                        continue
                    try:
                        if path.stat().st_size == 0:
                            run.skip(item, "empty", rel)
                            continue
                        result = content.import_source(store, library_id, path.name, path.read_bytes(),
                                                       rel_path=str(rel), parse_pdf=False)
                        item["processed"] += 1
                        run.count("processed")
                        if result.get("unchanged"):
                            # 内容未变：只算「处理过」，不算新增，也不重复计索引
                            item["unchanged"] += 1
                            run.count("unchanged")
                        else:
                            item["imported"] += 1
                            run.count("imported")
                            if result.get("indexed"):
                                item["indexed"] += 1
                                run.count("indexed")
                        if item["processed"] % 50 == 0:
                            print(f"  已处理 {item['processed']}", flush=True)
                            if item["processed"] % 500 == 0:
                                run.flush()  # 大库中途也落一次，别只在库结束时写
                    except Exception as error:  # 单文件失败不影响其余导入
                        run.library_error(item, rel, error)
                        print(f"导入失败 {rel}：{error}", file=sys.stderr)

            print(f"  完成 {name}：新增 {item['imported']}，未变 {item['unchanged']}，"
                  f"跳过 {item['skipped']}，失败 {item['failed']}", flush=True)
            run.flush()  # 每个库结束落一次进度，被中断时记录能指到具体库

    totals = {
        "processed": run.counters.get("processed", 0),
        "imported": run.counters.get("imported", 0),
        "unchanged": run.counters.get("unchanged", 0),
        "indexed": run.counters.get("indexed", 0),
        "skipped": run.counters.get("skipped", 0),
        "failed": run.counters.get("failed", 0),
    }
    print(json.dumps(totals, ensure_ascii=False))
    return 0


def _reparse(store: Store) -> int:
    """对「仅登记」的资料重新提取正文。

    典型场景：导入时还没有 PDF 解析能力，之后补上了，不必重新导入一遍。
    已索引的不动；提取不出文本的仍保持 registered。
    """
    with store.read() as conn:
        rows = conn.execute(
            "SELECT s.library_id, s.path, v.sha256 FROM sources s "
            "JOIN versions v ON v.id=(SELECT id FROM versions WHERE source_id=s.id "
            "ORDER BY created_at DESC LIMIT 1) "
            "WHERE s.archived_at IS NULL AND s.status='registered' "
            "AND lower(s.path) LIKE '%.pdf'").fetchall()
    print(f"待解析 PDF：{len(rows)} 份", flush=True)

    params = {"data_root": str(store.root), "only_pdf": True,
              "max_parse_bytes": getattr(content, "MAX_PDF_PARSE_BYTES", None),
              "min_text_chars": getattr(content, "MIN_PDF_CHARS", None)}
    with pipeline.run("reparse", params) as run:
        changed = failed = 0
        for row in rows:
            digest = row["sha256"]
            stored = content.blob_path(store, row["library_id"], digest, content.safe_name(row["path"]))
            if not stored.is_file():
                failed += 1
                run.count("failed")
                run.error(row["path"], "原件不在预期位置")
                continue
            try:
                result = content.import_source(
                    store, row["library_id"], row["path"], stored.read_bytes(),
                    rel_path=row["path"], force=True, parse_pdf=True,
                )
                if result["indexed"]:
                    changed += 1
                    run.count("reparsed")
                    print(f"  已提取 {changed}", flush=True)
                    if changed % 20 == 0:
                        run.flush()
                else:
                    run.count("no_text")
            except Exception as error:
                print(f"重新解析失败 {row['path']}：{error}", file=sys.stderr)
                run.error(row["path"], error)
                failed += 1
                run.count("failed")

    print(json.dumps({"reparsed": changed, "failed": failed, "total": len(rows)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
