/* 需要人工执行的命令集中在这里（审核第二批第 5 条）：
   界面上一律只给「复制命令」按钮，不在正文里平铺命令行。 */

export function searchIndexCommand(slug: string): string {
  return `python -m kbctl --root .knowledge --kb ${slug} v2-manage search-index`;
}
