/* ==================================================================
   知识库拖拽（书架视图与卡片视图共用）

   沿用 pointer 自绘五拍状态机：armed → dragging → confirming →
   returning/settle → idle。与旧 Bookshelf 实现相比的关键改动：

   1. 命中检测改「进入拖拽时预测量一次」：pointermove 只做点内判定
      （纯数学，零 layout 读取），不再每个 move 都 elementFromPoint +
      querySelectorAll + N 次 getBoundingClientRect。
   2. 插入索引用二维判定（旧实现只比 x，flex-wrap 多行时跨行误判）。
   3. 拖拽期间监听滚动容器，按 scrollTop/scrollLeft 增量平移 rects，
      不重新测量。
   4. 落点语义（两视图统一）：
      - 书/卡之间的空隙 → 插入该位（排序），免确认，可撤销
      - 书/卡实体上     → 合并为新层，确认卡（组名默认公共前缀）
      - 层板空白 / 层眉 → 入该层末尾，确认卡
      - 未分层区        → 移出分层（拆分出口），免确认，可撤销
      - 多选后拖动      → 批量入层 / 批量排序（不合并），入层需确认
   ================================================================== */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";
import { useStore } from "../store";
import { commonKbPrefix } from "./kbName";
import type { KnowledgeBase } from "../types";

export type Phase = "idle" | "armed" | "dragging" | "confirming" | "returning";

export type DropHover =
  | { kind: "item"; kbId: string }
  | { kind: "gap"; groupId: string | null; index: number }
  | { kind: "board"; groupId: string }
  | { kind: "ungrouped" };

export interface ConfirmCardState {
  kind: "into" | "merge";
  x: number;
  y: number;
  groupId?: string;
  groupName?: string;
  targetKbId?: string;
  defaultName?: string;
}

interface DragSession {
  /** 被拖动的 kb 集合（多选拖动时 >1） */
  kbIds: string[];
  fromGroupId: string | null;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  ghostW: number;
  ghostH: number;
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

const UNGROUPED = "__ungrouped__";

const toRect = (r: DOMRect): Rect => ({
  left: r.left,
  top: r.top,
  right: r.right,
  bottom: r.bottom,
  width: r.width,
  height: r.height,
});

const inside = (r: Rect, x: number, y: number) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export function useKbDnd({ enabled, gap }: { enabled: boolean; gap: number }) {
  const {
    knowledgeBases,
    kbGroups,
    ungroupedOrder,
    kbSelection,
    moveMany,
    mergeMany,
    reorderKb,
    reorderUngrouped,
  } = useStore();

  const [phase, setPhase] = useState<Phase>("idle");
  const [dragKbIds, setDragKbIds] = useState<string[]>([]);
  const [hover, setHover] = useState<DropHover | null>(null);
  const [confirmCard, setConfirmCard] = useState<ConfirmCardState | null>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; top: number; height: number } | null>(
    null,
  );

  const phaseRef = useRef<Phase>("idle");
  const dragRef = useRef<DragSession | null>(null);
  const hoverRef = useRef<DropHover | null>(null);
  const confirmCardRef = useRef<ConfirmCardState | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const mergeNameRef = useRef("新分层");
  const listenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    key: (e: KeyboardEvent) => void;
    scroll: (e: Event) => void;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  /* 预测量缓存：item:/items:/board:/header: 前缀键 + 各容器内 item 的 DOM 顺序 */
  const rectsRef = useRef<Map<string, Rect>>(new Map());
  const itemsOrderRef = useRef<Map<string, string[]>>(new Map());
  const scrollerRef = useRef<{ el: HTMLElement | null; top: number; left: number }>({
    el: null,
    top: 0,
    left: 0,
  });

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const setHoverBoth = (t: DropHover | null) => {
    const ser = (v: DropHover | null) => (v ? `${v.kind}:${JSON.stringify(v)}` : "");
    if (ser(hoverRef.current) === ser(t)) return;
    hoverRef.current = t;
    setHover(t);
    setIndicator(t && t.kind === "gap" ? indicatorFor(t) : null);
  };
  const setConfirmCardBoth = (c: ConfirmCardState | null) => {
    confirmCardRef.current = c;
    setConfirmCard(c);
  };

