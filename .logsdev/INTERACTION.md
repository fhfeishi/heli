# Current Interaction

- 更新时间：2026-10-24。现行要求见 [PROJECTION.md](PROJECTION.md)，用户原文见 [query.md](query.md)。
- 上一轮（扫描件接 MinerU）的接续记录已收口：全文在提交 `984ba51` 的 `INTERACTION.md`，本地可读 `.logsdev/archive/2026-10-20-节点/INTERACTION.md`；其中的完成声明与「下一步」只代表写作时点。

## 当前目标

补齐 U6/U8、模板与 report 生效、会话闭环、范围多选，并重做资料阅读页。

## 进展与依据

- **证据面板（U6/U8）**：成果页引用从静态 `div` 改为可点按钮，第三栏按 `version_id` 取当时那版正文，命中行高亮并自动滚入视野；取不到时明说「来源不可用」并展示引用时摘录。U8：有未保存修改时先弹三选一确认。
- **模板管理**：按 U1 放进设置页，五类分栏，body 按「每行一条」编辑，校验以后端为准。实测创建/编辑/删除均通过。
- **report 模板生效**：原为死代码（`_research` 只认 `kind == "research"`）。改为读 `outline` + `required`，任务页模板下拉同步。实测产出章节即模板定义的四节。
- **会话闭环**：`_execute` 成功/失败都写 assistant 摘要消息。实测两条路径均落库。
- **范围多选**：`Scope` 增加 `kind="multi"` + `ids`，`resolve_scope` 逐项解析取并集；前端研究任务改成复选框列表。**修了一个真实缺陷**：`tasks.py` / `routes.py` 手写快照 dict 丢了 `ids`，导致多选任务运行直接失败（报「多选范围里没有选任何库或组」），改用 `Scope.as_dict()`。实测多选两库运行 done、快照保留 ids。
- **资料阅读页重做**：新增 `model/sourceMeta.ts`。标题从 `2023_2025_62206154_韩宇星_基于…研究.md` 拆成干净项目名 + 一行副信息；frontmatter 收成可折叠信息条（正文已有「## 项目信息」表时不重复）；去掉与标题条重复的正文 H1；xl 以上加大纲可点击定位；中间栏改成项目名两行 + 年份/负责人/状态/大小一行（负责人优先不截断）。
- 验证：`tsc --noEmit` 无输出；`bash launch.sh` 全流程通过；`test_app_http.py` / `test_attach_text.py` / `test_templates_http.py` 全 PASS；`check_rules.py` 0 新增错误。界面验证改用 **ego-browser**（真实浏览器，非 headless 截图），用法记入 `.agents/skills/browser-check/SKILL.md`：WSL 下调用 Windows 侧 `ego-browser.exe`。实测结果：13 张卡、卡高 144、重复说明卡 0 张；悬停 spotlight 跟随指针；Tab 15 步可达卡片，焦点环 2px 实线紫，回车进库；拖拽属性在；点归档出现「确认归档」且不误跳转。
- **卡片改动**：说明文字按「去掉括号内差异后的形状」判重，模板句不铺；系列名只在未分组时显示；新增 `year_span`（从文件名「起_止」年份算，2017–2025 vs 2022–2025 是真实区分信号）；读数改成「4 / 14 份可检索」。卡高 222 → 144，一屏从 8 个库变成 11 个。
- **已知未通过**：`tests/test_runs_http.py` 的 extract 用例连续多次失败，报「模型返回的提取结果不是合法 JSON」。代码对 `result.truncated` 有正确处理并如实报错，属上游模型输出截断。按规范已停止重试。

## 未决问题与下一步

- **验证产物留在库里**：`task_de16f2d637f7`、`task_467fc71104f0`、`art_c3bd9cd9d225` 等是本次实测产物。后端没有删除任务的接口，无法自动清理；它们同时是「report 模板生效」「会话回写」「多选范围」的可复查证据。
- **`test_runs_http.py` 未通过**（见上）：模型输出截断，非本地实现缺陷。
- **不封装 MinerU 调用**：用户自己跑解析，heli 只认产物。
- **安全（已处理历史，仍需用户吊销 key）**：`.env.example` 曾写入真实 `DEEPSEEK_API_KEY`，随本地提交 `b49660d` 进入历史。该提交当时尚未推送，已在本地重写历史把该行清为空值后再推送，远端从未收到过这个密钥。**旧 key 仍需到 DeepSeek 控制台吊销**。
- 工作区有并行的设计令牌优化（`globals.css` 文字层级与对比度、`ui.tsx` 排版微调、`Markdown.tsx` 标题层级、`KnowledgeView` 若干样式），非本轮改动，未动。
- `.logsdev/ref-strata-three-layers-20261017.md` 状态已废且未被引用，脚本只给警告；是否删除待定。
