import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { Button, Menu, ToolButton } from "./ui";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

export function ChatView() {
  const {
    thread,
    sessionGroups,
    activeSessionId,
    renameSession,
    deleteSession,
    togglePinSession,
    askConfirm,
    newChat,
    selectedKbIds,
    knowledgeBases,
    toggleKb,
    activeTaskId,
    tasks,
    setActiveTaskId,
    model,
    inspectorOpen,
    toggleInspector,
  } = useStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");

  const session = sessionGroups
    .flatMap((g) => g.items)
    .find((s) => s.id === activeSessionId);

  const displayTitle = session?.title ?? "新对话";
  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;

  useEffect(() => {
    setRenaming(false);
  }, [activeSessionId]);

  /* 新消息到达时贴住底部 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 会话头部 */}
      <header className="flex items-center gap-10 border-b border-hairline bg-canvas px-26 py-11">
        {renaming ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim()) renameSession(activeSessionId, title.trim());
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (title.trim()) renameSession(activeSessionId, title.trim());
                setRenaming(false);
              }
              if (e.key === "Escape") setRenaming(false);
            }}
            className="font-app min-w-0 flex-1 rounded-sm border border-primary px-8 py-5 text-body font-medium text-ink outline-none"
          />
        ) : (
          <h1 className="min-w-0 truncate text-title font-semibold tracking-[-0.2px] text-ink">
            {displayTitle}
          </h1>
        )}

        <span className="hidden shrink-0 text-micro text-stone md:inline">
          {session?.messageCount ?? thread.length} 条消息 · {session?.updatedAt ?? "刚刚"}
        </span>

        {/* 上下文标签 */}
        <div className="ml-auto flex min-w-0 items-center gap-6">
          {activeTask ? (
            <span className="hidden items-center gap-5 rounded-sm bg-primary-soft px-8 py-4 text-micro text-primary lg:inline-flex">
              <Icon name="tasks" size={11.5} />
              {activeTask.title}
              <button
                type="button"
                onClick={() => setActiveTaskId(null)}
                className="ml-1 opacity-70 hover:opacity-100"
                title="取消任务"
              >
                <Icon name="close" size={9.5} strokeWidth={2.4} />
              </button>
            </span>
          ) : null}

          <div className="hidden items-center gap-5 lg:flex">
            {selectedKbIds.slice(0, 2).map((id) => {
              const kb = knowledgeBases.find((k) => k.id === id);
              if (!kb) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-5 rounded-sm bg-surface px-8 py-4 text-micro text-slate"
                >
                  <span className="size-6 rounded-full" style={{ background: kb.tint }} />
                  {kb.name}
                  <button
                    type="button"
                    onClick={() => toggleKb(id)}
                    className="opacity-60 hover:opacity-100"
                    title="从检索范围移除"
                  >
                    <Icon name="close" size={9.5} strokeWidth={2.4} />
                  </button>
                </span>
              );
            })}
            {selectedKbIds.length > 2 ? (
              <span className="text-micro text-stone">
                +{selectedKbIds.length - 2}
              </span>
            ) : null}
          </div>

          <span className="hidden rounded-sm bg-surface px-8 py-4 font-code text-micro text-steel xl:inline">
            {model}
          </span>

          <Menu
            side="down"
            align="right"
            width={188}
            items={[
              {
                label: "重命名会话",
                icon: "edit",
                onSelect: () => {
                  setTitle(displayTitle);
                  setRenaming(true);
                },
              },
              { label: session?.pinned ? "取消置顶" : "置顶会话", icon: "pin", onSelect: () => togglePinSession(activeSessionId) },
              {
                label: "删除会话",
                icon: "trash",
                danger: true,
                onSelect: () =>
                  askConfirm({
                    title: "删除会话",
                    message: `「${displayTitle}」及其消息将被移除。`,
                    confirmText: "删除",
                    danger: true,
                    onConfirm: () => deleteSession(activeSessionId),
                  }),
              },
            ]}
            trigger={(_open, toggle) => (
              <button
                type="button"
                onClick={toggle}
                className="grid size-26 place-items-center rounded-sm text-stone hover:bg-surface"
                title="会话操作"
              >
                <Icon name="dots" size={15} />
              </button>
            )}
          />

          <span className="mx-2 h-18 w-px bg-hairline" />

          <ToolButton
            icon="panel"
            onClick={toggleInspector}
            active={inspectorOpen}
            title="右侧窗口"
          />
          <Button size="sm" icon="plus" onClick={newChat}>
            新对话
          </Button>
        </div>
      </header>

      {/* 消息区 */}
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-34 py-22">
          <MessageList thread={thread} />
        </div>
      </div>

      <Composer />
    </div>
  );
}
