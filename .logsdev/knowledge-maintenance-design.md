# 资料库（.knowledge）维护设计

> 状态：**已定稿**（2026-09-29）。只写维护方式与格式约定，不含实现代码。
> 背景：库已从项目内迁到 `E:\local_db\.knowledge`（WSL 内 `/mnt/e/local_db/.knowledge`），固定一处维护。

## 1. 迁移后的现状核对（事实，不是设计）

| 项 | 现状 | 处理 |
|---|---|---|
| 库位置 | E 侧 12 个库（langchain_docs + 11 个自然科学基金） | 已迁；日常后端跑 WSL 走 `/mnt/e/...`，Windows 侧只读巡检走 `E:\...` |
| 项目内 `.knowledge/` | 只剩 `README.md`（派生文档） | 数据全在 E 侧；`_registry.json` **不维护**（§11） |
| E 侧 `README.md` | 仍是 dox-agent 的语料根文档（CORPORA_ROOT 术语） | 待替换为完整版架构设计（§3） |
| 项目内 `README.md` | 用户正在改写为派生版（已写入库位置与 config 指向） | 等定稿后做同步脚本（§3） |
| `target/` 层 | 结果按 `<doc_id>.json` 平铺；**方案不在库内**，归档在资料库根 | 定稿，**不重组**（§4） |
| 转化结果 | 1123 份（11 个 fund 库），`check-stale.py` 实测 **0 过期** | 见 §5 |
| `datadb/jobs` | 表存在，**0 行** | 只管当前态，不承载历史（§6） |
| `datadb/versions` | 0 行（自科库） | 原文未冻结 |
| `sources` | 13 行（农业库），有 `online` / `last_seen_sha256` | 来源状态已有载体 |

## 2. 维护对象分三层

1. **资料库根**：位置、库清单、跨库共享件（方案归档、数据脚本、备份）。不写死库名与数量。
2. **单个库**：五层 `source/ parsed/ target/ datadb/ vectordb/` + `kb.json` + `_writer.lock`。一个库 = 自包含单元，可整体拷贝/迁移/删除。
3. **单篇来源**：从「进来」到「可检索」到「被提取」的状态。

## 3. 文档体系（两份，一份权威）

- **权威版**：`E:\local_db\.knowledge\README.md` —— 完整的知识库文件系统架构设计，随库走，持续更新。只写不随具体库变化的规则，盘点数字用命令现取。
- **派生版**：项目内 `.knowledge/README.md` —— 从权威版同步 + 本项目特有的一节（库位置怎么配、启动方式、`.env`/`config.py`、本项目库清单）。
- **同步**：同步脚本按标记块保留项目特有段落（`<!-- project-only --> … <!-- /project-only -->`），避免两边内容分叉；改权威版后跑一次同步。
- 两侧文件头都标注「权威位置」与上次同步时间，防止误把派生版当源头改。

> **「两边留存」= 这两份 README**：资料库根（E 侧）+ 具体项目（如 heli）的 `.knowledge/README.md`。
> 不是库内台账 + 库根台账——那套设计已被否决（§6）。

## 4. source → target 的转化形态（定稿：保持平铺，不重组）

```text
<资料库根>/.datascripts/target-schema/<plan_id>.json   方案原件，跨库共享
<kb>/target/<结果 id>.json                             每篇一份结果，平铺（外部文档 id）
<kb>/kb.json  →  target_task                           这个库做什么转化（人话描述）
```

- **不建** `target/<plan_id>/results/`、**不建** `_index.json`、**不建** `_ledger.jsonl`（原设计太重，已否决）。
- 方案只有一份（`25fe961395c9442e84d8b70482463231`，「技术应用分析」，6 字段），11 个 fund 库共用，
  归档在资料库根 `.datascripts/target-schema/`；**不复制进各个库**，避免 11 份副本各自漂移。
- 结果文件沿用现状字段：`doc_id / version / source_hash / schema_version / prompt_version /
  model / generated_at / process{status, coverage} / facets / relations`。不新增 `plan_id` 字段——
  全库共用一套方案，`kb.json.target_task` 已说明用的是哪一版，够用。
