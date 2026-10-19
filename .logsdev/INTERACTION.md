## 当前接续：真实库全量处理完成 + 资料库界面优化（2026-10-19 晚）

用户指令：数据处理完了吗，没处理完继续处理；资料库界面效果有点烂，需要优化；继续往后干。

### 数据处理：已收尾

| 项 | 结果 |
|---|---|
| 导入 | 13 库 4139 份（4042 text + 97 pdf），审计 `datapipe/runs/20261019-130809-import-52ddce.json` |
| reparse | 后台跑完（260s），6 份 PDF 补出文本层，91 份扫描件无文本层仅登记，审计 `20261019-164739-reparse-70ea44.json` |
| 可检索 | 4048 份（按 `status='indexed'` 口径）；不可检索的 91 份全部是扫描版 PDF，首期无 OCR 属预期 |
| 结论 | 数据管道无遗留任务；扫描件 OCR 留给后续阶段 |

### 修复：索引率统计错账

`catalog._counts` 原来数 `DISTINCT derived.version_id`——资料重导入产生多版本时
`indexed_count` 会大于 `source_count`（Bot-Reports 出现 3013 份资料 3016 可检索）。
改为数 `sources.status='indexed'`，与导入/重解析维护的状态一致。重启后端复核：
Bot-Reports 3013/3013，全库合计 4048/4139。

### 界面优化：资料库总览

针对「12/13 个库共享『自然科学基金-』前缀、卡片说明千篇一律」两处视觉噪音：

- **系列前缀抽取**：首段出现 ≥3 次视为系列名（如「自然科学基金」），卡片/书脊/列表
  只突出方向名（AI与材料…），系列名降为眉题小字；逻辑通用（`seriesOf`），不硬编码。
- **重复说明隐藏**：同一段说明出现 ≥3 次就不再逐卡展示（`repeatedDescriptionsOf`）。
- **数字层次**：资料数 / 可检索数改大号 tabular 数字 + 细进度条；全部可检索时绿色。
- **卡片降噪**：「加入分组 / 归档」图标钮 hover 才出现，只留「打开」。
- **书架**：书脊改用 domain-neutral 纸色令牌（原纯白像浮在纸上），书名同样走短名。
- 页头 stats 增加全库可检索总数。

**验证**：`tsc --noEmit` 通过；`vite build` 通过（`bg-domain-neutral-spine` 类确认生成）；
`python tests/test_app_http.py` PASS；1440×900 实测卡片 / 书架 / 列表 / `/search` 四个页面截图正常。

### 库详情页修整 + 背景接入任务上下文（同晚续）

**库详情页**（`/knowledge/<id>`，此前未实测过）：

- 资料列表不再逐行挂「已索引」徽标（500 行重复徽标零信息量），仅「仅登记 / 无法解码」显示；
- 新增状态筛选条「全部 N / 仅登记 M」，大库里可快速盘点扫描件；
- 去掉搜索框下的整行检索按钮，回车即检索；
- 修一个自伤 bug：`visibleSources` 的 `useMemo` 起初写在 `if (!library)` 早退之后，
  条件调用 Hook 直接白屏，已移到早退之前（hooks 必须无条件调用）。

**背景接入任务上下文**（v4 待办第 2 项落地）：

- `tasks.start_run` 把范围内各库非空背景冻结进 `runs.input_json`（含 `library_name`）；
  之后改背景不影响已建/进行中的运行——运行只认当时快照；
- `_research` 证据包正文新增「范围背景（运行时冻结）」节，标题用冻结时的库名；
- 端到端验证（`tests/` 外的临时脚本）：设背景 → 建任务（scope=单库）→ 运行 → done，
  `input.backgrounds` 正确、证据包正文含背景节；`tests/test_app_http.py` 回归 PASS。

**任务模板**仍未做（需要 templates 表与模板编辑面，留下一轮）。

### 模板（v4 §10）落地：五类模板 + 库关联 + 运行时冻结（同晚三续）

`templates` / `library_templates` 两表此前只有 schema、无代码，现已打通：

- 新增 `heli-src/templates.py`：五类模板（research / extract / review / report / background）
  共用一张表，**按 kind 各自校验 body**（research=sections、extract=fields+缺失策略、
  review=checks+严重度、report=outline+required、background=prompts），不合规抛 Invalid；
  更新时 `version+1`；不静默修正用户数据。
- 内置 6 份种子模板，首次列取时写入（表非空则不覆盖用户改动）。
- 路由：`GET/POST /api/templates`、`GET/PATCH/DELETE /api/templates/<id>`、
  `GET /api/libraries/<id>/templates`、`PUT/DELETE /api/libraries/<id>/templates/<tpl>`。
- `start_run` 把模板快照（id/kind/name/version/body）冻结进运行输入；模板被删则不捏造、直接不带。
  `_research` 证据包在 research 模板下输出「## 模板要求」节，列出该模板要求的结构。
- 前端：建任务可选 research 模板（下拉，默认「不套模板」），任务卡片显示「模板 · 名称」；
  `api.createTask` 支持 template_id。

**验证**：新增 `tests/test_templates_http.py`（端到端：种子、CRUD、kind 校验拒绝空 body、
库关联、任务带模板运行且证据包含模板节）ALL PASS；`tests/test_app_http.py` 回归 PASS；
前端 tsc + build 通过；`/research` 实测下拉与卡片 Chip 生效。

### extract / review 运行落地（同晚四续）

`KINDS` 里一直挂着 extract / review 但没有实现（走 `_not_implemented`），现已补齐：

- **extract**：带 extract 模板运行，对范围内按任务目标检索命中的资料（≤12 份）逐份产出
  「候选定位 + 按模板字段列待确认项」，成果 `kind=note`、`status=draft`；正文首行写明
  「未接模型……不是提取结果」。
- **review**：带 review 模板运行，产出检查清单（`kind=review`）。其中两类检查**真的判定**：
  引用可追溯（每条命中是否都有逐字位置）、状态合规（被引资料是否都 `indexed`）；
  其余诚实标「未验证」，不冒充结论。
- 模板错配：extract 运行套 review 模板 → 运行 `failed` 并留下原因（在工作线程里抛，
  不拦 API 创建，这是有意的：失败留痕优于创建期静默拦截）。
- 前端：建任务先选运行类型（研究/提取/审查），模板下拉按同类型过滤；任务详情页
  运行按钮旁加类型 Segmented，默认跟随任务模板类型。

