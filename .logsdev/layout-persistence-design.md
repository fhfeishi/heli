# 资料库组 / 资料库的本地持久化方案（待审查）

> 状态：**候选，待用户审查**。2026-10-17。
> 本文是 [library-system-design.md](library-system-design.md) §4 的细化：那份定「库组是视图层数据、落在库根」，
> 这份定「具体怎么落、怎么写、怎么防坏」。
> 只管落盘与接口，不含界面实现。批准前不改代码。

## 0. 定位：三层分工，本文只管最下面一层

| 层 | 载体 | 干什么 |
|---|---|---|
| 人的知识 | Strata（Obsidian，`D:\secret\notenote\Strata`） | 提炼后的理解、判断、方法 |
| 机器资料 | `E:\local_db\.knowledge` | 原始资料与检索索引 |
| 管理系统 | heli | 接入、索引、检索、呈现 |

**内容只在一个地方是权威。** 由此得出三条对持久化的硬约束：

1. **`.knowledge` 必须能脱离 heli 被看懂**——heli 挂了、换机器、直接用文件管理器，资料仍在、结构仍可辨认。
   → 落盘格式必须是人可读的纯文本，不能是二进制或强依赖程序的格式。
2. **持久化只存 heli 自己的东西**（组、排布、库的元数据），不复制资料本身，也不存能从别处算出来的东西（统计、文档清单）。
3. **库目录仍自包含**：一个库可以单独拷走、单独恢复，不需要带走别的文件才能用。

边界：本文**不**涉及文档级内容（那在 `datadb/kb.db`）、不涉及检索索引（`vectordb/`）、不涉及 `target/` 提取结果。

## 1. 持久化对象清单

| 对象 | 落点 | 形态 | 权威性 |
|---|---|---|---|
| **资料库（实体）** | `<库根>/<slug>/kb.json` | JSON，**已存在**，只补字段 | 库身份的唯一权威 |
| 库内容（原文/解析/结果/数据库/索引） | `<库>/source/ parsed/ target/ datadb/ vectordb/` | 不变 | 不变 |
| **资料库组 + 排布** | `<库根>/_layout.json` | JSON，**新增** | 组的唯一权威 |
| 组的历史快照 | `<库根>/.datascripts/layout-history/` | JSON 快照，滚动保留 | 派生（可删） |
| 布局写锁 | `<库根>/_layout.lock` | 空文件（锁锚点） | 运行时 |
| 软删除的库 | `<库根>/_trash/<slug>-<时间戳>/` | 整目录移动 | 可恢复 |
| 设备偏好（当前视图、折叠） | 浏览器 localStorage | JSON | **不落盘到库根** |

关键区分（避免双写）：**组与排布是用户资产**（换设备要跟着走）→ 落库根；**当前看哪个视图、哪些组折叠**是设备偏好 → 留浏览器。

## 2. 为什么是「库根 + 单文件 JSON」

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **`<库根>/_layout.json` 单文件** | 跨库关系天然同层；人可读可手改；原子替换即可保证不撕裂；进备份只多一个文件 | 单点写入，需要乐观并发；无事务 | **推荐** |
| 每库 `kb.json` 加 `group` 字段 | 不新增文件 | 跨库关系被拆进各库；改名/移组要扫全库；必然出现「库说自己属于 A、A 不认它」 | 否 |
| `<库根>/_layout.db`（SQLite） | 事务、并发、部分更新 | 多一个需要备份/迁移/WAL 的库；12 个组的量用不上；不能手改、不能 diff | 否 |
| 中间目录 `<库根>/<组>/<库>/` | 文件系统直观 | 要改库发现逻辑；破坏「库=自包含目录、可整体迁移」；调整组=搬目录，风险最高 | 否 |

再补一条**为什么不用 JSONL**：layout 是「一棵树 + 一组边」的**整体状态**，追加日志需要回放才能得到当前态，出问题时反而更难救。整体快照 + 原子替换更符合「一眼看懂」。

## 3. `_layout.json` 的格式

