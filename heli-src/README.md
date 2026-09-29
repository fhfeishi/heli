# heli-src · 后端源码

## kbctl · 知识库本地持久化工具

完整设置原则、当前配置、实现结果及接管门槛统一见 [知识库 README](../.knowledge/README.md)；下文保留代码操作说明。

### 库位置配置

资料库不在项目内，缺省根按 `--root` → 环境变量 `HELI_KNOWLEDGE`/`KNOWLEDGE_ROOT`
→ 项目根 `.env` 的 `KNOWLEDGE_ROOT` 解析，路径按运行环境自动换算（`E:/…` ⇄ `/mnt/e/…`）。
实现见 `kbctl/config.py`（纯标准库）：

```bash
python -m kbctl.config            # 看解析到哪、从哪来的、有几个库
python -m kbctl.config --print-root   # 只打印库根（launch.sh 用它）
```

`--root` 显式传入时永远最高优先级；没传就用配置值。
改了 `.env` 不需要重启以外的操作——配置在进程启动时解析一次。

当前 `langchain_docs` 已建立资料管理数据库及层级目录，原文阅读不依赖向量；实际语义索引尚未建立。`management.py` 提供文档与章节接口：

```bash
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage list --text persistence
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage tree
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage read <source_id>
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage outline <source_id>
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage read-section <source_id> <index> --sha256 <sha256>
python -m kbctl.server --root /mnt/e/local_db/.knowledge --port 8765
```

`v2-manage --help` 可查看整理、导出、改名、章节和归属操作。完整语义和限制统一见知识库 README，验证见 [管理交付](../.logsdev/archive/knowledge_persistence/management-delivery.md)。下面旧库演练步骤适用于尚未整理的其他库。

`server.py` 提供本机 `/api/libraries` 发现；`/api/libraries/<slug>/tree`、`documents`、`documents/<source_id>/outline`、`documents/<source_id>/sections/<index>?sha256=...` 读取；JSON POST `name`、`sections`、`placements` 修改。请求复用 management 的存储锁，服务内顺序执行。前端开发代理接到 8765；不作为公网服务部署。

新协议已在 `schema2.py` / `pipeline2.py` 和 `v2-*` 命令中实现；旧命令仍使用先删后写的 documents/chunks 模型。不要用旧 `pipeline/gc` 接管或清理唯一的真实库副本。旧库先运行只读 `v2-inventory`，在独立副本上演练 `v2-scan` / `v2-update`；`v2-scan` 会写入数据库。

```bash
python -m kbctl --root <.knowledge 路径> --kb <slug> v2-inventory
python -m kbctl --root <副本根目录> --kb <slug> v2-scan
python -m kbctl --root <副本根目录> --kb <slug> v2-update
python -m kbctl --root <副本根目录> --kb <slug> v2-restore-check
```

`v2-update` 支持 `hash` 测试向量和本地 `bge-m3` 的 dense 向量。后者需要在后端环境安装 `sentence-transformers`，并将 `HELI_EMBEDDING_ROOT` 指向模型根目录；例如此机 WSL 使用 `/mnt/e/local_models/embedding`，其中应有 `BAAI--bge-m3/`。模型 ID 仍由 `kb.json` 指定为 `BAAI/bge-m3`，不会联网下载模型；默认使用可用的 CUDA，否则使用 CPU，可用 `HELI_EMBEDDING_DEVICE=cpu` 覆盖。除只读盘点外，新协议数据库操作会拒绝未标记 v2 格式的非空旧数据库。下表为旧流程命令。

```bash
python -m pip install sentence-transformers
export HELI_EMBEDDING_ROOT=/mnt/e/local_models/embedding
python -m kbctl --root <副本根目录> --kb langchain_docs v2-update
```

分块算法版本写入新协议的版本身份；现行版本保证单片不超过配置的 `size`，且 `char_start/char_end` 可从解析正文取回原片。既有版本不会因代码更新被误复用。
WSL 的 `_writer.lock` 是固定锁锚点，进程退出后系统会释放锁；文件留在库目录中属于正常状态。

### 运行

```bash
# 当前已验证部署为 WSL 原生 ext4；其他文件系统需单独验证
python -m kbctl --root <.knowledge 路径> --kb <slug> <命令>
```

| 命令 | 对应流程步 | 说明 |
|---|---|---|
| `init` | 2 | 建 `kb.json` + 空骨架；已存在则报错 |
| `scan` | 3a + 3b | 生成 `manifest.jsonl` / `nav.json` / `links.jsonl`，回写结构列 |
| `parse` | 4 | 写 `parsed/<2位>/<doc_id>/` |
| `chunk` | 5 | 先删后插重建 `chunks` 表 |
| `embed` | 6 | 先清旧向量再 add；换模型换 collection |
| `gc` | 7 | 淘汰 `superseded_by` 的旧版本 |
| `pipeline` | 3a→7 + verify | 一次跑完并对账 |
| `verify` | 8 | 双向对账（孤儿 / 缺向量 / 旧模型 / 陈旧 collection / 抽样反查） |
| `doctor` | 9 | 写 `_status.json` + 同步 `_registry.json` |
| `registry` | — | 重建注册表（磁盘为权威） |

常用开关：`--engine memory|chroma`（覆盖 `kb.json.vector_store.engine`）、
`--only <doc_id...>`、`--site <前缀>`、`--keep-old`、`--include-gone`、`--no-db`。

### 测试

```bash
python tests/test_phase1_acceptance.py      # Phase 1 三条验收用例（默认 memory 引擎）
HELI_KB_ENGINE=chroma python tests/test_phase1_acceptance.py   # 装了 chromadb 时复验真实引擎
HELI_KB_ENGINE=chroma python tests/test_v2_acceptance.py       # 新协议 A–C 的后端段
python tests/check_real_kb.py               # 新 manifest vs 旧 sitemap 的逐字段对账（只读）
```