**验证**：新增 `tests/test_runs_http.py`（extract 12 行候选、字段齐全、错配失败留痕、
review 三项判定输出）ALL PASS；`tests/test_app_http.py` 回归 PASS；tsc + build 通过；
任务详情页实测截图正常。测试任务清理后任务/成果归零。

### 资料库总览重做：去噪音 + 交互语言（2026-10-19 深夜，用户反馈「像一坨」「没特点」）

**去噪音**（先解决「像一坨」）：

- 卡片/列表里重复 12 遍的模板说明整段拿掉（说明在库详情页有位置，总览里只是噪音；
  之前的「重复 ≥3 次隐藏」检测因每条嵌了方向名而失效，直接不展示）；
- 卡片去底部「打开」按钮行（整卡可点），加入分组/归档移到右上角 hover 出现；
- 网格 3 列 → 4 列（1440 下更密），卡片高度统一；
- 列表去掉说明行、无组时隐藏「所属组」列、去掉「打开」按钮；
- 无组时不再渲染重复页头统计的「全部资料库」节标题；
- 修复 Bot-Reports 大数字换行（数字行 gap 收紧 + 标签 nowrap）。

**交互语言**（再解决「没特点」，统一「抽书」隐喻）：

- 书架：统一书高（原按字数参差成锯齿）；悬停把书**抽出来**——书上移 + 底部露出书页横纹
  （位移有物理依据），同时浮出**封面卡**（系列/完整书名/资料数/可检索/进度条/「点击进入」）；
- 索引条进入视图时从 0 生长到真实比例（RAF 触发一次，500ms ease-out）；
- 卡片与书脊入场错峰上浮（animate-shelf-rise，每项 +28/35ms，上限 ~400ms）；
- 拖起资料时全屏 grabbing 光标（body.is-grabbing）；
- 路由切换 200ms 淡入上移（main 按「页面身份」做 key，?view 切换不重挂载）。

**验证**：tsc + build 通过（.book-cover / .is-grabbing 类 grep 确认生成）；三视图 +
书架悬停抽书截图实测成立。纯前端改动，后端测试不受影响。

### 收尾

- 提交 `d0ba4b2`（137 文件，+10419/−23107）；`494d6cd` 把 `heli-data/`（测试残留的本地默认数据根）
  加入 `.gitignore` 并移出跟踪。

### 下一步（按 v4 优先级）

1. 库详情页（`/kb/:id`）资料列表与右侧面板；
2. 任务模板 + 背景接入任务上下文（模型通道仍为 none，产出证据包草稿）；
3. 扫描件 OCR 评估（91 份结题报告 PDF）。

## 前次接续：后端源码平铺 + 数据管道审计（2026-10-19）

用户要求两件事：① `heli-src` 直接作为后端源码目录，不再套 `heli/` 包，README 放进来，
`tests/` 与 `heli-src/` 同级；② 数据处理与转换记录 pipeline 到 `./datapipe/`，让转换过程经得起审查。

### 结构：目录即源码根

| 之前 | 现在 |
|---|---|
| `heli-src/heli/*.py`（12 个模块） | `heli-src/*.py` |
| `heli-src/heli/api/__init__.py` | `heli-src/routes.py`（单文件，多余一层目录去掉） |
| `heli-src/heli/__init__.py`、`__main__.py` | 删除（只是转发，无实际内容） |
| `heli-src/tests/test_app_http.py` | `tests/test_app_http.py` |

- 模块改为同级导入（`import storage` / `from routes import Request`），不再有相对导入；
  `config.PROJECT_ROOT` 从 `parents[2]` 改为 `parents[1]`（少一层目录）。
- 入口改为 `python heli-src/app.py` / `python heli-src/cli.py`；`launch.sh` / `launch.cmd` 同步，
  导入自检从 `import heli.app` 改为 `import app`。
- `launch.cmd` 原生分支原来固定传 `--data %ROOT%heli-data`，会盖掉 `.env`；改为只有外层定义
  `HELI_DATA` 时才传，与 `launch.sh` 口径一致。

**验证**：`python tests/test_app_http.py` PASS（12 组）；`bash launch.sh` 启动后
`http://127.0.0.1:18911/` 返回 200 且带页面；`python heli-src/config.py` 仍解析到
`/mnt/e/local_db/.knowledge/.heli ← 项目根 .env`。

### 审计：每批处理一份记录

新增 `heli-src/pipeline.py`，`import` / `reparse` / `reindex` 都通过上下文管理器记录：

- `params`：源目录、`--library`、数据根、规则（接受格式、内部目录、是否解析 PDF、空文件策略）；
- `counters` 与 `libraries[]`：每个库的 `files_seen / imported / indexed / skipped / failed`；
- `skipped_reasons` 与最多 20 条样本路径：`hidden` / `internal_dir` / `not_document` / `empty`；
- `errors[]`（上限 200，超出记 `errors_dropped`）、`git_head`、`python`、`platform`、`pid`、`duration_sec`；
- 开跑先写 `status=running`，结束 `os.replace` 成最终状态；进程被强杀时留下 `running` 供审查；
- 写记录失败只警告，不阻断数据处理（审计是旁路，不参与事务）。

`datapipe/README.md` 说明三类管道、字段含义与审查命令；`datapipe/runs/` 存记录，不自动清理。
设计正文 §12 同步为新目录，并新增第 7 条约束「批量转换必须留审计记录」。

**小样本实测**：标准旧库（`kb.json` + `source/`）2 文件全收；普通目录 4 文件收 1、跳 3
（hidden / not_document / empty），记录与期望一致。

### 数据：续导剩余库

原全量导入中断在「AI与农业」，本轮从现有库继续（导入幂等，已导入的记 `unchanged`）。
记录写入 `datapipe/runs/`，完成后按库核对 `files_seen` 与实际文件数。

导入过程中修了两处，都是审计暴露出来的问题：

1. **计数口径**：`imported` 原先把「内容未变」也算作新增，记录会高估。改为三列：
   `processed`（处理过）/ `imported`（新增或内容变化）/ `unchanged`（未变），`indexed` 不重复计。
2. **写入性能**：`Store.write_bytes` 对每个文件 `os.fsync`，在 DrvFs 上单文件约 0.5–2 秒，
   2GB 级导入会被拖到几十分钟。`fast_writes=True`（只用于可重跑的批量导入）改为跳过 fsync，
   正常写入路径不变。代价是掉电后最多重跑一次，导入本身幂等，不牺牲数据正确性。

