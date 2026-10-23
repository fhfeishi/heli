# Product Projection

本文件维护总体目标、已确认要求和高层安排。执行状态见 [INTERACTION](INTERACTION.md)，原始产品想法见 [query](query.md)。

## 当前有效要求

完善本地知识库／资料库的组织、阅读、查询、引用和更新能力，采用精简且可维护的方案。唯一设置结论保存在 [.knowledge/README.md](../.knowledge/README.md)；历史持久化规格、WeKnora 调研和验证资料由 `archive/README.md` 导航。

2026-09-28 用户明确要求继续实施、同步上下文规范与入口索引，并将 `.knowledge/langchain_docs` 整理成预期形式；README 须说明设计原因、改名、文件移动、内容更新、多层章节与文档的关系和管理接口。

这次指令替代此前“仅调研、不写原库”的范围：允许在验证后建立真实库组织元数据和原文快照，整理旧导出并保留回退材料。源文件内容和既有原始归档保留，不擅自永久删除。资料管理交付与完整 RAG 发布分开描述，不通过改写验收宣称未完成的语义索引或前端就绪。

## 设计与工作安排

稳定来源 ID、不可变内容版本、章节树与文档多归属；组织不依赖物理文件位置，导出 JSON 不作为第二编辑源。先使目录、定位和阅读可用，再补语义／关键词检索、完整章节阅读和按需专题笔记。无需部署 WeKnora、图数据库或自动生成全库 Wiki。

存储 A–C 验收仍覆盖来源/版本/引用、故障恢复/并发、备份/前端重启；知识质量另外检查指定阅读、事实检索、对比、枚举、更新与缺证据场景。源码和实测是完成依据，说明文档不是功能完成证据。未完成接口和验证保持在当前工作记录。

## 前端顶层设计（2026-09-28 已批准，进入实施）

依据用户 2026-09-28 指令（[query](query.md)「heli 的顶层设计」及其补充）及其同日裁决：方案 v2 已批准，正文转为实施规格，U1–U9 按方案倾向确定并已回写 [DECISIONS](DECISIONS.md)。

**当前状态：已批准，按场景推进；S1 已于 2026-09-28 完成并在真实库验收，S2 等后端提取接口。** 方案正文唯一位置为 `archive/frontend-top-level-design.md`；本轮执行状态见 [INTERACTION](INTERACTION.md)。

有效约束未变，方案必须服从：本地单机（无多用户、无云同步）、Tauri 桌面优先、后端为 Python `heli-src`（本机 `/api`）、WSL 与 Windows 双环境、验证以源码与实测为依据。落盘命名、章节与来源语义、锁与并发边界仍以 [.knowledge/README.md](../.knowledge/README.md) 与 [DECISIONS](DECISIONS.md) 为准。

工作安排（高层，明细不复制到本文件）：

1. 按 **S1 → S2 → S3** 推进，每个场景交付一条端到端用户路径；验收写在方案 §16，不在此复述。工程地基（S0）只在被某场景需要时做，不单独铺开。
2. **S1 已完成（2026-09-28）**：无后端新依赖。路径「进入库 → 展开目录 → 查找文档 → 阅读章节 → 刷新后恢复位置」在真实库 `langchain_docs`（1,438 源文件、96 章节）上实测通过（同一 URL 重开恢复章节与滚动位置）；证据与限制见 [INTERACTION](INTERACTION.md) 当前接续节。
3. **S2 的前置在后端**（U4）：提供 `target-schema.json` 样例与提取接口前，前端只做契约 + MSW mock + 界面骨架并标注未接后端；接上真实接口才计入验收。向量检索（U2）为可选增强，不阻塞前端。
4. S0 中的一项既有缺陷修复（根 `.gitignore` 的 `lib/` 命中 `heli-web/src/lib`，改为锚定 `/lib/`）不改变可见行为，随 S1 一起做。

完成依据：每个场景的端到端路径在真实库上跑通并有可定位命令或结果；文档本身不构成功能完成证据。

冻结快照（不随正文更新，且 `archive/` 不入版本库）：v3（裁决后）`frontend-top-level-design-v3-2026-09-28.md`、v2（采纳评审后）`frontend-top-level-design-v2-2026-09-28.md`、v1（评审前）`frontend-top-level-design-2026-09-28.md`；均在 `archive/frontend-top-level-design/`，索引见 `archive/README.md`。

### 2026-09-29 接续范围

本轮继续仅用 BM25；embedding 不作为前提。真实库全文索引与方案持久化已接入，证据见 INTERACTION 当前段。S2 剩余验收仍按顶层设计 §5.7：自动提取运行、结果证据定位、原文/方案过期判定、人工修改与重跑差异；方案保存完成不等于 S2 完成。

### 新增资料格式接入（2026-09-29）

