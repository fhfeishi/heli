"""端到端：建库分组 → 导入 → 检索 → 证据 → 成果 → 归档/重启。

跑法：python tests/test_app_http.py
"""
import json
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "heli-src"))
from app import create_app

DOC_A = b"""# \xe5\x86\x9c\xe4\xb8\x9a\xe5\x85\x89\xe4\xbc\x8f\xe6\x95\x88\xe7\x8e\x87\n\n\xe6\x9c\xac\xe9\xa1\xb9\xe7\x9b\xae\xe7\xa0\x94\xe7\xa9\xb6\xe5\x85\x89\xe5\x90\x88\xe6\x95\x88\xe7\x8e\x87\xe6\x8f\x90\xe5\x8d\x87\xe4\xba\x86 18%\xe3\x80\x82\n"""
DOC_B = b"""# \xe5\xaf\xb9\xe7\x85\xa7\xe7\xbb\x84\n\n\xe5\x85\x89\xe5\x90\x88\xe6\x95\x88\xe7\x8e\x87\xe6\xb2\xa1\xe6\x9c\x89\xe6\x98\xbe\xe8\x91\x97\xe5\x8f\x98\xe5\x8c\x96\xe3\x80\x82\n"""


def _serve(data_root):
    server, store = create_app(data_root, 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, store


def _call(port, method, path, body=None, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    request = Request(f"http://127.0.0.1:{port}{path}", data=data, method=method,
                      headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urlopen(request) as response:
            payload = response.read()
            if response.headers.get_content_type() == "application/json":
                return response.status, json.loads(payload)
            return response.status, payload.decode("utf-8", "replace")
    except HTTPError as error:
        return error.code, json.loads(error.read())


def main() -> int:
    with tempfile.TemporaryDirectory() as temp:
        data_root = Path(temp) / "data"
        server, _ = _serve(data_root)
        port = server.server_port

        # 0 健康检查暴露模型通道
        code, health = _call(port, "GET", "/api/health")
        assert code == 200 and health["model_channel"] == "none", health

        # 1 建库
        code, lib_a = _call(port, "POST", "/api/libraries", {"name": "农业项目", "description": "示例"})
        assert code == 201, lib_a
        code, lib_b = _call(port, "POST", "/api/libraries", {"name": "对照资料"})
        assert code == 201

        # 2 建组（含子组），把 A 放进父组
        code, group = _call(port, "POST", "/api/groups", {"name": "科研项目", "hue": "sky"})
        assert code == 201, group
        code, child = _call(port, "POST", "/api/groups", {"name": "纵向", "parent_id": group["id"]})
        assert code == 201
        code, moved = _call(port, "PUT", f"/api/groups/{group['id']}/members",
                            {"library_ids": [lib_a["id"]]})
        assert code == 200 and moved["library_ids"] == [lib_a["id"]]

        # 3 同一个库也能进另一个组（没有主归属概念）
        code, both = _call(port, "POST", f"/api/groups/{child['id']}/members", {"library_id": lib_a["id"]})
        assert code == 200 and set(both["library_ids"]) == {lib_a["id"]}

        # 4 导入：文本进索引，二进制只登记
        code, src_a = _call(port, "POST", f"/api/libraries/{lib_a['id']}/sources", raw=DOC_A,
                            headers={"X-Filename": "report.md", "Content-Type": "text/markdown"})
        assert code == 201 and src_a["indexed"] is True, src_a
        code, again = _call(port, "POST", f"/api/libraries/{lib_a['id']}/sources", raw=DOC_A,
                            headers={"X-Filename": "report.md", "Content-Type": "text/markdown"})
        assert code == 201 and again["unchanged"] is True
        code, src_b = _call(port, "POST", f"/api/libraries/{lib_b['id']}/sources", raw=DOC_B,
                            headers={"X-Filename": "baseline.md", "Content-Type": "text/markdown"})
        assert code == 201 and src_b["indexed"] is True
        code, blob = _call(port, "POST", f"/api/libraries/{lib_a['id']}/sources", raw=b"\x00\x01\x02\xff",
                           headers={"X-Filename": "clip.mp4", "Content-Type": "application/octet-stream"})
        assert code == 201 and blob["indexed"] is False and blob["status"] == "registered", blob

        # 5 组范围只命中组内库；全库命中两家
        code, scoped = _call(port, "GET", f"/api/search?q=%E5%85%89%E5%90%88%E6%95%88%E7%8E%87&scope=group:{group['id']}")
        assert code == 200 and len(scoped["hits"]) == 1, scoped
        hit = scoped["hits"][0]
        assert hit["source_id"] == src_a["source"]["id"]
        code, everywhere = _call(port, "GET", "/api/search?q=%E5%85%89%E5%90%88%E6%95%88%E7%8E%87&scope=all")
        assert code == 200 and len(everywhere["hits"]) == 2, everywhere

        # 6 位置必须能逐字命中；二进制不产生正文
        code, text = _call(port, "GET", f"/api/sources/{hit['source_id']}/text")
        assert code == 200 and isinstance(hit["position"], int), hit
        assert text["text"][hit["position"]:hit["position"] + 4] == "光合效率"
        code, no_text = _call(port, "GET", f"/api/sources/{blob['source']['id']}/text")
        assert code == 409, no_text

        # 7 任务 + 运行（未接模型 → 证据包）
        code, task = _call(port, "POST", "/api/tasks",
                           {"title": "光合效率结论", "goal": "光合效率", "scope": {"kind": "group", "id": group["id"]}})
        assert code == 201, task
        code, _ = _call(port, "POST", f"/api/tasks/{task['id']}/messages",
                        {"content": "这批资料里光合效率有什么结论"})
        assert code == 201
        code, run = _call(port, "POST", f"/api/tasks/{task['id']}/runs", {"kind": "research"})
        assert code == 202, run
        deadline, state = time.time() + 8, run
        while time.time() < deadline:
            _, state = _call(port, "GET", f"/api/runs/{run['id']}")
            if state["status"] in ("done", "failed", "cancelled", "interrupted"):
                break
            time.sleep(0.05)
        assert state["status"] == "done", state
        assert state["output"]["hits"] == 1

        # 8 成果：草稿可读、引用可回溯、导出可用
        artifact_id = state["output"]["artifact_id"]
        code, artifact = _call(port, "GET", f"/api/artifacts/{artifact_id}")
        assert code == 200 and artifact["kind"] == "evidence_pack"
        assert "未接模型" in artifact["body_md"]
        assert artifact["citations"][0]["version_id"] in state["output"]["versions"]
        code, md = _call(port, "GET", f"/api/artifacts/{artifact_id}/export.md")
        assert code == 200 and "引用来源" in md

        # 9 编辑成果生成新版本，旧修订保留
        code, edited = _call(port, "PATCH", f"/api/artifacts/{artifact_id}",
                             {"body_md": artifact["body_md"] + "\n\n人工补充：待核验。"})
        assert code == 200 and edited["revision"] == 2 and edited["revisions"] == [1, 2]

        # 10 归档库后：不再进新检索，但历史引用仍可打开
        code, _ = _call(port, "DELETE", f"/api/libraries/{lib_a['id']}")
        assert code == 200
        code, after = _call(port, "GET", "/api/search?q=%E5%85%89%E5%90%88%E6%95%88%E7%8E%87&scope=all")
        assert code == 200 and all(item["source_id"] != src_a["source"]["id"] for item in after["hits"]), after
        code, still = _call(port, "GET", f"/api/sources/{src_a['source']['id']}/text"
                                        f"?version={artifact['citations'][0]['version_id']}")
        assert code == 200 and "18%" in still["text"]

        # 11 失败写入不清空已有数据
        code, bad = _call(port, "PUT", f"/api/groups/{group['id']}/members",
                          {"library_ids": ["lib_missing"]})
        assert code == 404, bad
        code, intact = _call(port, "GET", f"/api/groups/{group['id']}")
        assert intact["library_ids"] == [lib_a["id"]], intact

        # 12 重启后数据仍在
        server.shutdown()
        server2, _ = _serve(data_root)
        code, libs = _call(server2.server_port, "GET", "/api/libraries?include_archived=1")
        archived = [item for item in libs["libraries"] if item["name"] == "农业项目"]
        assert code == 200 and archived and archived[0]["archived_at"], libs
        code, artifact2 = _call(server2.server_port, "GET", f"/api/artifacts/{artifact_id}")
        assert code == 200 and artifact2["revision"] == 2
        server2.shutdown()

    print("heli app http: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