中途两次被主动停止的运行记录已删除（一次计数口径错误、一次 fsync 未修），`datapipe/runs/` 只保留最终记录。

**最终结果**（`datapipe/runs/20261019-130809-import-52ddce.json`）：

- processed 4139，新增 769，未变 3370，进索引 696，跳过 2543，失败 0；
- 13 个库、4139 份资料：4042 份可检索、97 份仅登记（扫描版 PDF，无文本层）；
- 跳过构成：隐藏路径（`.snapshots` 与点目录）2532、非文档 11；
- 实测：`/api/libraries` 13 个库；检索「技术路线」「人工智能」命中基金库正文；
  `/knowledge` 与库内阅读页 1440×900 正常，库内检索「人工智能」4 条命中并带摘要。

### 修复：默认端口落在 Windows 保留段

`bash launch.sh` 报 `OSError: [Errno 98] Address already in use`，但 `ss`、`netstat`、
`/proc/net/tcp` 都找不到监听者。原因是 Windows Hyper-V 保留了 `7975–8074`
（`netsh interface ipv4 show excludedportrange protocol=tcp`），8011 正在其中；
WSL 的 mirrored 网络下，没有进程监听也会直接拒绝绑定。

- 默认端口 8011 → **8788**（与 `config.Settings.port`、vite 代理一致）；
- `launch.sh` 在构建前端之前先探端口，失败时直接给出保留段查询命令与换端口写法，
  不再构建几分钟后才在绑定处崩；
- `launch.cmd`、根 README、MEMORY 同步。

验证：`PORT=8011 bash launch.sh` 立即退出并说明原因；`bash launch.sh` 起在 8788，
`/` 返回 `200 text/html`（806B），`/api/health` 返回 `ok: true`。

## 前次接续：WSL 权限打通 + 库背景 + 批量导入（2026-10-18 晚）

用户重启 WorkBuddy 后，`wsl.exe` 限制已解除（`sandbox.programBlacklist` 不含 `wsl.exe`），
本轮先把这批挂着的删除做完，再继续做功能。

### WSL 权限与清理

- `wsl.exe -l -q` 正常返回 `Ubuntu-22.04` / `docker-desktop`。
- 在 WSL 内执行 `scripts/cleanup-legacy.sh`，**50 项旧代码真正删除**（`heli-src/kbctl` 整包、
  旧测试、`heli-src/scripts`、前端 46 个无引用文件、`.tmp_deltest`）。
  结果：`heli-src/` 只剩 `README.md` / `heli/` / `tests/`；`heli-web/src/` 只剩 7 项。
- 三个执行坑（已写进 MEMORY）：
  1. `wsl.exe --cd "Z:\..."` 报 `ERROR_PATH_NOT_FOUND` —— Z: 是 Windows 侧映射，WSL 内不存在；
  2. Git Bash 会把 `/bin/bash` 改写成 PortableGit 路径，必须 `MSYS_NO_PATHCONV=1`；
  3. 写到 Z: 的 `.sh` 是 CRLF，`set -euo pipefail` 会报 `pipefail: invalid option name`，
     需先 `sed -i 's/\r$//'`。
- 清理后回归：`tsc` 通过、`vite build` 通过、`tests/test_app_http.py` PASS
  （首次跑出现一次 `attempt to write a readonly database`，重跑即 PASS，属临时目录残留，未复现）。

### 功能：库背景

- 后端 `GET/PUT /api/libraries/<id>/background` 原本已有，补客户端 `api.background` / `api.setBackground`。
- `LibraryView` 头部在「说明」下方展示「背景」：未填写时显示引导文案，点击进入编辑态
  （textarea + 保存背景 / 取消 / 清空）。背景允许留空，符合 v4 §5「允许模糊」。
- 实测：写入 42 字 → 回读一致 → 清空 → 再写回，`updated_at` 同步更新。

### 功能：批量与拖拽导入

- 文件选择改 `multiple`；资料栏整块作为拖放区（`dataTransfer.types` 含 `Files` 才高亮，
  `dragleave` 判断 `relatedTarget` 是否仍在容器内，避免子元素间移动时闪烁）。
- **串行导入**：后端单写锁，并发只会互相等待；串行还能给出准确进度
  （`导入 3/8`）与分类汇总（进索引 / 仅登记 / 内容未变 / 失败）。
- 目录选择时用 `webkitRelativePath`，子目录得以保留。

**修掉两个真实缺陷**

| 缺陷 | 现象 | 修法 |
|---|---|---|
| 中文文件名导入失败 | `UnicodeEncodeError: 'latin-1' codec can't encode` | HTTP 头只能 latin-1，文件名改走 `?name=` + `encodeURIComponent` |
| 导入丢子目录 | `notes/田间记录.md` 落成 `田间记录.md` | API 层把完整相对路径传给 `content.import_source(..., rel_path=filename)` |

实测：`notes/田间记录.md`、`notes/方法.md`、`data.bin` 各一次 → 资料清单为
`['data.bin', 'notes/方法.md', 'notes/田间记录.md', 'report.md']`，二进制落 `registered`；
重复导入同内容返回 `unchanged=True`。

**验证**
- `tsc --noEmit` 通过；`vite build` 284KB JS / 37.9KB CSS。
- 1440×900 截图：背景展示（带「背景」标签与编辑图标）、背景编辑态（textarea + 三个按钮）。
- 拖拽未做浏览器级自动化（HTML5 DnD 需构造 DataTransfer），只覆盖到代码路径与接口。

### 结构梳理：删调试页与旧路由

用户要求「梳理 `heli-src` / `heli-web` 的文件结构、该清理的清理、注意上层设计」。先完整盘点再对照 v4 §12。

**结构结论：不需要重组。** `heli-src/heli/` 14 个模块与 §12 一一对应；`content.py` / `tasks.py` 仍是单文件，
符合「模块确实过大或职责分裂时再拆」；`prompts/` 未建（模型未接，不造空目录）。
`heli-web/src/` 16 个文件按 `app / components / model / styles / views` 分层，无交叉引用。

**删除**