  /** 进入 dragging 时测一次：所有落点的 viewport rect + 各容器内 item 顺序 */
  const measure = () => {
    const rects = rectsRef.current;
    const orders = itemsOrderRef.current;
    rects.clear();
    orders.clear();
    const dragged = new Set(dragRef.current?.kbIds ?? []);
    document
      .querySelectorAll<HTMLElement>(
        "[data-drop-item],[data-drop-items],[data-drop-board],[data-drop-header],[data-drop-ungrouped]",
      )
      .forEach((el) => {
        const r = toRect(el.getBoundingClientRect());
        if (el.dataset.dropItem) {
          rects.set("item:" + el.dataset.dropItem, r);
        } else if (el.dataset.dropItems) {
          const key = el.dataset.dropItems;
          rects.set("items:" + key, r);
          orders.set(
            key,
            [...el.querySelectorAll<HTMLElement>("[data-drop-item]")]
              .map((n) => n.dataset.dropItem!)
              .filter((id) => !dragged.has(id)),
          );
        } else if (el.dataset.dropBoard) {
          rects.set("board:" + el.dataset.dropBoard, r);
        } else if (el.dataset.dropHeader) {
          rects.set("header:" + el.dataset.dropHeader, r);
        } else {
          rects.set("zone:" + UNGROUPED, r);
        }
      });
  };

  /** 二维插入索引：先按行（y）定位，再按左右半区（x）定位 */
  const insertionIndex = (containerKey: string, x: number, y: number): number => {
    const order = itemsOrderRef.current.get(containerKey) ?? [];
    for (let i = 0; i < order.length; i++) {
      const r = rectsRef.current.get("item:" + order[i]);
      if (!r) continue;
      if (y < r.top) return i;
      if (y <= r.bottom) return x < r.left + r.width / 2 ? i : i + 1;
    }
    return order.length;
  };

  /** 插入指示条位置（viewport 坐标，渲染为 fixed） */
  const indicatorFor = (t: { groupId: string | null; index: number }) => {
    const key = t.groupId ?? UNGROUPED;
    const order = itemsOrderRef.current.get(key) ?? [];
    if (t.index < order.length) {
      const r = rectsRef.current.get("item:" + order[t.index]);
      if (r) return { left: r.left - gap / 2, top: r.top, height: r.height };
    }
    if (order.length > 0) {
      const r = rectsRef.current.get("item:" + order[order.length - 1]);
      if (r) return { left: r.right + gap / 2, top: r.top, height: r.height };
    }
    const zone = rectsRef.current.get("items:" + key);
    if (zone) return { left: zone.left + 8, top: zone.top + 8, height: Math.max(24, zone.height - 16) };
    return null;
  };

  /** 点内判定（纯数学）：item > 容器空隙 > 层眉 > 层板 > 未分层区 */
  const hit = (x: number, y: number): DropHover | null => {
    const d = dragRef.current;
    if (!d) return null;
    const rects = rectsRef.current;
    const dragged = new Set(d.kbIds);

    for (const [key, r] of rects) {
      if (!key.startsWith("item:")) continue;
      const kbId = key.slice(5);
      if (dragged.has(kbId)) continue;
      if (inside(r, x, y)) {
        if (d.kbIds.length === 1) return { kind: "item", kbId };
        /* 多选拖动不合并：实体命中降级为它所在容器的空隙 */
        for (const [ckey, cr] of rects) {
          if (!ckey.startsWith("items:")) continue;
          const order = itemsOrderRef.current.get(ckey.slice(6)) ?? [];
          if (inside(cr, x, y) && order.includes(kbId)) {
            const gid = ckey.slice(6);
            return {
              kind: "gap",
              groupId: gid === UNGROUPED ? null : gid,
              index: insertionIndex(gid, x, y),
            };
          }
        }
        return null;
      }
    }
    for (const [key, r] of rects) {
      if (!key.startsWith("items:")) continue;
      if (inside(r, x, y)) {
        const gid = key.slice(6);
        return {
          kind: "gap",
          groupId: gid === UNGROUPED ? null : gid,
          index: insertionIndex(gid, x, y),
        };
      }
    }
    for (const [key, r] of rects) {
      if (!key.startsWith("header:")) continue;
      if (inside(r, x, y)) return { kind: "board", groupId: key.slice(7) };
    }
    for (const [key, r] of rects) {
      if (!key.startsWith("board:")) continue;
      if (inside(r, x, y)) return { kind: "board", groupId: key.slice(6) };
    }
    const zone = rects.get("zone:" + UNGROUPED);
    if (zone && inside(zone, x, y) && d.fromGroupId) return { kind: "ungrouped" };
    return null;
  };

  /** 副本跟随指针：直改 style，不触发 React 重渲染 */
  const moveLayer = (x: number, y: number) => {
    const d = dragRef.current;
    const el = layerRef.current;
    if (!d || !el) return;
    el.style.transform = `translate3d(${x - d.offsetX}px, ${y - d.offsetY}px, 0) scale(0.96) rotate(1.5deg)`;
  };

