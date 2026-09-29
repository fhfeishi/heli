/* ==================================================================
   右侧面板的目标编码（方案 §8.3）
   ------------------------------------------------------------------
   面板开关与可寻址的内容都写在 ?panel= 上，刷新与复制链接都能恢复。
   编码规则 `kind:id`：

   · 有稳定 id 的（artifact / task / kb / prompt / library）刷新后能重新解析
   · 只有内存对象的（doc / citation / template）刷新后无法还原，
     面板显示「内容未随链接保留」，不假装还在

   §8.2：面板本身按模块决定布局（资料库并排常驻、对话与研究任务浮层），
   这里只负责「打开什么」，不负责「怎么摆」。
   ================================================================== */

import type { PreviewTarget } from "../types";

export function encodePanel(target: NonNullable<PreviewTarget>): string {
  switch (target.kind) {
    case "artifact":
      return `artifact:${target.artifactId}`;
    case "task":
      return `task:${target.taskId}`;
    case "kb":
      return `kb:${target.kbId}`;
    case "prompt":
      return `prompt:${target.promptId}`;
    case "library":
      return `library:${target.slug}`;
    /* 内存对象：只记种类，刷新后无法还原内容 */
    case "doc":
      return "doc";
    case "citation":
      return `citation:${target.citation.index}`;
    case "template":
      return "template";
  }
}

/**
 * 反向解析。无法还原时返回 null —— 调用方据此显示「内容未随链接保留」，
 * 而不是渲染一个空面板让人以为加载失败。
 */
export function decodePanel(value: string | null): PreviewTarget {
  if (!value) return null;
  const at = value.indexOf(":");
  const kind = at < 0 ? value : value.slice(0, at);
  const id = at < 0 ? "" : value.slice(at + 1);
  switch (kind) {
    case "artifact":
      return id ? { kind: "artifact", artifactId: id } : null;
    case "task":
      return id ? { kind: "task", taskId: id } : null;
    case "kb":
      return id ? { kind: "kb", kbId: id } : null;
    case "prompt":
      return id ? { kind: "prompt", promptId: id } : null;
    case "library":
      return id ? { kind: "library", slug: id } : null;
    default:
      return null;
  }
}
