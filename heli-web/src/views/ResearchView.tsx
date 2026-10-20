/* 研究任务：列表 + 单个任务（对话、运行、证据包）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icons";
import { Button, Chip, EmptyState, Field, Segmented, ViewHeader, inputCls } from "../components/ui";
import { Paths, navigate } from "../app/router";
import { api, type Group, type Library, type Run, type Task, type Template } from "../model/api";
import { useWorkspace } from "../model/store";
import { Markdown } from "../components/Markdown";
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

/** 三类运行与模板同名，错配由后端拒绝（例如 extract 运行套 review 模板） */
const RUN_KINDS = [
  { value: "research", label: "研究", hint: "产出证据包，可用 research 模板" },
  { value: "extract", label: "提取", hint: "产出候选表，需要 extract 模板" },
  { value: "review", label: "审查", hint: "产出检查清单，需要 review 模板" },
] as const;

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
  const [runKind, setRunKind] = useState<"research" | "extract" | "review">("research");
  /* 建任务是一时的事，看任务是常事：表单默认收起，没有任务时才自动展开 */
  const [creating, setCreating] = useState<boolean | null>(null);

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
        actions={
          tasks.length > 0 && !(creating ?? false) ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              新建任务
            </Button>
          ) : null
        }
      />
      <div className="mx-auto w-full max-w-[1180px] px-34">
        {(creating ?? tasks.length === 0) ? (
        <div className="animate-shelf-card mt-16 rounded-lg border border-hairline bg-surface-soft p-16">
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
            <Field label="运行类型">
              <select
                className={inputCls}
                value={runKind}
                onChange={(event) => {
                  setRunKind(event.target.value as typeof runKind);
                  setTemplateId("");
                }}
              >
                {RUN_KINDS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="模板" hint={RUN_KINDS.find((item) => item.value === runKind)?.hint}>
              <select className={inputCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">不套模板</option>
                {templates
                  .filter((item) => item.kind === runKind)
                  .map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="flex gap-8">
            <Button variant="primary" icon="plus" onClick={() => void create()} disabled={!title.trim()}>
              建任务
            </Button>
            {tasks.length > 0 ? (
              <Button variant="ghost" onClick={() => setCreating(false)}>
                收起
              </Button>
            ) : null}
          </div>
        </div>
        ) : null}

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
                <span className="flex shrink-0 items-center gap-8">
                  {task.last_run ? (
                    <Chip tone={RUN_LABEL[task.last_run.status].tone}>
                      {RUN_LABEL[task.last_run.status].text}
                    </Chip>
                  ) : (
                    <span className="text-micro text-steel">未运行</span>
                  )}
                  {task.artifact_count ? (
                    <span className="text-micro text-stone">{task.artifact_count} 份产出</span>
                  ) : null}
                  <span className="text-micro text-stone">{task.updated_at?.slice(0, 16).replace("T", " ")}</span>
                </span>
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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ id: string; title: string; body: string } | null>(null);

  const load = useCallback(async () => {
    const data = await api.task(taskId);
    setTask(data);
    const latest = data.runs[data.runs.length - 1] ?? null;
    setRun((current) => (current && current.id === latest?.id ? current : latest));
  }, [taskId]);

  useEffect(() => {
    void load().catch((cause) => setError(describeError(cause)));
    void api.templates().then((data) => setTemplates(data.templates)).catch(() => setTemplates([]));
  }, [load, setError]);

  /* 任务详情的主体是最新产出：模型出了结论就该在这儿看见，而不是一句「还没有对话」 */
  useEffect(() => {
    const latest = task?.artifacts?.[task.artifacts.length - 1];
    if (!latest) {
      setPreview(null);
      return;
    }
    if (preview?.id === latest.id) return;
    let alive = true;
    api.artifact(latest.id)
      .then((data) => { if (alive) setPreview({ id: data.id, title: data.title, body: data.body_md }); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [task, preview?.id]);

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

  /* 默认选跟随模板类型的运行类型；任务没模板就落在 research */
  const templateKind = useMemo(
    () => templates.find((item) => item.id === task?.template_id)?.kind ?? null,
    [templates, task],
  );
  const [runKind, setRunKind] = useState<"research" | "extract" | "review">("research");
  useEffect(() => {
    setRunKind(templateKind === "extract" || templateKind === "review" ? templateKind : "research");
  }, [templateKind]);

  const start = async () => {
    setBusy(true);
    try {
      const started = await api.startRun(taskId, runKind);
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
          <div className="flex items-center gap-6">
            <Segmented
              value={runKind}
              onChange={setRunKind}
              options={RUN_KINDS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <Button variant="primary" icon="sparkles" onClick={() => void start()} disabled={busy}>
              {RUN_KINDS.find((item) => item.value === runKind)?.label}运行
            </Button>
          </div>
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
            {preview ? (
              <div className="rounded-lg border border-hairline bg-canvas">
                <div className="flex items-center justify-between gap-10 border-b border-hairline px-16 py-10">
                  <span className="min-w-0 truncate text-meta font-medium text-ink">{preview.title}</span>
                  <Button size="sm" variant="ghost" onClick={() => navigate(Paths.artifact(preview.id))}>
                    打开成果
                  </Button>
                </div>
                <div className="px-22 py-14">
                  <Markdown text={preview.body} />
                </div>
              </div>
            ) : task.messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-hairline px-20 py-28 text-center">
                <p className="text-body text-charcoal">这个任务还没有产出</p>
                <p className="mt-6 text-micro text-stone">
                  右上角选运行类型后点「运行」：模型会按范围内的资料给出带引用的结论。
                </p>
              </div>
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
            <p className="mt-4 text-micro text-stone">⌘/Ctrl + Enter 发送。写下的问题会作为运行时的检索目标，并留在这条任务的时间线上。</p>
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
                  {item.output?.llm ? (
                    <div className="mt-2 text-micro text-stone">
                      {item.output.llm.model}
                      {item.output.llm.latency_ms != null
                        ? ` · ${(item.output.llm.latency_ms / 1000).toFixed(1)}s` : ""}
                      {item.output.llm.usage?.prompt_tokens != null
                        ? ` · ${item.output.llm.usage.prompt_tokens}/${item.output.llm.usage.completion_tokens ?? "?"} tokens` : ""}
                    </div>
                  ) : null}
                  {item.output?.citation_check ? (
                    <div className={`mt-2 text-micro ${item.output.citation_check.invalid.length ? "text-orange" : "text-stone"}`}>
                      引用 {item.output.citation_check.cited.length} 条
                      {item.output.citation_check.invalid.length
                        ? ` · ${item.output.citation_check.invalid.length} 条越界（编造）`
                        : " · 序号全部有效"}
                    </div>
                  ) : null}
                  {item.output?.extract_audit ? (
                    <div className={`mt-2 text-micro ${item.output.extract_audit.fabricated ? "text-orange" : "text-stone"}`}>
                      引文核对 {item.output.extract_audit.checked} 条
                      {item.output.extract_audit.fabricated
                        ? ` · ${item.output.extract_audit.fabricated} 条查无原文` : " · 全部命中原文"}
                    </div>
                  ) : null}
                  {item.output?.verdicts?.length ? (
                    <div className="mt-2 text-micro text-stone">
                      判定 {item.output.verdicts.filter((v) => v.verdict === "通过").length} 通过 /
                      {" "}{item.output.verdicts.filter((v) => v.verdict === "存疑").length} 存疑 /
                      {" "}{item.output.verdicts.filter((v) => v.verdict === "未验证").length} 未验证
                    </div>
                  ) : null}
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
