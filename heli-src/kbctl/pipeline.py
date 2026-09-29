"""九步管道中的 3–7 步：scan / parse / chunk / embed / gc（§4.1、§4.2、§4.3）。

不变量在代码里的落点：

- **I2 重跑 = 先清后写**：`chunk` 与 `embed` 都走 `_purge_doc_chunks()`，
  顺序固定为「先枚举旧 id → 删向量 → 删表行 → 写新行/新向量」（陷阱 1）。
- **I3 列级写所有权**：每个阶段只调用 `upsert_columns(..., stage="<阶段名>")`，
  写不属于自己的列会直接抛错，从机制上杜绝 scan 整行 REPLACE 把 status 清掉。
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from . import schema
from .core import (
    PARSER_VERSION,
    Kb,
    KbError,
    chunk_id,
    doc_id,
    is_ads,
    sha256_bytes,
)
from .vstore import open_store

MIME_BY_EXT = {".md": "text/markdown", ".txt": "text/plain", ".json": "application/json"}

# §7.6 抓取脚本注入的头部噪声：不剥离会让所有文档的首 chunk 长得一样
NOISE_RE = re.compile(
    r"^(>\s*##\s*Documentation Index.*|>\s*Fetch the complete documentation index.*"
    r"|>\s*Use this file to discover.*)\s*$"
)
LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.M)
HTML_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S | re.I)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ------------------------------------------------------------------ 清单


def load_manifest(kb: Kb) -> list[dict]:
    if not kb.manifest_path.exists():
        return []
    return [json.loads(l) for l in kb.manifest_path.read_text(encoding="utf-8").splitlines() if l.strip()]


def _match_nav_source(rel: str, patterns: list[str]) -> bool:
    base = os.path.basename(rel)
    for pat in patterns:
        if pat.startswith("**/"):
            if fnmatch.fnmatch(base, pat[3:]):
                return True
        elif "/" in pat:
            if fnmatch.fnmatch(rel, pat):
                return True
        elif fnmatch.fnmatch(base, pat):
            return True
    return False


def _text_stats(text: str) -> tuple[int, float, int, int]:
    """(非空行数, html_density, 正文行数, 标题行数)。

    html_density = 含 '<' 的非空行占比（与既有 sitemap 口径一致，实测可复现）。
    正文行数 = 不含 '<' 的非空行，用来把「整页 HTML 转储」和「带组件的正常文档」分开：
    前者正文行数为 0（纯导航壳），后者有真实正文。
    """
    nonempty = [l for l in text.splitlines() if l.strip()]
    if not nonempty:
        return 0, 0.0, 0, 0
    hit = sum(1 for l in nonempty if "<" in l)
    heads = sum(1 for l in nonempty if l.startswith("#"))
    # 四舍五入（实测对照既有 sitemap：1423 篇里 51 篇差 0.01，均为浮点边界；
    # 截断口径会差到 503 篇，故采用四舍五入）
    return len(nonempty), round(hit / len(nonempty), 2), len(nonempty) - hit, heads


def _parse_llms_txt(text: str) -> list[tuple[str, str]]:
    """→ [(url, title)]，顺序即官方顺序。"""
    out = []
    for line in text.splitlines():
        m = re.match(r"^\s*-\s+\[([^\]]*)\]\(([^)]+)\)", line)
        if m:
            out.append((m.group(2).strip(), m.group(1).strip()))
    return out


def _strip_site(url: str, site: str) -> str | None:
    if site and url.startswith(site):
        return url[len(site):]
    return None


def scan(kb: Kb, site: str | None = None, with_db: bool = True) -> dict:
    """第 3a + 3b 步。

    3a：写 `manifest.jsonl` / `nav.json` / `links.jsonl`
    3b：按列级所有权回写 `documents` 的结构列（§4.1 新增的显式步骤）
    """
    if not kb.source_dir.exists():
        raise KbError(f"缺少源层 {kb.source_dir}")
    cfg = kb.cfg
    site = site or cfg.get("site") or ""
    nav_patterns = cfg["scan"]["nav_source_globs"]
    nav_only_cfg = cfg["scan"]["nav_only"]

    files: list[str] = []
    for dp, _dns, fns in os.walk(kb.source_dir):
        for fn in fns:
            if is_ads(fn):
                continue
            files.append(os.path.relpath(os.path.join(dp, fn), kb.source_dir).replace("\\", "/"))
    files.sort()

    # ---- 先读导航原始件（留在 source/ 原位，§2.2 变化 2）----
    nav_title: dict[str, str] = {}      # url -> title（llms.txt）
    manifest_index: dict[str, tuple[str, int]] = {}   # url -> (section, order)
    nav_source_paths: set[str] = set()
    for rel in files:
        if not _match_nav_source(rel, nav_patterns):
            continue
        nav_source_paths.add(rel)
        raw = (kb.source_dir / rel).read_bytes()
        text = raw.decode("utf-8", "replace")
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

    # ---- 逐文件建清单 ----
    rows: list[dict] = []
    by_doc_id: dict[str, dict] = {}
    path_index: dict[str, str] = {}      # rel path -> doc_id
    collisions: list[str] = []

    for rel in files:
        data = (kb.source_dir / rel).read_bytes()
        sha = sha256_bytes(data)
        did = doc_id(data)
        if did in by_doc_id and by_doc_id[did]["sha256"] != sha:
            collisions.append(did)      # §3.1：碰撞或哈希实现变更 → 硬失败
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = ""
        lines_n, density, prose_n, head_n = _text_stats(text)
        url = (site + rel) if site else ""
        sec, order, order_source = None, None, None
        if url in manifest_index:
            sec, order = manifest_index[url]
            order_source = "manifest"
        title, title_source = None, None
        if url in nav_title:
            title, title_source = nav_title[url], "llms.txt"
        if title is None:
            m = H1_RE.search(text)
            if m:
                title, title_source = m.group(1).strip(), "h1"
            else:
                # 组件壳页的标题常写在 <h1 class="..."> 里
                m2 = HTML_H1_RE.search(text)
                if m2:
                    title = re.sub(r"<[^>]+>", "", m2.group(1)).strip()
                    title_source = "h1"
                else:
                    title, title_source = os.path.splitext(os.path.basename(rel))[0], "filename"
        if sec is None:
            sec = os.path.dirname(rel) or ""

        kind = "nav_source" if rel in nav_source_paths else "doc"
        # 索引页污染过滤（§7.2）：整页 HTML 转储（正文行 0）或「高密度 + 几乎无正文 + 无标题」的壳页
        vc = "nav_only" if kind == "nav_source" else (
            "nav_only" if (prose_n == 0
                           or (density >= nav_only_cfg["html_density"]
                               and prose_n <= nav_only_cfg["max_prose_lines"]
                               and head_n == 0)) else "doc"
        )
        row = {
            "doc_id": did,
            "path": rel,
            "sha256": sha,
            "bytes": len(data),
            "mime": MIME_BY_EXT.get(os.path.splitext(rel)[1].lower(), "application/octet-stream"),
            "title": title,
            "title_source": title_source,
            "section": sec,
            "order": order,
            "order_source": order_source,
            "url": url or None,
            "kind": kind,
            "value_class": vc,
            "lines": lines_n,
            "prose_lines": prose_n,
            "html_density": density,
        }
        rows.append(row)
        by_doc_id[did] = row
        path_index[rel] = did

    if collisions:
        raise KbError(
            "doc_id 碰撞或哈希实现变更（同一 doc_id 对应不同 sha256），硬失败："
            f"{sorted(set(collisions))[:5]}"
        )

    # ---- nav.json：只留顺序骨架 section → [{doc_id, order}]（不重复 title/path）----
    sections: dict[str, list[dict]] = {}
    for r in rows:
        if r["kind"] == "nav_source":
            continue
        sections.setdefault(r["section"], []).append(
            {"doc_id": r["doc_id"], "order": r["order"]}
        )
    nav = {
        "site": site,
        "generated_at": now_iso(),
        "assumption": "tree",
        "sections": {k: sorted(v, key=lambda x: (x["order"] is None, x["order"] or 0,
                                                 x["doc_id"])) for k, v in sorted(sections.items())},
    }

    # ---- links.jsonl：站内链接，dst 试 .md / /index.md 三种写法（§7.7）----
    links: list[dict] = []
    seen_links: set[tuple[str, str, str]] = set()
    for r in rows:
        if r["kind"] != "doc" or r["value_class"] == "nav_only":
            continue
        rel = r["path"]
        base_dir = os.path.dirname(rel)
        text = (kb.source_dir / rel).read_bytes().decode("utf-8", "replace")
        for anchor, dst in LINK_RE.findall(text):
            cands = _link_candidates(dst, site, base_dir)
            for c in cands:
                tgt = path_index.get(c)
                if not tgt or tgt == r["doc_id"]:
                    continue
                if by_doc_id[tgt]["kind"] == "nav_source":
                    continue      # 指向导航原始件的边不进关系图
                key = (r["doc_id"], tgt, anchor.strip())
                if key in seen_links:
                    break
                seen_links.add(key)
                links.append({"src": r["doc_id"], "dst": tgt, "dst_path": c,
                              "anchor": anchor.strip()})
                break

    kb.manifest_path.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8"
    )
    kb.nav_path.write_text(json.dumps(nav, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    kb.links_path.write_text(
        "".join(json.dumps(l, ensure_ascii=False) + "\n" for l in links), encoding="utf-8"
    )

    # ---- 3b：回写结构列（只写 scan 拥有的列）----
    if not with_db:
        # 9P 挂载点上 SQLite 完全不可写（database is locked），文件层产物照常生成，
        # 3b 必须在 WSL 原生 ext4 上补跑。显式开关，不允许静默跳过。
        return {"files": len(rows), "nav_sources": len(nav_source_paths), "links": len(links),
                "nav_only": sum(1 for r in rows if r["value_class"] == "nav_only"),
                "gone": 0, "superseded": 0, "sections": len(sections), "db": "skipped"}
    conn = schema.connect(kb.db_path)
    seen: set[str] = set()
    for r in rows:
        seen.add(r["doc_id"])
        schema.upsert_columns(conn, "documents", r["doc_id"], {
            "path": r["path"], "sha256": r["sha256"], "bytes": r["bytes"], "mime": r["mime"],
            "section": r["section"], "nav_order": r["order"], "url": r["url"],
            "value_class": r["value_class"], "kind": r["kind"], "superseded_by": None,
        }, stage="scan")
    # 上一轮有、这一轮没有的 doc_id：同 path 已换新 doc_id 的记 superseded_by，
    # 其余置 gone（结构列置 NULL，status 不动 —— §3.5）
    old = {r[0]: r[1] for r in conn.execute("SELECT doc_id, path FROM documents")}
    new_by_path = {r["path"]: r["doc_id"] for r in rows}
    gone = superseded = 0
    for did, path in old.items():
        if did in seen:
            continue
        repl = new_by_path.get(path)
        schema.upsert_columns(conn, "documents", did, {
            "kind": "gone", "superseded_by": repl, "section": None,
            "nav_order": None, "value_class": None,
        }, stage="scan")
        if repl:
            superseded += 1
        else:
            gone += 1
    conn.commit()
    conn.close()

    return {"files": len(rows), "nav_sources": len(nav_source_paths), "links": len(links),
            "nav_only": sum(1 for r in rows if r["value_class"] == "nav_only"),
            "gone": gone, "superseded": superseded, "sections": len(sections)}


def _link_candidates(dst: str, site: str, base_dir: str) -> list[str]:
    if dst.startswith(("http://", "https://")):
        rel = _strip_site(dst, site)
        if rel is None:
            return []
        dst = rel
    elif dst.startswith("/"):
        dst = dst.lstrip("/")
    else:
        dst = os.path.normpath(os.path.join(base_dir, dst)).replace("\\", "/")
    dst = dst.split("#")[0].split("?")[0]
    if not dst:
        return []
    return [dst, dst + ".md", dst + "/index.md"]


# ------------------------------------------------------------------ parse


def parse(kb: Kb, only: list[str] | None = None) -> dict:
    """第 4 步：写 `parsed/<2位>/<doc_id>/`，并回写 parser_version / parse_status。

    可多进程并行（产物路径由 doc_id 决定），但 SQLite 回写必须串行 —— 这里单进程。
    """
    rows = [r for r in load_manifest(kb) if only is None or r["doc_id"] in only]
    conn = schema.connect(kb.db_path)
    done = skipped = 0
    for r in rows:
        did = r["doc_id"]
        out = kb.parsed_doc_dir(did)
        meta_f = out / "meta.json"
        if meta_f.exists():
            try:
                meta = json.loads(meta_f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                meta = {}
            if meta.get("parser_version") == PARSER_VERSION and meta.get("sha256") == r["sha256"]:
                skipped += 1
                continue
        raw = (kb.source_dir / r["path"]).read_bytes()
        text = raw.decode("utf-8", "replace")
        text = _strip_header_noise(text)
        out.mkdir(parents=True, exist_ok=True)
        (out / "document.md").write_text(text, encoding="utf-8")
        (out / "meta.json").write_text(json.dumps({
            "doc_id": did, "path": r["path"], "sha256": r["sha256"],
            "parser_version": PARSER_VERSION, "parsed_at": now_iso(),
            "title": r.get("title"), "section": r.get("section"),
            "breadcrumb_levels": kb.cfg["chunking"].get("breadcrumb_levels", 2),
            # Phase 2 增强位：block 级 Canonical JSONL（改分块参数可重放，不必重新解析）
            "blocks_path": None,
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        schema.upsert_columns(conn, "documents", did, {
            "parser_version": PARSER_VERSION, "parse_status": "ready", "parsed_at": now_iso(),
        }, stage="parse")
        done += 1
    conn.commit()
    conn.close()
    return {"parsed": done, "skipped": skipped}


def _strip_header_noise(text: str) -> str:
    lines = text.splitlines()
    i = 0
    while i < len(lines) and (NOISE_RE.match(lines[i]) or not lines[i].strip()):
        if NOISE_RE.match(lines[i]):
            i += 1
        elif i == 0 or any(NOISE_RE.match(x) for x in lines[:i]):
            i += 1
        else:
            break
    return "\n".join(lines[i:])


# ------------------------------------------------------------------ chunk


def chunk_text(text: str, size: int, overlap: int, breadcrumb_levels: int = 2
               ) -> list[tuple[str, str, int, int]]:
    """markdown_heading 策略：按标题切段，段内按段打包到 size，带 overlap 字符重叠。

    → [(chunk_text, breadcrumb, char_start, char_end)]
    """
    size = max(int(size), 1)
    overlap = max(0, min(int(overlap), size // 2))
    spans: list[tuple[int, int, list[str]]] = []
    heads = [(m.start(), len(m.group(1)), m.group(2).strip()) for m in HEADING_RE.finditer(text)]
    if not heads:
        spans.append((0, len(text), []))
    else:
        stack: list[str] = []
        for idx, (pos, level, title) in enumerate(heads):
            stack = stack[: level - 1] + [title]
            end = heads[idx + 1][0] if idx + 1 < len(heads) else len(text)
            spans.append((pos, end, list(stack)))
        if heads[0][0] > 0:
            spans.insert(0, (0, heads[0][0], []))

    out: list[tuple[str, str, int, int]] = []
    for start, end, stack in spans:
        seg = text[start:end]
        if not seg.strip():
            continue
        crumb = " › ".join(stack[-breadcrumb_levels:]) if stack else ""

        def emit(a: int, b: int) -> None:
            while a < b and text[a].isspace():
                a += 1
            while b > a and text[b - 1].isspace():
                b -= 1
            if a < b:
                out.append((text[a:b], crumb, a, b))

        # 保留原文中的段落分隔符；生成的文本始终能由 char_start/end 直接取回。
        para_spans: list[tuple[int, int]] = []
        cursor = 0
        for m in re.finditer(r"(?:\r?\n\s*\r?\n)+", seg):
            para_spans.append((start + cursor, start + m.start()))
            cursor = m.end()
        para_spans.append((start + cursor, end))

        buf_start: int | None = None
        buf_end = start
        for a, b in para_spans:
            if not text[a:b].strip():
                continue
            if b - a > size:
                if buf_start is not None:
                    emit(buf_start, buf_end)
                    buf_start = None
                pos = a
                while pos < b:
                    stop = min(pos + size, b)
                    emit(pos, stop)
                    if stop == b:
                        break
                    pos = stop - overlap
                continue
            if buf_start is None:
                buf_start, buf_end = a, b
            elif b - buf_start <= size:
                buf_end = b
            else:
                emit(buf_start, buf_end)
                carry_start = max(buf_end - overlap, buf_start)
                buf_start = carry_start if b - carry_start <= size else a
                buf_end = b
        if buf_start is not None:
            emit(buf_start, buf_end)
    return out


def _purge_doc_chunks(conn, store, did: str) -> int:
    """I2 的固定顺序（陷阱 1）：先枚举旧 id，再删向量，再删表行。"""
    old_ids = [r[0] for r in conn.execute("SELECT chunk_id FROM chunks WHERE doc_id=?", (did,))]
    if old_ids:
        store.delete_ids(old_ids)                 # 主路径：datadb 是 chunk id 的权威
    store.delete_where({"doc_id": did})           # 兜底：chroma metadata 里的 doc_id
    conn.execute("DELETE FROM chunks WHERE doc_id=?", (did,))
    return len(old_ids)


def chunk(kb: Kb, only: list[str] | None = None, store=None) -> dict:
    """第 5 步：先删后插。分块参数变了必须重跑 embed，否则表里无向量由 verify 检出。"""
    cfg = kb.cfg["chunking"]
    sig = kb.chunk_sig()
    rows = [r for r in load_manifest(kb)
            if r.get("value_class") != "nav_only" and (only is None or r["doc_id"] in only)]
    own = store is None
    store = store or open_store(kb)
    conn = schema.connect(kb.db_path)
    n_docs = n_chunks = purged = 0
    for r in rows:
        did = r["doc_id"]
        dpath = kb.parsed_doc_dir(did) / "document.md"
        if not dpath.exists():
            continue
        purged += _purge_doc_chunks(conn, store, did)
        text = dpath.read_text(encoding="utf-8")
        pieces = chunk_text(text, cfg["size"], cfg["overlap"], cfg.get("breadcrumb_levels", 2))
        conn.executemany(
            "INSERT INTO chunks (chunk_id, doc_id, seq, text, char_start, char_end, breadcrumb) "
            "VALUES (?,?,?,?,?,?,?)",
            [(chunk_id(did, i), did, i, t, s, e, c) for i, (t, c, s, e) in enumerate(pieces)],
        )
        schema.upsert_columns(conn, "documents", did, {
            "chunking_signature": sig, "chunk_count": len(pieces),
        }, stage="chunk")
        n_docs += 1
        n_chunks += len(pieces)
    conn.commit()
    conn.close()
    if own:
        store.close()
    return {"docs": n_docs, "chunks": n_chunks, "purged_chunks": purged, "signature": sig}


# ------------------------------------------------------------------ embed


def hash_embed(text: str, dim: int) -> list[float]:
    """确定性伪 embedding，仅供 provider=hash 的本地联调与验收用例使用。

    不用于检索质量评估：它只保证「同文本同向量、换模型 fingerprint 会变」。
    """
    out = []
    i = 0
    while len(out) < dim:
        h = hashlib.blake2b(f"{i}:{text}".encode(), digest_size=16).digest()
        for b in h:
            out.append((b / 127.5) - 1.0)
            if len(out) >= dim:
                break
        i += 1
    norm = math.sqrt(sum(x * x for x in out)) or 1.0
    return [x / norm for x in out]


@lru_cache(maxsize=2)
def _local_embedding_model(model_dir: str, device: str):
    try:
        from sentence_transformers import SentenceTransformer
        import torch
    except ImportError as e:
        raise KbError("bge-m3 需要 sentence-transformers；先在后端环境安装") from e
    chosen_device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    return SentenceTransformer(model_dir, device=chosen_device, local_files_only=True)


def embed_texts(texts: list[str], cfg: dict) -> list[list[float]]:
    prov = (cfg.get("provider") or "").lower()
    dim = int(cfg.get("dim") or 0)
    if prov in ("hash", "test-hash", ""):
        return [hash_embed(t, dim) for t in texts]
    if prov == "bge-m3":
        root = os.environ.get("HELI_EMBEDDING_ROOT")
        if not root:
            raise KbError("bge-m3 需要 HELI_EMBEDDING_ROOT 指向本地模型根目录")
        model_id = cfg.get("model") or ""
        if model_id != "BAAI/bge-m3":
            raise KbError(f"bge-m3 provider 与模型标识不匹配：{model_id}")
        model_root = Path(root).resolve()
        model_dir = (model_root / model_id.replace("/", "--")).resolve()
        if not model_dir.is_relative_to(model_root) or not model_dir.is_dir():
            raise KbError(f"找不到本地模型目录：{model_dir}")
        model = _local_embedding_model(str(model_dir), os.environ.get("HELI_EMBEDDING_DEVICE", ""))
        actual_dim = model.get_embedding_dimension()
        if actual_dim != dim:
            raise KbError(f"bge-m3 维度不匹配：kb.json={dim}，模型={actual_dim}")
        if not texts:
            return []
        vectors = model.encode(
            texts, batch_size=8, normalize_embeddings=bool(cfg.get("normalized", True)),
            convert_to_numpy=True, show_progress_bar=False,
        )
        return [[float(x) for x in row] for row in vectors]
    raise KbError(
        f"embedding provider '{prov}' 未接入"
    )


def embed(kb: Kb, only: list[str] | None = None, store=None, keep_old: bool = False) -> dict:
    """第 6 步：先按 §4.2 清理旧向量，再 add。

    换模型 → collection 名跟着变 → 旧 collection 整体作废（默认删除，可 --keep-old 留灰度）。
    """
    emb_cfg = kb.cfg["embedding"]
    fp = kb.emb_fp()
    sig = kb.chunk_sig()
    own = store is None
    store = store or open_store(kb)

    prev = None
    if kb.engine_json_path.exists():
        prev = json.loads(kb.engine_json_path.read_text(encoding="utf-8"))
    if prev and prev.get("embedding", {}).get("fingerprint") != fp:
        if not keep_old:
            store.drop_collection(prev.get("collection", ""))
        if not keep_old:
            store.refresh()

    rows = [r for r in load_manifest(kb)
            if r.get("value_class") != "nav_only" and (only is None or r["doc_id"] in only)]
    conn = schema.connect(kb.db_path)
    n_docs = n_vec = purged = 0
    for r in rows:
        did = r["doc_id"]
        got = conn.execute(
            "SELECT chunk_id, seq, text, breadcrumb FROM chunks WHERE doc_id=? ORDER BY seq",
            (did,)).fetchall()
        if not got:
            continue
        purged += _purge_doc_chunks_chroma_only(conn, store, did)
        ids, texts, metas = [], [], []
        for cid, seq, text, crumb in got:
            ids.append(cid)
            texts.append(text)
            metas.append({
                "doc_id": did,            # 高基数：为删除与对账而放，禁止用于检索过滤（§3.6）
                "kb_id": kb.slug,
                "product": r.get("product") or "",
                "lang": r.get("lang") or "",
                "pkg": r.get("pkg") or "",
                "value_class": r.get("value_class") or "doc",
                "embedding_model": fp,
                "granularity": "chunk",
            })
        store.add(ids, embed_texts(texts, emb_cfg), texts, metas)
        schema.upsert_columns(conn, "documents", did, {
            "embedding_model": fp,
            "version_signature": kb.vsig(r["sha256"]),
            "status": "ready",
        }, stage="embed")
        n_docs += 1
        n_vec += len(ids)
    conn.commit()
    conn.close()

    kb.engine_dir.mkdir(parents=True, exist_ok=True)
    kb.engine_json_path.write_text(json.dumps({
        "engine": kb.cfg["vector_store"]["engine"],
        "engine_version": _engine_version(kb.cfg["vector_store"]["engine"]),
        "embedding": {**emb_cfg, "fingerprint": fp},
        "hnsw": {"space": kb.cfg["vector_store"].get("distance", "cosine"),
                 "ef_construction": 200, "max_neighbors": 32},
        "collection": kb.collection_name,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if own:
        store.close()
    return {"docs": n_docs, "vectors": n_vec, "purged_vectors": purged,
            "fingerprint": fp, "collection": kb.collection_name}


def _purge_doc_chunks_chroma_only(conn, store, did: str) -> int:
    """embed 只清向量，不动 chunks 表行（chunk 步已经重建过表）。"""
    old_ids = [r[0] for r in conn.execute("SELECT chunk_id FROM chunks WHERE doc_id=?", (did,))]
    if old_ids:
        store.delete_ids(old_ids)
    store.delete_where({"doc_id": did})
    return len(old_ids)


def _engine_version(engine: str) -> str:
    if engine == "chroma":
        try:
            import chromadb
            return chromadb.__version__
        except Exception:
            return "unknown"
    return "in-process"


# ------------------------------------------------------------------ gc


def gc(kb: Kb, store=None, include_gone: bool = False) -> dict:
    """第 7 步：淘汰 superseded（内容变了、旧 doc_id 已无源文件）。

    `gone`（站点删页）默认不动 chunk：解析产物仍有效，检索侧按 kind!='gone' 过滤即可（§3.5）。
    """
    own = store is None
    store = store or open_store(kb)
    conn = schema.connect(kb.db_path)
    q = "SELECT doc_id FROM documents WHERE superseded_by IS NOT NULL"
    if include_gone:
        q = "SELECT doc_id FROM documents WHERE superseded_by IS NOT NULL OR kind='gone'"
    targets = [r[0] for r in conn.execute(q)]
    purged = 0
    for did in targets:
        old = [r[0] for r in conn.execute("SELECT chunk_id FROM chunks WHERE doc_id=?", (did,))]
        if old:
            store.delete_ids(old)
        store.delete_where({"doc_id": did})
        cur = conn.execute("DELETE FROM chunks WHERE doc_id=?", (did,)).rowcount
        purged += cur
        schema.upsert_columns(conn, "documents", did, {"status": "gc"}, stage="embed")
    conn.commit()
    conn.close()
    if own:
        store.close()
    return {"targets": len(targets), "chunks_removed": purged}
