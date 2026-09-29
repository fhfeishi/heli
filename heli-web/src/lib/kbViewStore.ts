/* ==================================================================
   组织视图的本地落盘（U5 / §11.4）
   ------------------------------------------------------------------
   组织视图（分组 / 顺序 / 镜像）是**独立于 sections 的视图数据**，
   最终应由后端存储。后端接口提供之前只写 localStorage，并在界面上
   标注「本地仅」——不冒充已保存。
   ================================================================== */

import type { KbGroup, KbMirror } from "../types";

export interface KbViewSnapshot {
  groups: KbGroup[];
  ungroupedOrder: string[];
  mirrors: KbMirror[];
  savedAt: string;
}

const KEY = "heli.kbview.v1";

export function loadKbView(): KbViewSnapshot | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KbViewSnapshot>;
    if (
      !Array.isArray(parsed.groups) ||
      !Array.isArray(parsed.ungroupedOrder) ||
      !Array.isArray(parsed.mirrors)
    ) {
      return null;
    }
    return {
      groups: parsed.groups,
      ungroupedOrder: parsed.ungroupedOrder,
      mirrors: parsed.mirrors,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    /* 隐私模式或数据损坏时当作没有 */
    return null;
  }
}

export function saveKbView(view: Omit<KbViewSnapshot, "savedAt">): string {
  const savedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...view, savedAt }));
  } catch {
    /* 写不进去也不影响使用，只是这次没落盘 */
  }
  return savedAt;
}

export function clearKbView(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}