按用户新加入的 source/parsed/target 文件继续实施：保留目录和外部结果，PDF 以其解析正文参与阅读/BM25，target facets 结果按 source_hash 关联来源并提供证据核对。当前已有结果接入与页面同步已完成，证据见 INTERACTION。S2 自动执行与人工复核重跑的既有完成条件不变。

## 资料库系统设计（2026-10-17，候选待裁决）

> 2026-10-18：分类与分层结论已并入 [上层设计 v2](library-platform-top-level-design-20261018.md)；本节保留作来源追溯，不再单独裁决。


用户 2026-10-17 提出：资料分类（科研项目文档｜科研论文与研讨｜个人积累｜多媒体）、
四层结构（系统 → 资料库组 → 资料库 → 资料）、库组的增删改查、以及书架／卡片形态的动态效果。

**方案正文**：[library-system-design.md](library-system-design-20261017.md)（候选，未批准，不启动实施）。
核心结论：横/纵只是「经费来源」一维，分类应为三个分面（来源 provenance｜体裁 genre｜载体 media，
多媒体属载体而非类别）；库组作为**视图层数据**落盘到 `<库根>/_layout.json`，不引入中间目录；
书架/卡片与既有代码同在死链上（`KbWorkspace.tsx` 0 引用），需接到 `/knowledge` 列表页复活；
另发现既有缺陷——`v2-scan` 把非 PDF 二进制当 UTF-8 读成正文，多媒体进库会污染检索。

**待裁决（4 条，见正文 §10）**：① 是否解冻 U3（书架降级），解冻范围限「多库浏览视图」；
② 库组落盘位置（`<库根>/_layout.json` / kb.json 内嵌 / SQLite 表）；③ 资料删除语义（是否引入软删除与回收期）；
④ `knowledge_type` 是否收敛为受控词表（需一次性迁移现有 12 个库取值）。裁决前不改 DECISIONS，不实施。

## 资料管理底座上层设计（v4，2026-10-18 已批准，实施中）

用户 2026-10-18 指令：把 `.logsdev/` 下三份 `*-design.md` 汇总成上层设计；随后给出两轮评审意见
（删除恢复阶段、备份完整性、运行输入冻结、统计口径、成员排序、状态声明等）；再要求
「围绕产品重组后端，不必围绕旧代码做渐进修补」，并按工程规则删除旧代码。

**方案正文**：[library-platform-top-level-design.md](library-platform-top-level-design-20261018.md)（v4）
图文派生版 HTML（非权威，随正文重生成）已移入 `.logsdev/archive/design-drafts/`。

**定位**：以资料库为基础，以背景帮助理解，以任务驱动 Agent，以证据连接成果的本地工作台。
主线「收集资料 → 组织与说明 → 阅读与提取 → 研究与审查 → 形成成果」，任一步可进、不设前置门禁。

**v4 替代 v3**：`_layout.json` → 应用库 `heli.db`；单库自包含 → 应用数据根（原件按内容哈希）；
「主归属 + 镜像」→ 普通成员关系。三份子方案（library-system / layout-persistence / library-background-ai）
降为背景参考，冲突以 v4 为准。

**已完成（2026-10-18）**

- 后端 `heli-src/`（目录即源码根）：五模块 + storage / models / config / routes / app / cli / pipeline；
  端到端测试 `tests/test_app_http.py` PASS（建库分组、导入幂等、组范围检索、逐字位置、二进制不产正文、
  任务证据包、成果修订、归档退出检索、写失败不清空、重启保留）。
- 前端四入口接新 API：资料库（卡片 / 书架 / 列表三视图 + 拖拽归组）、库内阅读与检索、任务与运行、成果与导出。
- 旧 `kbctl` 整包与 46 个无引用前端文件已删除；WSL 删除与自检脚本见 [scripts/](../scripts/README.md)。

**2026-10-19 结构与审计**

- 后端源码平铺：`heli-src/` 直接放模块（不再套 `heli/` 包），`api/__init__.py` → `routes.py`；
  `tests/` 移到项目根，与 `heli-src/` 同级。入口改为 `python heli-src/app.py` / `python heli-src/cli.py`。
- 批量处理审计：`import` / `reparse` / `reindex` 写 `datapipe/runs/<run_id>.json`，
  记录输入、规则、每库计数、跳过原因、错误与运行环境；开跑先写 `running`，被强杀留痕。
- 真实库续导：原全量导入中断在「AI与农业」，本轮从现有库继续（幂等，已导入记 `unchanged`），
  记录见 `datapipe/runs/`。

**仍缺**：右侧面板、Office/音视频解析、背景 AI、报告模板上传识别、审查规则、DOCX 导出；
真实 `E:\local_db\.knowledge` 全量导入需在 WSL 内执行（Windows 侧沙箱拦截 E: 读取）。