- `langchain_docs`（doc 类）**没有 target 目录**：源码文档不做结构化提取。它的 `target/` 已删除，
  原先误挂在那里的一份方案已归档到资料库根。

**代码侧对应**（`heli-src/kbctl/extraction.py`）：

- 模块文档串里写明本模块承担的任务（与 `kb.json.target_task` 一字不差）、落盘约定、
  stale 判据、`_registry.json` 已弃用。改任务先改这两处。
- `list_plans()` / `_path()` 会合并读两处：库内 `<kb>/target/<plan_id>/target-schema.json`
  与资料库根归档 `.datascripts/target-schema/<plan_id>.json`（同一方案只出现一次）。
  实测改完后 11 个 fund 库从「0 个方案」恢复为「1 个方案」。
- **新建方案仍写在库内**（`<kb>/target/<plan_id>/`），保证「一个库 = 自包含单元」；
  只有**已存在**于资料库根的共享方案才原地改（改一处，11 个库一起生效，`history` 留旧版本）。
- `tests/test_extraction_http.py` 跑通（http_persistence / restart / backup_restore /
  imported_result_evidence / history 全 PASS）。

## 5. 状态模型（数据状态）

| 层 | 取值 | 载体 |
|---|---|---|
| 来源 | `observed → parsed → frozen → indexed`，消失为 `gone` | `sources`（`online` / `last_seen_sha256` / `active_version_id`） |
| 单篇转化 | `done / failed / stale` | 结果文件 `process.status` + `source_hash` |
| 库级转化 | 结果数 / 可用数 / 过期数 | 现算，见下 |

**stale 判据**：结果的 `source_hash` 不在当前 `sources.last_seen_sha256` 集合里 = 原文变过，
结果过期需重跑。这是痕迹的核心价值，所以单独固化成巡检脚本。

- 逐条：`extraction.result_detail()` 已返回每个来源的 `stale`（比对源文件现算 sha256）。
- 批量：`.datascripts/check-stale.py`（只读，不改任何数据）
  ```bash
  python3 check-stale.py                 # 全库
  python3 check-stale.py <库名> --detail # 列出过期文件名
  python3 check-stale.py --json
  KNOWLEDGE_ROOT=/mnt/e/local_db/.knowledge python3 check-stale.py
  ```
  实测（2026-09-29）：1123 份结果，**0 过期、0 未判**。

**踩过的坑（写在这儿防止重犯）**：SQLite 的 `WHERE last_seen_sha256` 是**数值真值判断**，
十六进制串以字母开头（如 `c01ffe83…`）会被转成 0 → 判为假，整行被静默丢掉。
第一版脚本因此把 415 份正常结果误报成过期。必须用
`WHERE last_seen_sha256 IS NOT NULL AND last_seen_sha256 <> ''`。

另：结果的 `doc_id`（20 位十六进制）与 `sources.source_id`（`src_` 前缀）**不是一套标识**，
唯一可靠的对应关系是 `source_hash`。别拿 `doc_id` 去 join `sources`。

`target/` 里的隐藏文件（如读写探针 `.probe_write.json`）不计入结果，也不判过期。

## 6. 处理活动（activity）：不建台账文件

原方案（`<kb>/_ledger.jsonl` + `<根>/_ledger/YYYY-MM.jsonl` 双份活动流水）**已否决**——
痕迹已经落在现有载体里，再加一层只有维护成本：

| 想回答的问题 | 现有载体 |
|---|---|
| 这个库要做什么转化 | `kb.json.target_task` |
| 用的哪版方案、什么字段 | 资料库根 `.datascripts/target-schema/<plan_id>.json`（含 `version` 与 `history`） |
| 这篇跑了没、跑成什么样 | `target/<doc_id>.json` 的 `process` / `generated_at` / `model` |
| 结果还作不作数 | `source_hash` ↔ `sources.last_seen_sha256`（§5） |
| 代码里哪一段负责 | `kbctl/extraction.py` 模块文档串 |

