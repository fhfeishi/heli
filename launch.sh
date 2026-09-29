#!/usr/bin/env bash
# heli 一键启动：选/建虚拟环境 → 构建前端 → 用同一个端口同时提供页面与 /api。
#
#   bash launch.sh                 # 默认 8011
#   PORT=18765 bash launch.sh      # 换端口
#   SKIP_BUILD=1 bash launch.sh    # 前端没改，跳过构建
#
# 可用开关：PORT / KNOWLEDGE_ROOT / SKIP_BUILD / NO_TYPECHECK / NO_OPEN
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8011}"
KB_ROOT="${KNOWLEDGE_ROOT:-}"   # 留空 = 交给 kbctl.config 按 .env 解析（见第 1 步末尾）
WEB_DIR="$ROOT/heli-web/dist"
SKIP_BUILD="${SKIP_BUILD:-0}"
NO_TYPECHECK="${NO_TYPECHECK:-0}"
NO_OPEN="${NO_OPEN:-0}"

if [ -t 1 ]; then
  C1=$'\033[36m'; C2=$'\033[33m'; C3=$'\033[31m'; C0=$'\033[0m'
else
  C1=""; C2=""; C3=""; C0=""
fi
log()  { printf '%s[launch]%s %s\n' "$C1" "$C0" "$*"; }
warn() { printf '%s[launch]%s %s\n' "$C2" "$C0" "$*" >&2; }
die()  { printf '%s[launch]%s %s\n' "$C3" "$C0" "$*" >&2; exit 1; }

usage() {
  cat <<'TXT'
用法：bash launch.sh [选项]

  --port, -p <端口>   监听端口，默认 8011（也可用 PORT=18765 bash launch.sh）
  --no-build          跳过前端构建，直接使用 heli-web/dist 现有产物
  --no-typecheck      构建时跳过 tsc --noEmit
  --no-open           启动后不尝试打开浏览器
  -h, --help          显示本说明

环境变量：PORT  KNOWLEDGE_ROOT  SKIP_BUILD  NO_TYPECHECK  NO_OPEN  HELI_PYTHON
         库根缺省按 环境变量 → 项目根 .env 的 KNOWLEDGE_ROOT 解析；Windows/WSL 两种写法都收。python -m kbctl.config 可查看当前解析结果。
TXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port|-p)     PORT="${2:-}"; [ -n "$PORT" ] || die "--port 缺少取值"; shift 2 ;;
    --no-build)    SKIP_BUILD=1; shift ;;
    --no-typecheck) NO_TYPECHECK=1; shift ;;
    --no-open)     NO_OPEN=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "未知参数：$1（--help 查看用法）" ;;
  esac
done

case "$PORT" in
  ''|*[!0-9]*) die "端口必须是数字：'$PORT'" ;;
esac

