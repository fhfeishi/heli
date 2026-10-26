#!/usr/bin/env bash
# Fusion runner: feed .fusion round files to OpenCode roles.
# Usage:
#   .fusion/run.sh brief [round]
#   .fusion/run.sh engineer [round]
#   .fusion/run.sh verifier [round]
#   .fusion/run.sh loop [round]     # brief → engineer → verifier (stops if verifier upgrades brief)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FUSION="$(cd "$(dirname "$0")" && pwd)"
ROLE="${1:-}"
ROUND="${2:-001}"
RDIR="$FUSION/rounds/$ROUND"
OPENCODE="${OPENCODE:-$HOME/.local/bin/opencode}"

# Models (override with env)
BRIEF_MODEL="${BRIEF_MODEL:-magpie/auto/kimi-k3.1-pro}"
ENGINEER_MODEL="${ENGINEER_MODEL:-magpie/auto/deepseek-v4.1-flash#max}"
VERIFIER_MODEL="${VERIFIER_MODEL:-magpie/codex/gpt-6.1-sol#medium}"

if [[ -z "$ROLE" || ! -d "$RDIR" ]]; then
  echo "usage: $0 brief|engineer|verifier|loop [round]" >&2
  echo "rounds: $(ls "$FUSION/rounds" 2>/dev/null | tr '\n' ' ')" >&2
  exit 2
fi
if [[ ! -x "$OPENCODE" ]]; then
  echo "opencode not found at $OPENCODE" >&2
  exit 127
fi

cd "$ROOT"

run_role() {
  local role="$1"
  local model prompt outfile title
  case "$role" in
    brief)
      model="$BRIEF_MODEL"
      outfile="$RDIR/01-brief.md"
      title="fusion-$ROUND-brief"
      prompt="$(cat <<EOF
你是 fusion 的 brief（统筹）。只通过文件协作，不要假设有共享聊天。

先读：
- .fusion/roles.md
- .fusion/README.md
- .fusion/rounds/$ROUND/01-brief.md
- 如有 .fusion/rounds/$ROUND/03-testreport.md 也读（上一轮结论）

任务：
1. 把「优先打磨卡片叠卡（GroupStack）」锁进本轮范围。
2. 对照现有 heli-web/src/views/KnowledgeView.tsx 里的 GroupStack，写出可执行增强清单（改哪里、怎么验收），写入 01-brief.md（可追加「实施方案 · 卡片叠卡」一节；不要删背景 goal）。
3. 本轮若仍约定不写业务代码，验收标准保持「方案质量」；若方案已够开工，在文末写明下一轮 round 编号与 engineer 第一刀改哪些函数。
4. 未决问题只保留仍未回答的。

写回文件：$outfile
EOF
)"
      ;;
    engineer)
      model="$ENGINEER_MODEL"
      outfile="$RDIR/02-worklog.md"
      title="fusion-$ROUND-engineer"
      prompt="$(cat <<EOF
你是 fusion 的 engineer（干活）。只按当前 brief 实施，不改验收标准、不扩大范围。

先读：
- .fusion/roles.md
- .fusion/rounds/$ROUND/01-brief.md
- .fusion/rounds/$ROUND/02-worklog.md

按 brief 的本轮范围工作。完成后更新 02-worklog.md（改动表、自测、偏差、是否可测）。
工作目录是 heli 仓库根。若 brief 写明本轮禁止改业务代码，则只做只读探路并记路径。

写回文件：$outfile
EOF
)"
      ;;
    verifier)
      model="$VERIFIER_MODEL"
      outfile="$RDIR/03-testreport.md"
      title="fusion-$ROUND-verifier"
      prompt="$(cat <<EOF
你是 fusion 的 verifier（测调）。对照验收标准审 brief/engineer 产出。

先读：
- .fusion/roles.md
- .fusion/rounds/$ROUND/01-brief.md
- .fusion/rounds/$ROUND/02-worklog.md
- .fusion/rounds/$ROUND/03-testreport.md

填写 03-testreport.md：方案审核（如需要）、对照验收表、问题清单、结论（过 / 打回 engineer / 升级 brief）。
需要时只读代码与跑检查；不要大段替 engineer 实现。

写回文件：$outfile
EOF
)"
      ;;
    *)
      echo "unknown role: $role" >&2
      exit 2
      ;;
  esac

  echo "==> $role  model=$model  round=$ROUND"
  # Attach role + round files so the model has them even if it skips reading.
  local files=(-f "$FUSION/roles.md" -f "$RDIR/01-brief.md")
  [[ -f "$RDIR/02-worklog.md" ]] && files+=(-f "$RDIR/02-worklog.md")
  [[ -f "$RDIR/03-testreport.md" ]] && files+=(-f "$RDIR/03-testreport.md")

  "$OPENCODE" run --auto -m "$model" --title "$title" "${files[@]}" -- "$prompt"
  echo "==> $role done (check $outfile)"
}

case "$ROLE" in
  loop)
    run_role brief
    run_role engineer
    run_role verifier
    ;;
  brief|engineer|verifier)
    run_role "$ROLE"
    ;;
  *)
    echo "usage: $0 brief|engineer|verifier|loop [round]" >&2
    exit 2
    ;;
esac