```json
{
  "schema_version": 1,
  "revision": 7,
  "updated_at": "2026-10-17T12:40:00+08:00",
  "groups": [
    {
      "id": "grp_2f7c1a9b",
      "name": "纵向项目",
      "parent_id": null,
      "child_ids": ["grp_9d3e0b42"],
      "kb_ids": [],
      "hue": "sky",
      "created_at": "2026-10-17T11:02:11+08:00",
      "updated_at": "2026-10-17T12:40:00+08:00"
    },
    {
      "id": "grp_9d3e0b42",
      "name": "自然科学基金",
      "parent_id": "grp_2f7c1a9b",
      "child_ids": [],
      "kb_ids": ["kb_7ae8af441bb44a87b7f9958a46246103"],
      "hue": "sky",
      "created_at": "2026-10-17T11:03:00+08:00",
      "updated_at": "2026-10-17T12:40:00+08:00"
    }
  ],
  "ungrouped_order": ["langchain_docs"],
  "mirrors": [
    {"kb_id": "langchain_docs", "group_id": "grp_9d3e0b42"}
  ]
}
```

| 字段 | 约束 |
|---|---|
| `schema_version` | 固定 `1`；不认识的版本**拒绝写**，只读并提示 |
| `revision` | 单调整数，**每次成功写入 +1**，由服务端生成；客户端只提交 `base_revision` |
| `groups[].id` | `grp_` + 8 位十六进制，创建时生成，**永不改变** |
| `groups[].name` | 1–40 字；同一父下不得重名 |
| `groups[].parent_id` | 父组 id 或 `null`；深度上限 **3**（领域 → 子组 → 库），无环 |
| `groups[].child_ids` | 子组顺序；必须与各子组的 `parent_id` 互相对应 |
| `groups[].kb_ids` | **本体归属**；只有叶子组（`child_ids` 为空）可非空 |
| `groups[].hue` | `sky / peach / mint / lavender / neutral`（沿用现有 `DomainHue`） |
| `ungrouped_order` | 未分组区的顺序；只放库 id，不放组 id |
| `mirrors[]` | 「同一本书在第二个组里也陈列」。`(kb_id, group_id)` 唯一；不复制实体 |

**引用主键用 `kb.json.id`，不用目录名**：

- 目录名会变（`v2-manage name` 只改显示名，但目录也可能被手工改名），引用目录名会断链；
- `kb.json.id` 是既有设计里「改名不变」的稳定标识（`Kb.init` 用 slug，`adopt` 生成 `kb_<uuid>`）；
- 代价：基金库的 id 是 `kb_7ae8af44…`，人眼看不出是哪个库——所以**响应里派生**出 slug/name，文件里不冗余存（避免同一事实两处维护）。

**`collapsed` 不落盘**：折叠是设备偏好，落盘会让「每折一次组就写一次盘」，且两台设备会互相覆盖。

## 4. 不变式（校验器逐条实现，返回具体错误路径）

| # | 不变式 | 违反后果 |
|---|---|---|
| I1 | `groups[].id` 全局唯一，且格式合法 | 树结构不可解 |
| I2 | 一个 `kb_id` 在整个文件的 `kb_ids` 中**最多出现一次** | 库有两个"家"，移动语义崩 |
| I3 | `mirrors` 的 `(kb_id, group_id)` 唯一；`kb_id` 必须已有本体归属 | 出现无主的陈列 |
| I4 | 树无环，深度 ≤ 3；`parent_id` 与 `child_ids` 双向一致 | 渲染死循环 |
| I5 | 非叶子组 `kb_ids` 必须为空 | 组既是书又是层，渲染歧义 |
| I6 | **layout 不含库实体字段**（name/slug/path/统计/文档数） | 双写，必然漂移 |
| I7 | `ungrouped_order` 只含库 id 且不重复 | 未分组区重复渲染 |
| I8 | 引用不存在的库 id 时**保留并标 `unresolved`**，不自动删 | 库临时不可用就丢排布 |
| I9 | 两个库不得有相同 `kb.json.id` | 引用歧义；发现时报警而非自动改 |

