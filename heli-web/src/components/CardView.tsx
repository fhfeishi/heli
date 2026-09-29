/* ==================================================================
   卡片视图 v2（07 书架交互 + 10 视图改版 + 知识库视觉语言 v2）
   与书架共用同一棵树：未分层区 + 各领域分区；领域内的子组渲染为缩进子区
   （3px accent 竖条 + 子组名 + 计数，下属网格缩进 22px）。
   卡片顶部第一行是归属路径（色 = 领域 accent）+ 右侧状态点；
   跨领域引用 = 镜像卡（.book-mirror：虚线描边 + 浅底，路径写「镜像 · 本体在 X」）。
   搜索时打平为结果网格，禁用拖拽。多选 / 批量条 / 确认卡 / 涟漪走既有机制。
   ================================================================== */
import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { ShelfHeader, collapsedGroupSummary } from "./ShelfHeader";
import { ConfirmCard } from "./ConfirmCard";
import { KbCard } from "./KbCard";
import { MirrorPicker, kbFlipRect } from "./MirrorPicker";
import { useKbDnd } from "../lib/kbDnd";
import { useKbGroupDnd } from "../lib/kbGroupDnd";
import { splitKbName } from "../lib/kbName";
import { hueToken, type KbLayout, type KbLayoutGroup } from "../lib/kbLayout";
import type { DomainHue, KnowledgeBase } from "../types";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))]";

/** 让位位移：网格列间余量有限，取值小于 gap（14px），只动 transform 不做非等比缩放 */
const SHIFT_PX = 12;

