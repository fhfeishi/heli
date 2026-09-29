"""新协议流水线（精简规格 §4–§6）：五步更新流、查询、恢复、备份。

与旧 pipeline.py（先删后写）并存；旧 CLI 未改造，不声称支持本协议。

规格落点对照：
- §4 五步：准备（写锁 + jobs 计划 + 配置/原文/卷空间校验）→ 构建（不可变快照 +
  复用解析 + 不可变版本/分片 + 候选向量）→ 核对（数量/sha/维度，候选不参与检索）
  → 切换（一个 SQL 事务）→ 清理（安全点删无当前来源使用的旧向量）。
- §3：version_id 只含内容/解析/分块摘要（模型更新不改变文本版本）；
  向量 metadata 只存 version_id 等内容身份，不存来源 URL。
- §5：DISTINCT version_id 前置过滤；空集直接返回空；缺向量阻止检索；
  jobs 四阶段；提交前失败继续旧版，提交后只补清理；GC 只在安全点。
- §2：显式改名保留来源 ID；未知路径按新来源；完整扫描才下线，访问失败不下线。

已知偏离（交付报告同步声明）：nav_positions/links 在 scan 事务落库（当前关系
声明可独立盘点），active 指针在切换事务落库；规格 §4-4 的「同事务」在本实现中
拆成 scan 事务 + switch 事务两段；当前目录与已索引内容可能来自不同时间，
调用方必须展示这种状态差异，不能称为完全等价。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
from pathlib import Path
import uuid
import threading
from functools import wraps
from datetime import datetime, timezone

from . import schema2
from .core import (
    PARSER_VERSION,
    Kb,
    KbError,
    embedding_fingerprint,
    is_ads,
    sha256_bytes,
)
from .pipeline import (
    H1_RE,
    HTML_H1_RE,
    LINK_RE,
    _link_candidates,
    _match_nav_source,
    _parse_llms_txt,
    _strip_header_noise,
    chunk_text,
    embed_texts,
)
from .vstore import open_store


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


class FaultInjected(RuntimeError):
    """测试钩子：模拟强制中断（进程死亡）。抛出时 jobs 行保持中断前阶段。"""


# ------------------------------------------------------------------ 标识


def _canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def parse_config_of(kb: Kb) -> dict:
    return {"parser_version": PARSER_VERSION, "strip_header_noise": True}


def chunk_config_of(kb: Kb) -> dict:
    return {**kb.cfg["chunking"], "algorithm_version": 3}


def parse_key_of(sha256: str, parse_config: dict) -> str:
    return hashlib.blake2b(
        _canon({"sha256": sha256, "parse": parse_config}).encode(), digest_size=16
    ).hexdigest()


def version_id_of(sha256: str, parse_key: str, chunk_config: dict) -> str:
    """完整摘要（blake2b-256）：内容 + 解析 + 分块；embedding 不在内（§3）。"""
    return hashlib.blake2b(
        _canon({"sha256": sha256, "parse_key": parse_key, "chunk": chunk_config}).encode(),
        digest_size=32,
    ).hexdigest()


def chunk_id_of(version_id: str, seq: int) -> str:
    return f"{version_id}-{seq:04d}"


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def new_collection_name(kb: Kb) -> str:
    """集合名 = 完整配置身份 + 新建实例 ID（§3）。"""
    return f"{kb.collection_name}-{uuid.uuid4().hex[:8]}"


def state_embedding_json(kb: Kb) -> dict:
    cfg = kb.cfg["embedding"]
    return {
        **cfg,
        "fingerprint": embedding_fingerprint(cfg),
        "hnsw": {
            "space": kb.cfg["vector_store"].get("distance", "cosine"),
            "ef_construction": 200,
            "max_neighbors": 32,
        },
    }


# ------------------------------------------------------------------ 写锁


_held_locks = threading.local()


class WriterLock:
    """每库单写入者（§5：一个后端持有进程级库独占锁；离线 CLI 停服后获取同一把锁）。

    WSL/Linux 使用 flock：进程强杀后系统自动释放；锁文件本身留作固定锚点。
    Windows 临时库锁文件首字节（msvcrt.locking），语义与 flock 一致；目标运行环境为 WSL 原生 ext4。
    """

    def __init__(self, kb: Kb):
        self.path = kb.root / "_writer.lock"
        self._fd = None
        self._key = str(kb.root.resolve())
        held = getattr(_held_locks, "entries", None)
        if held is None:
            held = _held_locks.entries = {}
        if self._key in held:
            held[self._key][1] += 1
            return
        if os.name == "posix":
            import fcntl

            fd = os.open(str(self.path), os.O_CREAT | os.O_RDWR, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as e:
                os.close(fd)
                raise KbError(f"已有写入者持有锁 {self.path}") from e
            try:
                os.ftruncate(fd, 0)
                os.write(fd, f"pid={os.getpid()} at={now_iso()}\n".encode())
            except Exception:
                os.close(fd)
                raise
            self._fd = fd
        else:
            # Windows 侧与 flock 语义对齐：锁文件留作常驻锚点，锁的是文件首字节
            # （进程退出由 OS 释放），不再用 O_EXCL —— 否则 WSL 侧遗留的锚点文件
            # 会把 Windows 临时库永久挡在门外。
            import msvcrt

            fd = os.open(str(self.path), os.O_CREAT | os.O_RDWR, 0o600)
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            except OSError as e:
                os.close(fd)
                raise KbError(f"已有写入者持有锁 {self.path}") from e
            try:
                os.ftruncate(fd, 0)
                os.write(fd, f"pid={os.getpid()} at={now_iso()}\n".encode())
            except Exception:
                os.close(fd)
                raise
            self._fd = fd

        held[self._key] = [self._fd, 1]

    def release(self) -> None:
        if self.path is None:
            return
        held = _held_locks.entries
        entry = held[self._key]
        entry[1] -= 1
        if entry[1]:
            self.path = None
            return
        del held[self._key]
        self._fd = entry[0]
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None
            self.path = None
            return
        try:
            self.path.unlink()
        except OSError:
            print(f"warn: 锁文件删除失败（挂载点限制？）：{self.path}")
        self.path = None


def storage_operation(fn):
    """同步本地接口共用一把可重入锁；忙时明确报错，不与发布/GC 交错。"""
    @wraps(fn)
    def guarded(kb, *args, **kwargs):
        lock = WriterLock(kb)
        try:
            return fn(kb, *args, **kwargs)
        finally:
            lock.release()
    return guarded


# ------------------------------------------------------------------ 扫描


def inventory(kb: Kb) -> dict:
    """旧库接管前的只读盘点；不打开向量引擎或创建数据库。"""
    if not kb.kb_json_path.is_file() or not kb.source_dir.is_dir():
        raise KbError(f"缺少 kb.json 或 source/：{kb.root}")
    source = {}
    for path in kb.source_dir.rglob("*"):
        if not path.is_file() or is_ads(path.name) or ".snapshots" in path.parts:
            continue
        rel = path.relative_to(kb.source_dir).as_posix()
        data = path.read_bytes()
        source[rel] = (sha256_bytes(data), len(data))

    manifest = {}
    if kb.manifest_path.is_file():
        with kb.manifest_path.open(encoding="utf-8") as fh:
            for line in fh:
                row = json.loads(line)
                path = row["path"]
                if path in manifest:
                    raise KbError(f"旧清单有重复路径：{path}")
                manifest[path] = (row.get("sha256"), row.get("bytes"))

    tables = []
    schema_format = None
    db_bytes = kb.db_path.stat().st_size if kb.db_path.is_file() else None
    if db_bytes:
        uri = kb.db_path.resolve().as_uri() + "?mode=ro"
        with sqlite3.connect(uri, uri=True) as conn:
            tables = sorted(row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ))
            if "meta" in tables:
                row = conn.execute(
                    "SELECT value FROM meta WHERE key='schema_format'"
                ).fetchone()
                schema_format = row[0] if row else None

    vector_files = sum(
        1 for p in kb.vectordb_dir.rglob("*") if p.is_file()
    ) if kb.vectordb_dir.is_dir() else 0
    return {
        "kb": kb.slug, "source_files": len(source),
        "manifest_rows": len(manifest) if kb.manifest_path.is_file() else None,
        "manifest_missing_source": sorted(set(manifest) - set(source))[:20],
        "source_unlisted": sorted(set(source) - set(manifest))[:20] if manifest else [],
        "manifest_mismatch": [p for p in sorted(set(source) & set(manifest))
                              if source[p] != manifest[p]][:20],
        "db_bytes": db_bytes, "db_tables": tables, "schema_format": schema_format,
        "vector_files": vector_files,
    }


@storage_operation
def scan_sources(kb: Kb, full: bool = True, site: str | None = None) -> dict:
    """把 source/ 的当前状态声明进 sources / nav_positions / links（一个事务）。

    - 未知路径 → 新来源（相同内容的不同来源分别建行；不做自动移动识别）
    - 已知路径内容变化 → 只更新 last_seen_sha256，active 指针不动（交给 update）
    - 完整扫描（full=True）才把缺失来源置 online=0；访问失败一律不下线
    - title/tags 是人工列，扫描只写 auto_title
    """
    if not kb.source_dir.exists():
        raise KbError(f"缺少源层 {kb.source_dir}")
    cfg = kb.cfg
    site = site or cfg.get("site") or ""
    nav_patterns = cfg["scan"]["nav_source_globs"]

    files: list[str] = []
    def scan_error(error):
        raise KbError(f"扫描目录失败，未提交下线：{error}")

    for dp, dns, fns in os.walk(kb.source_dir, onerror=scan_error):
        dns[:] = [d for d in dns if not d.startswith(".")]      # .snapshots 等不进扫描
        for fn in fns:
            if is_ads(fn):
                continue
            candidate = Path(dp) / fn
            if not candidate.resolve().is_relative_to(kb.source_dir.resolve()):
                raise KbError(f"源文件指向库外：{candidate}")
            files.append(os.path.relpath(os.path.join(dp, fn), kb.source_dir).replace("\\", "/"))
    files.sort()

    # 导航原始件：官方顺序与标题（留在原位，kind=nav_source）
    nav_title: dict[str, str] = {}
    manifest_index: dict[str, tuple[str, int]] = {}
    nav_source_paths: set[str] = set()
    for rel in files:
        if not _match_nav_source(rel, nav_patterns):
            continue
        nav_source_paths.add(rel)
        try:
            text = (kb.source_dir / rel).read_bytes().decode("utf-8", "replace")
        except OSError:
            continue
        if rel.endswith("llms.txt"):
            for url, title in _parse_llms_txt(text):
                nav_title.setdefault(url, title)
        elif rel.endswith("_manifest.json"):
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                continue
            for sec, urls in (data or {}).items():
                for i, u in enumerate(urls):
                    manifest_index.setdefault(u, (sec, i))

    conn = schema2.connect2(kb.db_path)
    existing = {
        r[1]: r[0]
        for r in conn.execute("SELECT source_id, path FROM sources WHERE path IS NOT NULL")
    }
    seen: set[str] = set()
    access_errors: list[str] = []
    new_ids: list[str] = []
    changed: list[str] = []
    nav_rows: list[tuple[str, str, int | None]] = []
    path_to_source: dict[str, str] = {}
    ts = now_iso()

    for rel in files:
        kind = "nav_source" if rel in nav_source_paths else "doc"
        try:
            data = (kb.source_dir / rel).read_bytes()
        except OSError:
            access_errors.append(rel)                            # 访问失败：不下线、不建新
            continue
        sha = sha256_bytes(data)
        seen.add(rel)
        text = data.decode("utf-8", "replace") if Path(rel).suffix.lower() != ".pdf" else ""
        url = (site + rel) if site else None
        title = None
        m = H1_RE.search(text)
        if m:
            title = m.group(1).strip()
        else:
            m2 = HTML_H1_RE.search(text)
            if m2:
                title = re.sub(r"<[^>]+>", "", m2.group(1)).strip()
        if title is None:
            title = os.path.splitext(os.path.basename(rel))[0]
        if url and url in nav_title:
            title = nav_title[url]
        sec, order = os.path.dirname(rel) or "", None
        if url and url in manifest_index:
            sec, order = manifest_index[url]

        sid = existing.get(rel)
        if sid is None:
            sid = _uid("src")
            conn.execute(
                "INSERT INTO sources (source_id, path, url, title, auto_title, tags, "
                "searchable, online, kind, last_seen_sha256, active_version_id, "
                "created_at, updated_at) VALUES (?,?,?,NULL,?, '[]', ?, 1, ?, ?, NULL, ?, ?)",
                (sid, rel, url, title, 0 if kind == "nav_source" else 1, kind, sha, ts, ts),
            )
            new_ids.append(sid)
        else:
            prev = conn.execute(
                "SELECT last_seen_sha256 FROM sources WHERE source_id=?", (sid,)
            ).fetchone()
            if prev and prev[0] and prev[0] != sha:
                changed.append(sid)
            conn.execute(
                "UPDATE sources SET auto_title=?, url=COALESCE(url,?), online=1, last_seen_sha256=?, "
                "updated_at=? WHERE source_id=?",
                (title, url, sha, ts, sid),
            )
        path_to_source[rel] = sid
        if kind == "doc":
            nav_rows.append((sid, sec, order))

    # 完整扫描：缺失 → online=0；存在但不可读（目录占位等）→ 访问失败，不下线
    offlined: list[str] = []
    if full:
        for path, sid in existing.items():
            if path in seen or path in access_errors:
                continue
            if path in nav_source_paths:
                continue
            if os.path.lexists(os.path.join(kb.source_dir, path)):
                access_errors.append(path)                       # 存在但读不了 ≠ 缺失
                continue
            conn.execute(
                "UPDATE sources SET online=0, updated_at=? WHERE source_id=? "
                "AND kind='doc'",
                (ts, sid),
            )
            offlined.append(sid)

    # 当前导航关系：本轮看到的 doc 来源，先清后写（同事务）
    if nav_rows:
        conn.executemany(
            "DELETE FROM nav_positions WHERE source_id=?",
            [(sid,) for sid, _s, _o in nav_rows],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO nav_positions (source_id, section, nav_order) "
            "VALUES (?,?,?)",
            nav_rows,
        )

    # 当前链接关系：只重建新增/变更来源的出边
    link_count = 0
    relink = [rel for rel, sid in path_to_source.items()
              if sid in set(new_ids) | set(changed) and rel not in nav_source_paths]
    for rel in relink:
        if Path(rel).suffix.lower() == ".pdf":
            continue
        sid = path_to_source[rel]
        conn.execute("DELETE FROM links WHERE src_source_id=?", (sid,))
        try:
            text = (kb.source_dir / rel).read_bytes().decode("utf-8", "replace")
        except OSError:
            continue
        base_dir = os.path.dirname(rel)
        for anchor, dst in LINK_RE.findall(text):
            for c in _link_candidates(dst, site, base_dir):
                tgt = path_to_source.get(c) or existing.get(c)
                if not tgt or tgt == sid:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO links (src_source_id, dst_source_id, anchor) "
                    "VALUES (?,?,?)",
                    (sid, tgt, anchor.strip()),
                )
                link_count += 1
                break

    conn.commit()
    conn.close()
    return {
        "files": len(files), "new": len(new_ids), "changed": len(changed),
        "offlined": len(offlined), "access_errors": access_errors,
        "nav_sources": len(nav_source_paths), "links_added": link_count,
    }


@storage_operation
def rename_source(kb: Kb, source_id: str, new_path: str) -> dict:
    """显式改名：保留 source_id 与 active 版本（短 SQL 事务，不重算向量）。

    新路径内容必须与当前版本一致；不一致是内容变更，走 scan + update。
    """
    from pathlib import PurePosixPath
    relative = PurePosixPath(new_path)
    f = kb.source_dir / new_path
    if (relative.is_absolute() or ".." in relative.parts or "\\" in new_path
            or any(part.startswith(".") for part in relative.parts)
            or not f.resolve().is_relative_to(kb.source_dir.resolve())):
        raise KbError("路径必须位于 source 内，且不能指向快照或隐藏目录")
    if not f.is_file():
        raise KbError(f"新路径不存在或不可读：{new_path}")
    sha = sha256_bytes(f.read_bytes())
    conn = schema2.connect2(kb.db_path)
    occupied = conn.execute("SELECT source_id FROM sources WHERE path=? AND source_id<>?",
                            (new_path, source_id)).fetchone()
    if occupied:
        conn.close()
        raise KbError("新路径已绑定其他来源；请先处理重复来源")
    row = conn.execute(
        "SELECT s.active_version_id, COALESCE(v.sha256,s.last_seen_sha256) FROM sources s "
        "LEFT JOIN versions v ON v.version_id = s.active_version_id "
        "WHERE s.source_id=?",
        (source_id,),
    ).fetchone()
    if not row:
        conn.close()
        raise KbError(f"来源不存在：{source_id}")
    if row[1] and row[1] != sha:
        conn.close()
        raise KbError("新路径内容与当前版本不一致；这是内容变更，请走 scan + update")
    conn.execute(
        "UPDATE sources SET path=?, last_seen_sha256=?, online=1, updated_at=? "
        "WHERE source_id=?",
        (new_path, sha, now_iso(), source_id),
    )
    conn.commit()
    conn.close()
    return {"source_id": source_id, "path": new_path}


# ------------------------------------------------------------------ 构建助手


def _snapshot(kb: Kb, data: bytes, sha: str) -> str:
    """写不可变原文快照 source/.snapshots/<2位>/<sha256>；已存在则校验字节一致。"""
    rel = f".snapshots/{sha[:2]}/{sha}"
    p = kb.source_dir / rel
    if p.exists():
        if sha256_bytes(p.read_bytes()) != sha:
            raise KbError(f"快照内容不一致（sha256 碰撞或损坏）：{rel}")
        return rel
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, p)
    return rel


def _parsed_doc(kb: Kb, data: bytes, sha: str, pkey: str, pcfg: dict) -> Path:
    """parsed/<parse_key>/document.md：同内容同解析配置直接复用（§3）。"""
    out = kb.parsed_dir / pkey
    doc = out / "document.md"
    meta_f = out / "meta.json"
    if doc.exists() and meta_f.exists():
        try:
            meta = json.loads(meta_f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            meta = {}
        if meta.get("sha256") == sha and meta.get("parse_config") == pcfg:
            return doc
    out.mkdir(parents=True, exist_ok=True)
    text = _strip_header_noise(data.decode("utf-8", "replace"))
    doc.write_text(text, encoding="utf-8")
    meta_f.write_text(
        json.dumps({"sha256": sha, "parse_config": pcfg, "parsed_at": now_iso()},
                   ensure_ascii=False, indent=1)
        + "\n",
        encoding="utf-8",
    )
    return doc


def _vector_count(store, vid: str) -> int:
    return len(store.get_ids_where({"version_id": vid}))


def _ensure_version_built(kb: Kb, conn, store, meta: dict, doc_path: Path,
                          chunk_cfg: dict) -> dict:
    """确保 versions/chunks 行存在且候选向量已在目标集合。→ {built, embedded}

    meta = {version_id, sha256, source_path, parse_key, parse_config( canon str)}。
    同内容同配置的版本已存在时整段复用：不重建 chunks、不重复 embedding（§3）。
    """
    vid = meta["version_id"]
    row = conn.execute(
        "SELECT chunk_count FROM versions WHERE version_id=?", (vid,)
    ).fetchone()
    built = embedded = 0
    if row is None:
        text = doc_path.read_text(encoding="utf-8")
        pieces = chunk_text(text, chunk_cfg["size"], chunk_cfg["overlap"],
                            chunk_cfg.get("breadcrumb_levels", 2))
        conn.execute(
            "INSERT INTO versions (version_id, sha256, source_path, parse_key, "
            "parse_config, chunk_config, chunk_count, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (vid, meta["sha256"], meta["source_path"], meta["parse_key"],
             meta["parse_config"], _canon(chunk_cfg), len(pieces), now_iso()),
        )
        conn.executemany(
            "INSERT INTO chunks (chunk_id, version_id, seq, text, char_start, char_end, "
            "breadcrumb) VALUES (?,?,?,?,?,?,?)",
            [(chunk_id_of(vid, i), vid, i, t, s, e, c)
             for i, (t, c, s, e) in enumerate(pieces)],
        )
        built = len(pieces)
        row = (len(pieces),)
    want = row[0]
    if _vector_count(store, vid) != want:
        got = conn.execute(
            "SELECT chunk_id, seq, text, breadcrumb FROM chunks WHERE version_id=? "
            "ORDER BY seq",
            (vid,),
        ).fetchall()
        ids = [g[0] for g in got]
        metas = [{
            "version_id": vid,                    # 只存内容身份（§3），不存来源 URL
            "kb_id": kb.slug,
            "embedding_model": embedding_fingerprint(kb.cfg["embedding"]),
            "granularity": "chunk",
        } for _ in got]
        store.add(ids, embed_texts([g[2] for g in got], kb.cfg["embedding"]),
                  [g[2] for g in got], metas)
        embedded = len(ids)
    return {"built": built, "embedded": embedded, "chunk_count": want}


def _check_candidates(kb: Kb, conn, store, cand: dict[str, str]) -> None:
    """核对（§4-3）：ID 集合、配置身份、原文定位；失败旧指针不变。"""
    store.refresh()                                   # 陷阱 2：核对前重开会话
    for sid, vid in cand.items():
        want = conn.execute(
            "SELECT chunk_count, sha256, source_path FROM versions WHERE version_id=?",
            (vid,),
        ).fetchone()
        got = _vector_count(store, vid)
        if got != want[0]:
            raise KbError(f"候选向量不完整：{vid[:12]}… 表 {want[0]} vs 引擎 {got}")
        snap = kb.source_dir / want[2]
        if sha256_bytes(snap.read_bytes()) != want[1]:
            raise KbError(f"版本内容与导入快照不一致：{vid[:12]}…")


def _gc_locked(kb: Kb, conn, store, current_collection: str) -> dict:
    """清理（§4-5）：安全点删无当前来源使用的旧向量 + 作废非当前集合。

    不删除历史原文、解析、SQL 分片及引用证据（versions/chunks 行保留）。
    失败向上抛，由调用方记录进 jobs 后重试；无论成败旧向量均不再可见
    （查询只过滤 active version）。
    """
    removed = 0
    inactive = conn.execute(
        "SELECT chunk_id FROM chunks WHERE version_id NOT IN "
        "(SELECT DISTINCT active_version_id FROM sources WHERE active_version_id IS NOT NULL)"
    ).fetchall()
    ids = [r[0] for r in inactive]
    for i in range(0, len(ids), 500):
        store.delete_ids(ids[i : i + 500])
        removed += len(ids[i : i + 500])
    store.refresh()
    dropped = []
    for c in store.list_collections():
        if c != current_collection:
            store.drop_collection(c)
            dropped.append(c)
    return {"vectors_removed": removed, "collections_dropped": dropped}


def _job_insert(conn, kind: str, source_ids: list[str], resume: str,
                candidate_collection: str | None = None) -> str:
    jid = _uid("job")
    ts = now_iso()
    conn.execute(
        "INSERT INTO jobs (job_id, kind, stage, sources, candidate_versions, "
        "candidate_collection, error, retry_plan, created_at, updated_at) "
        "VALUES (?,?, 'building', ?, '{}', ?, NULL, ?, ?, ?)",
        (jid, kind, json.dumps(source_ids), candidate_collection,
         json.dumps({"resume_from": resume}), ts, ts),
    )
    return jid


def _job_stage(conn, jid: str, stage: str, error: str | None = None,
               cand: dict | None = None) -> None:
    sets = "stage=?, updated_at=?"
    args: list = [stage, now_iso()]
    if error is not None:
        sets += ", error=?"
        args.append(error)
    if cand is not None:
        sets += ", candidate_versions=?"
        args.append(json.dumps(cand))
    args.append(jid)
    conn.execute(f"UPDATE jobs SET {sets} WHERE job_id=?", args)


def _disk_check(kb: Kb, need_bytes: int, free_override: int | None) -> None:
    free = free_override if free_override is not None else shutil.disk_usage(kb.root).free
    if free < need_bytes:
        raise KbError(
            f"目标卷空间不足：需要约 {need_bytes} B，可用 {free} B；旧版保留，未做任何写操作"
        )


def _ensure_state(kb: Kb, conn) -> dict:
    state = schema2.read_state(conn)
    if state is None:
        schema2.ensure_state(conn, new_collection_name(kb), state_embedding_json(kb))
        conn.commit()
        state = schema2.read_state(conn)
    return state


def _changed_targets(kb: Kb, conn) -> list[tuple[str, str]]:
    """需要新版本的来源：[(source_id, path, last_seen_sha256)]。

    触发面有两类（缺一不可）：
    - 新来源 / last_seen 与 active 版本内容不一致（内容变更）
    - 当前配置摘要出的 version_id 与 active 不一致（解析/分块配置变更）
    """
    rows = conn.execute(
        "SELECT s.source_id, s.path, s.last_seen_sha256, s.active_version_id FROM sources s "
        "WHERE s.kind='doc' AND s.searchable=1 AND s.online=1 AND s.path IS NOT NULL"
    ).fetchall()
    pcfg = parse_config_of(kb)
    ccfg = chunk_config_of(kb)
    out = []
    for sid, path, sha, active in rows:
        if not sha:
            out.append((sid, path, sha))
            continue
        want = version_id_of(sha, parse_key_of(sha, pcfg), ccfg)
        if active != want:
            out.append((sid, path, sha))
    return out


# ------------------------------------------------------------------ 更新流


@storage_operation
def update(kb: Kb, fail_at: str | None = None, disk_free_override: int | None = None) -> dict:
    """五步更新流（§4）。fail_at ∈ {build, switch, cleanup} 为测试强制中断钩子。"""
    recover(kb)                                        # 启动核对（幂等）
    lock = WriterLock(kb)
    try:
        conn = schema2.connect2(kb.db_path)
        state = _ensure_state(kb, conn)
        cur_fp = state["embedding"]["fingerprint"]
        want_fp = embedding_fingerprint(kb.cfg["embedding"])
        if cur_fp != want_fp:
            conn.close(); lock.release()
            model_switch(kb, fail_at=fail_at, disk_free_override=disk_free_override)
            return update(kb, fail_at=fail_at, disk_free_override=disk_free_override)

        targets = _changed_targets(kb, conn)
        if not targets:
            conn.close()
            return {"updated": 0}
        source_ids = [t[0] for t in targets]
        jid = _job_insert(conn, "update", source_ids, "build")
        conn.commit()                                   # 计划先落库：中断后可恢复

        try:
            # -- 准备：配置 / 原文 / 卷空间 -------------------------------
            payloads: dict[str, tuple[bytes, str]] = {}
            need = 0
            for sid, rel, _sha in targets:
                data = (kb.source_dir / rel).read_bytes()     # 访问失败 → 任务失败，旧版不变
                payloads[sid] = (data, sha256_bytes(data))
                need += len(data) * 2
            dim = int(kb.cfg["embedding"].get("dim") or 0)
            need += len(targets) * 64 * max(dim, 1) * 4 * 3   # 向量 + 索引余量估算
            _disk_check(kb, need, disk_free_override)

            # -- 构建：不可变快照 + 复用解析 + 不可变版本 + 候选向量 --------
            store = open_store(kb, collection=state["collection"])
            cand: dict[str, str] = {}
            stats = {"snapshots": 0, "versions_built": 0, "embedded": 0, "reused": 0}
            pcfg = parse_config_of(kb)
            ccfg = chunk_config_of(kb)
            for sid, rel, _sha in targets:
                data, sha = payloads[sid]
                snap_rel = _snapshot(kb, data, sha)
                stats["snapshots"] += 1
                pkey = parse_key_of(sha, pcfg)
                doc_path = _parsed_doc(kb, data, sha, pkey, pcfg)
                vid = version_id_of(sha, pkey, ccfg)
                meta = {"version_id": vid, "sha256": sha, "source_path": snap_rel,
                        "parse_key": pkey, "parse_config": _canon(pcfg)}
                r = _ensure_version_built(kb, conn, store, meta, doc_path, ccfg)
                stats["versions_built"] += r["built"]
                stats["embedded"] += r["embedded"]
                stats["reused"] += 0 if (r["built"] or r["embedded"]) else 1
                cand[sid] = vid
            _job_stage(conn, jid, "building", cand=cand)
            conn.commit()

            if fail_at == "build":
                raise FaultInjected("候选写入后强制中断")

            # -- 核对 ------------------------------------------------------
            _check_candidates(kb, conn, store, cand)

            # -- 切换：一个 SQL 事务 ---------------------------------------
            ts = now_iso()
            for sid, vid in cand.items():
                conn.execute(
                    "UPDATE sources SET active_version_id=?, updated_at=? WHERE source_id=?",
                    (vid, ts, sid),
                )
            conn.execute("UPDATE kb_state SET last_committed_job=? WHERE id=1", (jid,))
            _job_stage(conn, jid, "committed")
            conn.commit()

            if fail_at == "switch":
                raise FaultInjected("SQL 切换后强制中断")
        except FaultInjected:
            conn.commit()
            raise
        except Exception as e:
            _job_stage(conn, jid, "failed", error=str(e))
            conn.execute(
                "UPDATE jobs SET retry_plan=? WHERE job_id=?",
                (json.dumps({"resume_from": "build"}), jid),
            )
            conn.commit()
            raise

        # -- 清理：安全点删旧向量（失败另报，job 保持 committed 待补） --------
        try:
            gc_report = _gc_locked(kb, conn, store, state["collection"])
        except Exception as e:
            _job_stage(conn, jid, "committed", error=f"清理失败待重试：{e}")
            conn.commit()
            raise KbError(f"更新已提交，清理失败（重启后自动补清理）：{e}")
        _job_stage(conn, jid, "done")
        conn.commit()
        store.close()
        conn.close()
        return {"updated": len(targets), "job": jid, **stats, **gc_report}
    finally:
        lock.release()


@storage_operation
def model_switch(kb: Kb, fail_at: str | None = None,
                 disk_free_override: int | None = None) -> dict:
    """换模型/换不可变索引配置：完整建好新集合实例才切换（§4、§5）。"""
    lock = WriterLock(kb)
    try:
        conn = schema2.connect2(kb.db_path)
        state = _ensure_state(kb, conn)
        new_emb = state_embedding_json(kb)
        if new_emb["fingerprint"] == state["embedding"]["fingerprint"]:
            conn.close()
            return {"switched": 0, "reason": "指纹一致，无需切换"}
        vids = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT active_version_id FROM sources "
                "WHERE active_version_id IS NOT NULL AND searchable=1 AND online=1"
            )
        ]
        jid = _job_insert(conn, "model_switch", [], "build",
                          candidate_collection=new_collection_name(kb))
        conn.commit()
        try:
            dim = int(kb.cfg["embedding"].get("dim") or 0)
            total_chunks = conn.execute(
                "SELECT COALESCE(SUM(chunk_count),0) FROM versions WHERE version_id IN "
                f"({','.join('?' * len(vids)) or "''"})",
                vids,
            ).fetchone()[0] if vids else 0
            _disk_check(kb, total_chunks * max(dim, 1) * 4 * 3 + (1 << 20), disk_free_override)

            cand_name = conn.execute(
                "SELECT candidate_collection FROM jobs WHERE job_id=?", (jid,)
            ).fetchone()[0]
            cand_store = open_store(kb, collection=cand_name)
            for vid in vids:
                got = conn.execute(
                    "SELECT chunk_id, text, breadcrumb FROM chunks WHERE version_id=? "
                    "ORDER BY seq",
                    (vid,),
                ).fetchall()
                metas = [{"version_id": vid, "kb_id": kb.slug,
                          "embedding_model": new_emb["fingerprint"],
                          "granularity": "chunk"} for _ in got]
                cand_store.add([g[0] for g in got],
                               embed_texts([g[1] for g in got], kb.cfg["embedding"]),
                               [g[1] for g in got], metas)

            if fail_at == "build":
                raise FaultInjected("换模型候选写入后强制中断")

            cand_store.refresh()
            for vid in vids:
                want = conn.execute(
                    "SELECT chunk_count FROM versions WHERE version_id=?", (vid,)
                ).fetchone()[0]
                got = len(cand_store.get_ids_where({"version_id": vid}))
                if got != want:
                    raise KbError(f"新集合候选不完整：{vid[:12]}… 表 {want} vs 引擎 {got}")

            conn.execute(
                "UPDATE kb_state SET collection=?, embedding=?, last_committed_job=? "
                "WHERE id=1",
                (cand_name, json.dumps(new_emb, ensure_ascii=False), jid),
            )
            _job_stage(conn, jid, "committed")
            conn.commit()

            if fail_at == "cleanup":
                raise FaultInjected("换模型切换后强制中断")
        except FaultInjected:
            conn.commit()
            raise
        except Exception as e:
            _job_stage(conn, jid, "failed", error=str(e))
            conn.commit()
            raise

        # 清理旧集合（失败另报，job 保持 committed 待补）
        try:
            gc_report = _gc_locked(kb, conn, cand_store, cand_name)
        except Exception as e:
            _job_stage(conn, jid, "committed", error=f"清理失败待重试：{e}")
            conn.commit()
            raise KbError(f"切换已提交，旧集合清理失败（重启后自动补）：{e}")
        _job_stage(conn, jid, "done")
        conn.commit()
        cand_store.close()
        conn.close()
        return {"switched": 1, "collection": cand_name, "versions": len(vids),
                **gc_report}
    finally:
        lock.release()


# ------------------------------------------------------------------ 恢复 / GC


@storage_operation
def recover(kb: Kb) -> dict:
    """启动核对（§5）：提交前失败继续旧版；提交后只补清理；缺向量上报。

    幂等：每次 update/query 前都可调用。
    """
    if not kb.db_path.exists():
        return {"building_failed": 0, "cleanup_resumed": 0, "missing_vectors": []}
    conn = schema2.connect2(kb.db_path)
    state = schema2.read_state(conn)
    report = {"building_failed": 0, "cleanup_resumed": 0, "missing_vectors": []}
    rows = conn.execute("SELECT job_id, stage FROM jobs WHERE stage IN ('building','committed')").fetchall()
    building = [r[0] for r in rows if r[1] == "building"]
    committed = [r[0] for r in rows if r[1] == "committed"]
    for jid in building:
        _job_stage(conn, jid, "failed",
                   error="中断于提交前；继续旧版（候选产物保留，可重试）")
        report["building_failed"] += 1
    conn.commit()
    if committed and state:
        store = open_store(kb, collection=state["collection"])
        for jid in committed:
            try:
                _gc_locked(kb, conn, store, state["collection"])
                _job_stage(conn, jid, "done")
                conn.commit()
                report["cleanup_resumed"] += 1
            except Exception as e:
                _job_stage(conn, jid, "committed", error=f"补清理仍失败：{e}")
                conn.commit()
        store.close()
    # 当前指针所需向量核对：缺失只上报；query() 会据此拒绝检索
    if state:
        store = open_store(kb, collection=state["collection"])
        store.refresh()
        actual = store.version_counts()
        missing = []
        for vid, want in conn.execute(
            "SELECT DISTINCT s.active_version_id, v.chunk_count FROM sources s "
            "JOIN versions v ON v.version_id=s.active_version_id "
            "WHERE s.searchable=1 AND s.online=1 AND s.active_version_id IS NOT NULL"
        ):
            if actual.get(vid, 0) != want:
                missing.append(vid)
        store.close()
        report["missing_vectors"] = missing
    conn.close()
    return report


@storage_operation
def gc(kb: Kb) -> dict:
    """手动 GC：只在安全点（无未完成更新任务）运行（§5）。"""
    conn = schema2.connect2(kb.db_path)
    pending = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE stage IN ('building','committed')"
    ).fetchone()[0]
    if pending:
        conn.close()
        raise KbError(f"有 {pending} 个未完成任务；恢复或明确终止前不启动 GC")
    state = _ensure_state(kb, conn)
    conn.close()
    lock = WriterLock(kb)
    try:
        conn = schema2.connect2(kb.db_path)
        store = open_store(kb, collection=state["collection"])
        report = _gc_locked(kb, conn, store, state["collection"])
        store.close()
        conn.close()
        return report
    finally:
        lock.release()


# ------------------------------------------------------------------ 查询 / 引用


@storage_operation
def query(kb: Kb, text: str, n: int = 5, scope: dict | None = None) -> list[dict]:
    """§5 查询：DISTINCT version 前置过滤 → 向量检索 → 映射回范围内来源。

    空范围直接返回空；当前指针所需向量缺失时拒绝检索（不宣称跨引擎原子持久化）。
    """
    if scope and any(key in scope and not scope[key] for key in ("source_ids", "sections")):
        return []
    recovery = recover(kb)
    conn = schema2.connect2(kb.db_path)
    state = schema2.read_state(conn)
    if state is None:
        conn.close()
        raise KbError("语义索引尚未建立；可先浏览原文，或运行 v2-update")
    scope_sql = ("FROM sources s WHERE s.kind='doc' AND s.searchable=1 AND s.online=1 "
                 "AND s.active_version_id IS NOT NULL")
    args: list = []
    if scope and scope.get("source_ids"):
        scope_sql += f" AND s.source_id IN ({','.join('?' * len(scope['source_ids']))})"
        args += list(scope["source_ids"])
    if scope and scope.get("sections"):
        scope_sql += (" AND s.source_id IN (SELECT source_id FROM nav_positions WHERE section IN ("
                      + ",".join("?" * len(scope["sections"])) + "))")
        args += list(scope["sections"])
    allowed = {r[0] for r in conn.execute("SELECT s.source_id " + scope_sql, args)}
    vids = [r[0] for r in conn.execute("SELECT DISTINCT s.active_version_id " + scope_sql, args)]
    if not vids:
        conn.close()
        return []

    store = open_store(kb, collection=state["collection"])
    store.refresh()
    missing = set(recovery["missing_vectors"]).intersection(vids)
    if missing:
        store.close(); conn.close()
        raise KbError(f"当前指针所需向量缺失：{next(iter(missing))[:12]}…；先重建再检索")

    emb = embed_texts([text], kb.cfg["embedding"])[0]
    hits = store.query(emb, max(n * 3, n), where={"version_id": {"$in": vids}})[:n]
    out = []
    for h in hits:
        row = conn.execute(
            "SELECT c.text, c.breadcrumb, c.char_start, c.char_end, c.version_id FROM chunks c "
            "WHERE c.chunk_id=?",
            (h["id"],),
        ).fetchone()
        if not row:
            continue
        srcs = conn.execute(
            "SELECT source_id, COALESCE(title, auto_title), path, url FROM sources "
            "WHERE active_version_id=? AND searchable=1 AND online=1",
            (row[4],),
        ).fetchall()
        srcs = [s for s in srcs if s[0] in allowed]
        for s in srcs:
            out.append({
                "chunk_id": h["id"], "distance": round(h["distance"], 6),
                "text": row[0], "breadcrumb": row[1],
                "char_start": row[2], "char_end": row[3],
                "version_id": row[4],
                "source_id": s[0], "title": s[1], "path": s[2], "url": s[3],
            })
    store.close()
    conn.close()
    out.sort(key=lambda r: r["distance"])
    return out[:n]


@storage_operation
def save_citation(kb: Kb, source_id: str, chunk_id: str) -> dict:
    """保存引用快照：当时标题/URL/摘录/位置一并持久化（§3）。

    读取历史引用不回取 sources 的最新标题或 URL —— 旧引用不变义。
    """
    conn = schema2.connect2(kb.db_path)
    row = conn.execute(
        "SELECT s.source_id, COALESCE(s.title, s.auto_title), s.url, "
        "c.version_id, c.text, c.char_start, c.char_end FROM sources s, chunks c "
        "WHERE s.source_id=? AND c.chunk_id=? AND s.active_version_id=c.version_id AND s.online=1",
        (source_id, chunk_id),
    ).fetchone()
    if not row:
        conn.close()
        raise KbError(f"来源或分片不存在：{source_id} / {chunk_id}")
    cid = _uid("cit")
    conn.execute(
        "INSERT INTO citations (citation_id, source_id, version_id, chunk_id, title, url, "
        "excerpt, char_start, char_end, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (cid, row[0], row[3], chunk_id, row[1], row[2], row[4], row[5], row[6], now_iso()),
    )
    conn.commit()
    conn.close()
    return {"citation_id": cid, "source_id": row[0], "version_id": row[3],
            "chunk_id": chunk_id, "title": row[1], "url": row[2]}


# ------------------------------------------------------------------ 备份 / 恢复核对


@storage_operation
def backup(kb: Kb, dest: str | os.PathLike) -> dict:
    """停写后的整库副本（§5）。SQLite 用 backup API 保证一致性；向量层整目录复制。"""
    lock = WriterLock(kb)
    try:
        dest = os.fspath(dest)
        if os.path.exists(dest) and os.listdir(dest):
            raise KbError(f"备份目标非空：{dest}；不覆盖唯一副本试验")
        os.makedirs(dest, exist_ok=True)
        for name in ("kb.json",):
            src = kb.root / name
            if src.exists():
                shutil.copy2(src, os.path.join(dest, name))
        for d in ("source", "parsed", "vectordb", "target"):
            src = kb.root / d
            if src.exists():
                shutil.copytree(src, os.path.join(dest, d))
        if kb.db_path.exists():
            os.makedirs(os.path.join(dest, "datadb"), exist_ok=True)
            src_conn = sqlite3.connect(str(kb.db_path))
            dst_conn = sqlite3.connect(os.path.join(dest, "datadb", "kb.db"))
            src_conn.backup(dst_conn)
            dst_conn.close(); src_conn.close()
        return {"dest": dest}
    finally:
        lock.release()


@storage_operation
def restore_check(kb: Kb) -> dict:
    """独立位置的恢复核对（§5、验收 C）：原文哈希、引用、当前版本及向量。

    缺向量 → 调用方必须先重建再允许检索（query() 会强制此约束）。
    """
    report = {"bad_snapshots": [], "bad_citations": [], "missing_vectors": [], "ok": False}
    conn = schema2.connect2(kb.db_path)
    for vid, sha, rel in conn.execute("SELECT version_id, sha256, source_path FROM versions"):
        p = kb.source_dir / rel
        if not p.exists() or sha256_bytes(p.read_bytes()) != sha:
            report["bad_snapshots"].append(vid)
    for cid, vid in conn.execute("SELECT citation_id, version_id FROM citations"):
        if not conn.execute("SELECT 1 FROM versions WHERE version_id=?", (vid,)).fetchone():
            report["bad_citations"].append(cid)
    state = schema2.read_state(conn)
    if state:
        store = open_store(kb, collection=state["collection"])
        store.refresh()
        for vid, want in conn.execute(
            "SELECT DISTINCT s.active_version_id, v.chunk_count FROM sources s "
            "JOIN versions v ON v.version_id=s.active_version_id "
            "WHERE s.searchable=1 AND s.online=1 AND s.active_version_id IS NOT NULL"
        ):
            if len(store.get_ids_where({"version_id": vid})) != want:
                report["missing_vectors"].append(vid)
        store.close()
    else:
        report["missing_vectors"] = ["<no kb_state>"]
    conn.close()
    report["ok"] = (
        not report["bad_snapshots"] and not report["bad_citations"]
        and not report["missing_vectors"]
    )
    return report