## 5. 读协议（磁盘 → 文件 → 响应）

读是三条来源的归一化，**不修改磁盘**：

```text
A = 扫库根：{id → slug}（跳过 . 与 _ 开头目录、非目录、无 kb.json 的目录）  ← 磁盘真相
F = 读 _layout.json（不存在则用空骨架，revision = 0）                      ← 排布真相
响应 = 合并(A, F)
```

合并规则：

1. F 里所有 `kb_id` 若不在 A → 该条目**保留**，在响应 `unresolved` 里列出（I8）。
2. A 里存在、但 F 完全没提到的库 → 追加到响应 `ungrouped_order` 末尾（**只影响响应**，下次写入时才落盘）。
3. F 里重复的 `kb_id` → 只保留第一个出现的，其余进 `warnings`（I2）。
4. 响应附带 `libraries: [{kb_id, slug, name}]`、`revision`、`warnings`、`unresolved`。
5. `.` / `_` 开头的目录一律不当库——`_trash/`、`.datascripts/` 因此天然被排除，**不用改现有发现逻辑**（`server.py:95` 的判断是「直接子目录 + 有 kb.json」，`_trash/<slug>/` 是两层，本来就不会命中）。

## 6. 写协议

```text
PUT /api/layout   {base_revision, groups, ungrouped_order, mirrors}

1. 取 <库根>/_layout.lock（阻塞等待 ≤1.5s；超时 → 423）
2. cur = 读磁盘（文件不存在视作 revision=0）
3. base_revision ≠ cur.revision → 409 + {current_revision, current_layout}
4. 规范化（补 parent/child 一致性检查）+ 校验 I1–I7 → 不通过 400 + 具体路径
5. 服务端生成 revision = cur.revision + 1、updated_at
6. 写 <库根>/_layout.json.tmp（同目录、O_TRUNC、fsync）
7. 若 cur 存在：先写快照 .datascripts/layout-history/<新revision>-<时间戳>.json
8. os.replace(tmp, _layout.json)   ← 原子，要么旧要么新
   · 若平台拒绝 rename（Windows 访问 \\wsl.localhost\…、9P 覆盖写）：
     直接覆写主文件，响应带 durability="degraded"，并在服务端日志留痕
9. 释放锁，返回 {revision}
```

为什么这样：

- **锁在内、读-校验-写一体**：避免两个窗口同时读到旧 revision 都通过校验（TOCTOU）。
- **revision 由服务端递增**，客户端不能伪造；`base_revision` 是「我是基于哪一版改的」的声明。
- **先快照再替换**：即使写坏了，`.datascripts/layout-history/` 里还有上一版可用。
- **`.tmp` 与目标同目录**：跨文件系统 rename 不是原子操作。
- **9P 降级是明确承认的弱点**：Windows 侧对 `/mnt/e` 做 rename 会 `WinError 5`（本机实测）。所以后端应当在 WSL 内跑；Windows 侧只读。降级时返回 `degraded` 而不是假装成功。

## 7. 与库的生命周期一致性

| 事件 | 对 layout 的处理 | 谁做 |
|---|---|---|
| 新建库（`init` / `adopt`） | 不动 layout；下次 GET 自动出现在 `ungrouped_order` 末尾（规则 5.2） | 读时归一化，零写入 |
| 库改名（显示名 `name`） | 不动 layout（引用的是 `kb.json.id`） | 无 |
| 库目录改名 | 不动 layout（同上）；响应里的 slug 自动变 | 无 |
| 库被移出库根 / 暂不可用 | 条目保留，标 `unresolved`（I8） | 读时标注 |
| 库被删除（见 §8） | 写入前先快照；从 `kb_ids`/`ungrouped_order`/`mirrors` 移除该 id | 删除流程内 |
| 同 id 两库（复制备份） | 不自动改；`warnings` 报警（I9） | 读时标注 + `layout validate` |
| 空组 | 保留不自动删（可能是用户刻意留的结构） | `layout gc` 才清 |

**唯一会写 layout 的时机**：用户调整组/顺序/镜像、库被删除（§8）。其余全部靠读时归一化。

