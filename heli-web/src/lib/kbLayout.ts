/* ==================================================================
   知识库布局派生（书架视图与卡片视图共用）

   把「分组解析 / 未分层列表 / 搜索过滤 / 领域色相 / 路径 / 镜像」集中一处，
   避免两个视图各写一份导致口径漂移（此前 KnowledgeView.tsx 与 Bookshelf.tsx 重复）。

   真源约定（09-C1/C2）：
   - 层内顺序：KbGroup.kbIds
   - 子组顺序：KbGroup.childIds，父子关系：KbGroup.parentId
   - 未分层顺序：store.ungroupedOrder
   - 镜像：store.mirrors（引用边，不复制实体）
   - knowledgeBases 只作实体表，不承担顺序语义

   v2（2026-09-28）：分层是树（领域 → 子组），颜色即归属——
   书脊底色由所属顶层领域的色相族派生，未分层用中性纸色。
   ================================================================== */
import { KB_TREE_MAX_DEPTH } from "../types";
import type { DomainHue, KbGroup, KbMirror, KnowledgeBase } from "../types";

/* ------------------------------------------------ 领域色相族 ------ */

/** 建组时按顺序分配的色相；neutral 只表示「未分层」，不参与分配 */
export const DOMAIN_HUES: DomainHue[] = ["sky", "peach", "mint", "lavender"];
export const NEUTRAL_HUE: DomainHue = "neutral";

export type HuePart = "spine" | "deep" | "accent" | "text";

/** 色相族 → CSS 变量；浅色 / 深色由 globals.css 的 @theme 与媒体查询切换 */
export const hueToken = (hue: DomainHue, part: HuePart) =>
  `var(--color-domain-${hue}-${part})`;

export const hueTokens = (hue: DomainHue) => ({
  spine: hueToken(hue, "spine"),
  deep: hueToken(hue, "deep"),
  accent: hueToken(hue, "accent"),
  text: hueToken(hue, "text"),
});

export const hueAt = (n: number): DomainHue => DOMAIN_HUES[n % DOMAIN_HUES.length];

/* -------------------------------------------- 旧扁平数据迁移 ------ */

/** 迁移前的分层形状：只有 color，没有 parentId / childIds / hue */
export interface LegacyKbGroup {
  id: string;
  name: string;
  kbIds?: string[];
  collapsed?: boolean;
  color?: string;
  parentId?: string | null;
  childIds?: string[];
  hue?: DomainHue;
}

const TINT_HUE: Record<string, DomainHue> = {
  mint: "mint",
  sky: "sky",
  lavender: "lavender",
  peach: "peach",
  rose: "peach",
  yellow: "peach",
};

/** 四个色相族的代表色相角（度），用于 hex 就近归类 */
const HUE_ANGLES: Array<{ hue: DomainHue; deg: number }> = [
  { hue: "sky", deg: 205 },
  { hue: "mint", deg: 140 },
  { hue: "lavender", deg: 265 },
  { hue: "peach", deg: 28 },
];

