# heli-src · 后端源码

一个应用、一份关系真源、五个业务模块。设计见
[.logsdev/library-platform-top-level-design.md](../.logsdev/library-platform-top-level-design.md)（v4）。

**目录本身就是源码根**：不再套一层 Python 包，模块之间同级导入（`import storage`）。
启动 `python heli-src/app.py`，测试 `python tests/test_app_http.py`。

## 模块

| 文件 | 职责 | 不允许 |
|---|---|---|
| `storage.py` | SQLite schema、连接、事务、原子文件写 | 业务判断 |
| `catalog.py` | 组、库、成员关系、背景 | 碰文件内容 |
| `content.py` | 导入、格式分派、原文读取、派生文本 | 组织关系 |
| `retrieval.py` | `resolve_scope` / `search` / `read` | 拼 HTTP 响应 |
| `tasks.py` | 任务、会话、运行状态机、证据包 | 直接写成果正文 |
| `artifacts.py` | 成果、修订、Markdown 导出 | 触发检索 |
| `routes.py` | 请求解析、参数校验、响应形状 | 写业务 SQL |
| `app.py` | 组件装配、HTTP 服务、静态页与 SPA 回退 | 业务规则 |
| `cli.py` | 维护入口（init/info/import/reparse/reindex/search） | 与 API 重复实现 |
| `pipeline.py` | 批量处理审计：输入、规则、计数、跳过原因 | 参与业务判断 |
| `llm.py` | 模型通道（DeepSeek / OpenAI 兼容），含重试与用量回报 | 拼业务 prompt、写成果 |
| `config.py` | 唯一配置入口（数据根、旧库根、端口、模型通道） | 读散落的环境变量 |

依赖方向单向：`storage → 业务模块 → routes → app`，CLI 复用业务模块。业务模块不依赖 HTTP 请求对象。

## 数据根

位置不写死：`--data` > 环境变量 `HELI_DATA` > 项目根 `.env` > `<项目根>/heli-data`。
本项目 `.env` 指向 `E:\local_db\.knowledge\.heli`；`python heli-src/config.py` 会显示解析结果与来源。

```
<数据根>/
├─ heli.db      组织、来源、版本、派生、任务、消息、运行、成果、修订、全文索引（FTS5）
├─ sources/     <library_id>/<sha 前 2 位>/<sha256>/<原文件名>   按内容哈希，改内容不覆盖旧版
├─ derived/     解析正文等可重建产物
├─ artifacts/   成果正文与导出
└─ temp/        可清理
```

## 命令

```bash
python heli-src/app.py --port 8788 --web heli-web/dist          # 页面 + API
python heli-src/cli.py --data heli-data info                  # 规模与状态
python heli-src/cli.py --data heli-data import --from /mnt/e/local_db/.knowledge
python heli-src/cli.py --data heli-data reparse               # 给「仅登记」的资料补做解析
python heli-src/cli.py --data heli-data reindex
python heli-src/cli.py --data heli-data search "光合效率"
python heli-src/config.py                                        # 数据根 / 旧库根 / 端口 / 模型通道
```

批量处理（`import` / `reparse` / `reindex`）会把本次的输入、规则、每个库的计数、跳过原因与失败明细
写到 `<项目根>/datapipe/runs/<run_id>.json`。格式与审查方式见 [datapipe/README.md](../datapipe/README.md)。
写记录失败只警告，不阻断处理；进程被强杀时会留下一份 `status=running` 的记录。

## 关键口径

- **原件与正文分开**：`sources` 存原文件，`derived` 存解析文本，绝不把二进制按 UTF-8 解码成正文。
- **PDF 提取文本层**：装了 `pypdf` 就抽正文（可选依赖，没有时降级为只登记）；扫描件抽不出文字的
  保持 `registered`，不拿空白正文冒充解析成功。少于 40 字符视为无文本层。
- **导入认两种目录**：有 `kb.json` + `source/` 的标准旧库用它；没有 `kb.json` 的普通目录用目录名当库名、
  库目录本身当源，并跳过 `parsed/ datadb/ vectordb/ target/ temp/`。任何层级里以 `.` 开头的路径
  （如 `source/.snapshots`）一律跳过。
- **全文检索用 FTS5 `trigram`**：中文按子串命中；查询词少于 3 字符回退 `LIKE`。
  `unicode61` 会把整段中文当成一个 token，实测「光合效率」搜不到「农业光合效率」。
- **引用只认真实位置**：只有逐字匹配才返回字符区间；匹配不到就如实说明，不给虚构位置。
- **运行输入冻结**：`runs` 保存 `scope / resolved / as_of`；运行期间新增资料不自动进入本次运行。
- **状态机**：`queued → running → done | failed | cancelled`，取消先进入 `cancelling`；
  进程异常退出后，未完成的运行在启动时标 `interrupted`，不静默重跑。
- **成果显式保存**：每次保存新增一条 `artifact_revisions`，不覆盖历史。

## 测试

```bash
python tests/test_app_http.py     # 端到端：建库分组 → 导入 → 检索 → 任务 → 成果 → 重启保留
```

覆盖的断言包括：同一个库进两个组、导入幂等、组范围与全库检索、逐字字符位置、
二进制不产正文、归档后退出检索但历史引用仍可读、写失败不清空现有数据、重启后数据仍在。

## 迁移旧库

```bash
python heli-src/cli.py --data heli-data import --from /mnt/e/local_db/.knowledge
```

只读源端：保留子目录结构、按内容哈希落地、同一文件重复导入不产生新版本。
旧的 `kbctl` 已从仓库删除；旧库内 `datadb/`、`vectordb/` 不再被读取。
