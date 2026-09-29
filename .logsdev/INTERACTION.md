## 前次接续：前端 UI 实测审核完成，整改清单已授权并实施

## 当前接续：资料库维护定稿、两套 README 与库位置配置（2026-09-30）

用户指令：E 侧权威 README 换成完整架构设计；项目内派生 README 展开「怎么接入数据」；处理 `.env` + `config.py` 接库位置。

**转化留痕定稿**
- 否决重设计（`<plan_id>/results/` + `_ledger.jsonl` + `_index.json`）：`kb.json` 只留一个 `target_task` 字符串字段，
  `target/` 保持 `<结果 id>.json` 平铺，方案归档在资料库根 `.datascripts/target-schema/<plan_id>.json`（跨库共享，不复制进各库）。
- stale 判据：结果 `source_hash` 不在当前 `sources.last_seen_sha256` 里 = 过期。巡检 `.datascripts/check-stale.py`（只读），
  实测 1122 份结果 0 过期。修掉一处误报：SQLite `WHERE last_seen_sha256` 是数值真值判断，字母开头的十六进制串会被判假。
- `kbctl/extraction.py` 模块文档串写明任务（与 `target_task` 一致）；`_path()`：已存在读原处、新建写库内（库自包含）；
  `list_plans()` 合并库内与资料库根两处（11 个基金库方案数 0 → 1）。`tests/test_extraction_http.py` 全 PASS。
- 口径订正：`target/` 文件名是**外部结果 id**（基金库 20 位 hex），内部 `doc_id` 是 16 位 hex，两者不是一回事。

**两套 README**
- E 侧 `README.md` 换成完整架构设计（原 dox-agent 语料根文档已过时），§1–§12 + 附录 A/B/C（附录由原派生版 §4–§6 搬入，
  那些不是项目特有的）；派生版 = 权威版 + `<!-- project-only -->` 块。
- 项目内 `.knowledge/README.md` 新增 §0：库位置怎么配、怎么接入数据（放文件 → `v2-manage adopt` → `search-index`
  → 补 `kb.json` 分类 → 验收）；订正失效的 `--root ../.knowledge`（9 处）。
- 同步脚本 `heli-src/scripts/sync-knowledge-readme.py`，`--check` 返回一致。

**库位置配置**
- 新增 `heli-src/kbctl/config.py`（纯标准库）：`--root` > `HELI_KNOWLEDGE`/`KNOWLEDGE_ROOT` > 项目根 `.env` > 兜底；
  自动换算 `E:/…` ⇄ `/mnt/e/…`。接线：`__main__.py` 的 `DEFAULT_ROOT`、`server.py` 的 `--root` 默认值、`launch.sh`。
- 建 `heli/.env`（`.gitignore` 已加 `.env`），修 `.env.example` 拼写；`launch.sh` 修绝对路径判定（盘符路径曾被当相对路径拼到项目根下）。
- 实跑：不传 `--root` 起服务，日志 `目录：E:\local_db\.knowledge`，`/api/libraries` 返回 12 个库、`tree` 200；
  `python -m kbctl --kb 自然科学基金-AI与农业 v2-manage list` 直接可用（13 篇）。

**遗留**
- `自然科学基金-AI与社会治理/target/.probe_write.json` 探针残留待删（脚本已跳过它）。
- 派生版 `附-1~附-5` 是保留下来的项目特有结论；权威版尚未单写「章节树与多归属的完整语义」。
- `heli-src/{__main__,server}.new.py`、`heli-web/scripts/sedFC3pZ3`、`heli-web/src/.__wtest` 本机删不掉（WSL 9P），
  已加 `.gitignore`，需在 WSL 内删除。

## 前次接续：UI 审核整改三批已实施（2026-09-29）

用户指令：根据 `.logsdev/frontend-ui-audit-2026-09-29.md` 实施修正。按报告 §3 的三批建议执行，不新增裁决。

**第一批（减法）**
- `KnowledgeView.tsx`：删除与 `/knowledge` 列表页重复的大标题+副标题、12 个库的标签云、被 `flex-wrap` 散落的三个按钮、「资料库 / 书架整理」切换条；库内 chrome 收成一行「资料库 / 库名 · 统计 · [信息提取][处理记录][库概览]」。库重命名搬进「库概览」面板（`Inspector` 新增 `LibraryRename`），不再占 chrome。
- 阅读区：正文包一层 `mx-auto max-w-[760px]`；正文字号 13.5→15px（`text-title`，行高 1.75）；章节选择器由整行原生 select 改为「章节 ▾」胶囊 +「第 N / M 章」+ 上一章/下一章胶囊按钮；「完整章节 · N 字符 · 已定位到第 N 字符」降为微字号灰色单行。
- 三栏 `190/210/flex` → `240/340/flex`；文档条目只留标题（路径进 `title` 悬停）；右栏空态改居中窄空态（360px）+「最近阅读」3 条（新增 `lib/recent.ts`，localStorage，只存标题与 id）。

**第二批（去工程语言 + 导航统一）**
- `SettingsView` 五条 hint 全部重写为用户语言（去掉 U1/U2 编号、Vite 代理、`.knowledge/README.md`、内部文档名）。
- CLI 命令不再平铺：`KnowledgeView` 索引未就绪块与 `Inspector` 库概览都改成「复制建索引命令」按钮，命令串收敛到 `lib/kbCommands.ts`；`JobsView` 改用同一函数（原先另有带引号的一份）。
- `ExtractView` / `JobsView` 横幅改用户语言（不再自述"尚未接通"）；extract 页补面包屑，不再像孤页。
- 新增 `components/Breadcrumb.tsx`，库页 / 处理记录 / 信息提取共用；`JobsView` 自带的面包屑与「返回资料」链接删除，extract 页返回链接统一为「返回资料库」（保留未保存编辑确认）。
- 「新建研究」只留主区一个：`SidePanel` 在 `/research` 首页不再渲染左栏按钮（其他研究页保留）。

**第三批（U3 落实）**
- 库工作区移除书架入口；`KbSearch.view` 去掉 `shelf`（`?view=shelf` 静默落到 list），`Paths.kb` / `Paths.doc` 同步；`check-routes.mjs` 对应断言改为 table，并新增「?view=shelf 落到 list」。
- 书架/卡片体系（ShelfView / CardView / KbCard / ShelfHeader / ConfirmCard / kbDnd / kbGroupDnd / kbLayout）成为 0 引用，按报告 §2.2「冻结」处理：**不删文件、不再投入**；`Bookshelf.tsx` / `ListingViews.tsx` 两个 stub 本机删不掉（WSL 9P），仍为空。产物 JS 由 526 kB 降到 467.66 kB（书架体系不再进入主包）。

**未做（需设计决定，不擅自改）**
- P3：成果页双主按钮与 chips/徽章重复表达、IconRail 纯图标无文字（改宽度需设计）；`KbWorkspace` 的「本地仅 · 时间」随书架冻结不再触达，未改。
- 报告 §2.4：`store.tsx` 2,183 行 / `Overlays.tsx` 1,337 行的拆分，本轮不动。

