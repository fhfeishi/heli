/* 最近阅读（审核第一批第 3 条）：空态里给出回得去的入口。
   只存标题与 id，写在本地——后端没有这份数据，也不值得为它开接口；
   写不进去（隐私模式 / 配额）不影响阅读。 */

export interface RecentDoc {
  source_id: string;
  title: string;
}

const LIMIT = 3;
const key = (slug: string) => `heli.recent.${slug}`;

export function readRecent(slug: string): RecentDoc[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key(slug)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentDoc =>
          !!item &&
          typeof (item as RecentDoc).source_id === "string" &&
          typeof (item as RecentDoc).title === "string",
      )
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function pushRecent(slug: string, doc: RecentDoc): void {
  try {
    const next = [doc, ...readRecent(slug).filter((item) => item.source_id !== doc.source_id)].slice(0, LIMIT);
    window.localStorage.setItem(key(slug), JSON.stringify(next));
  } catch {
    /* 忽略：这次没落盘而已 */
  }
}