| 对象 | 理由 |
|---|---|
| `heli/web/console.html` + `GET /console` + `index()` 的 console 字段 + `from pathlib import Path` | 早期无前端时的调试页，views 已完全覆盖；§12 的目录里没有它 |
| `KbSearch.view` / `KB_SEARCH_DEFAULT.view` / `parseKbSearch` / `parseDocSearch` | `view: "list" \| "table"` 的 table 从未实现，库内也不再有视图切换 |
| `Paths.extract` / `Paths.jobs` / `Paths.session` 及对应 `RouteName`、parse 分支、App 的 switch case | 提取页并入库内、会话并入 task 后只剩空路由，App 里还留着重定向 |
| `setSearchParams` / `patchSearchParam` / `Link` | 零调用方（`useRoute` 之外的路由辅助没人用） |
| `tsconfig.tsbuildinfo`、`dist/` 下 9 个旧产物 | 构建缓存与堆积产物 |

`router.tsx` 从 289 行降到 **137 行**，只保留 `Paths`（9 条）/ `parse` / `navigate` / `useRoute`。

**语义修正**：`/knowledge/<slug>/whatever` 原来会静默渲染库页，改为 `unknown`——与既有「不认识就不猜」的约定一致。

**同步重写 `check-routes.mjs`**：原脚本还在断言 `extract` / `jobs` / `session` 与 `parseKbSearch`，
这些导出已删除，脚本本身会挂。新脚本 24 条断言：13 条路由分类、5 条参数取出、4 条 `Paths` 构造、
3 条往返还原，另加查询串保留；`ALL PASS`。

**验证**：`tsc` 通过；`vite build` 283KB JS / 38KB CSS，`dist/assets` 只剩 2 个文件；
`tests/test_app_http.py` PASS。

### 修复 launch.sh / launch.cmd

用户用 `launch.sh` 打开项目失败。实测四个问题，全部不是逻辑而是遗留：

| 问题 | 现象 | 原因 |
|---|---|---|
| `launch.sh` 是 CRLF | `set: pipefail: invalid option name`，脚本第 9 行就退出 | 文件被 Windows 侧写过；`set -euo pipefail\r` 把 `\r` 当成选项名 |
| 启动漏传 `--web` | 服务能起，但 `http://127.0.0.1:8011/` 返回 JSON 接口索引 | `exec ... heli.app --data --port` 少了 `--web "$WEB_DIR"` |
| 库根路径没换算 | 每次都警告「资料库目录不存在：e:/local_db/.knowledge」 | `.env` 写的是 Windows 视角路径；`heli.config.resolve_knowledge_root` 没做平台换算 |
| `launch.cmd` 仍指向旧包 | Windows 原生分支 `import kbctl.server` 直接失败 | 旧包已删；且 `wslpath` 不认识 `Z:` 映射，转交 WSL 时 `cd` 也失败 |

**修复**

- `heli/config.py` 新增 `_in_wsl()` / `_native_path()`：`e:/local_db/.knowledge` 在 WSL 内换算成
  `/mnt/e/local_db/.knowledge`，反向亦然；同环境原样返回。三个 `return` 都套上。
- `launch.sh` 启动命令补 `--web "$WEB_DIR"`；提示改为「启动：URL（页面 + /api）」。
- `launch.sh` 的「无 node」分支增加产物新鲜度检查：`find src -newer dist/index.html`，
  有更新的源文件就明确提示重建命令，而不是让人对着旧界面猜。
- `launch.cmd`：`import kbctl.server` → `heli.app`；启动命令改 `-m heli.app --data ... --web ...`；
  转交 WSL 段在 `wslpath` 返回值仍是盘符路径时手工换算（`Z:\home\...` → `/home/...`），
  并用 `wsl.exe bash -c "cd '<path>' && pwd"` 校验目标真实存在，找不到就报错而不是空跑。

**验证**（WSL 内实跑）

```
[launch] Python：/home/baheas/wslcodespace/heli/.venv/bin/python（ 3.12.13 ）
[launch] 当前环境没有 node，跳过构建，沿用现有 .../heli-web/dist
[launch] 启动：http://127.0.0.1:8011/（页面 + /api）  资料库：/mnt/e/local_db/.knowledge
首页   status=200 type=text/html; charset=utf-8 bytes=806
health {"ok": true, ...}
```

`bash -n launch.sh` 通过；删掉 dist 后能正确报「也没有构建产物」；`touch src/App.tsx` 后
能看到「这些文件比 dist 新：.../src/App.tsx」并给出重建命令。

**遗留**：WSL 内没有 node，前端只能在 Windows 侧构建。要彻底解决需在 WSL 安装 node，
或把构建步骤移到 Windows（`launch.cmd` 的 WSL 转发目前不做构建，沿用 dist）。

### 数据根改接 E: 与 `.env` 支持

用户要求：数据根默认接入 `E:\local_db\.knowledge`，或写进 `.env`。

**改动**

- `heli/config.py`：`resolve_data_root` 增加 `.env` 读取与 `_native_path` 换算（原先只认环境变量，
  `.env` 里写 `HELI_DATA` 完全无效）；新增 `data_root_source()`，`python -m heli.config` 会显示
  「← 项目根 .env」这样的来源。
- `.env` / `.env.example` 增加 `HELI_DATA=e:/local_db/.knowledge/.heli`。
  取 `.heli/` 子目录而非资料库根本身：与既有的 `.archive`、`.datascripts` 一致，
  避免 `sources/` `derived/` `artifacts/` 与用户自己的库目录混在同一层。
- `launch.sh`：原先写 `--data "${HELI_DATA:-$ROOT/heli-data}"`，**显式参数优先级最高，会盖掉 `.env`**；
  改为只在外层环境变量存在时才传 `--data`，否则交给 `heli.config` 解析。启动日志同时打印数据根与资料库根。

**实测（WSL 内）**

- `python -m heli.config` → `data_root /mnt/e/local_db/.knowledge/.heli ← 项目根 .env`
- DrvFs 上建库：`journal_mode=wal`；20 个库连续写入无锁错误；导入 1 份文本 `indexed`；
  检索「光合效率」命中 1 条、`position=2`；目录为 `artifacts/ derived/ heli.db sources/ temp/`。
- 清空测试数据后跑 `launch.sh`：日志显示
  `数据根：/mnt/e/local_db/.knowledge/.heli　资料库根：/mnt/e/local_db/.knowledge`，
  首页 `200 text/html`，`tests/test_app_http.py` PASS。

### 接入真实资料库：数据摸底与导入瘦身