**活动由谁写**：只在 kbctl 内写（CLI / HTTP 同一处）。导入脚本不写台账——没有台账文件可写。
`jobs` 表继续只管库内构建/发布任务的**当前态**，与上面这些历史痕迹不重叠。

## 7. 已知事项：`_writer.lock`（记录结论，不主动验证）

库现在位于 drvfs（WSL 内 `/mnt/e`），写操作依赖 `_writer.lock`。历史上有 Windows 侧访问 9P
无法 `O_RDWR` 加锁的先例，但**本次不专门验证**（成本高于收益，用到再说）。

约定：

- 日常按「后端跑 WSL、访问 `/mnt/e/local_db/.knowledge`」使用。
- 若某天出现 `_writer.lock` 的 `PermissionError` / 加锁失败，两条出路：
  1. 改用 **Windows 原生 Python** 跑后端（`pipeline2.py` 已有 `msvcrt.locking` 分支，E: 是本地 NTFS）；
  2. 或把库放回 WSL 原生 ext4。
- 排查时再跑（WSL 内）：

```bash
python3 - <<'EOF'
import os, fcntl
fd = os.open("/mnt/e/local_db/.knowledge/_locktest", os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); print("flock OK")
except OSError as e:
    print("flock FAIL:", e)
finally:
    os.close(fd)
EOF
```

## 8. 已确认（原「待确认」全部收口）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 「两边留存」指哪两边 | **资料库根（E 侧）README + 具体项目（heli）的 `.knowledge/README.md`**，见 §3 |
| 2 | target 是否重组目录 | **不重组**，保持 `target/<doc_id>.json` 平铺，见 §4 |
| 3 | `_registry.json` | **不维护**，见 §11 |
| 4 | 活动由谁写 | 只在 kbctl 内写；不建台账文件，见 §6 |
| 5 | 是否加 stale 状态 | **加**，判据与巡检脚本见 §5 |
| 6 | 转化代码怎么留痕 | 在 `kbctl/extraction.py` 模块文档串写明任务，与 `kb.json.target_task` 对齐，见 §4 |

## 9. 与既有规范的关系

- 不改五层结构与唯一权威（source 唯一不可重建；parsed/vectordb 可重建；datadb 不可重建）。
- 不改 `doc_id` / `chunk_id` / `version_id` 的生成规则。
- 本设计只新增「转化产物组织方式」与「状态留痕」，不替换既有设置结论。

## 10. kb.json 字段规格（按 knowledge_type 分类，2026-09-29 定稿并已落到 12 个库）

**结论：其余字段按类别分别设置，不适用的字段直接不写。** 用「字段缺失」表达不适用，
不写空字符串或空对象——空值分不清是「还没配」还是「这类库用不上」。
后端安全性已验证：`core.py` 的 `DEFAULT_KB_JSON` 会在加载时给缺失键补默认值，
所以文件里删掉 `scan` / `structure` 等不会 KeyError（实测 `Kb()` 加载后字段齐全）。

### 10.1 字段矩阵

| 字段 | doc 类 | fund 类 | 说明 |
|---|---|---|---|
| `id` / `name` | 必填 | 必填 | 稳定标识与显示名 |
| `description` | 必填 | 必填 | 一句话说明库的资料来源与覆盖范围 |
| `tags` | 必填 | 必填 | 检索与人工辨识用 |
| `schema_version` | 必填 | 必填 | |
| `knowledge_type` | 必填 | 必填 | 两类取值见下 |
| `embedding` | 有（bge-m3） | 空配置 | 后端要索引读取，不能整个删；未配置就留空对象 |
| `chunking` | 有 | 有（选做，可不执行） | 同上 |
| `vector_store` | 有 | 有（选做，可不执行） | 同上 |
| `site` | 有（镜像站点） | **不写** | PDF 报告没有来源站点 |
| `scan` | 有（导航件识别） | **不写** | 基金报告没有 `llms.txt` 之类导航件 |
| `structure` | 有（authority/sections） | **不写** | 走默认（assumption=tree）即可 |
| `target_task` | **不写** | 必填 | 见 10.2；源码文档库不做结构化提取 |
| `*_description` | 6 项 | 3 项 | 对内部关键词的简短说明，见 10.3 |