  const cleanup = () => {
    const l = listenersRef.current;
    if (l) {
      window.removeEventListener("pointermove", l.move);
      window.removeEventListener("pointerup", l.up);
      window.removeEventListener("keydown", l.key, true);
      document.removeEventListener("scroll", l.scroll, true);
      listenersRef.current = null;
    }
    document.body.style.userSelect = "";
    dragRef.current = null;
    scrollerRef.current = { el: null, top: 0, left: 0 };
    setHoverBoth(null);
    setIndicator(null);
    setDragKbIds([]);
    setConfirmCardBoth(null);
    setPhaseBoth("idle");
    const el = layerRef.current;
    if (el) {
      el.style.transition = "";
      el.style.opacity = "";
    }
  };

  /** Esc / 非法区抬起：副本 180ms 飞回原位（FLIP），随后复位 */
  const startReturn = () => {
    setPhaseBoth("returning");
    setHoverBoth(null);
    setIndicator(null);
    const d = dragRef.current;
    window.requestAnimationFrame(() => {
      const el = d ? document.querySelector(`[data-drop-item="${d.kbIds[0]}"]`) : null;
      const layer = layerRef.current;
      if (el && layer && !reducedMotion.current) {
        const r = el.getBoundingClientRect();
        layer.style.transition =
          "transform 180ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 180ms ease-out";
        layer.style.transform = `translate3d(${r.left}px, ${r.top}px, 0) scale(0.96) rotate(1.5deg)`;
        layer.style.opacity = "0";
        window.setTimeout(cleanup, 190);
      } else {
        cleanup();
      }
    });
  };

  /** 落定：副本飞入目标新位置 → 涟漪扩散一次 → 目标 0.97→1 回弹 */
  const settle = (landKbId: string) => {
    window.requestAnimationFrame(() => {
      const el = document.querySelector(`[data-drop-item="${landKbId}"]`);
      const layer = layerRef.current;
      if (el && layer && !reducedMotion.current) {
        const r = el.getBoundingClientRect();
        layer.style.transition =
          "transform 180ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 180ms ease-out";
        layer.style.transform = `translate3d(${r.left}px, ${r.top}px, 0) scale(1) rotate(0deg)`;
        layer.style.opacity = "0";
        setRipple({ x: r.left + r.width / 2, y: r.top + r.height / 2, key: Date.now() });
        window.setTimeout(() => setRipple(null), 340);
        setLandedId(landKbId);
        window.setTimeout(() => setLandedId(null), 260);
        window.setTimeout(cleanup, 200);
      } else {
        const r = el?.getBoundingClientRect();
        if (r) {
          setRipple({ x: r.left + r.width / 2, y: r.top + r.height / 2, key: Date.now() });
          window.setTimeout(() => setRipple(null), 340);
        }
        cleanup();
      }
    });
  };

  const doConfirm = () => {
    const card = confirmCardRef.current;
    const d = dragRef.current;
    if (!card || !d) return;
    if (card.kind === "into" && card.groupId) {
      moveMany(d.kbIds, card.groupId);
      setConfirmCardBoth(null);
      settle(d.kbIds[0]);
    } else if (card.kind === "merge" && card.targetKbId) {
      mergeMany([...d.kbIds, card.targetKbId], mergeNameRef.current);
      setConfirmCardBoth(null);
      settle(d.kbIds[0]);
    }
  };

  const cancelConfirm = () => {
    setConfirmCardBoth(null);
    startReturn();
  };