**验证**
- `tsc --noEmit` 干净；`vite build` 通过（CSS 49.58 kB / JS 467.66 kB）；`npm run check:routes` ALL PASS。
- 新 Tailwind 类逐条在产物 CSS 中确认生成（`max-w-[760px]`、`grid-cols-[240px_340px_minmax(0,1fr)]`、`rounded-pill`、`disabled:text-stone` 等），旧 `190px_210px` 已消失。
- 浏览器冒烟（后端 8765 未运行，页面上的 HTTP 500 是后端缺失，不是页面错误）：库页只剩一行 chrome；处理记录页面包屑为「资料库 / langchain_docs / 处理记录」且横幅已重写；`/research` 只有一个「新建研究」。冒烟用 dev（5188）已停掉。
- 后端未启动，真实数据下的阅读列宽、章节胶囊、最近阅读、库概览重命名**未实测**，需起后端后复核。

**需求变更说明**：`?view=shelf` 原为受支持的库视图（S1 做过刷新保留），本轮按报告 §2.2 第 1 条与 U3 移除，属于对已确认要求的变更，在此同步。

2026-09-29 用户要求结合实际界面审核：①是否美观；②找出功能冗余组件、保证界面干净简洁。

做法：Windows 侧起 dev（托管 node 直跑 vite，端口 5178），后端 8765 已在运行（非本会话启动），agent-browser 以 1440×900 与 1440×2400 两档视口截图走查全部 10 类路由页面（共 15 张，内部临时产物不归档）；代码侧用 grep 核对 36 个组件的引用关系，并深读 `KnowledgeView.tsx`（456 行）。

报告：`.logsdev/frontend-ui-audit-2026-09-29.md`（139 行）。核心结论——

1. 美观：骨架已立住（U1 四入口、路由化状态、U6 面板模式都在），研究侧（会话/成果页）明显好于资料侧；资料侧最大问题是库页顶部约 230px 的三层 chrome（大标题重复 + 12 库标签云 + 三个散落按钮 + 视图切换条）在每个页面重复、阅读正文无列宽上限、三栏 190/210/flex 失衡导致列表标题截断。
2. 冗余：`Bookshelf.tsx`/`ListingViews.tsx` 是 0 引用 stub；**书架/卡片体系约 3,250 行**（ShelfView 710 + CardView 465 + KbCard 272 + ShelfHeader 158 + ConfirmCard 144 + MirrorPicker 244 + kbDnd 552 + kbGroupDnd 363 + kbLayout 342）只服务 U3 已裁决降级且数据还是 mock 的"书架整理"模式；`MirrorPicker` 因 BulkBar 在用需保留。另有界面级重复：双「新建研究」、artifacts 状态双表达、返回链接措辞不一。
3. 工程语言外露：设置页把 U1/U2 裁决编号、Vite 代理、`.knowledge/README.md` 写进 UI；extract/jobs 页横幅自述"尚未接通"；检索框下平铺 CLI 命令。
4. 整改建议三批：①库 chrome 收一行 + 阅读列宽/字号 + 三栏 240/340/flex；②去工程语言 + 统一面包屑；③按 U3 处置书架体系。应保持的部分：会话页作为美观基准、检索范围披露/不静默扩大/索引未就绪独立提示等交互判断。

限制：截图为内部走查产物未归档；后端非本会话启动（8765 在跑）；未测窄屏与暗色（无暗色）；方案 v2 的第二批（S0/路由）在本次只验证了已落地部分。

下一步：等用户对整改范围授权（特别是第三批书架处置——U3 已裁决，但涉及 ~3,250 行的冻结/搬迁，动手前应确认）。

## 2026-09-29 新增专题库与 source / parsed / target 接入

用户新指令：已有资料、解析文档与 target 文件已放入知识库，继续实施并对齐前后端接口。本次保持 BM25，不用 embedding、不调用生成模型。

- 已登记 11 个中文专题库（加原 langchain_docs，API 共 12 个库）。新增资料 1122 篇、PDF 解析正文 91 篇、导入结果 1122 份，全部结果 source_hash 可关联原文；逐库实测数量见 `imported-library-report.json`。4488 个 facets、8580 条 evidence 字段结构检查无不匹配；没有逐条审核内容。社会治理 `.probe_write.json` 保留并告知未作为结果载入。
- `management.adopt` / CLI `v2-manage adopt` 为已有库补元数据，不覆盖用户文件。`readable_documents` 登记原文件哈希与解析正文哈希，读取/索引同用冻结正文；PDF 变化、解析未变时不发布旧解析。PDF 缺解析时不进入全文索引，仍保留来源。
- `extraction-results` 列表/详情/证据接口已接入 `ImportedResults.tsx`。保留外部 doc_id/version/facets/relations，source_hash 关联内部 source_id。证据版本不同、原文变化时拒绝；摘录必须在正文唯一逐字匹配才返回高亮位置。不把外部 page/chunk_id 当成本地已验证位置。
- 新增原始文件接口、outline 的 content_kind/source_sha256；阅读页明确标注解析正文并提供原 PDF 入口。`content-status` 与 `POST refresh` 接入处理记录页，显示真实文件数量并可同步资料/重建索引。同步过程库锁覆盖整理与建索引；尚无后台可恢复任务历史。
- 浏览器实测：材料库 14 份结果 → `37e2a038b943dd68fe69` → 第一个证据唯一匹配字符 507–575 → 跳到 `src_29cea72551a4`，高亮原摘录，解析正文标识正确。原始 PDF HTTP 响应 SHA 等于 result.source_hash。结果 `?result=` 刷新恢复详情。医疗库 517 份结果，第一页 1–20 → 第二页 21–40。材料库同步后索引时间更新为 2026-09-29 18:56:22+08:00。
- 检查：`test_extraction_http.py` 扩展原有端到端路径，实际 POST refresh、列表/BM25/证据/阅读契约、旧解析拒绝、方案持久化与备份恢复 PASS；`test_search_acceptance.py` 502 篇范围分页与失败回滚 PASS。TypeScript+Vite build PASS（现有主包大小提示保留）。
- 本次接入范围完成；自动提取运行、人工修订与重跑差异、运行取消等仍未实现，S2 整体验收不能标完成。导入结果只读，方案不反向改写用户结果。详情/证据当前仅以全文唯一匹配核对，未校验外部 PDF 页码或 chunk_id 的语义。

## 2026-09-29 本次接续结果

用户再次明确当前只用 BM25，不启用 embedding。本次没有加载 embedding 或调用生成模型。

