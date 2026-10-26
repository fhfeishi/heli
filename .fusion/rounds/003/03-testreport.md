# Test report — round 003

日期：2026-10-27
来源：用户派发的 verifier 任务；[本轮 brief](01-brief.md)、[engineer worklog](02-worklog.md)、[round 002 testreport](../002/03-testreport.md)，以及当前工作区差异与独立检查
状态：现行（过）

## 方案审核

通过。brief 已明确裁定保留显式 `/knowledge?view=card`，授权修正旧断言和注释，解决 round 002 提出的范围冲突。该要求与 [router.tsx](../../../heli-web/src/app/router.tsx) 第 23–27 行既有行为一致；实现仅更新检查脚本两行，没有通过修改产品路由来消除失败。无需再次升级 brief。

验证针对三种失败方式：期望仍错误或检查失败、注释仍误导、越界修改产品行为。分别用脚本与 router 对照、独立执行三项工程检查、Git 差异及前轮记录核对取证；任一检查非零或发现越界产品改动均不能判过。

## 对照验收表

| 验收标准 | 结果 | 证据 |
|---|---|---|
| card 期望与 router 一致（`/knowledge?view=card`） | 通过 | [check-routes.mjs](../../../heli-web/scripts/check-routes.mjs) 第 91 行期望为 `/knowledge?view=card`；router 第 26–27 行保留显式视图查询串。独立运行输出 `PASS Paths.knowledge(card)`。 |
| 注释不再声称 card 省略查询串 | 通过 | 检查脚本第 89 行改为「显式选择的视图写进 URL（三种都一样），不传视图才省略」，与 router 第 23–27 行一致。 |
| typecheck、build、check:routes 均退出 0，worklog 贴退出码 | 通过 | worklog 第 30–34 行逐项记录 0；verifier 独立执行三项命令全部成功，详见下表。 |
| 未改 KnowledgeView / GroupStack；未改路由产品行为 | 通过（当前差异及交接记录，历史证据边界见下文） | 检查脚本相对 HEAD 仅注释及 card 期望两行变化；`git diff --exit-code HEAD -- heli-web/src/app/router.tsx heli-src` 退出 **0**。当前 KnowledgeView 差异仅 GroupStack 与 groupName 调用，范围与 round 002 报告第 22 行及本轮 worklog 第 42 行记录一致；未发现本轮扩展至书架 P2、API 或后端的差异。 |
| 未提交 git | 通过（可观察记录） | 当前 HEAD 仍为前轮报告所记 `62f6e4ec107525910ddebdb4b05ea42a2889a7ee`；检查脚本与 KnowledgeView 仍为未暂存修改，`.fusion/` 未跟踪，暂存区为空。最近 reflog 未见本轮新增提交；verifier 未执行提交。 |

## 独立检查

在仓库的 `heli-web` 目录执行 `npm run typecheck && npm run build && npm run check:routes`。命令链退出 **0**，三个命令均正常结束；`&&` 链及最终退出码共同确认各项退出码为 **0**。

| 命令 | 退出码 | 关键结果 |
|---|---|---|
| `npm run typecheck` | **0** | `tsc --noEmit` 无错误。 |
| `npm run build` | **0** | `tsc --noEmit && vite build` 成功；46 modules transformed，built in 730ms；生成 `dist/index.html`、`index-CKnx2lfS.css`、`index-Bq5dz3YP.js`，与 worklog 记录的产物名称一致。 |
| `npm run check:routes` | **0** | **28 PASS / 0 FAIL**，末行为 `ALL PASS`；包含 `Paths.knowledge()`、`Paths.knowledge(card)`、`Paths.knowledge(shelf)`。 |
| `git diff --check`（仓库根目录） | **0** | 无空白错误。 |
| `git diff --cached --exit-code`（仓库根目录） | **0** | 暂存区为空。 |

## 问题清单

未发现阻断项，也未发现需打回 engineer 的实现缺陷。round 002 问题 1 的旧路由断言失败已消除，原有其余 27 项检查仍通过。

非阻断的证据限制：本轮开始时没有逐文件快照，不能仅凭当前 Git 差异严格证明 KnowledgeView 在两轮之间从未被编辑；归属判断采用前轮报告、本轮交接记录及当前差异范围，未把整个仓库 diff 误称为仅两行。HEAD 与 reflog 支持“未见本轮提交”，不用于证明无法观察的全部历史操作。

## 检查范围与结论

本次未运行浏览器：本轮仅修正检查期望与注释，router 无差异，brief 明确允许以工程检查验收；未发现需要浏览器追查的路由回归迹象。round 002 的 UI 验收沿用其报告，本轮不声明重新验证了叠卡 UI。未新增测试或修改实现；verifier 仅写本报告，未改 brief、worklog、检查脚本及其他源码，未提交 git。按用户指定将报告保留在 `.fusion/rounds/003/03-testreport.md`。

- [x] 过
- [ ] 打回 engineer
- [ ] 升级 brief

本轮五项验收满足，round 002 遗留的三项工程检查未全绿阻断已闭合；无需 engineer 补实现或 brief 再作范围裁定。
