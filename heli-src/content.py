"""content：文件接入、解析与原文读取。

原则：
- 原件按**内容哈希**存放（同一路径改了内容不会覆盖旧版本，引用仍能回到当时那一版）；
- 原件、派生正文、模型结果分开保存；
- 不能解析的资料仍是合法资料（`registered`），绝不解码成乱码冒充正文；
- 先落文件、后发布数据库记录。
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import parsers
from errors import Conflict, Invalid, NotFound
from storage import Store, new_id, now

TEXT_KINDS = {".md", ".markdown", ".txt", ".json", ".csv", ".tsv", ".log", ".yaml", ".yml", ".rst"}
KNOWN_KINDS = TEXT_KINDS | {".pdf", ".docx", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg", ".gif",
                            ".mp3", ".wav", ".mp4", ".mov", ".zip", ".py", ".ts", ".js", ".java", ".go"}

STATUS_INDEXED = "indexed"
STATUS_REGISTERED = "registered"
STATUS_UNDECODABLE = "undecodable"

_SAFE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff._-]+")


def detect_kind(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in TEXT_KINDS:
        return "text"
    if suffix == ".pdf":
        return "pdf"
    if suffix in KNOWN_KINDS:
        return "binary"
    return "unknown"


def safe_name(filename: str) -> str:
    base = Path(str(filename or "")).name
    base = _SAFE.sub("_", base).strip("._") or "file"
    return base[:120]


def safe_rel(rel_path: str) -> str:
    """保留子目录结构，逐段清洗；拒绝越界。"""
    parts = []
    for item in str(rel_path).replace("\\", "/").split("/"):
        item = item.strip()
        if not item or item in (".", ".."):
            continue
        parts.append(_SAFE.sub("_", item)[:120])
    return "/".join(parts) or "file"


def blob_path(store: Store, library_id: str, digest: str, name: str) -> Path:
    return store.sources_dir / library_id / digest[:2] / digest / name


def import_source(store: Store, library_id: str, filename: str, data: bytes,
                  rel_path: str | None = None, force: bool = False,
                  parse_pdf: bool = True) -> dict:
    if not data:
        raise Invalid("文件内容为空")
    with store.read() as conn:
        lib = conn.execute("SELECT archived_at FROM libraries WHERE id=?", (library_id,)).fetchone()
    if lib is None:
        raise NotFound(f"资料库不存在：{library_id}")
    if lib["archived_at"]:
        raise Conflict("资料库已归档，先恢复再导入")

    name = safe_name(filename)
    rel = safe_rel(rel_path) if rel_path else name
    digest = hashlib.sha256(data).hexdigest()
    existing = _find_source(store, library_id, rel)
    if existing and _latest_sha(store, existing["id"]) == digest and not force:
        return {"source": existing, "version_id": _latest_version(store, existing["id"]),
                "status": existing["status"], "indexed": existing["status"] == STATUS_INDEXED,
                "unchanged": True}

    stored = blob_path(store, library_id, digest, name)
    if not stored.is_file():
        store.write_bytes(stored, data)

    kind = detect_kind(rel)
    # 批量导入时先不解析 PDF：pypdf 单份要几十秒，会把导入拖成几十分钟。
    # 正文提取交给 `heli.cli reparse`，可以单独跑、单独看进度。
    text, status = _extract(kind, data, parse_pdf=parse_pdf)

    with store.tx() as conn:
        if existing:
            source_id = existing["id"]
            conn.execute("UPDATE sources SET status=?, updated_at=? WHERE id=?",
                         (status, now(), source_id))
        else:
            source_id = new_id("src")
            conn.execute(
                "INSERT INTO sources(id, library_id, path, title, kind, status, created_at, updated_at) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (source_id, library_id, rel, name, kind, status, now(), now()))
        version_id = _version_by_sha(conn, source_id, digest)
        if version_id is None:
            version_id = new_id("ver")
            conn.execute("INSERT INTO versions(id, source_id, sha256, size, created_at) VALUES(?,?,?,?,?)",
                         (version_id, source_id, digest, len(data), now()))
        conn.execute("DELETE FROM derived WHERE version_id=?", (version_id,))
        conn.execute("DELETE FROM search_index WHERE version_id=?", (version_id,))
        if text is not None:
            conn.execute("INSERT INTO derived(version_id, text, locator, created_at) VALUES(?,?,?,?)",
                         (version_id, text, "chars", now()))
            conn.execute("INSERT INTO search_index(body, title, version_id, source_id, library_id) "
                         "VALUES(?,?,?,?,?)", (text, name, version_id, source_id, library_id))
    return {"source": get_source(store, source_id), "version_id": version_id,
            "status": status, "indexed": text is not None, "unchanged": False}


def list_sources(store: Store, library_id: str, *, include_archived: bool = False) -> list[dict]:
    with store.read() as conn:
        rows = conn.execute(
            "SELECT s.*, v.id AS version_id, v.sha256, v.size FROM sources s "
            "LEFT JOIN versions v ON v.id=(SELECT id FROM versions WHERE source_id=s.id "
            "ORDER BY created_at DESC LIMIT 1) WHERE s.library_id=?" +
            ("" if include_archived else " AND s.archived_at IS NULL") + " ORDER BY s.path",
            (library_id,)).fetchall()
    return [{
        "id": row["id"], "library_id": row["library_id"], "path": row["path"], "title": row["title"],
        "kind": row["kind"], "status": row["status"], "archived_at": row["archived_at"],
        "version_id": row["version_id"], "sha256": row["sha256"], "size": row["size"],
    } for row in rows]


def get_source(store: Store, source_id: str, *, include_archived: bool = False) -> dict:
    with store.read() as conn:
        row = conn.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
        if row is None or (row["archived_at"] and not include_archived):
            raise NotFound(f"资料不存在：{source_id}")
        version = conn.execute("SELECT id, sha256 FROM versions WHERE source_id=? "
                               "ORDER BY created_at DESC LIMIT 1", (source_id,)).fetchone()
    return {"id": row["id"], "library_id": row["library_id"], "path": row["path"], "title": row["title"],
            "kind": row["kind"], "status": row["status"], "archived_at": row["archived_at"],
            "version_id": version["id"] if version else None,
            "sha256": version["sha256"] if version else None}


def original_path(store: Store, source_id: str, version_id: str | None = None) -> tuple[Path, dict]:
    source = get_source(store, source_id, include_archived=True)
    with store.read() as conn:
        if version_id:
            row = conn.execute("SELECT sha256 FROM versions WHERE id=? AND source_id=?",
                               (version_id, source_id)).fetchone()
        else:
            row = conn.execute("SELECT sha256 FROM versions WHERE source_id=? "
                               "ORDER BY created_at DESC LIMIT 1", (source_id,)).fetchone()
    if row is None:
        raise NotFound("版本不存在")
    path = blob_path(store, source["library_id"], row["sha256"], source["title"])
    if not path.is_file():
        raise NotFound("原件缺失（可能被移动或删除）")
    return path, source


def read_text(store: Store, source_id: str, version_id: str | None = None) -> dict:
    source = get_source(store, source_id, include_archived=True)
    with store.read() as conn:
        if version_id is None:
            row = conn.execute(
                "SELECT v.id, v.sha256, d.text, d.locator FROM versions v "
                "LEFT JOIN derived d ON d.version_id=v.id WHERE v.source_id=? "
                "ORDER BY v.created_at DESC LIMIT 1", (source_id,)).fetchone()
        else:
            row = conn.execute(
                "SELECT v.id, v.sha256, d.text, d.locator FROM versions v "
                "LEFT JOIN derived d ON d.version_id=v.id WHERE v.id=? AND v.source_id=?",
                (version_id, source_id)).fetchone()
    if row is None:
        raise NotFound("版本不存在")
    if row["text"] is None:
        raise Conflict(f"该资料没有可读正文（状态：{source['status']}）")
    return {"source_id": source_id, "version_id": row["id"], "sha256": row["sha256"],
            "title": source["title"], "text": row["text"], "locator": row["locator"],
            "source_archived": source["archived_at"] is not None}


def archive_source(store: Store, source_id: str, archived: bool = True) -> dict:
    source = get_source(store, source_id, include_archived=True)
    with store.tx() as conn:
        conn.execute("UPDATE sources SET archived_at=?, updated_at=? WHERE id=?",
                     (now() if archived else None, now(), source_id))
        if archived:
            conn.execute("DELETE FROM search_index WHERE source_id=?", (source_id,))
        else:
            row = conn.execute("SELECT d.text, d.version_id FROM derived d JOIN versions v ON v.id=d.version_id "
                               "WHERE v.source_id=? ORDER BY v.created_at DESC LIMIT 1", (source_id,)).fetchone()
            if row:
                conn.execute("INSERT INTO search_index(body, title, version_id, source_id, library_id) "
                             "VALUES(?,?,?,?,?)",
                             (row["text"], source["title"], row["version_id"], source_id, source["library_id"]))
    return get_source(store, source_id, include_archived=True)


def reparse_source(store: Store, source_id: str) -> dict:
    """对单份「仅登记」的资料重试解析（如扫描件补上文本层、后装的解析器）。

    与 cli 的 `reparse` 同一口径：已索引的不动（要不要换由人显式决定），
    提取不出文本的仍保持 registered。只处理这一份，界面能就地修，不必去命令行。
    """
    source = get_source(store, source_id, include_archived=True)
    if source["archived_at"]:
        raise Conflict("资料已归档，先恢复再解析")
    if source["status"] == STATUS_INDEXED:
        raise Conflict("这份资料已经可检索，不需要重试解析")
    stored = blob_path(store, source["library_id"], source["sha256"] or "",
                       safe_name(source["path"]))
    if not stored.is_file():
        raise NotFound("原件不在预期位置，无法重新解析")
    result = import_source(store, source["library_id"], source["path"], stored.read_bytes(),
                           rel_path=source["path"], force=True, parse_pdf=True)
    return {"source": result["source"], "indexed": result["indexed"],
            "status": result["status"]}


def reindex(store: Store) -> dict:
    with store.tx() as conn:
        conn.execute("DELETE FROM search_index")
        rows = conn.execute(
            "SELECT d.text, d.version_id, s.id AS source_id, s.library_id, s.title FROM derived d "
            "JOIN versions v ON v.id=d.version_id JOIN sources s ON s.id=v.source_id "
            "WHERE s.archived_at IS NULL").fetchall()
        for row in rows:
            conn.execute("INSERT INTO search_index(body, title, version_id, source_id, library_id) "
                         "VALUES(?,?,?,?,?)",
                         (row["text"], row["title"], row["version_id"], row["source_id"], row["library_id"]))
    return {"indexed": len(rows)}


# ---------------------------------------------------------------- 内部


# 少于这个字符数基本是扫描件或只有页眉页脚，按「仅登记」处理
MIN_PDF_CHARS = 40
# 正文上限：trigram 索引对超长文本是 O(n²)，一份 400KB 的文档镜像能把导入卡住几分钟。
# 原件完整保存，只是派生正文与索引截断到这里。
MAX_TEXT_CHARS = 200_000
# 超大 PDF 多是扫描件：解析要几分钟、结果常为空，还占大量内存。先登记，需要时单独跑 reparse。
MAX_PDF_PARSE_BYTES = 32 * 1024 * 1024

# 单例：PdfTextParser 构造时探测 pypdf 是否可用，不必每次解析都探一遍
_pdf_parser = parsers.PdfTextParser()


def _extract(kind: str, data: bytes, *, parse_pdf: bool = True) -> tuple[str | None, str]:
    """按类型分派到 parsers 里的解析器。

    PDF 的文本层抽取逻辑只在 parsers.PdfTextParser 里有一份；
    这里只负责「该不该解析」与「结果算不算可检索」两个业务判断。
    """
    if kind == "pdf":
        if not parse_pdf:
            # 批量导入时先不解析：pypdf 单份要几十秒，会把导入拖成几十分钟。
            # 正文提取交给 cli 的 reparse，可单独跑、可单独看进度。
            return None, STATUS_REGISTERED
        if len(data) > MAX_PDF_PARSE_BYTES:
            # 超大 PDF 多是扫描件：解析要几分钟、结果常为空，还占大量内存
            return None, STATUS_REGISTERED
        result = _pdf_parser.parse("<inline>", data)
        text = result.text
        if text is None or len(text) < MIN_PDF_CHARS:
            # 扫描件没有文本层：保持 registered，不给一份空白正文让人以为能检索
            return None, STATUS_REGISTERED
        return text.replace("\r\n", "\n")[:MAX_TEXT_CHARS], STATUS_INDEXED
    if kind != "text":
        return None, STATUS_REGISTERED
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None, STATUS_UNDECODABLE
    return text.replace("\r\n", "\n")[:MAX_TEXT_CHARS], STATUS_INDEXED


def _find_source(store: Store, library_id: str, rel: str) -> dict | None:
    with store.read() as conn:
        row = conn.execute("SELECT * FROM sources WHERE library_id=? AND path=?",
                           (library_id, rel)).fetchone()
    return dict(row) if row else None


def _latest_sha(store: Store, source_id: str) -> str | None:
    with store.read() as conn:
        row = conn.execute("SELECT sha256 FROM versions WHERE source_id=? "
                           "ORDER BY created_at DESC LIMIT 1", (source_id,)).fetchone()
    return row["sha256"] if row else None


def _latest_version(store: Store, source_id: str) -> str | None:
    with store.read() as conn:
        row = conn.execute("SELECT id FROM versions WHERE source_id=? "
                           "ORDER BY created_at DESC LIMIT 1", (source_id,)).fetchone()
    return row["id"] if row else None


def _version_by_sha(conn, source_id: str, digest: str) -> str | None:
    row = conn.execute("SELECT id FROM versions WHERE source_id=? AND sha256=?",
                       (source_id, digest)).fetchone()
    return row["id"] if row else None


def attach_text(store: Store, source_id: str, text: str, *, origin: str = "mineru") -> dict:
    """把外部解析器（MinerU 等）产出的正文挂到某份已有资料上。

    两条设计判断：

    1. 不新建资料。MinerU 解的是同一份原件，路径、分类、引用都该保持一致；
       新建一条 md 资料会让原件与正文脱钩，库里凭空多出一倍条目。
    2. 不新建 version。version 代表「原件版本」，正文是派生；换解析器不动原件，
       否则原件哈希与正文来源会混在一起，导入判重也会误判。
    """
    body = str(text or "").replace("\r\n", "\n").strip()
    if not body:
        raise Invalid("正文为空，拒绝挂载")
    source = get_source(store, source_id)
    version_id = source.get("version_id")
    if not version_id:
        raise Conflict("这份资料还没有原件版本，先导入原件")

    chars = body[:MAX_TEXT_CHARS]
    with store.tx() as conn:
        conn.execute("DELETE FROM derived WHERE version_id=?", (version_id,))
        conn.execute("DELETE FROM search_index WHERE version_id=?", (version_id,))
        conn.execute("INSERT INTO derived(version_id, text, locator, created_at) VALUES(?,?,?,?)",
                     (version_id, chars, f"chars:{origin}", now()))
        conn.execute("INSERT INTO search_index(body, title, version_id, source_id, library_id) "
                     "VALUES(?,?,?,?,?)",
                     (chars, source["title"], version_id, source_id, source["library_id"]))
        conn.execute("UPDATE sources SET status=?, updated_at=? WHERE id=?",
                     (STATUS_INDEXED, now(), source_id))
    return {"source_id": source_id, "version_id": version_id, "chars": len(chars), "origin": origin}


# MinerU 的输出目录里，图片与调试产物不该被当成正文
_SKIP_DIRS = {"images", "image", "figures", "tables", "__pycache__"}


def _markdown_index(root: Path) -> dict[str, Path]:
    """递归找 .md，按文件名 stem 建索引。

    MinerU 默认结构是 `<输出>/<pdf名>/auto/<pdf名>.md`，所以同一 stem 可能命中
    多个文件：优先 auto/ 下的那份，其次取最新的。
    """
    found: dict[str, list[Path]] = {}
    for path in root.rglob("*.md"):
        if any(part.startswith(".") or part.lower() in _SKIP_DIRS for part in path.parts):
            continue
        if not path.is_file():
            continue
        found.setdefault(path.stem.lower(), []).append(path)

    index: dict[str, Path] = {}
    for stem, paths in found.items():
        auto = [item for item in paths if "auto" in {part.lower() for part in item.parts}]
        pool = auto or paths
        index[stem] = max(pool, key=lambda item: item.stat().st_mtime)
    return index


def attach_from_dir(store: Store, library_id: str, root: Path, *,
                    override_indexed: bool = False, dry_run: bool = False) -> dict:
    """把一整个 MinerU 输出目录按文件名匹配回库内资料。

    默认只补不可检索的资料（扫描件）：已经能检索的 PDF 用 pypdf 抽过正文，
    要不要换成 MinerU 的结果应当由人显式决定（override_indexed=True）。
    """
    sources = list_sources(store, library_id)
    by_stem: dict[str, dict] = {}
    for source in sources:
        stem = Path(source["path"]).stem.lower()
        # 同一 stem 多份时优先取不可检索的那份——那才是要修的
        current = by_stem.get(stem)
        if current is None or (current["status"] == STATUS_INDEXED
                               and source["status"] != STATUS_INDEXED):
            by_stem[stem] = source

    index = _markdown_index(root)
    matched, skipped_indexed, unmatched_sources = [], [], []
    matched_stems = set()

    for stem, source in sorted(by_stem.items()):
        markdown = index.get(stem)
        if markdown is None:
            if source["status"] != STATUS_INDEXED:
                unmatched_sources.append({"source_id": source["id"], "path": source["path"]})
            continue
        matched_stems.add(stem)
        if source["status"] == STATUS_INDEXED and not override_indexed:
            skipped_indexed.append({"source_id": source["id"], "path": source["path"],
                                    "md": str(markdown)})
            continue
        text = markdown.read_text(encoding="utf-8", errors="replace")
        if dry_run:
            matched.append({"source_id": source["id"], "path": source["path"],
                            "md": str(markdown), "chars": len(text), "applied": False})
            continue
        result = attach_text(store, source["id"], text)
        matched.append({"source_id": source["id"], "path": source["path"], "md": str(markdown),
                        "chars": result["chars"], "applied": True})

    return {
        "library_id": library_id,
        "markdown_files": len(index),
        "matched": matched,
        "skipped_indexed": skipped_indexed,
        "unmatched_markdown": [str(index[stem]) for stem in sorted(set(index) - matched_stems)],
        "unmatched_sources": unmatched_sources,
        "dry_run": dry_run,
    }
