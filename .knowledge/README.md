# 资料库 `.knowledge` — 文件系统架构设计（权威版）

> **这份是权威版。** 具体项目（如 heli）下的 `.knowledge/README.md` 是**派生版**：
> 从本文同步，另加一节「本项目怎么接进来」（库位置怎么配、怎么接入数据、本项目库清单）。
> 改规则改本文；改完跑同步脚本把派生版刷新一次。两边文件头都标了权威位置与同步时间。

<!-- project-only -->
> **本文是派生版。权威版 = `E:\local_db\.knowledge\README.md`**（完整的库文件系统架构设计）。
> 本文 = 权威版的内容 + 本项目特有的部分（包在 `<!-- project-only -->` 标记块里，同步时保留）。
> 上次同步：2026-09-30。改规则请先改权威版；只改本项目的接法就改标记块里的段落。
>
> 库位置不写死在文档里，由项目根 `.env` 配置（见 §0.1）：`python -m kbctl.config` 可看当前解析结果。




# 知识库：设置、组织与使用


更新：2026-09-29。**本文是唯一的知识库设置结论。** 历史论证与验证报告见 [.logsdev/archive](../.logsdev/archive/README.md)。精确接口以 [kbctl](../heli-src/kbctl/__main__.py) 和 [schema](../heli-src/kbctl/schema2.py) 为准。

## 0. 本项目怎么接进来

前面各节是与项目无关的库规则（同步自权威版）。本节是 heli 特有的两部分：库位置怎么配、数据怎么接进来。

### 0.1 库位置怎么配

资料库不在项目内，固定在本机 `E:\local_db\.knowledge`。代码不写死这个路径，按下面顺序解析：

| 优先级 | 来源 | 例子 |
|---|---|---|
| 1（最高） | 命令行 `--root` | `python -m kbctl --root /mnt/e/local_db/.knowledge --kb <库名> ...` |
| 2 | 环境变量 `HELI_KNOWLEDGE` / `KNOWLEDGE_ROOT` | `KNOWLEDGE_ROOT=/mnt/e/local_db/.knowledge bash launch.sh` |
| 3 | 项目根 `.env` 的 `KNOWLEDGE_ROOT` | `KNOWLEDGE_ROOT=e:/local_db/.knowledge` |
| 4（兜底） | `<项目根>/.knowledge` | 数据已迁走，兜底基本不会命中 |

三处代码：

| 文件 | 作用 |
|---|---|
| `.env`（项目根，**不进版本库**；模板见 `.env.example`） | 写库位置。Windows 写法与 WSL 写法都收 |
| `heli-src/kbctl/config.py` | 读 `.env`、按运行环境换算路径、定优先级；纯标准库，不引依赖 |
| `launch.sh` | 启动时用 `python -m kbctl.config --print-root` 拿库根，再传给后端 |

路径换算（`config.py` 自动做，两种写法等价）：

| `.env` 里写 | WSL 内解析为 | Windows 内解析为 |
|---|---|---|
| `e:/local_db/.knowledge` | `/mnt/e/local_db/.knowledge` | `e:/local_db/.knowledge` |
| `E:\local_db\.knowledge` | `/mnt/e/local_db/.knowledge` | `E:/local_db/.knowledge` |
| `/mnt/e/local_db/.knowledge` | 原样 | `E:/local_db/.knowledge` |

`.env` 里的其他键（如 `HELI_EMBEDDING_ROOT`）会在配置加载时补进进程环境，**真实环境变量优先于 `.env`**。

自检与排错：

```bash
cd heli-src
python -m kbctl.config            # 看解析到哪、从哪来的、有几个库
python -m kbctl.config --print-root   # 只打印库根（脚本用）
python -m kbctl.config --json
```

### 0.2 怎么接入数据

**后端一律在 WSL 内跑**（Windows 侧对 9P 上的 `_writer.lock` 加不上锁）。下面 `<库根>` 用
`/mnt/e/local_db/.knowledge`，`<库名>` 用目录名（中文名要加引号）。

#### 新接入一个已有的资料目录（最常见）

1. **放文件**：在 `<库根>/<库名>/source/` 下放 `.pdf / .md / .markdown / .txt / .docx`，可自由分子目录。
   PDF 要能阅读的话，同时准备解析正文 `parsed/<source 里的相对路径，含 .pdf>/markdown.md`
   （MinerU 产物；没有则 PDF 留在目录但不进全文检索）。
