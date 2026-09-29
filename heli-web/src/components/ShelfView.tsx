/* ==================================================================
   书架视图 v2（07 书架交互 + 10 视图改版 + 知识库视觉语言 v2）
   书像书一样竖立：书脊只承载「竖排书名 + 底部状态点」，
   底色 = 所属领域的色相族 —— 颜色即归属，全名 / 描述 / 标签 / 篇数 /
   快捷操作全部留在 hover 封面卡（200ms 延迟）。
   顶层分组 = 领域层板；子组 = 层板内的书盒（.bookbox，同族深一档）；
   跨领域引用 = 镜像书（.book-mirror，虚线描边，本体唯一）。
   拖拽让位只动 transform（禁改 gap），插入指示条 + 涟漪 + 确认卡走 useKbDnd。
   ================================================================== */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { Chip, Menu, ToolButton } from "./ui";
import { ShelfHeader, collapsedGroupSummary } from "./ShelfHeader";
import { ConfirmCard } from "./ConfirmCard";
import { MirrorPicker, kbFlipRect } from "./MirrorPicker";
import { useKbDnd } from "../lib/kbDnd";
import { useKbGroupDnd } from "../lib/kbGroupDnd";
import { splitKbName } from "../lib/kbName";
import { hueToken, type KbLayout, type KbLayoutGroup } from "../lib/kbLayout";
import { KB_STATUS_COLOR, KB_STATUS_LABEL } from "../types";
import type { DomainHue, KnowledgeBase } from "../types";

/** 书脊底色档位：领域层板用 spine，书盒内用 deep（同族深一档） */
type BookTone = "spine" | "deep";

/** 让位位移：插入点右侧的书整体右移，避免动画 gap 引发每帧 layout */
const SHIFT_PX = 20;

const SPINE_MAX = 10;

