import type { ChatMessage } from "../types";

/** 毫秒 → 展示用秒数：一分钟内保留一位小数，超过则取整 */
export function fmtSec(ms: number): string {
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

/** 千分位 token 数 */
export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

/** `[[3]]` → `[3]`，保留引用编号但去掉自定义标记 */
const inlineCites = (text: string) => text.replace(/\[\[(\d+)\]\]/g, "[$1]");

/**
 * 把一条回答序列化成 Markdown。
 * 这是「复制为 Markdown」的唯一实现 —— 复制、导出、外发都走它，
 * 保证用户拿到的文本和界面上看到的结构一致。
 */
export function messageToMarkdown(message: ChatMessage): string {
  if (message.role === "user") return message.text ?? "";

  const parts: string[] = [];

  for (const block of message.blocks ?? []) {
    switch (block.kind) {
      case "h":
        parts.push(`## ${block.text}`);
        break;
      case "p":
        parts.push(inlineCites(block.text));
        break;
      case "list":
        parts.push(block.items.map((item) => `- ${inlineCites(item)}`).join("\n"));
        break;
      case "table": {
        const head = `| ${block.columns.join(" | ")} |`;
        const divider = `| ${block.columns.map(() => "---").join(" | ")} |`;
        const rows = block.rows.map((row) => `| ${row.join(" | ")} |`);
        parts.push([head, divider, ...rows].join("\n"));
        break;
      }
      case "report":
        parts.push(`> 产出文件：${block.fileName}（${block.meta.join(" · ")}）`);
        break;
    }
  }

  if (message.citations?.length) {
    parts.push(
      ["### 参考来源", ...message.citations.map((c) => `${c.index}. ${c.docName} ${c.page}（相关度 ${c.score}）`)].join(
        "\n",
      ),
    );
  }

  if (message.metrics) {
    const m = message.metrics;
    parts.push(
      `> 首 token ${fmtSec(m.firstTokenMs)} · 思考 ${fmtSec(m.thinkingMs)} · ` +
        `${fmtNum(m.inputTokens + m.outputTokens)} tokens（入 ${fmtNum(m.inputTokens)} / 出 ${fmtNum(m.outputTokens)}）`,
    );
  }

  return parts.join("\n\n");
}

/** 复制到剪贴板；剪贴板 API 不可用时退回 execCommand */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走降级路径 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
