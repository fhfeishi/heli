# Work log — round 004

日期：2026-10-27
来源：用户派发的 engineer 任务；[本轮 brief](01-brief.md)、[round 001 P2](../001/01-brief.md)、[verifier 打回报告](03-testreport.md)
状态：本轮范围已完成（含 V004-01 打回修复），待 verifier 复验

## 对照 brief

- Brief：round 004 / P2 书架书脊→书面（`LibrarySpine`）。
- 本轮是否按步骤做完：是。书面补全最小信息集；hover / focus 过渡收敛；`prefers-reduced-motion` 降级保留信息与进入单库能力；三项工程检查退出码均为 0；未提交 git。
- 只改 `heli-web/src/views/KnowledgeView.tsx` 的书架段（`usePrefersReducedMotion`、书架常量、`LibrarySpine`）。GroupStack / `renderGroup` 与暂存区里的 round 002 版本逐字节一致（已脚本比对）。

## 改动表

| 位置 | 改动 | 说明 |
|------|------|------|
| `KnowledgeView.tsx` 约 307–321 行 | 新增 `usePrefersReducedMotion()` | 订阅 `matchMedia("(prefers-reduced-motion: reduce)")` 并在运行时跟随系统切换；用于决定书是否抬起 / 旋转。 |
| 同上 约 644–659 行 | 书架几何收为具名常量 | `BOOK_WIDTH=34`、`BOOK_HEIGHT=208`、`COVER_WIDTH=190`、`BOOK_LIFT=44`，以及书面投影 `COVER_FACE_WIDTH=204`、`COVER_FACE_HEIGHT=223`、`COVER_TOP_OVERHANG=11`。原先散在 `LibrarySpine` 内的 `DEPTH` 与 `BOOK_HEIGHT` 局部常量改为模块级同源常量。 |
| 同上 `LibrarySpine` | 书面补全最小信息集 | 名称（书面用全名，顶带承担组名）、年份跨度（`library.year_span`，无则整段省略）、资料总数（`source_count`）、可检索数（`indexed_count`）、最近更新时间（`relTime(updated_at)`）。全部来自现有 `Library`，未新增字段。 |
| 同上 | `hovered` / `focused` 双状态拆分 | `pulled = hovered \|\| focused`；`mouseenter/leave` 只写 hover，`focus/blur` 只写 focus，拖拽结束两者同清。修复 verifier 的 V004-01。 |
| 同上 | 过渡收敛为单一节奏 | 书本包裹层 `duration-320 ease-[cubic-bezier(0.22,1,0.32,1)]` + `motion-reduce:transition-none`；容器宽度不再参与过渡（见偏差 2）。 |
| 同上 | 命中区与可见书面同源 | 收起时命中区=书脊（34×208）；展开后覆盖「书脊 + 书面投影」并集（右开 x 0–221、左开镜像 -187–34，高 223，顶边 -55）。单按钮承载全部点击，封面保持 `pointer-events-none` + `aria-hidden`，不构成第二套导航。 |
| 同上 | 靠右缘的书反向开 | `measureSide()` 在 mouseenter/focus 时量左右余地，右侧放不下且左侧更宽则 `side="left"`，书面落到书脊左侧，仍在视口内。 |
| 同上 | `title` / `aria-label` 补全信息 | `进入资料库「<全名>」，N 份资料，M 可检索，最近更新 …，年份跨度 …`（无年份时省略该句），键盘与读屏获得与书面同等的信息。 |

合计：`git diff --numstat` = **+168 / −70**，仅 `heli-web/src/views/KnowledgeView.tsx` 一个文件。当前文件 md5 `50995ce750a34b0a555b0b27f6f1fa66`。

## 自测

### 工程检查（`cd heli-web`，工作区最终源码）

| 命令 | 退出码 | 结果 |
|------|--------|------|
| `npm run typecheck` | **0** | `tsc --noEmit` 无输出 |
| `npm run build` | **0** | 46 modules；`dist/assets/index-De1tyBIv.css` 58.72 kB、`index-DwH31hHF.js` 353.42 kB |
| `npm run check:routes` | **0** | 28 项全部 PASS，末行 `ALL PASS` |

### 浏览器实测（ego-browser，真实 Chromium，`http://127.0.0.1:8788/knowledge?view=shelf`）

脚本：`C:/Users/10354/ego/heli-shelf-eng-004/round-01…28.mjs`（WSL：`/mnt/c/Users/10354/ego/heli-shelf-eng-004/`）。截图：`desktop-focus.png`、`narrow-focus.png`、`desktop-open.png`、`narrow-open.png`。