2. **登记库身份**：`adopt` 只给缺 `kb.json` 的目录补身份并整理，**不移动、不覆盖**已有原文/解析/结果。

   ```bash
   python -m kbctl --root /mnt/e/local_db/.knowledge --kb '<库名>' v2-manage adopt
   ```

   > 用 `init` 建新库时，目录名必须匹配 `^[a-z0-9][a-z0-9-]{1,31}$`（不含中文）；
   > 中文目录只能走 `adopt`。
3. **建全文索引**（PDF 与 Markdown 都进 BM25，不依赖 embedding）：

   ```bash
   python -m kbctl --root /mnt/e/local_db/.knowledge --kb '<库名>' v2-manage search-index
   ```

4. **补 `kb.json` 的分类信息**：按 §5 的矩阵写 `knowledge_type`、`description`、`tags`；
   基金类再写 `target_task`（照抄现有 11 个库的写法即可）。不适用的字段整个不写。
5. **验收**：

   ```bash
   curl -s 'http://127.0.0.1:8011/api/libraries/<库名>/content-status'   # 原文/解析/结果计数
   python3 <库根>/.datascripts/check-stale.py '<库名>'                   # 结果是否过期
   ```

   界面上也可以：库页 →「处理记录」→「同步资料与全文索引」（= `refresh`，库锁内重新整理并重建索引）。

#### 往已有库加文件

把文件放进 `source/`（PDF 配好 `parsed/`），然后 `organize` 登记新来源、再 `search-index`。
界面路径同上。部分扫描**不会**下线消失的文件——只有成功的完整扫描才下线。

#### 接入已有的提取结果

结果直接放到 `<库名>/target/<结果 id>.json`，**平铺不分子目录**，靠里面的 `source_hash`
与来源关联（不是靠文件名）。要求字段见权威版 §6.2。放好后用 `check-stale.py` 核一遍是否都对得上来源。

#### 新方案（task schema）

新建方案写在库内 `<库名>/target/<plan_id>/target-schema.json`；当前 11 个基金库共用资料库根
` .datascripts/target-schema/25fe961395c9442e84d8b70482463231.json` 这一份，改一处全部生效。

#### 接入后别忘了

- 备份优先级里 `.datascripts/` 算 P0（方案原件在里面）。
- 结果文件只读：本库不自动跑提取，也不提供人工修订。
<!-- /project-only -->

<!-- project-only -->
> 下面这一组是 heli 项目特有的**操作命令、验收结论与后续建设**，随项目走，同步时保留。
> 小节用「附-N」编号，与权威版的 §1–§12 / 附录 A–C 区分开；
> 规则本身以权威版为准，这里保留的是本项目的实测结论与待办。

## 附-1 已可用的操作入口（本项目命令速查）

从 `heli-src/` 在 WSL 环境运行，明确指定数据根。默认根相对当前工作目录，不能省略后误操作另一个库。以下 ID 用 tree/list 返回的实际值替换。

```bash
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage tree
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage list --text persistence
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage list --section <章节ID> --limit 50
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage read <来源ID> --limit 12000
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage outline <来源ID>
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage read-section <来源ID> <章节序号> --sha256 <outline返回值>
# 续读固定同一份原文
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage read <来源ID> --offset 12000 --sha256 <上次返回值>
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage links <来源ID>

python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage name "LangChain 开发资料"
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage section "状态持久化" --parent <父章节ID>
# 省略 parent 保留原父章节；--parent root 移到顶层
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage section "新标题" --id <章节ID>
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage place <来源ID> --section <章节ID>
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage place <来源ID> --section <旧章节ID> --remove
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage organize
python -m kbctl --root /mnt/e/local_db/.knowledge --kb langchain_docs v2-manage export
```

organize 是写操作；tree/list/read/outline/read-section/links 不要求模型或向量。read 返回字符窗口；outline/read-section 按 ATX 标题读取完整章节及子章节，忽略代码围栏中的伪标题，不以字符上限截断代码。Setext 标题与 MDX 组件语义尚未解析；页面保留原始文本并单独显示代码块。所有读取核对冻结原文摘要，传旧摘要时拒绝混读。API 位于 [management.py](../heli-src/kbctl/management.py)。

一键启动：项目根 `bash launch.sh`（默认 8011，**单端口**同时提供页面与 `/api`，库根按 §0.1 解析）。也可以分开跑：从 heli-src 启动 `python -m kbctl.server --root /mnt/e/local_db/.knowledge --web ../heli-web/dist`，再从 heli-web 启动 `npm run dev`（5173 代理 `/api` 到 8765）。API 仅监听本机 8765，Vite 代理 `/api`；本机服务内的请求顺序执行，底层继续使用同一把库锁。外部 CLI 占锁时仍会明确报忙。