数据根接上 `E:\local_db\.knowledge` 后，把真实库导进来。这一步暴露的问题比预想多。

**数据实况（实测）**

| 库 | 结构 | 可导入文件 |
|---|---|---|
| 11 个 `自然科学基金-*` | 标准旧库：`kb.json` + `source/` | 约 1100（1031 md + 91 pdf） |
| `Aaevum` | 无 `kb.json`，`blogs/` 下 3 PDF + 1 份自己写的 md | 4 |
| `Bot-Reports` | 无 `kb.json`，容器式：多个 `DeepResearch-*` 子目录 | **4433 个文件 / 206MB**，其中 2977 md |

`Bot-Reports` 里还有大量网页快照（`snapshots/<sha>` 无扩展名）与配图，之前的粗统计漏掉了它。

**四个真实问题**

1. **`Bot-Reports` 差点把垃圾全收进来**：第一版"普通目录当源"把 `kb.db`、网页快照、配图一并导入，
   还报「文件内容为空」。改为普通目录**只收 text/pdf**；标准旧库的 `source/` 仍全收（那是人工放的）。
2. **12 个大 PDF（最大 84MB）**：`pypdf` 解析单份要几十秒，写入 84MB 到 DrvFs 也要几十秒，
   导入直接卡死。改为**导入只落原件、不解析 PDF**，正文提取交给 `heli.cli reparse`。
3. **逐文件事务在 DrvFs 上是灾难**：每个文件一次 `commit` + 一次 `mkdir`/`rename`，
   实测 1 文件/秒，4000 个要一小时。新增 `Store.batch()`（整库一个事务 + `SAVEPOINT` 保单文件失败）
   与 `fast_writes`（`synchronous=OFF`），实测提升约 2.6 倍。
4. **`import` 不认没有 `kb.json` 的目录**：`Aaevum` 会被直接跳过。改为有 `kb.json` 用它的 name/description，
   没有就用目录名，并把库目录本身当源。

**改动的代码**

- `content.py`：PDF 单独成类 `pdf`；`_extract_pdf` 用 `pypdf`（可选依赖，缺省降级为登记）；
  超过 32MB 不解析；少于 40 字符视为无文本层。`import_source` 增加 `force` 与 `parse_pdf`。
- `storage.py`：`Store(fast_writes=...)`；新增 `batch()`；`tx()` 在批量模式下用 `SAVEPOINT`，
  `read()` 复用同一连接（否则读不到未提交的写入）。
- `cli.py`：`import` 放宽目录识别 + 收紧普通目录格式 + 每库一个事务 + 进度输出；
  新增 `reparse`（只处理 `registered` 的 PDF，`force=True` 重新提取）。
- 前端：`LibraryView` 资料列表超过 200 条先渲染前 200，避免 500+ 节点的列表在切库时卡顿。

**验证**

- `tests/test_app_http.py` PASS（批量模式不影响普通写入路径）。
- `detect_kind("a.PDF") == "pdf"`，`pypdf` 可用；`heli.cli --help` 出现 `reparse`。
- 导入过程实测：优化前 75 秒 79 个文件，优化后 60 秒 156 个；仍受 DrvFs 元数据操作限制，
  首次全量导入预计 30–40 分钟（幂等，可中断续跑）。

**未完成**：导入未跑完（截至本节记录时 2450/约 4100）；`reparse` 与最终检索验收待导入结束后进行。

## 前次接续：v4 落地 —— 删旧代码、WSL 删除脚本、资料库三视图（2026-10-18 下午）

用户指令：继续实施；删掉旧代码与旧的无用设计；WSL 删除能力要有脚本方案；**先通读仓库再动手**。

### 先读到的（按用户要求，未读完不动手）

- `.agents/rules/{development,planning,verification,writing}.md`：**无调用方的旧代码连同注释、文档、配置一并删除**；
  新旧逻辑冲突时整体替换，不留开关或兼容层；最小充分实现，删错再修是正常成本。
- `.agents/DOCUMENTS.md`：方案正文在 `.logsdev/` 顶层，`archive/` 不进版本库；载体各管一件事。
- `.logsdev/`：DECISIONS 12 条（多为 kbctl 时期）、INTERACTION 的 v4 与前端重建两段、PROJECTION、
  顶层设计 v4 的 16 章结构、`heli-src/README.md`（全是 kbctl 用法）、`heli-web/README.md`（描述旧原型架构）、
  `.workbuddy/memory/MEMORY.md`（204 行，已超注入上限被截断）与 10-17/18 日志。
- 仓库文件树 241 个文件；确认 `kbctl` 除自身外**零引用**（`launch.sh` 已改调 `heli.config`）。

### 删除

| 对象 | 规模 | 处理 |
|---|---|---|
| `heli-src/kbctl/` 整包（含上一轮建的 `platform/`） | 27 文件 / 4503 行 | 清空 + 移出索引 |
| 只测旧包的 5 个测试 + `heli-src/scripts/` | 7 文件 | 同上 |
| 前端无引用文件（`store.tsx` 2183 行、`data/mock.ts` 1284 行、旧 components、`lib/`、旧 `api/`） | 46 文件 | 同上 |
| `__main__.new.py`、`server.new.py`、`prototype.html`、`run-app.mjs`、`sedFC3pZ3`、`.__wtest` | 6 文件 | 同上 |

保留并迁移：`api/errors.ts` → `model/errors.ts`；`Tone` 就地定义在 `components/ui.tsx`，`types.ts` 因此失去最后引用。
索引移除 23 个、清空 86 个（9P 上删不掉，见下）。

**一次误伤**：依赖闭包正则只认 `from "..."`，漏掉 `import "./styles/globals.css"` 与 `vite-env.d.ts`，
两个文件被清空后立即从 HEAD 恢复并重新 `git add`。`tsc` 用它报了 `Cannot find module './styles/globals.css'`。
教训已写进 MEMORY：清理前显式排除 `styles/` 与 `vite-env.d.ts`。

### WSL 删除能力（新增 `scripts/`）

实测三种失败机制，**都不是权限没开**：

- `rm` / `os.unlink` → `[safe-delete] ... trash-failed`：本地把 unlink 重定向到回收站，回收站解析不了 9P 路径，fail-closed；
- `os.replace` / `mv` → `PermissionError [WinError 5]`：9P 拒绝 rename；
- `open(path,"w")` → `PermissionError [Errno 13]`：截断同样被拒。

