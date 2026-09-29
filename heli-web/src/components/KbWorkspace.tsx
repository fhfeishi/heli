/* ==================================================================
   书架 / 卡片工作台宿主（v2）

   原先这层逻辑长在 KnowledgeView 里；KnowledgeView 改造成走 /api 的
   「资料库」页后，把工作台拆成独立组件，由资料库页按需挂载。
   职责只有四件：

   1. 组装派生层：buildKbLayout(实体, 分层树, 未分层, 镜像, 搜索词)
   2. 视图切换：Segmented（书架 / 卡片）+ 共享元素 FLIP（translate-only，
      书脊 46×212 与卡片长宽比差太多，非等比缩放会拉伸失真）
   3. 排序口径：applyKbSort 是一次性重排动作，渲染不派生排序
   4. Ctrl/Cmd+Z 撤销书架结构操作（输入框聚焦时不拦截）
   ================================================================== */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { buildKbLayout } from "../lib/kbLayout";
import { Icon } from "./Icons";
import { Menu, Segmented, ToolButton } from "./ui";
import { BulkBar } from "./BulkBar";
import { ShelfView } from "./ShelfView";
import { CardView } from "./CardView";
import type { KbView } from "../types";

export function KbWorkspace() {
  const {
    knowledgeBases,
    kbGroups,
    ungroupedOrder,
    kbMirrors,
    kbViewLocal,
    kbViewSavedAt,
    kbView,
    setKbView,
    kbSort,
    applyKbSort,
    undoKb,
  } = useStore();

  const [query, setQuery] = useState("");
  const layout = useMemo(
    () => buildKbLayout(knowledgeBases, kbGroups, ungroupedOrder, kbMirrors, query),
    [knowledgeBases, kbGroups, ungroupedOrder, kbMirrors, query],
  );

  /* ---------------------------------------- 视图切换：共享元素 FLIP */
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const flipFrom = useRef<Map<string, DOMRect>>(new Map());
  const flipPending = useRef(false);

  const snapshotShared = () => {
    const map = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((el) => {
      map.set(el.dataset.flipId!, el.getBoundingClientRect());
    });
    return map;
  };

  const switchView = (v: KbView) => {
    savedScroll.current = scrollRef.current?.scrollTop ?? 0;
    flipFrom.current = snapshotShared();
    flipPending.current = true;
    setKbView(v);
  };

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo(0, savedScroll.current);
    if (!flipPending.current) return;
    flipPending.current = false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((el) => {
      const from = flipFrom.current.get(el.dataset.flipId!);
      if (!from) return;
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (!dx && !dy) return;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.4 },
          { transform: "translate(0, 0)", opacity: 1 },
        ],
        { duration: 200, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" },
      );
    });
  }, [kbView]);

  /* -------------------------- Ctrl/Cmd+Z 撤销（输入框聚焦时不拦截） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return;
      e.preventDefault();
      undoKb();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undoKb]);

  return (
    <div ref={scrollRef} className="flex flex-col">
      {/* 工具行：搜索 · 视图切换 · 排序 · 撤销 */}
      <div className="flex flex-wrap items-center gap-10 px-2">
        <label className="flex h-30 min-w-[200px] flex-1 items-center gap-8 rounded-md border border-hairline bg-canvas px-10 text-stone focus-within:border-primary">
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、描述或标签"
            className="h-full min-w-0 flex-1 bg-transparent text-meta text-ink outline-none placeholder:text-stone"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="清除搜索"
              className="text-stone hover:text-ink"
            >
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </label>
        <Segmented
          value={kbView}
          onChange={switchView}
          options={[
            { value: "shelf", label: "书架", icon: "book" },
            { value: "card", label: "卡片", icon: "grid" },
          ]}
        />
        <Menu
          side="down"
          align="right"
          width={186}
          header="排序方式"
          items={[
            { label: "手工排序", icon: "sort", onSelect: () => applyKbSort("manual") },
            { label: "按更新时间", icon: "clock", onSelect: () => applyKbSort("updated") },
            { label: "按名称", icon: "list", onSelect: () => applyKbSort("name") },
            { label: "按容量", icon: "database", onSelect: () => applyKbSort("size") },
          ]}
          trigger={(_open, toggle) => (
            <ToolButton
              icon="sort"
              title={`排序方式（当前：${
                kbSort === "manual" ? "手工" : kbSort === "updated" ? "更新时间" : kbSort === "name" ? "名称" : "容量"
              }）`}
              onClick={toggle}
            />
          )}
        />
        <ToolButton icon="history" title="撤销（Ctrl+Z）" onClick={undoKb} />
        {/* U5：组织视图当前只写本机浏览器，明确标注，不冒充已保存 */}
        {kbViewLocal ? (
          <span
            title="分组 / 顺序 / 镜像目前只保存在这台机器的浏览器里；后端落盘接口提供后会改为服务端存储"
            className="inline-flex shrink-0 items-center rounded-pill border border-hairline bg-surface px-8 py-4 text-micro text-stone"
          >
            本地仅{kbViewSavedAt ? ` · ${kbViewSavedAt}` : ""}
          </span>
        ) : null}
      </div>

      <BulkBar searching={layout.searching} />

      {/* 视图本体：key 触发 200ms 交叉淡入，FLIP 在 useLayoutEffect 里补位 */}
      <div key={kbView} className="animate-view-swap">
        {kbView === "shelf" ? <ShelfView layout={layout} /> : <CardView layout={layout} />}
      </div>
    </div>
  );
}
