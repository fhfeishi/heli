# Test report — round 004

结论：**过**。本次独立复验确认 V004-02 已修复，V004-01 保持关闭；六项验收通过，无须升级 brief。普通模式的书面与命中区已避开组标题及统计，三项工程检查均退出 0。

日期：2026-10-27
来源：用户 verifier 派发；本轮 [brief](01-brief.md)、[worklog](02-worklog.md)、[round 001 P2](../001/01-brief.md)；用户本次提供的三张截图。
状态：现行

## 方案审核

方案在本轮范围内可实施。`SHELF_HEADROOM = BOOK_LIFT + COVER_TOP_OVERHANG + 16`，通过书架层板内部 `paddingTop: 71` 为向上抽出预留空间，未改变导航、API 或 GroupStack。修复与原验收一致，无须调整 brief。

## 对照验收表

| 验收项 | 结果 | 核验与证据 |
|---|---|---|
| 名称、总数、可检索数、最近更新、可选年份跨度来自 Library | 过 | `KnowledgeView.tsx:688–709、900–935`：组名顶带与库短名共同呈现库名称，计数、年份直接取 Library，更新取 `relTime(library.updated_at)`；按钮 accessible name 使用全名。本次 13 本 DOM 审计均含必要信息；11 本含年份，Bot-Reports / Aaevum 无年份时省略。截图可见字段。 |
| 鼠标从书脊移到书面稳定；键盘同等信息与进入单库 | 过 | 1600px 首本展开后跨封面按 15px 步长移动，13 个采样宽度均大于 203.5px，无收回；真实 Tab 第 15 步到首本，有 solid 焦点轮廓并展开。focus 保留时 mouseleave、hover 保留时 blur 均保持展开，两者失效后按钮收回至 34px。Enter / Space 分别进入 `/knowledge/lib_7b6935af654d`。 |
| 处理 pointer-events-none 风险，封面无第二套导航 | 过 | 13 本各一个可聚焦入口，封面 `aria-hidden=true`、`pointer-events: none`。展开封面中心的 `elementFromPoint` 命中同一本按钮；390px 第六本普通 / 减少动态两种模式点击封面均进入 `/knowledge/lib_b2f845956862`。 |
| typecheck / build / check:routes 均为 0 | 过 | 本次 verifier 在 `heli-web` 独立执行 `npm run typecheck && npm run build && npm run check:routes`，三项成功、组合退出码 0。build：46 modules，CSS 58.47 kB / JS 353.40 kB；routes：28 项 PASS，末行 ALL PASS。 |
| diff 主要在书架；未改 GroupStack 已过审行为 | 过（工作区可分辨范围） | 本次未暂存业务 diff 仅 `KnowledgeView.tsx`，+181 / −73，集中于 reduced-motion hook、书架常量、LibrarySpine 与 renderLibraries 的层板留白；GroupStack / renderGroup 无未暂存差异。既有暂存的 round 002 / 003 等内容未归作本轮新增。 |
| 未提交 git | 过（现有证据范围） | HEAD 仍为 `62f6e4e`，最近三条 reflog 为此前书架提交；业务变更仍在未暂存 diff，KnowledgeView 状态 MM。本次 verifier 未 stage / commit。 |

补充布局与动效检查：1600px 抽查首本及第 11 本，390px 抽查首排第 1 / 6 本（分别右开 / 左开），普通模式封面和命中区上沿均低于整个组标题栏底边，最小间距 28px。390px 两边位封面均在视口内，`documentElement.scrollWidth = 390`。减少动态下两边位封面为 190×208，书本与封面 transform 均为 none，信息与进入动作保留。

## 问题清单

### V004-01 · 已关闭：鼠标离开覆盖仍有效的键盘焦点

