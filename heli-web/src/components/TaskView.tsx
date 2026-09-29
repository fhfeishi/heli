import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Icon, type IconName } from "./Icons";
import { Button, Chip, EmptyState, Menu, Segmented, ToolButton, ViewHeader } from "./ui";
import {
  REPORT_TYPE_LABEL,
  type ReportTemplate,
  type ReportType,
  type TaskTemplate,
} from "../types";

const TYPE_ORDER: ReportType[] = [
  "text",
  "rich",
  "data",
  "compare",
  "kb-analysis",
  "kb-summary",
];

const TYPE_ICON: Record<ReportType, IconName> = {
  text: "doc",
  rich: "layers",
  data: "trend",
  compare: "competitors",
  "kb-analysis": "target",
  "kb-summary": "book",
};

/* --------------------------------------------------------- 视图 ------ */

export function TaskView() {
  const [tab, setTab] = useState<"tasks" | "templates">("tasks");

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <ViewHeader
        breadcrumb={
          <div className="mb-6 flex items-center gap-6 text-meta text-stone">
            <Icon name="tasks" size={13} />
            <span>任务模板</span>
            <Icon name="chevronRight" size={11} />
            <span className="text-steel">{tab === "tasks" ? "任务样板" : "报告模板库"}</span>
          </div>
        }
        title={tab === "tasks" ? "任务模板" : "报告模板库"}
        description={
          tab === "tasks"
            ? "任务 = 背景 + 要求 + 产出形态。选一个任务直接开跑，也可以按自己的研究习惯改造它。"
            : "六种产出形态各有一套模板库，模板决定报告的章节骨架、图表密度与引注方式。"
        }
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "tasks" as const, label: "任务样板", icon: "tasks" },
              { value: "templates" as const, label: "报告模板库", icon: "reports" },
            ]}
          />
        }
      />
      <div className="mx-auto w-full max-w-[1180px] px-34 pt-20 pb-44">
        {tab === "tasks" ? <TaskBoard /> : <TemplateLibrary />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------- 任务样板 ------ */

function TaskBoard() {
  const {
    tasks,
    openTaskEditor,
    runTask,
    deleteTask,
    askConfirm,
    openPreview,
    knowledgeBases,
  } = useStore();
  const [category, setCategory] = useState<string>("全部");

  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(tasks.map((t) => t.category)))],
    [tasks],
  );

  const list = tasks.filter((t) => category === "全部" || t.category === category);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-10 border-b border-hairline pb-14">
        <div className="flex flex-wrap gap-6">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`font-app rounded-sm px-10 py-5 text-meta transition-colors ${
                category === c
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-steel hover:bg-surface"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <Button variant="primary" icon="plus" onClick={() => openTaskEditor()}>
          自定义任务
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="pt-22">
          <EmptyState
            icon="tasks"
            title="该分类下没有任务"
            description="自定义任务时写清背景、要求与期望产出，heli 会按它组织检索与成稿。"
            action={
              <div className="mt-6">
                <Button variant="primary" icon="plus" onClick={() => openTaskEditor()}>
                  自定义任务
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-14 pt-18">
          {list.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              kbNames={knowledgeBases
                .filter((k) => task.suggestKbIds.includes(k.id))
                .map((k) => k.name)}
              onRun={() => runTask(task)}
              onPreview={() => openPreview({ kind: "task", taskId: task.id })}
              onEdit={() => openTaskEditor(task.id)}
              onDelete={() =>
                askConfirm({
                  title: "删除任务模板",
                  message: `「${task.title}」将被移除，已生成的成果不受影响。`,
                  confirmText: "删除",
                  danger: true,
                  onConfirm: () => deleteTask(task.id),
                })
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

function TaskCard({
  task,
  kbNames,
  onRun,
  onPreview,
  onEdit,
  onDelete,
}: {
  task: TaskTemplate;
  kbNames: string[];
  onRun: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { reportTemplates } = useStore();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? task.details : task.details.slice(0, 3);
  const outputTemplate = reportTemplates.find((t) => t.id === task.output.templateId);

  return (
    <div className="group flex flex-col rounded-lg border border-hairline bg-canvas p-16 transition-[border-color,box-shadow] hover:border-hairline-strong hover:shadow-[0_6px_20px_-10px_rgba(15,15,15,0.16)]">
      <div className="flex items-start gap-11">
        <span
          className="grid size-36 shrink-0 place-items-center rounded-card"
          style={{ background: task.tint, color: task.fg }}
        >
          <Icon name={task.icon === "custom" ? "sparkles" : task.icon} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-7">
            <span className="truncate text-title font-semibold tracking-[-0.2px] text-ink">
              {task.title}
            </span>
            {task.builtin ? <Chip tone="gray">内置</Chip> : <Chip tone="lav">自定义</Chip>}
          </div>
          <div className="mt-4 text-micro text-stone">
            {task.category} · 已使用 {task.usage} 次
          </div>
        </div>
        <Menu
          side="down"
          align="right"
          width={176}
          items={[
            { label: "右侧预览", icon: "panel", onSelect: onPreview },
            { label: "编辑任务", icon: "edit", onSelect: onEdit },
            { label: "删除任务", icon: "trash", danger: true, onSelect: onDelete },
          ]}
          trigger={(_open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              className="grid size-24 shrink-0 place-items-center rounded-sm text-stone opacity-0 transition-opacity hover:bg-surface group-hover:opacity-100"
            >
              <Icon name="dots" size={15} />
            </button>
          )}
        />
      </div>

      <p className="mt-11 text-meta leading-[1.62] text-steel">
        {task.description}
      </p>

      {/* 任务背景 */}
      <div className="mt-13 rounded-card bg-surface-soft px-12 py-10">
        <div className="flex items-center gap-6 text-micro font-semibold tracking-[0.5px] text-stone uppercase">
          <Icon name="book" size={12} />
          任务背景
        </div>
        <p className="mt-6 text-meta leading-[1.62] text-slate">
          {task.background}
        </p>
      </div>

      {/* 任务要求 */}
      <div className="mt-12">
        <div className="flex items-center gap-6 text-micro font-semibold tracking-[0.5px] text-stone uppercase">
          <Icon name="checklist" size={12} />
          任务要求
        </div>
        <ul className="mt-7 flex flex-col gap-6">
          {shown.map((d, i) => (
            <li key={i} className="flex gap-8 text-meta leading-[1.55] text-slate">
              <span className="mt-3 text-primary">
                <Icon name="check" size={11} strokeWidth={2.4} />
              </span>
              <span className="min-w-0 flex-1">{d}</span>
            </li>
          ))}
        </ul>
        {task.details.length > 3 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-app mt-7 text-meta text-primary hover:underline"
          >
            {expanded ? "收起" : `展开全部 ${task.details.length} 条`}
          </button>
        ) : null}
      </div>

      {/* 任务结果 */}
      <div className="mt-13 rounded-card border border-hairline px-12 py-10">
        <div className="flex items-center gap-6 text-micro font-semibold tracking-[0.5px] text-stone uppercase">
          <Icon name="target" size={12} />
          任务得到的结果
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-6">
          <Chip tone="lav">{REPORT_TYPE_LABEL[task.output.type]}</Chip>
          {outputTemplate ? (
            <span className="text-meta text-charcoal">{outputTemplate.name}</span>
          ) : (
            <Chip tone="gray">模板已删除</Chip>
          )}
        </div>
        <p className="mt-6 text-meta leading-[1.55] text-stone">
          {task.output.hint}
        </p>
      </div>

      {kbNames.length ? (
        <div className="mt-12 flex flex-wrap items-center gap-6">
          <span className="text-micro text-stone">推荐知识库</span>
          {kbNames.map((n) => (
            <span
              key={n}
              className="rounded-xs bg-surface px-8 py-3 text-micro text-slate"
            >
              {n}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex items-center gap-8 pt-14">
        <Button variant="primary" icon="play" onClick={onRun} className="flex-1 justify-center">
          用这个任务开始
        </Button>
        <ToolButton icon="panel" onClick={onPreview} title="右侧预览" />
      </div>
    </div>
  );
}

/* --------------------------------------------------- 模板库 ------ */

function TemplateLibrary() {
  const { reportTemplates, openPreview } = useStore();
  const [type, setType] = useState<ReportType | "all">("all");

  const list = reportTemplates.filter((t) => type === "all" || t.type === type);

  return (
    <>
      <div className="flex flex-wrap gap-6 border-b border-hairline pb-14">
        <button
          type="button"
          onClick={() => setType("all")}
          className={`font-app rounded-sm px-10 py-5 text-meta transition-colors ${
            type === "all"
              ? "bg-primary-soft font-medium text-primary"
              : "text-steel hover:bg-surface"
          }`}
        >
          全部 {reportTemplates.length}
        </button>
        {TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`font-app inline-flex items-center gap-5 rounded-sm px-10 py-5 text-meta transition-colors ${
              type === t
                ? "bg-primary-soft font-medium text-primary"
                : "text-steel hover:bg-surface"
            }`}
          >
            <Icon name={TYPE_ICON[t]} size={12.5} />
            {REPORT_TYPE_LABEL[t]}
            <span className="tabular-nums opacity-60">
              {reportTemplates.filter((x) => x.type === t).length}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-14 pt-18">
        {list.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            template={tpl}
            onPreview={() => openPreview({ kind: "template", template: tpl })}
          />
        ))}
      </div>
    </>
  );
}

function TemplateCard({
  template,
  onPreview,
}: {
  template: ReportTemplate;
  onPreview: () => void;
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
          className="grid size-32 shrink-0 place-items-center rounded-md"
          style={{ background: template.tint, color: template.fg }}
        >
          <Icon name={TYPE_ICON[template.type]} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-title font-semibold tracking-[-0.2px] text-ink">
            {template.name}
          </div>
          <div className="mt-4 flex items-center gap-6">
            <Chip tone="gray">{REPORT_TYPE_LABEL[template.type]}</Chip>
            {template.builtin ? <Chip tone="mint">内置</Chip> : <Chip tone="peach">自建</Chip>}
          </div>
        </div>
        <span className="shrink-0 text-micro tabular-nums text-stone">
          {template.usage} 次
        </span>
      </div>

      <p className="mt-11 text-meta leading-[1.6] text-steel">
        {template.summary}
      </p>

      <div className="mt-12 rounded-card bg-surface-soft px-12 py-10">
        <div className="text-micro font-semibold tracking-[0.5px] text-stone uppercase">
          章节骨架
        </div>
        <ol className="mt-7 flex flex-col gap-5">
          {template.outline.map((o, i) => (
            <li key={o} className="flex gap-8 text-meta text-slate">
              <span className="shrink-0 tabular-nums text-stone">{i + 1}.</span>
              {o}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-auto flex items-center justify-between gap-8 pt-13">
        <span className="text-micro text-stone">点击卡片在右侧窗口预览</span>
        <span className="flex items-center gap-4 text-meta text-primary opacity-0 transition-opacity group-hover:opacity-100">
          预览
          <Icon name="chevronRight" size={12} />
        </span>
      </div>
    </div>
  );
}
