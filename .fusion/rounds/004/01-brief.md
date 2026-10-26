# Brief — round 004

## 背景

Goal 全貌见 `../001/01-brief.md`。P1 叠卡（002）与 check:routes 对齐（003）已过。本轮实施 **P2 — 书架书脊到书面**，闭合背景 goal 中书架视图部分。

## 本轮优先

在现有 `LibrarySpine` 的抽出 / 转封面机制上：补书面最小信息集（含最近更新时间），收敛 hover / focus 过渡，尊重 `prefers-reduced-motion`。

## 本轮范围

- **做**：改 `heli-web/src/views/KnowledgeView.tsx` 内与书架相关的 `LibrarySpine` / `renderLibraries`（及确有必要的紧邻辅助）；书面展示：**资料库名称、资料总数、可检索数、最近更新时间、年份跨度（无则省略）**；组色沿用现有 `hue`。
- **不做**：不重写书架；不引入新 3D / 动画库；不改 API / 后端 / 路由产品语义；不回改已过审的 GroupStack；不提交 git（由主人侧统一提交）。

## 实施步骤

1. 读 `../001/01-brief.md` 的 P2 与「书架书面的最小信息集」；读现有 `LibrarySpine` 实现与 `pointer-events` 命中区注释/风险。
2. 补书面字段展示；收敛 hover/focus；减少动态时降级位移但保留可读信息与进入单库能力。
3. 自测：`cd heli-web && npm run typecheck && npm run build && npm run check:routes`（三项须 0）。
4. 浏览器（可用 ego-browser）：书脊→书面不反复收回；键盘可触发同等信息与进入单库；390px / 桌面无严重溢出。
5. 写 `02-worklog.md`。

## 验收标准

- [ ] 书面展示名称、资料总数、可检索数、最近更新时间及可选年份跨度，数据来自现有 `Library`
- [ ] 鼠标从书脊移到书面不反复收回；键盘可触发同等信息与进入单库
- [ ] 命中区已处理封面原 `pointer-events-none` 风险：不把封面做成第二套混乱导航
- [ ] `npm run typecheck` / `build` / `check:routes` 退出码均为 0
- [ ] diff 主要在 KnowledgeView 书架相关；未改 GroupStack 已过审行为（除非为修回归的最小必要）
- [ ] 未提交 git

## 约束

- 禁止：与叠卡 P1 无关的大重构；伪造封面图/标签字段
- 技术栈：现有 React 19 + TS + Tailwind 4

## 交接给 engineer

入口：`KnowledgeView.tsx` 的 `LibrarySpine`、`renderLibraries`。对照 round 001 brief P2。
