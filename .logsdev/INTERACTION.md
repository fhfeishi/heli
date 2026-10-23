# Current Interaction

- 更新时间：2026-10-24。现行要求见 [PROJECTION.md](PROJECTION.md)，用户原文见 [query.md](query.md)。
- 上一轮（扫描件接 MinerU）的接续记录已收口：全文在提交 `984ba51` 的 `INTERACTION.md`，本地可读 `.logsdev/archive/2026-10-20-节点/INTERACTION.md`；其中的完成声明与「下一步」只代表写作时点。

## 当前目标

补齐 U6/U8 与三项后端已有、前端或运行未接的能力：证据面板、模板管理、report 模板生效、会话闭环。

## 进展与依据

- **证据面板（U6/U8 欠账）**：新增 `components/EvidencePanel.tsx`。成果页引用从静态 `div` 改成可点按钮，点开在第三栏按引用记录的 `version_id` 取**当时那一版**正文（不是最新版），命中行包 `<mark>` 并自动滚入视野。取不到正文时明说「来源不可用」并展示引用时保存的摘录，不退回最新版冒充。U8：有未保存修改时点引用先弹三选一确认（保存并看 / 放弃修改直接看 / 继续编辑），保存后自动接着打开刚才那条引用。
- **模板管理**：`api.ts` 早有增删改，界面零入口。按 U1 裁决放进设置页（提示词/Skill 属模板高级配置）：五类分栏、每类 body 按「每行一条」编辑而非手写 JSON、校验以后端 `templates.validate_body` 为准、删除二次确认。实测创建→v1、编辑→v2、删除均通过，测试数据已清理。
- **report 模板生效**：此前是死代码——`templates.py` 有 kind 与种子，`tasks.py` 的 `_research` 只认 `kind == "research"`，report 模板永远不被读取。改为 research 运行读 `outline` + `required`，`_research_draft` 同口径，任务页模板下拉在研究运行时也列出 report 模板。实测产出章节正是模板定义的四节。
- **会话闭环**：`add_message` 支持 `role="assistant"` 但从未被调用，会话里永远只有提问。`_execute` 成功时写摘要消息（类型/命中数/是否模型给结论/引用越界数/成果 id），失败时也写「本次运行失败：<原因>」。回写失败不把已完成的运行拖成失败。实测两条路径都正确落库。
- 验证：`tsc --noEmit` 无输出；`bash launch.sh` 全流程通过；`test_app_http.py` / `test_attach_text.py` / `test_templates_http.py` 全 PASS；`check_rules.py` 0 新增错误；`test_check_rules.py` 15/15 OK。证据面板与模板管理用 headless Chromium + CDP 实测点击链路（高亮切换、自动滚动、确认框三选项、模板增删改）。
- **已知未通过**：`tests/test_runs_http.py` 的 extract 用例连续 3 次失败，报「模型返回的提取结果不是合法 JSON」。已核对代码对 `result.truncated` 有正确处理并如实报错、不静默产出空结果，属上游模型输出截断，与本地改动无关（`tasks.py` 只改了 `_sources_block` 与本次两处）。按规范停止重试。

## 未决问题与下一步

- **`Scope` 是单值**：不支持「同时选多个库」这种范围表达。改动波及 `models.py` / `retrieval.py` / `tasks.py` 的运行冻结结构与前端选择器，属产品取舍，未做。
- **验证产物留在库里**：`task_467fc71104f0`、`art_c3bd9cd9d225`、`art_c86e1130f5d5` 等是本次实测产物。后端没有删除任务的接口，无法自动清理；它们同时是「report 模板生效」「会话回写」的可复查证据。
- **不封装 MinerU 调用**：用户自己跑解析，heli 只认产物。
- **安全（已处理历史，仍需用户吊销 key）**：`.env.example` 曾写入真实 `DEEPSEEK_API_KEY`，随本地提交 `b49660d` 进入历史。该提交当时尚未推送，已在本地重写历史把该行清为空值后再推送，远端从未收到过这个密钥。**旧 key 仍需到 DeepSeek 控制台吊销**。
- 工作区有并行的设计令牌优化（`globals.css` 文字层级与对比度、`ui.tsx` 排版微调、`Markdown.tsx` 标题层级、`KnowledgeView` / `LibraryView` 若干样式），非本轮改动，未动。
- `.logsdev/ref-strata-three-layers-20261017.md` 状态已废且未被引用，脚本只给警告；是否删除待定。
