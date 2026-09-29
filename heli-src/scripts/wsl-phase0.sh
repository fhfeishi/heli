#!/usr/bin/env bash
# Phase 0 收尾：必须在 WSL 原生 ext4 内执行。
#
# 为什么不能在 Windows 侧做：
#   1. 对 WSL 9P 挂载点（Z: 映射）的 rename / delete 一律被拦截（WinError 5 / safe-delete fail-closed）；
#   2. SQLite 在 9P 上完全不可写（database is locked），WAL 也不支持 —— 见 .knowledge/README.md 避坑 1。
#
# 用法（在 WSL 里）：bash heli-src/scripts/wsl-phase0.sh
set -euo pipefail

cd "$(dirname "$0")/../.."          # → 仓库根
KB=".knowledge/langchain_docs"

echo "== 0.4 清 ADS（:Zone.Identifier） =="
before=$(find .knowledge -name '*:Zone.Identifier' | wc -l)
find .knowledge -name '*:Zone.Identifier' -delete
echo "   清掉 $before 个；剩余 $(find .knowledge -name '*:Zone.Identifier' | wc -l) 个"

echo "== 0.2 一次性产物归位到 _scratch/ =="
mkdir -p "$KB/_scratch"
if [ -d "$KB/source_demo" ]; then
  mv "$KB/source_demo" "$KB/_scratch/source_demo"
  echo "   source_demo → _scratch/source_demo"
fi
if [ -d "$KB/archive" ]; then
  # archive/source 的内容已逐字节复制进 <kb>/source/（含 15 个导航原始件、已剔除 ADS），
  # 因此这里可以安全删除。执行前建议先确认：ls "$KB/source" | wc -l
  rm -rf "$KB/archive"
  echo "   archive/ 已删除"
fi

echo "== 清掉 Windows 侧删不掉的残留 =="
rm -rf "$KB/.__rn_test"
rm -f heli-src/_t.db "$KB/datadb/probe.db" "$KB/datadb/kb2.db" "$KB/datadb/_t.db"

echo "== 复核 =="
ls "$KB"
echo "source/ 文件数：$(find "$KB/source" -type f ! -name '*:Zone.Identifier' | wc -l)"

echo "== 补跑 3b 及之后的步骤（需要 SQLite，只能在 WSL 内跑） =="
echo "   python -m kbctl --root .knowledge --kb langchain_docs scan      # 3b 回写结构列"
echo "   python -m kbctl --root .knowledge --kb langchain_docs doctor    # 9 体检"
echo "   python -m kbctl --root .knowledge --kb langchain_docs pipeline  # 全链路（需先装 chromadb）"
