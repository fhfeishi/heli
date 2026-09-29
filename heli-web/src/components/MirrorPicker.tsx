/* ==================================================================
   镜像入口：把一本书「引用」到另一个领域 / 子组

   本体不动、不复制实体，只是多一条引用边（KbMirror）。
   面板用 portal 挂到 body：卡片根节点是 overflow-hidden，菜单浮层在点选后
   会立即卸载，就地挂载都会被裁掉或跟着消失。
   候选行按树先序摊平（子组缩进一级），不可点的行一律写明原因
   （本体在此 / 已有镜像），不做静默禁用。
   ================================================================== */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { hueToken } from "../lib/kbLayout";
import { KB_TREE_MAX_DEPTH } from "../types";
import type { KbGroup, KbMirror } from "../types";

/** 面板宽度；定位翻转要用它算右边界 */
const PANEL_W = 232;

/** 锚点矩形的最小描述：书 / 卡在视口里的位置 */
export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

/** 取这本书在页面上的矩形；data-flip-id 是 FLIP 与结构查询共用的锚点 */
export function kbFlipRect(kbId: string): AnchorRect | null {
  const el = document.querySelector<HTMLElement>(`[data-flip-id="${kbId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom };
}

/* ---------------------------------------------------- 候选表计算 ---- */

export interface MirrorTarget {
  group: KbGroup;
  /** 「领域 / 子组」全路径 */
  path: string;
  /** 1 = 领域，2 = 子组 */
  depth: number;
  /** 可引用的本数；0 = 这一行不可点 */
  available: number;
  /** available 为 0 时的原因文案 */
  reason: string;
}

/**
 * 按树先序摊平候选层，逐行算「这些书里有多少本能引用到这里」。
 * 逐行独立计算，批量选择时每行结论可能不同（有的书在这层已有本体）。
 */
export function buildMirrorTargets(
  groups: readonly KbGroup[],
  mirrors: readonly KbMirror[],
  kbIds: readonly string[],
): MirrorTarget[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const pathOfGroup = (g: KbGroup): string => {
    const names: string[] = [];
    let cur: KbGroup | undefined = g;
    let guard = 0;
    while (cur && guard++ <= KB_TREE_MAX_DEPTH) {
      names.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return names.join(" / ");
  };

  const rows: MirrorTarget[] = [];
  const walk = (g: KbGroup, depth: number) => {
    let available = 0;
    let own = 0;
    let dup = 0;
    for (const id of kbIds) {
      if (g.kbIds.includes(id)) {
        own += 1;
      } else if (mirrors.some((m) => m.kbId === id && m.groupId === g.id)) {
        dup += 1;
      } else {
        available += 1;
      }
    }
    const reason =
      available > 0
        ? ""
        : own === kbIds.length
          ? "本体在此"
          : dup > 0
            ? "已有镜像"
            : "";
    rows.push({ group: g, path: pathOfGroup(g), depth, available, reason });
    for (const cid of g.childIds) {
      const child = byId.get(cid);
      if (child) walk(child, depth + 1);
    }
  };

  groups
    .filter((g) => !g.parentId || !byId.has(g.parentId))
    .forEach((g) => walk(g, 1));
  return rows;
}

/* ------------------------------------------------------ 候选行列表 ---- */

/** 候选表本体：单个书的菜单、封面卡、批量条共用同一份结论与文案 */
export function MirrorCandidateList({
  kbIds,
  onPicked,
}: {
  kbIds: string[];
  /** 引用成功后回调（浮层用它关闭自己） */
  onPicked?: () => void;
}) {
  const { kbGroups, kbMirrors, addMirrors } = useStore();
  const rows = buildMirrorTargets(kbGroups, kbMirrors, kbIds);

  if (!rows.length) {
    return (
      <p className="px-9 py-8 text-meta leading-[1.6] text-stone">
        还没有分层。先在书架底部「新建分层」，再把书引用过去。
      </p>
    );
  }

  return (
    <>
      {rows.map((r) => (
        <button
          key={r.group.id}
          type="button"
          role="menuitem"
          disabled={r.available === 0}
          title={
            r.available === 0
              ? r.reason || "这里已经有这本书了"
              : `在这里引用 ${r.available} 本`
          }
          onClick={() => {
            addMirrors(kbIds, r.group.id);
            onPicked?.();
          }}
          className="font-app flex w-full items-center gap-8 rounded-sm py-7 pr-9 text-left text-meta text-charcoal transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
          style={{ paddingLeft: 9 + (r.depth - 1) * 12 }}
        >
          <span
            className="size-7 shrink-0 rounded-full"
            style={{ background: hueToken(r.group.hue, "accent") }}
            aria-hidden
          />
          <span className="truncate">{r.path}</span>
          {r.available === 0 ? (
            <span className="ml-auto shrink-0 text-micro text-stone">{r.reason}</span>
          ) : (
            <span className="ml-auto shrink-0 text-micro tabular-nums text-steel">
              +{r.available}
            </span>
          )}
        </button>
      ))}
    </>
  );
}

/* ---------------------------------------------------------- 浮层 ---- */

/**
 * 镜像选择浮层（portal）。定位：优先贴在锚点下方，底部空间不够翻到上方。
 * 点外面或 Esc 关闭；引用成功后自行关闭。
 */
export function MirrorPicker({
  kbIds,
  anchor,
  onClose,
}: {
  kbIds: string[];
  anchor: AnchorRect | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /* 位置在 paint 前算好，避免闪一下再跳 */
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const a = anchor ?? { left: (vw - PANEL_W) / 2, top: 96, bottom: 96 };
    const left = Math.max(8, Math.min(a.left, vw - PANEL_W - 8));
    let top = a.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, a.top - h - 6);
    setPos({ left, top });
  }, [anchor, kbIds.length]);

  const many = kbIds.length > 1;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label="在另一领域引用"
      className="animate-view-swap fixed z-[var(--z-menu)] rounded-card border border-hairline bg-canvas p-5 shadow-menu"
      style={{
        width: PANEL_W,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="flex items-center gap-6 px-9 pt-6 pb-7 text-micro font-semibold tracking-[0.4px] text-stone">
        <Icon name="copy" size={12} />
        引用到…
      </div>
      <div className="max-h-[264px] overflow-y-auto pb-3">
        <MirrorCandidateList kbIds={kbIds} onPicked={onClose} />
      </div>
      <div className="mt-2 border-t border-hairline px-9 pt-7 pb-4 text-micro leading-[1.5] text-stone">
        {many
          ? `这 ${kbIds.length} 本书会各自多一条引用`
          : "本体仍在原处，这里只是引用；删掉镜像不影响原书"}
      </div>
    </div>,
    document.body,
  );
}
