/* ==================================================================
   批量操作条（顶部 sticky，避免与底部 Toast 抢位）
   已选 N 项 · [合并为一层] [新建分组并放入] [移出分层] [解散分层] [移动到…] [取消]
   键盘入口：选中后按 M 打开「移动到…」层列表。
   搜索时打平，结构类批量操作禁用（整条不渲染，选择保留）。
   ================================================================== */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { splitKbName } from "../lib/kbName";
import { hueToken } from "../lib/kbLayout";
import { MirrorCandidateList } from "./MirrorPicker";

export function BulkBar({ searching }: { searching: boolean }) {
  const {
    kbSelection,
    clearKbSelection,
    mergeMany,
    groupKbs,
    ungroupMany,
    dissolveGroup,
    moveMany,
    kbGroups,
    knowledgeBases,
  } = useStore();

  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef<HTMLDivElement>(null);
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const mirrorRef = useRef<HTMLDivElement>(null);

  const count = kbSelection.length;
  const selSet = new Set(kbSelection);

  /* 选中后按 M 打开「移动到…」层列表（输入框聚焦时不拦截） */
  useEffect(() => {
    if (!count || searching) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "m" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return;
      e.preventDefault();
      setMoveOpen((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, searching]);

  /* 「移动到…」弹层的点外关闭 / Esc */
  useEffect(() => {
    if (!moveOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moveRef.current?.contains(e.target as Node)) setMoveOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoveOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moveOpen]);

  /* 「引用到…」弹层的点外关闭 / Esc */
  useEffect(() => {
    if (!mirrorOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!mirrorRef.current?.contains(e.target as Node)) setMirrorOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMirrorOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [mirrorOpen]);

  if (!count || searching) return null;

  const anyGrouped = kbGroups.some((g) => g.kbIds.some((id) => selSet.has(id)));
  /* 解散入口：成员全部落在选择集里的层 */
  const coveredGroups = kbGroups.filter(
    (g) => g.kbIds.length > 0 && g.kbIds.every((id) => selSet.has(id)),
  );

  /** 合并默认名：全体选中的公共前缀，否则「新分层」 */
  const defaultMergeName = () => {
    const prefixes = kbSelection
      .map((id) => knowledgeBases.find((k) => k.id === id))
      .filter(Boolean)
      .map((k) => splitKbName(k!.name).prefix)
      .filter(Boolean);
    if (!prefixes.length) return "新分层";
    return prefixes.every((p) => p === prefixes[0]) ? prefixes[0] : "新分层";
  };

  const btn =
    "font-app inline-flex h-28 items-center gap-5 rounded-sm px-10 text-meta transition-colors disabled:cursor-not-allowed disabled:opacity-45";
  const btnQuiet = `${btn} text-slate hover:bg-surface`;
  const btnPrimary = `${btn} bg-primary font-medium text-on-primary hover:bg-primary-pressed`;

  return (
    <div className="sticky top-0 z-[var(--z-sticky)] -mx-2 px-2 pt-8">
      <div
        role="toolbar"
        aria-label="批量操作"
        className="bulk-bar flex flex-wrap items-center gap-6 rounded-card border border-hairline bg-canvas px-12 py-8 shadow-menu"
      >
        <span className="text-meta font-medium text-ink">已选 {count} 项</span>
        <span className="h-18 w-px bg-hairline" />
        <button
          type="button"
          className={btnPrimary}
          disabled={count < 2}
          title={count < 2 ? "至少选中 2 项" : "合并为一层"}
          onClick={() => {
            mergeMany(kbSelection, defaultMergeName());
            clearKbSelection();
          }}
        >
          <Icon name="layers" size={13} />
          合并为一层
        </button>
        <button
          type="button"
          className={btnQuiet}
          onClick={() => {
            groupKbs(kbSelection, "新分层");
            clearKbSelection();
          }}
        >
          <Icon name="plus" size={13} />
          新建分组并放入
        </button>
        <button
          type="button"
          className={btnQuiet}
          disabled={!anyGrouped}
          title={anyGrouped ? "移出分层（拆分）" : "选中的项都不在分层里"}
          onClick={() => {
            ungroupMany(kbSelection);
            clearKbSelection();
          }}
        >
          <Icon name="external" size={13} />
          移出分层
        </button>
        <button
          type="button"
          className={btnQuiet}
          disabled={coveredGroups.length === 0}
          title={
            coveredGroups.length
              ? `解散「${coveredGroups.map((g) => g.name).join("」「")}」`
              : "整层选中才可解散"
          }
          onClick={() => {
            coveredGroups.forEach((g) => dissolveGroup(g.id));
            clearKbSelection();
          }}
        >
          <Icon name="trash" size={13} />
          解散分层
        </button>
        <div ref={moveRef} className="relative">
          <button
            type="button"
            className={btnQuiet}
            title="移动到…（快捷键 M）"
            aria-expanded={moveOpen}
            onClick={() => setMoveOpen((v) => !v)}
          >
            <Icon name="chevronRight" size={13} />
            移动到…
            <kbd className="rounded-pill bg-surface px-5 py-1 text-micro text-stone">M</kbd>
          </button>
          {moveOpen ? (
            <div
              role="menu"
              aria-label="移动到分层"
              className="absolute top-[calc(100%+6px)] left-0 z-[var(--z-menu)] w-[190px] rounded-card border border-hairline bg-canvas p-5 shadow-menu"
            >
              {kbGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    moveMany(kbSelection, g.id);
                    clearKbSelection();
                    setMoveOpen(false);
                  }}
                  className="font-app flex w-full items-center gap-8 rounded-sm px-9 py-7 text-left text-meta text-charcoal transition-colors hover:bg-surface"
                >
                  <span
                    className="size-7 shrink-0 rounded-full"
                    style={{ background: hueToken(g.hue, "accent") }}
                  />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}
              {anyGrouped ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    moveMany(kbSelection, null);
                    clearKbSelection();
                    setMoveOpen(false);
                  }}
                  className="font-app flex w-full items-center gap-8 rounded-sm px-9 py-7 text-left text-meta text-charcoal transition-colors hover:bg-surface"
                >
                  <Icon name="external" size={13} />
                  移出分层
                </button>
              ) : null}
              {kbGroups.length === 0 && !anyGrouped ? (
                <p className="px-9 py-7 text-meta text-stone">还没有分层</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div ref={mirrorRef} className="relative">
          <button
            type="button"
            className={btnQuiet}
            title="在这些领域里再陈列一次（本体不动）"
            aria-expanded={mirrorOpen}
            onClick={() => setMirrorOpen((v) => !v)}
          >
            <Icon name="copy" size={13} />
            引用到…
          </button>
          {mirrorOpen ? (
            <div
              role="menu"
              aria-label="在另一领域引用"
              className="absolute top-[calc(100%+6px)] left-0 z-[var(--z-menu)] w-[232px] rounded-card border border-hairline bg-canvas p-5 shadow-menu"
            >
              <div className="max-h-[264px] overflow-y-auto pb-3">
                <MirrorCandidateList
                  kbIds={kbSelection}
                  onPicked={() => {
                    setMirrorOpen(false);
                    clearKbSelection();
                  }}
                />
              </div>
              <div className="mt-2 border-t border-hairline px-9 pt-7 pb-4 text-micro leading-[1.5] text-stone">
                已选 {count} 本：本体留在原处，这里只是引用
              </div>
            </div>
          ) : null}
        </div>
        <button type="button" className={`${btnQuiet} ml-auto`} onClick={clearKbSelection}>
          取消
        </button>
      </div>
    </div>
  );
}
