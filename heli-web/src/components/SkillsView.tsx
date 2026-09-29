import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { Button, Chip, EmptyState, Menu, Segmented, ToolButton, ViewHeader } from "./ui";
import type { PromptCard } from "../types";

export function SkillsView() {
  const {
    prompts,
    openPromptEditor,
    applyPrompt,
    deletePrompt,
    openPreview,
    askConfirm,
  } = useStore();

  const [kind, setKind] = useState<"prompt" | "skill">("prompt");
  const list = prompts.filter((p) => p.kind === kind);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <ViewHeader
        breadcrumb={
          <div className="mb-6 flex items-center gap-6 text-meta text-stone">
            <Icon name="command" size={13} />
            <span>提示词 / Skill</span>
            <Icon name="chevronRight" size={11} />
            <span className="text-steel">{kind === "prompt" ? "提示词卡片" : "Skill 卡片"}</span>
          </div>
        }
        title={kind === "prompt" ? "提示词" : "Skill"}
        description={
          kind === "prompt"
            ? "一段可直接复用的提问骨架：把研究口径、输出格式与约束写清楚，避免每次重新组织语言。"
            : "Skill 是封装好的成熟 prompt：带固定执行步骤，挂载后 heli 会按步骤推进检索、交叉验证与成稿。"
        }
        actions={
          <>
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: "prompt" as const, label: "提示词", icon: "sparkles" },
                { value: "skill" as const, label: "Skill", icon: "command" },
              ]}
            />
            <Button
              variant="primary"
              icon="plus"
              onClick={() => openPromptEditor(undefined, kind)}
            >
              新建{kind === "prompt" ? "提示词" : "Skill"}
            </Button>
          </>
        }
        stats={`${list.length} 张卡片`}
      />

      <div className="mx-auto w-full max-w-[1180px] px-34 pt-20 pb-44">
        {list.length === 0 ? (
          <EmptyState
            icon={kind === "prompt" ? "sparkles" : "command"}
            title={kind === "prompt" ? "还没有提示词" : "还没有 Skill"}
            description={
              kind === "prompt"
                ? "把常用的研究口径固化成提示词，下次一键插入输入框。"
                : "把成熟的多步流程封装成 Skill，挂载后按步骤执行。"
            }
            action={
              <div className="mt-6">
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => openPromptEditor(undefined, kind)}
                >
                  新建{kind === "prompt" ? "提示词" : "Skill"}
                </Button>
              </div>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-14">
            {list.map((card) => (
              <PromptCardView
                key={card.id}
                card={card}
                onApply={() => applyPrompt(card)}
                onPreview={() => openPreview({ kind: "prompt", promptId: card.id })}
                onEdit={() => openPromptEditor(card.id)}
                onDelete={() =>
                  askConfirm({
                    title: card.kind === "skill" ? "删除 Skill" : "删除提示词",
                    message: `「${card.title}」将被移除。`,
                    confirmText: "删除",
                    danger: true,
                    onConfirm: () => deletePrompt(card.id),
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PromptCardView({
  card,
  onApply,
  onPreview,
  onEdit,
  onDelete,
}: {
  card: PromptCard;
  onApply: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => {
        if (e.key === "Enter") onPreview();
      }}
      className="group flex cursor-pointer flex-col rounded-lg border border-hairline bg-canvas p-16 transition-[border-color,box-shadow] hover:border-hairline-strong hover:shadow-[0_6px_20px_-10px_rgba(15,15,15,0.16)]"
    >
      <div className="flex items-start gap-10">
        <span
          className="grid size-34 shrink-0 place-items-center rounded-card"
          style={{ background: card.tint, color: card.fg }}
        >
          <Icon name={card.kind === "skill" ? "command" : "sparkles"} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-7">
            <span className="truncate text-title font-semibold tracking-[-0.2px] text-ink">
              {card.title}
            </span>
            {card.builtin ? <Chip tone="gray">内置</Chip> : <Chip tone="lav">自建</Chip>}
          </div>
          <div className="mt-4 text-micro text-stone">
            已使用 {card.usage} 次 · {card.updatedAt}
          </div>
        </div>
        <Menu
          side="down"
          align="right"
          width={176}
          items={[
            { label: card.kind === "skill" ? "挂载到对话" : "插入输入框", icon: "send", onSelect: onApply },
            { label: "右侧预览", icon: "panel", onSelect: onPreview },
            { label: "编辑", icon: "edit", onSelect: onEdit },
            { label: "删除", icon: "trash", danger: true, onSelect: onDelete },
          ]}
          trigger={(_open, toggle) => (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              className="grid size-24 shrink-0 place-items-center rounded-sm text-stone opacity-0 transition-opacity hover:bg-surface group-hover:opacity-100"
            >
              <Icon name="dots" size={15} />
            </button>
          )}
        />
      </div>

      <p className="mt-11 text-meta leading-[1.62] text-steel">{card.summary}</p>

      <div className="mt-10 flex flex-wrap gap-5">
        {card.tags.map((t) => (
          <Chip key={t.label} tone={t.tone}>
            {t.label}
          </Chip>
        ))}
      </div>

      {card.steps?.length ? (
        <div className="mt-12 rounded-card bg-surface-soft px-12 py-10">
          <div className="text-micro font-semibold tracking-[0.5px] text-stone uppercase">
            执行步骤
          </div>
          <ol className="mt-7 flex flex-col gap-5">
            {card.steps.map((s, i) => (
              <li key={s} className="flex gap-8 text-meta text-slate">
                <span className="shrink-0 tabular-nums text-stone">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <pre className="mt-12 max-h-[92px] overflow-hidden rounded-card border border-hairline bg-surface-soft px-12 py-10 font-code text-micro leading-[1.65] whitespace-pre-wrap text-slate">
        {card.content.slice(0, 240)}
        {card.content.length > 240 ? " …" : ""}
      </pre>

      <div
        className="mt-auto flex items-center gap-8 pt-13"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="primary"
          icon={card.kind === "skill" ? "command" : "send"}
          onClick={onApply}
          className="flex-1 justify-center"
        >
          {card.kind === "skill" ? "挂载这个 Skill" : "插入输入框"}
        </Button>
        <ToolButton icon="edit" onClick={onEdit} title="编辑" />
      </div>
    </div>
  );
}