- 实际 WSL `.knowledge/langchain_docs` 的 FTS5 索引已建：1423 篇、21,760,659 字符，格式 2，2026-09-29 13:17:41。代码 `kbctl/search.py`：事务重建失败保留旧索引；取消 500 候选截断；保存每篇 SHA 并随命中返回，源版本变化时前端不高亮旧偏移。
- `kbctl/extraction.py` + `/extraction-plans` GET/POST 接口已实现真实方案持久化。支持多方案、六种默认字段、document/segment/entity、四种字段类型、完整指令、不可变历史、乐观并发与原子替换。方案落在库内 `target/<id>/target-schema.json`。方案需要备份，结果尚未生成。
- `ExtractView.tsx` 已替换示例结果与假保存，接入 `api/extraction.ts`；支持表单与高级 JSON 保存。实际库已通过页面保存「技术应用分析」（应用场景/问题/技术方法/成果指标/作者/时间），刷新与服务重启后保留。
- 修复 `App.tsx` 提取页重复渲染资料浏览页；`KnowledgeView` 按全文索引展示就绪情况，不再把未建向量误报为全文检索不可用。
- 验证：`tests/test_extraction_http.py` 真实 HTTP 保存/重启/历史/冲突及非法 schema 拒绝 PASS；v2-backup 包含 target 并从备份重新读取方案 PASS；`tests/test_search_acceptance.py` 502 篇范围分页/源 SHA/字符定位/失败回滚 PASS。新增两条分别区分方案丢失或覆盖、索引截断或半成品发布，原有向量协议测试不覆盖这些接口。
- 浏览器：`/jobs` 四类状态显示，真实索引 1423 篇及时间/路径正确；方案保存后刷新恢复且布局只显示提取页；真实全文检索 `structured output` 返回 128 篇，首条点击到原文 `src_19d5b8351fcb`，URL 含 SHA 与 `hit=183`，`mark[data-hit]` 为 Structured output。
- 收尾构建：`npm run build`（含 TypeScript 检查）PASS；现有约 516 KB 主包大小提示保留。
- S2 **未完整验收**：仅方案持久化完成，自动提取、证据结果、人工修订重跑、运行取消仍未实现；不把 embedding 当作生成模型。本次没有要求用户配置 embedding。下方旧记录“只有骨架/实际库未建 FTS/Jobs 未测”已由本段对应证据取代。

# 当前工作记录：知识库／资料库审核

更新日期：2026-09-28。

## 前次接续：S1 已验收；U1 / U5–U9 已实施；U2 全文检索已接通并收尾；/jobs 处理记录页已建；未知路由改为明说；S2 停在后端提取接口

2026-09-28→29 用户指令：继续实施，能干完就干完。当前完成到「裁决里所有不依赖后端新能力的部分都做完」。

**已完成**（均为源码改动，附可定位证据）：

- **U6 右侧面板按模块区分**（§8.2）：`?panel=` 表达开关与可寻址内容（`src/app/panel.ts` 编解码）；`App.tsx` 按模块给 `Inspector` 传 mode——资料库 `docked`、对话与研究任务 `overlay`、窄屏（<1180px）`cover`。实测：资料库页 `[data-panel-mode=docked]`=1、`overlay`=0；研究任务点开面板后 URL 变 `?panel=panel`、`overlay`=1；视口 900 时 `cover`=1。面板新增 `library:<slug>` 分支（库统计 + 处理记录），资料库页有「库概览」开关；刷新后能按 `?panel=library:langchain_docs` 还原（显示 1423 篇原文 / 0 篇已有索引版本）。链接里带面板但内容是内存对象（源文件预览 / 引用详情 / 模板）时，面板明说「这个链接指向的面板内容没有保留」，不假装还在。
- **U8 成果显式保存**（§8.1）：编辑器登记「怎么保存」给 store（`registerArtifactDraft`）；改动后页脚出现「未保存」；关闭时三选确认（保存并关闭 / 放弃修改 / 取消）；未保存期间点击引用或切换面板内容会先问一次（`guardUnsavedArtifact` 作用于 `openPreview` / `openCitation`）。实测：改标题后出现「未保存」，点取消弹出「这份成果还没保存」+ 放弃修改 / 保存并关闭。
- **U5 组织视图落盘**（§11.4）：分组 / 顺序 / 镜像写 localStorage（`src/lib/kbViewStore.ts`），工具栏显示「本地仅 · 时刻」。实测资料库 → 书架整理可见该标注。
- **U7 停止走后端真实取消**（§7.3）：新增 `src/api/runs.ts`（`POST /api/runs/:id/cancel`）；store 有 `stopPhase = requested / confirmed / unconfirmed`。点停止先显示「停止请求已发出，等待后端确认…」，后端确认才写「已停止 · 后端已确认」。实测（后端无该接口）：消息标「已停止 · 后端未确认」，输入框显示「后端未确认停止 · 重试取消」，toast 给出「停止请求未获后端确认：接口不存在…」+ 重试动作——**没有把点了按钮当成已停**。
- **U9 + S2 骨架**（§5 / U4）：新增 `/knowledge/<slug>/extract` 与 `ExtractView.tsx`：方案字段表单 + 记录粒度 `record_scope`（默认 document，另两种给出定位口径）+ 结果表首列「本行代表什么」+ 「未提及」与「失败」分开 + 「待更新」「含人工修订」标记。整页顶部声明这是骨架、示例数据、未接后端（U4），保存与执行按钮只提示「本地预览，未写入后端」。

- **U1 补齐（本轮追加）**：裁决里「`skills` 归入模板高级配置」此前只做了一半——导航里删掉了入口，设置页没有接住，`SkillsView.tsx` 变成孤儿文件。现 `/settings?tab=template` 挂出「模板」页签承载提示词 / Skill，设置概览也列出该项；页签写在 `?tab=` 上。实测：`/settings` 卡片数 0，点「模板」后 URL 变 `?tab=template`、卡片数 4。
- **U1 补齐（默认首页）**：裁决要求「打开应用落在研究任务列表而非空对话」，此前 `/research` 直接渲染对话。现 `/research` 为研究任务首页（`ResearchHomeView`）：任务模板（开始 / 查看详情）、最近会话、执行记录（明说由后端提供、当前没有，不伪造条目）；会话单独进 `/research/session/<id>`，侧栏点会话与「新建研究」都改为导航。实测：`/` → `/research`、`h1` 为「研究任务」、10 个会话入口；点会话后 URL 变 `/research/session/s1` 且出现输入框；直接打开 `/research/session/s3` 与刷新均显示「硫化物中试线良率归因」。
- **§8.1 面板固定（本轮追加）**：面板头部新增固定开关，`?pin=1` 进 URL；固定期间点击新内容**不自动覆盖**，改为在面板顶部给出「面板已固定，刚点开的内容没有替换掉当前内容」+「替换 / 保留当前」；关闭面板时一并解除固定，避免「面板看不见却仍在吞掉点击」。实测：点固定后 URL 带 `pin=1`，点源文件出现该提示，点「替换」后 URL 变 `?panel=doc&pin=1`。
- **§1.2 搜索无结果（本轮追加）**：库内文档列表在无匹配时显示范围说明并给出「扩大到全库」「清空搜索词」两个明确动作，**不静默扩大范围**。实测：`?section=sec_911a7867b984&q=zzzznotexist` 显示「当前范围没有匹配：搜索「zzzznotexist」 · 当前章节及子章节 / 扩大到全库 / 清空搜索词」。

