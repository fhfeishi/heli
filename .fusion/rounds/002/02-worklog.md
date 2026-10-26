# Work log — round 002

## 对照 brief

- Brief：round 002 / P1 GroupStack
- 本轮是否按步骤做完：P1 五项已落码并完成工程检查与浏览器实测；**唯一未通过项**是 `npm run check:routes`
  在改动前就有的 1 条断言失败（详见「自测痕迹」「偏差」），非本轮引入，本轮未改路由与检查脚本。
- 只改 `heli-web/src/views/KnowledgeView.tsx`；未提交 git；临时测试组已从库里删除。

## 改动

| 文件 | 做了什么 |
|------|----------|
| `heli-web/src/views/KnowledgeView.tsx`（第 310–316 行） | 新增叠卡几何具名常量：`STACK_CARD_HEIGHT = 104`、`STACK_LAYER_OFFSET = 11`、`STACK_LAYER_INSET = 6`、`STACK_MAX_VISIBLE = 3`。容器高度改为 `STACK_CARD_HEIGHT + STACK_LAYER_OFFSET * (visible.length - 1)`，去掉原先写死的 `+ 6` 余量，1 层不留白、层间距一致。 |
| 同上（第 318–324 行） | 新增 `STACK_LAYER_LIFT`：顶卡 / 中层在 `motion-safe` 下 hover 与 `focus-visible` 分别位移 -3px / -1px，底层只做边线与阴影变化；类名以完整字面量写出，避免 Tailwind 扫不到。 |
| 同上 `GroupStack` 签名（第 335–345 行） | 增加 `groupName: string`，由 `renderGroup` 传入；`aria-label` 改为 `展开分组「<组名>」，共 N 个资料库`。按钮保留单一 Tab 停靠点，焦点环 `focus-visible:outline-2 outline-offset-2 outline-primary`。 |
| 同上层序（第 364–377 行） | 层序改为 `depth = index`：`members[0]` 在顶层（`zIndex 10`、`top 0`），后续层 `top +11px`、左右各内收 `6px`、`zIndex` 递减；可见层数 `min(members.length, 3)`，第 4 个及以后只进入总数，不生成 DOM 层。 |
| 同上层内容（第 384–400 行） | 仅顶卡渲染短名与 `indexed_count / source_count`；后层设 `aria-hidden` 且不渲染文字，避免读屏重复。顶卡底部文案改为 `共 N 个资料库 · 点击展开`，删除旧的「另 M 个」重复计数；长名继续单行 `truncate`；卡片加 `overflow-hidden`。 |
| 同上样式（第 378–382 行） | 顶卡 `border-hairline-strong` + 较大阴影，后层 `border-hairline` + 更轻阴影；整叠 hover/focus 时顶卡阴影加深、后层边线加深，后层仅小幅跟随。过渡为 `transition-[translate,box-shadow,border-color] duration-200 ease-panel`，并加 `motion-reduce:transition-none`；位移本身只在 `motion-safe` 下生效。 |
| 同上 `renderGroup` 调用（第 1537–1542 行） | 传入 `groupName={group.name}`；挂载条件、`toggleGroup`、搜索强制展开、拖放目标、组菜单均未改。 |

合计：1 个文件，+57 / −31 行（`git diff --numstat`）。

## 自测痕迹

### 工程检查（`cd heli-web`）

| 命令 | 退出码 | 说明 |
|------|--------|------|
| `npm run typecheck` | **0** | `tsc --noEmit` 无输出。 |
| `npm run build` | **0** | `tsc --noEmit && vite build`；`dist/assets/index-CKnx2lfS.css 58.28 kB`、`index-Bq5dz3YP.js 351.96 kB`。 |
| `npm run check:routes` | **1** | 27 项 PASS，1 项 FAIL：`Paths.knowledge(card)` got `/knowledge?view=card`，want `/knowledge`。**改动前基线同样失败**（见下）。 |

