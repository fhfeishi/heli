"""向量层引擎抽象（§3.6 / §4.2 / §4.3）。

两个实现：

- `chroma`：生产引擎，懒加载 chromadb，PersistentClient。
- `memory`：落盘的参考实现（每 collection 一个 json 文件），语义与 chroma 的
  `delete(ids=)` / `delete(where=)` / `get(where=)` 对齐，用于没有 chromadb 的环境跑
  管道与验收用例。之所以落盘而不是放内存：换模型会换 collection，必须能观察到
  「旧 collection 是否真的被作废」，内存实现会让这条断言变成同义反复。

两条纪律在这里固化：

1. chroma **没有按 id 前缀删除**，只有 `delete(ids=[...])` 与 `delete(where={...})`
   （已核实）。所以「清理某 doc 的旧 chunk」的前提是能枚举出旧 id。
2. **PersistentClient 删除后 `count()` 可能返回陈旧值**（§4.3 陷阱 2，未验证，见报告 §7）。
   因此核对前必须 `refresh()` 重开会话，禁止在同一会话内删完立刻 count。
"""

from __future__ import annotations

import json
from pathlib import Path


class VectorStoreError(RuntimeError):
    pass


class VectorStore:
    engine = "?"

    def add(self, ids, embeddings, documents, metadatas) -> None: ...
    def delete_ids(self, ids) -> None: ...
    def delete_where(self, where: dict) -> None: ...
    def get_ids_where(self, where: dict) -> list[str]: ...
    def version_counts(self) -> dict[str, int]: ...
    def query(self, embedding, n_results: int, where: dict | None = None) -> list[dict]:
        """按向量检索（§5 新协议查询路径）。

        → [{"id", "distance", "document", "metadata"}]，按 distance 升序。
        where 支持 $eq/$ne/$in（与 delete_where 同一套匹配语义）。
        """
        ...

    def list_collections(self) -> list[str]: ...
    def count(self) -> int: ...
    def refresh(self) -> None:
        """重开会话。核对前必须调用（陷阱 2）。"""

    def drop_collection(self, name: str) -> None: ...

    def close(self) -> None: ...


class MemoryStore(VectorStore):
    """落盘的参考实现：`<path>/<collection>.json`。"""

    engine = "memory"

    def __init__(self, path: Path, collection: str):
        self.path = Path(path)
        self.path.mkdir(parents=True, exist_ok=True)
        self.collection = collection
        self._file = self.path / f"{collection}.json"
        self._data: dict[str, dict] = {}
        self.refresh()

    def _load(self) -> dict:
        if self._file.exists():
            return json.loads(self._file.read_text(encoding="utf-8"))
        return {}

    def _flush(self) -> None:
        self._file.write_text(json.dumps(self._data, ensure_ascii=False), encoding="utf-8")

    def add(self, ids, embeddings, documents, metadatas) -> None:
        for i, e, d, m in zip(ids, embeddings, documents, metadatas):
            self._data[i] = {"embedding": [float(x) for x in e], "document": d, "metadata": dict(m)}
        self._flush()

    upsert = add

    def delete_ids(self, ids) -> None:
        hit = False
        for i in list(ids):
            if i in self._data:
                del self._data[i]
                hit = True
        if hit:
            self._flush()

    @staticmethod
    def _match(meta: dict, where: dict) -> bool:
        for k, cond in where.items():
            v = meta.get(k)
            if isinstance(cond, dict):
                for op, want in cond.items():
                    if op == "$eq" and not v == want:
                        return False
                    if op == "$ne" and not v != want:
                        return False
                    if op == "$in" and v not in want:
                        return False
            elif v != cond:
                return False
        return True

    def delete_where(self, where: dict) -> None:
        dead = [k for k, v in self._data.items() if self._match(v.get("metadata", {}), where)]
        for k in dead:
            del self._data[k]
        if dead:
            self._flush()

    def get_ids_where(self, where: dict) -> list[str]:
        return sorted(k for k, v in self._data.items() if self._match(v.get("metadata", {}), where))

    def version_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for value in self._data.values():
            version = value.get("metadata", {}).get("version_id")
            if version:
                counts[version] = counts.get(version, 0) + 1
        return counts

    def query(self, embedding, n_results: int, where: dict | None = None) -> list[dict]:
        import math

        q = [float(x) for x in embedding]
        qn = math.sqrt(sum(x * x for x in q)) or 1.0
        hits = []
        for i, v in self._data.items():
            if where and not self._match(v.get("metadata", {}), where):
                continue
            e = v["embedding"]
            en = math.sqrt(sum(x * x for x in e)) or 1.0
            cos = sum(a * b for a, b in zip(q, e)) / (qn * en)
            hits.append({"id": i, "distance": 1.0 - cos,
                         "document": v["document"], "metadata": dict(v["metadata"])})
        hits.sort(key=lambda h: h["distance"])
        return hits[:n_results]

    def list_collections(self) -> list[str]:
        return sorted(p.stem for p in self.path.glob("*.json"))

    def count(self) -> int:
        return len(self._data)

    def refresh(self) -> None:
        self._data = self._load()

    def drop_collection(self, name: str) -> None:
        f = self.path / f"{name}.json"
        if f.exists():
            f.unlink()
        if name == self.collection:
            self._data = {}
            self._flush()

    def close(self) -> None:
        self._flush()


