@echo off
REM ==================================================================
REM  解除 Agent 对 wsl.exe 的限制（改 settings.json 的 sandbox.programBlacklist）
REM  双击运行；幂等，自动备份。改完需重启 WorkBuddy 才生效。
REM ==================================================================
setlocal
chcp 65001 >nul

echo [heli] 正在调整 Security Center 程序黑名单...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-wsl.ps1"
if errorlevel 1 goto fail

echo.
pause
exit /b 0

:fail
echo.
echo [heli] 失败。可手动检查：
echo        %%USERPROFILE%%\.workbuddy\settings.json
echo        里的 sandbox.programBlacklist 是否为一个不含 wsl.exe 的字符串数组。
pause
exit /b 1
