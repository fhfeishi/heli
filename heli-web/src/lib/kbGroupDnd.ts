/* ==================================================================
   子组（书盒）整体拖拽 —— 书架视图与卡片视图共用

   与书的拖拽（kbDnd）同口径：pointer 自绘、进入拖拽时预测量一次、
   pointermove 只做点内判定。差异有意保留两点：

   1. 没有确认卡。拖动整个子组是一次结构改动，store 里已压快照、可撤销，
      再拦一道确认只会增加心智负担（书的确认卡是因为「合并」会新建实体）。
   2. 句柄是书盒头部（不是整块书盒），避免和盒内的书抢 pointerdown。

   落点语义：
   - 同级书盒之间的空隙 → 同层插入该位（排序）
   - 别的领域层板 / 别的领域的书盒 → 改挂到那个领域（追加到末尾）
   - 自己所属领域的层板空白处 → 同层移到末尾
   ================================================================== */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

export type GroupPhase = "idle" | "armed" | "dragging" | "returning";

export type GroupHover =
  /** 同层插入某个位置 */
  | { kind: "index"; parentId: string; index: number }
  /** 改挂到另一个领域层板（追加到末尾） */
  | { kind: "board"; parentId: string };

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

interface BoxRect extends Rect {
  id: string;
  /** 书盒只能挂在顶层领域下（树深 ≤ 3），所以 parentId 恒为领域 id */
  parentId: string;
}

interface DragSession {
  groupId: string;
  parentId: string;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  ghostW: number;
  ghostH: number;
}

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

