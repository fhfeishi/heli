# Brief — round 002

## 背景

承接 round 001（方案已过审）。产品愿景见 `../001/01-brief.md`。Verifier 非阻断备注见 `../001/03-testreport.md`。

## 本轮优先

实施 **P1 卡片叠卡增强**：只改 `heli-web/src/views/KnowledgeView.tsx` 内 `GroupStack` 及其在 `renderGroup` 的调用；附带收敛叠卡几何常量。不实施书架 hover，不改 API / 后端。

## 本轮范围

- **做**：按 round 001 brief「P1 — 卡片叠卡增强」五条落地；并把现状层序改为 **`members[0]`（第一个成员）在顶层**（纠正现有最后一个在顶的实现）。
- **不做**：不改 `LibraryCard` / `LibrarySpine` / `LibraryRow`（除非验收证明必须）；不改路由；不新开动画库；不提交 git。

## 实施步骤

1. 读 `../001/01-brief.md` 的 P1 清单与 `../001/03-testreport.md` 问题 1、3。
2. 改 `GroupStack`：增加 `groupName`；顶层 `members[0]`；最多 3 层；几何具名常量；顶卡文案无「另 M」；整叠 hover；`motion-reduce` 降级；叠卡单控件且保留标题/菜单键盘入口。
3. `renderGroup` 传入 `groupName={group.name}`。
4. 自测：`cd heli-web && npm run typecheck && npm run build && npm run check:routes`。
5. 写 `02-worklog.md`。

## 验收标准

- [ ] `GroupStack` 有 `groupName`；读屏名称含组名与库总数
- [ ] 顶层是第一个成员（`members[0]`），不是最后一个
- [ ] 可见最多 3 层；N≥4 时高度与 N=3 同高；文案总数为 N 且无「另 M」重复
- [ ] hover 不改变文档流高度；减少动态时无位移
- [ ] 标题按钮 / 组菜单仍可键盘到达；叠卡自身单一控件
- [ ] `npm run typecheck`、`npm run build`、`npm run check:routes` 通过（worklog 贴退出码）
- [ ] 未改 heli-src / API；diff 主要在 KnowledgeView.tsx

## 约束

- 禁止：扩大到书架 P2；改验收标准；未经说明的大重构
- 浏览器实测可由后续 verifier + **ego-browser** 补；engineer 至少完成工程检查

## 交接给 engineer

入口：`heli-web/src/views/KnowledgeView.tsx` 的 `GroupStack` 与 `renderGroup` 调用处。详细清单见 round 001 brief P1。
