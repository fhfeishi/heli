@echo off
REM ==================================================================
REM  建立 / 修复 Z: 映射：Windows 盘符 -> WSL 项目目录
REM  用法：双击，或  scripts\mount-wsl.cmd
REM  说明：Z: 指向 WSL 根，项目在 Z:\home\<user>\wslcodespace\heli
REM ==================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

echo [heli] 读取 WSL 发行版...
set "DISTRO="
for /f "usebackq delims=" %%v in (`wsl.exe -l -q 2^>nul`) do (
  if not defined DISTRO (
    set "LINE=%%v"
    REM 去掉可能存在的 CR / NUL
    for /f "delims=" %%x in ("!LINE!") do set "DISTRO=%%x"
  )
)
if not defined DISTRO (
  echo     FAIL 没有可用的 WSL 发行版。先安装或启动一次 WSL。
  goto end
)
echo     发行版：%DISTRO%

set "TARGET=\\wsl.localhost\%DISTRO%"

echo.
echo [heli] 当前 Z: 状态
if exist Z:\home (
  echo     Z: 已映射，跳过重建。
  echo     如需重建： net use Z: /delete /y  然后重跑本脚本。
  goto verify
)
echo     Z: 未映射，开始建立 -> %TARGET%
net use Z: "%TARGET%" /persistent:yes
if errorlevel 1 (
  echo     FAIL 映射失败。可能已被占用：net use Z: /delete /y 后重试。
  goto end
)

:verify
echo.
echo [heli] 校验
if exist "Z:\home" (echo     OK   Z:\home 可访问) else (echo     FAIL Z:\home 不可访问)
set "FOUND="
for /d %%d in ("Z:\home\*") do (
  if exist "%%d\wslcodespace\heli\AGENTS.md" set "FOUND=%%d\wslcodespace\heli"
)
if defined FOUND (
  echo     OK   项目目录：!FOUND!
) else (
  echo     WARN 没在 Z:\home\*\wslcodespace\heli 找到 AGENTS.md
  echo          如果你的项目不在 ~/wslcodespace/heli，请手动核对路径。
)

:end
echo.
pause
exit /b 0