## 8. 软删除：`_trash/`

```
<库根>/_trash/<slug>-20261017T1240/
```

- 删除 = **整目录移动**（同一文件系统内 rename，秒级），不是打标记、不是删文件。
- 移动前先写一份 layout 快照，记下这个库原来在哪个组、第几位 → 恢复时能放回原位。
- `_trash/` 以 `_` 开头 → 不会被当作库；两层结构 → 现有发现逻辑也不会误命中。
- 清理：`layout gc --trash` 或手工删（保留期由用户决定，程序不自动删）。

**为什么不选 `kb.json.archived = true`**：库目录还在库根里，所有扫描、备份、`iterdir`、用户肉眼都要多一层过滤；而"移动"天然地把"已删"和"在用"分开，恢复就是移回去。

## 9. 接口契约

| 方法 / 路径 | 语义 | 主要返回 |
|---|---|---|
| `GET /api/layout` | 读归一化后的布局 | `200 {revision, groups, ungrouped_order, mirrors, libraries[], unresolved[], warnings[]}` |
| `PUT /api/layout` | 整份写入（拖拽结束后一次提交） | `200 {revision}` / `409 {current_revision, current_layout}` / `400 {code, path, message}` / `423` |
| `GET /api/layout/history` | 历史快照列表 | `200 {entries:[{revision, at, size}]}` |
| `POST /api/layout/restore` | 恢复到某个 revision（P2） | `200 {revision}` |

**为什么整份 PUT 而不是按组 CRUD**：组操作低频（一天几次），前端已有完整模型（`store.tsx` 的 `moveGroup`/`addMirrors`/快照栈），整份提交 + `base_revision` 的代码量和心智负担都最小；按组 CRUD 要处理「移动是 A 组的删除 + B 组的插入」这种跨组原子性，反而更复杂。单个组上百万条时才需要拆分。

错误码：`409 stale_revision`、`400 invalid_layout`、`400 unsupported_schema`、`423 layout_busy`。

## 10. 命令行

```bash
python -m kbctl layout show            # 打印当前布局 + unresolved + warnings
python -m kbctl layout validate        # 只校验不变式，退出码 0/1（可进 CI）
python -m kbctl layout gc              # 清理孤儿 kb_id、重复项（不删空组）
python -m kbctl layout export          # 导出为可读 JSON（备份用）
python -m kbctl layout import <json>   # 从导出或 localStorage 迁移导入
```

`--root` 沿用 `kbctl.config` 的解析链，不写死路径。

## 11. 前端改造与迁移

- `lib/kbViewStore.ts` 从 localStorage 改为**服务端读写**；localStorage 只留 `collapsed` 与当前视图这类设备偏好。
- 启动：`GET /api/layout` → 填充 `store.tsx` 的 `kbGroups/ungroupedOrder/kbMirrors`。
- 提交：拖拽/建组/删组/镜像后**立即 PUT**（不做本地双写，避免两份真源）；失败时回滚到上一次快照并提示「布局保存失败」。
- **一次性迁移**：若 `GET` 返回 `revision = 0`（库根还没有文件）且本地有 legacy 键 `heli.kbview.v1` → 用本地数据初始化后 PUT，成功后删除本地键，并提示「布局已改为随库保存」。
- 冲突：收到 `409` 时拉最新布局、把用户这次操作**重放**一次（结构操作是幂等的意图，重放比重载更友好）；重放再冲突就只重载 + 提示。

## 12. 代码落点（只列位置，不含实现）