/** color（tint 变量或 hex）→ 最近的色相族；认不出返回 null */
export function hueFromColor(color?: string): DomainHue | null {
  if (!color) return null;
  const tint = /--tint-([a-z]+)/.exec(color);
  if (tint && TINT_HUE[tint[1]]) return TINT_HUE[tint[1]];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return null;
  const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return NEUTRAL_HUE;
  const d = max - min;
  const deg =
    max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  const angle = ((deg * 60) + 360) % 360;
  let best = HUE_ANGLES[0];
  let bestDist = Infinity;
  for (const c of HUE_ANGLES) {
    const dist = Math.min(Math.abs(angle - c.deg), 360 - Math.abs(angle - c.deg));
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best.hue;
}

/**
 * 旧扁平分层 → v2 树形分层。
 * - hue：优先沿用显式 hue，其次由旧 color 就近归类，最后按下标轮转（保证稳定）
 * - parentId / childIds：缺失时补 null / []，即全部降级为顶层领域
 */
export function migrateKbGroups(raw: readonly LegacyKbGroup[]): KbGroup[] {
  return raw.map((g, i) => ({
    id: g.id,
    name: g.name,
    kbIds: g.kbIds ? [...g.kbIds] : [],
    collapsed: g.collapsed ?? false,
    parentId: g.parentId ?? null,
    childIds: g.childIds ? [...g.childIds] : [],
    hue: g.hue ?? hueFromColor(g.color) ?? hueAt(i),
  }));
}

/* ---------------------------------------------------- 派生布局 ------ */

export interface KbLayoutGroup extends KbGroup {
  /** 按 kbIds 顺序解析出的成员（已剔除已删除的库） */
  members: KnowledgeBase[];
  /** 子组（顺序即 childIds）；叶子组为空 */
  children: KbLayoutGroup[];
  /** 本组内陈列的镜像书（本体不在本组） */
  mirrors: KnowledgeBase[];
  /** 1 = 领域，2 = 子组 */
  depth: number;
  /** 「领域 / 子组」全路径 */
  path: string;
  /** 生效色相：子组继承所属顶层领域 */
  hue: DomainHue;
}

export interface KbLayout {
  /** 是否有搜索词；搜索时两视图打平为结果网格、禁用拖拽与结构类批量操作 */
  searching: boolean;
  /** kbId → 本体所在 groupId（不含镜像） */
  groupOf: Map<string, string>;
  /** 顶层领域树（含嵌套 children）；书架视图 v2 与卡片视图 v2 共用 */
  tree: KbLayoutGroup[];
  /** 未分层成员，按 ungroupedOrder 排序 */
  ungrouped: KnowledgeBase[];
  /** 搜索打平后的扁平结果（searching 为 false 时等于全量，视图不消费） */
  results: KnowledgeBase[];
  counts: { total: number; grouped: number; docs: number };
  /** 书 → 色相（未分层 = neutral） */
  hueOf: (kbId: string) => DomainHue;
  /** 书 → 「领域 / 子组」路径；未分层 = 「未分层」 */
  pathOf: (kbId: string) => string;
  /** 组 → 该组内陈列的镜像书 */
  mirrorsOf: (groupId: string) => KnowledgeBase[];
  /** 书 → 它在哪些组有镜像（返回路径，供封面卡「本体在 X」用） */
  mirrorHostsOf: (kbId: string) => string[];
}

export function kbMatchesQuery(kb: KnowledgeBase, q: string): boolean {
  return (
    kb.name.toLowerCase().includes(q) ||
    kb.description.toLowerCase().includes(q) ||
    kb.tags.some((t) => t.label.toLowerCase().includes(q))
  );
}

export function buildKbLayout(
  kbs: KnowledgeBase[],
  groups: KbGroup[],
  ungroupedOrder: string[],
  mirrors: KbMirror[],
  query: string,
): KbLayout {
  const kbById = new Map(kbs.map((k) => [k.id, k]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupOf = new Map<string, string>();
  groups.forEach((g) => g.kbIds.forEach((id) => groupOf.set(id, g.id)));

  const resolve = (ids: string[]): KnowledgeBase[] =>
    ids.map((id) => kbById.get(id)).filter((k): k is KnowledgeBase => Boolean(k));

  /* 有效镜像：书在、组在、且该组不是本体所在组；同书同组只留一条 */
  const mirrorSeen = new Set<string>();
  const mirrorList = (mirrors ?? []).filter((m) => {
    if (!kbById.has(m.kbId) || !groupById.has(m.groupId)) return false;
    if (groupOf.get(m.kbId) === m.groupId) return false;
    const key = m.kbId + "|" + m.groupId;
    if (mirrorSeen.has(key)) return false;
    mirrorSeen.add(key);
    return true;
  });

  /* 成环的组（数据损坏时）降级为顶层，避免递归无限展开 */
  const cyclic = new Set<string>();
  for (const g of groups) {
    const seen = new Set<string>();
    let cur: KbGroup | undefined = g;
    while (cur) {
      if (seen.has(cur.id)) {
        cyclic.add(g.id);
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? groupById.get(cur.parentId) : undefined;
    }
  }

  const depthOf = (g: KbGroup): number => {
    let d = 1;
    let cur = g;
    while (cur.parentId && groupById.has(cur.parentId)) {
      d += 1;
      cur = groupById.get(cur.parentId)!;
      if (d > KB_TREE_MAX_DEPTH) break;
    }
    return d;
  };

  const pathOfGroup = (g: KbGroup): string => {
    const names: string[] = [];
    let cur: KbGroup | undefined = g;
    let guard = 0;
    while (cur && guard++ <= KB_TREE_MAX_DEPTH) {
      names.unshift(cur.name);
      cur = cur.parentId ? groupById.get(cur.parentId) : undefined;
    }
    return names.join(" / ");
  };

  const nodes = new Map<string, KbLayoutGroup>();
  for (const g of groups) {
    const parent = g.parentId ? groupById.get(g.parentId) : undefined;
    nodes.set(g.id, {
      ...g,
      members: resolve(g.kbIds),
      children: [],
      mirrors: [],
      depth: depthOf(g),
      path: pathOfGroup(g),
      hue: parent ? parent.hue : g.hue,
    });
  }
  for (const node of nodes.values()) {
    node.children = node.childIds
      .map((id) => nodes.get(id))
      .filter((c): c is KbLayoutGroup => Boolean(c) && !cyclic.has(c!.id));
    node.mirrors = mirrorList
      .filter((m) => m.groupId === node.id)
      .map((m) => kbById.get(m.kbId)!)
      .filter(Boolean);
  }

  const tree = groups
    .map((g) => nodes.get(g.id)!)
    .filter(Boolean)
    .filter((n) => !n.parentId || !nodes.has(n.parentId) || cyclic.has(n.id));

  /* 未分层：按 ungroupedOrder 排；兜底把「既不在层也不在 order 里」的库 append 到末尾，
     保证任何实体都不会因为真源缺口而消失 */
  const seen = new Set<string>();
  const ungrouped: KnowledgeBase[] = [];
  for (const id of ungroupedOrder) {
    const kb = kbById.get(id);
    if (kb && !groupOf.has(id)) {
      ungrouped.push(kb);
      seen.add(id);
    }
  }
  for (const kb of kbs) {
    if (!groupOf.has(kb.id) && !seen.has(kb.id)) ungrouped.push(kb);
  }

  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const results = searching ? kbs.filter((k) => kbMatchesQuery(k, q)) : kbs;

  const hueOf = (kbId: string): DomainHue => {
    const gid = groupOf.get(kbId);
    const node = gid ? nodes.get(gid) : undefined;
    return node ? node.hue : NEUTRAL_HUE;
  };
  const pathOf = (kbId: string): string => {
    const gid = groupOf.get(kbId);
    const node = gid ? nodes.get(gid) : undefined;
    return node ? node.path : "未分层";
  };
  const mirrorsOf = (groupId: string): KnowledgeBase[] =>
    nodes.get(groupId)?.mirrors ?? [];
  const mirrorHostsOf = (kbId: string): string[] =>
    mirrorList
      .filter((m) => m.kbId === kbId)
      .map((m) => nodes.get(m.groupId)?.path)
      .filter((p): p is string => Boolean(p));

  return {
    searching,
    groupOf,
    tree,
    ungrouped,
    results,
    counts: {
      total: kbs.length,
      grouped: groupOf.size,
      docs: kbs.reduce((s, k) => s + k.docs, 0),
    },
    hueOf,
    pathOf,
    mirrorsOf,
    mirrorHostsOf,
  };
}

/** 层内 + 子组内的去重书集合：镜像只算一次（统计去重，不做任何双写） */
export function groupKbSet(group: KbLayoutGroup): KnowledgeBase[] {
  const map = new Map<string, KnowledgeBase>();
  const put = (kb: KnowledgeBase) => map.set(kb.id, kb);
  group.members.forEach(put);
  group.children.forEach((c) => {
    c.members.forEach(put);
    c.mirrors.forEach(put);
  });
  return [...map.values()];
}

/** 层聚合状态点：error > parsing > empty > ready（两视图层眉共用） */
export function aggregateGroupStatus(members: KnowledgeBase[]): {
  color: string;
  label: string;
} {
  const order = ["error", "parsing", "empty", "ready"] as const;
  const colors: Record<(typeof order)[number], { color: string; label: string }> = {
    error: { color: "var(--red)", label: "有库解析异常" },
    parsing: { color: "var(--link)", label: "有库解析中" },
    empty: { color: "var(--stone)", label: "有空库" },
    ready: { color: "var(--green)", label: "全部就绪" },
  };
  for (const st of order) {
    if (members.some((k) => k.status === st)) return colors[st];
  }
  return colors.ready;
}
