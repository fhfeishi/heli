/* ==================================================================
   路由：URL 即 UI 状态
   ------------------------------------------------------------------
   自研、零依赖。全部路由知识收敛在本文件，将来换路由库只需替换它。

   承担：路径构造、地址解析、导航与订阅。
   不做：v4 合并掉的功能（提取页、处理记录、会话）不再保留路径；
        书架/卡片不再是库内视图，而是 /knowledge 列表页的展示方式。
   ================================================================== */

import { useSyncExternalStore } from "react";

const enc = encodeURIComponent;
const dec = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const Paths = {
  /** 资料库总览：三视图是同一个页面的展示方式。
      三种都写进 URL——不写时无法区分「默认」与「显式选了卡片」，
      之前把 card 从 URL 里省掉，导致点「卡片」永远落回书架。 */
  knowledge: (view?: "card" | "shelf" | "list") =>
    `/knowledge${view ? `?view=${view}` : ""}`,
  kb: (slug: string) => `/knowledge/${enc(slug)}`,
  doc: (slug: string, sourceId: string, hit?: number | null) =>
    `/knowledge/${enc(slug)}/doc/${enc(sourceId)}${hit != null ? `?hit=${hit}` : ""}`,
  /** 全局检索：q 是检索词，scope 为 all 或 library:<id> */
  search: (q?: string, scope?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (scope && scope !== "all") params.set("scope", scope);
    const query = params.toString();
    return `/search${query ? `?${query}` : ""}`;
  },
  research: () => "/research",
  task: (taskId: string) => `/research/${enc(taskId)}`,
  artifacts: () => "/artifacts",
  artifact: (artifactId: string) => `/artifacts/${enc(artifactId)}`,
  settings: () => "/settings",
};

export type RouteName =
  | "knowledge"
  | "kb"
  | "doc"
  | "search"
  | "research"
  | "task"
  | "artifacts"
  | "artifact"
  | "settings"
  | "unknown";

export interface Route {
  name: RouteName;
  /** /knowledge/<slug> 的库 id */
  slug: string;
  /** /knowledge/<slug>/doc/<sourceId> 的资料 id */
  sourceId: string;
  taskId: string;
  artifactId: string;
  /** 查询串原样保留：视图、检索词、命中位置都从这里读 */
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
  const base = { slug: "", sourceId: "", taskId: "", artifactId: "" };
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
    if (third === "doc") return fourth ? make("doc", { slug: second, sourceId: fourth }) : make("kb", { slug: second });
    if (!third) return make("kb", { slug: second });
    /* 库页下不认识的段落不猜：明确落到 unknown，让界面说「没有对应页面」 */
    return make("unknown");
  }
  if (head === "search") return make("search");
  if (head === "research") {
    if (!second) return make("research");
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

/** 打开应用落在研究任务列表，不落在空对话 */
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

/** 当前路由。组件只通过它读位置，UI 状态的真源在 URL 上 */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
