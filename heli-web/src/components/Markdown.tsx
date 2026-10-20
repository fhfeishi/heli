/* 极简 Markdown 渲染：只覆盖成果正文用到的语法，零依赖。
 *
 * 不用 dangerouslySetInnerHTML —— 正文来自模型，必须当不可信文本处理；
 * 所有内容走 React 节点，等于免费拿到转义。
 */
import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\n]+\)|\[\d{1,3}\])/g;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;

function inline(text: string, prefix: string): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part !== "");
  return parts.map((part, index) => {
    const key = `${prefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded-xs bg-surface-soft px-3 py-[1px] font-mono text-[0.9em] text-charcoal">
          {part.slice(1, -1)}
        </code>
      );
    }
    const cite = /^\[(\d{1,3})\]$/.exec(part);
    if (cite) {
      return (
        <span key={key}
          className="ml-2 inline-block rounded-pill bg-tint-lav px-3 text-[10px] font-medium leading-none text-on-tint-lav align-[0.35em]">
          {cite[1]}
        </span>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = link[2];
      const safe = /^(https?:|mailto:|\/)/i.test(href);
      return safe ? (
        <a key={key} href={href} target="_blank" rel="noreferrer"
          className="text-primary underline underline-offset-2">{link[1]}</a>
      ) : (
        <Fragment key={key}>{link[1]}</Fragment>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function cellsOf(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    // 代码块
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={key++}
          className="my-12 overflow-x-auto rounded-md border border-hairline bg-surface-soft p-12 font-mono text-meta leading-[1.7] text-charcoal">
          {body.join("\n")}
        </pre>,
      );
      continue;
    }

    // 标题
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `h${key}`);
      const size = level === 1 ? "text-h3" : level === 2 ? "text-title" : "text-body";
      const top = level <= 2 ? "mt-24" : "mt-18";
      blocks.push(
        <p key={key++} className={`${top} mb-8 font-semibold ${size} text-ink`}>{content}</p>,
      );
      index += 1;
      continue;
    }

    // 分隔线
    if (RULE.test(line)) {
      blocks.push(<hr key={key++} className="my-18 border-0 border-t border-hairline" />);
      index += 1;
      continue;
    }

    // 表格：当前行以 | 开头且下一行是分隔行
    if (line.trim().startsWith("|") && (lines[index + 1] ?? "").includes("---")) {
      const header = cellsOf(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(cellsOf(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={key++} className="my-14 overflow-x-auto rounded-md border border-hairline">
          <table className="w-full border-collapse text-meta">
            <thead className="bg-surface-soft">
              <tr>
                {header.map((cell, position) => (
                  <th key={position}
                    className="border-b border-hairline px-10 py-7 text-left font-semibold text-charcoal">
                    {inline(cell, `th${key}-${position}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="even:bg-surface-soft/40">
                  {row.map((cell, position) => (
                    <td key={position}
                      className="border-b border-hairline-soft px-10 py-7 align-top leading-[1.65] text-charcoal last:border-r-0">
                      {inline(cell, `td${key}-${rowIndex}-${position}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 引用块（连续 > 行，去掉前缀后递归渲染）
    if (line.trimStart().startsWith(">")) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trimStart().startsWith(">")) {
        body.push(lines[index].trimStart().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={key++}
          className="my-12 rounded-md border-l-2 border-hairline bg-surface-soft/60 px-14 py-10 text-meta text-stone">
          <Markdown text={body.join("\n")} className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0" />
        </blockquote>,
      );
      continue;
    }

    // 列表（无序 / 有序，连续行合并成一个列表）
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index]);
        if (!match) break;
        items.push(ordered ? match[3] : match[2]);
        index += 1;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={key++}
          className={`my-10 space-y-4 pl-18 text-body leading-[1.75] text-charcoal ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, position) => (
            <li key={position}>{inline(item, `li${key}-${position}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }

    // 段落：吃到空行或下一个块级标记
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (!current.trim()) break;
      if (HEADING.test(current) || RULE.test(current) || current.trimStart().startsWith("```")
        || current.trimStart().startsWith(">") || BULLET.test(current) || NUMBERED.test(current)) {
        break;
      }
      if (current.trim().startsWith("|") && (lines[index + 1] ?? "").includes("---")) break;
      paragraph.push(current.trim());
      index += 1;
    }
    if (paragraph.length) {
      blocks.push(
        <p key={key++} className="my-9 text-body leading-[1.8] text-charcoal">
          {inline(paragraph.join(" "), `p${key}`)}
        </p>,
      );
    } else {
      index += 1; // 保险：避免空转
    }
  }

  return <div className={className}>{blocks}</div>;
}