export function useKbGroupDnd({
  enabled,
  gap,
  onMove,
}: {
  enabled: boolean;
  /** 插入指示条的留白；两视图各自传入自己的 gutter */
  gap: number;
  onMove: (groupId: string, toParentId: string, toIndex?: number) => void;
}) {
  const [phase, setPhase] = useState<GroupPhase>("idle");
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [hover, setHover] = useState<GroupHover | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; top: number; height: number } | null>(
    null,
  );
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null);
  const [landedGroupId, setLandedGroupId] = useState<string | null>(null);

  const phaseRef = useRef<GroupPhase>("idle");
  const dragRef = useRef<DragSession | null>(null);
  const hoverRef = useRef<GroupHover | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** 预测量：书盒矩形 + 每个领域下的书盒顺序 + 领域层板矩形 */
  const boxesRef = useRef<BoxRect[]>([]);
  const orderRef = useRef<Map<string, string[]>>(new Map());
  const boardsRef = useRef<Map<string, Rect>>(new Map());
  const listenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    key: (e: KeyboardEvent) => void;
  } | null>(null);
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const setPhaseBoth = (p: GroupPhase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const setHoverBoth = (t: GroupHover | null) => {
    const ser = (v: GroupHover | null) => (v ? `${v.kind}:${JSON.stringify(v)}` : "");
    if (ser(hoverRef.current) === ser(t)) return;
    hoverRef.current = t;
    setHover(t);
    setIndicator(t && t.kind === "index" ? indicatorFor(t) : null);
  };

  const measure = () => {
    const dragged = dragRef.current?.groupId;
    const boxes: BoxRect[] = [];
    const orders = orderRef.current;
    orders.clear();
    document.querySelectorAll<HTMLElement>("[data-box-id]").forEach((el) => {
      const id = el.dataset.boxId!;
      const parentId = el.dataset.boxParent ?? "";
      if (!parentId || id === dragged) return;
      const order = orders.get(parentId) ?? [];
      order.push(id);
      orders.set(parentId, order);
      boxes.push({ ...toRect(el.getBoundingClientRect()), id, parentId });
    });
    boxesRef.current = boxes;
    const boards = boardsRef.current;
    boards.clear();
    document.querySelectorAll<HTMLElement>("[data-drop-board]").forEach((el) => {
      boards.set(el.dataset.dropBoard!, toRect(el.getBoundingClientRect()));
    });
  };

  /** 二维插入索引：先按行（y）定位，再按左右半区（x）定位 */
  const insertionIndex = (parentId: string, x: number, y: number): number => {
    const order = orderRef.current.get(parentId) ?? [];
    for (let i = 0; i < order.length; i++) {
      const r = boxesRef.current.find((b) => b.id === order[i]);
      if (!r) continue;
      if (y < r.top) return i;
      if (y <= r.bottom) return x < r.left + r.width / 2 ? i : i + 1;
    }
    return order.length;
  };

  const indicatorFor = (t: { parentId: string; index: number }) => {
    const order = orderRef.current.get(t.parentId) ?? [];
    const at = (id: string) => boxesRef.current.find((b) => b.id === id);
    if (t.index < order.length) {
      const r = at(order[t.index]);
      if (r) return { left: r.left - gap / 2, top: r.top, height: r.height };
    }
    const last = order.length ? at(order[order.length - 1]) : undefined;
    if (last) return { left: last.right + gap / 2, top: last.top, height: last.height };
    return null;
  };

  const hit = (x: number, y: number): GroupHover | null => {
    const d = dragRef.current;
    if (!d) return null;

    /* ① 落在别的领域的书盒上 → 改挂过去 */
    for (const b of boxesRef.current) {
      if (b.id === d.groupId || b.parentId === d.parentId) continue;
      if (inside(b, x, y)) return { kind: "board", parentId: b.parentId };
    }

    /* ② 同级书盒所在条带（外扩半个 gutter） → 同层插入 */
    const same = boxesRef.current.filter((b) => b.parentId === d.parentId);
    if (same.length) {
      const hull = same.reduce(
        (acc, b) => ({
          left: Math.min(acc.left, b.left),
          top: Math.min(acc.top, b.top),
          right: Math.max(acc.right, b.right),
          bottom: Math.max(acc.bottom, b.bottom),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
      );
      if (
        x >= hull.left - gap / 2 &&
        x <= hull.right + gap / 2 &&
        y >= hull.top - gap / 2 &&
        y <= hull.bottom + gap / 2
      ) {
        return { kind: "index", parentId: d.parentId, index: insertionIndex(d.parentId, x, y) };
      }
    }

    /* ③ 落在领域层板上：别的领域 = 改挂，自己所在的领域 = 同层移到末尾 */
    for (const [id, r] of boardsRef.current) {
      if (!inside(r, x, y)) continue;
      if (id === d.parentId) {
        const order = orderRef.current.get(id) ?? [];
        return { kind: "index", parentId: id, index: order.length };
      }
      return { kind: "board", parentId: id };
    }
    return null;
  };

  const moveLayer = (x: number, y: number) => {
    const d = dragRef.current;
    const el = layerRef.current;
    if (!d || !el) return;
    el.style.transform = `translate3d(${x - d.offsetX}px, ${y - d.offsetY}px, 0) scale(0.98)`;
  };

  const cleanup = () => {
    const l = listenersRef.current;
    if (l) {
      window.removeEventListener("pointermove", l.move);
      window.removeEventListener("pointerup", l.up);
      window.removeEventListener("keydown", l.key, true);
      listenersRef.current = null;
    }
    document.body.style.userSelect = "";
    dragRef.current = null;
    setHoverBoth(null);
    setIndicator(null);
    setDragGroupId(null);
    setPhaseBoth("idle");
    const el = layerRef.current;
    if (el) {
      el.style.transition = "";
      el.style.opacity = "";
    }
  };

  /** Esc / 落在空处：副本飞回原位 */
  const startReturn = () => {
    setPhaseBoth("returning");
    setHoverBoth(null);
    setIndicator(null);
    const d = dragRef.current;
    if (!d) return cleanup();
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-box-id="${d.groupId}"]`);
      const layer = layerRef.current;
      if (el && layer && !reducedMotion.current) {
        const r = el.getBoundingClientRect();
        layer.style.transition =
          "transform 180ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 180ms ease-out";
        layer.style.transform = `translate3d(${r.left}px, ${r.top}px, 0) scale(1)`;
        layer.style.opacity = "0";
        window.setTimeout(cleanup, 190);
      } else {
        cleanup();
      }
    });
  };

  /** 落定：副本飞到书盒的新位置 → 涟漪一次 → 目标回弹 */
  const settle = () => {
    const d = dragRef.current;
    if (!d) return cleanup();
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-box-id="${d.groupId}"]`);
      const layer = layerRef.current;
      const r = el?.getBoundingClientRect();
      if (!r) {
        cleanup();
        return;
      }
      setRipple({ x: r.left + r.width / 2, y: r.top + r.height / 2, key: Date.now() });
      window.setTimeout(() => setRipple(null), 340);
      if (layer && !reducedMotion.current) {
        layer.style.transition =
          "transform 180ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 180ms ease-out";
        layer.style.transform = `translate3d(${r.left}px, ${r.top}px, 0) scale(1)`;
        layer.style.opacity = "0";
        setLandedGroupId(d.groupId);
        window.setTimeout(() => setLandedGroupId(null), 260);
        window.setTimeout(cleanup, 200);
      } else {
        cleanup();
      }
    });
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (phaseRef.current === "armed") {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      setPhaseBoth("dragging");
      setDragGroupId(d.groupId);
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

  const onPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    if (phaseRef.current === "armed") {
      cleanup();
      return;
    }
    if (phaseRef.current !== "dragging") return;
    const target = hoverRef.current;
    if (!target) {
      startReturn();
      return;
    }
    if (target.kind === "board") onMove(d.groupId, target.parentId);
    else onMove(d.groupId, target.parentId, target.index);
    settle();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (phaseRef.current === "dragging" || phaseRef.current === "armed") startReturn();
  };

  /** 从书盒头部起手；盒内的按钮（折叠）不参与拖拽 */
  const beginArm = (e: RPointerEvent, groupId: string, parentId: string) => {
    if (!enabled || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, input, a, [data-no-drag]")) return;
    const box = t.closest<HTMLElement>(`[data-box-id="${groupId}"]`);
    const rect = (box ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    dragRef.current = {
      groupId,
      parentId,
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
    const l = { move: onPointerMove, up: onPointerUp, key: onKeyDown };
    listenersRef.current = l;
    window.addEventListener("pointermove", l.move);
    window.addEventListener("pointerup", l.up);
    window.addEventListener("keydown", l.key, true);
  };

  useEffect(() => cleanup, []);

  return {
    phase,
    dragGroupId,
    hover,
    indicator,
    ripple,
    landedGroupId,
    layerRef,
    beginArm,
    ghostSize: dragRef.current
      ? { w: dragRef.current.ghostW, h: dragRef.current.ghostH }
      : null,
  };
}

export type KbGroupDnd = ReturnType<typeof useKbGroupDnd>;