语义更新、查询、引用及恢复仍使用 v2-update/query/cite/recover/gc/backup/restore-check；配置模型环境后运行 v2-update 才实际建立语义索引。旧 scan/parse/chunk/embed/pipeline/gc 不可用于该库，它们仍是旧协议，尚未统一移除。v2-inventory 只读盘点；v2-scan 写入来源状态。

## 附-2 langchain_docs 当前结果与证据（实测结论）

2026-09-28 已在完整临时副本整理并重复执行，再整理真实库。结果：1,438 个源文件（1,423 正文、15 导航原始件）、96 个章节、1,423 条章节归属。原始文件哈希全部不变；原文冻结到 source/.snapshots；SQLite 完整性与外键检查通过。旧清单、导航导出、状态及旧配置/空数据库保存在 archive/pre-management-20260928，原有 archive/source 和 source_demo 保留。

**真实库目前是可浏览、可阅读的资料库，active 索引文档 0，向量文件 0。** 没有把 hash 测试向量装进真实库，也没有把之前副本的向量结果冒充原库索引。语义产物尚未构建；`vectordb/fts5/fts.db` 已保存本轮全文索引（1423 篇，21,760,659 字符，2026-09-29），不依赖 embedding。结构导出在 [structure.json](langchain_docs/structure.json)，库入口见 [langchain_docs](langchain_docs/README.md)。

本轮真实 Chroma 验收 A、B1–B5、C 后端段 7/7 通过；A 扩展覆盖章节树、多归属、重复整理不覆盖人工组织、固定内容阅读、库改名、错误引用拒绝、空检索范围和另一个进程的持锁拒绝。模型使用测试 hash provider，该检查验证存储协议，不代表语义质量。可复现命令与数据结果见 [管理交付报告](../.logsdev/archive/knowledge_persistence/management-delivery.md)。

此前完整独立副本 BGE-M3 构建 60,267 个真实向量，更新 1,423 来源，复用 28 来源，耗时 1,349.3 秒；恢复核对、重开查询及两处真实 SIGKILL 已有证据，见 [存储交付报告](../.logsdev/archive/knowledge_persistence/v2-protocol-delivery.md)。这些是当时副本的证据，不等于本轮重跑。

## 附-3 交互边界与后续建设

管理界面应提供“目录／文档／索引状态”三个清楚的区域：目录操作只改变组织；文档显示来源、观察到的内容摘要和已索引版本；索引任务明确显示等待、构建、可用或失败。搜索结果打开原文并显示证据位置。长期失败、锁忙、路径冲突与版本变化都应给用户可采取的下一步，不能静默回退到别的库或旧证据。

章节树提供浏览范围；语义查询当前仍接收 source_ids 或原站点 sections，不把新的 section_id 当旧 section 字符串。前端需要枚举所选章节的全部文档并传 source_ids，不能只传第一页；专门的章节检索入口尚待接入。

后续按实际问题推进：

1. 已接通资料管理和章节阅读，已在独立库验证页面修改后重启保持；后续补齐全库过滤规模、查询/发布交错和检索质量，再部署完整语义索引。现有 scan 导航事务与 active 切换分开，应保持“当前目录”和“已索引内容”的状态可辨。
2. 补检索证据窗口；关键词/语义混合检索、内容去重在固定案例中与 dense 对照。中文短词和代码标识符不能假设默认 FTS5 已覆盖。
3. 按真实研究任务创建少量专题 notes，保存问题、适用范围、判断、原文引用、差异和缺口。笔记正文及修订是权威，依赖来源变化标待复核；不能自动覆盖人工编辑，不能让笔记互相引用形成循环佐证。尚未建立 notes、笔记历史或自动 Wiki。

保留本地单机范围，暂不增加图数据库、多用户、跨设备同步、PDF/OCR、多模态框架、通用任务 DAG、全库历史发布体系或自动历史 GC。永久删除和保留期限需另定；本轮未删除源资料。

验证分两类：存储 A 覆盖版本/引用/改名，B 覆盖失败恢复/清理/并发，C 覆盖备份恢复及前端重启；知识使用用查事实、指定阅读、跨文档比较、全面列举、更新失效、缺证据/冲突案例检查证据是否支持结论。前端 C 已验证库改名、章节新增和文档归属在 API 重启及页面刷新后保持，详见[管理交付报告](../.logsdev/archive/knowledge_persistence/management-delivery.md)。6 篇原文、460 个 BGE-M3 向量仅做了定向检索样本；全库回答质量与完整查询/发布交错仍未验证。

