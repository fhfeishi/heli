/* ==================================================================
   拖拽就地确认卡（从旧 Bookshelf 抽出，书架 / 卡片两视图共用）
   - role="dialog" aria-modal；Esc 取消 / Enter 确认（由 useKbDnd 全局监听）
   - 打开时焦点落在主按钮（merge 时落在组名输入框并全选）
   - 关闭后焦点回触发元素（被拖的那本书 / 那张卡）
   ================================================================== */
import { useEffect, useRef, useState } from "react";
import type { ConfirmCardState } from "../lib/kbDnd";

export function ConfirmCard({
  card,
  dragLabel,
  returnFocusId,
  onConfirm,
  onCancel,
}: {
  card: ConfirmCardState;
  /** 被拖动对象的显示名（into 文案用） */
  dragLabel: string;
  /** 关闭后回焦的 data-drop-item 值 */
  returnFocusId?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const style = {
    left: Math.max(8, Math.min(card.x - 130, window.innerWidth - 268)),
    top: Math.max(8, Math.min(card.y + 14, window.innerHeight - 170)),
  };

  /* 关闭后焦点回触发元素 */
  const closedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (closedRef.current) return;
      closedRef.current = true;
      const el = returnFocusId
        ? document.querySelector<HTMLElement>(`[data-drop-item="${returnFocusId}"]`)
        : null;
      el?.focus?.();
    };
  }, [returnFocusId]);

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-drag-layer)]"
        onPointerDown={onCancel}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={card.kind === "into" ? "放入分层确认" : "合并为一层"}
        className="animate-shelf-card fixed z-[var(--z-drag-card)] w-[260px] rounded-card border border-hairline bg-canvas p-14 shadow-menu"
        style={style}
      >
        {card.kind === "into" ? (
          <>
            <p className="text-body leading-[1.55] text-ink">
              将《{dragLabel}》放入「{card.groupName ?? ""}」？
            </p>
            <div className="mt-12 flex justify-end gap-8">
              <button
                type="button"
                onClick={onCancel}
                className="font-app h-28 rounded-sm border border-hairline px-11 text-meta text-slate transition-colors hover:bg-surface"
              >
                取消
              </button>
              <button
                type="button"
                autoFocus
                onClick={onConfirm}
                className="font-app h-28 rounded-sm bg-primary px-11 text-meta font-medium text-on-primary transition-colors hover:bg-primary-pressed"
              >
                放入
              </button>
            </div>
          </>
        ) : (
          <MergeBody
            key={card.targetKbId}
            defaultName={card.defaultName ?? "新分层"}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        )}
      </div>
    </>
  );
}

/** 两书成组确认卡主体：组名 input（默认同前缀，自动选中），Enter 提交 */
function MergeBody({
  defaultName,
  onCancel,
  onConfirm,
}: {
  defaultName: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(name);
      }}
    >
      <p className="text-body font-medium text-ink">合并为一层</p>
      <input
        ref={inputRef}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="分层名称"
        aria-label="分层名称"
        className="font-app mt-10 w-full rounded-md border border-hairline-strong bg-canvas px-10 py-7 text-body text-ink outline-none placeholder:text-stone focus:border-primary"
      />
      <div className="mt-12 flex justify-end gap-8">
        <button
          type="button"
          onClick={onCancel}
          className="font-app h-28 rounded-sm border border-hairline px-11 text-meta text-slate transition-colors hover:bg-surface"
        >
          取消
        </button>
        <button
          type="submit"
          className="font-app h-28 rounded-sm bg-primary px-11 text-meta font-medium text-on-primary transition-colors hover:bg-primary-pressed"
        >
          成组
        </button>
      </div>
    </form>
  );
}