export function ShelfView({ layout }: { layout: KbLayout }) {
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
    createGroup,
    toggleCollapsed,
    removeMirror,
    moveGroup,
  } = useStore();

  const searching = layout.searching;
  /* gap 只用于插入指示条的定位（视觉间距由 SHIFT_PX 让位产生） */
  const dnd = useKbDnd({ enabled: !searching, gap: 34 });
  /* 书盒（子组）整体拖：同级调序 / 改挂到别的领域，一次快照可撤销，故免确认 */
  const gDnd = useKbGroupDnd({ enabled: !searching, gap: 14, onMove: moveGroup });

  /* ------------------------------------------------ 封面卡浮出 */
  const [cover, setCover] = useState<{
    kbId: string;
    left: number;
    top: number;
    height: number;
    mirror: boolean;
    /** 这本书当前所在的组：镜像的「撤下镜像」出口需要它 */
    groupId: string | null;
  } | null>(null);
  /* 镜像选择浮层（portal，脱离封面卡的生命周期） */
  const [mirrorFor, setMirrorFor] = useState<{
    kbIds: string[];
    anchor: ReturnType<typeof kbFlipRect>;
  } | null>(null);
  const coverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (coverTimer.current) window.clearTimeout(coverTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    coverTimer.current = null;
    closeTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const scheduleCover = (
    kb: KnowledgeBase,
    el: HTMLElement,
    immediate = false,
    mirror = false,
    groupId: string | null = null,
  ) => {
    clearTimers();
    const show = () => {
      const r = el.getBoundingClientRect();
      const flip = r.right + 176 > window.innerWidth - 8;
      setCover({
        kbId: kb.id,
        left: flip ? Math.max(8, r.left - 176) : r.right + 8,
        top: Math.max(8, Math.min(r.top, window.innerHeight - r.height - 8)),
        height: r.height,
        mirror,
        groupId,
      });
    };
    if (immediate) show();
    else coverTimer.current = window.setTimeout(show, 200);
  };
  const scheduleCoverClose = () => {
    if (coverTimer.current) window.clearTimeout(coverTimer.current);
    coverTimer.current = null;
    closeTimer.current = window.setTimeout(() => setCover(null), 150);
  };
  const cancelCoverClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  /* ---------------------------------------------------- 书 */

  const renderBook = (
    kb: KnowledgeBase,
    groupId: string | null,
    opts: { hue: DomainHue; tone: BookTone; mirror?: boolean; shift?: boolean },
  ) => {
    const isSource = dnd.dragKbIds.includes(kb.id);
    const isMergeTarget = dnd.hover?.kind === "item" && dnd.hover.kbId === kb.id;
    const st = KB_STATUS_LABEL[kb.status];
    const { sub } = splitKbName(kb.name);
    const raw = groupId ? sub : kb.name;
    const title = raw.length > SPINE_MAX ? raw.slice(0, SPINE_MAX) : raw;
    const accent = hueToken(opts.hue, "accent");
    const fg = hueToken(opts.hue, "text");
    const mirror = opts.mirror ?? false;

    return (
      <div
        key={kb.id}
        data-drop-item={kb.id}
        data-flip-id={kb.id}
        role="button"
        tabIndex={0}
        aria-label={`《${kb.name}》，${st.label}${mirror ? "，镜像" : ""}`}
        onPointerDown={(e) => dnd.beginArm(e, kb, groupId)}
        onClick={() => {
          if (dnd.suppressClickRef.current) return;
          openKbPage(kb.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openKbPage(kb.id);
          }
        }}
        onMouseEnter={(e) => scheduleCover(kb, e.currentTarget, false, mirror, groupId)}
        onMouseLeave={scheduleCoverClose}
        onFocus={(e) => scheduleCover(kb, e.currentTarget, true, mirror, groupId)}
        onBlur={scheduleCoverClose}
        className={`group/book relative shrink-0 select-none ${
          searching ? "" : "cursor-grab"
        }`}
        style={{
          touchAction: "pan-y",
          /* 让位：只动 transform，不动 gap */
          transform: opts.shift ? `translateX(${SHIFT_PX}px)` : undefined,
          transition: "transform 150ms var(--ease-panel)",
        }}
      >
        <div
          className={`book-v2 group-hover/book:-translate-y-[10px] group-focus-visible/book:-translate-y-[10px] relative overflow-hidden transition-transform duration-120 ease-out ${
            mirror ? "book-mirror border" : ""
          } ${isSource ? "opacity-30" : ""} ${
            dnd.landedId === kb.id ? "animate-shelf-land" : ""
          }`}
          style={{
            background: mirror ? "transparent" : hueToken(opts.hue, opts.tone),
            ...(mirror ? { borderColor: accent } : {}),
            ...(isMergeTarget ? { outline: `2px solid ${accent}` } : {}),
          }}
        >
          {/* hover 阴影层（过渡 opacity，不过渡 box-shadow） */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xs opacity-0 shadow-card-hover transition-opacity duration-120 group-hover/book:opacity-100"
          />

          {/* 竖排书名：衬线，≤10 字 */}
          <div className="absolute inset-x-0 top-12 bottom-22 flex justify-center">
            <span
              className="spine-serif text-title font-medium"
              style={{ color: mirror ? accent : fg }}
            >
              {title}
            </span>
          </div>

          {/* 底部状态点 */}
          <div className="absolute inset-x-0 bottom-0 flex justify-center pb-7">
            <span
              className="size-6 rounded-full"
              style={{ background: KB_STATUS_COLOR[kb.status] }}
              title={st.label}
              role="img"
              aria-label={st.label}
            />
          </div>

          {/* 镜像角标：9px 链接标记 */}
          {mirror ? (
            <span
              aria-hidden
              className="absolute top-4 right-4 size-9 rounded-pill"
              style={{ background: accent }}
            />
          ) : null}
        </div>

        {/* 拖拽中原位虚线占位 */}
        {isSource ? (
          <div className="pointer-events-none absolute inset-0 rounded-xs border border-dashed border-hairline-strong" />
        ) : null}
      </div>
    );
  };

  /**
   * 让位映射：插入点及其右侧的书右移 SHIFT_PX。
   * 拖拽索引是按「未被拖动项」算的，因此这里同步跳过被拖动的项再计数。
   */
  const shiftMapOf = (groupId: string | null, items: KnowledgeBase[]) => {
    const h = dnd.hover;
    const index = h && h.kind === "gap" && h.groupId === groupId ? h.index : -1;
    const out = new Map<string, boolean>();
    let j = 0;
    for (const kb of items) {
      const dragged = dnd.dragKbIds.includes(kb.id);
      const at = j;
      if (!dragged) j += 1;
      out.set(kb.id, index >= 0 && !dragged && at >= index);
    }
    return out;
  };

  /* ---------------------------------------------------- 书盒（子组） */

  const renderBookbox = (child: KbLayoutGroup) => {
    const accent = hueToken(child.hue, "accent");
    const shift = shiftMapOf(child.id, child.members);
    return (
      <div
        key={child.id}
        data-box-id={child.id}
        data-box-parent={child.parentId ?? ""}
        className={`bookbox ${gDnd.dragGroupId === child.id ? "opacity-40" : ""} ${
          gDnd.landedGroupId === child.id ? "animate-shelf-land" : ""
        }`}
        style={{
          /* 同族 spine 提亮一档：层板内的嵌套格 */
          background: `color-mix(in srgb, ${hueToken(child.hue, "spine")} 55%, var(--canvas))`,
          color: accent,
        }}
      >
        <div
          data-box-handle
          title="拖动整个子组"
          onPointerDown={(e) => gDnd.beginArm(e, child.id, child.parentId ?? "")}
          className={`flex items-center gap-6 px-10 pt-8 pb-6 ${
            searching ? "" : "cursor-grab"
          }`}
        >
          <button
            type="button"
            onClick={() => toggleCollapsed(child.id)}
            aria-expanded={!child.collapsed}
            title={child.collapsed ? "展开子组" : "收起子组"}
            className="grid size-18 shrink-0 place-items-center rounded-xs hover:bg-surface"
            style={{ color: accent }}
          >
            <Icon name={child.collapsed ? "chevronRight" : "chevronDown"} size={12} />
          </button>
          <span className="truncate text-meta font-semibold" style={{ color: accent }}>
            {child.name}
          </span>
          <span className="shrink-0 text-micro text-steel">
            子组 · {child.members.length + child.mirrors.length} 本
          </span>
        </div>
        {child.collapsed ? (
          <div className="truncate px-10 pb-8 text-micro text-steel">
            {collapsedGroupSummary(child)}
          </div>
        ) : (
          <div
            data-drop-items={child.id}
            className="flex flex-wrap items-end gap-14 px-10 pb-10"
          >
            {child.members.map((kb) =>
              renderBook(kb, child.id, {
                hue: child.hue,
                tone: "deep",
                shift: shift.get(kb.id),
              }),
            )}
            {child.mirrors.map((kb) =>
              renderBook(kb, child.id, {
                hue: child.hue,
                tone: "deep",
                mirror: true,
              }),
            )}
            {child.members.length === 0 && child.mirrors.length === 0 ? (
              <span className="pb-2 text-micro text-steel">把书拖进这个盒子</span>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  /* ---------------------------------------------------- 封面卡 */

  const coverKb = cover ? (layout.results.find((k) => k.id === cover.kbId) ?? null) : null;

  /* ---------------------------------------------------- 搜索打平 */

  if (searching) {
    return (
      <div className="pt-18">
        <div className="flex flex-wrap items-end gap-14">
          {layout.results.map((kb) =>
            renderBook(kb, layout.groupOf.get(kb.id) ?? null, {
              hue: layout.hueOf(kb.id),
              tone: "spine",
            }),
          )}
        </div>
        <p className="mt-16 flex items-center gap-6 text-meta text-steel">
          <Icon name="search" size={12} />
          搜索时不能整理分层
        </p>
      </div>
    );
  }

  /* ---------------------------------------------------- 主体 */

  const flatTree = (groups: KbLayoutGroup[]): KbLayoutGroup[] =>
    groups.flatMap((g) => [g, ...flatTree(g.children)]);
  const dragBox = gDnd.dragGroupId
    ? (flatTree(layout.tree).find((g) => g.id === gDnd.dragGroupId) ?? null)
    : null;

  const dragKbs = dnd.dragKbIds
    .map((id) => layout.results.find((k) => k.id === id))
    .filter((k): k is KnowledgeBase => Boolean(k));
  const ghostKb = dragKbs[0] ?? null;

  const ungroupedShift = shiftMapOf(null, layout.ungrouped);

  return (
    <div className="flex flex-col gap-26 pt-18">
      {/* 未分层区 */}
      {layout.ungrouped.length > 0 ? (
        <section data-drop-ungrouped>
          {dnd.hover?.kind === "ungrouped" ? (
            <div className="mb-8 rounded-md bg-primary-soft px-12 py-7 text-meta font-medium text-primary">
              移出分层，恢复独立
            </div>
          ) : null}
          {layout.tree.length > 0 ? (
            <div className="px-2 pb-2 text-micro font-semibold tracking-[0.6px] text-stone">
              未分层
            </div>
          ) : null}
          <div className="shelf-board contain-board mt-8 rounded-lg border-b-2 border-hairline-strong bg-surface-soft px-16 pt-14 pb-16">
            <div data-drop-items="__ungrouped__" className="flex flex-wrap items-end gap-14">
              {layout.ungrouped.map((kb) =>
                renderBook(kb, null, {
                  hue: layout.hueOf(kb.id),
                  tone: "spine",
                  shift: ungroupedShift.get(kb.id),
                }),
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* 若干领域（含书盒子组） */}
      {layout.tree.map((g) => {
        const isHoverBoard =
          (dnd.hover?.kind === "board" && dnd.hover.groupId === g.id) ||
          (dnd.hover?.kind === "gap" && dnd.hover.groupId === g.id);
        const shift = shiftMapOf(g.id, g.members);
        const empty = g.members.length === 0 && g.children.length === 0 && g.mirrors.length === 0;
        return (
          <section key={g.id}>
            <ShelfHeader group={g} />
            {g.collapsed ? (
              <div className="mt-6 truncate px-2 text-meta text-steel">
                {collapsedGroupSummary(g)}
              </div>
            ) : (
              <div
                data-drop-board={g.id}
                className={`shelf-board contain-board mt-8 rounded-lg border-b-2 px-16 pt-14 pb-16 transition-[background-color] duration-150 ${
                  isHoverBoard
                    ? "border-primary bg-primary-soft-2"
                    : "border-hairline-strong bg-surface-soft"
                }`}
                style={{
                  transitionTimingFunction: "var(--ease-panel)",
                  ...(dnd.hover?.kind === "board" && dnd.hover.groupId === g.id
                    ? { outline: "1px dashed var(--primary)", outlineOffset: "-1px" }
                    : {}),
                }}
              >
                {empty ? (
                  <div className="pb-2 text-meta text-steel">
                    把书拖到这里，或从书的菜单「移动到本层」
                  </div>
                ) : (
                  <>
                    <div data-drop-items={g.id} className="flex flex-wrap items-end gap-14">
                      {g.members.map((kb) =>
                        renderBook(kb, g.id, {
                          hue: g.hue,
                          tone: "spine",
                          shift: shift.get(kb.id),
                        }),
                      )}
                      {g.mirrors.map((kb) =>
                        renderBook(kb, g.id, { hue: g.hue, tone: "spine", mirror: true }),
                      )}
                    </div>
                    {g.children.length > 0 ? (
                      <div className="mt-14 flex flex-wrap items-start gap-14">
                        {g.children.map(renderBookbox)}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* 底部「新建分层」虚线层 */}
      <button
        type="button"
        onClick={() => createGroup("新分层")}
        className="font-app flex items-center justify-center gap-8 rounded-lg border border-dashed border-hairline-strong py-18 text-meta text-stone transition-colors hover:border-primary hover:text-primary"
      >
        <Icon name="plus" size={13} />
        新建分层
      </button>

      {/* 封面卡（条件挂载，避免每本书常驻合成层） */}
      {cover && coverKb ? (
        <div
          data-no-drag
          onMouseEnter={cancelCoverClose}
          onMouseLeave={scheduleCoverClose}
          onFocus={cancelCoverClose}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) scheduleCoverClose();
          }}
          className="cover-card fixed z-[var(--z-menu)] flex w-[168px] flex-col rounded-card border border-hairline bg-canvas p-12 shadow-menu"
          style={{ left: cover.left, top: cover.top, height: cover.height }}
        >
          <p className="line-clamp-2 text-title leading-[1.35] font-semibold text-ink">
            {coverKb.name}
          </p>
          {cover.mirror ? (
            <p className="mt-2 truncate text-micro text-steel">
              镜像 · 本体在 {layout.pathOf(coverKb.id)}
            </p>
          ) : null}
          <p className="mt-4 line-clamp-2 text-micro leading-[1.5] text-steel">
            {coverKb.description}
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            {coverKb.tags.slice(0, 2).map((t) => (
              <Chip key={t.label} tone={t.tone}>
                {t.label}
              </Chip>
            ))}
          </div>
          <p className="mt-auto truncate text-micro tabular-nums text-steel">
            {coverKb.updatedAt}
            <br />
            {coverKb.docs} 篇 · {coverKb.size}
          </p>
          <div className="mt-6 flex items-center gap-2 border-t border-hairline-soft pt-6">
            <ToolButton
              icon="panel"
              title="在右侧预览"
              onClick={() => openPreview({ kind: "kb", kbId: coverKb.id })}
            />
            <ToolButton icon="chat" title="与知识库对话" onClick={() => chatWithKb(coverKb.id)} />
            <Menu
              side="down"
              align="right"
              width={184}
              items={[
                { label: "查看源文件", icon: "folder", onSelect: () => openKbPage(coverKb.id) },
                {
                  label: "在右侧预览",
                  icon: "panel",
                  onSelect: () => openPreview({ kind: "kb", kbId: coverKb.id }),
                },
                { label: "与知识库对话", icon: "chat", onSelect: () => chatWithKb(coverKb.id) },
                { label: "上传 / 导入", icon: "upload", onSelect: () => openImport(coverKb.id) },
                {
                  label: coverKb.pinned ? "取消置顶" : "置顶",
                  icon: "pin",
                  onSelect: () => togglePinKb(coverKb.id),
                },
                ...(layout.groupOf.has(coverKb.id)
                  ? [
                      {
                        label: "移出分层",
                        icon: "external" as const,
                        onSelect: () => moveKb(coverKb.id, null),
                      },
                    ]
                  : []),
                ...(cover.mirror && cover.groupId
                  ? [
                      {
                        label: "撤下镜像",
                        icon: "external" as const,
                        onSelect: () => removeMirror(coverKb.id, cover.groupId!),
                      },
                    ]
                  : []),
                {
                  label: "在另一领域引用…",
                  icon: "copy",
                  onSelect: () =>
                    setMirrorFor({ kbIds: [coverKb.id], anchor: kbFlipRect(coverKb.id) }),
                },
                { label: "库设置", icon: "settings", onSelect: () => openKbSettings(coverKb.id) },
                {
                  label: "删除知识库",
                  icon: "trash",
                  danger: true,
                  onSelect: () =>
                    askConfirm({
                      title: "删除知识库",
                      message: `「${coverKb.name}」与本地目录 heli/.knowledge/${coverKb.slug} 会被移除，向量库与索引一并清理。`,
                      confirmText: "删除",
                      danger: true,
                      onConfirm: () => deleteKb(coverKb.id),
                    }),
                },
              ]}
              trigger={(_open, toggle) => <ToolButton icon="dots" title="更多" onClick={toggle} />}
            />
          </div>
        </div>
      ) : null}

      {/* 镜像选择浮层 */}
      {mirrorFor ? (
        <MirrorPicker
          kbIds={mirrorFor.kbIds}
          anchor={mirrorFor.anchor}
          onClose={() => setMirrorFor(null)}
        />
      ) : null}

      {/* 拖拽副本层：transform 直改，不走 React 重渲染 */}
      {ghostKb && dnd.phase !== "idle" ? (
        <div className="pointer-events-none fixed inset-0 z-[var(--z-drag-layer)]">
          <div
            ref={dnd.layerRef}
            className="absolute top-0 left-0 cursor-grabbing"
            style={{
              width: dnd.ghostSize?.w ?? 46,
              transform: "translate3d(-200px, -200px, 0)",
              transformOrigin: "top left",
            }}
          >
            <div
              className="book-v2 relative overflow-hidden shadow-overlay"
              style={{
                background: hueToken(layout.hueOf(ghostKb.id), "spine"),
                height: dnd.ghostSize?.h ?? 212,
              }}
            >
              <div className="absolute inset-x-0 top-12 bottom-22 flex justify-center">
                <span
                  className="spine-serif text-title font-medium"
                  style={{ color: hueToken(layout.hueOf(ghostKb.id), "text") }}
                >
                  {splitKbName(ghostKb.name).sub.slice(0, SPINE_MAX)}
                </span>
              </div>
            </div>
            {dragKbs.length > 1 ? (
              <span className="absolute -top-8 -right-8 grid size-18 place-items-center rounded-full bg-primary text-micro font-semibold text-on-primary">
                {dragKbs.length}
              </span>
            ) : null}
            {dnd.hover?.kind === "item" ? (
              <span className="absolute top-8 left-[calc(100%+8px)] rounded-pill bg-ink px-8 py-3 text-micro whitespace-nowrap text-canvas shadow-menu">
                合并为一层
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 书盒拖拽副本层 */}
      {dragBox && gDnd.phase !== "idle" ? (
        <div className="pointer-events-none fixed inset-0 z-[var(--z-drag-layer)]">
          <div
            ref={gDnd.layerRef}
            className="absolute top-0 left-0 cursor-grabbing"
            style={{
              width: gDnd.ghostSize?.w ?? 220,
              transform: "translate3d(-400px, -400px, 0)",
              transformOrigin: "top left",
            }}
          >
            <div
              className="bookbox shadow-overlay"
              style={{
                height: gDnd.ghostSize?.h ?? 140,
                background: `color-mix(in srgb, ${hueToken(dragBox.hue, "spine")} 55%, var(--canvas))`,
                color: hueToken(dragBox.hue, "accent"),
              }}
            >
              <div className="flex items-center gap-6 px-10 pt-8 pb-6">
                <span
                  className="truncate text-meta font-semibold"
                  style={{ color: hueToken(dragBox.hue, "accent") }}
                >
                  {dragBox.name}
                </span>
                <span className="shrink-0 text-micro text-steel">
                  子组 · {dragBox.members.length + dragBox.mirrors.length} 本
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {gDnd.indicator ? (
        <span
          className="drop-indicator"
          style={{
            left: gDnd.indicator.left,
            top: gDnd.indicator.top,
            height: gDnd.indicator.height,
          }}
        />
      ) : null}

      {gDnd.ripple ? (
        <span
          key={gDnd.ripple.key}
          className="animate-shelf-ripple pointer-events-none fixed z-[var(--z-drag-layer)] size-72 rounded-full"
          style={{
            left: gDnd.ripple.x,
            top: gDnd.ripple.y,
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-primary) 18%, transparent) 0%, transparent 70%)",
            border: "2px solid color-mix(in srgb, var(--color-primary) 18%, transparent)",
          }}
        />
      ) : null}

      {/* 插入指示条 */}
      {dnd.indicator ? (
        <span
          className="drop-indicator"
          style={{ left: dnd.indicator.left, top: dnd.indicator.top, height: dnd.indicator.height }}
        />
      ) : null}

      {/* 落点涟漪（300ms 一次） */}
      {dnd.ripple ? (
        <span
          key={dnd.ripple.key}
          className="animate-shelf-ripple pointer-events-none fixed z-[var(--z-drag-layer)] size-72 rounded-full"
          style={{
            left: dnd.ripple.x,
            top: dnd.ripple.y,
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-primary) 18%, transparent) 0%, transparent 70%)",
            border: "2px solid color-mix(in srgb, var(--color-primary) 18%, transparent)",
          }}
        />
      ) : null}

      {/* 就地确认卡 */}
      {dnd.confirmCard ? (
        <ConfirmCard
          card={dnd.confirmCard}
          dragLabel={ghostKb ? splitKbName(ghostKb.name).sub : "选中项"}
          returnFocusId={dnd.dragKbIds[0]}
          onConfirm={(name?: string) => {
            if (name !== undefined) dnd.mergeNameRef.current = name;
            dnd.doConfirm();
          }}
          onCancel={dnd.cancelConfirm}
        />
      ) : null}
    </div>
  );
}
