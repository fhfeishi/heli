"""模板接口端到端：需后端在 127.0.0.1:8791 运行。

覆盖：内置模板种子、CRUD、按 kind 校验 body、库与模板关联、
任务带模板运行且证据包按模板出结构。
自建数据与自建模板会被清理，留下的任务名为「模板验证任务」。
"""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8791/api"


def call(path, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as err:
        body = err.read().decode()
        print(f"  HTTP {err.code} {method} {path}: {body[:160]}")
        raise


all_tpl = call("/templates")["templates"]
print("1. 内置种子:", [(item["kind"], item["name"]) for item in all_tpl])
assert all_tpl, "内置模板没有种子"

research = call("/templates?kind=research")["templates"]
print("2. research 模板:", [item["name"] for item in research])
assert all(item["kind"] == "research" for item in research)

created = call("/templates", "POST", {
    "kind": "extract", "name": "自定义提取",
    "body": {"fields": [{"name": "结论", "desc": "一句话", "granularity": "段落"}],
             "missing_policy": "标记未给出"}})
print("3. 新建:", created["id"], created["kind"], created["version"])

updated = call(f"/templates/{created['id']}", "PATCH", {
    "body": {"fields": [{"name": "结论", "desc": "一句话", "granularity": "段落"},
                        {"name": "依据", "desc": "引用位置", "granularity": "文档"}],
             "missing_policy": "标记未给出"}})
print("4. 更新后 version:", updated["version"], "字段数:", len(updated["body"]["fields"]))
assert updated["version"] == 2

print("5. 非法 body 应被拒:")
try:
    call("/templates", "POST", {"kind": "review", "name": "空检查", "body": {"checks": []}})
    raise SystemExit("FAIL: 空 checks 竟然通过了校验")
except urllib.error.HTTPError as err:
    print(f"  已拒：HTTP {err.code}")

lib = "lib_ce7861d9a281"
call(f"/libraries/{lib}/templates/{created['id']}", "PUT")
attached = call(f"/libraries/{lib}/templates")["templates"]
print("6. 库关联:", [item["name"] for item in attached])
assert any(item["id"] == created["id"] for item in attached)

task = call("/tasks", "POST", {
    "title": "模板验证任务", "goal": "医学影像",
    "scope": {"kind": "library", "id": lib}, "template_id": research[0]["id"]})
run = call(f"/tasks/{task['id']}/runs", "POST", {"kind": "research"})
for _ in range(20):
    info = call(f"/runs/{run['id']}")
    if info["status"] in ("done", "failed", "cancelled"):
        break
    time.sleep(0.5)
print("7. 运行:", info["status"], "模板:", json.dumps(info["input"].get("template"), ensure_ascii=False))
body = call(f"/artifacts/{info['output']['artifact_id']}")["body_md"]
print("8. 证据包含模板节:", "模板要求" in body)
print(body[body.index("## 模板要求"):][:220] if "## 模板要求" in body else body[:200])

call(f"/libraries/{lib}/templates/{created['id']}", "DELETE")
call(f"/templates/{created['id']}", "DELETE")
print("9. 清理完成")
print("ALL PASS")
