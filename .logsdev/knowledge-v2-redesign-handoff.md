# 知识库视觉与交互语言 v2 · 工程师实施提示词

> 日期：2026-09-28
> 设计稿（唯一视觉依据）：Ardot `https://ardot.tencent.com/file/730425892957640`
> —— 三帧：书架视图 v2（2:1）/ 卡片视图 v2（3:75）/ 设计语言规范（3:316）
> 上游文档：`.logsdev/archive/ui-optimizations/` 00 / 07 / 08 / 09 号（交互骨架沿用，本文只做视觉与信息架构升级）
> 已落地：`heli-web/src/styles/globals.css` 末尾新增「领域色相族」token（5 族 × spine/deep/accent/text，含深色）+ `.book-v2` / `.spine-serif` / `.bookbox` / `.book-mirror` 组件类（构建已验证生成）。

## 0. 本次改什么、不改什么

| 改 | 不改 |
|---|---|
| 分组模型：单层 `kbIds` → 树形（领域 → 子组）+ 镜像引用边 | `KnowledgeBase` 实体（slug、落盘、检索、索引）零改动 |
| 书脊视觉：颜色即归属，文字极简 | 拖拽五拍、快照撤销、封面卡、搜索打平禁拖等交互骨架 |
| 书脊/卡片配色来源：每本书随机 tint → 领域色相族 | `KbGroup.kbIds` 唯一真源、撤销快照语义 |
| 两视图切换：瞬切 → 200ms 共享元素过渡 | `kbLayout.ts` / `kbDnd.ts` 的公共层地位（继续扩展） |

铁律不变：**分组只是视图**，一切结构操作可快照撤销；镜像只是同一份实体的第二条引用边，不复制实体、不参与统计去重之外的任何双写。

## 1. 数据模型（types.ts）

```ts
export type DomainHue = "sky" | "peach" | "mint" | "lavender" | "neutral";

export interface KbGroup {
  id: string;
  name: string;
  parentId: string | null;   // 新增：树形。null = 顶层领域
  hue: DomainHue;            // 取代现有 color: string；建组时分配，稳定不随成员变
  kbIds: string[];           // 叶子成员（仅叶子组持有书）
  childIds: string[];        // 新增：子组顺序
  collapsed: boolean;
}

/** 镜像：同一本书在第二个组里的引用 */
export interface KbMirror {
  kbId: string;
  groupId: string;           // 镜像所在组（≠ 本体所在组）
}
// store 新增 mirrors: KbMirror[]；撤销快照 = groups + ungroupedOrder + mirrors 一起压栈
```

约束：树深 ≤ 3（领域 / 子组 / 书）；书的本体只属一个叶子组；镜像可多条。
`KbHistoryEntry` 加 `mirrors` 字段；既有 `kbGroups` 迁移：`color` → `hue` 映射表（hex→最近族），`parentId=null`、`childIds=[]`。

## 2. 派生层（lib/kbLayout.ts 扩展）

- `groupTree`: 顶层领域数组（含嵌套 `children`），供两视图共用；
- `hueOf(kbId)`: 书 → 所在叶子组 → 祖先领域 → `DomainHue`（未分层 = `neutral`）；
- `pathOf(kbId)`: `"机器学习研究 / 扩散模型"`，卡片顶部路径与搜索结果的「所在层」；
- `mirrorsOf(groupId)`: 本组的镜像书列表；
- 排序 / 搜索 / 折叠口径与现状一致，只是遍历对象从扁平数组变树。

## 3. 书架视图 v2（ShelfView）

### 3.1 书脊（替换现有渲染，结构极简）
```
.book-v2（46×212，底色 = var(--color-domain-<hue>-spine)，深色自动）
 ├─ 竖排书名 .spine-serif（Source Han Serif CN，≤10 字截断，色 = domain-<hue>-text）
 └─ 底部状态点（沿用 KB_STATUS_COLOR）
```
删除：类别前缀文字、篇数、顶部色带、页边高光。全名/描述/标签/篇数/快捷操作全部留在 hover 封面卡（200ms 延迟，现有 cover 机制不动）。