export function CardView({ layout }: { layout: KbLayout }) {
  const {
    createGroup,
    toggleKbSelection,
    kbSelection,
    knowledgeBases,
    toggleCollapsed,
    moveGroup,
  } = useStore();

  /* 镜像选择浮层的目标书（portal，避免被卡片 overflow 裁掉） */
  const [mirrorFor, setMirrorFor] = useState<string | null>(null);

  const searching = layout.searching;
  const dnd = useKbDnd({ enabled: !searching, gap: 28 });
  /* 子组整体拖：同层调序 / 改挂到别的领域，一次快照可撤销，故免确认 */
  const gDnd = useKbGroupDnd({ enabled: !searching, gap: 14, onMove: moveGroup });

  const renderCard = (
    kb: KnowledgeBase,
    groupId: string | null,
    opts: { hue: DomainHue; path: string; mirror?: boolean; shift?: boolean },
  ) => (
    <div
      key={kb.id}
      className="min-w-0"
      style={{
        /* 让位：只动 transform，不动 gap */
        transform: opts.shift ? `translateX(${SHIFT_PX}px)` : undefined,
        transition: "transform 150ms var(--ease-panel)",
      }}
    >
      <KbCard
        kb={kb}
        groupId={groupId}
        path={opts.path}
        hue={opts.hue}
        mirror={opts.mirror}
        selected={kbSelection.includes(kb.id)}
        landed={dnd.landedId === kb.id}
        mergeTarget={dnd.hover?.kind === "item" && dnd.hover.kbId === kb.id}
        dragSource={dnd.dragKbIds.includes(kb.id)}
        dndEnabled={!searching}
        onBeginArm={dnd.beginArm}
        suppressClickRef={dnd.suppressClickRef}
        onToggleSelect={(additive) => toggleKbSelection(kb.id, additive)}
        onRequestMirror={setMirrorFor}
      />
    </div>
  );

  /**
   * 让位映射：插入点及其右侧的卡片右移 SHIFT_PX。
   * 拖拽索引按「未被拖动项」计数，因此这里同步跳过被拖动的项。
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

  /** 镜像卡的路径行：本体所在位置的完整路径 */
  const mirrorPath = (kb: KnowledgeBase) => "镜像 · 本体在 " + layout.pathOf(kb.id);

  /* ---------------------------------------------------- 搜索打平 */

  if (searching) {
    return (
      <div className="pt-18">
        <div className={`${GRID} gap-14`}>
          {layout.results.map((kb) =>
            renderCard(kb, layout.groupOf.get(kb.id) ?? null, {
              hue: layout.hueOf(kb.id),
              path: layout.pathOf(kb.id),
              mirror: false,
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

  /* pinned 只在卡片视图的未分层区内前置（书架不消费 pinned） */
  const ungroupedSorted = [...layout.ungrouped].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false),
  );

  const flatTree = (groups: KbLayoutGroup[]): KbLayoutGroup[] =>
    groups.flatMap((g) => [g, ...flatTree(g.children)]);
  const dragBox = gDnd.dragGroupId
    ? (flatTree(layout.tree).find((g) => g.id === gDnd.dragGroupId) ?? null)
    : null;

  const dragKbs = dnd.dragKbIds
    .map((id) => knowledgeBases.find((k) => k.id === id))
    .filter((k): k is KnowledgeBase => Boolean(k));
  const ghostKb = dragKbs[0] ?? null;

  const ungroupedShift = shiftMapOf(null, ungroupedSorted);

  /* ---------------------------------------------------- 子组 = 缩进子区 */

  const renderSubgroup = (child: KbLayoutGroup) => {
    const accent = hueToken(child.hue, "accent");
    const shift = shiftMapOf(child.id, child.members);
    const count = child.members.length + child.mirrors.length;
    return (
      <div
        key={child.id}
        data-box-id={child.id}
        data-box-parent={child.parentId ?? ""}
        className={`mt-14 ${gDnd.dragGroupId === child.id ? "opacity-40" : ""} ${
          gDnd.landedGroupId === child.id ? "animate-shelf-land" : ""
        }`}
      >
        <div
          data-box-handle
          title="拖动整个子组"
          onPointerDown={(e) => gDnd.beginArm(e, child.id, child.parentId ?? "")}
          className={`mb-8 flex items-center gap-8 ${searching ? "" : "cursor-grab"}`}
        >
          <span
            aria-hidden
            className="h-14 w-[3px] shrink-0 rounded-pill"
            style={{ background: accent }}
          />
          <button
            type="button"
            onClick={() => toggleCollapsed(child.id)}
            aria-expanded={!child.collapsed}
            title={child.collapsed ? "展开子组" : "收起子组"}
            className="flex shrink-0 items-center gap-6 text-meta font-semibold text-ink"
          >
            <Icon name={child.collapsed ? "chevronRight" : "chevronDown"} size={11} />
            {child.name}
          </button>
          <span className="shrink-0 text-micro text-steel">子组 · {count} 本</span>
        </div>
        {child.collapsed ? (
          <div className="truncate pl-22 text-meta text-steel">
            {collapsedGroupSummary(child)}
          </div>
        ) : (
          <div data-drop-items={child.id} className={`${GRID} gap-14 pl-22`}>
            {child.members.map((kb) =>
              renderCard(kb, child.id, {
                hue: child.hue,
                path: child.path,
                shift: shift.get(kb.id),
              }),
            )}
            {child.mirrors.map((kb) =>
              renderCard(kb, child.id, {
                hue: child.hue,
                path: mirrorPath(kb),
                mirror: true,
              }),
            )}
            {count === 0 ? (
              <span className="text-meta text-steel">把卡片拖进这个子组</span>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-26 pt-18">
      {/* 未分层区 */}
      {ungroupedSorted.length > 0 ? (
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
          <div className="mt-8 rounded-lg border-b-2 border-hairline-strong bg-surface-soft p-16">
            <div data-drop-items="__ungrouped__" className={`${GRID} gap-14`}>
              {ungroupedSorted.map((kb) =>
                renderCard(kb, null, {
                  hue: layout.hueOf(kb.id),
                  path: "未分层",
                  shift: ungroupedShift.get(kb.id),
                }),
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* 各领域分区（含缩进子区） */}
      {layout.tree.map((g) => {
        const isHoverBoard =
          (dnd.hover?.kind === "board" && dnd.hover.groupId === g.id) ||
          (dnd.hover?.kind === "gap" && dnd.hover.groupId === g.id);
        const shift = shiftMapOf(g.id, g.members);
        const empty =
          g.members.length === 0 && g.children.length === 0 && g.mirrors.length === 0;
        return (
          <section key={g.id}>
            <ShelfHeader group={g} />
            {g.collapsed ? (
              <div className="mt-6 truncate px-2 text-meta text-stone">
                {collapsedGroupSummary(g)}
              </div>
            ) : (
              <div
                data-drop-board={g.id}
                className={`mt-8 rounded-lg border-b-2 p-16 transition-[background-color] duration-150 ${
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
                {gDnd.hover?.kind === "board" && gDnd.hover.parentId === g.id ? (
                  <div className="mb-8 rounded-md bg-primary-soft px-12 py-7 text-meta font-medium text-primary">
                    整个子组移到「{g.name}」下
                  </div>
                ) : null}
                {empty ? (
                  <div className="pb-2 text-meta text-steel">
                    把卡片拖到这里，或选中后用批量条「移动到…」
                  </div>
                ) : (
                  <>
                    {g.members.length + g.mirrors.length > 0 ? (
                      <div data-drop-items={g.id} className={`${GRID} gap-14`}>
                        {g.members.map((kb) =>
                          renderCard(kb, g.id, {
                            hue: g.hue,
                            path: g.path,
                            shift: shift.get(kb.id),
                          }),
                        )}
                        {g.mirrors.map((kb) =>
                          renderCard(kb, g.id, {
                            hue: g.hue,
                            path: mirrorPath(kb),
                            mirror: true,
                          }),
                        )}
                      </div>
                    ) : null}
                    {g.children.length > 0 ? g.children.map(renderSubgroup) : null}
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

      {/* 拖拽副本层 */}
      {ghostKb && dnd.phase !== "idle" ? (
        <div className="pointer-events-none fixed inset-0 z-[var(--z-drag-layer)]">
          <div
            ref={dnd.layerRef}
            className="absolute top-0 left-0 cursor-grabbing"
            style={{
              width: dnd.ghostSize?.w ?? 300,
              transform: "translate3d(-400px, -400px, 0)",
              transformOrigin: "top left",
            }}
          >
            <div
              className="relative overflow-hidden rounded-card border border-hairline bg-canvas shadow-overlay"
              style={{ height: dnd.ghostSize?.h ?? 160 }}
            >
              <span className="block h-4 w-full" style={{ background: ghostKb.tint }} />
              <div className="px-14 pt-10">
                <span
                  className="block truncate text-micro font-semibold tracking-[0.4px]"
                  style={{ color: hueToken(layout.hueOf(ghostKb.id), "accent") }}
                >
                  {layout.pathOf(ghostKb.id)}
                </span>
                <p className="mt-6 truncate text-title font-medium text-ink">{ghostKb.name}</p>
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

      {/* 镜像选择浮层 */}
      {mirrorFor ? (
        <MirrorPicker
          kbIds={[mirrorFor]}
          anchor={kbFlipRect(mirrorFor)}
          onClose={() => setMirrorFor(null)}
        />
      ) : null}

      {/* 子组拖拽副本层 */}
      {dragBox && gDnd.phase !== "idle" ? (
        <div className="pointer-events-none fixed inset-0 z-[var(--z-drag-layer)]">
          <div
            ref={gDnd.layerRef}
            className="absolute top-0 left-0 cursor-grabbing"
            style={{
              width: gDnd.ghostSize?.w ?? 300,
              transform: "translate3d(-400px, -400px, 0)",
              transformOrigin: "top left",
            }}
          >
            <div
              className="rounded-card border border-hairline bg-canvas p-12 shadow-overlay"
              style={{ height: gDnd.ghostSize?.h ?? 96 }}
            >
              <div className="flex items-center gap-8">
                <span
                  aria-hidden
                  className="h-14 w-[3px] shrink-0 rounded-pill"
                  style={{ background: hueToken(dragBox.hue, "accent") }}
                />
                <span
                  className="truncate text-meta font-semibold text-ink"
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

      {/* 落点涟漪 */}
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