# 相对路径一律按项目根解析，避免后面 cd 到 heli-src 后指向错位置
case "$KB_ROOT" in
  /*|\\\\*|[A-Za-z]:*) ;;                 # POSIX 绝对、UNC、盘符都算绝对路径
  '') ;;                                # 空值留给下面用 config 解析
  *) KB_ROOT="$ROOT/$KB_ROOT" ;;        # 其余按项目根解析
esac

# ---------------------------------------------------------------- 1. Python
# 候选：当前已激活的虚拟环境 → 项目根 .venv（Linux 与 Windows 两种布局）
py_ok() { [ -n "${1:-}" ] && [ -x "$1" ] && "$1" -c 'import sys' >/dev/null 2>&1; }

pick_python() {
  local c
  if [ -n "${VIRTUAL_ENV:-}" ]; then
    for c in "$VIRTUAL_ENV/bin/python" "$VIRTUAL_ENV/Scripts/python.exe" "$VIRTUAL_ENV/Scripts/python"; do
      py_ok "$c" && { printf '%s' "$c"; return 0; }
    done
    warn "已激活的 VIRTUAL_ENV（$VIRTUAL_ENV）里没有可用的 python，改用项目 .venv"
  fi
  for c in "$ROOT/.venv/bin/python" "$ROOT/.venv/Scripts/python.exe" "$ROOT/.venv/Scripts/python"; do
    py_ok "$c" && { printf '%s' "$c"; return 0; }
  done
  return 1
}

PY=""
if [ -n "${HELI_PYTHON:-}" ]; then
  py_ok "$HELI_PYTHON" || die "HELI_PYTHON 指向的解释器不可用：$HELI_PYTHON"
  PY="$HELI_PYTHON"
  log "使用 HELI_PYTHON 指定的解释器"
else
  PY="$(pick_python || true)"
fi
if [ -z "$PY" ]; then
  # .venv 在但执行不了 = 它是另一套系统建的（本项目 .venv 是 WSL 里的 Linux 环境）。
  # 这时 uv 重建会把那套环境弄坏，所以只报错、不重建。
  if [ -e "$ROOT/.venv" ]; then
    die "$ROOT/.venv 已存在，但当前环境执行不了里面的 python（通常是另一套系统创建的）。
     请在创建它的环境里运行本脚本（本项目后端需要在 WSL 内运行）；
     或用 HELI_PYTHON=<解释器路径> bash launch.sh 另行指定。"
  fi
  if command -v uv >/dev/null 2>&1; then
    log "未发现可用虚拟环境，用 uv 创建 $ROOT/.venv（python 3.12）"
    (cd "$ROOT" && uv venv --seed --python 3.12 .venv) || die "创建虚拟环境失败"
  else
    die "既没有可用的 .venv，也没装 uv。先安装 uv：
       curl -LsSf https://astral.sh/uv/install.sh | sh
     或手动创建：$ROOT/.venv"
  fi
  PY="$(pick_python || true)"
  [ -n "$PY" ] || die "虚拟环境已创建但找不到可执行的 python：$ROOT/.venv"
fi
log "Python：$PY（ $("$PY" -c 'import sys;print(".".join(map(str,sys.version_info[:3])))') ）"

[ -d "$ROOT/heli-src/kbctl" ] || die "找不到后端目录：$ROOT/heli-src/kbctl"
# 后端只依赖标准库，但导入一次才知道环境是否完整（chromadb 等在用到时才懒加载）
(cd "$ROOT/heli-src" && PYTHONPATH="$ROOT/heli-src" "$PY" -c 'import kbctl.server') \
  || die "当前 Python 无法导入 kbctl，请激活正确的环境后再启动"

# 没显式给 KNOWLEDGE_ROOT 时，按 kbctl.config 的优先级解析（环境变量 > 项目根 .env）
if [ -z "$KB_ROOT" ]; then
  KB_ROOT="$(PYTHONPATH="$ROOT/heli-src" "$PY" -m kbctl.config --print-root 2>/dev/null || true)"
  if [ -z "$KB_ROOT" ]; then
    KB_ROOT="$ROOT/.knowledge"
    warn "config 未能解析库根，回退到 $KB_ROOT；可在项目根 .env 写 KNOWLEDGE_ROOT=<路径>"
  fi
fi

case "$KB_ROOT" in
  /*|\\\\*|[A-Za-z]:*) ;;
  *) KB_ROOT="$ROOT/$KB_ROOT" ;;
esac

[ -d "$KB_ROOT" ] || warn "资料库目录不存在：$KB_ROOT（服务会拒绝启动，可用 KNOWLEDGE_ROOT 指定或改 .env）"

# ------------------------------------------------------------ 2. 构建前端
build_web() {
  if [ "$SKIP_BUILD" = "1" ]; then
    [ -f "$WEB_DIR/index.html" ] || die "SKIP_BUILD=1 但 $WEB_DIR/index.html 不存在"
    log "SKIP_BUILD=1，使用现有构建产物"
    return
  fi
  if ! command -v node >/dev/null 2>&1; then
    if [ -f "$WEB_DIR/index.html" ]; then
      warn "未找到 node，跳过构建，沿用现有 $WEB_DIR"
      return
    fi
    die "未找到 node，且没有可用构建产物，无法启动页面"
  fi
  cd "$ROOT/heli-web"
  if [ ! -d node_modules/vite ]; then
    command -v npm >/dev/null 2>&1 || die "缺少 node_modules 且未找到 npm，无法安装前端依赖"
    log "安装前端依赖（npm install）"
    npm install --no-audit --no-fund
  fi
  # 直接跑 JS 入口：node_modules/.bin 里的 shim 在跨系统（WSL/Windows）场景下会失效
  if [ "$NO_TYPECHECK" != "1" ] && [ -f node_modules/typescript/bin/tsc ]; then
    log "类型检查（tsc --noEmit）"
    node node_modules/typescript/bin/tsc --noEmit || die "类型检查未通过（可用 NO_TYPECHECK=1 跳过）"
  fi
  log "构建前端（vite build）"
  node node_modules/vite/bin/vite.js build || die "前端构建失败"
  [ -f "$WEB_DIR/index.html" ] || die "构建结束但没有产物：$WEB_DIR/index.html"
}
build_web

# -------------------------------------------------------------- 3. 启动
URL="http://127.0.0.1:$PORT/"
if [ "$NO_OPEN" != "1" ]; then
  (
    sleep 1
    for opener in wslview xdg-open open; do
      command -v "$opener" >/dev/null 2>&1 && { "$opener" "$URL" >/dev/null 2>&1 & exit 0; }
    done
    command -v powershell.exe >/dev/null 2>&1 && powershell.exe -NoProfile -Command "Start-Process '$URL'" >/dev/null 2>&1
  ) >/dev/null 2>&1 &
fi

cd "$ROOT/heli-src"
export PYTHONPATH="$ROOT/heli-src"
log "启动：$URL  资料库：$KB_ROOT"
log "停止：Ctrl + C"
exec "$PY" -m kbctl.server --root "$KB_ROOT" --port "$PORT" --web "$WEB_DIR"
