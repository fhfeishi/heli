"""Phase 1 三条验收用例（§6 Phase 1）。

三条断言全部必须为真，对应「重跑 = 先清后写」这条不变量的三个触发面：

1. 内容变更 → 旧 doc_id 的 chunk 在 chroma 与 chunks 表**均为 0**
2. 分块参数变更 → 块数下降，且 chroma 内无旧序号残留
3. 模型变更 → 旧模型 chunk 数为 0，_engine.json 指纹与 kb.json 一致

引擎默认 `memory`（落盘参考实现）。装了 chromadb 的环境用 `HELI_KB_ENGINE=chroma`
重跑同一批用例即可复验真实引擎；chroma 专属的「删除后 count() 陈旧」问题见报告 §7。
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kbctl import pipeline, verify  # noqa: E402
from kbctl.core import Kb, doc_id  # noqa: E402
from kbctl.vstore import open_store  # noqa: E402

ENGINE = os.environ.get("HELI_KB_ENGINE", "memory")

PARA = (
    "LangGraph 的 persistence 层把 checkpoint 抽象成一个可替换的接口，"
    "每个 super-step 之前写入、之后读取，从而实现可恢复的长时运行。"
)


def make_kb(root: str, slug: str, model: str = "bge-m3", dim: int = 8,
            size: int = 200, overlap: int = 20) -> Kb:
    return Kb.init(
        os.path.join(root, slug), name=slug,
        embedding={"provider": "hash", "model": model, "dim": dim, "normalized": True},
        chunking={"strategy": "markdown_heading", "size": size, "overlap": overlap,
                  "breadcrumb_levels": 2},
        vector_store={"engine": ENGINE, "collection": "", "distance": "cosine"},
    )


def write_doc(kb: Kb, text: str) -> None:
    (kb.source_dir / "persistence.md").write_text(text, encoding="utf-8")


def run_once(kb: Kb) -> None:
    """一次完整重跑：scan → parse → chunk → embed → gc（顺序即 §4.1 的 3a/3b/4/5/6/7）。"""
    store = open_store(kb)
    pipeline.scan(kb)
    pipeline.parse(kb)
    pipeline.chunk(kb, store=store)
    pipeline.embed(kb, store=store)
    pipeline.gc(kb, store=store)
    store.close()


def counts(kb: Kb, did: str) -> tuple[int, int]:
    """(chunks 表行数, chroma 内该 doc 的 id 数)。核对前 refresh（陷阱 2）。"""
    conn = sqlite3.connect(str(kb.db_path))
    t = conn.execute("SELECT COUNT(*) FROM chunks WHERE doc_id=?", (did,)).fetchone()[0]
    conn.close()
    st = open_store(kb)
    st.refresh()
    c = len(st.get_ids_where({"doc_id": did}))
    st.close()
    return t, c


# ---------------------------------------------------------------- 用例 1


def test_1_content_change_clears_old_chunks():
    """改一个字符重跑 → 旧 doc_id 的 chunk 在 chroma 与 chunks 表中均为 0。"""
    root = tempfile.mkdtemp(prefix="kbctl-t1-")
    try:
        kb = make_kb(root, "case1")
        text = "".join(f"## 段落 {i}\n\n{PARA}\n\n" for i in range(1, 9))
        write_doc(kb, text)
        run_once(kb)
        old = doc_id((kb.source_dir / "persistence.md").read_bytes())
        t0, c0 = counts(kb, old)
        assert t0 > 0 and c0 == t0, f"基线不成立：table={t0} chroma={c0}"

        write_doc(kb, text.replace("persistence 层", "persistence 层！"))   # 改一个字符
        run_once(kb)
        new = doc_id((kb.source_dir / "persistence.md").read_bytes())
        assert new != old, "内容变了，doc_id 必须变"

        t1, c1 = counts(kb, old)
        assert t1 == 0, f"chunks 表残留旧 doc_id 的 {t1} 行"
        assert c1 == 0, f"chroma 残留旧 doc_id 的 {c1} 个向量"
        t2, c2 = counts(kb, new)
        assert t2 == t0 and c2 == t0, f"新版本 chunk 不完整：table={t2} chroma={c2}"
        print(f"  [1] 旧 doc_id {old[:8]} 残留 table={t1} chroma={c1}；新 doc_id {new[:8]} = {t2}")
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ---------------------------------------------------------------- 用例 2


def test_2_chunking_change_leaves_no_orphan():
    """只改 chunking.size 使块数下降 → 块数正确，chroma 内无旧序号残留。"""
    root = tempfile.mkdtemp(prefix="kbctl-t2-")
    try:
        kb = make_kb(root, "case2", size=200)
        # 单一标题 + 8 段正文：size=200 → 8 块，size=210 → 5 块（块数由打包决定，不是由标题数决定）
        text = "# Persistence\n\n" + "".join(f"第 {i} 段：{PARA}\n\n" for i in range(8))
        write_doc(kb, text)
        run_once(kb)
        did = doc_id((kb.source_dir / "persistence.md").read_bytes())
        conn = sqlite3.connect(str(kb.db_path))
        n1 = conn.execute("SELECT MAX(seq)+1 FROM chunks WHERE doc_id=?", (did,)).fetchone()[0]
        conn.close()
        t1, c1 = counts(kb, did)
        assert n1 == t1 == c1, f"基线不一致：max_seq={n1} table={t1} chroma={c1}"

        # 只改分块参数
        cfg = json.loads(kb.kb_json_path.read_text(encoding="utf-8"))
        cfg["chunking"]["size"] = 210
        kb.write_cfg(cfg)
        store = open_store(kb)
        pipeline.chunk(kb, store=store)
        pipeline.embed(kb, store=store)
        store.close()

        conn = sqlite3.connect(str(kb.db_path))
        n2 = conn.execute("SELECT MAX(seq)+1 FROM chunks WHERE doc_id=?", (did,)).fetchone()[0]
        seqs = [r[0] for r in conn.execute(
            "SELECT seq FROM chunks WHERE doc_id=? ORDER BY seq", (did,))]
        conn.close()
        t2, c2 = counts(kb, did)
        assert (n1, n2) == (8, 5), f"规格用例要求块数 8 → 5，实际 {n1} → {n2}"
        assert seqs == list(range(n2)), f"seq 必须从 0000 连续无空洞：{seqs}"
        assert t2 == n2, f"chunks 表行数应为 {n2}，实际 {t2}"
        assert c2 == n2, f"chroma 内该 doc 的 id 数应为 {n2}，实际 {c2}（旧序号残留）"
        print(f"  [2] 块数 {n1} → {n2}；table={t2} chroma={c2}；seq 连续无空洞")
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ---------------------------------------------------------------- 用例 3


def test_3_model_change_invalidates_old_vectors():
    """改 embedding.model 重跑 → 旧模型 chunk 数为 0，_engine.json 指纹与 kb.json 一致。"""
    root = tempfile.mkdtemp(prefix="kbctl-t3-")
    try:
        kb = make_kb(root, "case3")
        text = "".join(f"## 段落 {i}\n\n{PARA}\n\n" for i in range(1, 6))
        write_doc(kb, text)
        run_once(kb)

        fp1 = kb.emb_fp()
        ej1 = json.loads(kb.engine_json_path.read_text(encoding="utf-8"))
        assert ej1["embedding"]["fingerprint"] == fp1
        coll1 = ej1["collection"]

        cfg = json.loads(kb.kb_json_path.read_text(encoding="utf-8"))
        cfg["embedding"]["model"] = "bge-large"
        kb.write_cfg(cfg)
        fp2 = kb.emb_fp()
        assert fp2 != fp1, "换模型必须换指纹"
        assert kb.collection_name != coll1, "换模型必须换 collection，物理上杜绝新旧混检"

        store = open_store(kb)
        pipeline.chunk(kb, store=store)
        pipeline.embed(kb, store=store)
        store.close()

        v = verify.verify(kb)
        assert v["old_model_chunks"] == 0, f"仍存在旧模型 chunk：{v['old_model_chunks']}"
        assert v["stale_collections"] == [], f"旧 collection 未作废：{v['stale_collections']}"
        assert v["engine_fingerprint"] == "match", v["engine_fingerprint"]
        ej2 = json.loads(kb.engine_json_path.read_text(encoding="utf-8"))
        assert ej2["embedding"]["fingerprint"] == fp2
        assert v["ok"], json.dumps(v, ensure_ascii=False)[:400]
        print(f"  [3] 旧模型 chunk 数={v['old_model_chunks']}；"
              f"引擎指纹={v['engine_fingerprint']}；collection {coll1} → {ej2['collection']}")
    finally:
        shutil.rmtree(root, ignore_errors=True)


def main() -> int:
    print(f"engine = {ENGINE}")
    cases = [test_1_content_change_clears_old_chunks,
             test_2_chunking_change_leaves_no_orphan,
             test_3_model_change_invalidates_old_vectors]
    bad = 0
    for c in cases:
        try:
            c()
            print(f"PASS {c.__name__}")
        except AssertionError as e:
            bad += 1
            print(f"FAIL {c.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            bad += 1
            print(f"ERROR {c.__name__}: {type(e).__name__}: {e}")
    print("ALL PASS" if not bad else f"{bad} FAILED")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
