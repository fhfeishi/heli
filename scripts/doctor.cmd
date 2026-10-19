@echo off
REM heli 环境自检：Z: 映射、写操作能力、WSL 可达性
setlocal enabledelayedexpansion
chcp 65001 >nul
set "ROOT=%~dp0.."
set "PROBE=%ROOT%\.doctor-probe.txt"

echo ================ heli 环境自检 ================
echo.
echo [1] 项目目录
if exist "%ROOT%\AGENTS.md" (echo     OK   %ROOT%) else (echo     FAIL 找不到 %ROOT%\AGENTS.md)

echo.
echo [2] Z: 盘映射
for /f "tokens=2,*" %%a in ('net use Z: 2^>nul ^| findstr /i "Z:"') do echo     Z: -^> %%b
if not exist "Z:\home" echo     WARN 未映射到 WSL，运行 scripts\mount-wsl.cmd 建立

echo.
echo [3] 写操作实测
echo ok> "%PROBE%" 2>nul && (echo     OK   新建文件) || (echo     FAIL 新建失败)
echo ok2> "%PROBE%" 2>nul && (echo     OK   覆盖文件) || (echo     FAIL 覆盖失败)
del "%PROBE%" >nul 2>&1 && (echo     OK   删除文件) || (echo     FAIL 删除被拦 ^(safe-delete / 9P^) —— 用 WSL 内 rm（wsl.exe 已放行）)

echo.
echo [4] WSL
where wsl.exe >nul 2>&1 && (echo     OK   wsl.exe 在 PATH 中) || (echo     WARN 找不到 wsl.exe)
for /f "delims=" %%v in ('wsl.exe -l -q 2^>nul') do echo     发行版: %%v
echo     （WSL 内的项目路径一般是 ~/wslcodespace/heli）

echo.
echo ==============================================
pause
