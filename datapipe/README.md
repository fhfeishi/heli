# datapipe · 数据处理审计

这里记录 heli 把「外部资料」变成「可检索资料」的过程。目的不是运行日志，而是**审查**：
事后能回答「这批文件按什么规则处理的、哪些没进来、为什么」。

## 目录

```text
datapipe/
├─ README.md        本说明
└─ runs/            一次批量处理一份 JSON（只追加，不自动清理）
   └─ 20261019-130500-import-a1b2c3.json
```

## 三类批量管道

| kind | 做什么 | 入口 |
|---|---|---|
| `import` | 扫描旧库根，按内容哈希保存原件，文本进索引 | `python heli-src/cli.py import --from <目录>` |
| `reparse` | 对「仅登记」的 PDF 补做文本层提取 | `python heli-src/cli.py reparse` |
| `reindex` | 从 `derived` 重建 FTS5 索引 | `python heli-src/cli.py reindex` |

单次上传（`POST /api/libraries/<id>/sources`）不写这里：它由 `sources` / `versions` 表逐条记录，
属于交互操作，不是批量转换。

## 记录怎么读

| 字段 | 含义 |
|---|---|
| `run_id` | 时间 + 类型 + 随机后缀，与文件名一致 |
| `status` | `running` / `done` / `failed` / `stopped` |
| `params` | 本次输入与规则（源目录、接受格式、内部目录、是否解析 PDF、空文件策略），规则变化直接体现在这里 |
| `libraries[]` | 每个库的 `files_seen / imported / indexed / skipped / failed` |
| `libraries[].skipped_reasons` | 按原因计数：`hidden` / `internal_dir` / `not_document` / `empty` |
| `libraries[].skipped_samples` | 每种原因最多 20 条样本路径（不是全量，避免记录比资料还大） |
| `errors[]` | 失败明细（上限 200 条，超出记入 `errors_dropped`） |
| `git_head` / `python` / `platform` / `pid` | 复现所需的环境信息 |
| `duration_sec` | 耗时 |

`status=running` 且没有后续记录，说明进程被强杀（OOM、关机、任务取消）。这本身就是要审查的事实，
不要手工把它改成 `done`。

## 审查示例

```bash
# 最近一次导入
ls -t datapipe/runs | head -1

# 每个库进来了多少、跳过了多少
python - <<'PY'
import json, pathlib
p = sorted(pathlib.Path("datapipe/runs").glob("*import*.json"))[-1]
d = json.loads(p.read_text())
print(p.name, d["status"], d["counters"])
for lib in d["libraries"]:
    print(f'{lib["name"]:<40} seen={lib["files_seen"]} imported={lib["imported"]} skipped={lib["skipped"]}')
PY
```

## 约定

- 记录只写结论与路径，不复制正文，不含资料内容；
- 写记录失败只警告，不阻断处理（审计是旁路，不是事务的一部分）；
- 不自动清理；要归档就整目录打包，文件名按时间可排序；
- 需要换位置时设 `HELI_DATAPIPE`，不要改代码里的默认值。