只有 `git rm --cached` 有效（只改索引，不动磁盘）。`wsl.exe` 被 Security Center 程序黑名单挡住，
返回 `PROGRAM BLOCKED BY SECURITY POLICY`，提示明确不可绕过、不得通过其他 shell 规避。

产出：`scripts/cleanup-legacy.sh`（WSL 内执行，固定清单，幂等，支持 `--dry-run`）、
`scripts/cleanup-legacy.cmd`（双击转交 WSL）、`scripts/doctor.cmd`（诊断 Z: 映射 + 新建/覆盖/删除三种写操作）、
`scripts/README.md`（三种失败机制对照表 + 如何从 Security Center 移除 `wsl.exe`）。

### 方案文档：`pipeline_workbuddy_wsl.md`

把「Agent 在 Windows 侧操作 WSL 项目」这件事整理成可复用方案
（[.logsdev/pipeline_workbuddy_wsl.md](pipeline_workbuddy_wsl.md)）：三层根因（程序黑名单 / safe-delete fail-closed /
9P 拒绝 rename 与 truncate）、一张实测能力矩阵（读、新建、`cp` 覆盖、`git rm --cached` 可；
unlink / rename / `wsl.exe` 不可）、四种「让文件消失」的决策分支、Agent 侧四阶段流程
（自检 → 映射 → 分类处理 → 构建验证 → 记录）、以及解除限制的一次性步骤。
`scripts/README.md` 里的重复叙述已收敛为链接，避免同一事实两处维护。

### 功能：资料库三视图

- `?view=card|shelf|list` 进 URL（`Paths.knowledge(view)`）；三视图共用同一份 `libraries` / `groups` 与同一组操作。
- 卡片：组内网格，`lg` 断点 3 列；书架：书脊竖排，高度 96–176px 随资料数增长，底部搁板线；
  列表：表格，行内可「加入分组…」下拉。
- 拖拽表达**加关系**：拖进组 = `addMember`；拖到「未分组」= 逐组 `removeMember`（串行，避免写锁互相等待）。
  拖动中源卡片 `opacity-40`，目标组 `ring-1 ring-primary` 并提示「松手加入这个组」。
- `SettingsView` 的「旧后端」一行改为「旧数据」，`heli-src/README.md` 与 `heli-web/README.md` 按现状重写。

**验证**
- `tsc --noEmit` 通过；`vite build` → 281.4KB JS / 36.9KB CSS。
- 抽查生成类：`w-46`（`width:calc(var(--spacing)*46)`）、`rounded-t-xs`、`ring-primary`、`line-clamp-6`、
  `writing-mode:vertical-rl` 均在产物中。
- 1440×900 截图三张：卡片（3 列、组嵌套、同一库在两个组各出现一次）、书架（书脊 + 搁板 + 底部资料数）、
  列表（表头、组 chips、加入分组下拉、归档）。
- `[draggable]` 计数 5 = 4 个库中「农业项目」多归属出现两次，符合预期。
- 后端 `tests/test_app_http.py` 仍 PASS（12 组断言）。

**未做**：拖拽的浏览器级自动化（HTML5 DnD 需要构造 DataTransfer，只覆盖到「元素可拖 + 后端成员接口已测」）；
右侧面板、PDF/Office/音视频解析、背景 AI、报告模板、审查规则、DOCX；真实 `.knowledge` 全量导入需在 WSL 内跑。

## 前次接续：资料管理底座上层设计汇总（2026-10-18）

用户指令：结合 `.logsdev/` 下三份 `*-design.md` 汇总设计方案，完善 heli 的上层设计；新问题描述在 `query.md` `2026-1018 0045`。

**交付**
- 新增上位文档 `.logsdev/library-platform-top-level-design.md`（19 章 + 术语表）：合并
  `library-system-design`（分面 / 媒体通道 / 问答分层）、`layout-persistence-design`（`_layout.json` 形态与协议）、
  `library-background-ai-design`（背景与 LLM 模块），并吸收 2026-10-18 新要求（多模态、组背景、边界诊断、
  任务与报告模板、申请书形式 / 技术审查、组分析雷达图）。
- 新增图文排版派生版 `.logsdev/library-platform-top-level-design.html`（自包含、离线可读、打印友好；
  1440x1000 视口实测三处截图，TOC 高亮 / 表格 / SVG 图示 / 分期卡片渲染正常）。
- 同步本文件与 `PROJECTION.md`；`DECISIONS.md` **未**写入（方案未批准）。

**新增判断（相对三份子方案）**
- 四棵树（物理目录 / 章节 / 组织 / 视图）与动词分离，替代子方案「三棵树」的说法。
- 组分析雷达图给 6 个可复算轴 + 3 条约束（>=3 库才画、缺数据留空不填 0、SVG 手写不引图表库）。
- 相似性查重改为「词级 3-gram Jaccard + 短语交集 + 证据片段」，**明确否掉**「32% 内容重叠」与 Turnitin 式
  4 类 Match Group；可行性与必要性只出清单、不打总分。
- 形式审查改为「规则包执行器」，**不内置政策真值**（指南每年变、各单位口径不同），规则内容由用户/单位提供。
- harness 规则收口为 6 条不变量（H1-H6）+ 角色读写矩阵，替代散落在三份子方案里的约束条款。
- 分期重排为 P0-P5，三份子方案各自的分期表作废（原表保留仅供追溯）。

**实测口径（2026-10-18）**
- 后端路由只有 `/api/libraries` 与库内 tree/search/documents/sections/extraction-*，无 layout / 上传 /
  聚合检索 / jobs / 模板 / 审查 → 缺陷 D3。
- `KbWorkspace.tsx` 仅自引用；`ShelfView` / `CardView` 只被它引用 → 书架与卡片体系仍在死链上，
  复活要找接到 `/knowledge`，不是打开开关。
- `v2-scan` 对非文本仍按 UTF-8 解码（`pipeline2.py:225 / 348`）→ 缺陷 D1 未修。

**未决（需用户裁决，正文 §17 共 10 条）**
- 解冻 U3（限多库浏览）；组落盘位置与引用主键；`collapsed` 不落盘；软删除语义；背景落盘形态与
  `schema_version` 是否升 2；LLM 模型与凭据；边界诊断触发时机；审查规则由谁提供。