- **U2 全文检索（BM25 / FTS5）已接通（本轮追加，含后端）**：新增 `heli-src/kbctl/search.py`：索引落在
  `vectordb/fts5/fts.db`（可重建派生物，与向量引擎同一层命名，不进 `datadb`），FTS5 **trigram** 分词
  （中英文都能按子串命中；<3 字符的短词 trigram 匹配不到，退回子串扫描并在结果里标明 `ranked_by`）。
  接口 `GET /api/libraries/<slug>/search?q=&section=&limit=&offset=` 与 `/search-status`；
  CLI `v2-manage search-index / search-status / search <词>`。命中给出 `char_start/char_end` 与 `section_index`。
  前端：`?ft=`（与标题过滤 `?q=` 互不干扰）、`?hit=<字符位置>`；结果项显示命中片段（高亮）与字符位置，
  点命中打开所属章节并把该段标出来滚动到视野中。
  实测（Windows 镜像库 1,423 篇 / 2,176 万字符，建索引 4.9 秒）：`?ft=structured output` → 20 条命中、
  索引状态行「全文索引 1423 篇 · 2026-09-29 02:17:40」；点第一条 → URL 变
  `.../doc/src_19d5b8351fcb?ft=structured+output&chapter=1&hit=183&sha=…`、`mark[data-hit]` = 1（命中已高亮）；
  `?ft=zzzznotexist` → 「全文没有命中「zzzznotexist」/ 清空检索词」。

- **检索收尾：§4.4 / §6.3 / §6.4（本轮追加，接口已就绪，不依赖后端新能力）**
  - **§4.4 处理记录**：库概览（`Inspector` 的 `LibraryPreview`）接入 `search-status`，统计格新增「全文索引」
    （`1423 篇` / `未构建`），「处理记录」把**索引构建**单列为一条并给出真实状态与构建时间；
    未构建时给出可执行下一步（建索引命令）。导入 / 解析 / 提取三类仍如实写「后端未接，不显示进度，也不假装已完成」。
  - **§6.4 失败区分**：索引未就绪时**不发起检索**，界面单独显示「全文索引未就绪：检索用不了，目录与原文阅读不受影响」
    + 建索引命令，与「全文没有命中」分成两类，不再混为一类。
  - **检索结果分页**：命中区支持「加载更多命中」，`?offset=` 进 URL（按钮上写明「已显示 N / total」）；
    `?ft=` 时不再取普通文档列表。
  - **§6.3 提取结果页保留回原文的入口**：结果区顶部新增「在原文里核对」输入框（词 → 真实全文检索），
    字段值本身也可点，带着这个词跳到 `?ft=`；尾注明说示例来源是编的、检索会拿这个词到真实库里查，
    查不到就是库里确实没有——不让人以为结果表就是全部。
  实测：命中区 `?ft=structured output` → 命中按钮 20 个 + 「加载更多命中」1 个，点击后 URL 变
  `...&offset=20`（第二页 20 条）；库概览 `?panel=library:langchain_docs` → 「全文索引 1423 篇」+
  「索引构建 · 已完成（1423 篇 · 2026-09-29 02:17:40）」；把镜像库的 `fts.db` 临时移走后 →
  库页显示「全文索引未就绪…」且命中按钮 0（不再误报「没有命中」）、库概览显示「未构建」+ 下一步命令；
  提取页输入 retrieval → 链接「在原文里检索「retrieval」」，点击后 URL 变 `?ft=retrieval`；
  回归：命中点击仍得到 `.../doc/src_19d5b8351fcb?ft=structured+output&chapter=1&hit=183&sha=…&at=10`、
  `mark[data-hit]` = 1。

- **`/knowledge/$slug/jobs` 处理记录页（本轮追加，§3.2 库内第三个入口 / §3.3 页面清单 / §4.4）**：
  此前「处理记录」只做在右侧面板里，没有独立页面与路由，对照 §3.3 缺一条。现补：
  新增 `components/JobsView.tsx`；`router.tsx` 加 `jobs` 路由名、`Paths.jobs(slug)` 与 `/knowledge/$slug/jobs`
  解析；`nav.ts` 归入 knowledge 一级；`App.tsx` 用 `kbWorkspace`（决定三栏是否渲染）与 `knowledge`
  （决定导航高亮与面板布局）两个量分开——处理记录页保持面板 `docked` 但不复用 KnowledgeView 三栏。
  页面列出四类任务（导入 / 解析 / 索引构建 / 提取）：**只有索引构建有真实数据源**（`search-status`），
  显示已构建 / 未构建、篇数、字符数、构建时间、索引位置，并给出重建索引的 CLI 命令 + 复制按钮；
  其余三类如实写「后端没有提供记录接口，不给假的进度或重试按钮」。另按 §4.4 单列「库级锁忙」，
  明说当前拿不到占用者信息，不用假按钮顶替。入口：库页头部新增「处理记录」按钮，
  库概览的处理记录区新增「打开处理记录页」链接；`api/knowledge.ts` 的 `SearchStatus` 补 `path` 字段。

  **实测状态：本轮未做浏览器验证**——用户取消了 preview（5175/5177/5178/5180）与后端 8765 等后台服务，
  按要求未重启。已完成的静态检查：`tsc --noEmit` 无输出、`vite build` 通过（JS 519.61 kB / CSS 49.05 kB）、
  Tailwind 确已生成新页用到的类（`bg-canvas` / `text-micro` / `rounded-card` / `tabular-nums` /
  `min-[560px]:grid-cols-4` 的 560px 媒体查询均在产物里）。**待重启服务后验**：
  `/knowledge/langchain_docs/jobs` 是否渲染四类任务 + 索引真实状态；库页「处理记录」按钮跳转；
  库概览链接跳转；未构建时是否落到「复制命令」分支。

- **未知路由不再伪装成正常页面（本轮追加）**：此前 `route.name === "unknown"` 被并进「会话」分支，
  打开过期或拼错的链接会静默渲染一个空对话——把「没找到」说成了「正常」。现新增
  `components/NotFoundView.tsx`：明说「这个地址没有对应的页面」+ 展示当前地址 + 复制地址 +
  回研究任务 / 资料库列表；`store.tsx` 的一级导航派生跳过 unknown（它不属于任何一级入口，
  保持上一次的高亮，避免把「没有这个页面」显示成「停在某一级」）。

- **阅读页两处修正（本轮追加，§1.2）**：
  · 切换章节（`openChapter`）此前丢掉 `?ft=`，从检索命中进原文再翻章会退回普通列表、丢检索上下文；
    现带上 `?ft=`，同时不带 `?hit=`（旧的高亮位置对新章节没有意义，避免错标）。
  · 章节选择器上方补「第 N / M 章」，两侧补「上一章 / 下一章」（到端点禁用）。

- **`heli-web/scripts/check-routes.mjs`（`npm run check:routes`，本轮新增）**：
  用 vite 自带的 esbuild 把 `src/app/router.tsx` 打成临时 ESM、stub 掉 window 后，
  在 node 里直接断言路由解析。**不起服务、不加依赖**，因此服务被取消也能验。
  覆盖：15 条地址 → 路由名与路径参数（含 `/knowledge/$slug/jobs` 与未知段落判 unknown）、
  `Paths` 生成是否干净（默认值不进 URL）、以及 S1 的核心承诺——把生成的 URL 再解析回去，
  `ft / hit / chapter / sha` 必须原值还原。当前 `ALL PASS`（15 条地址 + 4 条 Paths + 4 条深链还原）。
  为此把 `router.tsx` 里的纯函数 `parse` 导出（原本只在模块内使用）——导出它正是为了让
  「地址怎么被解释」这件事能脱离浏览器被断言。