- 当前代码：`KnowledgeView.tsx:695–697` 的 `hovered || focused`，各事件分别维护状态。
- 本次复验：focus=true / hover=false 时封面保持约 203.75×223.06，按钮宽 221；focus=false / hover=true 同样保持展开；两者失效后按钮宽 34。没有回退。
- 历史失败证据：`C:/Users/10354/ego/heli-verifier004-20261027/round-05.mjs`、`focused-collapsed.png`；前次关闭证据位于 `heli-verifier004-recheck-20261027/results-valid.json`。本次以新目录 `round-02.mjs`、`results.json` 为准。

### V004-02 · 已关闭：向上抽出的封面遮挡组标题及统计

- 修复位置：`KnowledgeView.tsx:660–663、1317–1323`，新增 SHELF_HEADROOM 并应用到 `.shelf-board` 顶部内边距。
- 历史失败：修复前桌面封面上沿约 y=221，侵入组标题与统计；旧证据在 `heli-verifier004-recheck-20261027/focus-retained-valid.png`、`390-false-5.png`。当时文件 MD5 为 `50995ce750a34b0a555b0b27f6f1fa66`。
- 当前复验：1600px 标题栏底边 y=263.92，命中区上沿 y=291.92、封面上沿约 y=292.21；390px 标题栏底边 y=445.84，命中区上沿 y=473.84、封面上沿约 y=474.2。两种宽度最小间距均为 28px，封面与按钮均避开标题及统计。
- 视觉证据：本次 `1600-normal-0.png`、`390-normal-5.png`，减少动态对照 `390-reduced-5.png`；三张均已打开检查，与用户本次截图一致。

### 记录偏差 · 不阻断

worklog 主体仍保留修复前的 MD5、+168 / −70 和构建产物名，且称封面标题使用全名；当前源码 `coverTitle = shortName(library.name, series)`，以组名顶带和短名共同呈现名称，accessible name 使用全名。本次依据源码、实际构建和浏览器复验判定通过，不沿用这些过期描述。交接时应以本报告版本信息为准；verifier 按派发仅更新本报告。

## 证据与限制

- 复验版本：检查前后 `KnowledgeView.tsx` MD5 均为 `edb9a7b68695a633cfde13676c63fa6f`；HEAD `62f6e4e`。页面实际加载本次构建 `index-B7pCnDA_.js`，CSS 为 `index-Dfrnt1Ht.css`；`git diff --check` 退出 0。
- 浏览器：ego-browser 真实 Chromium，任务空间 31；仅读取与导航，未创建或修改资料库数据。检查完成已 `finish({keep:[]})`。
- 本次脚本及截图：`C:/Users/10354/ego/heli-verifier004-headroom-20261027/`（WSL：`/mnt/c/Users/10354/ego/heli-verifier004-headroom-20261027/`）。`round-01.mjs` 确认页面结构、71px 留白及实际资源；`round-02.mjs` 完成布局、交叉状态、13 点滑动、Enter / Space、封面导航、减少动态及 13 本字段 / 单入口审计，输出 ALL ASSERTIONS PASS，结构化结果为 `results.json`。
- 本次未注入关闭 transition 的样式，使用封面宽度条件等待后测量并截图；滑动抽查支持该路径稳定，不宣称逐帧或全部位置穷举。1600px 当前自然布局中抽查两本均右开，390px 覆盖实际左开及右开；未人为强制桌面左开。
- 未穷举全部书位、系统缩放或触屏拖拽。普通模式封面投影底边比按钮底边约多 0.34px，此像素级差异未造成实测点击失败；未据此宣称命中边界数学上完全相等。焦点保留时可见封面覆盖邻书的位置仍进入封面对应库，沿用前次认可的单一入口语义。
- 复验结束执行 `bash launch.sh --stop` 返回已停止，随后 `ss -ltnp 'sport = :8788'` 无监听。脚本与截图仅保存在本机，未纳入 Git。

## 结论与交接

**过。V004-01、V004-02 均关闭，无须升级 brief。** 本轮 P2 在已检查范围内满足验收，可交 brief / 主人侧收口；verifier 仅写本报告，未代改实现、未 stage / commit。