### 3.2 子组 = 书盒（.bookbox）
层板内的嵌套格：`bg = domain-<hue>-spine 高亮一档（用 #E8F0F9 式浅底）`，书用 `domain-<hue>-deep`；
盒眉 = chevron + 子组名（accent 色）+ `子组 · N 本`；可整盒收起成一条摘要（沿用 collapsedGroupSummary）。
书盒参与拖拽：拖书入盒 = 入子组（确认卡）；盒子整体不可拖（P2 再议）。

### 3.3 镜像书（.book-mirror）
虚线描边（accent 色 60%）、透明底、顶部 9px 链接角标、书名用 accent 色；
hover 封面卡与本体相同，额外一行「镜像 · 本体在 <领域路径>」（点击跳本体）。
拖到镜像 = 拖到本体（语义归一，确认卡文案注明）。

### 3.4 动效（只动 transform / opacity）
沿用现有 keyframes；**让位禁改 gap**（现有 `transition: gap` 必须删掉），改：插入指示条 + 插入点右侧书 `translateX(20px)` 150ms `var(--ease-panel)`。视图切换 200ms：书脊 ↔ 卡片共享元素 FLIP + 交叉淡入。子组展开/收起 240ms（grid-rows 或 max-height 皆可，禁 layout 抖动）。

## 4. 卡片视图 v2（CardView / KbCard）

- 卡片顶部第一行改为：`路径文字`（`pathOf`，色 = domain accent）+ 右侧状态点；
- 子组 = 带缩进的子区：3px accent 竖条 + 子组名 + 计数，下属卡片网格缩进 22px；
- 镜像卡：`.book-mirror`（虚线描边 + 浅底），路径行写「镜像 · 本体在 <领域>」；
- 未分层卡：路径行写「未分层」（neutral-text）。
- 其余（多选、批量条、确认卡、涟漪）不动。

## 5. 验收清单

- [ ] `grep -oE '\-\-color-domain-sky-spine:[^;]*' dist/assets/index-*.css` 有值（浅色 + 深色各一）
- [ ] 迁移：旧 `kbGroups`（扁平 + color hex）→ 新树 + hue，撤销一次跨迁移操作不崩
- [ ] 树深 >3 的建组/拖入被拦截并说明理由
- [ ] 镜像：创建 → 两组各见一书 → 删本体 → 镜像一并消失（toast 说明）→ 撤销全还原
- [ ] 拖拽让位无 layout thrash（Performance 面板每帧 < 8ms，100 本假数据）
- [ ] 深色模式：5 族 spine/text 对比度 ≥ 4.5:1
- [ ] reduced-motion：全部降级为 120ms opacity
- [ ] 两视图切换：分组 / 折叠 / 选择 / 滚动位置保留

## 6. 分期

| 期 | 内容 |
|---|---|
| P0 | 模型（树 + hue + mirrors + 迁移）→ kbLayout 派生 → 书架书脊 v2 + 书盒 + 镜像 |
| P1 | 卡片视图路径/子区/镜像卡；视图切换 200ms；让位改 transform |
| P2 | 镜像的菜单等价路径（「在另一领域引用…」）；子组整体拖拽；建议条升级（按 hue 聚类建议） |
## 7. P0 落地记录（2026-09-28 凌晨）

按 §6 的 P0 实现：模型 → 派生 → 书架渲染。

| 位置 | 落地内容 |
|---|---|
| `types.ts` | `DomainHue` / `KbMirror` / `KB_TREE_MAX_DEPTH = 3`；`KbGroup` 加 `parentId` / `childIds` / `hue`（废止 `color`）；`KbHistoryEntry` 加 `mirrors` |
| `lib/kbLayout.ts` | `hueToken()`；`migrateKbGroups()`（旧 color 的 tint / hex → 最近色相族）；`buildKbLayout` 加 mirrors 入参，派生 `tree` / `hueOf` / `pathOf` / `mirrorsOf` / `mirrorHostsOf` / `groupKbSet` |
| `store.tsx` | `kbMirrors` 状态（与 groups、ungroupedOrder 一起进快照）；`createChildGroup`（树深越界拒绝并说明理由）/ `addMirror` / `removeMirror`；空层判定改为「无书且无子组」；`deleteKb` 清镜像并 toast 说明；初始数据写成 legacy 形状，启动时迁移 |
| `ShelfView.tsx` | 书脊 v2（竖排书名 ≤10 字 + 底部状态点，删除类别前缀 / 篇数 / 顶部色带 / 页边高光）；子组 = `.bookbox`；镜像 = `.book-mirror`；让位从 `transition: gap` 改为 `translateX(20px)` |
| `ShelfHeader` / `BulkBar` | 层色点 → `hueToken(hue, "accent")`；层眉统计含子组（镜像去重只算一次）；顶层层的菜单加「新建子组」 |