三条验收用例各自配了反向对照：去掉清理逻辑后必须失败或报错，否则断言等于没写。

### 引擎

- `chroma`：生产引擎，懒加载 `chromadb`（WSL 内 `pip install chromadb`）。
- `memory`：落盘的参考实现，语义与 chroma 的 `delete(ids=)` / `delete(where=)` 对齐，
  用于没有 chromadb 的环境跑通管道与验收用例。落盘而非放内存，是为了让
  「换模型后旧 collection 是否真被作废」可被观测。

本地 BGE-M3 dense provider 已接入；`kb.json.embedding.provider` 填 `hash` 时仅用确定性伪向量验证管道，不代表真实检索质量。

### 全文检索与提取方案（2026-09-29）

本轮检索使用 SQLite FTS5 trigram + BM25，无需 embedding。少于 3 字符使用子串匹配，并返回 `ranked_by=substring`。实际库已建全文索引；语义索引仍未发布。

在 `heli-src/` 执行 `python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage search-index` 重建。重建在库锁与单次事务内完成，缺快照或失败回滚，保留原索引。索引格式 2 保存原文 SHA；旧格式需重建。`GET /api/libraries/<slug>/search` 支持 `q/section/limit/offset`，命中返回 SHA 与字符位置；分页与范围过滤覆盖全部候选。

`GET /api/libraries/<slug>/extraction-plans` 读取方案，POST 同一路径保存。请求为 `{schema, id?, base_version?}`；已有方案必须携带读取时的版本，冲突拒绝写入。schema 字段见 `kbctl/extraction.py:validate_schema`，包含名称、记录粒度、完整提取指令及字段定义。`target/<id>/target-schema.json` 保存当前方案与不可变历史，单文件原子替换。方案属于用户编写内容，需要随库备份；尚无自动提取运行与结果接口。

前端信息提取页可真实新建、切换、保存方案，支持表单及 JSON 高级编辑。真实库已保存「技术应用分析」六字段方案，可作为样例；没有生成任何提取结果。

验证：`python tests/test_extraction_http.py` 检查真实 HTTP 保存、重启恢复、历史与冲突拒绝；`python tests/test_search_acceptance.py` 检查 502 篇分页、章节范围、字符与版本定位、失败重建回滚。两条路径分别覆盖方案写入与索引发布，不使用模型替身。

### 已有专题资料接入与接口（2026-09-29）

已有目录可以保留中文名称。在 `heli-src` 执行：

```bash
python -m kbctl --root /mnt/e/local_db/.knowledge --kb '自然科学基金-AI与材料' v2-manage adopt
python -m kbctl --root /mnt/e/local_db/.knowledge --kb '自然科学基金-AI与材料' v2-manage search-index
```

`adopt` 只为缺少 `kb.json` 的既有 `source/` 目录补充库身份并整理，不移动或覆盖现有原文、解析和 target 文件。已有库更新后可在「处理记录 → 同步资料与全文索引」操作。同步是一次真实请求，完成或失败以后端返回为准；尚无可恢复的后台同步任务历史。

PDF 的阅读正文登记自 `parsed/<source 中相对文件名，含 .pdf>/markdown.md`；原始 PDF 哈希和阅读正文哈希分开，正文冻结到 `parsed/.snapshots/<text_sha>/document.md`。`readable_documents` 记录关联。无解析的 PDF 保留在目录但不进入 BM25；原 PDF 改变而解析未改变时拒绝复用旧解析。首次登记按相对文件名关联，不能据此宣称解析质量已人工审核。

接口（共同前缀 `/api/libraries/<slug>`）：

| 方法与路径 | 返回或行为 |
|---|---|
| GET `content-status` | 原文/PDF/已登记解析/导入结果/未关联结果数量及忽略文件说明 |
| POST `refresh`，JSON `{}` | 库锁内重新整理、构建全文索引，返回 organization/index/content；结果文件只读 |
| GET `extraction-results?q=&offset=&limit=` | 读取 `target/*.json` 的 facets 结果，全文字段筛选、总数与分页；同时返回来源关联 |
| GET `extraction-results/<id>` | 保留外部 doc_id/version/source_hash/facets/relations，返回按 source_hash 关联的来源；不将外部标识当内部 source_id |
| GET `extraction-results/<id>/evidence?source_id=&facet=&item=&evidence=` | 三个索引从 0 开始。核对证据版本、来源哈希、正文唯一逐字匹配；成功返回正文 SHA/字符区间/章节，失败不给虚构字符位置 |
| GET `documents/<source_id>/original` | 原始 PDF 或文本，路径由来源数据库解析且限制在 source 内 |
| GET `documents/<source_id>/outline` | 额外返回 content_kind（source/parsed）与 source_sha256；sha256 始终指向当前阅读正文 |

`target/<id>/target-schema.json` 是可编辑方案；`target/<外部文档id>.json` 是导入结果。两类文件职责不同，保存方案不会改写结果。导入页码和 chunk_id 保留原值；只有摘录唯一逐字匹配才生成正文高亮位置，不能据此宣称页码、外部分片身份或事实结论已被审核。用户结果目前只读，不提供人工修订或自动重跑。

前端「信息提取 → 已有提取结果」支持筛选、分页、维度/条目/关系展示、证据核对与原文跳转；`?result=` 恢复选中结果。接口验收并入 `tests/test_extraction_http.py` 的实际 HTTP/文件路径；502 篇索引验收保留在 `test_search_acceptance.py`。
