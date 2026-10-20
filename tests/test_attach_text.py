"""attach 的端到端验证：MinerU 的 md 挂回原 PDF，不新建资料、不动原件。

覆盖：
- 扫描件（registered）挂上 md 后变 indexed，正文可读、可检索
- 原件 sha256 不变（正文是派生，不是新版本）
- 默认不覆盖已可检索的资料；--all 才覆盖
- 未匹配的 md、没有 md 的资料都被如实报出
- 重复挂载幂等（同一份不会产生第二条 derived）
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "heli-src"))

import catalog  # noqa: E402
import content  # noqa: E402
import retrieval  # noqa: E402
from models import Scope  # noqa: E402
from storage import Store  # noqa: E402

# 一个合法开头但内容不全的 PDF：pypdf 解不出正文 → registered
FAKE_PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n"
GOOD_MD = "# 结题报告\n\n本项目研究医学影像的弱监督分割方法，采用拓扑学特征与多模态融合。\n"


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "data"
        store = Store(root)
        store.init()
        library = catalog.create_library(store, "挂载验证库")

        scanned = content.import_source(store, library["id"], "扫描件甲.pdf", FAKE_PDF,
                                        rel_path="2023/扫描件甲.pdf", parse_pdf=True)
        plain = content.import_source(store, library["id"], "可解析乙.pdf", FAKE_PDF,
                                      rel_path="2023/可解析乙.pdf", parse_pdf=True)
        print("1. 导入后状态:", scanned["status"], plain["status"])
        assert scanned["status"] == "registered", "造不出不可检索状态，测试前提不成立"

        # 把其中一份伪装成已可检索，用来验证「默认不覆盖」
        content.attach_text(store, plain["source"]["id"], "原有正文：可解析乙。", origin="pypdf")
        assert content.get_source(store, plain["source"]["id"])["status"] == "indexed"

        out = Path(tmp) / "mineru"
        (out / "扫描件甲" / "auto").mkdir(parents=True)
        (out / "扫描件甲" / "auto" / "扫描件甲.md").write_text(GOOD_MD, encoding="utf-8")
        (out / "可解析乙" / "auto").mkdir(parents=True)
        (out / "可解析乙" / "auto" / "可解析乙.md").write_text("# 乙\n\n新正文。\n", encoding="utf-8")
        (out / "没有这份资料").mkdir()
        (out / "没有这份资料" / "没有这份资料.md").write_text("# 无关\n", encoding="utf-8")
        (out / "扫描件甲" / "auto" / "images").mkdir()
        (out / "扫描件甲" / "auto" / "images" / "figure.md").write_text("图片说明，不该被当正文", encoding="utf-8")

        before = content.get_source(store, scanned["source"]["id"])
        report = content.attach_from_dir(store, library["id"], out)
        print("2. md 文件数:", report["markdown_files"], "| 挂载:", len(report["matched"]),
              "| 跳过已索引:", len(report["skipped_indexed"]),
              "| 无主 md:", len(report["unmatched_markdown"]))
        # images/ 下的 md 被排除；只剩两份有主的 + 一份无主
        assert report["markdown_files"] == 3, report["markdown_files"]
        assert len(report["matched"]) == 1 and report["matched"][0]["source_id"] == scanned["source"]["id"]
        assert len(report["skipped_indexed"]) == 1, "已可检索的资料默认不该被覆盖"
        assert len(report["unmatched_markdown"]) == 1

        after = content.get_source(store, scanned["source"]["id"])
        print("3. 挂载后状态:", after["status"], "| 原件 sha 未变:", before["sha256"] == after["sha256"])
        assert after["status"] == "indexed"
        assert after["sha256"] == before["sha256"], "挂正文不该改动原件哈希"

        text = content.read_text(store, scanned["source"]["id"])
        print("4. 正文来源:", text["locator"], "| 字符数:", len(text["text"]))
        assert text["locator"] == "chars:mineru"
        assert "弱监督分割" in text["text"]

        hits = retrieval.search(store, Scope(kind="library", id=library["id"]), "弱监督分割")
        print("5. 检索命中:", len(hits), [hit["title"] for hit in hits])
        assert hits and hits[0]["source_id"] == scanned["source"]["id"]

        # 幂等：再挂一次不产生第二条 derived
        content.attach_from_dir(store, library["id"], out)
        with store.read() as conn:
            rows = conn.execute(
                "SELECT COUNT(*) FROM derived d JOIN versions v ON v.id = d.version_id "
                "WHERE v.source_id=?", (scanned["source"]["id"],)).fetchone()[0]
            indexed = conn.execute(
                "SELECT COUNT(*) FROM search_index WHERE source_id=?",
                (scanned["source"]["id"],)).fetchone()[0]
        print("6. 重复挂载后 derived/索引条数:", rows, indexed)
        assert rows == 1 and indexed == 1, "重复挂载产生了重复正文或重复索引"

        # --all 覆盖已索引
        forced = content.attach_from_dir(store, library["id"], out, override_indexed=True)
        assert len(forced["matched"]) == 2, forced["matched"]
        assert content.read_text(store, plain["source"]["id"])["text"].strip().endswith("新正文。")

        # 没有 md 的资料要被报出来
        content.import_source(store, library["id"], "无解丙.pdf", FAKE_PDF,
                              rel_path="2024/无解丙.pdf", parse_pdf=True)
        again = content.attach_from_dir(store, library["id"], out)
        missing = [item["path"] for item in again["unmatched_sources"]]
        print("7. 仍缺 md 的资料:", missing)
        assert "2024/无解丙.pdf" in missing

    print("ALL PASS")


if __name__ == "__main__":
    main()