  /** 空隙落下：免确认的排序 / 移动 */
  const performGapDrop = (t: { groupId: string | null; index: number }) => {
    const d = dragRef.current;
    if (!d) return;
    const single = d.kbIds.length === 1;
    if (single && t.groupId && t.groupId === d.fromGroupId) {
      const group = kbGroups.find((g) => g.id === t.groupId);
      const from = group ? group.kbIds.indexOf(d.kbIds[0]) : -1;
      if (group && from >= 0) {
        const to = Math.min(t.index, group.kbIds.length - 1);
        if (from !== to) reorderKb(t.groupId, from, to);
      }
    } else if (single && !t.groupId && !d.fromGroupId) {
      const from = ungroupedOrder.indexOf(d.kbIds[0]);
      const to = Math.min(t.index, ungroupedOrder.length - 1);
      if (from >= 0 && from !== to) reorderUngrouped(from, to);
    } else {
      moveMany(d.kbIds, t.groupId, t.index);
    }
    settle(d.kbIds[0]);
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (phaseRef.current === "armed") {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      /* 位移 ≥6px：进入拖拽态，原位变虚线占位，副本出现；此刻预测量全部落点 */
      setPhaseBoth("dragging");
      setDragKbIds(d.kbIds);
      document.body.style.userSelect = "none";
      measure();
      moveLayer(e.clientX, e.clientY);
    }
    if (phaseRef.current !== "dragging") return;
    d.x = e.clientX;
    d.y = e.clientY;
    moveLayer(e.clientX, e.clientY);
    setHoverBoth(hit(e.clientX, e.clientY));
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (phaseRef.current === "armed") {
      /* 没拖动：视作普通点击，交给 onClick */
      cleanup();
      return;
    }
    if (phaseRef.current !== "dragging") return;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 120);
    const target = hoverRef.current;
    if (!target) {
      startReturn();
      return;
    }
    if (target.kind === "gap") {
      performGapDrop(target);
      return;
    }
    if (target.kind === "ungrouped") {
      /* 移出分层：非破坏且可撤销，免确认直接落定 */
      moveMany(d.kbIds, null);
      settle(d.kbIds[0]);
      return;
    }
    /* 落下：就地确认卡（Enter 确认 / Esc、点外取消） */
    setPhaseBoth("confirming");
    setHoverBoth(null);
    setIndicator(null);
    if (target.kind === "board") {
      const group = kbGroups.find((g) => g.id === target.groupId);
      setConfirmCardBoth({
        kind: "into",
        x: e.clientX,
        y: e.clientY,
        groupId: target.groupId,
        groupName: group?.name,
      });
    } else {
      const a = knowledgeBases.find((k) => k.id === d.kbIds[0]);
      const b = knowledgeBases.find((k) => k.id === target.kbId);
      const shared = a && b ? commonKbPrefix(a.name, b.name) : null;
      mergeNameRef.current = shared ?? "新分层";
      setConfirmCardBoth({
        kind: "merge",
        x: e.clientX,
        y: e.clientY,
        targetKbId: target.kbId,
        defaultName: shared ?? "新分层",
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirmCardRef.current) cancelConfirm();
      else if (phaseRef.current === "dragging" || phaseRef.current === "armed") startReturn();
    } else if (e.key === "Enter" && confirmCardRef.current) {
      const el = e.target as HTMLElement | null;
      if (el && el.tagName === "INPUT") return; /* 输入框里的 Enter 交给表单提交 */
      e.preventDefault();
      doConfirm();
    }
  };

  /** 拖拽期间容器滚动：按增量平移所有预测量 rect，不重新测量 */
  const onScroll = (e: Event) => {
    const sc = scrollerRef.current;
    const el = sc.el;
    if (!el || e.target !== el) return;
    const dy = el.scrollTop - sc.top;
    const dx = el.scrollLeft - sc.left;
    if (!dx && !dy) return;
    sc.top = el.scrollTop;
    sc.left = el.scrollLeft;
    const rects = rectsRef.current;
    for (const [key, r] of rects) {
      rects.set(key, {
        ...r,
        left: r.left - dx,
        right: r.right - dx,
        top: r.top - dy,
        bottom: r.bottom - dy,
      });
    }
    const d = dragRef.current;
    if (d) setHoverBoth(hit(d.x, d.y));
  };

  const beginArm = (e: RPointerEvent, kb: KnowledgeBase, fromGroupId: string | null) => {
    if (!enabled || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, input, a, [data-no-drag]")) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    /* 多选拖动：拖的是选中集中的一项 → 整组一起拖 */
    const kbIds =
      kbSelection.length > 1 && kbSelection.includes(kb.id) ? [...kbSelection] : [kb.id];
    dragRef.current = {
      kbIds,
      fromGroupId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      ghostW: rect.width,
      ghostH: rect.height,
    };
    setPhaseBoth("armed");
    const sc = (e.currentTarget as HTMLElement).closest<HTMLElement>(".overflow-y-auto");
    scrollerRef.current = {
      el: sc,
      top: sc?.scrollTop ?? 0,
      left: sc?.scrollLeft ?? 0,
    };
    const l = { move: onPointerMove, up: onPointerUp, key: onKeyDown, scroll: onScroll };
    listenersRef.current = l;
    window.addEventListener("pointermove", l.move);
    window.addEventListener("pointerup", l.up);
    window.addEventListener("keydown", l.key, true);
    document.addEventListener("scroll", l.scroll, true);
  };

  /* 卸载兜底：拖拽中组件被卸载时摘掉全局监听 */
  useEffect(() => cleanup, []);

  return {
    phase,
    dragKbIds,
    hover,
    confirmCard,
    ripple,
    landedId,
    indicator,
    layerRef,
    mergeNameRef,
    suppressClickRef,
    beginArm,
    doConfirm,
    cancelConfirm,
    ghostSize: dragRef.current
      ? { w: dragRef.current.ghostW, h: dragRef.current.ghostH }
      : null,
  };
}

export type KbDnd = ReturnType<typeof useKbDnd>;
