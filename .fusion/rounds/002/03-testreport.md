# Test report — round 002

日期：2026-10-27
来源：用户派发的 verifier 任务；[本轮 brief](01-brief.md)、[engineer worklog](02-worklog.md)、工作区差异与独立检查
状态：现行（升级 brief，待裁定路由检查的既有失败）

## 方案审核（如本轮需要）

- P1 方案可实施，当前代码遵守 GroupStack 与 renderGroup 调用的范围，未扩展书架 P2、路由或 API。顶卡改为首个成员、删除高度额外 6px、hover 调整为 −3px / −1px / 0，均符合已授权目标。
- **整轮暂不能判过，升级 brief。** brief 第 31 行要求三个工程命令全部通过；当前 `check:routes` 的既有失败与叠卡无关，但 brief 没有豁免。verifier 不自行放宽验收，也不要求 engineer 越过范围修改路由检查。

## 对照验收

| 标准 | 结果 | 证据 |
|------|------|------|
| groupName + 读屏含组名与总数 | 通过 | [KnowledgeView.tsx](../../../heli-web/src/views/KnowledgeView.tsx) 第 335–357、1538–1542 行声明并传入 groupName。独立浏览器 snapshot 的按钮名称为「展开分组「自然科学基金」，共 11 个资料库」及两个单成员组的对应名称。此处验证无障碍名称，未运行读屏软件。 |
| 顶层为 members[0] | 通过 | 同文件第 347、364–377 行保留 slice 的原顺序，depth=0 的 zIndex=10、top=0。独立浏览器展开时首卡为「AI与材料」，折叠顶卡为同一库「自然科学基金-AI与材料」，读数 4 / 14；后两层 zIndex=9/8、top=11/22px，无文字且 aria-hidden=true。 |
| 最多 3 层；N≥4 同高；文案无重复 | 通过（代码、独立实测与交接证据） | 第 315–316、347–348、362–364、397–398 行：visible=min(N,3)，高度=104+11×(visible−1)，总数只用全部 libraries.length。独立测 N=11 为 3 层、126px，N=1 为 1 层、104px，文案无「另 M」。N=2/3/4/5 的直接对比采用 worklog 第 45–59 行的 engineer 实测记录，其中 N=3 与 N=4 都是 126px；verifier 未另建测试组重跑这些成员数。 |
| hover 不改文档流；减少动态无位移 | 通过 | 独立实测：未注入禁用过渡样式，hover 约 48.49ms 时顶/中层 translate 为 −2.2954/−0.765134px，300ms 后为 −3/−1px，底层 none；容器始终 126px。指针移到后层仍命中整叠，移出后 hover=false，高度不变。reduce 下三层 translate=none、transition-property=none，键盘焦点仍有 2px 轮廓，Space 可展开。未录制全程视频，不据离散采样声称全部帧均已检查。 |
| 标题/菜单键盘可达；叠卡单控件 | 通过 | 第 1400–1413、1433–1446 行保留原生标题及菜单按钮。实际从标题按 Tab 到「组操作」，再 Tab 到叠卡；叠卡轮廓为 2px solid，每叠内部无其他可聚焦控件。Enter 与 Space 分别展开 11 张库卡，标题 aria-expanded=true。 |
| typecheck / build / check:routes 通过 | **未通过，升级 brief** | verifier 在 heli-web 独立执行：`npm run typecheck` 退出码 **0**；`npm run build` 退出码 **0**；`npm run check:routes` 退出码 **1**（27 PASS、1 FAIL）。失败为 Paths.knowledge(card)：实际 `/knowledge?view=card`，期望 `/knowledge`。worklog 如实记录退出码。详见问题 1。 |
| diff 主要在 KnowledgeView.tsx | 通过（当前差异） | `git status --short` 仅有 `M heli-web/src/views/KnowledgeView.tsx` 与 `?? .fusion/`；源码 diff 仅 GroupStack 附近及 groupName 调用。`git diff --exit-code HEAD -- heli-web/src/app/router.tsx heli-web/scripts/check-routes.mjs heli-src` 退出码 **0**；`git diff --check` 退出码 **0**。未见新增依赖、LibraryCard/Spine/Row 或后端差异；当前差异不用于推断全部历史操作。 |

