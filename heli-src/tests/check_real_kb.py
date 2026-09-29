"""真实库对账：新 manifest.jsonl vs 旧 source_demo/structure/sitemap.jsonl（只读参考）。

用途是给 §3.1 标识规则与 §3.2 清单字段提供实地证据，不是单元测试：
它验证的是「重写后的 scan 能否复现既有结论」，差异会逐条列出来，不做静默修正。
"""

from __future__ import annotations

import json
import os
import sys

KB = os.environ.get(
    "HELI_KB", r"Z:/home/baheas/wslcodespace/heli/.knowledge/langchain_docs")
OLD = os.path.join(KB, "source_demo", "structure", "sitemap.jsonl")
OLD_LINKS = os.path.join(KB, "source_demo", "structure", "links.jsonl")


def main() -> int:
    new = [json.loads(l) for l in open(os.path.join(KB, "manifest.jsonl"), encoding="utf-8")]
    old = {json.loads(l)["path"]: json.loads(l)
           for l in open(OLD, encoding="utf-8")}
    new_by_path = {r["path"]: r for r in new}

    print(f"新清单 {len(new)} 行 / 旧 sitemap {len(old)} 行")

    # 1) doc_id：标识规则的核心，必须完全一致
    both = sorted(set(new_by_path) & set(old))
    id_diff = [p for p in both if new_by_path[p]["doc_id"] != old[p]["doc_id"]]
    print(f"[doc_id]      重叠 {len(both)} 篇，不一致 {len(id_diff)}")
    for p in id_diff[:5]:
        print("   ", p, new_by_path[p]["doc_id"], "!=", old[p]["doc_id"])

    # 2) 逐字段对账
    fields = [("sha256", "sha256"), ("bytes", "bytes"), ("section", "section"),
              ("order", "order"), ("order_source", "order_source"),
              ("title", "title"), ("title_source", "title_source"),
              ("url", "url"), ("lines", "lines"), ("html_density", "html_density")]
    for nf, of in fields:
        diff = [p for p in both if new_by_path[p].get(nf) != old[p].get(of)]
        print(f"[{nf:13s}] 不一致 {len(diff)}")
        for p in diff[:3]:
            print(f"    {p}: new={new_by_path[p].get(nf)!r} old={old[p].get(of)!r}")

    # 3) value_class：只看 1423 篇正文文档（导航原始件在旧表里不存在）
    docs_new = {p: r for p, r in new_by_path.items() if r["kind"] == "doc"}
    vc_new = {p for p, r in docs_new.items() if r["value_class"] == "nav_only"}
    vc_old = {p for p, r in old.items() if r["value_class"] != "doc"}
    print(f"[value_class] nav_only 新 {len(vc_new)} / 旧 {len(vc_old)}；"
          f"多标 {sorted(vc_new - vc_old)}；漏标 {sorted(vc_old - vc_new)}")

    # 4) links
    nl = [json.loads(l) for l in open(os.path.join(KB, "links.jsonl"), encoding="utf-8")]
    ol = [json.loads(l) for l in open(OLD_LINKS, encoding="utf-8")]
    print(f"[links]       新 {len(nl)}（uniq src,dst = "
          f"{len({(l['src'], l['dst']) for l in nl})}）"
          f" / 旧 {len(ol)}（uniq = {len({(l['src'], l['dst']) for l in ol})}）")
    print(f"[links]       有出链的文档数：新 {len({l['src'] for l in nl})} / "
          f"旧 {len({l['src'] for l in ol})}")

    # 5) nav.json
    nav = json.load(open(os.path.join(KB, "nav.json"), encoding="utf-8"))
    print(f"[nav.json]    sections {len(nav['sections'])}；"
          f"有顺序的条目 {sum(1 for s in nav['sections'].values() for d in s if d['order'] is not None)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
