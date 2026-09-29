/* ==================================================================
   层眉（书架视图与卡片视图共用）
   层色点（建层时分配的稳定色）· 行内改名（双击）· N 本 · 共 M 篇 ·
   最近更新 · 聚合状态点 · hover/focus-within 操作区（对话/改名/折叠/更多）
   ================================================================== */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Menu, ToolButton } from "./ui";
import {
  aggregateGroupStatus,
  groupKbSet,
  hueToken,
  type KbLayoutGroup,
} from "../lib/kbLayout";

export function ShelfHeader({ group }: { group: KbLayoutGroup }) {
  const {
    renameGroup,
    toggleCollapsed,
    dissolveGroup,
    createChildGroup,
    setSelectedKbIds,
    setDraft,
    setNav,
    askConfirm,
  } = useStore();

  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  /* 领域层板的统计含子组（书盒）里的书，镜像去重后只算一次 */
  const members = groupKbSet(group);
  const agg = aggregateGroupStatus(members);
  const docs = members.reduce((s, k) => s + k.docs, 0);
  const latest = members.map((k) => k.updatedAt).sort().pop();

  const startRename = () => {
    setNameValue(group.name);
    setRenaming(true);
  };
  const commit = () => {
    renameGroup(group.id, nameValue);
    setRenaming(false);
  };

  const chatWithGroup = () => {
    const ids = members.map((k) => k.id);
    if (!ids.length) return;
    setSelectedKbIds(ids);
    setDraft(`基于「${group.name}」分层（${ids.length} 个知识库）提问：`);
    setNav("research");
  };

  return (
    <div
      data-drop-header={group.id}
      className="group/shelf flex items-center gap-8 px-2"
    >
      <span
        className="size-6 shrink-0 rounded-full"
        style={{ background: hueToken(group.hue, "accent") }}
        aria-hidden
      />
      {renaming ? (
        <input
          ref={inputRef}
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setRenaming(false);
          }}
          aria-label="分层名称"
          className="font-app w-[220px] rounded-sm border border-primary bg-canvas px-8 py-4 text-title font-semibold text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={startRename}
          title="双击重命名"
          className="font-app truncate text-title font-semibold tracking-[-0.2px] text-ink"
        >
          {group.name}
        </button>
      )}
      <span className="shrink-0 text-micro text-steel">
        {members.length} 本 · 共 {docs} 篇{latest ? ` · 最近更新 ${latest}` : ""}
      </span>
      <span
        className="size-6 shrink-0 rounded-full"
        style={{ background: agg.color }}
        title={agg.label}
        role="img"
        aria-label={agg.label}
      />
      <span className="ml-auto flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover/shelf:opacity-100 focus-within:opacity-100">
        <ToolButton icon="chat" title="与整层对话" onClick={chatWithGroup} />
        <ToolButton icon="edit" title="重命名" onClick={startRename} />
        <ToolButton
          icon={group.collapsed ? "chevronRight" : "chevronDown"}
          title={group.collapsed ? "展开" : "折叠"}
          onClick={() => toggleCollapsed(group.id)}
        />
        <Menu
          side="down"
          align="right"
          width={170}
          items={[
            ...(group.parentId === null
              ? [
                  {
                    label: "新建子组",
                    icon: "plus" as const,
                    onSelect: () => createChildGroup(group.id, "新子组"),
                  },
                ]
              : []),
            {
              label: "解散分层",
              icon: "trash",
              onSelect: () => {
                if (members.length >= 3) {
                  askConfirm({
                    title: "解散分层",
                    message: `「${group.name}」的 ${members.length} 本书会回到未分层，书本身与落盘目录都不受影响。`,
                    confirmText: "解散",
                    onConfirm: () => dissolveGroup(group.id),
                  });
                } else {
                  dissolveGroup(group.id);
                }
              },
            },
          ]}
          trigger={(_open, toggle) => <ToolButton icon="dots" title="更多" onClick={toggle} />}
        />
      </span>
    </div>
  );
}

/** 折叠层摘要行（两视图共用） */
export function collapsedGroupSummary(group: KbLayoutGroup): string {
  const members = groupKbSet(group);
  const docs = members.reduce((s, k) => s + k.docs, 0);
  const names =
    members
      .slice(0, 2)
      .map((k) => k.name)
      .join("、") + (members.length > 2 ? " 等" : "");
  return `${members.length} 本 · 共 ${docs} 篇 · ${names}`;
}