- 另需确认：8 个预设背景模板是否齐全（「科研项目-其他」口径）；P5 多模态首期是否只要「转写 + 时间戳检索」。

### v2 收敛（同日，整合评审合并）

用户提供整合评审意见（产品主线 + 四场景 + 存储修正），要求合并为一个**初步的最终版**。正文已重写为 v2，
HTML 派生版同步重生成（1440x1000 截图校验：首屏 / 层级图示 / 存储章节）。

**实质变更（33 条处置见正文 §0.3）**
- 定位与主线：以资料库为基础、背景帮助理解、任务驱动 Agent、证据连接成果；主线五步，任一步可进、不设门禁。
- 层级：不引入子资料库实体；组可同时含子组与库（删 v1 不变式 I5）；「镜像」→「添加到其他组」，按稳定库 ID 去重。
- 属性：v1 的三分面拆成五维（项目属性仅适用时填 / 内容类型 / 文件载体 / 来源信息 / 主题与时间）。
- 背景：L0-L3 完整度 → 三态（用户已保存 / AI 建议 / 尚不明确）；组背景不自动写入库背景；编辑用三栏对照并在变更后重比对。
- 接入：新增「已保存原件 / 可预览 / 可检索 / 可用于审查」四态，界面分开显示；删除分三档（移除关系 / 回收站 / 永久删除）。
- 对象：新增「任务 / 会话 / 执行记录 / 成果」四对象；五类模板统一管理但不合并表单；运行冻结模板版本。
- 审查：四态结果（符合 / 不符合 / 待人工确认 / 无法检查）；无适用规则不得宣称通过；技术问题五要素；
  相似性分四类并披露检索覆盖；不合成总分。
- 分析：资料盘点 vs 任务就绪度；五个指标带分母、可下钻、「不适用」不记 0；不做研究质量评分。
- Agent：注入防护（背景文字不扩权）、自动执行四档、模型通道披露、上下文最小化。
- 存储：`_layout` 只存 `parent_id` + `order`（删 `child_ids`）、`mirrors` → `references`；**取消 degraded 覆写**（写失败即失败）；
  冲突只重放前提仍成立的操作；损坏布局只读诊断；删库加 `.origin.json` 中断恢复记录；背景叙述与机器配置分开、摘要派生。
- 分期：P0-P5 → A-D（每阶段一条端到端路径）。

**文档整洁性**
- 修正 5 处失效链接：`frontend-top-level-design.md` 实际在 `archive/`，已改链接（DECISIONS 3 处、PROJECTION 1 处、
  本文件 1 处），未改任何决定文字。
- 提取方案位置按 `extraction.py::_path()` 事实写明（读两处、库内优先；新建写库内），解释历史记录里两种说法为何都对。

**仍未决**：正文 §14 共 12 条，先定 4 条（解冻 U3 限多库浏览 / 不引入子资料库 / 组允许非叶子放库 /
layout 落位与「写失败即失败」策略）。

### 二轮评审处置 + A 阶段第一切片（2026-10-18 01:40）

**评审处置（10 项，详见正文 §0.5）**
- P1-1 删除恢复：记录移出目标目录到 `_trash/.ops/`，带 `stage` 与源/目标路径；恢复以磁盘核对，
  不信任 stage；补「库内有运行中 job 拒绝删除」与「恢复同名拒绝改名」。
- P1-2 备份：改为「完整恢复必需集合（R 集）」，按能否重建分类；补组背景长文、`tasks.db`、删除凭证；原件与 datadb 不再降到可选。
- P1-3 运行输入冻结：新增 §6.4，后端解析 `scope_resolved`，冻结正文版本、背景哈希、模板/规则版本；运行期间新增资料不纳入。
- P2-4 `source_hash`：改为「内容相同 ≠ 来源相同」，折叠展示但保留各来源，不自动算独立佐证。
- P2-5 覆盖率：分子改去重资料数；记录数另显示；区分 `covered / covered_empty / failed`。
- P2-6 雷达：按指标数 × 尺度 × 对象数选图；SVG 手写降为工程建议。
- P2-7 排序：`order` 统一为「同一父节点内唯一」，子组/主归属/引用共享序号空间。
- P2-8 U5/U7 措辞：U5 改「细化，完成待真实验收」；U7 收窄为长任务可取消，短写操作普通请求。
- 收紧：移除关系会改变组/章节检索结果；背景三态改为三条并存（已保存版本 / 待采纳建议 / 待澄清项）。

**实现：A 阶段第一切片（只做布局域）**
- 新增 `heli-src/kbctl/platform/`：`errors`（带 HTTP 语义的领域异常）、`locking`（任意路径文件锁 + 超时）、
  `layout/{model,validate,store}`（纯数据 / 纯校验 / 唯一写入方）、`registry`（库发现）、`api`（HTTP 形状）、`cli`。
- 接口：`GET /api/layout`（读时归一化、不写盘、补未入组的库、标 unresolved）、`PUT /api/layout`（整份写入 + base_revision）、
  `GET /api/layout/history`。**均在平台层实现，旧 `server.py` 未改动**。
- CLI：`python -m kbctl.platform --root <库根> layout show|validate|export`（新入口，旧 `kbctl` 不动）。
- 入口组合：`platform/http/app.py` 子类化旧 handler，只拦截 `/api/layout*`，其余 `super()` 交回；
  `launch.sh` 改为 `python -m kbctl.platform serve`，旧 `kbctl.server` 保持可回退。
- 校验：I1–I9 逐条返回字段路径；同父下 `order` 唯一；组最多 2 层（库第 3 层）；引用不得与主归属同组。
- 写协议：`.tmp` + fsync + `os.replace`；**replace 失败即 500，主文件不动**；成功前写 `layout-history`（滚动 20 份）。

**验证**
- `python tests/test_layout_http.py` → PASS（10 组断言：不写盘、混排往返、409、环、序号冲突、写失败不降级、引用重复、损坏只读、CLI）。
- `python tests/test_extraction_http.py` → 5 项 PASS，未回归。
- 真实库 `E:\local_db\.knowledge` 的 `layout show` **未完成**：本机沙箱拦截 E: 读取，需在 WSL 内跑。

**本轮未做**：前端接入（三视图/拖拽/背景面板）、软删除与恢复、上传通道、聚合检索、背景落盘、`tasks.db`。

### v4：后端按产品重建（2026-10-18 上午）

用户给出架构建议：围绕产品重组后端，不必围绕旧代码渐进修补。据此重写上层设计 v4，并完成第一版实现。