| 验收点 | 结果 | 证据 |
|--------|------|------|
| 书面展示名称、资料总数、可检索数、最近更新时间、可选年份跨度，数据来自 `Library` | 通过 | 13 本全量审计：13/13 的 `aria-label` 含「名称 + N 份资料 + M 可检索 + 最近更新 …」；11 本含年份跨度，`Bot-Reports`、`Aaevum` 无年份时该段在书面与 aria 中都整段省略。书面可见文本例：`自然科学基金 / AI与材料 / 2021–2025 / 14 份 / 4 可检索 / 29% / 更新 7 天前 / 点击进入`。 |
| 鼠标从书脊移到书面不反复收回 | 通过 | 桌面 1400px：从书脊 x+10 起每 10px 采样至 x+200，20 个采样点的书面宽度**恒为 204**，无一次收回；移出后回到 34 / 2。 |
| 键盘可触发同等信息与进入单库 | 通过 | 真实 Tab（15 步）到第一本：焦点环 `solid 2px`、书面 204×223 展开、文本同上；Enter 与 Space 分别进入 `/knowledge/lib_7b6935af654d`（两轮独立复测，轮询 5×300ms 均稳定在该 URL）。焦点保留、鼠标移到 (1300,860) 后书面仍为 204 且 `focused=true`；此时点击书面远端 → 进入**同一本** `/knowledge/lib_7b6935af654d`。 |
| 命中区处理 `pointer-events-none` 风险，封面不是第二套导航 | 通过 | 13/13 本书所在格内可聚焦元素恰为 **1**；封面 `aria-hidden=true`、`pointer-events: none`；展开后点击书面任意位置（离书脊最远 20px）命中同一个 `BUTTON`。收起态点邻书书脊 → 进入邻书 `/knowledge/lib_35066f9fd299`（不会误进别的库）。 |
| 390px 无严重溢出 | 通过 | 390px 下右缘第 6 本（x=275）自动左开，书面 `[88,292]` 全在视口内；`document.scrollWidth == clientWidth == 390`、滚动容器 321/321。首本靠左缘仍右开 `[107,311]`。截图 `narrow-focus.png`（焦点态书面完整可读，未盖住层板说明文字之外的内容）。 |
| 减少动态 | 通过 | `prefers-reduced-motion: reduce` 下：书本 `transform: none`、封面 `transform: none`、书面 190×208 静态展开、命中区 224 覆盖书面、点击命中同一按钮、`focusables=1`；信息与进入动作不变。 |
| diff 范围 | 通过 | `git diff --numstat` 仅 `KnowledgeView.tsx` +168/−70；GroupStack 段与暂存区 round 002 版本脚本比对**完全相同**。 |
| 未提交 git | 通过 | HEAD 仍为 `62f6e4e`；本轮变更全部留在未暂存工作区，未执行 `git add` / `commit`。 |

**测量口径（如实记录）**：ego 窗口在后台时，`:hover` / `:focus` 触发的 CSS transition 会停在起始帧（round 002 起就存在的已知现象）。因此交互**终态**用「页面内注入 `*{transition:none;animation:none}` 后再采样」取得；持续过渡的观感只在 round-01 的连续滑动采样（未注入、20 点恒定 204）中确认。未录制逐帧视频，不据此声称检查了全部帧。

## 相对 brief 的偏差

1. **放弃「抽出时加宽容器」的旧命中方案**（brief 说「在现有抽出 / 转封面机制上」，未规定命中实现）：旧实现让布局盒从 34px 变 224px，flex 换行会把书推离指针、并让相邻书跳位；390px 下尤甚。现改为**书脊布局盒恒定 34px、书面浮在上层**，命中区由按钮按书面投影给。转封面（`rotateY`）、抬起、影子、书页等既有机制全部保留。
2. **靠右缘的书反向开（新增 `side` 状态）**：brief 要求「390px / 桌面无严重溢出」；固定右开在 390px 右缘会把 100+px 书面推出视口。仅在右侧放不下且左侧更宽时左开，不改变层板排布。
3. **书面标题用全名，书脊仍用短名**：brief 要求书面展示「资料库名称」。原实现书面用 `shortName(name, series)`，跨组浏览时会丢掉系列前缀；现书面与 aria-label 都用 `library.name`，书脊保持短名（窄条放不下全名，系列名由顶带 / 组标题承担）。
4. **命中区随 `pulled`（hover 或 focus）展开，不是只在 hover 时展开**：曾试过 hover-only，结果「键盘焦点打开的书面」被点击会穿透到下面那本邻书（实测落到 `/knowledge/lib_35066f9fd299`）。书面已把邻书视觉遮住，点它就该进封面这本，故改回与可见书面同源。
5. **已知取舍**：键盘焦点保留时，该书的 221px 命中区仍覆盖相邻书脊，此时鼠标点邻书位置会落到聚焦这本（要先用鼠标点空处或 Tab 移走焦点才能点邻书）。这是「焦点保留时书面必须保持可见可点」与「邻书可点」的固有冲突；verifier 打回意见要求前者，本轮按前者实现，未额外加分支。若需要更细的共存策略，建议 brief 另开一轮。
6. **`COVER_FACE_*` 是实测值而非推导值**：书面在 `perspective:1200 + translateZ(64px)` 下的投影实测 204×223（展开动画完成后）。常量写的是终态尺寸；动画途中命中区会略微大于可见书面（全程不会小于），这是有意的安全方向。