## 附-4 本轮全文检索与方案保存

当前使用 FTS5 trigram/BM25，少于三字符使用子串匹配。索引格式 2 保存原文摘要；重建失败回滚，范围过滤与分页不截断候选。真实浏览器已核对 structured output 的 128 篇命中和原文字符高亮；见 INTERACTION 当前记录。

用户编写的提取方案位于 `target/<id>/target-schema.json`，保留历史版本。`v2-backup` 已包含 target，恢复后可继续编辑；该层目前没有自动提取结果。接口与运行方法见 [后端说明](../heli-src/README.md#全文检索与提取方案2026-09-29)。

## 附-5 新增专题资料库接入（历史记录；现行流程见 §0.2）

11 个「自然科学基金-AI与…」库已登记，保留中文目录与原文件。合计 1122 篇原文、91 篇匹配原 PDF 的解析正文、1122 份 facets 提取结果，全部结果按 source_hash 关联到来源；1122 篇阅读正文已进入 BM25。逐库数量见 [接入报告](../.logsdev/imported-library-report.json)。社会治理库的 `.probe_write.json` 是探针内容，未计为提取结果，文件保留。

PDF 使用 `parsed/<原文件相对路径>/markdown.md`，Markdown 原文直接阅读。文件的来源哈希与解析文本哈希分别管理。导入的提取结果仍保留在 `target/*.json` 原位；方案存储在 target 的方案子目录。`v2-backup` 已包含两者。自动生成与人工修订重跑仍未实现；现已可查看已有结果、核对摘录并定位到阅读正文。

后续新增文件可在处理记录页「同步资料与全文索引」；新专题目录先按 [后端接入说明](../heli-src/README.md) 登记。详细接口与证据语义也统一见该说明。
<!-- /project-only -->

**库位置（本机固定一处）**

| 环境 | 库根 |
|---|---|
| Windows | `E:\local_db\.knowledge` |
| WSL | `/mnt/e/local_db/.knowledge` |

库的数量、名称与主题会持续增减。本文只写不随具体库变化的规则，**不列库名、篇数或主题**；盘点用 §7 的命令现取。

## 1. 设计要解决什么

把资料整理成「有目录、能阅读、能定位证据、能持续更新的资料库」。RAG 是查找证据的一种工具，不是全部：指定文档直接打开，列举资料走目录，对比问题分别阅读相关来源。

一个库 = 一个目录 + 一个 SQLite + 可选向量/全文索引。原文保留原始文件结构，逻辑章节单独管理。这样既能保存抓取来源，又能按使用需要组织资料——改目录不必重算向量、复制正文或引入图数据库。

## 2. 目录结构

```text
.knowledge/
├── README.md                       本文：权威版架构设计
├── .datascripts/                   随库走的处理脚本与方案归档（见 §6.3）
│   ├── target-schema/<plan_id>.json   转化方案原件，跨库共享
│   ├── check-stale.py                 巡检：结果是否过期（只读）
│   ├── _backup/<名>-<时间戳>/         批量改配置前的备份
│   └── README.md                      路径约定与脚本约定
└── <库目录>/                       任意数量；目录名 = 库名（可中文）
    ├── kb.json                    身份与配置（唯一入库的库级文件）
    ├── source/                    原始资料，保留原始目录结构
    │   └── .snapshots/<前2位>/<sha256>   不可变原文快照
    ├── parsed/                    解析正文与中间产物（可重建）
    │   └── <source 相对路径>/markdown.md
    ├── target/<结果 id>.json      按方案从原文提取的结果（仅部分库有，见 §6）
    ├── datadb/kb.db               来源、章节、关系、版本、分块、任务、引用
    ├── vectordb/<engine>/         向量索引；fts5/fts.db 为全文索引
    ├── _scratch/                  可丢弃临时产物
    └── _writer.lock               库操作锁锚点；文件存在 ≠ 被占用
```

- **一个直接子目录 = 一个自包含库**，可整体备份、迁移、删除。
- 层名固定为 `source / parsed / target / datadb / vectordb`。不再用 `raw`、`vector`，也不在库根放 `kb.db`、`index.json`、`structure/`。
- **发现库一律看目录里的 `kb.json`**，不依赖任何注册表（见 §10.2）。

## 3. 各层的权威性与可重建性

| 层 | 内容 | 权威性 | 丢了会怎样 |
|---|---|---|---|
| `source/` | 原始文件 + `.snapshots/` 不可变快照 | **唯一权威，不可重建** | 资料没了，只能重新收集 |
| `datadb/kb.db` | 当前事实：来源、章节、归属、版本、分块、任务、引用 | 权威，不可重建 | 结构与定位全丢，只剩原始文件 |
| `parsed/` | 解析正文（`markdown.md`、`middle_json.json`、`images/`） | 可重建（由 source） | 重跑解析即可 |
| `vectordb/` | 向量与全文索引 | 可重建 | 检索不可用，阅读与目录不受影响 |
| `target/` | 按方案提取的结果 | **不可重建**（外部流程产出，本库不跑模型） | 只能重跑外部流程 |
| `kb.json` | 身份与配置 | 权威，可手改 | 库身份丢失 |

结构存 SQLite，JSON 只用于查看和交换。把物理目录当唯一结构无法表达多归属；单独用 JSON 管结构要再处理外键、版本切换与并发。

## 4. 标识与关联

| 标识 | 形态 | 说明 |
|---|---|---|
| `source_id` | `src_` + hex | 稳定来源标识。不来自路径、也不来自内容摘要 |
| `doc_id` | blake2b(文件字节, digest_size=8) → **16 位 hex** | 内部文档标识 |
| `chunk_id` | `<doc_id>-<4 位序号>` | 序号从 `0000` 连续无空洞 |
| `version_id` | BLAKE2b 摘要覆盖原文哈希 + 解析身份 + 完整分块配置 | embedding 不参与文本版本身份；只改分块参数也产生新版本 |
| `source_hash` | 原文 sha256 | **结果与来源之间唯一可靠的关联键** |
| `target/<结果 id>.json` | 当前基金库为 **20 位 hex** | 导入时的**外部**文档 id，**不是**内部 16 位 `doc_id` |

> 别拿 `doc_id` 去 join `sources`——两者不是一套标识。结果的来源关联只走 `source_hash`。

主要表：`sources`（来源与当前指针）、`readable_documents`（阅读正文登记）、`versions`（不可变处理版本）、`chunks`（文本与定位）、`sections` / `section_documents`（章节树与多归属）、`nav_positions`（原站点导航）、`links`（文档间链接）、`citations`（引用快照）、`jobs`（构建与恢复状态）、`kb_state`（向量集合与模型配置）、`meta`。

结构三分法：**分类** → 章节树（`sections` + `section_documents`，支持空章节、一份文档多个归属）；**顺序** → `nav_positions`；**关系** → `links`。结构字符串不进 embedding。

## 5. `kb.json`：身份与配置

- 管身份与目标配置，**不写统计**。统计归 SQLite，内容归原文文件。
- `schema_version=1`。缺失的键由后端默认值补齐（`DEFAULT_KB_JSON`），所以不适用的字段**整个不写**即可——空值分不清是「还没配」还是「这类库用不上」。

### 5.1 两类 `knowledge_type`

| 取值 | 含义 | 典型库 |
|---|---|---|
| `source code and documentation` | 源码/文档镜像 | `langchain_docs`（有 `site` / `scan` / `structure`） |
| `科学研究与应用类技术验收报告，自然科学基金` | 基金结题报告 | 11 个「自然科学基金-AI与…」（无 `site` / `scan` / `structure`） |

### 5.2 字段矩阵

| 字段 | doc 类 | fund 类 | 说明 |
|---|---|---|---|
| `id` / `name` | 必填 | 必填 | 稳定标识与显示名 |
| `description` | 必填 | 必填 | 一句话说明资料来源与覆盖范围 |
| `tags` | 必填 | 必填 | 检索与人工辨识 |
| `schema_version` | 必填 | 必填 | |
| `knowledge_type` | 必填 | 必填 | 见 5.1 |
| `embedding` | 有 | 空配置 | 后端要读取，不能整个删；未配置就留空对象 |
| `chunking` | 有 | 有（可不执行） | |
| `vector_store` | 有 | 有（可不执行） | |
| `site` | 有 | **不写** | PDF 报告没有来源站点 |
| `scan` | 有 | **不写** | 基金报告没有导航件 |
| `structure` | 有 | **不写** | 走默认（assumption=tree） |
| `target_task` | **不写** | 必填 | 见 §6.1；源码文档库不做结构化提取 |
| `*_description` | 6 项 | 3 项 | 对内部关键词的人话说明，不要留占位 |

## 6. 转化：`source` → `target`

只有 fund 类做转化，doc 类**没有 `target/` 目录**。

### 6.1 `target_task`（kb.json 里的一个字符串字段）

一句话说清「做什么、产物放哪、方案在哪、代码在哪」。当前 11 个基金库的内容：

```text
按任务方案从原文提取技术应用要素（应用场景 / 问题 / 技术方法 / 成果指标 / 作者 / 时间），
每篇一份结果写入 target/<结果 id>.json（外部文档 id，与内部 16 位 doc_id 不是一回事），
保留原文证据 quote 与字符定位 locator；
方案原件归档在资料库根 .datascripts/target-schema/25fe961395c9442e84d8b70482463231.json，
读写实现见后端 kbctl/extraction.py。
```

- 它是**字符串，不是对象/数组**，也不内联方案全文（方案跨库共享，内联就会有 11 份副本各自漂移）。
- 将来某个库要跑第二套方案：加 `target_task2` / `target_task3`，并在字段里写明适用条件。

### 6.2 产物

- `target/<结果 id>.json`，**平铺、不分子目录**。不建 `results/` 子目录，不建 `_ledger.jsonl` / `_index.json`——那套设计过重，已否决。
- 结果字段：`doc_id / version / source_hash / schema_version / prompt_version / model / generated_at / process{status, coverage} / facets / relations`。
- 结果**只读**：本库不提供人工修订或自动重跑。摘录只有唯一逐字匹配才生成正文定位，不能据此宣称页码或事实结论已被审核。

### 6.3 方案（task schema）

- 原件归档在 `.datascripts/target-schema/<plan_id>.json`，**跨库共享，不复制进各库**。当前唯一方案：`25fe961395c9442e84d8b70482463231`（「技术应用分析」，6 字段）。
- 新建方案仍写在库内（`<kb>/target/<plan_id>/target-schema.json`），保证库自包含；已存在于资料库根的共享方案原地改（改一处，全部库生效，`history` 留旧版本）。
- 保存是乐观并发：必须携带读取时的 `base_version`，冲突拒绝写入。

### 6.4 状态 `stale`（痕迹的核心）

**判据**：结果的 `source_hash` 不在当前 `sources.last_seen_sha256` 集合里 = 原文变过，结果过期，需重跑。

```bash
python3 .datascripts/check-stale.py                  # 全库
python3 .datascripts/check-stale.py <库名> --detail  # 列出过期文件名
python3 .datascripts/check-stale.py --json
KNOWLEDGE_ROOT=/mnt/e/local_db/.knowledge python3 .datascripts/check-stale.py
```

脚本只读，不改任何数据。没有 `source_hash` 的文件计入「未判」，不归入过期；隐藏文件（如探针残留）不计入结果。

## 7. 状态与巡检

| 层 | 状态 | 载体 |
|---|---|---|
| 来源 | 在线 / 下线（`online`）+ 当前内容摘要（`last_seen_sha256`） | `sources` |
| 阅读正文 | 已登记 / 未登记（PDF 无解析则不进全文检索） | `readable_documents` |
| 转化结果 | 可用 / **stale** / 未关联 | `target/*.json` 的 `source_hash` |
| 库任务 | `building / committed / done / failed` | `jobs` |

巡检（在库根下执行，只读）：

```bash
# 各库规模
for d in */; do printf '%s source=%s target=%s\n' "${d%/}" \
  "$(find "$d/source" -type f 2>/dev/null | wc -l)" \
  "$(find "$d/target" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)"; done

# kb.json 是否都能解析
python3 -c "import json,pathlib;[json.load(open(p,encoding='utf-8')) and print(p.parent.name,'ok') for p in pathlib.Path('.').glob('*/kb.json')]"

# 转化结果是否过期
python3 .datascripts/check-stale.py

# 容量
du -sh */
```

读这几个数：`target` 为 0 对 doc 类是正常的（不做提取）；`source` 有 PDF 但阅读正文数为 0，说明没有 `parsed/<相对路径>/markdown.md`，PDF 不进全文检索。

## 8. 操作入口

后端（kbctl）在 WSL 内运行，命令在后端目录下执行，`--root` 给库根：

```bash
python -m kbctl --root /mnt/e/local_db/.knowledge --kb <库名> v2-manage organize     # 整理：登记来源、建章节
python -m kbctl --root /mnt/e/local_db/.knowledge --kb <库名> v2-manage adopt        # 已有 source/ 目录补身份
python -m kbctl --root /mnt/e/local_db/.knowledge --kb <库名> v2-manage search-index # 建全文索引
python -m kbctl --root /mnt/e/local_db/.knowledge --kb <库名> v2-manage tree|list|read|outline
python -m kbctl --root /mnt/e/local_db/.knowledge --kb <库名> v2-inventory           # 只读盘点
python -m kbctl --root /mnt/e/local_db/.knowledge registry                           # 重建注册表（需要时）
python -m kbctl.server --root /mnt/e/local_db/.knowledge --port 8765                 # 本机 API
```

HTTP（共同前缀 `/api/libraries/<slug>`）：`tree`、`documents`、`documents/<source_id>/outline|original`、`search`、`content-status`、`refresh`、`extraction-plans`、`extraction-results`、`extraction-results/<id>/evidence`。只监听本机。

`organize` 是写操作；`tree/list/read/outline` 不要求模型或向量。语义索引（dense）需要本地模型目录，当前**未启用**；全文检索走 SQLite FTS5（trigram + BM25），不依赖 embedding。

## 9. 备份、迁移与清理

| 优先级 | 内容 | 理由 |
|---|---|---|
| **P0** | `source/`、`datadb/`、`kb.json`、`.datascripts/` | 不可重建；方案原件丢了 `target_task` 的指向就断了 |
| P1 | `vectordb/` | 可重建但贵 |
| P2 | `parsed/` | 可重建 |

- 备份前停写（锁忙时明确报忙，不静默跳过）；SQLite 用 backup API，不要在运行中直接拷 `.db` 文件。
- 迁移 = 整目录拷贝。库改名只改显示名或目录名，稳定 id 不变；**不要手改 `kb.json.id`**。
- 可清理：下载残留 `*:Zone.Identifier`、确认无用后的 `parsed/`、确认新状态可用后的 `.pre-*` / `*.bak` 快照。
- **禁止**：运行期间手改 `datadb/kb.db`、`vectordb/`；在文件系统里直接改名/删库目录。

## 10. 已知事项

### 10.1 `_writer.lock`

库在 drvfs（WSL 内 `/mnt/e`）上，写操作依赖 `_writer.lock`。Windows 侧访问 9P 时 `O_RDWR` 加锁有失败先例，因此：

- 日常按「后端跑 WSL、访问 `/mnt/e/local_db/.knowledge`」使用。
- 若真出现加锁失败：改用 Windows 原生 Python 跑后端（`pipeline2.py` 已有 `msvcrt.locking` 分支，E: 是本地 NTFS），或把库放回 WSL 原生 ext4。
- 锁是固定锚点文件，进程退出后由系统释放；**文件存在不代表被占用**。

### 10.2 `_registry.json`：不维护

它是磁盘的派生缓存（后端注释明确「磁盘为权威」），位置应在库根。项目内那份已与库分家，没有意义。需要时 `python -m kbctl --root <库根> registry` 重建。**发现库一律以目录中的 `kb.json` 为准。**

### 10.3 其他

- PDF 的阅读正文登记自 `parsed/<source 相对路径，含 .pdf>/markdown.md`；原始 PDF 哈希与正文哈希分开管理。原 PDF 变了而解析没变时拒绝复用旧解析。
- 少于 3 字符的检索词退化为子串匹配（返回 `ranked_by=substring`）。
- 归档/迁移材料另放，不参与扫描：`archive/`（历史导出与回退材料）、`_scratch/`（可丢弃产物）。

## 11. 两份 README 的同步

- 权威版：本文。派生版：具体项目的 `.knowledge/README.md`。
- 派生版里项目特有的段落用 `<!-- project-only --> … <!-- /project-only -->` 包起来；同步脚本保留该块，其余按本文覆盖。
- 两侧文件头都写「权威位置」与「上次同步时间」，防止误把派生版当源头改。

## 12. 维护本文

- 结构、层职责、标识规则、`kb.json` 规格或转化约定变了就改相应小节；一次性脚本与历史操作留在 `.datascripts/` 与 git 历史，不复制进本文。
- 不写死库名、数量、主题；盘点结果用 §7 命令现取。
- 与本文冲突的实现以代码为准，改代码后回来改本文。

## 附录 A 改名、移动与更新的操作语义

**库改名**用 `name` 改显示名，ID 不变。整个库目录可以在停止使用后整体移动，保持 `kb.json.id`
和相对内部布局，再从新路径打开；当前没有跨卷迁移服务或自动路径跟踪。独立复制成「新库」涉及新库身份，
不提供 fork 操作，**不能手改 ID 后宣称已完成引用迁移**。

**逻辑移动**优先调整章节或文档归属。对资料整理而言一般不需要搬原文件。同一文档可先挂到新章节，
再移除旧归属；移除归属不下线文档。章节可移到别的父章节或顶层，子章节仍跟随同一 ID。

**物理文件移动**用两步协议：先在 `source/` 内移动文件，再在任何扫描前调用
`v2-rename <source_id> <新相对路径>`。它是路径重新绑定接口，不是搬文件命令；
会核对新文件内容、库内路径及路径占用，保留来源 ID、版本、逻辑归属与原 URL。
两步之间中断就补做绑定，**不要先执行完整扫描**。新路径已被扫描成其他来源时报冲突，不自动合并。
无法确认旧身份的未知路径作为新来源，不能凭内容相同猜测移动。

**文件更新**先 `organize`（或 scan）登记观察到的状态，再 `update` 发布新的检索版本。
`organize` 同时冻结新原文，原文阅读可以先看到新资料；`active_version_id` 仍表示已成功建立索引的版本，
两种状态不得混称。阅读续页可传 sha256，更新后明确拒绝把新旧页面拼在一起。

**文件消失**只有成功的完整扫描才下线；目录读取失败中止扫描，单文件访问失败保留原状态，
**部分扫描不下线**。下线来源保留历史引用与组织关系，当前列表和检索排除它；导航移除不等于正文删除。

## 附录 B 发布、引用与恢复

更新顺序：准备任务 → 保存快照并构建候选 → 核对 → SQL 事务切换 → 清旧向量。
候选失败继续旧版；提交后清理失败只补清理，不让旧版重新可见。`jobs` 使用
`building / committed / done / failed`；重试复用可核对产物，不承诺模型计算恰好一次。

检索先求合法范围内 DISTINCT 当前 `version_id`，再前置过滤向量；空范围返回空，**不扩大到全库**。
过期向量的逻辑隔离与物理删除是两个状态。换模型要建立新集合再切换，不能混用两个向量空间；
集合名称不是兼容证明，完整配置存 SQL。

引用保存库上下文、来源、处理版本、分片、当时标题/URL/摘录和字符范围。保存时验证分片确实属于
该在线来源的当前版本；搜索后来源已更新则拒绝保存旧组合，调用方须重新定位。已保存的历史引用不改写。

锁：扫描、管理、查询、恢复、发布、GC 与备份互斥（每库可重入 flock），忙时返回错误，不静默等待。
实现选择在整个操作期间持锁，长索引构建会阻挡同库阅读；进程退出或被强杀由系统释放锁（见 §10.1）。

备份停写后复制库，SQLite 用 backup API；原文、SQL、配置是必要部分，解析和向量用于完整恢复。
恢复在独立目录校验，不覆盖唯一副本做试验。缺向量拒绝语义检索，仍可读冻结原文；
SQLite 与向量库不宣称有跨引擎事务。

## 附录 C 当前模型与配置

- `langchain_docs` 的目标配置为 BGE-M3 dense（`BAAI/bge-m3`，1024 维，归一化），Chroma cosine。
  模型根目录由 `HELI_EMBEDDING_ROOT` 指定（本机 WSL 为 `/mnt/e/local_models/embedding`，
  其下 `BAAI--bge-m3/`）；本地加载，**不自动下载**。默认可用 CUDA 优先，
  可用 `HELI_EMBEDDING_DEVICE=cpu` 覆盖。
- 分块：`markdown_heading`，`size=512`、`overlap=64`，单位为字符而非 token，`breadcrumb_levels=2`；
  解析 `md-v1`、分块 `algorithm_version=3`。批量 8，HNSW `ef_construction=200`、`max_neighbors=32`。
  这些是配置现状，**未经相关性与延迟对照验证，不能当作最佳参数**。
- `kb.json.schema_version=1` 与数据库 `meta.schema_format=2` 是不同版本，不要混称。
  配置写临时文件后原子替换。SQLite 启用外键、WAL/FULL、`busy_timeout=5000`；
  非空旧格式数据库会被拒绝直接接管。
- 全文检索是 SQLite FTS5 trigram + BM25，索引在 `vectordb/fts5/fts.db`，**不依赖 embedding**；
  少于 3 字符退化为子串匹配。语义（dense）索引当前**未发布**。
