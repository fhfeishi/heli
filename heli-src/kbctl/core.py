"""标识规则、库路径与 kb.json。

§3.1 标识规则在这里定死，其余模块一律调用本文件，不允许各自算一遍。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

SCHEMA_VERSION = 1
PARSER_VERSION = "md-v1"

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,31}$")

# 层名（§2.1 术语表）。改名只改这里。
L_SOURCE = "source"
L_PARSED = "parsed"
L_VECTORDB = "vectordb"
L_DATADB = "datadb"

# 生成物文件名（§2.1）
F_KBJSON = "kb.json"
F_MANIFEST = "manifest.jsonl"
F_NAV = "nav.json"
F_LINKS = "links.jsonl"
F_STATUS = "_status.json"
F_ENGINE = "_engine.json"
F_REGISTRY = "_registry.json"

DEFAULT_KB_JSON = {
    "schema_version": SCHEMA_VERSION,
    "embedding": {"provider": "", "model": "", "dim": 1024, "normalized": True},
    "chunking": {
        "strategy": "markdown_heading",
        "size": 512,
        "overlap": 64,
        "breadcrumb_levels": 2,
    },
    "vector_store": {"engine": "chroma", "collection": "", "distance": "cosine"},
    "structure": {"assumption": "tree", "multi_parent_via": [F_NAV, F_LINKS]},
    "scan": {
        # 导航原始件：留在 source/ 原位，由清单字段标记过滤（§2.2 变化 2）
        "nav_source_globs": ["**/llms.txt", "**/_manifest.json", "README.md"],
        # 索引页污染过滤（§7.2）：正文行数为 0（整页 HTML 转储），
        # 或「< 密度 ≥ 阈值 且 正文行 ≤ 上限 且 无标题」的组件壳页
        "nav_only": {"html_density": 0.71, "max_prose_lines": 20},
    },
}


# ---------------------------------------------------------------- 标识规则


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def doc_id(data: bytes) -> str:
    """blake2b(文件字节, digest_size=8).hexdigest() → 16 位 hex。"""
    return hashlib.blake2b(data, digest_size=8).hexdigest()


def chunk_id(did: str, seq: int) -> str:
    """<doc_id>-<4 位序号>，序号从 0000 连续无空洞。"""
    return f"{did}-{seq:04d}"


def _sig(*parts) -> str:
    return hashlib.blake2b("|".join(str(p) for p in parts).encode(), digest_size=8).hexdigest()[:8]


def chunking_signature(ch: dict) -> str:
    return _sig(
        ch.get("strategy"), ch.get("size"), ch.get("overlap"), ch.get("breadcrumb_levels", 2)
    )


def embedding_fingerprint(emb: dict) -> str:
    return _sig(emb.get("provider"), emb.get("model"), emb.get("dim"), bool(emb.get("normalized")))


def version_signature(file_sha256: str, parser_version: str, emb_fp: str, ch_sig: str) -> str:
    return _sig(file_sha256, parser_version, emb_fp, ch_sig)


def is_ads(name: str) -> bool:
    """:Zone.Identifier 这类 Windows ADS 标记（§7.1）。WSL 表现为独立文件。"""
    return ":" in name or "Zone.Identifier" in name


# ---------------------------------------------------------------- 库对象


class KbError(RuntimeError):
    pass


class Kb:
    """一个知识库目录。库级自包含（原则 1）。"""

    def __init__(self, root: str | os.PathLike):
        self.root = Path(root)
        self.slug = self.root.name

    # -- 路径 ------------------------------------------------------------
    @property
    def kb_json_path(self) -> Path:
        return self.root / F_KBJSON

    @property
    def source_dir(self) -> Path:
        return self.root / L_SOURCE

    @property
    def parsed_dir(self) -> Path:
        return self.root / L_PARSED

    @property
    def vectordb_dir(self) -> Path:
        return self.root / L_VECTORDB

    @property
    def engine_dir(self) -> Path:
        return self.vectordb_dir / self.cfg["vector_store"]["engine"]

    @property
    def datadb_dir(self) -> Path:
        return self.root / L_DATADB

    @property
    def db_path(self) -> Path:
        return self.datadb_dir / "kb.db"

    @property
    def scratch_dir(self) -> Path:
        return self.root / "_scratch"

    @property
    def manifest_path(self) -> Path:
        return self.root / F_MANIFEST

    @property
    def nav_path(self) -> Path:
        return self.root / F_NAV

    @property
    def links_path(self) -> Path:
        return self.root / F_LINKS

    @property
    def status_path(self) -> Path:
        return self.root / F_STATUS

    @property
    def engine_json_path(self) -> Path:
        return self.engine_dir / F_ENGINE

    def parsed_doc_dir(self, did: str) -> Path:
        """parsed/<2位>/<doc_id>/ —— 一开始就分桶，永不迁移（§4.1）。"""
        return self.parsed_dir / did[:2] / did

    # -- kb.json ---------------------------------------------------------
    @property
    def cfg(self) -> dict:
        if not hasattr(self, "_cfg"):
            if not self.kb_json_path.exists():
                raise KbError(f"缺少 {self.kb_json_path}；先跑 kbctl init {self.slug}")
            self._cfg = json.loads(self.kb_json_path.read_text(encoding="utf-8"))
            for k, v in DEFAULT_KB_JSON.items():
                if k not in self._cfg:
                    self._cfg[k] = v
        return self._cfg

    def write_cfg(self, cfg: dict) -> None:
        temp = self.kb_json_path.with_suffix(".json.tmp")
        temp.write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        os.replace(temp, self.kb_json_path)
        self._cfg = cfg

    # -- 派生签名 --------------------------------------------------------
    def chunk_sig(self) -> str:
        return chunking_signature(self.cfg["chunking"])

    def emb_fp(self) -> str:
        return embedding_fingerprint(self.cfg["embedding"])

    def vsig(self, file_sha256: str, parser_version: str = PARSER_VERSION) -> str:
        return version_signature(file_sha256, parser_version, self.emb_fp(), self.chunk_sig())

    @property
    def collection_name(self) -> str:
        """chunks_<model短名>_<dim>（§3.6）。不写死 chunks。"""
        cfg = self.cfg["vector_store"].get("collection")
        if cfg:
            return cfg
        emb = self.cfg["embedding"]
        model = re.sub(r"[^A-Za-z0-9]", "", (emb.get("model") or emb.get("provider") or "x").split("/")[-1])
        return f"chunks_{model.lower()}_{emb.get('dim', 0)}"

    # -- init ------------------------------------------------------------
    @classmethod
    def init(cls, root: str | os.PathLike, name: str = "", **overrides) -> "Kb":
        root = Path(root)
        if root.exists() and any(root.iterdir()):
            raise KbError(f"{root} 已存在且非空；init 不覆盖")
        slug = root.name
        if not SLUG_RE.match(slug):
            raise KbError(f"slug 不合法（{SLUG_RE.pattern}）：{slug}")
        root.mkdir(parents=True, exist_ok=True)
        kb = cls(root)
        cfg = json.loads(json.dumps(DEFAULT_KB_JSON))
        cfg.update({"id": slug, "name": name or slug, "description": "", "tags": []})
        cfg.update(overrides)
        if not cfg["vector_store"].get("collection"):
            cfg["vector_store"]["collection"] = ""
        kb.write_cfg(cfg)
        for d in (kb.source_dir, kb.parsed_dir, kb.vectordb_dir, kb.datadb_dir, kb.scratch_dir):
            d.mkdir(parents=True, exist_ok=True)
        return kb


def registry_path(knowledge_root: str | os.PathLike) -> Path:
    return Path(knowledge_root) / F_REGISTRY


def iter_kb_slugs(knowledge_root: str | os.PathLike) -> list[str]:
    root = Path(knowledge_root)
    return sorted(p.name for p in root.iterdir() if p.is_dir() and (p / F_KBJSON).exists())
