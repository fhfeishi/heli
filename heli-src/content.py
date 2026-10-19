"""content：文件接入、解析与原文读取。

原则：
- 原件按**内容哈希**存放（同一路径改了内容不会覆盖旧版本，引用仍能回到当时那一版）；
- 原件、派生正文、模型结果分开保存；
- 不能解析的资料仍是合法资料（`registered`），绝不解码成乱码冒充正文；
- 先落文件、后发布数据库记录。
"""
from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path

try:  # 可选依赖：没装 pypdf 时 PDF 一律只登记，不假装能读
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None

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


def _extract_pdf(data: bytes) -> tuple[str | None, str]:
    """提取 PDF 文本层。

    扫描件没有文本层，抽出来是空的——这种情况保持 registered，
    宁可显示「仅登记」，也不给一份空白正文让人以为已经能检索。
    """
    if PdfReader is None:
        return None, STATUS_REGISTERED
    if len(data) > MAX_PDF_PARSE_BYTES:
        return None, STATUS_REGISTERED
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            return None, STATUS_REGISTERED
        pages = []
        for page in reader.pages:
            try:
                pages.append((page.extract_text() or "").strip())
            except Exception:
                pages.append("")
    except Exception:
        return None, STATUS_REGISTERED
    text = "\n\n".join(part for part in pages if part)
    if len(text) < MIN_PDF_CHARS:
        return None, STATUS_REGISTERED
    return text.replace("\r\n", "\n")[:MAX_TEXT_CHARS], STATUS_INDEXED


def _extract(kind: str, data: bytes, *, parse_pdf: bool = True) -> tuple[str | None, str]:
    if kind == "pdf":
        return _extract_pdf(data) if parse_pdf else (None, STATUS_REGISTERED)
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