**设计（`.logsdev/library-platform-top-level-design.md` 已升 v4）**
- 三个产品对象：资料 / 任务 / 成果；背景是属性，提取与审查是任务类型。
- 一个应用、一份关系真源、五个模块：`catalog / content / retrieval / tasks / artifacts`，加 `storage / models / config / api / cli`。
- **替代**：`_layout.json` → `heli.db`；单库自包含 → 应用数据根（`sources/` 按内容哈希 + `derived/` + `artifacts/`）；
  主归属 + 镜像 → 普通成员关系（未分组 = 没有成员关系）。
- 版本只保三类：来源版本、模板版本、成果修订。
- 第一版路径：建库分组 → 导入 → 预览/检索 → 选范围对话 → 核对引用 → 保存导出。

**实现（`heli-src/heli/`，约 1600 行）**
- `storage.py`：SQLite schema（libraries/groups/memberships/backgrounds/sources/versions/derived/FTS5/tasks/messages/runs/artifacts/artifact_revisions/templates）＋ 原子文件写。
- `content.py`：按格式分派；文本类解码进 FTS5（trigram，兼容中文子串），PDF/音视频只登记（`registered`），不产生乱码正文；原件按 `sha256` 分桶存放，改内容不覆盖旧版本。
- `retrieval.py`：`resolve_scope / search / read`；范围支持 all / library / group（含子组）/ source；只有逐字命中才给字符位置。
- `tasks.py`：任务、消息、运行；状态机 `queued→running→done|failed|cancelled|cancelling`，启动时把未完成标 `interrupted`；运行前冻结 `scope/resolved/as_of`。
- `artifacts.py`：成果 + 修订（每次保存新增一条）+ Markdown 导出。
- `api/`：30 条路由；`app.py`：单进程 HTTP；`cli.py`：init/info/import/reindex/search；`web/console.html`：单页控制台（无构建）。
- `launch.sh` 改用 `python -m heli.app --data ...`；旧 `kbctl` 与 `kbctl/platform` 标记停用（文件删不掉，避免被误当生产路径）。

**验证**
- `python tests/test_app_http.py` → PASS：12 组断言（建库分组、同库进两组、导入幂等、组范围检索、全库检索、逐字位置、二进制不产正文、任务运行出证据包、成果修订、归档退出检索且历史可读、错误写入不清空、重启保留）。
- `python -m heli.cli ... import --from <伪旧库根>` 实测导入 2 个文件、保留子目录、`info` 与 `search` 正常。
- 控制台用 1440x900 实测：资料库列表、资料状态、检索高亮与位置、任务运行到证据包、导出链接均可用。
- `tests/test_extraction_http.py` 未回归（旧 kbctl 未改动）。

**未做**：前端三视图接入（当前只有控制台）、PDF/Office/音视频解析、背景 AI、报告模板上传识别、审查规则引擎、DOCX 导出。
**未验证**：真实 `.knowledge` 全量导入（Windows 侧沙箱拦 E:，需在 WSL 内跑 `heli import`）。

### 前端按 v4 重建（2026-10-18 中午）

用户指出：动手前没有通读 `heli-web`。本轮先把前端读完再改，记录读到的关键事实：

- `App.tsx` 70 行，用 `useRoute` + `useStore` 组装；`IconRail` 绑旧 store（nav/collapsed）。
- 路由是自研 285 行（`app/router.tsx`），URL 即 UI 状态；`Paths.kb(slug)` / `task(id)` / `artifact(id)` 可直接复用。
- **两套数据层**：`api/knowledge.ts` 对接旧 kbctl（tree/documents/sections/search），`api/index.ts` 全部 `notReady`；
  `store.tsx` 2183 行 + `data/mock.ts` 1284 行驱动全部页面，属原型态。
- `components/ui.tsx`（515 行）与 `Icons.tsx`（310 行）质量可用：Chip/Button/SearchField/Field/EmptyState/ViewHeader 与令牌齐全。
- 构建：`tsc --noEmit` + `vite build` 需用 node 直跑（`node_modules/.bin` 是 WSL shim）；Windows 侧 `emptyOutDir=false`。

**改动**
- 新增 `src/model/api.ts`（v4 接口客户端，含原始字节导入）与 `src/model/store.tsx`（只放共享列表与错误位）。
- 新增 `src/views/`：KnowledgeView（组与库、加入分组、归档）、LibraryView（导入、资料列表、正文、库内检索与命中高亮）、
  ResearchView（任务列表 / 详情、消息、运行与轮询、artifact 链接）、ArtifactsView（编辑、修订、引用、导出）、SettingsView。
- `App.tsx` 改为四入口壳（复用 Icons/BrandMark 与令牌），`main.tsx` 换 WorkspaceProvider。
- `components/ui.tsx` 的 SearchField 增可选 `onEnter`（回车即检索）。
- 后端补 `get_task` 的 run `started_at` / `input` / `output`；`heli/app.py` 增 `--web` 静态服务与 SPA 回退。

**验证**
- `tsc --noEmit` 通过；`vite build` 41 modules / 273KB JS / 51KB CSS。
- 1440×900 实测：资料库总览（科研项目 / 纵向项目嵌套、未分组）；库内检索出 2 条命中并定位高亮（「命中位置 2」）；
  任务页「解析到 2 个库 / 4 份资料、12:09:41 → 12:09:41、命中 3」；成果页引用 3 条、修订 v1、导出按钮。
- 后端 `tests/test_app_http.py` 仍 PASS。

**遗留**
- 旧 `store.tsx` / `data/mock.ts` / 旧 components 已成死代码（仍参与 tsc 检查），需在 WSL 内删除；本轮不新增依赖。
- 书架/卡片视图、拖拽、右侧面板尚未接到新模型。

## 前次接续：前端 UI 实测审核完成，整改清单已授权并实施

## 前次接续：资料库维护定稿、两套 README 与库位置配置（2026-09-30）

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

产出：正文 `.logsdev/archive/frontend-top-level-design.md`。冻结快照两份，均在 `archive/frontend-top-level-design/`：v2（采纳评审后）`frontend-top-level-design-v2-2026-09-28.md`、v1（评审前）`frontend-top-level-design-2026-09-28.md`；索引见 [archive/README.md](archive/README.md)。快照不随正文更新，且 `archive/` 不入版本库。

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
