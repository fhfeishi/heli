/* ==================================================================
   路由解析回归校验：node scripts/check-routes.mjs
   ------------------------------------------------------------------
   为什么保留这一个检查：UI 状态的真源在 URL 上，
   「地址怎么被解释」错了，深链、刷新恢复、命中定位就全错，
   而这种错误不起服务也能发现，不该等到浏览器里才暴露。

   做法：用 vite 自带的 esbuild 把 `src/app/router.tsx` 打成临时 ESM，
   stub 掉 window 后直接断言 parse / Paths / 往返还原。
   不加依赖、不起服务、不改源码行为。
   ================================================================== */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = path.resolve(here, "..");
const require = createRequire(pathToFileURL(path.join(root, "package.json")));
const esbuild = require("esbuild");

const outfile = path.join(mkdtempSync(path.join(tmpdir(), "heli-routes-")), "router.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "src/app/router.tsx")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "transform",
  logLevel: "warning",
});

/* router 模块在导入时读 window.location 并注册 popstate，先给最小 stub */
globalThis.window = {
  location: { pathname: "/research", search: "", origin: "http://127.0.0.1" },
  addEventListener: () => {},
  history: { replaceState() {}, pushState() {} },
};

const { parse, Paths } = await import(pathToFileURL(outfile).href);

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got=${JSON.stringify(actual)}\n       want=${JSON.stringify(expected)}`}`,
  );
}

/**
 * 约定：不认识的段落一律 unknown（渲染「没有对应页面」），
 * 不猜用户想去哪，也不拿别的页面顶替。新增路由必须在这里加一行。
 */
const cases = [
  { path: "/knowledge", name: "knowledge" },
  { path: "/knowledge/langchain_docs", name: "kb" },
  { path: "/knowledge/langchain_docs/", name: "kb" },
  { path: "/knowledge/langchain_docs/doc/src_19d5b8351fcb", name: "doc" },
  /* 提取页与处理记录已并入库内，旧地址不再特殊处理 */
  { path: "/knowledge/langchain_docs/extract", name: "unknown" },
  { path: "/knowledge/langchain_docs/jobs", name: "unknown" },
  { path: "/knowledge/langchain_docs/whatever", name: "unknown" },
  { path: "/research", name: "research" },
  { path: "/research/task_abc", name: "task" },
  /* 旧「会话」路径已由 task 取代 */
  { path: "/research/session/s3", name: "task" },
  { path: "/artifacts", name: "artifacts" },
  { path: "/artifacts/a1", name: "artifact" },
  { path: "/settings", name: "settings" },
  { path: "/nonsense", name: "unknown" },
];

for (const item of cases) {
  const r = parse(item.path, "");
  check(`parse ${item.path || "/"} -> ${item.name}`, r.name, item.name);
}

/* 路径参数要从地址里正确取出 */
const doc = parse("/knowledge/langchain_docs/doc/src_abc", "?hit=42");
check("doc.slug", doc.slug, "langchain_docs");
check("doc.sourceId", doc.sourceId, "src_abc");
check("doc 保留查询串", doc.search.get("hit"), "42");
check("task.taskId", parse("/research/task_9", "").taskId, "task_9");
check("artifact.artifactId", parse("/artifacts/art_9", "").artifactId, "art_9");

/* Paths 构造：默认视图不进 URL，非默认才带 ?view= */
check("Paths.knowledge()", Paths.knowledge(), "/knowledge");
check("Paths.knowledge(card)", Paths.knowledge("card"), "/knowledge");
check("Paths.knowledge(shelf)", Paths.knowledge("shelf"), "/knowledge?view=shelf");
check("Paths.kb", Paths.kb("lib_1"), "/knowledge/lib_1");
check("Paths.doc", Paths.doc("lib_1", "src_2"), "/knowledge/lib_1/doc/src_2");

/* 往返：构造出来的地址解析回来必须指向同一对象 */
check("往返 doc", parse(Paths.doc("lib_1", "src_2"), "").href, "/knowledge/lib_1/doc/src_2");
check("往返 task", parse(Paths.task("task_7"), "").href, "/research/task_7");
check("往返 artifact", parse(Paths.artifact("art_8"), "").href, "/artifacts/art_8");

/* 查询串在 href 里保持可分享 */
const shared = parse("/knowledge/lib_1", "?view=shelf");
check("href 带查询串", shared.href, "/knowledge/lib_1?view=shelf");

console.log(failed ? `\n${failed} 项失败` : "\nALL PASS");
process.exit(failed ? 1 : 0);
