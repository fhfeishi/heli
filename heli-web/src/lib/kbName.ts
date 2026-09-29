/* ==================================================================
   知识库命名工具：成组书显示「去前缀子名」，
   分隔符集合与书架设计文档 §2.2 一致：- — – ： :
   ================================================================== */

const SEPARATOR = /[-—–：:]/;

export interface KbNameParts {
  /** 第一个分隔符之前的前缀；无分隔符时为空串 */
  prefix: string;
  /** 去前缀后的子名；无分隔符时为全名 */
  sub: string;
}

export function splitKbName(name: string): KbNameParts {
  const idx = name.search(SEPARATOR);
  if (idx <= 0) return { prefix: "", sub: name };
  const sub = name.slice(idx + 1).trim();
  return { prefix: name.slice(0, idx).trim(), sub: sub || name };
}

/** 两书同前缀时返回该前缀（作为成组的默认层名），否则 null */
export function commonKbPrefix(a: string, b: string): string | null {
  const pa = splitKbName(a).prefix;
  const pb = splitKbName(b).prefix;
  return pa && pa === pb ? pa : null;
}