`check:routes` 基线核对：用 `git worktree add /tmp/opencode/heli-head HEAD`（HEAD = `62f6e4e`）跑同一脚本，
结果同样是这一条 FAIL、退出码 1。原因在 `heli-web/src/app/router.tsx` 第 26–27 行：commit `e5aba13`
把三种视图都写进 URL（`Paths.knowledge("card") => "/knowledge?view=card"`），而
`check-routes.mjs` 第 91 行仍断言 card 省略查询串。该断言属于既有回归脚本与既有路由实现的
不一致，不在 brief 授权范围（brief 明写不改路由），本轮**未修改**脚本或路由；如需要修，应由 brief
确认后单独处理（把第 91 行期望值改为 `/knowledge?view=card` 即可，代码已验证可行）。
工作区核对：`git diff --name-only` 只有 `heli-web/src/views/KnowledgeView.tsx`，`git status --short`
只有它加未跟踪的 `.fusion/`。

### 浏览器实测（ego-browser，Chromium 156，`http://127.0.0.1:8788`，`?view=card`）

用真实服务 + 临时测试组覆盖 1 / 2 / 3 / 4 / 5 / 11 成员与长中文名。临时组 `zz-temp-stack2`（2）、
`zz-temp-stack5`（5）、`zz-temp-longname`（长名 + 0 可检索库）、`zz-temp-n3`（3）、`zz-temp-n4`（4）
已全部 `DELETE`，库里只剩原有 3 个组（自然科学基金 11 / Bots 1 / fhfeishi 1）；
服务已 `bash launch.sh --stop`，8788 端口已释放。

| 验收点 | 结果 | 实测证据 |
|--------|------|----------|
| `groupName` + 读屏名称含组名与总数 | 通过 | 11 成员组读屏名 `展开分组「自然科学基金」，共 11 个资料库`；1 成员组为 `…「Bots」，共 1 个资料库`；`tabIndex=0`，整叠只有 1 个 `button`。 |
| 顶层是 `members[0]` | 通过 | 组内首位库 `自然科学基金-AI与材料` 出现在 `z-index 10 / top 0` 层；`z-index 9 / 8` 两层 `aria-hidden=true` 且无文字。对照 API 成员顺序 `lib_7b6935af654d` 排第一。 |
| 最多 3 层；N≥4 与 N=3 同高；文案无重复 | 通过 | **N=3 与 N=4 直接对比**：都是 3 层 DOM、`gridH / stackH` 均 126px；11 成员组同样 3 层 126px；2 成员组 2 层 115px；1 成员组 1 层 104px。顶卡文案 `共 N 个资料库 · 点击展开`（4 成员组为 `共 4 个资料库`），无「另 M 个」。 |
| hover 不改文档流；减少动态无位移 | 通过 | 桌面 hover 前后 `stackH=126`、`sectionH=177` 不变，仅顶卡 `translate 0px -3px`、中层 `0px -1px`、底层 `none`，阴影 / 边线同步加深。模拟 `prefers-reduced-motion: reduce` 后三层 `transition-property: none`、`translate: none`，点击仍能展开（2 张卡出现）。 |
| 标题 / 菜单键盘可达；叠卡单控件 | 通过 | 从组标题按 Tab 依次到「组操作」→ 叠卡按钮（`outline 2px solid`，`topLayerTranslate 0px -3px`）；`Enter` 与 `Space` 均把 `aria-expanded` 由 `false` 变 `true` 并渲染 5 张卡片；组标题按钮的 `aria-expanded` 独立随状态更新。 |
| 长名 / 0 资料不溢出 | 通过 | 390px 与 1588px 下长中文名 `scrollW 459 / clientW 347`（截断生效）、长英文名 `558 / 347`，均未越过卡片内边界，`documentElement.scrollWidth == clientWidth`。 |
| 390px / 桌面无横向溢出 | 通过 | 390px 与 1588px 各成员数下 `docScrollW == clientW`（390 / 1588）；截图 `narrow-390.png`。 |
| 展开后仍是原卡片网格、库卡导航正常 | 通过 | 展开后渲染 11 张（11 成员组）/ 5 张（5 成员组）`article[role=link]`；点 5 成员组首张库卡进入该库页面（库名 `自然科学基金-AI与农业`）；书架 `?view=shelf`、列表 `?view=list` 下同一叠卡也能展开且 URL 视图不变。 |