## 问题清单

1. **阻断整轮验收 · 既有路由检查与实现不一致，需要 brief 裁定。** [check-routes.mjs](../../../heli-web/scripts/check-routes.mjs) 第 89–91 行仍按 card 为默认视图断言不带查询串；[router.tsx](../../../heli-web/src/app/router.tsx) 第 23–27 行明确将显式三视图写进 URL，避免选择卡片后回到默认书架。运行检查即复现上述唯一失败。两文件与 HEAD `62f6e4ec107525910ddebdb4b05ea42a2889a7ee` 无差异，检查入口仅打包 router，不依赖 KnowledgeView，支持“非本轮叠卡回归”的判断；engineer 另在 HEAD worktree 复现相同失败（worklog 第 34–39 行）。建议 brief 明确授权修正过期期望值并同步第 89 行注释，随后重跑路由检查；或在停止本轮测评后明确修订验收，接受本轮既有失败。verifier 不直接替 brief 选豁免，也未修改检查断言。
2. **非阻断 · 证据范围。** 本次独立浏览器覆盖现有 1/11 成员组、1405px 桌面与 390px、hover 推进及后层命中、键盘和减少动态；2/3/4/5 成员、长中英文名、0 资料、导航及 shelf/list 展开采用 engineer worklog 的记录，未全部独立重跑。独立截图中桌面/窄屏未见叠卡遮挡标题或下一组，390px 的 document.scrollWidth=innerWidth=390。engineer 所述“过渡停在 0”在本次未复现，独立采样补足了过渡实际推进的证据。

## 检查与证据边界

- 审核基准为上述 HEAD 加当前未提交的 KnowledgeView 差异；只写本报告，未修改 brief、worklog、实现或检查脚本，未提交 git。按用户指定保留 `.fusion/rounds/002/03-testreport.md` 作为报告位置。
- 独立浏览器使用 **ego-browser** Space **9**、`http://127.0.0.1:8788/knowledge?view=card`；脚本位于 `C:/Users/10354/ego/heli-verifier-002-20261027/round-01.mjs` 至 `round-05.mjs`，结构化输出由本会话工具回执保存。首次 snapshot 尚在加载，后续数据加载后才进行验收。
- 已查看截图：[桌面 hover](/mnt/c/Users/10354/ego/heli-verifier-002-20261027/desktop-hover.png)、[390px 减少动态](/mnt/c/Users/10354/ego/heli-verifier-002-20261027/narrow-reduce.png)。实际文件在 Windows 上述目录（WSL 为 `/mnt/c/Users/10354/ego/heli-verifier-002-20261027/`），属于本机证据，未纳入版本控制；用户本轮发来的两张图片与它们一致。
- 本次未创建或修改资料组/资料库，仅通过现有标题和叠卡切换显示状态；结束前恢复三个组为展开状态。浏览器 Space 已 finish；验证服务已用 `bash launch.sh --stop` 停止。

## 结论

- [ ] 过
- [ ] 打回 engineer
- [x] 升级 brief

叠卡实现的已核对项目满足要求，未发现需要直接打回 engineer 的实现缺陷；整轮仍被明确要求通过的 `check:routes` 阻断。既有失败的修复范围或验收例外由 brief 明文裁定后，再对受影响项复验，不能将“非本轮引入”写成“三项检查已通过”。

## 下一步建议

- brief 接收问题 1，按 roles 边界先停止 loop，再写明修订或开新轮；若授权修改路由检查，交 engineer 处理过期期望与说明，保留现有显式 card URL 行为，verifier 随后复验。
- Ego Lite CLI 提示有可用更新；本次未升级，不影响上述已取得的证据。