- **与并发会话的工作对齐（本轮核对结果）**：同一时间段里已有人把后端往前推了一大截——
  `heli-src/kbctl/extraction.py` + `/extraction-plans` 做了**真实的提取方案持久化**，
  真实 WSL 库（`.knowledge/langchain_docs`）的 FTS5 索引已建（1423 篇 / 21,760,659 字符），
  `ExtractView` 已从示例数据换成真接口，`ImportedResults`（导入结果 + 逐条证据核对，
  核对通过后再带 `?hit=` 打开原文高亮）已接进页面。
  据此：**我上一轮加在旧版 ExtractView 上的「在原文里核对」入口随重写被覆盖，不再重复添加**——
  新版自带「继续搜索原文」栏且走真实索引；本轮的改动都避开他们已覆盖的范围，没有并行改写同一处。

- **方案选择进 URL（本轮追加，§13.1）**：`ExtractView` 当前编辑哪个方案此前只在内存里——
  刷新会退回第一条已保存方案，也没办法把「某个方案」的链接发给别人。现用 `?plan=<id> | new`：
  mount 时按地址选中；地址里没写时把默认选中项用 replace 写回；切换方案与新保存都同步这个参数；
  页面上明写「当前方案写在地址 ?plan= 上」，让人知道这个地址是可分享的。
  **局限如实标注**：方案选择不进浏览器的前进 / 后退（只在 mount 读一次），保证的是「按地址还原」，
  不是完整的会话历史导航。

- **其它（本轮）**：`scripts/check-routes.mjs` 补一条 `/knowledge/$slug/extract/<planId>` 用例
  （仍落在 extract 页、slug 正确），当前脚本 16 条地址 + 4 条 Paths + 4 条深链还原 **ALL PASS**。

- **提取结果的选中状态进 URL（本轮追加，§8.1「返回后恢复」/ §13.1）**：`ImportedResults`
  （并发会话新增的组件）此前把「打开了哪份结果、用哪份原文核对」都放在组件状态里——
  点「阅读来源正文」或「打开正文并高亮证据」进阅读页后，再返回就回到空白的结果列表。
  现用 `?result=<id>` + `?src=<sourceId>`：打开结果时 push 一条历史（返回能回到同一份结果），
  切换核对来源用 replace 写入，mount 时按地址拉回同一份结果与同一来源；新增「关闭」按钮，
  关闭时把两个参数一起清掉。**筛选词与分页仍留在组件本地**——不假装它们也能被地址还原。

- **`?view=` 从死参数变成真源（本轮追加，§1.1）**：路由里定义了 `view` 却没有任何页面用它。
  现在「资料库 / 书架整理」的页签由 `?view=shelf` 决定（默认 list 不进 URL），
  库内换章节 / 搜索 / 翻页时一并带上，`Paths.doc` 也补了 `view` 序列化，
  于是阅读页不会把视图状态丢掉。`router.tsx` 的 `KbSearch.view` 扩为 `"list" | "table" | "shelf"`
  （table 留给将来的表格视图，尚未实现）。

- **其它（本轮）**：`scripts/check-routes.mjs` 再加 3 条用例（`/extract/<planId>`、
  `Paths.kb` 保留 `view=shelf` 且默认值不进 URL、`Paths.doc` 保留 `view=shelf`），
  当前 17 条地址 + 6 条 Paths + 4 条深链还原 **ALL PASS**。

**没做 / 做不到（如实标注）**：S2 的验收（§5.7）仍要等后端 `target-schema.json` + 提取接口；U2 的 BM25/FTS5 前后端已接通（见上），**向量检索**仍是可选增强、单独排期；U3 书架按裁决保持可选视图未投入；书盒拖拽手感、FLIP 帧成本、深色对比仍属人工验收。

依据：方案已批准的产品结论（§4.2 / §5 / §6 / §7 / §8 / §11）与九项裁决（§17.1）；上述源码文件与实测 URL、DOM 计数与文本。

限制与未验证：面板布局只在 1440 与 900 两个视口验过；`?panel=` 的内存对象（doc / citation / template）刷新后按设计无法还原，只验了「明说没保留」这条路径；提取骨架的粒度切换只验了默认 document 的表格渲染，segment / entity 未逐个点击；停止语义的「已确认」分支没有后端可验，只有失败分支有实测。jobs 处理记录页尚无浏览器实测（静态检查已过）；面板固定只验了「知识库并排面板 + 点另一个源文件」这一条路径，未覆盖浮层与窄屏；研究任务首页的任务「开始」按钮依赖 mock 的 `runTask`，没有后端执行可验；会话路由只验了 s1 / s3 两个既有会话，删除会话后的重定向未逐个点击验证。

下一步（不是等待项，是后端依赖）：后端提供 target / 提取能力与 jobs 取消接口后，把 `ExtractView`、`runsApi` 与研究任务首页的「执行记录」换成真实实现，再跑 §5.7 的验收。

本轮构建与校验：`tsc --noEmit` 无输出；`vite build` 通过（`index-*.js` 526.33 kB / CSS 49.37 kB）；`npm run check:routes` 全部通过；`npm run check:routes` 全部通过；以上各条（除 jobs 页与浏览器的形状类断言外）均在 dev 服务 `http://127.0.0.1:5180` 上实测（后端 8765 指向 Windows 临时镜像副本 `C:/Users/10354/AppData/Local/Temp/kbmirror`，索引 1423 篇）。全文索引**只在镜像副本上建过**，真实库（WSL `.knowledge/langchain_docs`）仍需跑 `python -m kbctl --root .knowledge --kb langchain_docs v2-manage search-index`。

## 前次接续：前端顶层设计按评审改到 v2

2026-09-28 用户要求先读历史设计，再输出 heli 前端顶层设计方案；方案提出后，用户转来一份架构审阅意见（8 条）并要求处理、更新方案文档。

处理：8 条全部采纳，方案重写为 v2（664 行；v1 758 行）。结构由「框架选型 → 目录重排」开篇改为**第一部分产品设计（§1–8）+ 第二部分工程支撑（§9–16）**：先定三个场景（读懂资料 / 加工资料 / 完成研究）、四类对象与「任务／会话／执行记录／模板」的区分、三种「树」（库分组／库内目录／文档大纲）各自的动词，再推导导航与页面；工程部分只保留被这些结论需要的部分。逐条取舍见正文 §0.1。

其中三条不是照办，而是补证或改为待裁决：①审阅指出的 v1 §7 与 `App.tsx` 矛盾（右侧面板是 `<main>` 的兄弟节点，且 `nav === "kb"` 时不渲染）属实，已在 §8 改为「行为先定、布局待定（U6）」；②BM25 与向量的冲突不能用「与既有决定不冲突」带过——真实库 active 索引 0、向量文件 0，后端 FTS5 也未落地，两条路都要后端做工，前端只依赖一条检索通道契约，冲突本身提交裁决（U2）；③书架视图降级不单方面决定——v2 视觉刚落地并通过构建与冒烟，改列为 U3。