| 文件 | 改动 |
|---|---|
| `heli-src/kbctl/layout.py` | **新增**：`load(root)` / `save(root, layout, base_revision)` / `validate(layout)` / `normalize(root, layout)` / `history(root)` / `gc(root)`；常量 `SCHEMA_VERSION`、`HUE_VALUES`、`MAX_DEPTH=3` |
| `heli-src/kbctl/core.py` | 加 `layout_path(root)`；`kb_id_of(kb)` 读 `kb.json.id` |
| `heli-src/kbctl/pipeline2.py` | `WriterLock` 支持任意路径（`WriterLock.at(path)`），复用现有 flock / msvcrt 两支 |
| `heli-src/kbctl/server.py` | 在 `parts[:2] != ['api','libraries']` 之前加 `/api/layout` 分支（GET/PUT/history） |
| `heli-src/kbctl/__main__.py` | 加 `layout` 子命令（show/validate/gc/export/import） |
| `heli-web/src/lib/kbViewStore.ts` | 改为后端读写 + 迁移逻辑 |
| `heli-web/src/store.tsx` | 初始加载与提交时机；`collapsed` 走本地 |
| `heli-web/src/api/knowledge.ts` | 加 `getLayout` / `putLayout` |

## 13. 验收用例（可执行断言）

1. **落盘往返**：建组 → 拖 3 个库入组 → 改顺序 → PUT → 重启服务 → GET 与原结构逐字段相同。
2. **并发**：窗口 A GET（rev=3）→ A 保存（rev=4）→ B 用 `base_revision=3` 保存 → **409** 且返回 `current_revision=4`；B 重放后成功（rev=5）。
3. **孤儿**：把某库目录移出库根 → GET 里该 id 出现在 `unresolved`、`revision` 不变、不写盘；`layout validate` 仍退出 0（孤儿是合法状态）；`layout gc` 清理后退出 0。
4. **删除库**：删库后 layout 不再引用它，`.datascripts/layout-history/` 里能查到删除前的快照，按快照可还原组位次。
5. **损坏**：手工把 `kb_ids` 写成重复 / 造一个环 → `layout validate` 退出 1 并指出字段路径；服务端 GET 返回 `warnings` 但不 500。
6. **残骸**：留下 `_layout.json.tmp` → 启动后主文件不受影响，tmp 被清理。
7. **无文件**：库根没有 `_layout.json` → GET 返回 `revision=0` + 全部库在 `ungrouped_order`，且**不创建文件**；首次 PUT 才落盘。
8. **不侵入库**：PUT 前后对各库 `kb.json` 与 `datadb/kb.db` 做 sha256 对比，必须完全不变（证明 layout 只动自己）。

## 14. 备份与恢复

- `_layout.json` + `.datascripts/layout-history/` 进 **P0**（用户资产，手工排布成果）。
- 按库备份（`v2-backup`）**不含** layout——它是跨库文件。整根备份（`cp -a <库根>`）才含。
- 恢复顺序：先恢复库目录，再恢复 `_layout.json`；只恢复 layout 不恢复库 → 全部条目变 `unresolved`（不丢数据，但看不见书）。

## 15. 待审查（5 条）

1. **形态**：`<库根>/_layout.json` 单文件 + 原子替换 + `base_revision` 乐观并发 —— 同意吗？
2. **引用主键**：用 `kb.json.id`（改名不断链，但基金库 id 是 `kb_<uuid>` 不可读）而不是目录名 —— 同意吗？
3. **折叠状态不落盘**（只留浏览器）—— 同意吗？若要跨设备一致，就得接受每折一次写一次盘。
4. **软删除用 `_trash/` 目录移动 + layout 快照**（而不是 `kb.json.archived=true`）—— 同意吗？
5. **历史快照**保留最近 **20** 份、位置 `.datascripts/layout-history/` —— 数量与位置合适吗？

另需提醒：这套接口属于 **U5「组织视图落盘」** 的完成。前端要接三视图，还得先解冻 **U3（书架降级）**，那是 [library-system-design.md](library-system-design.md) §10 的第 1 条。

## 16. 本文不做的事（划边界，防止范围蔓延）

- 不做文档级持久化（在 `datadb/kb.db`）、不做检索索引、不做 `target/` 提取结果。
- 不做组的权限/共享/多人协作（本地单机）。
- 不做 layout 的实时协同（WebSocket 推送）；多窗口靠 `409` + 重放解决。
- 不做自动整理（按标签自动建组）——先有人工结构，再谈自动化。
- 不改库目录结构、不改 `kb.json` 既有字段语义。