## 是否可测

可测。UI 看 `/knowledge?view=shelf`；复验建议覆盖：纯 hover 滑动、纯 Tab（Enter / Space）、焦点保留时鼠标移开后再点书面、390px 右缘左开、减少动态，以及 `npm run typecheck && npm run build && npm run check:routes`。


## 立即修复 · V004-02（verifier 打回，优先于其他）

V004-01 已关闭，勿回退 hover/focus 拆分。

**V004-02**：向上抽出的封面遮挡组标题及统计。
- 位置：`KnowledgeView.tsx` 书架相关；正常模式向上抬起约 44px，投影额外上伸约 11px；`.shelf-board` 未为此预留顶部空间。
- 实际：桌面封面上沿侵入「自然科学基金」组标题和左侧统计；390px 同样。减少动态无此向上遮挡。
- 最小修正：在书架相关布局内为正常模式向上投影预留足够空间，或调整抽出几何，使封面和命中区避开组标题；保留 V004-01、单一按钮与导航语义。具体像素由实际投影验证，不要求某个固定类名，不扩展到 GroupStack。
- 复验重点：1600px / 390px 普通模式首排左右展开不遮挡组标题及统计；封面和命中区一致；书脊到封面稳定；保留焦点/hover 交叉、Enter/Space、减少动态；typecheck/build/check:routes 均为 0。

完成后在本 worklog 追加「打回修复 · V004-02」节后结束。不要 git commit。

## 打回修复 · V004-02

- 原因：抽出书面向上投影（BOOK_LIFT + COVER_TOP_OVERHANG）侵入组标题/统计；层板未预留顶部空间。
- 改动：新增 `SHELF_HEADROOM = BOOK_LIFT + COVER_TOP_OVERHANG + 16`，以 `style.paddingTop` 加在 `.shelf-board` 上；精确投影高度（44 + 11）之外再留 16px，避免擦边。
- 保留：V004-01 的 hover/focus 拆分合成、单一按钮、导航语义、减少动态路径。
- 未提交 git。

### 改动表（V004-02）

| 文件 | 位置 | 改动 |
|---|---|---|
| `heli-web/src/views/KnowledgeView.tsx` | 书架常量（663） | `SHELF_HEADROOM = BOOK_LIFT + COVER_TOP_OVERHANG + 16`，注释说明留白只加在层板内部 |
| 同上 | `renderLibraries` 书架分支（1320–1323） | `shelf-board` 由 `pt-56` 类改为 `style={{ paddingTop: SHELF_HEADROOM }}`，高度与投影常量同源 |

### 自测（V004-02，产物 `index-B7pCnDA_.js` / `index-Dfrnt1Ht.css`）

| 项 | 结果 | 证据 |
|---|---|---|
| typecheck / build / check:routes | **0 / 0 / 0** | `ALL PASS`；CSS 58.47 kB、JS 353.39 kB |
| 1600px 首排左/右展开不遮挡标题与统计 | 过 | 第 1 本（右开）：封面上沿 291，组标题行底 263、统计底 254 → `overlapsHeading=false`；第 11 本同样 291 vs 263 / 254。`docW=clientW=1600` |
| 390px 首排左/右展开不遮挡 | 过 | 第 1 本封面 `t=263`，标题行底 235、统计底 232；第 7 本（左开）`t=263` 同样不重叠。`docW=clientW=390` |
| 封面与命中区一致 | 过 | 正常模式 coverW 204 / hitW 221；减少动态 coverW 190 / hitW 224（均覆盖书面） |
| 书脊→书面稳定 | 过 | 两宽度下移入封面后终态恒定，无收回；`coverInView=true` |
| 焦点 / hover 交叉（V004-01 不回退） | 过 | 纯 hover：204 / 221 → 移开 34；纯 Tab 第 15 步到第一本，outline `2px solid`，Enter 进入 `lib_7b6935af654d`；焦点保留 + 鼠标移开 900ms 后仍 204 / 221；hover 保留时 blur 仍 204 / 221，指针离开才收；Space 同样进入 `lib_7b6935af654d` |
| 减少动态 | 过 | 静态书面 190 宽、`transform:none`、影子 `display:none`；390px 两本书书面 `t=318`，不遮挡标题（235）/统计（232） |

截图：`v2-390-first.png`、`v2-390-edge.png`、`v2-1600.png`（`C:/Users/10354/ego/heli-shelf-20261027/`）。

### 是否可测（V004-02）

可测。上述断言取自 8788 服务实际加载的 `index-B7pCnDA_.js`；服务已 `bash launch.sh --stop`，端口已释放。未提交 git。
