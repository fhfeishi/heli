import type { Route } from "./router";

export type NavKey = "knowledge" | "search" | "research" | "artifacts" | "settings";

/** 一级导航由 URL 派生（U1）：nav 不再是内存里的枚举，刷新后不会丢 */
export function navKeyOf(route: Route): NavKey {
  if (route.name === "knowledge" || route.name === "kb" || route.name === "doc") return "knowledge";
  if (route.name === "search") return "search";
  if (route.name === "research" || route.name === "task") return "research";
  if (route.name === "artifacts" || route.name === "artifact") return "artifacts";
  return "settings";
}