偏离与说明（与本文正文不一致处，以本表为准）：

- store 字段命名 **`kbMirrors`**（对齐 `kbGroups` / `kbHistory`），而非 §1 写的 `mirrors`。
- `layout.groups` **保留为扁平全量**（含子组）供卡片视图沿用，树形另设 **`layout.tree`**。
  卡片视图 v2 的嵌套渲染属 P1；在此之前子组在卡片视图里平铺为独立分区，不会丢书。
- 镜像的 UI 入口（「在另一领域引用…」）按 §6 留给 P2；P0 用一条演示镜像验证渲染与撤销链路。

验证（可定位的证据）：

- `tsc --noEmit` 零错误；`vite build` 通过。
- 产物 CSS grep 命中：`--color-domain-sky-spine:#d8e8f7`、`#17304a`、`--color-domain-lavender-deep`、
  `.book-v2{` `.spine-serif{` `.bookbox{` `.book-mirror{`，深色模式媒体查询 2 处。
- 运行冒烟（dist 静态服务 + 浏览器计数）：`.book-v2` 10（9 本 + 1 镜像）、`.book-mirror` 1、`.bookbox` 1，
  书盒文本「在研项目 / 子组 · 2 本 / AI与医疗 / AI与金融」；旧 `.book-spine` 计数 0。

未验证项（待人工验收，无浏览器内操作证据）：拖拽让位的实际帧耗时（§5 要求 < 8ms）、
深色对比度实测、跨迁移撤销的交互路径、卡片视图 v2。
### P1 落地（2026-09-28 上午）：卡片视图 v2 + 视图切换过渡

| 位置 | 落地内容 |
|---|---|
| `KbCard.tsx` | 顶部第一行 = 路径文字（`pathOf`，色 = 领域 accent）+ 右侧状态点（原「类别名 + 状态 Chip」移除）；镜像卡 `.book-mirror`（虚线描边 + accent 6% 浅底）；加 `data-flip-id`；删掉被路径取代的 `groupName` prop |
| `CardView.tsx` | 改走 `layout.tree`；子组 = 缩进子区（3px accent 竖条 + 子组名 + 计数，下属网格 `pl-22`）；让位改 `translateX(12px)`；拖拽副本第一行改显示路径 |
| `lib/kbLayout.ts` | 卡片视图不再消费扁平 `groups`，删掉这条派生出口，只保留 `tree` |
| `KnowledgeView.tsx` | 容器 `key + animate-view-swap` 由 160ms 升到 200ms；切换前按 `data-flip-id` 采共享元素旧位置，切换后在 layout effect 里跑位移 FLIP（200ms）+ 淡入；reduced-motion 跳过位移只留淡入 |

偏离与说明：

- **FLIP 只做位移、不做非等比缩放**：书脊 46×212 与卡片 300×N 的长宽比差异过大，缩放会把文字拉变形。
- 卡片网格让位取 **12px**（小于 gap 14），书架取 **20px**——网格里平移超过 gap 会压到下一列。
- 搜索打平时路径行直接写 `pathOf`（未分层时为「未分层」），不再单独挂 groupName chip。

验证：

- `tsc --noEmit` 零错误；`vite build` 通过。
- 产物 CSS 命中：`.pl-22`、`.w-[3px]`、`.min-w-0`、`.h-full`、`.book-mirror`；`view-swap` 时长为 `.2s`。
- 浏览器冒烟：书架侧 `[data-flip-id]` 10 / `.book-v2` 10 / `.bookbox` 1；切到卡片视图后
  `.kb-card` 10 / `.book-mirror` 1 / `.pl-22` 1，首卡首行文本「未分层」；再切回书架计数不变（双向切换无崩溃）。

剩余（P2 及人工验收）：镜像的 UI 入口「在另一领域引用…」、子组整体拖拽、建议条按 hue 聚类；
FLIP 观感与帧耗时、reduced-motion 降级、深色对比度 —— 均无自动化证据，需人工过一遍。
