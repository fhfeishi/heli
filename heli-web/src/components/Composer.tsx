import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { Menu, ToolButton } from "./ui";
import { REPORT_TYPE_LABEL } from "../types";

export function Composer() {
  const {
    draft,
    setDraft,
    send,
    streaming,
    stopStreaming,
    stopPhase,
    retryStop,
    models,
    model,
    setModel,
    knowledgeBases,
    selectedKbIds,
    toggleKb,
    setSelectedKbIds,
    clearSelectedKbs,
    tasks,
    activeTaskId,
    setActiveTaskId,
    webEnabled,
    toggleWeb,
    autoMode,
    toggleAutoMode,
    editing,
    cancelEdit,
    openNewKb,
  } = useStore();

  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [draft]);

  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;
  const currentModel = models.find((m) => m.id === model) ?? models[0];

  const submit = () => {
    if (!draft.trim() || streaming) return;
    send(draft);
  };

  return (
    <div className="mx-auto w-full max-w-[860px] px-34 pb-22">
      {/* 编辑态提示 */}
      {editing ? (
        <div className="mb-9 flex items-center gap-8 rounded-md border border-primary bg-primary-soft-2 px-11 py-8 text-meta text-primary">
          <Icon name="edit" size={13} />
          <span className="flex-1">
            {editing.role === "user"
              ? "正在编辑这条提问，发送后从此处重新生成回答"
              : "已把这条回答载入输入框，改完可作为新提问发送"}
          </span>
          <button
            type="button"
            onClick={cancelEdit}
            className="font-app flex items-center gap-4 text-meta hover:underline"
          >
            取消
            <Icon name="close" size={11} />
          </button>
        </div>
      ) : null}

      <div className="rounded-lg border border-hairline-strong bg-canvas shadow-[0_2px_10px_-4px_rgba(15,15,15,0.08)] focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--primary-soft)]">
        <textarea
          ref={areaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={
            selectedKbIds.length
              ? "基于已选知识库提问，Enter 发送 · Shift + Enter 换行"
              : "描述你想研究的问题，或先在下方选择知识库"
          }
          className="font-app w-full resize-none border-0 bg-transparent px-15 pt-13 pb-6 text-body leading-[1.7] text-ink outline-none placeholder:text-stone"
        />

        {/* 工具条 */}
        <div className="flex flex-wrap items-center gap-4 px-9 pb-9 pt-2">
          {/* 模型 */}
          <Menu
            width={286}
            header="推理模型"
            items={models.map((m) => ({
              label: `${m.name} · ${m.context}`,
              icon: m.id === model ? "check" : "sparkles",
              onSelect: () => setModel(m.id),
            }))}
            footer={
              <div>
                <div className="font-medium text-charcoal">{currentModel?.name}</div>
                <div className="mt-2">
                  擅长 {currentModel?.good} · 成本系数 {currentModel?.cost}
                </div>
              </div>
            }
            trigger={(open, toggle) => (
              <ToolButton
                icon="sparkles"
                label={currentModel?.name ?? "模型"}
                onClick={toggle}
                active={open}
                title="选择模型"
              />
            )}
          />

          {/* 知识库多选 */}
          <KbPicker
            knowledgeBases={knowledgeBases}
            selectedKbIds={selectedKbIds}
            onToggle={toggleKb}
            onClear={clearSelectedKbs}
            onSetAll={(ids) => setSelectedKbIds(ids)}
            onCreate={openNewKb}
          />

          {/* 任务 */}
          <Menu
            width={280}
            header="任务模板"
            items={[
              { label: "不使用任务", icon: "close", onSelect: () => setActiveTaskId(null) },
              ...tasks.map((t) => ({
                label: `${t.title} · ${REPORT_TYPE_LABEL[t.output.type]}`,
                icon: t.id === activeTaskId ? ("check" as const) : ("tasks" as const),
                onSelect: () => setActiveTaskId(t.id),
              })),
            ]}
            trigger={(open, toggle) => (
              <ToolButton
                icon="tasks"
                label={activeTask ? activeTask.title : "任务"}
                onClick={toggle}
                active={open || Boolean(activeTask)}
                title="选择任务"
              />
            )}
          />

          <span className="mx-3 h-18 w-px bg-hairline" />

          <ToolButton
            icon="globe"
            label="联网"
            active={webEnabled}
            onClick={toggleWeb}
            title="允许在库外检索补充"
          />
          <ToolButton
            icon="panel"
            label="自动打开产出"
            active={autoMode}
            onClick={toggleAutoMode}
            title="生成结束后自动在右侧窗口打开"
          />

          <div className="ml-auto flex items-center gap-8 pl-6">
            {streaming ? (
              <span className="flex items-center gap-6 text-meta text-steel">
                <span className="size-6 animate-caret rounded-full bg-primary" />
                生成中…
              </span>
            ) : stopPhase === "requested" ? (
              /* U7：请求已发出但后端还没确认，不能当成已经停了 */
              <span className="flex items-center gap-6 text-meta text-steel">
                <Icon name="refresh" size={12} />
                停止请求已发出，等待后端确认…
              </span>
            ) : stopPhase === "unconfirmed" ? (
              <button
                type="button"
                onClick={retryStop}
                className="font-app text-meta text-orange underline underline-offset-2"
                title="后端没有确认这次取消，任务可能仍在运行"
              >
                后端未确认停止 · 重试取消
              </button>
            ) : (
              <span className="hidden text-micro text-stone sm:inline">
                {draft.length} 字
              </span>
            )}
            {streaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                title="停止生成"
                className="grid size-32 place-items-center rounded-card border border-hairline-strong bg-canvas text-charcoal transition-colors hover:bg-surface"
              >
                <Icon name="stop" size={12} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim()}
                title="发送（Enter）"
                className="grid size-32 place-items-center rounded-card bg-primary text-white transition-colors hover:bg-primary-pressed disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="send" size={15} strokeWidth={1.9} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-12 gap-y-4 px-4 text-micro text-stone">
        <span>回答会标注引用来源，可一键导出 Markdown / Word</span>
        {selectedKbIds.length ? (
          <span className="tabular-nums">已选 {selectedKbIds.length} 个知识库</span>
        ) : (
          <span className="text-orange">未选择知识库，将只使用通用能力</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------- 知识库多选 ------ */

function KbPicker({
  knowledgeBases,
  selectedKbIds,
  onToggle,
  onClear,
  onSetAll,
  onCreate,
}: {
  knowledgeBases: ReturnType<typeof useStore>["knowledgeBases"];
  selectedKbIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onSetAll: (ids: string[]) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label =
    selectedKbIds.length === 0
      ? "知识库"
      : selectedKbIds.length === 1
        ? (knowledgeBases.find((k) => k.id === selectedKbIds[0])?.name ?? "1 个库")
        : `${selectedKbIds.length} 个知识库`;

  return (
    <div ref={ref} className="relative">
      <ToolButton
        icon="library"
        label={label}
        onClick={() => setOpen((v) => !v)}
        active={open || selectedKbIds.length > 0}
        title="选择知识库（可多选）"
      />
      {open ? (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-[80] w-[300px] rounded-card border border-hairline bg-canvas p-5 shadow-[0_16px_48px_-8px_rgba(15,15,15,0.18)]">
          <div className="flex items-center justify-between px-9 pt-6 pb-7">
            <span className="text-micro font-semibold tracking-[0.4px] text-stone uppercase">
              检索范围
            </span>
            <div className="flex items-center gap-8 text-micro">
              <button
                type="button"
                onClick={() => onSetAll(knowledgeBases.map((k) => k.id))}
                className="font-app text-steel hover:text-primary"
              >
                全选
              </button>
              <button
                type="button"
                onClick={onClear}
                className="font-app text-steel hover:text-primary"
              >
                清空
              </button>
            </div>
          </div>
          <div className="scrollbar-thin max-h-[288px] overflow-y-auto">
            {knowledgeBases.map((kb) => {
              const on = selectedKbIds.includes(kb.id);
              return (
                <button
                  key={kb.id}
                  type="button"
                  onClick={() => onToggle(kb.id)}
                  className="font-app flex w-full items-center gap-9 rounded-sm px-9 py-7 text-left transition-colors hover:bg-surface"
                >
                  <span
                    className={`grid size-15 shrink-0 place-items-center rounded-xs border ${
                      on
                        ? "border-primary bg-primary text-white"
                        : "border-hairline-strong"
                    }`}
                  >
                    {on ? <Icon name="check" size={10} strokeWidth={2.6} /> : null}
                  </span>
                  <span
                    className="size-7 shrink-0 rounded-full"
                    style={{ background: kb.tint }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-meta text-charcoal">
                      {kb.name}
                    </span>
                    <span className="block truncate text-micro text-stone">
                      {kb.docs} 篇 · {kb.status === "ready" ? "已就绪" : "解析中"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 border-t border-hairline p-5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
              className="font-app flex w-full items-center gap-8 rounded-sm px-9 py-7 text-left text-meta text-primary hover:bg-primary-soft-2"
            >
              <Icon name="plus" size={14} />
              新建知识库
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