新增三处机制（审阅未提，实现所需）：检索通道抽象（范围 + 查询 → 命中 + 字符偏移，屏蔽 BM25／向量差异）；执行所有权归后端（页面切换只是卸载订阅，不等于取消任务）；复用既有 `version_id` 判定提取结果是否过期。

产出：正文 `.logsdev/frontend-top-level-design.md`。冻结快照两份，均在 `archive/frontend-top-level-design/`：v2（采纳评审后）`frontend-top-level-design-v2-2026-09-28.md`、v1（评审前）`frontend-top-level-design-2026-09-28.md`；索引见 [archive/README.md](archive/README.md)。快照不随正文更新，且 `archive/` 不入版本库。

依据：query.md（2026-0924 / 2026-0928）、PROJECTION、DECISIONS、.knowledge/README.md、knowledge-v2-redesign-handoff.md、heli-web/README.md、heli-desktop/README.md、heli-web/src 14,110 行静态阅读，以及 2026-09-28 的架构审阅意见。用户给的三个外部参考均已核实存在且活跃：facebook/astryx（Meta，MIT，最后提交 2026-09-27）、dembrandt/dembrandt（v0.36.0，最后提交 2026-09-22）、ui.shadcn.com；另参考 lobehub/lobe-chat 与 Mintplex-Labs/anything-llm 的架构。

限制与未验证：方案仍是设计提案，无实现、无运行证据；外部库版本与兼容性未做本地安装验证；astrix 与 dembrandt 的 star 数未取得（抓取片段未包含）；对 `src` 的行为判断来自静态阅读，未做浏览器复现；§6 关于 FTS5 未落地的判断来自后端源码阅读，未跑检索验证。

后续：上述待裁决项已于同日裁决（U1–U9 结果与落地含义见上节及方案 §17.1），并已回写 DECISIONS；工程选型仍由实现者按 §14 在实施时定。

## 前次接续：真实管理页面与章节阅读已接通

2026-09-28 继续实施：新增 `kbctl/server.py` 本机 HTTP API、`v2-manage outline/read-section`；知识库主页面替换为真实目录/文档/状态/阅读，接入库改名、章节新增/改名及文档归属。代码围栏中的伪标题不参与分节，完整章节不按 12,000 字符切断；仍是 ATX 标题和原始 Markdown/MDX 文本显示，不是完整 Markdown 渲染器。

已实际验证：真实 langchain_docs 的 96 章节、1,423 正文、0 索引状态与 Persistence/Quickstart 阅读；独立 `/tmp/heli-ui-check-20260928/ui-check` 通过页面改名、新建章节、挂入文档，API 进程重启及刷新后保持。HTTP 集成覆盖 1,500 行代码完整返回、旧摘要拒绝、异常写入及 Host/Origin 拒绝；前端生产构建通过，真实 Chroma A–C 后端 7/7 通过。证据见[管理交付追加记录](archive/knowledge_persistence/management-delivery.md)与[机器结果](archive/knowledge_persistence/management-web-result.json)。

检索核对改为一次读取向量元数据统计版本数量，查询复用同锁内 recover 结果；保持原有距离排序，不引入强制来源配额。独立 6 篇真实文档样本使用本地 BGE-M3 建立 460 向量，5 个定向问题返回相关来源；这不是全库质量验收。原库仍无语义索引。下一步：全库过滤规模/查询与发布互斥测量、固定问题质量评估、再发布真实索引；关键词混合搜索、检索证据定位、旧协议入口与原型残余清理仍待完成。

启动：WSL heli-src 下 `../.venv/bin/python -m kbctl.server --root ../.knowledge`；heli-web 下 `npm run dev`，浏览器 `http://127.0.0.1:5173`。HTTP 服务只监听本机；同服务请求顺序执行，外部长构建仍会导致同库报忙。源码和文档仍多为 Git 未跟踪文件，未提交。

## 前次接续：资料组织与管理接口已落地

用户 2026-09-28 明确继续实施并整理真实库，替代此前仅调研／不写原库的范围；有效要求见 PROJECTION。唯一设置结论仍为 `.knowledge/README.md`，新增 `.logsdev/README.md` 与 `archive/README.md` 索引，并在 DOCUMENTS 补项目入口映射。

实现：management.py / v2-manage、稳定章节树及多归属、分页枚举与固定原文窗口、链接枚举和库显示名改名；同一库锁覆盖 v2 管理、扫描、查询、恢复、发布与 GC；引用归属核对和空检索范围已补齐。原文分页尚非完整 Markdown 章节阅读。

临时完整副本演练后，真实 langchain_docs 已整理 1,438 原始文件、1,423 正文、15 导航原始件、96 章节、1,423 归属；原始文件哈希不变。旧配置、空库和旧导出在库内 archive/pre-management-20260928 保留，原有 archive/source 与 source_demo 未删改。当前原库没有 active 索引版本或向量，资料管理与原文阅读可用，语义检索尚未就绪。

证据、命令及回退边界见 [管理交付](archive/knowledge_persistence/management-delivery.md)，机器结果见 [management-result.json](archive/knowledge_persistence/management-result.json)。扩展既有 A 路径；真实 Chroma A、B1–B5、C 后端 7/7 通过，测试 hash provider 不证明语义质量。此前全量 BGE-M3 副本证据保留于原报告，未在本轮重跑。

下一步：前端接入目录／文档／索引状态与修改重启 C；完整章节与代码块阅读；按真实问题验证检索质量后建立实际语义索引。同步接口目前全程持锁，长构建阻挡同库读；查询/发布压力交错、过滤规模和锁等待仍未完整验证。旧 CLI 尚未统一移除，不得用于本库。下面历史记录只代表各写作时点。

## 历史接续：知识组织架构调研完成

用户明确唯一设置结论位于 `.knowledge/README.md`，重点转为知识如何整理，并要求调研 WeKnora。本轮固定其 main 提交 9114e4e4f905be71976a77c684d3f92731e6f9a6 只读调查，报告见 [weknora](archive/weknora/README.md)。推荐目标已写入知识库 README §10–12：文档管理、章节阅读、证据引用、专题复用；新增工具与笔记层尚未实现。

本轮只运行分块可读性及内存 FTS 两项局部调查，未部署 WeKnora、未运行模型、未写原库或业务代码。下一步先解决引用归属及读取/发布互斥，补文档定位/章节阅读，再评估混合检索和少量专题笔记；不直接启动全库 Wiki 或图数据库。此前存储验证证据与剩余工作如下保留。

## 历史接续：本地 BGE-M3 全量副本与强杀恢复已验证

用户提供 `E:\local_models\embedding` 后，已接入本地 `BAAI--bge-m3` 的 dense
向量（`HELI_EMBEDDING_ROOT` 指向模型根目录，不联网下载）。原配置在小型独立
Chroma 副本上完成 1024 维入库、恢复核对及重开查询。早期全库真实模型副本试跑
因旧分块器生成最长 344924 字符的片段、显存接近 8 GB 而主动停止；临时副本已
清理。分块器现以原文连续区间切分，`algorithm_version=3` 纳入版本身份。