两类取值：

- `"knowledge_type": "source code and documentation"` —— 1 个库（langchain_docs）
- `"knowledge_type": "科学研究与应用类技术验收报告，自然科学基金"` —— 11 个库

### 10.2 `target_task`（仅 fund 类，字符串不是对象）

```json
"target_task": "按任务方案从原文提取技术应用要素（应用场景 / 问题 / 技术方法 / 成果指标 / 作者 / 时间），每篇一份结果写入 target/<结果 id>.json（外部文档 id，与内部 16 位 doc_id 不是一回事），保留原文证据 quote 与字符定位 locator；方案原件归档在资料库根 .datascripts/target-schema/25fe961395c9442e84d8b70482463231.json，读写实现见后端 kbctl/extraction.py。"
```

- 一个字段说清「做什么、产物放哪、方案在哪、代码在哪」。不内联方案全文（11 个库共用一份，
  内联就会 11 份副本各自漂移），也不建 `target` 对象/数组——**这个设计已否决为过重**。
- 后续若某个库要跑第二套方案，加 `target_task2` / `target_task3`，并在字段里写明适用条件；
  编号与 `knowledge_type` 一起读才有意义。
- 当前只有 fund 类有转化任务，所以只有 `target_task1` 的内容，字段名就用 `target_task`。

### 10.3 `*_description`：内部关键词说明

每个字段配一句人话说明，建库时就写，不要留占位：

| 类别 | 需要写的描述 |
|---|---|
| 两类共有 | `embedding_description`、`chunking_description`、`vector_store_description` |
| doc 类 | 另加 `structure_description`、`scan_description`、`nav_only_description` |
| fund 类 | 无额外（转化任务的说明就是 `target_task` 本身，不再单列 `target_description`） |

### 10.4 已执行

- 备份 12 份原 `kb.json` → `.datascripts/_backup/kbjson-20260929-224247/`
- 11 个 fund 库：补 `description`/`tags`、加 `target_task`、删 `site`/`scan`/`structure`
- langchain_docs：保留 `site`/`scan`/`structure`，不写 `target_task`；占位文案换成真实说明；`target/` 已删
- 方案原件归档 → `.datascripts/target-schema/25fe961395c9442e84d8b70482463231.json`
- 数据脚本与巡检脚本进 `.datascripts/`（含 `README.md` 路径约定）
- `kbctl/extraction.py`：模块文档串写明任务 + `list_plans()` 支持读资料库根归档

## 11. `_registry.json`：不维护（2026-09-29 结论）

- **它是缓存，不是权威**：`verify.sync_registry` 注明「磁盘为权威」（§4.5），`kbctl registry` / `doctor` 可随时重建。
- **位置在库根**：`core.registry_path()` 返回 `<库根>/_registry.json`；库迁到 E 侧后，
  它的正确位置是 `E:\local_db\.knowledge\_registry.json`，项目内那份已经和库分家，没有意义。
- **结论**：不手工维护、不进备份清单。需要时重建：

```bash
python -m kbctl --root /mnt/e/local_db/.knowledge registry   # WSL 内
```

- 发现库一律以目录中的 `kb.json` 为准（README §2），任何流程都不要依赖注册表。
- 当前状态：E 侧库根还没有该文件，跑一次上面的命令即生成。

## 12. 备份优先级（沿用）

- **P0**：`source/` + `datadb/` —— 不可重建
- **P1**：`vectordb/` —— 可重建但贵
- **P2**：`parsed/` —— 可重建
- **另加**：资料库根 `.datascripts/`（方案原件、数据脚本、巡检脚本、kb.json 备份）—— 丢了 `target_task` 指向的方案就没了
