# Brief — round 003

## 背景

Round 002 叠卡 P1 已实现并通过独立 UI 复验；verifier 结论为 **升级 brief**（见 `../002/03-testreport.md`）。
阻断项：`npm run check:routes` 退出码 1——`Paths.knowledge(card)` 实际 `/knowledge?view=card`，断言仍期望 `/knowledge`。该失败在 HEAD 已存在，与 GroupStack 无关；router 显式三视图 URL 是既有产品行为。

## 本轮优先

裁定并落地 **路由检查与实现一致**：保留显式 card URL；修正过期断言（及过期注释），使三项工程检查全绿，从而闭合 round 002 验收。

## 本轮范围

- **做**：改 `heli-web/scripts/check-routes.mjs`（期望值与第 89 行附近注释），使 `Paths.knowledge("card")` 期望 `/knowledge?view=card`；必要时核对 `router.tsx` 注释与行为一致，**不改**产品路由语义。
- **不做**：不改 GroupStack / KnowledgeView；不改 API / 后端；不扩大到书架 P2；不提交 git。

## 实施步骤

1. 读 `../002/03-testreport.md` 问题 1 与 `heli-web/src/app/router.tsx`、`heli-web/scripts/check-routes.mjs`。
2. 更新断言与注释，保留显式 card URL。
3. `cd heli-web && npm run typecheck && npm run build && npm run check:routes`（三项退出码均须 0）。
4. 写 `02-worklog.md`。

## 验收标准

- [ ] `check-routes.mjs` 中 card 期望与 router 一致（`/knowledge?view=card`）
- [ ] 注释不再声称 card 省略查询串（若曾如此写）
- [ ] `npm run typecheck`、`npm run build`、`npm run check:routes` 退出码均为 **0**（worklog 贴退出码）
- [ ] 未改 KnowledgeView / GroupStack；未改路由产品行为（仅对齐检查）
- [ ] 未提交 git

## 约束

- 禁止：为「做绿」而改回省略 card 查询串的产品行为
- 禁止：扩大范围到叠卡视觉返工（002 已过 UI）
- 浏览器：本轮以工程检查为主；verifier 可不强制 ego-browser，除非怀疑路由回归

## 交接给 engineer

入口：`heli-web/scripts/check-routes.mjs`（约第 89–91 行）与只读对照 `heli-web/src/app/router.tsx`。
