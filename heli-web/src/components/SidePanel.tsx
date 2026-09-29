import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon, type IconName } from "./Icons";
import { useRoute } from "../app/router";
import { Button, GroupLabel, Menu, PanelRow, SearchField } from "./ui";
import type { MenuItem } from "./ui";
import { ARTIFACT_STATUS_LABEL, REPORT_TYPE_LABEL } from "../types";
import type { NavKey } from "../types";

/* --------------------------------------------------------- 页头 ------ */

const PANEL_TITLE: Record<NavKey, string> = {
  knowledge: "资料库",
  research: "研究任务",
  artifacts: "成果",
  settings: "设置",
};

const PANEL_ACTION: Record<NavKey, { label: string; icon: IconName }> = {
  knowledge: { label: "", icon: "library" },
  research: { label: "新建研究", icon: "plus" },
  artifacts: { label: "新建成果", icon: "plus" },
  settings: { label: "", icon: "settings" },
};

/* --------------------------------------------------------- 侧栏 ------ */

export function SidePanel() {
  const {
    nav,
    sidebarCollapsed,
    panelQuery,
    setPanelQuery,
    artifacts,
    createArtifact,
    deleteArtifact,
    openArtifactEditor,
    askConfirm,
    tasks,
    openTaskEditor,
    runTask,
    deleteTask,
    sessionGroups,
    activeSessionId,
    openSession,
    newChat,
    renameSession,
    deleteSession,
    togglePinSession,
    openPreview,
  } = useStore();

  const q = panelQuery.trim().toLowerCase();
  /* 「新建研究」在研究首页由主区承担，左栏只在其他研究页保留（审核第二批第 7 条） */
  const route = useRoute();

  const action = PANEL_ACTION[nav];
  const onAction = () => {
    if (nav === "research") newChat();
    else if (nav === "artifacts") {
      const id = createArtifact();
      openArtifactEditor(id);
    }
  };

  return (
    <aside
      className={`flex shrink-0 flex-col overflow-hidden border-r border-hairline bg-surface-soft transition-[width,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        sidebarCollapsed ? "w-0 opacity-0" : "w-[286px] opacity-100"
      }`}
    >
      <div className="flex w-[286px] flex-col gap-10 px-12 pt-14">
        <div className="flex items-center justify-between gap-8">
          <span className="text-title font-semibold tracking-[-0.2px] text-ink">
            {PANEL_TITLE[nav]}
          </span>
          {action.label && !(nav === "research" && route.name === "research") ? (
            <Button size="sm" icon={action.icon} variant="outline" onClick={onAction}>
              {action.label}
            </Button>
          ) : null}
        </div>
        {nav !== "knowledge" && <SearchField
          value={panelQuery}
          onChange={setPanelQuery}
          placeholder={
            nav === "research" ? "搜索会话 / 任务" : nav === "artifacts" ? "搜索成果" : "搜索"
          }
        />}
      </div>

      <div className="scrollbar-thin mt-8 w-[286px] flex-1 overflow-y-auto px-6 pb-18">
        {nav === "research" ? (
          <SessionList
            q={q}
            groups={sessionGroups}
            activeSessionId={activeSessionId}
            onPick={openSession}
            onRename={renameSession}
            onDelete={deleteSession}
            onPin={togglePinSession}
            askConfirm={askConfirm}
          />
        ) : null}

        {nav === "knowledge" ? (
          <p className="px-10 py-16 text-body text-stone">在右侧资料库页面浏览目录、文档和索引状态。</p>
        ) : null}
        {nav === "research" ? (
          <>
            <GroupLabel>任务模板</GroupLabel>
            {tasks
              .filter((t) => !q || t.title.toLowerCase().includes(q))
              .map((task) => (
                <PanelRow
                  key={task.id}
                  icon={task.icon === "custom" ? "custom" : task.icon}
                  title={task.title}
                  meta={REPORT_TYPE_LABEL[task.output.type]}
                  onClick={() => openPreview({ kind: "task", taskId: task.id })}
                  actions={
                    <Menu
                      align="right"
                      width={176}
                      items={[
                        { label: "预览详情", icon: "eye", onSelect: () => openPreview({ kind: "task", taskId: task.id }) },
                        { label: "载入到对话", icon: "play", onSelect: () => runTask(task) },
                        { label: "编辑", icon: "edit", onSelect: () => openTaskEditor(task.id) },
                        {
                          label: "删除",
                          icon: "trash",
                          danger: true,
                          onSelect: () =>
                            askConfirm({
                              title: "删除任务模板",
                              message: `「${task.title}」将被移除，已生成的成果不受影响。`,
                              confirmText: "删除",
                              danger: true,
                              onConfirm: () => deleteTask(task.id),
                            }),
                        },
                      ]}
                      trigger={(_open, toggle) => (
                        <button
                          type="button"
                          onClick={toggle}
                          className="grid size-22 place-items-center rounded-xs text-stone hover:bg-surface hover:text-charcoal"
                        >
                          <Icon name="dots" size={14} />
                        </button>
                      )}
                    />
                  }
                />
              ))}
          </>
        ) : null}

        {nav === "artifacts" ? (
          <>
            <GroupLabel aside={<span className="font-normal normal-case">{artifacts.length} 份</span>}>
              全部成果
            </GroupLabel>
            {artifacts
              .filter((a) => !q || a.title.toLowerCase().includes(q))
              .map((a) => {
                const st = ARTIFACT_STATUS_LABEL[a.status];
                return (
                  <PanelRow
                    key={a.id}
                    icon="reports"
                    title={a.title}
                    meta={st.label}
                    onClick={() => openPreview({ kind: "artifact", artifactId: a.id })}
                    actions={
                      <Menu
                        align="right"
                        width={176}
                        items={[
                          { label: "预览", icon: "eye", onSelect: () => openPreview({ kind: "artifact", artifactId: a.id }) },
                          { label: "编辑", icon: "edit", onSelect: () => openArtifactEditor(a.id) },
                          {
                            label: "删除",
                            icon: "trash",
                            danger: true,
                            onSelect: () =>
                              askConfirm({
                                title: "删除成果",
                                message: `「${a.title}」将被移除，引用记录保留在会话中。`,
                                confirmText: "删除",
                                danger: true,
                                onConfirm: () => deleteArtifact(a.id),
                              }),
                          },
                        ]}
                        trigger={(_open, toggle) => (
                          <button
                            type="button"
                            onClick={toggle}
                            className="grid size-22 place-items-center rounded-xs text-stone hover:bg-surface hover:text-charcoal"
                          >
                            <Icon name="dots" size={14} />
                          </button>
                        )}
                      />
                    }
                  />
                );
              })}
          </>
        ) : null}

      </div>
    </aside>
  );
}

