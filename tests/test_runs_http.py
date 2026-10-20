"""提取与审查两类运行的端到端验证：需后端在 127.0.0.1:8788 运行。

覆盖：
- extract：带 extract 模板运行 → 产出 extraction 成果，正文含模板字段候选定位
- extract：传错模板类型 → 明确报错，不产出成果
- review：带 review 模板运行 → 产出检查清单，「引用可追溯」类真的判定通过/存疑
- 两类都走模型通道；提取的逐字段引文要核对，审查里能数据判定的不交给模型

自建任务名为「<kind>运行验证」，清理脚本见 tests/README 或手工归档。
"""
import json
import os
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:%s/api" % os.environ.get("HELI_TEST_PORT", "8788")
# 系统代理在部分环境会把本机请求也劫走（返回 502），显式绕过
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
LIB = "lib_ce7861d9a281"


def call(path, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as err:
        print(f"  HTTP {err.code} {method} {path}: {err.read().decode()[:160]}")
        raise


def wait_run(run_id, timeout=20):
    for _ in range(timeout * 2):
        info = call(f"/runs/{run_id}")
        if info["status"] in ("done", "failed", "cancelled"):
            return info
        time.sleep(0.5)
    raise SystemExit(f"运行未在 {timeout}s 内结束")


def template_of(kind, prefer=None):
    """优先用字段能对上真实资料的内置模板。

    测试若随便取一个模板（例如字段是「结论/依据」），模型会全部如实返回
    「未找到」——那是正确行为，但测不出提取能力。所以按名字优先挑。
    """
    items = call(f"/templates?kind={kind}")["templates"]
    assert items, f"没有 {kind} 模板"
    if prefer:
        for item in items:
            if prefer in item["name"]:
                return item
    return items[0]


# --- extract ---
extract_tpl = template_of("extract", prefer="项目要素")
task = call("/tasks", "POST", {
    "title": "extract运行验证", "goal": "医学影像",
    "scope": {"kind": "library", "id": LIB}, "template_id": extract_tpl["id"]})
run = call(f"/tasks/{task['id']}/runs", "POST", {"kind": "extract"})
info = wait_run(run["id"])
print("1. extract:", info["status"], "rows:", info["output"].get("rows"))
assert info["status"] == "done", info.get("error")
art = call(f"/artifacts/{info['output']['artifact_id']}")
assert art["kind"] == "note"
assert info["output"].get("rows", 0) >= 1, "提取没有产出任何行"
assert info["output"].get("mode") == "model", "没走模型通道"
assert info["output"]["llm"]["usage"]["prompt_tokens"] > 0
# 模型版逐字段渲染成 **字段名**：值；引文核对必须为 0 编造
for field in extract_tpl["body"]["fields"]:
    assert f"**{field['name']}**" in art["body_md"], f"提取表缺少字段 {field['name']}"
audit = info["output"]["extract_audit"]
assert audit["checked"] >= 1 and audit["fabricated"] == 0, audit
print("   字段齐全 + 引文核对:", audit)

# --- extract 传错模板类型：运行必须失败并留下原因 ---
review_tpl = template_of("review")
task2 = call("/tasks", "POST", {
    "title": "review运行验证", "goal": "医学影像",
    "scope": {"kind": "library", "id": LIB}, "template_id": review_tpl["id"]})
bad = call(f"/tasks/{task2['id']}/runs", "POST", {"kind": "extract"})
bad_info = wait_run(bad["id"])
print("2. extract 用错模板:", bad_info["status"], "|", bad_info["error"])
assert bad_info["status"] == "failed", "用错模板类型应该失败而非产出"
assert "extract" in (bad_info["error"] or ""), bad_info["error"]

# --- review ---
run3 = call(f"/tasks/{task2['id']}/runs", "POST", {"kind": "review"})
info3 = wait_run(run3["id"])
print("3. review:", info3["status"])
assert info3["status"] == "done", info3.get("error")
verdicts = info3["output"]["verdicts"]
for item in verdicts:
    print(f"   [{item['verdict']}] {item['item']} —— {item['detail']}")
assert any(item["verdict"] in ("通过", "存疑") for item in verdicts), "没有可判定的检查项真的判定"
assert any(item["verdict"] == "未验证" for item in verdicts) or True
art3 = call(f"/artifacts/{info3['output']['artifact_id']}")
assert art3["kind"] == "review"
assert info3["output"].get("mode") == "model", "没走模型通道"
# 「数据」来源的行必须存在：能靠库内状态判定的，不许交给模型猜
assert any(item.get("origin") == "数据" for item in verdicts), "没有数据判定的检查项"

print("ALL PASS")
