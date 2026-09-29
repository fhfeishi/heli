import type { Route } from "./router";

/** 一级导航由 URL 派生（U1）：nav 不再是内存里的枚举，刷新后不会丢 */
export function navKeyOf(route: Route): "knowledge" | "research" | "artifacts" | "settings" {
  if (
    route.name === "knowledge" ||
    route.name === "kb" ||
    route.name === "doc" ||
    route.name === "extract" ||
    route.name === "jobs"
  )
    return "knowledge";
  if (route.name === "research" || route.name === "session" || route.name === "task")
    return "research";
  if (route.name === "artifacts" || route.name === "artifact") return "artifacts";
  return "settings";
}