/* ----------------------------------------------------- 会话列表 ------ */

function SessionList({
  q,
  groups,
  activeSessionId,
  onPick,
  onRename,
  onDelete,
  onPin,
  askConfirm,
}: {
  q: string;
  groups: ReturnType<typeof useStore>["sessionGroups"];
  activeSessionId: string;
  onPick: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  askConfirm: ReturnType<typeof useStore>["askConfirm"];
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commit = (id: string) => {
    const next = value.trim();
    if (next) onRename(id, next);
    setRenaming(null);
  };

  return (
    <>
      {groups.map((group) => {
        const items = group.items.filter(
          (s) => !q || s.title.toLowerCase().includes(q),
        );
        if (!items.length) return null;
        return (
          <div key={group.label}>
            <GroupLabel
              aside={<span className="font-normal normal-case">{items.length}</span>}
            >
              {group.label}
            </GroupLabel>
            {items.map((s) => {
              const menuItems: MenuItem[] = [
                { label: s.pinned ? "取消置顶" : "置顶", icon: "pin", onSelect: () => onPin(s.id) },
                {
                  label: "重命名",
                  icon: "edit",
                  onSelect: () => {
                    setRenaming(s.id);
                    setValue(s.title);
                  },
                },
                {
                  label: "删除会话",
                  icon: "trash",
                  danger: true,
                  onSelect: () =>
                    askConfirm({
                      title: "删除会话",
                      message: `「${s.title}」及其 ${s.messageCount ?? 0} 条消息将被移除。`,
                      confirmText: "删除",
                      danger: true,
                      onConfirm: () => onDelete(s.id),
                    }),
                },
              ];

              if (renaming === s.id) {
                return (
                  <div key={s.id} className="px-8 py-5">
                    <input
                      ref={inputRef}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onBlur={() => commit(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commit(s.id);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="font-app w-full rounded-sm border border-primary bg-canvas px-8 py-6 text-body text-ink outline-none"
                    />
                  </div>
                );
              }

              return (
                <PanelRow
                  key={s.id}
                  icon={s.pinned ? "pin" : "chat"}
                  title={s.title}
                  meta={s.updatedAt}
                  active={s.id === activeSessionId}
                  onClick={() => onPick(s.id)}
                  actions={
                    <Menu
                      align="right"
                      width={170}
                      items={menuItems}
                      trigger={(_open, toggle) => (
                        <button
                          type="button"
                          onClick={toggle}
                          className="grid size-22 place-items-center rounded-xs text-stone hover:bg-surface hover:text-charcoal"
                        >
                          <Icon name="dots" size={14} />
                        </button>
                      )}
                    />
                  }
                />
              );
            })}
          </div>
        );
      })}
      {groups.every((g) => !g.items.length) ? (
        <p className="px-10 py-16 text-meta text-stone">还没有会话</p>
      ) : null}
    </>
  );
}
