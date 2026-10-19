# heli-web · 前端

React 19 + TypeScript + Tailwind v4。四个一级入口：**资料库 / 研究任务 / 成果 / 设置**。
路由、数据层与视图都是本仓库自己的代码；设计令牌集中在 `src/styles/globals.css`。

## 运行

```bash
# 后端（另开一个终端）
python heli-src/app.py --port 8788 --web heli-web/dist

# 前端
npm install
npm run dev        # http://localhost:5173，/api 代理到 127.0.0.1:8788
```

Windows 侧不要用 `npm run build`（`node_modules/.bin` 是 WSL shim，会挂），直接跑 JS 入口：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/check-routes.mjs        # 改过路由后跑
```

## 目录

```
src/
  main.tsx             入口，挂 WorkspaceProvider
  App.tsx              四入口壳：左侧 rail + 错误条 + 主区；不认识的路径渲染 unknown
  app/
    router.tsx         自研路由（~140 行）：路径、查询串、navigate、useRoute
    nav.ts             由路由派生一级导航高亮
  model/
    api.ts             v4 接口客户端（30 条路由，含原始字节导入）+ 全部 DTO 类型
    store.tsx          只放多视图共享的列表与错误位（不存详情）
    errors.ts          ApiError + 每个 code 固定的一句「下一步」
  views/
    KnowledgeView.tsx  资料库总览：组与库，卡片 / 书架 / 列表三视图，拖拽归组
    LibraryView.tsx    库内：导入、资料列表、正文、库内检索与命中高亮
    ResearchView.tsx   任务列表 / 任务详情：消息、运行、轮询、成果链接
    ArtifactsView.tsx  成果列表 / 详情：编辑、修订、引用、导出
    SettingsView.tsx   只读展示运行环境与当前口径
  components/
    ui.tsx             Button / Chip / Segmented / SearchField / Field / EmptyState / ViewHeader
    Icons.tsx          线性 SVG 图标集（`IconName` 是唯一图标清单）
  styles/globals.css   `@theme static` 里的设计令牌
```

## 状态放在哪

| 位置 | 放什么 |
|---|---|
| URL（`app/router.tsx`） | 用户选了什么：`?view=card\|shelf\|list`、`?q=`、`?ft=`、`?hit=`、当前库与资料 |
| `model/store.tsx` | 多个视图都要用的列表（库、组、任务、成果）与全局错误位 |
| 视图内部 `useState` | 只有这个页面关心的东西：草稿、选中项、检索结果、运行进度 |

判断标准：刷新后还应不应该保留？该保留就进 URL；只是多个视图共用就进 store；其余留本地。

## 三个视图怎么共存

`/knowledge` 的卡片 / 书架 / 列表读**同一份** `libraries` 与 `groups`，共用同一组操作
（打开、加入分组、归档、拖拽）。视图只决定渲染形态：

- **卡片**：默认。组内网格，显示名称、说明、资料数、已索引数与所属组。
- **书架**：书脊竖排，高度随资料数在 96–176px 之间增长，底部一条搁板线。
- **列表**：表格，便于比较与批量操作；每行可直接从下拉里加入分组。

拖拽表达**加关系**，不是移动：拖进组 = `POST /groups/<id>/members`；拖到「未分组」=
移除该库的全部分组关系。一个库可以同时出现在多个组，实体不复制。

## 接后端时注意

- 所有请求经 `model/api.ts`，视图不直接 `fetch`。错误统一用 `describeError()` 呈现，
  它会把 HTTP 状态与后端文本映射成 code，并给一句固定的「下一步」。
- 后端未接模型：任务运行产出证据包草稿，正文首行标明「未接模型」。界面不渲染成「结论」。
- 导入是原始字节 POST（`Content-Type: application/octet-stream`），文件名走
  `?name=` + `encodeURIComponent`。HTTP 头只能是 latin-1，中文放 `X-Filename` 会直接抛编码错误。

## 视觉约定

- 暖中性色：`bg-canvas` / `border-hairline` / `text-ink` / `text-steel` / `text-stone`，主色 `bg-primary`。
- `--spacing: 1px`，所以 `gap-6` 就是 6px、`px-34` 就是 34px；只有 >64px 的布局用任意值
  （`max-w-[1180px]`）。字号 7 档 `text-micro|meta|body|title|h3|h2|h1`。
- 语义类优先，不写 `bg-[var(--canvas)]` 这类任意值——令牌改名时它会静默失效。
- 动效克制：切换、拖拽悬停、书脊上浮都用 `transition` + 120/160ms；不做整页过渡。
