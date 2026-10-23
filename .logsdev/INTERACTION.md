# Current Interaction

- 更新时间：2026-10-20。现行要求见 [PROJECTION.md](PROJECTION.md)，用户原文见 [query.md](query.md)。
- 上一轮（扫描件接 MinerU）的接续记录已收口：全文在提交 `984ba51` 的 `INTERACTION.md`，本地可读 `.logsdev/archive/2026-10-20-节点/INTERACTION.md`；其中的完成声明与「下一步」只代表写作时点。

## 当前目标

资料库卡片与资料入库做深：卡片回答「选哪个库」，入库看得见进度与失败原因。

## 进展与依据

- **卡片缺陷（已修）**：`IconButton` 的 `onClick` 没拦事件，点「加入分组 / 归档」会连带触发外层 `article` 的导航，直接跳进资料库。已加 `stopPropagation`。
- **卡片重做**：底部信息按「要不要进去」重排——只留「N 份待解析」与「N 天前更新」；全部可检索时不再重复写一遍（上方 100% 与绿色进度条已说过）。归档改为二次确认（原先单击即归档，会把整库及资料退出检索，不可撤销）。`list_libraries` 补回 `created_at`/`updated_at` 供相对时间使用。
- **组背景（后端早有、前端一直没接）**：`api.ts` 补 `groupBackground`/`setGroupBackground`；组菜单加「组背景」入口与内联编辑；`list_groups` 返回 `background`，组头显示「有背景」标记——否则写了也看不出来。
- **资料入库**：`POST /sources` 之前默认 `parse_pdf=True`，与 cli 导入口径（`parse_pdf=False`，注释写明 pypdf 单份要几十秒）相反，界面串行导入多份 PDF 会被拖死。改为默认关闭、`?parse_pdf=1` 显式开启。导入失败原先只数「N 份失败」，现在逐份记录文件名与原因并列出。
- **新增 `POST /api/sources/<id>/reparse`**：单份重试解析，只对「仅登记」有效（已可检索返回 409）。前端在文件列表与阅读区都给了入口，不必去命令行跑 `cli.py reparse`。
- **无正文资料**：选中「仅登记」资料时，右侧给出状态解释与补救入口，不再只报一句「没有可读正文」。
- 验证：`tsc --noEmit` 无输出；`bash launch.sh` 全流程通过；四份测试脚本全 PASS；`check_rules.py` 0 新增错误；`test_check_rules.py` 15/15 OK。界面用 headless Chromium 截图核对卡片、书架、库内页与「仅登记」面板；`reparse` 用真实数据实测：已索引返回 409、扫描件重试后仍 `registered` 并显示「重试后仍没有可提取的文本」；组背景写入/读取/列表回显实测通过，测试数据已清空复原。

## 未决问题与下一步

- **右侧面板与可点击引用（U6/U8 欠账）**：成果页引用仍是静态 `div`，运行记录只有「引用 N 条」计数；没有公共 Inspector。这是「以证据连接成果」定位的核心缺口，下一轮优先。
- **模板管理界面**：`api.ts` 有增删改，界面没有；`report` 模板后端有种子但无任何运行消费。
- **会话闭环**：`add_message` 只存用户消息，运行结果只进成果、不回写会话；`Scope` 是单值，不支持多库选择。
- **不封装 MinerU 调用**：用户自己跑解析，heli 只认产物。
- **安全（已处理历史，仍需用户吊销 key）**：`.env.example` 曾写入真实 `DEEPSEEK_API_KEY`，随本地提交 `b49660d` 进入历史。该提交当时尚未推送，已在本地重写历史把该行清为空值后再推送，远端从未收到过这个密钥。**旧 key 仍需到 DeepSeek 控制台吊销**。
- 工作区有并行的设计令牌优化（`globals.css` 文字层级与对比度、`ui.tsx` 排版微调、`ResearchView` 窄屏换行），非本轮改动，未动。
- `.logsdev/ref-strata-three-layers-20261017.md` 状态已废且未被引用，脚本只给警告；是否删除待定。
