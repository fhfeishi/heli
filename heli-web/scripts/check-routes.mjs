/* ==================================================================
   路由解析回归校验：node scripts/check-routes.mjs
   ------------------------------------------------------------------
   为什么单有这一个检查：UI 状态的真源在 URL 上（§13.1），
   「地址怎么被解释」错了，整个产品的深链、刷新恢复、面板开关就全错，
   而这种错误在没有起服务时也能被发现，不该等到浏览器里才暴露。

   做法：用 vite 自带的 esbuild 把 `src/app/router.tsx` 打成临时 ESM，
   stub 掉 window 后直接断言 parse / Paths / 深链还原三件事。
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

const { parse, Paths, parseKbSearch, parseDocSearch } = await import(pathToFileURL(outfile).href);

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got=${JSON.stringify(actual)}\n       want=${JSON.stringify(expected)}`}`,
  );
}

/**
 * 约定：库/一级入口里不认识的段落一律判为 unknown（渲染「没有对应页面」页），
 * 不猜用户想去哪，也不拿别的页面顶替。新增路由必须在这里加一行。
 */
const cases = [
  { path: "/knowledge", name: "knowledge" },
  { path: "/knowledge/langchain_docs", name: "kb", slug: "langchain_docs" },
  { path: "/knowledge/langchain_docs/", name: "kb", slug: "langchain_docs" },
  { path: "/knowledge/langchain_docs/doc/src_19d5b8351fcb", name: "doc", slug: "langchain_docs", sourceId: "src_19d5b8351fcb" },
  { path: "/knowledge/langchain_docs/extract", name: "extract", slug: "langchain_docs" },
  { path: "/knowledge/langchain_docs/jobs", name: "jobs", slug: "langchain_docs" },
  /* 提取页允许带子路径（方案 id），仍然落在 extract 页，由 ?plan= 决定选中哪个方案 */
  { path: "/knowledge/langchain_docs/extract/plan-1", name: "extract", slug: "langchain_docs" },
  { path: "/knowledge/langchain_docs/whatever", name: "unknown" },
  { path: "/research", name: "research" },
  { path: "/research/session/s3", name: "session", sessionId: "s3" },
  { path: "/research/session", name: "research" },
  { path: "/artifacts", name: "artifacts" },
  { path: "/artifacts/a1", name: "artifact", artifactId: "a1" },
  { path: "/settings", name: "settings" },
  { path: "/nonsense", name: "unknown" },
  { path: "", name: "unknown" },
];

for (const item of cases) {
  const r = parse(item.path, "");
  check(`parse ${item.path || "/"} -> ${item.name}`, r.name, item.name);
  for (const key of ["slug", "sourceId", "sessionId", "artifactId"]) {
    if (item[key] !== undefined) check(`  ${item.path} ${key}`, r[key], item[key]);
  }
}

/* 生成的地址必须干净：默认值不进 URL */
check("Paths.jobs", Paths.jobs("langchain_docs"), "/knowledge/langchain_docs/jobs");
check(
  "Paths.kb 只输出非默认值",
  Paths.kb("langchain_docs", { section: "sec_1", q: "", ft: "", offset: 0 }),
  "/knowledge/langchain_docs?section=sec_1",
);
check("Paths.kb 保留 view=table", Paths.kb("langchain_docs", { view: "table" }), "/knowledge/langchain_docs?view=table");
check("view 为默认值时不进 URL", Paths.kb("langchain_docs", { view: "list" }), "/knowledge/langchain_docs");
check(
  "Paths.doc 保留 view=table",
  Paths.doc("langchain_docs", "src_1", { view: "table", chapter: 2 }),
  "/knowledge/langchain_docs/doc/src_1?view=table&chapter=2",
);
/* U3 后书架视图不再属于库工作区：?view=shelf 静默落到资料视图 */
check(
  "?view=shelf 落到 list",
  parseKbSearch(new URLSearchParams("view=shelf")).view,
  "list",
);
check(
  "Paths.doc 带 ft 与 hit",
  Paths.doc("kb_demo", "src_1", { ft: "structured output", chapter: 1, hit: 183, sha: "ab", at: 0 }),
  "/knowledge/kb_demo/doc/src_1?ft=structured+output&chapter=1&sha=ab&hit=183",
);

/* S1 的核心承诺：复制 URL → 还原到同一位置 */
const search = Paths
  .doc("langchain_docs", "src_1", { ft: "structured output", chapter: 1, hit: 183, sha: "ab" })
  .split("?")[1];
const doc = parseDocSearch(new URLSearchParams(search));
const kb = parseKbSearch(new URLSearchParams(search));
check("深链还原 ft", kb.ft, "structured output");
check("深链还原 hit", doc.hit, 183);
check("深链还原 chapter", doc.chapter, 1);
check("深链还原 sha", doc.sha, "ab");

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
