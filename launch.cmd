@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
rem heli 一键启动（Windows 入口）：优先转交 WSL 执行 launch.sh，否则在本机原生启动。
rem
rem   launch.cmd                 默认 8788
rem   launch.cmd --port 18765    换端口
rem   set PORT=18765 & launch.cmd
rem
rem 开关：PORT / SKIP_BUILD=1 / NO_OPEN=1

set "ROOT=%~dp0"
set "PORT=%PORT%"
if not defined PORT set "PORT=8788"
set "SKIP_BUILD=%SKIP_BUILD%"
if not defined SKIP_BUILD set "SKIP_BUILD=0"
set "NO_OPEN=%NO_OPEN%"
if not defined NO_OPEN set "NO_OPEN=0"

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--port" (set "PORT=%~2" & shift & shift & goto parse)
if /i "%~1"=="-p" (set "PORT=%~2" & shift & shift & goto parse)
if /i "%~1"=="--no-build" (set "SKIP_BUILD=1" & shift & goto parse)
if /i "%~1"=="--no-open" (set "NO_OPEN=1" & shift & goto parse)
if /i "%~1"=="-h" goto help
if /i "%~1"=="--help" goto help
echo [launch] 未知参数：%~1
goto help

:parsed
echo [launch] 端口：%PORT%   项目：%ROOT%

rem ------------------------------------------------------------ WSL 转发
rem 后端要对资料库加文件锁，Windows 侧对 WSL 目录（9P）无法加锁，因此在 WSL 内跑更稳。
where wsl.exe >nul 2>nul
if errorlevel 1 goto native

set "WSLROOT="
for /f "usebackq delims=" %%i in (`wsl.exe wslpath -u "%ROOT:~0,-1%" 2^>nul`) do set "WSLROOT=%%i"
if not defined WSLROOT goto native

rem wslpath 不认识 Z: 这类盘符映射，会把 Windows 路径原样返回。
rem Z: 通常就是 WSL 根（\\wsl.localhost\<发行版>），这时手工换算成 /home/...
echo !WSLROOT! | findstr /r /c:"^[A-Za-z]:" >nul
if not errorlevel 1 (
  set "WSLROOT=!WSLROOT:\=/!"
  set "WSLROOT=!WSLROOT:~2!"
)

rem 换算结果必须在 WSL 里真的存在，否则宁可报错，也不要启动一个空目录
set "WSLCHECK="
for /f "usebackq delims=" %%i in (`wsl.exe bash -c "cd '!WSLROOT!' 2>/dev/null && pwd" 2^>nul`) do set "WSLCHECK=%%i"
if not defined WSLCHECK (
  echo [launch] WSL 内找不到项目目录：!WSLROOT!
  echo          请确认项目在 WSL 的 ~/wslcodespace/heli，或进 WSL 手动执行 bash launch.sh
  exit /b 1
)

echo [launch] 转交 WSL 执行：!WSLCHECK!
wsl.exe bash -c "export PATH=\"$HOME/.local/bin:$PATH\"; cd '!WSLCHECK!' && PORT=%PORT% SKIP_BUILD=%SKIP_BUILD% NO_OPEN=%NO_OPEN% bash launch.sh"
goto :eof

rem -------------------------------------------------------- 本机原生启动
:native
echo [launch] 未走 WSL，在 Windows 本机启动。
if not "%ROOT:~0,2%"=="\\" echo [launch] 提示：资料库若在 WSL 目录（9P/网络盘），Windows 下加锁会失败，建议改用 WSL 执行 launch.sh。

set "PY="
if defined HELI_PYTHON (
  set "PY=%HELI_PYTHON%"
  echo [launch] 使用 HELI_PYTHON 指定的解释器：%PY%
  goto havepy
)
if defined VIRTUAL_ENV if exist "%VIRTUAL_ENV%\Scripts\python.exe" set "PY=%VIRTUAL_ENV%\Scripts\python.exe"
if not defined PY if exist "%ROOT%.venv\Scripts\python.exe" set "PY=%ROOT%.venv\Scripts\python.exe"

if defined PY goto havepy
rem .venv 在但没有 Windows 版 python.exe = 它多半是 WSL 建的 Linux 环境，重建会破坏它
if exist "%ROOT%.venv" (
  echo [launch] .venv 已存在，但里面没有 Windows 可用的 python.exe。
  echo          它多半是在 WSL 里创建的 Linux 环境，重建会破坏它。
  echo          请在 WSL 内执行 launch.sh，或用 HELI_PYTHON 指定解释器。
  exit /b 1
)
where uv >nul 2>nul
if errorlevel 1 (
  echo [launch] 没有可用的 .venv，也没装 uv。安装 uv：
  echo           powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  exit /b 1
)
echo [launch] 用 uv 创建 .venv（python 3.12）
uv venv --seed --python 3.12 "%ROOT%.venv"
if errorlevel 1 exit /b 1
set "PY=%ROOT%.venv\Scripts\python.exe"

:havepy
if not exist "%PY%" (
  echo [launch] Python 不可用：%PY%
  exit /b 1
)
echo [launch] Python：%PY%

set "PYTHONPATH=%ROOT%heli-src"
rem 传 --data 会盖掉 .env 的 HELI_DATA，只有外部显式设置时才传
set "DATA_ARG="
if defined HELI_DATA set "DATA_ARG=--data "%HELI_DATA%""
pushd "%ROOT%heli-src"
"%PY%" -c "import app"
if errorlevel 1 (
  popd
  echo [launch] 当前 Python 无法导入后端模块，请激活正确环境后重试。
  exit /b 1
)
popd

rem ---------------------------------------------------------- 构建前端
if "%SKIP_BUILD%"=="1" goto checkdist
where node >nul 2>nul
if errorlevel 1 goto nonode
pushd "%ROOT%heli-web"
if not exist node_modules\vite (
  where npm >nul 2>nul
  if errorlevel 1 (
    popd
    echo [launch] 缺少 node_modules 且未找到 npm，无法构建前端。
    exit /b 1
  )
  echo [launch] 安装前端依赖（npm install）
  npm install --no-audit --no-fund
  if errorlevel 1 (popd & exit /b 1)
)
echo [launch] 构建前端（vite build）
node node_modules\typescript\bin\tsc --noEmit
if errorlevel 1 (popd & exit /b 1)
node node_modules\vite\bin\vite.js build
if errorlevel 1 (popd & exit /b 1)
popd
goto checkdist

:nonode
echo [launch] 未找到 node，跳过构建，使用现有产物。

:checkdist
if not exist "%ROOT%heli-web\dist\index.html" (
  echo [launch] 没有前端产物：%ROOT%heli-web\dist\index.html
  exit /b 1
)

rem -------------------------------------------------------------- 启动
if "%NO_OPEN%"=="1" goto start
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:%PORT%/'"

:start
echo [launch] 启动：http://127.0.0.1:%PORT%/
echo [launch] 停止：Ctrl + C
pushd "%ROOT%heli-src"
"%PY%" "%ROOT%heli-src\app.py" %DATA_ARG% --port %PORT% --web "%ROOT%heli-web\dist"
popd
goto :eof

:help
echo 用法：launch.cmd [选项]
echo   --port, -p ^<端口^>    监听端口，默认 8788（也可用 set PORT=18765）
echo   --no-build           跳过前端构建，使用 heli-web\dist 现有产物
echo   --no-open            启动后不自动打开浏览器
echo   -h, --help           显示本说明
echo 环境变量：PORT  SKIP_BUILD  NO_OPEN  HELI_PYTHON
exit /b 0
