/* ==================================================================
   路由（方案 §13.1 / §3.3）
   ------------------------------------------------------------------
   选型说明：方案倾向 TanStack Router，但本机 npm 无法写入 node_modules
   （WSL 9P 上 safe-delete 拦截），故自研满足 S1 的最小实现，并把全部
   路由知识收敛在本文件 —— 将来换 TanStack Router 只需替换本文件。

   承担的事：
   · UI 状态真源：?view= ?section= ?q= ?offset= ?chapter=&sha= ?at= ?panel=
   · U1：/research 是研究任务列表，单个会话在 /research/session/<id>
   · U1：/research 是研究任务列表，单个会话在 /research/session/<id>
   · 深链与刷新恢复（S1 验收）
   · 一级导航由 URL 派生，不再用内存枚举（P2 / U1）
   ================================================================== */

import type { AnchorHTMLAttributes } from "react";
import { useSyncExternalStore } from "react";

/* ---------------------------------------------------------- 路径 ---- */

const enc = encodeURIComponent;
const dec = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export interface KbSearch {
  section: string;
  /** 标题 / 路径过滤 */
  q: string;
  /** 全文检索词（BM25），与 q 是两条独立的检索 */
  ft: string;
  offset: number;
  /** 视图：list 为默认资料视图；table 留给将来的表格视图。
      书架视图按 U3 已从库工作区移除，?view=shelf 落到 list */
  view: "list" | "table";
}

export interface DocSearch {
  chapter: number;
  sha: string;
  /** 章节内滚动位置（像素）。用 replace 写入，不产生历史记录 */
  at: number;
  /** 检索命中的原文字符位置：打开后直接定位并高亮这一段 */
  hit: number;
}

export const KB_SEARCH_DEFAULT: KbSearch = { section: "", q: "", ft: "", offset: 0, view: "list" };
export const DOC_SEARCH_DEFAULT: DocSearch = { chapter: 0, sha: "", at: 0, hit: 0 };

/** 只输出非默认、非空的值，保持 URL 干净可读 */
function toQuery(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" && (!Number.isFinite(value) || value === 0)) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function parseKbSearch(params: URLSearchParams): KbSearch {
  const view = params.get("view");
  return {
    section: params.get("section") ?? "",
    q: params.get("q") ?? "",
    ft: params.get("ft") ?? "",
    offset: Math.max(0, Number(params.get("offset")) || 0),
    view: view === "table" ? "table" : "list",
  };
}

export function parseDocSearch(params: URLSearchParams): DocSearch {
  return {
    chapter: Math.max(0, Number(params.get("chapter")) || 0),
    sha: params.get("sha") ?? "",
    at: Math.max(0, Number(params.get("at")) || 0),
    hit: Math.max(0, Number(params.get("hit")) || 0),
  };
}

export const Paths = {
  knowledge: () => "/knowledge",
  kb: (slug: string, search: Partial<KbSearch> = {}) =>
    `/knowledge/${enc(slug)}${toQuery({
      section: search.section ?? KB_SEARCH_DEFAULT.section,
      q: search.q ?? KB_SEARCH_DEFAULT.q,
      ft: search.ft ?? KB_SEARCH_DEFAULT.ft,
      offset: search.offset ?? KB_SEARCH_DEFAULT.offset,
      view: search.view === "table" ? "table" : undefined,
    })}`,
  /* 阅读页同时带上库的定位串（section / q / offset），
     这样「返回文档列表」能回到原来的章节与搜索，不会丢上下文 */
  doc: (slug: string, sourceId: string, search: Partial<DocSearch & KbSearch> = {}) =>
    `/knowledge/${enc(slug)}/doc/${enc(sourceId)}${toQuery({
      section: search.section,
      q: search.q,
      ft: search.ft,
      offset: search.offset,
      view: search.view === "table" ? "table" : undefined,
      chapter: search.chapter,
      sha: search.sha,
      at: search.at,
      hit: search.hit,
    })}`,
  extract: (slug: string) => `/knowledge/${enc(slug)}/extract`,
  jobs: (slug: string) => `/knowledge/${enc(slug)}/jobs`,
  research: () => "/research",
  session: (sessionId: string) => `/research/session/${enc(sessionId)}`,
  task: (taskId: string) => `/research/${enc(taskId)}`,
  artifacts: () => "/artifacts",
  artifact: (artifactId: string) => `/artifacts/${enc(artifactId)}`,
  settings: () => "/settings",
};

