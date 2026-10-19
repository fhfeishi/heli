# 三层分工指引（Strata 侧文档快照）

> 外部快照：2026-10-17 复制自 `D:/secret/notenote/Strata/index.md`。
> **权威在 Strata 仓库**，本文不随它更新，只作 heli 侧理解上下文的参考；有冲突以 Strata 原文为准。

# 三层分工指引：Strata × .knowledge × heli

> 本文是**当前指引，不是定稿**：只明确大致分工，细节随 heli 开发进度调整。
> heli 仍在开发中、整体架构还在完善；本文不涉及其内部设计，接口与库结构以 heli 项目文档为准。
> 本仓库的维护规则仍以 [AGENTS.md](AGENTS.md)、[README.md](README.md) 为准。

## 1. 大致分工

| 层 | 载体 | 干什么 | 
|---|---|---|
| 人的知识 | Strata（本仓库，Obsidian） | 提炼后的理解、判断、方法；人阅读与写作的地方 |  
| 机器资料 | `E:\local_db\.knowledge`（本地目录） | 原始资料与检索索引，供 agent 查找证据 |  
| 管理系统（未完成的设计） | heli（`Z:\home\baheas\wslcodespace\heli`） | 管上面那个资料目录：接入、索引、检索、呈现 | 

一句话：Strata 是人的笔记本，`.knowledge` 是资料仓库，heli 是管仓库的工具。内容只在一个地方是权威。

早年被删的 `Knowledge/` 目录**不恢复**——它的职责现在由 `.knowledge` 这个外部目录承担，AGENTS.md 的禁令继续有效。

## 2. 东西放哪（大致判断）

1. 人写的结论、理解 → Strata（`Aaevum/` / `Collections/` / `Solutions/`）。
2. agent 以后要检索的原文资料 → `.knowledge` 里的某个库。
3. 只是人翻翻的外部参考 → Strata `Resources/`；需要被检索时再考虑入库。

拿不准的先放 Strata，迁移成本低。

## 3. 目前的协作方式

```text
agent 搜寻 → Bot-Reports（Strata 存档）
                │ 需要检索时，副本入 .knowledge 的库
                ▼
        agent 经 heli 查证据 → 带回 Strata 写成结论
```

原文档案以 Strata 为准；写结论引用证据时注明来源，方便回溯。具体入库操作随 heli 完善再细化，现在不必定死。

## 4. 下一步（不紧急，随 heli 进度推进）

- [ ] heli 侧把 `Bot-Reports/` 接入为一个库（待 heli 能力就绪）
- [ ] Strata `Collections/` 视需要归纳 Bot 调研结论
- [ ] heli 架构稳定后，回看本文哪些"大致"可以落实

## 5. 相关文档

- [AGENTS.md](AGENTS.md)、[README.md](README.md) — 本仓库约束与五部分职责
- `E:\local_db\.knowledge\README.md` — 资料库架构（heli 侧维护）
- heli 项目文档 — 管理系统的设计与进度
