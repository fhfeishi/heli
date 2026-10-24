---
name: heli-browser-check
description: Use when verifying heli's web UI in a real browser instead of headless screenshots. Covers how to reach ego-browser from WSL, how to start the dev server, and the checks worth running on this project's pages.
---

# 用真实浏览器验证 heli 界面

heli 的界面问题大多是「数据直接上屏」类——重复的说明文字、原样显示的
frontmatter、截断到认不出的标题。这类问题看代码看不出来，必须看渲染结果。
headless 截图能看静态样子，但测不了悬停、键盘、拖拽、点击后的导航；
这些用 ego-browser 在真实浏览器里跑。

通用 API 与脚本写法读全局 skill：`ego-browser skill`（或在
`~/.agents/skills/ego-browser/SKILL.md`）。本文只记本项目特有的部分。

## 从 WSL 调用

ego lite 只有 Windows/macOS 版（Linux 在 roadmap，无发布日期）。本机装在
Windows 侧，WSL 里没有 `ego-browser` 命令，直接调用 Windows 可执行文件：

```bash
EGO="/mnt/c/Users/$WINUSER/.local/share/ego/active_version_dir/ego-browser.exe"
cd /mnt/c   # 必须在 Windows 路径下运行，WSL 路径会被拒绝
"$EGO" skill          # 确认可用并读用法
```

`$WINUSER` 换成 Windows 用户名（`ls /mnt/c/Users/` 能看到）。
可执行文件路径可用 `cmd.exe /c "where ego-browser"` 确认。

脚本文件要写成 Windows 路径下的 `.mjs`，用 `cd /mnt/c && "$EGO" nodejs < 脚本`。
按全局 skill 的约定，每轮写新文件（`round-01.mjs`、`round-02.mjs`），不要改旧文件重跑。

## 已知坑

- **窗口最小化时截图失败**：`Cannot capture a screenshot while the window is
  minimized`。用 PowerShell 的 `ShowWindow(handle, 3)` 恢复窗口；或者这一轮
  只取 `page.evaluate()` 的结构化数据，视觉确认另用 headless Chromium。
- **`page.snapshot({ scope })` 只接受** `full_page` / `only_within_viewport` /
  `subtree`，写 `viewport` 会报错。
- **`:focus-visible` 不会因 JS `focus()` 触发**。测键盘可达性必须真的按
  `page.keyboard.press("Tab")`，否则拿到的是 `outline-style: none`，会误判成缺陷。
- **Tab 顺序较长**：heli 左侧导航 5 项 + 视图切换 3 项 + 新建 2 项 + 搜索 + 排序
  + 组标题 + 组菜单，第 15 步左右才到第一张卡片。少于这个步数就断言「Tab 到不了」
  是错的。

## 启动服务

```bash
bash launch.sh --stop; NO_OPEN=1 SKIP_BUILD=1 bash launch.sh   # 已有构建产物时
```

改了前端要重新构建（去掉 `SKIP_BUILD=1`，约 1 分钟）。服务在
`http://127.0.0.1:8788`，WSL 内可直接访问。

## 本项目值得跑的检查

按页面挑，不必每次全跑：

| 页面 | 检查什么 |
|---|---|
| `/knowledge?view=card` | 卡片高度与重复说明数量、悬停 spotlight、Tab 可达与焦点环、点卡进库、归档二次确认 |
| `/knowledge?view=shelf` | 书脊宽度在窄屏是否溢出、抽出书封是否出现 |
| `/knowledge/<lib>/doc/<src>` | 标题是否已拆成项目名、frontmatter 是否收进信息条、大纲是否存在且能定位 |
| `/artifacts/<id>` | 点引用是否展开证据面板、命中是否高亮并滚入视野、未保存修改时是否弹确认 |
| `/research` | 多选范围能否勾选、模板下拉是否含 report 模板 |
| `/settings` | 模板五类分栏、增删改是否生效 |

结构化断言示例（比截图更能说明问题）：

```js
const m = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("article[role=link]")];
  return {
    count: cards.length,
    height: Math.round(cards[0].getBoundingClientRect().height),
    repeatedDesc: cards.filter(c => c.innerText.includes("task schema")).length,
  };
});
```

## 收尾

**验证完必须停服务**：`bash launch.sh --stop`。

浏览器检查靠 `launch.sh` 起真实服务，忘了停就会一直占着 8788 在后台跑。
用户会发现，而不是你——所以收尾时主动确认一遍：

```bash
bash launch.sh --stop
ps aux | grep -F "app.py --port" | grep -v grep || echo "无残留进程"
ss -ltn | grep 8788 || echo "端口已释放"
```

注意：`pgrep -f "heli-src/app.py"` 会匹配到你自己那条命令行，
在没有服务时也会报「运行中」。用 `ps aux | grep -F` 配合 `grep -v grep`，
或者直接查端口。

测试产生的任务/成果会留在库里（后端没有删除任务的接口）。在交付说明里
写明它们的 id，不要假装清理过。