/* ------------------------------------------------------ 解析 -------- */

export type RouteName =
  | "knowledge"
  | "kb"
  | "doc"
  | "extract"
  | "jobs"
  | "research"
  | "session"
  | "task"
  | "artifacts"
  | "artifact"
  | "settings"
  | "unknown";

export interface Route {
  name: RouteName;
  /** 路径参数，未命中为空串 */
  slug: string;
  sourceId: string;
  sessionId: string;
  taskId: string;
  artifactId: string;
  search: URLSearchParams;
  pathname: string;
  /** pathname + search，复制它即可分享当前定位 */
  href: string;
}

export const DEFAULT_PATH = Paths.research();

/**
 * 「地址 → 路由」的纯解析：不碰 DOM、不读 window。
 * 导出它是为了让「地址怎么被解释」可以脱离浏览器直接断言。
 */
export function parse(pathname: string, search: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean).map(dec);
  const params = new URLSearchParams(search);
  const base = { slug: "", sourceId: "", sessionId: "", taskId: "", artifactId: "" };
  const make = (name: RouteName, extra: Partial<Route> = {}): Route => ({
    name,
    ...base,
    ...extra,
    search: params,
    pathname: path,
    href: path + (params.toString() ? `?${params.toString()}` : ""),
  });

  const [head, second, third, fourth] = segments;
  if (head === "knowledge") {
    if (!second) return make("knowledge");
    if (third === "doc" && fourth) return make("doc", { slug: second, sourceId: fourth });
    if (third === "extract") return make("extract", { slug: second });
    if (third === "jobs") return make("jobs", { slug: second });
    if (third === "doc") return make("kb", { slug: second });
    if (!third) return make("kb", { slug: second });
  }
  if (head === "research") {
    if (!second) return make("research");
    if (second === "session")
      return third ? make("session", { sessionId: third }) : make("research");
    if (third === "run" && fourth) return make("task", { taskId: second });
    return make("task", { taskId: second });
  }
  if (head === "artifacts") {
    if (!second) return make("artifacts");
    return make("artifact", { artifactId: second });
  }
  if (head === "settings") return make("settings");
  return make("unknown");
}

/* ------------------------------------------- 外部 store（history） --- */

const listeners = new Set<() => void>();
let current: Route = parse(window.location.pathname, window.location.search);

function emit() {
  current = parse(window.location.pathname, window.location.search);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => current;

window.addEventListener("popstate", emit);

/** U1：打开应用落在研究任务列表，不再落在空对话 */
if ((window.location.pathname.replace(/\/+$/, "") || "/") === "/") {
  window.history.replaceState(null, "", DEFAULT_PATH);
  current = parse(DEFAULT_PATH, window.location.search);
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = new URL(to, window.location.origin);
  const next = `${target.pathname}${target.search}`;
  if (next === current.href) return;
  window.history[options.replace ? "replaceState" : "pushState"](null, "", next);
  emit();
}

/**
 * 批量改当前 URL 的 search 并**通知** React（面板开关这类要立刻反映到界面的状态用）。
 * 与 patchSearchParam 的区别：后者不通知 React，只用于滚动位置这类高频写入。
 */
export function setSearchParams(
  patch: Record<string, string | number | null | undefined>,
  options: { replace?: boolean } = {},
): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  const next = `${url.pathname}${url.search}`;
  if (next === current.href) return;
  window.history[options.replace ? "replaceState" : "pushState"](null, "", next);
  emit();
}

/**
 * 只改 search 里的一个键，且**不通知 React**（滚动位置高频写入用）。
 * 用在滚动恢复上：既不产生历史记录，也不会每帧重渲染。
 */
export function patchSearchParam(key: string, value: string | number | null): void {
  const url = new URL(window.location.href);
  if (value === null || value === "" || value === 0) url.searchParams.delete(key);
  else if (typeof value === "number") url.searchParams.set(key, String(Math.round(value)));
  else url.searchParams.set(key, value);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** 当前路由。组件只通过它读位置，UI 状态的真源在 URL 上 */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 与路由匹配的链接：保留中键新开、右键复制链接，点击走 pushState */
export function Link({
  to,
  replace,
  className,
  children,
  ...rest
}: { to: string; replace?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
