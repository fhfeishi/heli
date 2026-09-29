import type { KnowledgeDocument } from "../types";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * 把一份文档的预览内容打包成自包含 HTML。
 * 「新窗口打开」和「下载副本」共用这一份实现 —— 用户拿到的内容与
 * 应用内看到的一致；真实环境替换成后端返回的 PDF / 原文直链即可。
 */
export function buildStandaloneHtml(doc: KnowledgeDocument): string {
  const pages = doc.preview
    .map(
      (page, i) => `
      <section class="sheet">
        <header><span class="name">${escapeHtml(doc.name)}</span><span class="pager">第 ${i + 1} / ${doc.preview.length} 页</span></header>
        <h2>${escapeHtml(page.heading)}</h2>
        ${page.paragraphs.map((t) => `<p>${escapeHtml(t)}</p>`).join("\n        ")}
      </section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light; }
  body { margin:0; padding:40px 24px 80px; background:#f6f5f4; color:#37352f;
    font:14px/1.75 "Inter",-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .meta { max-width:760px; margin:0 auto 20px; display:flex; flex-wrap:wrap; gap:8px 14px;
    align-items:center; font-size:12.5px; color:#787671; }
  .meta b { color:#1a1a1a; font-weight:600; }
  .badge { background:#dcecfa; color:#12609e; font-size:10.5px; font-weight:700;
    padding:2px 7px; border-radius:4px; letter-spacing:.3px; }
  .sheet { max-width:760px; margin:0 auto 16px; background:#fff; border:1px solid #e5e3df;
    border-radius:12px; padding:34px 38px 40px; box-shadow:0 1px 2px rgba(15,15,15,.04); }
  .sheet header { display:flex; justify-content:space-between; gap:12px;
    font-size:11.5px; color:#a4a097; border-bottom:1px solid #ede9e4; padding-bottom:10px; margin-bottom:22px; }
  h2 { font-size:17px; font-weight:600; color:#1a1a1a; margin:0 0 14px; }
  p { margin:0 0 14px; }
  @media print { body { background:#fff; padding:0; } .sheet { border:0; box-shadow:none; } }
</style>
</head>
<body>
  <div class="meta">
    <span class="badge">${doc.format}</span>
    <b>${escapeHtml(doc.name)}</b>
    <span>${doc.size}</span>
    <span>${doc.pages}</span>
    <span>解析于 ${doc.updatedAt}</span>
  </div>
${pages}
</body>
</html>`;
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

/** 新窗口打开；返回是否成功（弹窗被拦截时返回 false） */
export function openDocInNewTab(doc: KnowledgeDocument): boolean {
  const url = URL.createObjectURL(
    new Blob([buildStandaloneHtml(doc)], { type: "text/html;charset=utf-8" }),
  );
  const win = window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(win);
}

/** 下载副本 */
export function downloadDoc(doc: KnowledgeDocument) {
  triggerDownload(
    new Blob([buildStandaloneHtml(doc)], { type: "text/html;charset=utf-8" }),
    `${doc.name.replace(/\.[^.]+$/, "")}.html`,
  );
}
