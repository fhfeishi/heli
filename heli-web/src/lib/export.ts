import type { AnswerBlock, Artifact, ChatMessage, Citation } from "../types";

/* ==================================================================
   导出工具：Markdown 与 Word。
   原型阶段在浏览器端生成；接后端后可换成 apiExportArtifact()，
   由服务端渲染真正的 .docx。
   ================================================================== */

const stripCite = (text: string) => text.replace(/\[\[(\d+)\]\]/g, "[$1]");

export function blocksToMarkdown(blocks: AnswerBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "h":
        parts.push(`## ${b.text}`);
        break;
      case "p":
        parts.push(stripCite(b.text));
        break;
      case "list":
        parts.push(b.items.map((i) => `- ${stripCite(i)}`).join("\n"));
        break;
      case "table":
        parts.push(
          [
            `| ${b.columns.join(" | ")} |`,
            `| ${b.columns.map(() => "---").join(" | ")} |`,
            ...b.rows.map((r) => `| ${r.join(" | ")} |`),
          ].join("\n"),
        );
        break;
      case "report":
        parts.push(`> 产出文件：${b.fileName}（${b.meta.join(" · ")}）`);
        break;
    }
  }
  return parts.join("\n\n");
}

export function citationsToMarkdown(citations?: Citation[]): string {
  if (!citations?.length) return "";
  return [
    "## 参考来源",
    ...citations.map(
      (c) => `${c.index}. ${c.docName} ${c.page} · 相关度 ${c.score}\n   ${c.snippet}`,
    ),
  ].join("\n");
}

export function artifactToMarkdown(artifact: Artifact): string {
  const head = [
    `# ${artifact.title}`,
    "",
    `- 形态：${artifact.type}`,
    `- 来源：${artifact.origin}`,
    artifact.taskTitle ? `- 关联任务：${artifact.taskTitle}` : "",
    `- 引用：${artifact.citationCount} 处`,
    `- 更新时间：${artifact.updatedAt}`,
  ]
    .filter(Boolean)
    .join("\n");
  return [head, "", blocksToMarkdown(artifact.blocks), citationsToMarkdown(artifact.citations)]
    .filter(Boolean)
    .join("\n\n");
}

export function messageToMarkdownFull(message: ChatMessage): string {
  return [blocksToMarkdown(message.blocks ?? []), citationsToMarkdown(message.citations)]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------- Word ------ */

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

function blocksToHtml(blocks: AnswerBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "h":
          return `<h2>${escapeHtml(b.text)}</h2>`;
        case "p":
          return `<p>${escapeHtml(stripCite(b.text))}</p>`;
        case "list":
          return `<ul>${b.items.map((i) => `<li>${escapeHtml(stripCite(i))}</li>`).join("")}</ul>`;
        case "table":
          return [
            "<table>",
            `<tr>${b.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`,
            ...b.rows.map(
              (r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`,
            ),
            "</table>",
          ].join("");
        case "report":
          return `<p class="note">产出文件：${escapeHtml(b.fileName)}（${escapeHtml(b.meta.join(" · "))}）</p>`;
      }
    })
    .join("\n");
}

/** 生成 Word 可打开的 HTML 文档（真实 .docx 由服务端渲染） */
export function buildDocHtml(
  title: string,
  blocks: AnswerBlock[],
  citations?: Citation[],
): string {
  const cites = citations?.length
    ? `<h2>参考来源</h2><ol>${citations
        .map((c) => `<li>${escapeHtml(c.docName)} ${escapeHtml(c.page)} · 相关度 ${c.score}</li>`)
        .join("")}</ol>`
    : "";

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font:14px/1.75 "Inter","PingFang SC","Microsoft YaHei",sans-serif;color:#37352f;max-width:760px;margin:0 auto;padding:44px 40px;}
  h1{font-size:22px;color:#1a1a1a;margin:0 0 6px}
  h2{font-size:16px;color:#1a1a1a;margin:26px 0 10px}
  p{margin:0 0 12px}
  ul{margin:0 0 12px;padding-left:22px}
  li{margin:0 0 6px}
  table{border-collapse:collapse;width:100%;margin:0 0 16px}
  th,td{border:1px solid #e5e3df;padding:7px 10px;text-align:left;font-size:13px}
  th{background:#f6f5f4;font-weight:600}
  .meta{color:#787671;font-size:12px;margin:0 0 24px}
  .note{color:#787671;font-size:12.5px;background:#fafaf9;border-left:3px solid #5645d4;padding:8px 12px}
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">由 heli 研究推理工作台生成</p>
  ${blocksToHtml(blocks)}
  ${cites}
</body></html>`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);

export function downloadMarkdown(title: string, markdown: string) {
  triggerDownload(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    `${safeName(title)}.md`,
  );
}

export function downloadWord(title: string, blocks: AnswerBlock[], citations?: Citation[]) {
  triggerDownload(
    new Blob([buildDocHtml(title, blocks, citations)], {
      type: "application/msword;charset=utf-8",
    }),
    `${safeName(title)}.doc`,
  );
}
