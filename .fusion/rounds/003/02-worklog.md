# Work log — round 003

日期：2026-10-27
来源：用户派发的 engineer 任务；[本轮 brief](01-brief.md)、[round 002 testreport](../002/03-testreport.md)，工作目录 `heli` 仓库根
状态：本轮范围已完成，待 verifier 复验

## 本轮范围理解

按 brief：只对齐路由检查与既有实现。`Paths.knowledge("card")` 的产品行为（显式写 `?view=card`）保持不变，
修正 `check-routes.mjs` 的过期期望值与该行上方注释，使三项工程检查退出码为 0。未改 router、KnowledgeView、GroupStack、API 或后端，未提交 git。

## 改动表

| 文件 | 位置 | 改动 | 说明 |
|------|------|------|------|
| `heli-web/scripts/check-routes.mjs` | 第 89 行注释 | `默认视图不进 URL，非默认才带 ?view=` → `显式选择的视图写进 URL（三种都一样），不传视图才省略` | 旧注释与 [router.tsx](../../../heli-web/src/app/router.tsx) 第 23–27 行的实际行为相反；新注释与实现一致 |
| `heli-web/scripts/check-routes.mjs` | 第 91 行断言 | 期望值 `/knowledge` → `/knowledge?view=card` | 与 `Paths.knowledge` 的 `?view=${view}` 拼接一致；`Paths.knowledge(shelf)` 项原本已通过，未动 |

只读对照，未修改：

- `heli-web/src/app/router.tsx` 第 22–27 行：`knowledge: (view?) => \`/knowledge${view ? \`?view=${view}\` : ""}\``，注释明确写「三种都写进 URL」，并说明省略 card 会导致点「卡片」落回书架。检查断言的旧期望正是这段注释所否定的行为。
- `heli-web/src/app/router.tsx` 第 79–112 行 `parse`：查询串原样进 `search`，`href` 为 `pathname + ?search`，显式视图 URL 可往返还原。

diff 仅涉及上述 2 行（`git diff --stat`：`heli-web/scripts/check-routes.mjs` 2 insertions / 2 deletions，注释与断言各一），`git diff --check` 退出码 **0**。

## 自测

在 `heli-web` 下依次执行，命令与退出码：

| 命令 | 退出码 | 结果 |
|------|--------|------|
| `npm run typecheck` | **0** | `tsc --noEmit` 无输出 |
| `npm run build` | **0** | `tsc --noEmit && vite build`；46 modules transformed，产出 `dist/index.html`、`index-CKnx2lfS.css`、`index-Bq5dz3YP.js`，built in 798ms |
| `npm run check:routes` | **0** | 28 项全部 `PASS`，末行 `ALL PASS`；其中 `PASS Paths.knowledge(card)`（`?view=card`）、`PASS Paths.knowledge()`（`/knowledge`）、`PASS Paths.knowledge(shelf)`（`?view=shelf`） |

改动前基线（round 002 verifier 记录，本工作区未重跑旧版）：`check:routes` 为 27 PASS / 1 FAIL，唯一失败即第 91 行期望值。本次仅改期望与注释，其余 27 项断言未动，因此失败项转 PASS、无新增失败。

## 偏差

无。未改验收标准，未扩大范围，未碰 `KnowledgeView.tsx` / `GroupStack` / `router.tsx` / API，未 `git commit`。

残留差异说明（非本轮改动）：`git status --short` 仍显示 `M heli-web/src/views/KnowledgeView.tsx` 与未跟踪的 `?? .fusion/`，属 round 002 遗留的未提交工作区状态，本轮未触碰。

## 是否可测

可测。三项工程检查均可在 `heli-web` 直接复跑（`npm run typecheck`、`npm run build`、`npm run check:routes`），验收所需的退出码与逐项 PASS 输出来自本轮实际执行，非引用旧记录。路由检查入口只打包 `src/app/router.tsx`，不依赖 `KnowledgeView`，因此该检查结果可独立复现。

浏览器非本轮必需（brief 明确以工程检查为主）；本轮未启动 dev server、未用 ego-browser，路由产品语义未改，不存在需要浏览器确认的行为变更。若 verifier 需要，可在 `/knowledge?view=card` 确认显式 URL 行为与此前一致。
