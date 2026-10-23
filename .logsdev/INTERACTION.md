# Current Interaction

- 更新时间：2026-10-20。现行要求见 [PROJECTION.md](PROJECTION.md)，用户原文见 [query.md](query.md)。
- 上一轮（扫描件接 MinerU）的接续记录已收口：全文在提交 `984ba51` 的 `INTERACTION.md`，本地可读 `.logsdev/archive/2026-10-20-节点/INTERACTION.md`；其中的完成声明与「下一步」只代表写作时点。

## 当前目标

修好 `bash launch.sh` 启动失败，并让规则检查与校验器测试回到可交付状态。

## 进展与依据

- **启动失败根因**：`launch.sh` 构建前跑 `tsc --noEmit`，一报错即 `die`。`KnowledgeView.tsx` 给 `LibraryCard` 新增了必填 prop `contextHue`（卡片顶部领域色沿），调用处漏传 → `TS2741`。已在 `renderLibraries` 里按 `contextGroupId` 查出所属组 `hue` 后传入，未分组为 `null` 由卡片回退纸色。
- **`--stop` 后重启漂端口**：`port_busy()` 用裸 `bind` 探测，而服务端 `ThreadingHTTPServer` 开了 `allow_reuse_address`，服务刚停留下的 TIME_WAIT 被误判为「被占用」，于是每次重启都往后换端口，极端情况连跳 20 个后放弃。改为统一 `port_busy()`：先 `connect` 判真实监听，再分别用「不重用 / 重用」两种方式 bind；`--stop` 里的重复内联探测也改为调用它（原 `&& break` 与函数语义相反）。
- **校验器测试 13/15 失败**：`test_check_rules.py` 的 `PARTS` 只复制 `AGENTS.md`、`CLAUDE.md`、`.agents`、`.logsdev`，但真实载体链接到 `../.knowledge/README.md`、`../scripts/README.md`、`../README.md`，临时树里这些文件不存在，于是所有「应通过」用例都变死链失败。补进夹具并让缺失项跳过；另两处夹具与载体内容脱节：锚点用例指向已不存在的 `#已确认要求`（现为 `#当前有效要求`），`external()` 删掉 PROJECTION 后没清理 `INTERACTION.md` 对它的链接。
- **README 死链**：`library-platform-top-level-design.md` 已重命名为 `-20261018` 版，README 链接未跟改，已修。
- 验证：`tsc --noEmit` 无输出；`bash launch.sh --no-open` 全流程通过；`/api/health` 返回 `{"ok": true}`、`/` 返回 200；连续三轮「启动 → `--stop` → 再启动」稳定落在 8788（修复前漂到 8792/8793）；重复启动保护与真实占用回退仍有效；`tests/test_app_http.py`、`test_attach_text.py`、`test_templates_http.py`、`test_runs_http.py` 全 PASS（后两个需 `env -u http_proxy`，否则系统代理把本机请求劫成 502）；`check_rules.py` 0 新增错误；`test_check_rules.py` 15/15 OK。

## 未决问题与下一步

- **不封装 MinerU 调用**（上轮遗留，仍有效）：用户自己跑解析，heli 只认产物。若希望导入时直接调 MinerU，需先确定它跑在哪一侧、输出到哪。
- UI 暂不标注「正文来自 MinerU」；`locator` 已在数据里，前端需要时读即可。
- **安全（已处理历史，仍需用户吊销 key）**：`.env.example` 曾写入真实 `DEEPSEEK_API_KEY`，随本地提交 `b49660d` 进入历史。该提交当时尚未推送，已在本地重写历史把该行清为空值后再推送（重写后 `main` 全历史已不含该串），远端从未收到过这个密钥。模板现在只有空值，真实 key 只在被忽略的 `.env`。**旧 key 仍需到 DeepSeek 控制台吊销**：它曾以明文存在于本机磁盘与历史中，不能假设未泄露。
- `.logsdev/ref-strata-three-layers-20261017.md` 状态已废且未被引用，脚本只给警告；是否删除待定。
- 更早的开放项与完成记录见节点快照；追溯某一轮结论时按快照中的小节查，不在此重复。