class ChromaStore(VectorStore):
    engine = "chroma"

    def __init__(self, path: Path, collection: str, hnsw: dict | None = None):
        try:
            import chromadb
        except ImportError as e:  # pragma: no cover - 环境相关
            raise VectorStoreError(
                "未安装 chromadb，无法使用 chroma 引擎；改用 --engine memory，"
                "或在 WSL 内 pip install chromadb"
            ) from e
        self._chromadb = chromadb
        self.path = Path(path)
        self.path.mkdir(parents=True, exist_ok=True)
        self._collection_name = collection
        self._hnsw = hnsw or {"space": "cosine", "ef_construction": 200, "max_neighbors": 32}
        self._open()

    def _open(self) -> None:
        self._client = self._chromadb.PersistentClient(path=str(self.path))
        self._coll = self._client.get_or_create_collection(
            name=self._collection_name, configuration={"hnsw": self._hnsw}
        )

    def add(self, ids, embeddings, documents, metadatas) -> None:
        self._coll.upsert(ids=list(ids), embeddings=[list(e) for e in embeddings],
                          documents=list(documents), metadatas=[dict(m) for m in metadatas])

    upsert = add

    def delete_ids(self, ids) -> None:
        ids = list(ids)
        if ids:
            self._coll.delete(ids=ids)

    def delete_where(self, where: dict) -> None:
        self._coll.delete(where=where)

    def get_ids_where(self, where: dict) -> list[str]:
        return list(self._coll.get(where=where, include=[])["ids"])

    def version_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        result = self._coll.get(include=["metadatas"])
        for metadata in result["metadatas"]:
            version = (metadata or {}).get("version_id")
            if version:
                counts[version] = counts.get(version, 0) + 1
        return counts

    def query(self, embedding, n_results: int, where: dict | None = None) -> list[dict]:
        res = self._coll.query(
            query_embeddings=[list(embedding)], n_results=n_results,
            where=where or None, include=["documents", "metadatas", "distances"],
        )
        out = []
        for i, d, doc, m in zip(res["ids"][0], res["distances"][0],
                                res["documents"][0], res["metadatas"][0]):
            out.append({"id": i, "distance": float(d), "document": doc, "metadata": dict(m)})
        return out

    def list_collections(self) -> list[str]:
        return sorted(c.name for c in self._client.list_collections())

    def count(self) -> int:
        return self._coll.count()

    def refresh(self) -> None:
        """重开 client + 重新取 collection（陷阱 2：同一会话的 count 可能陈旧）。"""
        self._client = self._chromadb.PersistentClient(path=str(self.path))
        self._coll = self._client.get_collection(name=self._collection_name)

    def drop_collection(self, name: str) -> None:
        try:
            self._client.delete_collection(name=name)
        except self._chromadb.errors.NotFoundError:
            pass

    def close(self) -> None:
        pass


def open_store(kb, engine: str | None = None, collection: str | None = None):
    """按 kb.json.vector_store.engine 打开向量层。engine/collection 可覆盖。

    collection 覆盖用于新协议的候选集合（换模型先建完整新实例再切换，
    构建期间 kb_state 仍指向旧集合）。
    """
    eng = engine or kb.cfg["vector_store"]["engine"]
    name = collection or kb.collection_name
    if eng == "memory":
        return MemoryStore(kb.engine_dir / "memory", name)
    if eng == "chroma":
        return ChromaStore(
            kb.engine_dir / "chroma",
            name,
            hnsw={"space": kb.cfg["vector_store"].get("distance", "cosine"),
                  "ef_construction": 200, "max_neighbors": 32},
        )
    raise VectorStoreError(f"未知引擎：{eng}")
