/* 研究任务首页（U1）：打开应用落在这里，而不是落在一个空对话里。
   一次研究 = 一个任务 + 若干会话 + 执行记录，三者分开。
   执行记录由后端提供；接口就绪前明说没有，不伪造条目（P9）。 */

import { Paths, navigate } from "../app/router";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { Button, Chip, ViewHeader } from "./ui";
import { REPORT_TYPE_LABEL } from "../types";

export function ResearchHomeView() {
  const { tasks, sessionGroups, activeSessionId, openSession, newChat, runTask } = useStore();
  const sessions = sessionGroups.flatMap((g) => g.items);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto bg-canvas text-ink">
      <ViewHeader
        title="研究任务"
        description="任务是「要解决什么问题」，会话是围绕它的讨论，执行记录是每一次实际运行。三者分开：不必每次追问都新建任务，也不必把每条回答都存成成果。"
        actions={
          <Button variant="primary" icon="plus" onClick={newChat}>
            新建研究
          </Button>
        }
        stats={`${tasks.length} 个任务模板 · ${sessions.length} 个会话`}
      />

      <div className="mx-auto w-full max-w-[1180px] space-y-26 px-34 pt-20 pb-44">
        <section>
          <h2 className="text-h3 font-semibold tracking-[-0.3px]">任务模板</h2>
          <p className="mt-5 text-meta text-stone">
            载入后进入会话执行；模板只影响下一次运行，不改变已开始的运行。
          </p>
          <div className="mt-14 grid gap-12 min-[760px]:grid-cols-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-col rounded-lg border border-hairline bg-surface p-16"
              >
                <div className="flex items-start gap-10">
                  <span
                    className="grid size-30 shrink-0 place-items-center rounded-card"
                    style={{ background: task.tint, color: task.fg }}
                  >
                    <Icon name="tasks" size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-title font-semibold text-ink">{task.title}</div>
                    <p className="mt-4 text-meta leading-[1.6] text-steel">{task.description}</p>
                  </div>
                  <Chip>{REPORT_TYPE_LABEL[task.output.type]}</Chip>
                </div>
                <div className="mt-14 flex flex-wrap gap-8">
                  <Button
                    variant="primary"
                    icon="play"
                    onClick={() => {
                      runTask(task);
                      openSession(activeSessionId);
                    }}
                  >
                    开始这个任务
                  </Button>
                  <button
                    type="button"
                    onClick={() => navigate(Paths.task(task.id))}
                    className="px-8 text-meta text-primary"
                  >
                    查看详情
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-h3 font-semibold tracking-[-0.3px]">最近会话</h2>
          <p className="mt-5 text-meta text-stone">
            会话属于任务；点开后地址栏会带上会话位置，返回与刷新都回到同一处。
          </p>
          {sessions.length === 0 ? (
            <p className="mt-14 rounded-md border border-hairline bg-surface p-16 text-body text-stone">
              还没有会话。点右上「新建研究」开始，或从上面的任务模板载入一个。
            </p>
          ) : (
            <div className="mt-14 flex flex-col gap-4">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`会话 ${s.title}`}
                  onClick={() => openSession(s.id)}
                  className="flex items-center gap-10 rounded-md border border-hairline bg-surface px-14 py-11 text-left transition-colors hover:border-hairline-strong"
                >
                  <Icon name={s.pinned ? "pin" : "chat"} size={14} className="shrink-0 text-stone" />
                  <span className="min-w-0 flex-1 truncate text-body text-charcoal">{s.title}</span>
                  {s.messageCount ? (
                    <span className="shrink-0 text-meta text-stone tabular-nums">
                      {s.messageCount} 条消息
                    </span>
                  ) : null}
                  {s.updatedAt ? (
                    <span className="shrink-0 text-meta text-stone">{s.updatedAt}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-h3 font-semibold tracking-[-0.3px]">执行记录</h2>
          <div className="mt-14 rounded-md border border-hairline bg-surface p-16 text-body text-stone">
            执行记录由后端提供，当前没有可显示的运行记录。等 jobs / 执行接口接上后，这里列出每次运行的状态、耗时、失败原因与可执行的下一步。
          </div>
        </section>
      </div>
    </div>
  );
}