完整 1438 文件静态核对：62555 个分片全部 ≤512 字符，字符位置失配 0。
现行算法在完整独立副本用 hash 替身更新 1423 正文来源、写入 60267 向量，
`restore_check.ok=true`、查询有结果；真实 Chroma 新协议验收 7/7、旧流程
memory 回归 3/3。原库 `kb.db` 仍为 0 字节、向量文件 0，未迁移或清理。
运行证据与边界见 [交付报告 §6](archive/knowledge_persistence/v2-protocol-delivery.md#6-本地-bge-m3-接入与分块修正)。

随后完整独立副本按原配置用 BGE-M3 构建 60267 个真实向量（更新 1349.3 秒），
恢复核对和重开查询通过；真实 SIGKILL 的提交前/后两条恢复路径也通过。强杀
试验暴露旧 O_EXCL 锁残留阻断重试，现已用 `flock` 修正。详见交付报告 §6。

后续仍需测过滤规模、锁等待、查询与切换/GC 交错，并完成前端修改/重启路径 C；
未满足接管门槛前不写原库。

## 历史接续：WSL 真实 Chroma 与旧库独立副本演练

已在 WSL 原生 ext4 用 Chroma 1.5.9 运行新协议 A–C 的后端验收，7/7 PASS。
`v2-inventory` 是旧库只读盘点入口；`v2-scan` 会写入数据库，不能在唯一真实库上
作为盘点使用。新协议连接器现在拒绝未标记 v2 的非空旧数据库，Chroma 集合删除
只忽略明确的“不存在”异常。

`langchain_docs` 原库盘点：1438 源文件与 manifest 1438 行的路径、SHA-256、字节数
一致；`kb.db` 0 字节、向量文件 0。在 `/tmp` 的完整副本扫描出 1438 来源、15 导航
原始件、6376 链接。按原 bge-m3 配置更新明确失败（provider 未接入）；另以
`hash/copy-rehearsal/16` 在完整副本构建 1423 正文来源、41829 向量，
`restore_check.ok=true` 且查询返回 3 条，副本已清理。唯一真实库未扫描写入、
未迁移或清理。完整证据见 [交付报告](archive/knowledge_persistence/v2-protocol-delivery.md#5-2026-09-27-接续验证与接管保护)。

当时待做的本地 bge-m3 接入及受控调用已在上节完成；前端修改与重启路径 C、真实 SIGKILL、
查询/切换交错、过滤规模与锁等待仍未验证。旧 CLI 不能接管真实库。

## 历史接续：新协议已实现并通过 A–C 验收（memory 引擎）

依据精简规格 §3–6，五表模型与五步更新流已在 `heli-src/kbctl/` 落地（新增 `schema2.py` / `pipeline2.py`，与旧模型并存），CLI 增加 v2 子命令。验收：`tests/test_v2_acceptance.py` 7/7 PASS（路径 A 全链；B 的提交前/后中断恢复、换模型、清理失败、空间不足；C 的备份→独立恢复→缺向量拒绝检索），旧 Phase 1 用例回归 3/3 PASS。交付报告与偏离、未验证清单：[v2-protocol-delivery.md](archive/knowledge_persistence/v2-protocol-delivery.md)。

当时待做的 WSL Chroma 复验、旧库盘点与独立副本演练已在上节接续；原记录误将会写入数据库的 `v2-scan` 视为只读盘点，现已改用 `v2-inventory`。过滤规模、锁等待、真实 SIGKILL 恢复、C 的前端修改段仍未验证；旧 CLI 仍是先删后写模型，不能用它接管真实库。

## 历史接续：精简设计

用户要求精简、高效。本轮已将目标方案收敛为五张核心表、当前导航/链接关系、单写队列与一把存储操作锁，取消全库发布快照和通用产物依赖。规格与审核报告已更新；已同步 README、PROJECTION、DECISIONS。仅设计和文档变更，生产代码、数据与探针未变。

下一步依据当前规格 §3–6 实现临时库与 A–C 验收，不再按旧 §4.3 的十五表模型展开。正常重开探针不能代替故障恢复或性能验证。下面第二轮记录与更早 UI 审核完整保留为历史依据，其模型与节号已由本节替代。

## 历史接续：第二轮存储契约补充

用户在 Claude 第二轮意见复核后要求继续实施。本轮已补齐 [修订规格](archive/knowledge_persistence/knowledge-persistence-optimization.md) 的六项缺口，并同步 [知识库契约入口](../.knowledge/README.md)、后端说明、PROJECTION 和 DECISIONS。下文首次 UI 审核保留历史依据，其“后端只有三模块”和“修复实施尚未开始”等表述不代表本轮全部状态。

发布方向明确为不可变分片＋SQLite 发布成员映射，同模型复用集合、换模型另建实例；一期不设自动移动审核队列，向量回收与历史证据保留分开。完成范围是契约及可行性调查，未修改生产 schema、流水线，也未迁移或清理现有库。

真实 Chroma 1.5.5 探针在 Windows 本地临时库通过发布／来源过滤、共享来源、空范围、精确删除及进程退出后重开，退出码 0。WSL 依赖安装受网络错误阻碍；并发、强杀恢复、磁盘满、规模及新协议端到端均未验证。首次运行的文件句柄清理错误、修正与临时残留见 [完整运行记录](archive/knowledge_persistence/knowledge-persistence-review.md#publication-probe)。

后续从规格 §4.3 schema 与 §6.2 发布协调器开始实现，将探针行为并入 §8 B；目标 WSL 的真实引擎验证是旧库接管前置条件。不要运行旧 pipeline/gc 代替新协议验收。原审核建议与当前范围如有差异，以本节及正式规格为准。

## 任务与结论

用户要求先审核接手项目，重点检查知识库／资料库管理的 UI、交互、视觉和后端细节，随后要求将审核意见更新到相关文档。本轮完成源码审核和有限运行检查，未修改业务代码。

当前实现是交互原型：已有书架、卡片、分组、批量操作和预览入口，但资料存储和处理尚未形成真实闭环。建议优先处理操作真实性、状态一致性与前后端契约，再开展视觉精修。

以下优先级和修正方向均为审核建议，不代表已确认的实施范围或架构选择。原始产品想法保留在 [query.md](query.md)；本轮不将建议写成正式要求或长期决定。

## 证据范围与基线

- 审核对象为本地 `heli-web/src`、前端配置及 `heli-src/kbctl`。审核时 `git status --short` 显示前后端目录等为未跟踪内容，没有可引用的受审提交；下列链接依赖当前文件，代码变化后须重新核验。
- 在 WSL 的 `heli-web` 目录运行 `npm run typecheck`，退出码为 0。仅证明类型检查通过，不证明功能闭环或生产构建通过。
- 运行 `npm run dev -- --host 0.0.0.0`，Vite 输出 ready 和 5173 端口地址；检查结束后已停止进程。
- 浏览器工具初始化失败，错误为 `windows sandbox failed: helper_unknown_error: setup refresh had errors`。未完成实际点击、截图、窄屏或暗色验证。UI 缺陷来自源码分析，视觉建议属于设计审阅。
- `git check-ignore heli-web/src/lib/kbLayout.ts heli-web/src/lib/kbDnd.ts` 返回两条文件路径，确认必要辅助源码被忽略。
- 未执行后端真实上传、解析、向量入库、删除集成测试，也未验证真实 Chroma 行为。

## P1：真实资料管理接入前应处理

| 编号 | 发现与影响 | 依据 | 建议 |
| --- | --- | --- | --- |
| KB-01 | 建库、删库、移除文件只修改前端内存，却提示“落盘”“本地目录同步清理”“更新索引”；刷新后恢复示例数据。用户无法据此判断资料是否保存。 | [store.tsx](../heli-web/src/store.tsx)：`StoreProvider`、`createKb`、`deleteKb`、`removeKbFile`；[api/index.ts](../heli-web/src/api/index.ts)：`notReady` 及知识库接口 | 演示阶段明确标识模拟行为；正式操作等待后端确认，成功提示与持久化结果一致。 |
| KB-02 | 文件选择只留下名称和大小，丢弃 File 对象；网页和文件夹导入仅新增占位记录，没有上传或解析执行链路。 | [Overlays.tsx](../heli-web/src/components/Overlays.tsx)：`ImportDrawer` 的文件选择、`append`、`submit` | 保留真实文件输入，接入上传、解析和索引处理，区分各阶段及错误。 |
| KB-03 | 前端约定 `raw/parsed/vector/kb.db`，后端使用 `source/parsed/vectordb/datadb/kb.db`；前端默认用中文名称作目录名，后端 slug 仅接受 2–32 位指定英文数字及连字符格式。 | [store.tsx](../heli-web/src/store.tsx)：`createKb`；[Overlays.tsx](../heli-web/src/components/Overlays.tsx)：`NewKbDrawer`；[core.py](../heli-src/kbctl/core.py)：`SLUG_RE`、路径属性、`Kb.init` | 统一目录和标识契约，分离显示名称与内部标识，由后端返回实际路径。具体目录方案尚未决定。 |
| KB-04 | 通用 `lib/` 忽略规则命中前端 `src/lib`，拖拽、布局、导出等必要源码不能随普通 Git 添加流程纳入交接。本地检查通过不代表干净检出可用。 | [.gitignore](../.gitignore)：`lib/`；忽略检查结果见上文 | 收窄忽略范围并纳入必要源码，随后验证干净检出。本轮未修改忽略规则或执行提交。 |

## P2：状态与交互缺陷

| 编号 | 发现与影响 | 依据 | 建议 |
| --- | --- | --- | --- |
| KB-05 | 导入只更新文件和数量；删除、重解析不联动更新库容量、状态、进度。空库也显示“正在解析与写入向量库”。重解析 1.8 秒后直接变成功，缺省分片数填 120。 | [store.tsx](../heli-web/src/store.tsx)：`removeKbFile`、`reparseKbFile`；[Overlays.tsx](../heli-web/src/components/Overlays.tsx)：`append`；[KnowledgeView.tsx](../heli-web/src/components/KnowledgeView.tsx)：`KbDetailPage` | 依据真实任务和文件状态维护库级汇总；单独展示空库，停止用定时器及固定分片数表示实际处理成功。 |
| KB-06 | 文件行绑定预览，内部删除、重解析等按钮未阻止点击冒泡，执行操作也会打开预览。 | [KnowledgeView.tsx](../heli-web/src/components/KnowledgeView.tsx)：`FileRow`；[ui.tsx](../heli-web/src/components/ui.tsx)：`ToolButton` | 隔离操作区事件，明确文件名或行的预览入口。 |
| KB-07 | 卡片 `overflow-hidden` 会裁剪内部绝对定位菜单超出卡片的部分；卡片 Enter／空格处理器接收内部控件冒泡按键，可能进入详情并中断子控件操作。尚未浏览器复现。 | [KbCard.tsx](../heli-web/src/components/KbCard.tsx)：根节点及菜单；[ui.tsx](../heli-web/src/components/ui.tsx)：`Menu` | 菜单独立挂载并处理视口边界；卡片快捷键只响应自身焦点。 |
| KB-08 | “下载副本”输出解析预览 HTML，而非上传的 PDF／Word 原件，容易造成内容与格式预期偏差。 | [docExport.ts](../heli-web/src/lib/docExport.ts)：`downloadDoc`、`buildStandaloneHtml` | 分开“下载原文件”和“导出解析文本”，如实标注格式。 |
| KB-09 | 文件操作仅 hover 显现，缺少聚焦显现；上传入口是普通可点击容器；抽屉缺少完整对话框语义与焦点约束。 | [KnowledgeView.tsx](../heli-web/src/components/KnowledgeView.tsx)：`FileRow`；[Overlays.tsx](../heli-web/src/components/Overlays.tsx)：`Drawer`、`ImportDrawer` | 补齐键盘入口、聚焦可见性、对话框语义和焦点管理，并实际验证。 |
| KB-10 | Chroma 集合删除捕获所有异常并忽略，权限、存储或引擎错误不能传给调用方，无法可靠判断清理结果。尚未真实引擎复现。 | [vstore.py](../heli-src/kbctl/vstore.py)：`ChromaStore.drop_collection` | 只忽略明确的集合不存在错误，其他异常向上传递。 |

后端当前只有 `core.py`、`schema.py`、`vstore.py` 三个基础模块；本次未发现连接前端的服务、上传处理和解析任务执行实现，不能认定资料管理端到端可用。

## UI 与视觉建议（非已确认要求）

保留统一颜色／字号令牌、暖中性色与紫色主色、两种视图共用布局数据，以及结构操作撤销机制。在此基础上建议：

- 库详情页优先呈现文件、处理状态、失败原因，将路径与切分参数放入存储或高级详情。依据：`KnowledgeView.tsx` 的详情页顺序。
- 书架用于浏览整理，卡片或列表更适合长名称阅读、状态比较和批量管理。默认视图是产品选择，需实际使用验证，本轮不作决定。
- 统一“分层／分组／合并”术语。`mergeMany` 只改变组织关系，不合并资料；“合并为一层”和“新建分组并放入”应减少语义重叠。依据：[BulkBar.tsx](../heli-web/src/components/BulkBar.tsx)、`store.tsx` 的 `mergeMany`。
- 提升文件名、状态、失败原因和主要操作的可见性。当前次要字号为 11.5–12.5px，浅灰文字使用较多。依据：[globals.css](../heli-web/src/styles/globals.css)。对比度、拥挤程度、暗色与窄屏效果尚未测量。

## 后续接续

建议顺序：源码交接与契约统一 → 建库、导入、解析、预览、删除真实闭环 → 状态与交互修正 → 视觉精修。这是候选顺序，不是已批准的实施计划。

下一次开展 UI 工作时，先恢复浏览器检查，验证菜单、文件行操作、键盘访问和侧栏与预览同时展开时的布局。后端接入前重新核对目录、标识和任务状态契约。当前用户要求为审核与文档同步，修复实施尚未开始。
