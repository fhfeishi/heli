# 角色与模型

全部经 **OpenCode → Magpie** 切换（可用环境变量覆盖）：

| 角色 | OpenCode model | 常驻职责 |
|------|----------------|----------|
| brief（统筹） | `magpie/auto/kimi-k3.1-pro` | 拆 goal → 本轮方案与验收；遇上层冲突时改方案 |
| engineer（干活） | `magpie/auto/deepseek-v4.1-flash#max` | 只按当前 `01-brief.md` 实施；需求疑问 → brief；严重冲突 → verifier |
| verifier（测调） | `magpie/codex/gpt-6.1-sol#medium` | 审 brief；按验收审产出；指出失败项与证据 |

也可用同系列其它 Magpie 路由（如 `magpie/workbuddy/...`、`magpie/trae-cn/...`），改环境变量即可。

## 怎么跑

```bash
cd ~/wslcodespace/heli
.fusion/run.sh brief 001
.fusion/run.sh engineer 001
.fusion/run.sh verifier 001
.fusion/run.sh loop 001
```

`BRIEF_MODEL` / `ENGINEER_MODEL` / `VERIFIER_MODEL` 可覆盖。

## 边界

- engineer **不要**自行改验收标准或扩大范围
- verifier **不要**替 engineer 写大段实现
- brief **不要**在未停 loop 时悄悄改已在测的验收；改方案写明修订或开新一轮