截图（Windows 侧，供 verifier 复核）：`C:/Users/10354/ego/heli-stack-20261026/desktop-collapsed.png`、
`desktop-expanded.png`、`narrow-390.png`、`stack-longname-390.png`、`stack-longname-1588.png`。
过程脚本同目录 `round-01.mjs` … `round-22.mjs`。

**测量方法限制（如实记录）**：本轮 ego 浏览器里由 `:hover` / `:focus-visible` 触发的 `CSSTransition`
一直停在 `currentTime: 0`（同一页面内用 `requestAnimationFrame` 触发的定位探针能正常跑完 200ms），
所以 `getComputedStyle().translate` 读到的是起始值 `0px`。因此 hover / 键盘的**终态**是在页面内临时
注入 `*{transition:none}` 后读取的；另有一次未注入的采样，确认 hover 确实创建了
`CSSTransition(translate, 200ms)`、`--tw-translate-y` 已经是 `-3px` / `-1px`、阴影过渡也已启动。
也就是说「终态值与不改变布局」有实测，**过渡过程的逐帧观感**只有类名 / 计算样式层面的证据；
如果这也是渲染窗口可见性导致的，建议 verifier 在可见窗口下补一次连帧观察。

## 相对 brief 的偏差

1. **`check:routes` 未通过（既有问题，非本轮引入）**：见上表，改动前基线即同一条 FAIL。brief 验收
   要求该命令通过且贴退出码，这里只能如实写 `退出码 1`。本轮没有改路由、也没有改回归脚本以「做绿」。
   需要 brief / verifier 决定是否授权单独修 `check-routes.mjs` 第 91 行的过期期望值。
2. **容器高度去掉了原 `+ 6` 余量**：brief 要求「1 层无多余底部留白」「高度由卡高、可见层数和纵向间距
   计算」，所以按三项常量严格计算（1 层 = 104px）。原实现多留 6px 属于前一轮的观感余量，本轮按 brief 收敛。
3. **hover 位移从「顶卡 -4px」收敛为「顶卡 -3px、中层 -1px、底层不动」**：brief 要求后层做更小的跟随，
   原实现只有顶卡动；数值仍按 200ms 与既有 `--ease-panel` 收敛，属 brief 授权范围内的参数选择。
4. **未改 `LibraryCard / LibrarySpine / LibraryRow / 路由 / API / 后端**；未新增依赖；未提交 git。
5. 浏览器测试为覆盖 1 / 2 / 5 成员与长名，临时新建了 3 个组并通过 `PUT /members` 挂现有库，测完已删除；
   未新增或改动任何资料库数据。

## 反馈

- 给 brief：
  - 请确认 `check:routes` 的处置：这是 `e5aba13`（「卡片」视图写进 URL）后留存的过期断言，与本轮
    叠卡改动无关。授权后一行即可修正（`/knowledge?view=card`），或明确本轮接受「基线已有失败、不阻断」。
  - 叠卡顶部文案从「点开看这 N 个库 / 另 M 个」改为「共 N 个资料库 · 点击展开」后，视觉上比原句略长；
    390px 下仍在 268px 卡片内不截断，若后续要更短可改为「共 N 个 · 点击展开」。
- 给 verifier：
  - 建议重点复核：hover 到后层时是否出现层间跳动（本轮只在叠卡容器取 hover 状态，单层不各自响应）；
    `prefers-reduced-motion` 下的焦点反馈（保留描边、无位移）；以及 11 成员 / 5 成员组在 390px 的
    纵向节奏是否与相邻组冲突。
  - `check:routes` 的 1 条 FAIL 有基线复现路径（HEAD worktree 同跑），请按「既有问题」而非本轮回归判定。

## 是否可测

- [x] 可以按验收标准测了
- 备注：`check:routes` 一项请按上面的基线证据判断是否为阻断项。
