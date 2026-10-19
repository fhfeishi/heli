/* 研究任务：列表 + 单个任务（对话、运行、证据包）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icons";
import { Button, Chip, EmptyState, Field, ViewHeader, inputCls } from "../components/ui";
import { Paths, navigate } from "../app/router";
import { api, type Group, type Library, type Run, type Task, type Template } from "../model/api";
import { useWorkspace } from "../model/store";
import { describeError } from "../model/errors";

const RUN_LABEL: Record<Run["status"], { text: string; tone: "mint" | "peach" | "sky" | "gray" }> = {
  queued: { text: "排队", tone: "gray" },
  running: { text: "运行中", tone: "sky" },
  cancelling: { text: "正在取消", tone: "peach" },
  done: { text: "已完成", tone: "mint" },
  failed: { text: "失败", tone: "peach" },
  cancelled: { text: "已取消", tone: "gray" },
  interrupted: { text: "已中断", tone: "gray" },
};

function scopeText(scope: Task["scope"], libraries: Library[], groups: Group[]): string {
  if (scope.kind === "group") return `组 · ${groups.find((g) => g.id === scope.id)?.name ?? scope.id}`;
  if (scope.kind === "library") return `库 · ${libraries.find((l) => l.id === scope.id)?.name ?? scope.id}`;
  if (scope.kind === "source") return "单份资料";
  return "全部资料库";
}

export function ResearchListView() {
  const { tasks, libraries, groups, reloadTasks, setError } = useWorkspace();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState("all");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");

  /* 模板随范围一起选：research 类决定证据包要出哪些结构提示 */
  useEffect(() => {
    void api.templates().then((data) => setTemplates(data.templates)).catch(() => setTemplates([]));
  }, []);

  const templateName = (id: string | null) =>
    templates.find((item) => item.id === id)?.name ?? null;

  const create = async () => {
    if (!title.trim()) return;
    try {
      const [kind, id] = scope === "all" ? ["all", null] : scope.split(":");
      const task = await api.createTask(title.trim(), goal.trim(), { kind, id },
        templateId || null);
      setTitle("");
      setGoal("");
      await reloadTasks();
      navigate(Paths.task(task.id));
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const options = useMemo(
    () => [
      { value: "all", label: "全部资料库" },
      ...groups.map((group) => ({ value: `group:${group.id}`, label: `组 · ${group.name}` })),
      ...libraries.map((library) => ({ value: `library:${library.id}`, label: `库 · ${library.name}` })),
    ],
    [groups, libraries],
  );

  return (
    <div className="h-full overflow-auto pb-40">
      <ViewHeader
        title="研究任务"
        description="一个任务对应一条持续会话，可以多次运行；每次运行冻结当时的范围与版本。"
        stats={`${tasks.length} 个任务`}
      />
      <div className="mx-auto w-full max-w-[1180px] px-34">
        <div className="mt-16 rounded-lg border border-hairline bg-surface-soft p-16">
          <div className="grid gap-12 md:grid-cols-2">
            <Field label="任务名">
              <input className={inputCls} value={title} placeholder="例如：光合效率结论" onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="目标 / 检索词" hint="运行时的默认查询">
              <input className={inputCls} value={goal} placeholder="例如：光合效率" onChange={(e) => setGoal(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-12 md:grid-cols-2">
            <Field label="资料范围">
              <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="模板" hint="运行时的结构要求">
              <select className={inputCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">不套模板</option>
                {templates
                  .filter((item) => item.kind === "research")
                  .map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
              </select>
            </Field>
          </div>
          <Button variant="primary" icon="plus" onClick={() => void create()} disabled={!title.trim()}>
            建任务
          </Button>
        </div>

        {tasks.length === 0 ? (
          <div className="mt-24">
            <EmptyState icon="tasks" title="还没有任务" description="建一个任务，选好范围，再运行。" />
          </div>
        ) : (
          <div className="mt-20 divide-y divide-hairline-soft rounded-lg border border-hairline">
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => navigate(Paths.task(task.id))}
                className="flex w-full items-center gap-12 bg-canvas px-16 py-14 text-left hover:bg-surface-soft"
              >
                <Icon name="chat" size={15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{task.title}</span>
                  <span className="mt-2 block truncate text-micro text-steel">
                    {task.goal || "未填目标"} · {scopeText(task.scope, libraries, groups)}
                  </span>
                  {templateName(task.template_id) ? (
                    <span className="mt-4 inline-block">
                      <Chip tone="lav">模板 · {templateName(task.template_id)}</Chip>
                    </span>
                  ) : null}
                </span>
                <span className="text-micro text-stone">{task.updated_at?.slice(0, 16).replace("T", " ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskDetailView({ taskId }: { taskId: string }) {
  const { libraries, groups, reloadTasks, reloadArtifacts, setError } = useWorkspace();
  const [task, setTask] = useState<Task | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const data = await api.task(taskId);
    setTask(data);
    const latest = data.runs[data.runs.length - 1] ?? null;
    setRun((current) => (current && current.id === latest?.id ? current : latest));
  }, [taskId]);

  useEffect(() => {
    void load().catch((cause) => setError(describeError(cause)));
  }, [load, setError]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const poll = useCallback(
    async (runId: string) => {
      try {
        const next = await api.run(runId);
        setRun(next);
        if (["queued", "running", "cancelling"].includes(next.status)) {
          timer.current = window.setTimeout(() => void poll(runId), 500);
        } else {
          await Promise.all([load(), reloadArtifacts(), reloadTasks()]);
        }
      } catch (cause) {
        setError(describeError(cause));
      }
    },
    [load, reloadArtifacts, reloadTasks, setError],
  );

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    try {
      await api.addMessage(taskId, content);
      setDraft("");
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      const started = await api.startRun(taskId, "research");
      setRun(started);
      await Promise.all([reloadTasks(), load()]);
      void poll(started.id);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    try {
      const next = await api.cancelRun(run.id);
      setRun(next);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  if (!task) {
    return (
      <div className="p-34">
        <EmptyState title="找不到这个任务" action={<Button onClick={() => navigate(Paths.research())}>返回列表</Button>} />
      </div>
    );
  }

  const label = run ? RUN_LABEL[run.status] : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-hairline px-24 py-14">
        <button
          type="button"
          onClick={() => navigate(Paths.research())}
          className="font-app mb-6 flex items-center gap-4 text-micro text-stone hover:text-charcoal"
        >
          <Icon name="chevronLeft" size={12} /> 研究任务
        </button>
        <div className="flex flex-wrap items-center gap-10">
          <h1 className="min-w-0 flex-1 truncate text-h3 font-semibold text-ink">{task.title}</h1>
          {label ? <Chip tone={label.tone}>{label.text}</Chip> : null}
          <Button variant="primary" icon="sparkles" onClick={() => void start()} disabled={busy}>
            运行
          </Button>
          {run && ["queued", "running"].includes(run.status) ? (
            <Button variant="ghost" onClick={() => void cancel()}>停止</Button>
          ) : null}
        </div>
        <p className="mt-4 text-micro text-steel">
          {task.goal || "未填目标"} · {scopeText(task.scope, libraries, groups)}
          {run?.input?.resolved ? ` · 解析到 ${run.input.resolved.library_ids.length} 个库 / ${run.input.resolved.source_total ?? "?"} 份资料` : ""}
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-10 overflow-auto px-24 py-16">
            {task.messages.length === 0 ? (
              <p className="text-micro text-stone">还没有对话。写下问题，再运行。</p>
            ) : null}
            {task.messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[720px] rounded-lg px-14 py-10 text-body leading-[1.7] ${
                  message.role === "user" ? "ml-auto bg-primary-soft text-ink" : "bg-surface-soft text-charcoal"
                }`}
              >
                <div className="mb-4 text-micro text-stone">{message.role === "user" ? "你" : "助手"}</div>
                {message.content}
              </div>
            ))}
            {run && run.status === "failed" ? (
              <div className="rounded-md border border-hairline-strong bg-danger-soft px-12 py-8 text-micro text-red">
                运行失败：{run.error}
              </div>
            ) : null}
            {run && ["cancelled", "interrupted", "cancelling"].includes(run.status) ? (
              <div className="rounded-md border border-hairline bg-surface-soft px-12 py-8 text-micro text-steel">
                {run.status === "cancelling" ? "已请求取消，等后端确认" : run.status === "cancelled" ? "已取消" : "上次运行被中断"}
              </div>
            ) : null}
          </div>

          <div className="border-t border-hairline p-12">
            <div className="flex items-end gap-8">
              <textarea
                className={`${inputCls} min-h-[64px] flex-1 resize-y`}
                placeholder="把问题写清楚，运行后会附上检索证据"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
                }}
              />
              <Button onClick={() => void send()} disabled={!draft.trim()}>发送</Button>
            </div>
            <p className="mt-4 text-micro text-stone">⌘/Ctrl + Enter 发送。当前未接模型：运行产出的是检索证据包，不是结论。</p>
          </div>
        </section>

        <aside className="min-h-0 overflow-auto border-l border-hairline bg-surface-soft p-14">
          <h3 className="mb-8 text-micro font-semibold tracking-[0.08em] text-stone">运行记录</h3>
          {task.runs.length === 0 ? <p className="text-micro text-stone">还没有运行</p> : null}
          <div className="space-y-6">
            {task.runs.map((item) => {
              const itemLabel = RUN_LABEL[item.status];
              return (
                <div key={item.id} className="rounded-md border border-hairline bg-canvas p-9">
                  <div className="flex items-center gap-6">
                    <Chip tone={itemLabel.tone}>{itemLabel.text}</Chip>
                    <span className="text-micro text-stone">{item.id.slice(-6)}</span>
                  </div>
                  <div className="mt-4 text-micro text-steel">
                    {item.started_at?.slice(11, 19) ?? "—"} → {item.finished_at?.slice(11, 19) ?? "—"}
                    {item.output?.hits != null ? ` · 命中 ${item.output.hits}` : ""}
                  </div>
                </div>
              );
            })}
          </div>

          <h3 className="mb-8 mt-18 text-micro font-semibold tracking-[0.08em] text-stone">成果</h3>
          {task.artifacts.length === 0 ? <p className="text-micro text-stone">还没有成果</p> : null}
          <div className="space-y-6">
            {task.artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => navigate(Paths.artifact(artifact.id))}
                className="block w-full rounded-md border border-hairline bg-canvas p-9 text-left hover:border-hairline-strong"
              >
                <div className="truncate text-meta text-ink">{artifact.title}</div>
                <div className="mt-2 text-micro text-stone">v{artifact.revision} · {artifact.status}</div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
