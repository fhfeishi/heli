# scripts · 本机环境脚本

这里放「Windows 侧做不到、需要在 WSL 或应用外执行」的操作入口。
原理与能力矩阵见 [`.logsdev/pipeline_workbuddy_wsl.md`](../.logsdev/pipeline_workbuddy_wsl.md)。

## 现有脚本

| 文件 | 作用 | 运行位置 |
|---|---|---|
| `mount-wsl.cmd` | 建立/修复 `Z:` → `\\wsl.localhost\<发行版>` 映射，并校验项目路径 | Windows |
| `enable-wsl.cmd` / `.ps1` | 从程序黑名单移除 `wsl.exe`（幂等、自动备份，需重启 WorkBuddy） | Windows |
| `doctor.cmd` | 诊断：Z: 映射目标、项目目录、新建/覆盖/删除三种写操作、WSL 发行版 | Windows |

## Z: 映射

```cmd
scripts\mount-wsl.cmd
```

读取当前发行版 → `net use Z: ... /persistent:yes` → 校验 `Z:\home\<user>\wslcodespace\heli\AGENTS.md`。
已映射时只做校验，不重建。

## 让 Agent 直接操作 WSL

```cmd
scripts\enable-wsl.cmd
```

写 `%USERPROFILE%\.workbuddy\settings.json` 的 `sandbox.programBlacklist`：该键存在即整体替换内置默认值，
脚本只去掉 `wsl.exe`，其余 5 个敏感程序继续受限。**完全重启 WorkBuddy 才生效**。

## 自检

```cmd
scripts\doctor.cmd
```

遇到「文件删不掉 / 页面起不来」先跑它，不要猜。

## 已移除

`cleanup-legacy.sh` / `cleanup-legacy.cmd` 于 2026-10-19 删除：v4 之前的旧代码已全部清理完毕，
固定清单里的对象不再存在。以后要删东西，直接在 WSL 内 `rm`（`wsl.exe` 已放行），不需要再走脚本。
