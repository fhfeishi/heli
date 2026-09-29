"""新协议（精简规格 §6）验收用例：路径 A / B / C 后端段。

路径 A：同内容双来源 → 保存引用 → 更新一个 → 8 块改 5 块 → 改名/下线 → 重启
路径 B：候选写入/SQL 切换后分别强制中断 → 恢复 → 换模型 → 清理失败（memory 引擎段）
路径 C：备份 → 独立恢复 → 缺向量阻止检索（后端段；前端修改段不在本文件范围）

引擎默认 memory（落盘参考实现）；HELI_KB_ENGINE=chroma 可在装有 chromadb 的
WSL 内复验。全部用例跑在临时目录，不触碰真实库。
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kbctl import pipeline2, schema2, management  # noqa: E402
from kbctl.core import Kb  # noqa: E402
from kbctl.vstore import ChromaStore, MemoryStore, open_store  # noqa: E402

ENGINE = os.environ.get("HELI_KB_ENGINE", "memory")

PARA = (
    "LangGraph 的 persistence 层把 checkpoint 抽象成一个可替换的接口，"
    "每个 super-step 之前写入、之后读取，从而实现可恢复的长时运行。"
)
TEXT8 = "# Persistence\n\n" + "".join(f"第 {i} 段：{PARA}\n\n" for i in range(8))


def make_kb(root: str, slug: str, model: str = "bge-m3", dim: int = 8,
            size: int = 200, overlap: int = 20) -> Kb:
    return Kb.init(
        os.path.join(root, slug), name=slug,
        embedding={"provider": "hash", "model": model, "dim": dim, "normalized": True},
        chunking={"strategy": "markdown_heading", "size": size, "overlap": overlap,
                  "breadcrumb_levels": 2},
        vector_store={"engine": ENGINE, "collection": "", "distance": "cosine"},
    )


def write(kb: Kb, rel: str, text: str) -> None:
    p = kb.source_dir / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def run(kb: Kb, **kw) -> dict:
    scan = pipeline2.scan_sources(kb)
    upd = pipeline2.update(kb, **kw)
    return {"scan": scan, "update": upd}


def conn_of(kb: Kb) -> sqlite3.Connection:
    return schema2.connect2(kb.db_path)


def state_of(kb: Kb) -> dict:
    conn = conn_of(kb)
    s = schema2.read_state(conn)
    conn.close()
    return s


def one(kb: Kb, sql: str, args=()):
    conn = conn_of(kb)
    r = conn.execute(sql, args).fetchone()
    conn.close()
    return r


def all_rows(kb: Kb, sql: str, args=()) -> list:
    conn = conn_of(kb)
    r = conn.execute(sql, args).fetchall()
    conn.close()
    return r


def vec_count(kb: Kb, vid: str) -> int:
    st = open_store(kb, collection=state_of(kb)["collection"])
    st.refresh()
    n = len(st.get_ids_where({"version_id": vid}))
    st.close()
    return n


def all_vec_ids(kb: Kb) -> list[str]:
    st = open_store(kb, collection=state_of(kb)["collection"])
    st.refresh()
    ids = st.get_ids_where({"version_id": {"$ne": ""}})
    st.close()
    return ids


def active_of(kb: Kb, sid: str) -> str | None:
    r = one(kb, "SELECT active_version_id FROM sources WHERE source_id=?", (sid,))
    return r[0] if r else None


def source_by_path(kb: Kb, path: str) -> str:
    r = one(kb, "SELECT source_id FROM sources WHERE path=?", (path,))
    assert r, f"来源不存在：{path}"
    return r[0]


def job_stage(kb: Kb) -> str | None:
    r = one(kb, "SELECT stage FROM jobs ORDER BY rowid DESC LIMIT 1")
    return r[0] if r else None


# ---------------------------------------------------------------- 路径 A


def test_path_a() -> None:
    root = tempfile.mkdtemp(prefix="kbv2-a-")
    try:
        kb = make_kb(root, "v2a")
        write(kb, "a.md", TEXT8)
        write(kb, "b.md", TEXT8)                       # 同内容双来源

        # 1) 首次导入：两个来源、一个版本、8 块、8 向量（不重复计算）
        r = run(kb)
        assert r["scan"]["new"] == 2, r["scan"]
        A, B = source_by_path(kb, "a.md"), source_by_path(kb, "b.md")
        vids = all_rows(kb, "SELECT version_id FROM versions")
        assert len(vids) == 1, f"同内容同配置必须复用同一版本：{len(vids)}"
        V1 = vids[0][0]
        n_chunks = one(kb, "SELECT COUNT(*) FROM chunks WHERE version_id=?", (V1,))[0]
        assert n_chunks == 8, f"基线块数应为 8：{n_chunks}"
        assert vec_count(kb, V1) == 8, "向量必须且只写一次"
        assert active_of(kb, A) == V1 and active_of(kb, B) == V1

        # 2) 查询：命中映射回两个共享来源
        hits = pipeline2.query(kb, "checkpoint 接口", n=8)
        got_srcs = {h["source_id"] for h in hits}
        assert got_srcs == {A, B}, f"共享版本的命中必须映射回全部范围内来源：{got_srcs}"
        assert all(h["version_id"] == V1 for h in hits)

        # 3) 保存引用（快照当时标题/摘录）
        cit = pipeline2.save_citation(kb, A, f"{V1}-0000")
        assert cit["title"] == "Persistence", cit

        # 4) 更新一个来源：A 换新版本，B 不动；共享旧版本的向量不能被误删
        write(kb, "a.md", TEXT8.replace("第 1 段", "第 1 段！"))
        r = run(kb)
        V2 = active_of(kb, A)
        assert V2 and V2 != V1, "内容变更必须产生新版本"
        assert active_of(kb, B) == V1, "未变更来源的版本不能被覆盖"
        assert vec_count(kb, V1) == 8, "GC 误删了仍被 B 使用的共享版本向量"
        assert vec_count(kb, V2) == 8

        # 管理闭环并入 A：层级调整不改内容身份，错误引用与循环必须拒绝。
        management.organize(kb)
        section = management.edit_section(kb, title="产品")
        child = management.edit_section(kb, title="章节", parent_id=section["section_id"])
        management.place_document(kb, A, child["section_id"])
        management.edit_section(kb, section_id=section["section_id"], title="新产品名")
        try:
            management.edit_section(kb, section_id=section["section_id"],
                                    title="新产品名", parent_id=child["section_id"])
            raise AssertionError("不能形成章节循环")
        except pipeline2.KbError:
            pass
        management.organize(kb)
        listing = management.list_documents(kb, section_id=section["section_id"])
        assert [d["source_id"] for d in listing["documents"]] == [A]
        read = management.read_document(kb, A, limit=100)
        assert len(read["text"]) == 100 and read["next_offset"] == 100
        assert active_of(kb, A) == V2
        management.rename_library(kb, "改名后的库")
        assert kb.cfg["id"] == "v2a" and kb.cfg["name"] == "改名后的库"
        try:
            pipeline2.save_citation(kb, A, f"{V1}-0000")
            raise AssertionError("来源不得串配其他版本")
        except pipeline2.KbError:
            pass
        assert pipeline2.query(kb, "checkpoint", scope={"source_ids": []}) == []

        lock = pipeline2.WriterLock(kb)
        try:
            blocked = subprocess.run([sys.executable, "-m", "kbctl", "--root", root,
                                      "--kb", "v2a", "v2-manage", "tree"], capture_output=True, text=True)
            assert blocked.returncode == 1 and "锁" in blocked.stderr, blocked
        finally:
            lock.release()

        # 5) 分块参数变更：8 → 5；旧尾块不进召回
        cfg = json.loads(kb.kb_json_path.read_text(encoding="utf-8"))
        cfg["chunking"]["size"] = 210
        kb.write_cfg(cfg)
        run(kb)
        V3, V1b = active_of(kb, A), active_of(kb, B)
        assert V3 not in (V1, V2) and V1b not in (V1, V2, V3), (V3, V1b)
        n3 = one(kb, "SELECT COUNT(*) FROM chunks WHERE version_id=?", (V3,))[0]
        n1b = one(kb, "SELECT COUNT(*) FROM chunks WHERE version_id=?", (V1b,))[0]
        assert (n3, n1b) == (5, 5), f"规格要求 8 → 5：{n3},{n1b}"
        assert vec_count(kb, V1) == 0 and vec_count(kb, V2) == 0, "旧版本向量应被安全点回收"
        assert vec_count(kb, V3) == 5 and vec_count(kb, V1b) == 5
        hits = pipeline2.query(kb, "第 8 段", n=20)
        assert hits, "合并后的块仍应可召回"
        assert all(h["version_id"] in (V3, V1b) for h in hits), \
            "旧尾块（旧版本的 0005–0007）进入召回"

        # 6) 显式改名：保留 source_id 与 active 版本，不重算
        (kb.source_dir / "docs").mkdir(parents=True, exist_ok=True)
        shutil.move(str(kb.source_dir / "b.md"), str(kb.source_dir / "docs" / "b.md"))
        pipeline2.rename_source(kb, B, "docs/b.md")
        row = one(kb, "SELECT path, active_version_id FROM sources WHERE source_id=?", (B,))
        assert row == ("docs/b.md", V1b), f"显式改名必须保留来源 ID 与版本：{row}"

        # 7) 下线（完整扫描缺失）与访问失败不下线
        os.unlink(kb.source_dir / "a.md")
        pipeline2.scan_sources(kb)                      # full 扫描
        assert one(kb, "SELECT online FROM sources WHERE source_id=?", (A,))[0] == 0, \
            "完整扫描缺失必须下线"
        hits = pipeline2.query(kb, "checkpoint", n=20)
        assert hits and all(h["source_id"] == B for h in hits), "下线来源仍在召回"

        os.unlink(kb.source_dir / "docs" / "b.md")
        os.mkdir(kb.source_dir / "docs" / "b.md")       # 路径变成目录：存在但不可读
        scan_r = pipeline2.scan_sources(kb)
        assert "docs/b.md" in scan_r["access_errors"], scan_r
        assert one(kb, "SELECT online FROM sources WHERE source_id=?", (B,))[0] == 1, \
            "访问失败（存在但不可读）不得下线"
        os.rmdir(kb.source_dir / "docs" / "b.md")
        write(kb, "docs/b.md", TEXT8)
        pipeline2.scan_sources(kb)
        assert one(kb, "SELECT online FROM sources WHERE source_id=?", (B,))[0] == 1

        # 8) 多导航位置：单独移除一个位置不删来源
        conn = conn_of(kb)
        conn.execute("INSERT OR REPLACE INTO nav_positions (source_id, section, nav_order) "
                     "VALUES (?, 'extra', 1)", (B,))
        conn.commit()
        conn.execute("DELETE FROM nav_positions WHERE source_id=? AND section='extra'", (B,))
        conn.commit(); conn.close()
        assert pipeline2.query(kb, "checkpoint", n=3), "移除一个导航位置后来源必须仍可检索"

        # 9) 旧引用不变义：标题/摘录是快照，版本行仍在
        crow = one(kb, "SELECT title, version_id, excerpt FROM citations WHERE citation_id=?",
                   (cit["citation_id"],))
        assert crow[0] == "Persistence" and crow[1] == V1 and "checkpoint" in crow[2], crow
        assert one(kb, "SELECT 1 FROM versions WHERE version_id=?", (V1,)), \
            "历史版本行一期不自动删除"

        # 10) 重启：recover 干净，查询正常
        rep = pipeline2.recover(kb)
        assert rep["building_failed"] == 0 and rep["missing_vectors"] == [], rep
        assert pipeline2.query(kb, "super-step", n=3)
        print(f"  [A] 双来源去重/共享保留/8→5/旧尾块隔离/改名保ID/下线语义/引用快照/重启 全部通过")
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ---------------------------------------------------------------- 路径 B


def test_b1_interrupt_before_commit() -> None:
    """候选写入后强制中断 → 恢复：继续旧版、候选不可见、可重试成功。"""
    root = tempfile.mkdtemp(prefix="kbv2-b1-")
    try:
        kb = make_kb(root, "v2b1")
        write(kb, "a.md", TEXT8)
        run(kb)
        A = source_by_path(kb, "a.md")
        V1 = active_of(kb, A)

        write(kb, "a.md", TEXT8.replace("第 2 段", "第 2 段！"))
        pipeline2.scan_sources(kb)
        try:
            pipeline2.update(kb, fail_at="build")
            raise SystemExit("fail_at=build 必须抛 FaultInjected")
        except pipeline2.FaultInjected:
            pass
        assert job_stage(kb) == "building"
        rep = pipeline2.recover(kb)
        assert rep["building_failed"] == 1, rep
        assert job_stage(kb) == "failed"
        assert active_of(kb, A) == V1, "提交前中断必须继续旧版"
        hits = pipeline2.query(kb, "checkpoint", n=20)
        assert hits and all(h["version_id"] == V1 for h in hits), \
            "候选向量在提交前进入了召回（候选泄漏）"

        r = pipeline2.update(kb)                        # 重试
        V2 = active_of(kb, A)
        assert V2 != V1 and vec_count(kb, V2) == 8 and vec_count(kb, V1) == 0
        assert r["updated"] == 1
        print("  [B1] 提交前中断：继续旧版 / 候选不可见 / 重试成功")
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_b2_interrupt_after_commit() -> None:
    """SQL 切换后强制中断 → 恢复只补清理，不丢已提交状态。"""
    root = tempfile.mkdtemp(prefix="kbv2-b2-")
    try:
        kb = make_kb(root, "v2b2")
        write(kb, "a.md", TEXT8)
        run(kb)
        A = source_by_path(kb, "a.md")
        V1 = active_of(kb, A)

        write(kb, "a.md", TEXT8.replace("第 3 段", "第 3 段！"))
        pipeline2.scan_sources(kb)
        try:
            pipeline2.update(kb, fail_at="switch")
            raise SystemExit("fail_at=switch 必须抛 FaultInjected")
        except pipeline2.FaultInjected:
            pass
        assert job_stage(kb) == "committed"
        V2 = active_of(kb, A)
        assert V2 != V1, "切换是原子事务：committed 后 active 已指向新版本"
        rep = pipeline2.recover(kb)
        assert rep["cleanup_resumed"] == 1, rep
        assert job_stage(kb) == "done"
        assert vec_count(kb, V1) == 0 and vec_count(kb, V2) == 8, "补清理必须回收旧向量"
        print("  [B2] 切换后中断：状态已提交 / 恢复只补清理 / 旧向量回收")
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_b3_model_switch() -> None:
    """换模型：新集合实例完整建好才切换；旧集合安全点作废；跨模型不混用。"""
    root = tempfile.mkdtemp(prefix="kbv2-b3-")
    try:
        kb = make_kb(root, "v2b3")
        write(kb, "a.md", TEXT8)
        run(kb)
        V1 = active_of(kb, source_by_path(kb, "a.md"))
        coll1 = state_of(kb)["collection"]

        # 3a：候选构建期中断 → 旧指针不变，旧模型继续可检
        cfg = json.loads(kb.kb_json_path.read_text(encoding="utf-8"))
        cfg["embedding"]["model"] = "bge-large"
        kb.write_cfg(cfg)
        try:
            pipeline2.update(kb, fail_at="build")       # update 自动转 model_switch
            raise SystemExit("fail_at=build 必须抛 FaultInjected")
        except pipeline2.FaultInjected:
            pass
        assert state_of(kb)["collection"] == coll1, "换模型提交前中断必须保留旧集合指针"
        assert pipeline2.query(kb, "checkpoint", n=3), "旧集合在切换前必须继续可检"

        # 3b：重试 → 完整切换
        pipeline2.update(kb)
        st = state_of(kb)
        coll2 = st["collection"]
        assert coll2 != coll1 and coll2.startswith("chunks_bgelarge"), (coll1, coll2)
        store = open_store(kb, collection=coll2)
        assert store.list_collections() == [coll2], \
            f"旧集合未在安全点作废：{store.list_collections()}"
        fp = st["embedding"]["fingerprint"]
        ids = store.get_ids_where({"embedding_model": {"$ne": fp}})
        assert ids == [], f"跨模型混用：当前集合存在旧指纹向量 {len(ids)} 个"
        store.close()
        assert vec_count(kb, V1) == 8, "模型更新不改变文本版本，但向量必须在新集合重建"
        assert pipeline2.query(kb, "checkpoint", n=3)
        print(f"  [B3] 换模型：{coll1} → {coll2}；旧集合已作废；无跨模型混用")
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_b4_cleanup_failure_retry() -> None:
    """清理失败不吞没：更新已提交 + 失败另报；恢复后补清理成功。"""
    root = tempfile.mkdtemp(prefix="kbv2-b4-")
    try:
        kb = make_kb(root, "v2b4")
        write(kb, "a.md", TEXT8)
        run(kb)
        A = source_by_path(kb, "a.md")
        V1 = active_of(kb, A)

        write(kb, "a.md", TEXT8.replace("第 4 段", "第 4 段！"))
        pipeline2.scan_sources(kb)
        store_class = ChromaStore if ENGINE == "chroma" else MemoryStore
        with mock.patch.object(store_class, "delete_ids",
                               side_effect=RuntimeError("注入的清理失败")):
            try:
                pipeline2.update(kb)
                raise SystemExit("清理失败必须另报（KbError），不能静默吞没")
            except Exception as e:
                assert "清理失败" in str(e), str(e)
        assert job_stage(kb) == "committed"
        V2 = active_of(kb, A)
        assert V2 != V1, "清理失败不影响已提交的切换"
        hits = pipeline2.query(kb, "checkpoint", n=20)
        assert all(h["version_id"] == V2 for h in hits), \
            "无论物理清理成功与否，旧向量都不再可见（版本前置过滤）"
        # recover 幂等且会被 query 先行触发（设计如此）；以最终状态断言：
        # 任务全部 done、旧向量已回收、新向量完整
        pipeline2.recover(kb)
        assert job_stage(kb) == "done"
        assert vec_count(kb, V1) == 0 and vec_count(kb, V2) == 8
        print("  [B4] 清理失败另报 / 旧向量逻辑上不可见 / 恢复补清理成功")
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_b5_disk_full_keeps_old() -> None:
    """空间不足：准备阶段失败，旧版完整保留、任务记 failed。"""
    root = tempfile.mkdtemp(prefix="kbv2-b5-")
    try:
        kb = make_kb(root, "v2b5")
        write(kb, "a.md", TEXT8)
        run(kb)
        A = source_by_path(kb, "a.md")
        V1 = active_of(kb, A)
        n_versions = one(kb, "SELECT COUNT(*) FROM versions")[0]

        write(kb, "a.md", TEXT8.replace("第 5 段", "第 5 段！"))
        pipeline2.scan_sources(kb)
        try:
            pipeline2.update(kb, disk_free_override=1)
            raise SystemExit("空间不足必须在准备阶段失败")
        except Exception as e:
            assert "空间不足" in str(e), str(e)
        assert job_stage(kb) == "failed"
        assert active_of(kb, A) == V1, "空间不足必须保留旧版"
        assert one(kb, "SELECT COUNT(*) FROM versions")[0] == n_versions, \
            "准备阶段失败不得写入任何新版本"
        assert pipeline2.query(kb, "checkpoint", n=3)
        print("  [B5] 空间不足：准备阶段失败 / 旧版完整保留 / 可继续检索")
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ---------------------------------------------------------------- 路径 C（后端段）


def test_c_backup_restore() -> None:
    """备份 → 独立恢复核对通过；缺向量的副本必须停止检索。"""
    root = tempfile.mkdtemp(prefix="kbv2-c-")
    try:
        kb = make_kb(root, "v2c")
        write(kb, "a.md", TEXT8)
        run(kb)
        A = source_by_path(kb, "a.md")
        V1 = active_of(kb, A)
        pipeline2.save_citation(kb, A, f"{V1}-0001")

        dest = os.path.join(root, "backup-1")
        pipeline2.backup(kb, dest)
        for name in ("kb.json", "source", "parsed", "vectordb",
                     os.path.join("datadb", "kb.db")):
            assert os.path.exists(os.path.join(dest, name)), f"备份缺少 {name}"

        rb = Kb(dest)
        rep = pipeline2.restore_check(rb)
        assert rep["ok"], json.dumps(rep, ensure_ascii=False)
        hits = pipeline2.query(rb, "checkpoint", n=3)
        assert hits and hits[0]["source_id"] == A, "恢复副本必须可检索且来源 ID 稳定"

        # 缺向量的副本：未备份向量 → 核对报告缺失 → 检索被拒绝
        dest2 = os.path.join(root, "backup-2")
        pipeline2.backup(kb, dest2)
        shutil.rmtree(os.path.join(dest2, "vectordb"))
        rb2 = Kb(dest2)
        rep2 = pipeline2.restore_check(rb2)
        assert not rep2["ok"] and rep2["missing_vectors"], rep2
        try:
            pipeline2.query(rb2, "checkpoint", n=3)
            raise SystemExit("缺向量必须停止检索")
        except Exception as e:
            assert "向量缺失" in str(e) or "缺失" in str(e), str(e)
        print("  [C] 备份→独立恢复核对通过；缺向量副本拒绝检索（前端修改段不在本文件）")
    finally:
        shutil.rmtree(root, ignore_errors=True)


def main() -> int:
    print(f"engine = {ENGINE}")
    cases = [
        test_path_a,
        test_b1_interrupt_before_commit,
        test_b2_interrupt_after_commit,
        test_b3_model_switch,
        test_b4_cleanup_failure_retry,
        test_b5_disk_full_keeps_old,
        test_c_backup_restore,
    ]
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
