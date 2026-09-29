/* ==================================================================
   知识库卡片（卡片视图本体，6 层结构）
   ① 顶部 4px 类别色条（tint 只做色条，卡片底色 bg-canvas，深色安全）
   ② 路径文字（领域 / 子组，色 = 领域 accent）+ 右侧状态点 + 多选勾选框
   ③ 标题 15px/500 两行截断
   ④ 描述 13px 两行
   ⑤ 标签 chips（≤3 +「+N」）+ meta 行（更新时间 · N 篇 · 容量，等宽数字）
   ⑥ 底部主操作：与知识库对话 / 导入 / ⋯
   解析中时插一条 4px 进度条
   ================================================================== */
import type { PointerEvent as RPointerEvent } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { Button, Chip, Menu, Progress, ToolButton } from "./ui";
import { KB_STATUS_COLOR, KB_STATUS_LABEL } from "../types";
import { hueToken } from "../lib/kbLayout";
import type { DomainHue, KnowledgeBase } from "../types";

export function KbCard({
  kb,
  groupId,
  /** 卡片顶部的归属路径（pathOf）；镜像卡写「镜像 · 本体在 X」 */
  path,
  /** 卡片与路径文字的色相（所属领域） */
  hue,
  /** 镜像卡：虚线描边 + 浅底，本体唯一 */
  mirror,
  selected,
  landed,
  mergeTarget,
  dragSource,
  dndEnabled,
  onBeginArm,
  suppressClickRef,
  onToggleSelect,
  /** 打开镜像选择浮层（浮层由视图层持有，避免被卡片的 overflow 裁掉） */
  onRequestMirror,
}: {
  kb: KnowledgeBase;
  groupId: string | null;
  path: string;
  hue: DomainHue;
  mirror?: boolean;
  selected: boolean;
  landed: boolean;
  /** 拖拽悬停的合并目标 */
  mergeTarget: boolean;
  /** 正被拖拽的源卡：原位降透明度 + 虚线占位 */
  dragSource: boolean;
  dndEnabled: boolean;
  onBeginArm: (e: RPointerEvent, kb: KnowledgeBase, fromGroupId: string | null) => void;
  suppressClickRef: { current: boolean };
  onToggleSelect: (additive: boolean) => void;
  onRequestMirror: (kbId: string) => void;
}) {
  const {
    openKbPage,
    openPreview,
    chatWithKb,
    openImport,
    openKbSettings,
    togglePinKb,
    moveKb,
    deleteKb,
    askConfirm,
    removeMirror,
  } = useStore();

  const st = KB_STATUS_LABEL[kb.status];
  const tags = kb.tags.slice(0, 3);
  const extraTags = kb.tags.length - tags.length;

  const open = () => {
    if (suppressClickRef.current) return;
    openKbPage(kb.id);
  };

  return (
    <div
      data-drop-item={kb.id}
      data-flip-id={kb.id}
      role="button"
      tabIndex={0}
      aria-label={`《${kb.name}》，${st.label}，${kb.docs} 篇${selected ? "，已选中" : ""}`}
      aria-pressed={selected}
      onPointerDown={(e) => onBeginArm(e, kb, groupId)}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={`kb-card contain-card group/kbcard relative flex h-full flex-col overflow-hidden rounded-card border transition-transform duration-120 ease-out hover:-translate-y-[2px] ${
        dndEnabled ? "cursor-grab" : ""
      } ${landed ? "animate-shelf-land" : ""} ${dragSource ? "opacity-30" : ""} ${
        mirror ? "book-mirror" : "border-hairline hover:border-hairline-strong"
      } ${selected ? "border-primary" : ""}`}
      style={{
        touchAction: "pan-y",
        background: mirror
          ? `color-mix(in srgb, ${hueToken(hue, "accent")} 6%, var(--canvas))`
          : undefined,
        ...(selected ? { outline: "2px solid var(--primary)", outlineOffset: "-1px" } : {}),
        ...(mirror ? { borderColor: hueToken(hue, "accent") } : {}),
        ...(mergeTarget
          ? { outline: "2px solid var(--primary)", transform: "scale(1.02)" }
          : {}),
      }}
    >
      {/* hover 阴影层：禁止过渡 box-shadow，用 ::after 过渡 opacity */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 rounded-card opacity-0 shadow-card-hover transition-opacity duration-120 group-hover/kbcard:opacity-100"
      />
      {/* 拖拽中原位虚线占位 */}
      {dragSource ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 rounded-card border border-dashed border-hairline-strong bg-surface-hover"
        />
      ) : null}
      {/* ① 顶部 4px 类别色条 */}
      <span aria-hidden className="h-4 w-full shrink-0" style={{ background: kb.tint }} />

      {/* 解析中：4px 进度条 */}
      {kb.status === "parsing" ? (
        <div className="px-14 pt-10">
          <Progress value={kb.readyPct} height={4} tone="var(--link)" />
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-14 pt-10 pb-12">
        {/* ② 路径文字（色 = 领域 accent）+ 右侧状态点 + 勾选框 */}
        <div className="flex items-center gap-7">
          <span
            className="truncate text-micro font-semibold tracking-[0.4px]"
            style={{ color: hueToken(hue, "accent") }}
          >
            {path}
          </span>
          {kb.restricted ? <Chip tone="rose">受限</Chip> : null}
          <span
            className="ml-auto size-6 shrink-0 rounded-full"
            style={{ background: KB_STATUS_COLOR[kb.status] }}
            title={st.label}
            role="img"
            aria-label={st.label}
          />
          <button
            type="button"
            data-no-drag
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? `取消选中《${kb.name}》` : `选中《${kb.name}》`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(true);
            }}
            className={`grid size-16 shrink-0 place-items-center rounded-pill border transition-opacity ${
              selected
                ? "border-primary bg-primary text-on-primary opacity-100"
                : "border-hairline-strong bg-canvas text-transparent opacity-0 group-hover/kbcard:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <Icon name="check" size={10} strokeWidth={2.6} />
          </button>
        </div>

        {/* ③ 标题 */}
        <p className="mt-7 line-clamp-2 text-title leading-[1.4] font-medium tracking-[-0.2px] text-ink">
          {kb.name}
        </p>

        {/* ④ 描述 */}
        <p className="mt-4 line-clamp-2 text-meta leading-[1.55] text-steel">
          {kb.description}
        </p>

        {/* ⑤ 标签 + meta */}
        <div className="mt-9 flex flex-wrap items-center gap-5">
          {tags.map((t) => (
            <Chip key={t.label} tone={t.tone}>
              {t.label}
            </Chip>
          ))}
          {extraTags > 0 ? <Chip tone="gray">+{extraTags}</Chip> : null}
        </div>
        <p className="mt-7 truncate text-micro tabular-nums text-steel">
          {kb.updatedAt} · {kb.docs} 篇 · {kb.size}
        </p>

        {/* ⑥ 底部主操作 */}
        <div
          data-no-drag
          className="mt-10 flex items-center gap-6 border-t border-hairline-soft pt-10"
          onClick={(e) => e.stopPropagation()}
        >
          <Button size="sm" variant="primary" icon="chat" onClick={() => chatWithKb(kb.id)}>
            与知识库对话
          </Button>
          <ToolButton icon="upload" title="上传 / 导入" onClick={() => openImport(kb.id)} />
          <span className="ml-auto">
            <Menu
              side="up"
              align="right"
              width={184}
              items={[
                { label: "查看源文件", icon: "folder", onSelect: () => openKbPage(kb.id) },
                {
                  label: "在右侧预览",
                  icon: "panel",
                  onSelect: () => openPreview({ kind: "kb", kbId: kb.id }),
                },
                { label: "与知识库对话", icon: "chat", onSelect: () => chatWithKb(kb.id) },
                { label: "上传 / 导入", icon: "upload", onSelect: () => openImport(kb.id) },
                {
                  label: kb.pinned ? "取消置顶" : "置顶",
                  icon: "pin",
                  onSelect: () => togglePinKb(kb.id),
                },
                ...(groupId
                  ? [
                      {
                        label: "移出分层",
                        icon: "external" as const,
                        onSelect: () => moveKb(kb.id, null),
                      },
                    ]
                  : []),
                ...(mirror && groupId
                  ? [
                      {
                        label: "撤下镜像",
                        icon: "external" as const,
                        onSelect: () => removeMirror(kb.id, groupId),
                      },
                    ]
                  : []),
                {
                  label: "在另一领域引用…",
                  icon: "copy",
                  onSelect: () => onRequestMirror(kb.id),
                },
                {
                  label: "重命名",
                  icon: "edit",
                  onSelect: () => openKbSettings(kb.id),
                },
                { label: "库设置", icon: "settings", onSelect: () => openKbSettings(kb.id) },
                {
                  label: "删除知识库",
                  icon: "trash",
                  danger: true,
                  onSelect: () =>
                    askConfirm({
                      title: "删除知识库",
                      message: `「${kb.name}」与本地目录 heli/.knowledge/${kb.slug} 会被移除，向量库与索引一并清理。`,
                      confirmText: "删除",
                      danger: true,
                      onConfirm: () => deleteKb(kb.id),
                    }),
                },
              ]}
              trigger={(_open, toggle) => <ToolButton icon="dots" title="更多" onClick={toggle} />}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
