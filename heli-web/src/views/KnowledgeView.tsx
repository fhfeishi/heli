/* 资料库总览：组 + 库。分组是普通成员关系，一个库可以同时出现在多个组。
   三种视图（卡片 / 书架 / 列表）共用同一份数据与同一组操作，视图选择存 URL。
   拖拽表达「加关系」而不是「移动」：拖进组 = addMember，拖到未分组 = 移除全部关系。 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icons";
import { Button, Chip, EmptyState, Field, Menu, Segmented, SearchField, ViewHeader, inputCls, textareaCls } from "../components/ui";
import { Paths, navigate, useRoute } from "../app/router";
import { api, type Group, type Library } from "../model/api";
import { useWorkspace } from "../model/store";
import { describeError } from "../model/errors";

type ViewMode = "card" | "shelf" | "list";
type SortMode = "name" | "sources" | "coverage";
type ChipTone = "mint" | "peach" | "lav" | "sky" | "rose" | "gray";

const VIEWS: { value: ViewMode; label: string; icon: IconName }[] = [
  { value: "card", label: "卡片", icon: "grid" },
  { value: "shelf", label: "书架", icon: "book" },
  { value: "list", label: "列表", icon: "doc" },
];

const SORTS: { value: SortMode; label: string }[] = [
  { value: "name", label: "按名称" },
  { value: "sources", label: "按资料数" },
  { value: "coverage", label: "按索引率" },
];

/** 组的色调 → 令牌类。库里存字符串，未知值回退中性色。 */
const HUE_TONE: Record<string, ChipTone> = {
  sky: "sky", mint: "mint", lav: "lav", lavender: "lav",
  peach: "peach", rose: "rose", neutral: "gray", gray: "gray",
};
const HUE_BORDER: Record<string, string> = {
  sky: "border-on-tint-sky",
  mint: "border-on-tint-mint",
  lav: "border-on-tint-lavender",
  lavender: "border-on-tint-lavender",
  peach: "border-on-tint-peach",
  rose: "border-on-tint-rose",
  neutral: "border-hairline-strong",
  gray: "border-hairline-strong",
};
/** 组色相 → 领域书脊表面：卡片顶部色沿与书架书脊共用同一张表，
    保证「书 = 实体、颜色 = 归属」在两种视图里是同一件事。未知 hue 回退纸色。
    注意：每个类名都要以完整字面量写在这里。Tailwind 在构建期扫源码文本取类名，
    `hover:${x}` 这种拼出来的字符串它看不到，样式会静默丢失。 */
const HUE_SPINE: Record<
  string,
  { spine: string; deep: string; deepHover: string; text: string }
> = {
  sky: {
    spine: "bg-domain-sky-spine", deep: "bg-domain-sky-deep",
    deepHover: "hover:bg-domain-sky-deep", text: "text-domain-sky-text",
  },
  mint: {
    spine: "bg-domain-mint-spine", deep: "bg-domain-mint-deep",
    deepHover: "hover:bg-domain-mint-deep", text: "text-domain-mint-text",
  },
  lav: {
    spine: "bg-domain-lavender-spine", deep: "bg-domain-lavender-deep",
    deepHover: "hover:bg-domain-lavender-deep", text: "text-domain-lavender-text",
  },
  lavender: {
    spine: "bg-domain-lavender-spine", deep: "bg-domain-lavender-deep",
    deepHover: "hover:bg-domain-lavender-deep", text: "text-domain-lavender-text",
  },
  peach: {
    spine: "bg-domain-peach-spine", deep: "bg-domain-peach-deep",
    deepHover: "hover:bg-domain-peach-deep", text: "text-domain-peach-text",
  },
  rose: {
    spine: "bg-domain-rose-spine", deep: "bg-domain-rose-deep",
    deepHover: "hover:bg-domain-rose-deep", text: "text-domain-rose-text",
  },
  neutral: {
    spine: "bg-domain-neutral-spine", deep: "bg-domain-neutral-deep",
    deepHover: "hover:bg-domain-neutral-deep", text: "text-domain-neutral-text",
  },
  gray: {
    spine: "bg-domain-neutral-spine", deep: "bg-domain-neutral-deep",
    deepHover: "hover:bg-domain-neutral-deep", text: "text-domain-neutral-text",
  },
};
const NEUTRAL_SPINE = HUE_SPINE.neutral;
const toneOf = (hue: string): ChipTone => HUE_TONE[hue] ?? "gray";
const borderOf = (hue: string): string => HUE_BORDER[hue] ?? HUE_BORDER.neutral;
const spineOf = (hue: string): string => (HUE_SPINE[hue] ?? NEUTRAL_SPINE).spine;
const spineSet = (hue: string | null) => HUE_SPINE[hue ?? ""] ?? NEUTRAL_SPINE;

/* 组可选色相：新建子组 / 重命名时如果选了这个，库里就存这个 hue。
   未知 hue 由 toneOf/borderOf 回退到中性色，所以这里只要不漏掉已知全集。 */
const GROUP_HUES: { value: string; label: string }[] = [
  { value: "neutral", label: "纸色" },
  { value: "sky", label: "蓝" },
  { value: "mint", label: "绿" },
  { value: "lavender", label: "紫" },
  { value: "peach", label: "橙" },
  { value: "rose", label: "玫红" },
];

/* ------------------------------------------------------ 系列名与短名 ---- */

/** 抽取系列前缀：这批库多为「系列-方向」命名（如 自然科学基金-AI与材料），
    首段出现 ≥3 次即视为系列名，界面上只突出方向本身。 */
function seriesOf(names: string[]): string | null {
  const counts = new Map<string, number>();
  for (const name of names) {
    const cut = name.indexOf("-");
    if (cut <= 1) continue;
    const head = name.slice(0, cut);
    counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [head, count] of counts) {
    if (count >= 3 && count > bestCount) {
      best = head;
      bestCount = count;
    }
  }
  return best;
}

/** 去掉系列前缀；没有前缀或去完为空则原样返回。 */
function shortName(name: string, series: string | null): string {
  if (!series || !name.startsWith(series)) return name;
  const rest = name.slice(series.length).replace(/^[-－]+/, "").trim();
  return rest || name;
}

/** 视图是 UI 状态：放 URL，刷新与分享都能还原。
    默认书架：这是知识库自己的语言；卡片与列表是备用的平铺读法。 */
function useViewMode(): [ViewMode, (next: ViewMode) => void] {
  const route = useRoute();
  const raw = route.search.get("view");
  const view: ViewMode = raw === "card" || raw === "list" ? raw : "shelf";
  return [view, (next) => navigate(Paths.knowledge(next), { replace: true })];
}

function sortLibraries(items: Library[], mode: SortMode): Library[] {
  const sorted = [...items];
  const byName = (a: Library, b: Library) => a.name.localeCompare(b.name, "zh-Hans-CN");
  if (mode === "sources") sorted.sort((a, b) => b.source_count - a.source_count || byName(a, b));
  else if (mode === "coverage") {
    const ratio = (library: Library) =>
      library.source_count ? library.indexed_count / library.source_count : -1;
    sorted.sort((a, b) => ratio(b) - ratio(a) || b.source_count - a.source_count || byName(a, b));
  } else sorted.sort(byName);
  return sorted;
}

/* ------------------------------------------------------------ 拖拽壳 ---- */

function Draggable({
  libraryId,
  dragging,
  onStart,
  onEnd,
  className = "",
  children,
}: {
  libraryId: string;
  dragging: boolean;
  onStart: (id: string) => void;
  onEnd: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", libraryId);
        event.dataTransfer.effectAllowed = "copy";
        onStart(libraryId);
      }}
      onDragEnd={onEnd}
      className={`${className} ${dragging ? "opacity-40" : ""} transition-opacity duration-120`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- 覆盖率 ---- */

function Coverage({ library }: { library: Library }) {
  const total = library.source_count;
  const indexed = library.indexed_count;
  const percent = total ? Math.min(100, Math.round((indexed / total) * 100)) : 0;
  const complete = total > 0 && indexed >= total;
  /* 条在同一个 RAF 之后从 0 生长到目标宽度：索引覆盖率是读数，给一点生长让它被看见 */
  const [grown, setGrown] = useState(0);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setGrown(percent));
    return () => window.cancelAnimationFrame(frame);
  }, [percent]);

  return (
    <div className="mt-14">
      <div className="flex items-end gap-10">
        <span className="flex min-w-0 items-baseline gap-4">
          <span className="text-h2 font-semibold leading-none tabular-nums text-ink">{total}</span>
          <span className="whitespace-nowrap text-micro text-stone">资料</span>
        </span>
        <span className="flex min-w-0 items-baseline gap-4">
          <span
            className={`text-h2 font-semibold leading-none tabular-nums ${
              complete ? "text-on-tint-mint" : indexed > 0 ? "text-charcoal" : "text-muted"
            }`}
          >
            {indexed}
          </span>
          <span className="whitespace-nowrap text-micro text-stone">可检索</span>
        </span>
        <span className="mb-1 ml-auto whitespace-nowrap text-micro tabular-nums text-stone">{percent}%</span>
      </div>
      <div className="mt-8 h-3 overflow-hidden rounded-pill bg-surface-sink">
        <div
          className={`h-full rounded-pill origin-left transition-transform duration-500 ease-out ${complete ? "bg-on-tint-mint" : "bg-primary"}`}
          style={{ transform: `scaleX(${grown / 100})` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- 图标钮 ---- */

function IconButton({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      /* 卡片整块是可点的导航区，内层按钮必须自己拦事件，
         否则「加入分组 / 归档」会连带触发进入资料库 */
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`flex h-24 w-24 items-center justify-center rounded-sm border transition-colors duration-120 ${
        danger
          ? "border-transparent text-stone hover:bg-danger-soft hover:text-red"
          : active
            ? "border-primary bg-primary-soft text-primary"
            : "border-transparent text-stone hover:bg-surface hover:text-charcoal"
      }`}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

/** 相对时间：卡片上只回答「最近动过没」，不显示精确到秒的时间戳 */
function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}
/* -------------------------------------------------------------- 卡片 ---- */

function LibraryCard({
  library,
  groups,
  contextGroupId,
  contextHue,
  series,
  delay = 0,
  dragging,
  onStart,
  onEnd,
  onAddToGroup,
  onArchive,
}: {
  library: Library;
  groups: Group[];
  contextGroupId: string | null;
  contextHue: string | null;
  series: string | null;
  delay?: number;
  dragging: boolean;
  onStart: (id: string) => void;
  onEnd: () => void;
  onAddToGroup: (groupId: string) => void;
  onArchive: () => void;
}) {
  const [picking, setPicking] = useState(false);
  /* 归档是不可撤销的操作（会把整个库及其资料退出检索），必须二次确认 */
  const [confirming, setConfirming] = useState(false);
  /* 当前组里不再重复显示这个组；只显示「也在其他组」 */
  const others = groups.filter(
    (group) => group.id !== contextGroupId && library.group_ids.includes(group.id),
  );
  const title = shortName(library.name, series);
  const showSeries = Boolean(series) && title !== library.name;
  /** 覆盖沿颜色：当前所在组的归属色（未分组 = 纸色），让「书 = 实体、颜色 = 归属」的隐喻延伸到卡片 */
  const coverHue = contextHue ?? "neutral";
  /* 卡片先回答三个决策问题：哪个库、有多少可用资料、最近动过没 */
  const pending = Math.max(0, library.source_count - library.indexed_count);

  return (
    <Draggable libraryId={library.id} dragging={dragging} onStart={onStart} onEnd={onEnd} className="h-full">
      {/* 总览只回答「选哪个库、规模多大、能不能检索」；说明与操作进详情页与 hover */}
      <article
        onClick={() => navigate(Paths.kb(library.id))}
        title={library.description || undefined}
        style={{ animationDelay: `${delay}ms` }}
        onMouseMove={(mouseEvent) => {
          const box = mouseEvent.currentTarget.getBoundingClientRect();
          mouseEvent.currentTarget.style.setProperty("--mx", `${mouseEvent.clientX - box.left}px`);
          mouseEvent.currentTarget.style.setProperty("--my", `${mouseEvent.clientY - box.top}px`);
        }}
        className="group animate-rise spotlight relative flex h-full cursor-pointer flex-col rounded-lg border border-hairline bg-canvas p-16 transition-[border-color,box-shadow,transform] duration-160 hover:-translate-y-1 hover:border-hairline-strong hover:shadow-card-hover active:scale-[0.99]"
      >
        {/* 顶部领域色沿：卡片的“书脊”，一眼看出归属组；未分组用纸色 */}
        <span
          aria-hidden
          className={`absolute inset-x-0 top-0 h-6 rounded-t-[calc(var(--radius-card)-1px)] ${spineOf(coverHue)}`}
        />

        <div className="absolute right-10 top-10 flex items-center gap-2 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            icon="folder"
            label="加入分组"
            active={picking}
            onClick={() => setPicking((value) => !value)}
          />
          <IconButton
            icon="trash"
            label="归档"
            danger
            onClick={() => setConfirming((value) => !value)}
          />
        </div>

        {showSeries ? (
          <p className="mb-3 truncate pr-40 text-micro font-medium tracking-[0.5px] text-muted">{series}</p>
        ) : null}
        <h3 className="truncate pr-30 text-title font-semibold text-ink">{title}</h3>

        {/* 说明：卡片不再是只有标题的空壳；没有就留一句引导，而不是留白 */}
        <p
          className={`mt-6 line-clamp-3 min-h-[3.6em] text-micro leading-[1.7] whitespace-pre-wrap ${
            library.description ? "text-steel" : "text-stone"
          }`}
        >
          {library.description || "还没有说明 —— 点进去补一句，让这个库更容易被检索与理解。"}
        </p>

        <div className="mt-auto">
          <Coverage library={library} />

          {/* 卡片底部只留「要不要进去」相关的两个事实：还差多少、最近动过。
              全部可检索时不重复写一遍——上面的 100% 与绿色进度条已经说过了 */}
          <div className="mt-10 flex flex-wrap items-center gap-x-10 gap-y-5 text-micro text-stone">
            {pending > 0 ? <span className="tabular-nums">{pending} 份待解析</span> : null}
            <span className={`tabular-nums ${pending > 0 ? "ml-auto" : ""}`}>
              {library.source_count ? `${relTime(library.updated_at)}更新` : "还没有资料"}
            </span>
          </div>

          {others.length ? (
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <span className="text-micro text-stone">也在</span>
              {others.map((group) => (
                <Chip key={group.id} tone={toneOf(group.hue)}>
                  {group.name}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>

        {confirming ? (
          <div
            onClick={(event) => event.stopPropagation()}
            className="mt-10 rounded-md border border-danger-soft bg-danger-soft px-10 py-9"
          >
            <p className="text-micro leading-[1.6] text-slate">
              归档「{library.name}」后，它的 {library.source_count} 份资料会退出检索，
              但不会被删除，可以恢复。
            </p>
            <div className="mt-8 flex gap-6">
              <Button size="sm" variant="danger" onClick={onArchive}>
                确认归档
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                取消
              </Button>
            </div>
          </div>
        ) : null}

        {picking ? (
          <div className="mt-8 flex flex-wrap gap-5 rounded-md bg-surface-soft p-8">
            {groups.length === 0 ? (
              <span className="text-micro text-stone">先建一个分组</span>
            ) : (
              groups.map((group) => {
                const inside = library.group_ids.includes(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    disabled={inside}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onAddToGroup(group.id);
                      setPicking(false);
                    }}
                    className={`font-app rounded-pill px-9 py-4 text-micro ${
                      inside ? "bg-tint-mint text-on-tint-mint" : "bg-canvas text-slate hover:bg-primary-soft"
                    }`}
                  >
                    {inside ? "已在 " : ""}
                    {group.name}
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </article>
    </Draggable>
  );
}

/* -------------------------------------------------------------- 书架 ---- */

function LibrarySpine({
  library,
  series,
  hue,
  dragging,
  onStart,
  onEnd,
  delay = 0,
}: {
  library: Library;
  series: string | null;
  /** 所属组色相；null = 未分组，走纸色。书架据此给书脊上色，和卡片色沿保持一致 */
  hue: string | null;
  dragging: boolean;
  onStart: (id: string) => void;
  onEnd: () => void;
  delay?: number;
}) {
  const label = shortName(library.name, series);
  /* 抽书：悬停把这本书抽出来一截，浮出封面再决定要不要读 */
  const [pulled, setPulled] = useState(false);
  const total = library.source_count;
  const indexed = library.indexed_count;
  const percent = total ? Math.min(100, Math.round((indexed / total) * 100)) : 0;
  const skin = spineSet(hue);
  /* 厚度 = 资料量（对数刻度）：书越厚资料越多，一眼能比规模。
     高度区间要撑得起一面墙，一排骨架书看着像没做完。 */
  const thickness = Math.round(
    Math.min(320, Math.max(200, 200 + Math.log10(Math.max(total, 1) + 1) * 52)),
  );

  return (
    <Draggable
      libraryId={library.id}
      dragging={dragging}
      onStart={onStart}
      onEnd={() => {
        setPulled(false);
        onEnd();
      }}
      className={`animate-rise ${pulled ? "z-20" : "z-0"}`}
    >
      <div
        className="relative"
        style={{ animationDelay: `${delay}ms` }}
        onMouseEnter={() => setPulled(true)}
        onMouseLeave={() => setPulled(false)}
      >
        <button
          type="button"
          onClick={() => navigate(Paths.kb(library.id))}
          title={`${library.name} · ${total} 份资料 · ${indexed} 可检索`}
          style={{ height: thickness }}
          className={`group relative flex w-54 cursor-grab flex-col items-center rounded-t-sm border border-b-0 border-hairline px-6 pb-8 pt-10 shadow-book transition-[transform,box-shadow,background-color] duration-160 active:cursor-grabbing ${skin.spine} ${
            pulled
              ? `-translate-y-6 shadow-card-hover ${skin.deep}`
              : `hover:-translate-y-3 hover:shadow-card-hover ${skin.deepHover}`
          }`}
        >
          {/* 竖排书名用衬线：书架上的书名是「印上去的」，不是界面标签。
              颜色取该族 deep 底上达标的那一档，不跟着中性文字色走 */}
          <span className={`spine-serif text-meta leading-[1.45] ${skin.text}`}>
            {label}
          </span>
          <span className="mt-auto flex w-full flex-col items-center gap-5 pt-8">
            <span className="text-micro tabular-nums text-stone">{total}</span>
            {/* 状态色带：这本书能不能检索，不用点开就知道 */}
            <span
              className={`h-6 w-full rounded-b-sm ${
                percent >= 100 ? "bg-tint-mint" : indexed > 0 ? "bg-primary-soft" : "bg-tint-gray"
              }`}
            />
          </span>
          {/* 露出的书页：让「抽出」有物理依据，不是一个凭空位移 */}
          <span
            aria-hidden
            className={`pointer-events-none absolute -bottom-8 left-3 right-3 h-8 rounded-b-sm transition-opacity duration-160 ${
              pulled ? "opacity-100" : "opacity-0"
            }`}
            style={{
              background:
                "repeating-linear-gradient(to right, var(--color-canvas) 0 2px, var(--color-hairline-soft) 2px 3px)",
            }}
          />
        </button>

        {pulled ? (
          <div className="book-cover animate-shelf-card pointer-events-none absolute bottom-full left-[-8px] mb-14 p-12">
            {series && label !== library.name ? (
              <p className="text-micro text-muted">{series}</p>
            ) : null}
            <p className="mt-3 text-title font-semibold leading-[1.35] text-ink">{library.name}</p>
            <p className="mt-8 flex items-baseline gap-6 text-micro text-stone">
              <span className="tabular-nums">{total} 份资料</span>
              <span className="tabular-nums">{indexed} 可检索</span>
              <span className="ml-auto tabular-nums">{percent}%</span>
            </p>
            <div className="mt-5 h-3 overflow-hidden rounded-pill bg-surface-sink">
              <span
                className={`block h-full rounded-pill ${percent >= 100 ? "bg-on-tint-mint" : "bg-primary"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-9 text-micro text-primary">点击进入</p>
          </div>
        ) : null}
      </div>
    </Draggable>
  );
}

/* -------------------------------------------------------------- 列表 ---- */

function LibraryRow({
  library,
  groups,
  series,
  showGroups,
  dragging,
  onStart,
  onEnd,
  onAddToGroup,
  onArchive,
}: {
  library: Library;
  groups: Group[];
  series: string | null;
  showGroups: boolean;
  dragging: boolean;
  onStart: (id: string) => void;
  onEnd: () => void;
  onAddToGroup: (groupId: string) => void;
  onArchive: () => void;
}) {
  const joined = groups.filter((group) => library.group_ids.includes(group.id));
  const percent = library.source_count
    ? Math.min(100, Math.round((library.indexed_count / library.source_count) * 100))
    : 0;
  const complete = library.source_count > 0 && library.indexed_count >= library.source_count;
  const title = shortName(library.name, series);
  const showSeries = Boolean(series) && title !== library.name;

  return (
    <tr
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", library.id);
        event.dataTransfer.effectAllowed = "copy";
        onStart(library.id);
      }}
      onDragEnd={onEnd}
      className={`border-b border-hairline-soft transition-colors last:border-0 hover:bg-surface-soft ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <td className="py-10 pl-12 pr-12">
        <button type="button" onClick={() => navigate(Paths.kb(library.id))} className="text-left">
          {showSeries ? (
            <span className="mb-1 block text-micro text-muted">{series}</span>
          ) : null}
          <span className="block text-body font-medium text-ink">{title}</span>
        </button>
      </td>
      <td className="py-10 pr-12 text-meta tabular-nums text-slate">{library.source_count}</td>
      <td className="w-[180px] py-10 pr-12">
        <div className="flex items-center gap-8">
          <span className={`w-32 text-right text-meta tabular-nums ${complete ? "text-on-tint-mint" : "text-slate"}`}>
            {library.indexed_count}
          </span>
          <span className="h-3 flex-1 overflow-hidden rounded-pill bg-surface-sink">
            <span
              className={`block h-full rounded-pill ${complete ? "bg-on-tint-mint" : "bg-primary"}`}
              style={{ width: `${percent}%` }}
            />
          </span>
        </div>
      </td>
      {showGroups ? (
        <td className="py-10 pr-12">
          <div className="flex flex-wrap gap-4">
            {joined.length === 0 ? (
              <span className="whitespace-nowrap text-micro text-stone">未分组</span>
            ) : (
              joined.map((group) => (
                <Chip key={group.id} tone={toneOf(group.hue)}>
                  {group.name}
                </Chip>
              ))
            )}
          </div>
        </td>
      ) : null}
      <td className="py-10 pr-12">
        <div className="flex items-center gap-4">
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) onAddToGroup(event.target.value);
            }}
            className="font-app h-24 rounded-xs border border-hairline bg-canvas px-6 text-micro text-slate"
          >
            <option value="">加入分组…</option>
            {groups
              .filter((group) => !library.group_ids.includes(group.id))
              .map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
          </select>
          <IconButton icon="trash" label="归档" danger onClick={onArchive} />
        </div>
      </td>
    </tr>
  );
}

/* --------------------------------------------------------------- 页面 ---- */

export function KnowledgeView() {
  const { libraries, groups, loading, reloadLibraries, reloadGroups, setError } = useWorkspace();
  const [creating, setCreating] = useState<"library" | "group" | null>(null);
  const [draft, setDraft] = useState("");
  /* 组管理：重命名 / 新建子分组 的内联表单，见 renderGroup */
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string; hue: string } | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [editingHue, setEditingHue] = useState("neutral");
  const [creatingSubOf, setCreatingSubOf] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState("");
  /** 删除分组需要二次确认：先点「删除」把它记下来，再点「确认删除」才真的删 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /* 组背景：后端早就有了（GET/PUT /groups/:id/background），之前前端完全没接，
     导致「组背景」这个已批准的产品能力一直不存在。内联编辑，与库背景同一套写法。 */
  const [bgGroupId, setBgGroupId] = useState<string | null>(null);
  const [bgDraft, setBgDraft] = useState("");
  const [bgSaved, setBgSaved] = useState<string>("");
  const [bgBusy, setBgBusy] = useState(false);
  const [view, setView] = useViewMode();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  /* 操作结果只用一条轻提示，不弹窗 */
  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 2600);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const tree = useMemo(() => {
    const tops = groups.filter((group) => !group.parent_id);
    const childrenOf = (id: string) => groups.filter((group) => group.parent_id === id);
    return { tops, childrenOf };
  }, [groups]);

  const needle = query.trim().toLowerCase();
  const matches = (library: Library) =>
    !needle ||
    library.name.toLowerCase().includes(needle) ||
    library.description.toLowerCase().includes(needle);

  const filtered = useMemo(
    () => sortLibraries(libraries.filter(matches), sort),
    [libraries, needle, sort],
  );
  const totalSources = useMemo(
    () => libraries.reduce((sum, library) => sum + library.source_count, 0),
    [libraries],
  );
  const totalIndexed = useMemo(
    () => libraries.reduce((sum, library) => sum + library.indexed_count, 0),
    [libraries],
  );
  const series = useMemo(() => seriesOf(libraries.map((library) => library.name)), [libraries]);

  const submit = async () => {
    const name = draft.trim();
    if (!name) return;
    try {
      if (creating === "library") await api.createLibrary(name);
      else await api.createGroup(name, null, ["sky", "mint", "lav", "peach", "rose"][groups.length % 5]);
      setDraft("");
      setCreating(null);
      await Promise.all([reloadLibraries(), reloadGroups()]);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const addToGroup = async (library: Library, group: Group) => {
    if (library.group_ids.includes(group.id)) return;
    try {
      await api.addMember(group.id, library.id);
      setHint(`已把「${library.name}」加入「${group.name}」`);
      await Promise.all([reloadGroups(), reloadLibraries()]);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  /* --------------------------- 组管理 --------------------------- */
  const saveGroup = async () => {
    const name = editingDraft.trim();
    if (!editingGroup || !name) return;
    try {
      await api.updateGroup(editingGroup.id, { name, hue: editingHue });
      setEditingGroup(null);
      setHint(`已重命名分组「${name}」`);
      await reloadGroups();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const beginEditGroup = (group: Group) => {
    setEditingGroup({ id: group.id, name: group.name, hue: group.hue });
    setEditingDraft(group.name);
    setEditingHue(group.hue === "neutral" ? "neutral" : group.hue);
    setConfirmDeleteId(null);
  };

  const saveSubGroup = async () => {
    const name = subDraft.trim();
    if (!creatingSubOf || !name) return;
    try {
      const color = GROUP_HUES[(creatingSubOf.length + Math.floor(Math.random() * 5)) % GROUP_HUES.length].value;
      await api.createGroup(name, creatingSubOf, color);
      setCreatingSubOf(null);
      setSubDraft("");
      setHint(`已建子分组「${name}」`);
      await reloadGroups();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const deleteGroup = async (group: Group) => {
    try {
      await api.deleteGroup(group.id);
      setConfirmDeleteId(null);
      setHint(`已删除分组「${group.name}」${group.library_ids.length ? `，${group.library_ids.length} 个库移回未分组` : ""}`);
      await reloadGroups();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const beginEditBackground = async (group: Group) => {
    setBgGroupId(group.id);
    setBgDraft("");
    setBgSaved("");
    try {
      const data = await api.groupBackground(group.id);
      setBgDraft(data.text);
      setBgSaved(data.text);
    } catch (cause) {
      setError(describeError(cause));
      setBgGroupId(null);
    }
  };

  const saveGroupBackground = async () => {
    if (!bgGroupId) return;
    setBgBusy(true);
    try {
      const data = await api.setGroupBackground(bgGroupId, bgDraft);
      setBgSaved(data.text);
      setBgGroupId(null);
      setHint(data.text.trim() ? "组背景已保存" : "组背景已清空");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBgBusy(false);
    }
  };

  const archive = async (library: Library) => {
    try {
      await api.archiveLibrary(library.id);
      await Promise.all([reloadLibraries(), reloadGroups()]);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  /* 拖到组 = 加关系；拖到未分组 = 移除全部关系。串行调用，避免后端写锁互相等待。 */
  const dropInto = async (libraryId: string, groupId: string | null) => {
    const library = libraries.find((item) => item.id === libraryId);
    if (!library) return;
    try {
      if (groupId === null) {
        if (library.group_ids.length === 0) return;
        for (const current of library.group_ids) await api.removeMember(current, libraryId);
        setHint(`「${library.name}」已移出 ${library.group_ids.length} 个组`);
      } else {
        if (library.group_ids.includes(groupId)) {
          setHint(`「${library.name}」已在这个组`);
          return;
        }
        await api.addMember(groupId, libraryId);
        const group = groups.find((item) => item.id === groupId);
        setHint(`已把「${library.name}」加入「${group?.name ?? "组"}」`);
      }
      await Promise.all([reloadGroups(), reloadLibraries()]);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const dragProps = {
    dragging: false,
    onStart: (id: string) => {
      setDragging(id);
      document.body.classList.add("is-grabbing");
    },
    onEnd: () => {
      setDragging(null);
      setOver(null);
      document.body.classList.remove("is-grabbing");
    },
  };

  const toggleGroup = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ---------------------------------------------------------- 呈现 ---- */

  const renderLibraries = (items: Library[], contextGroupId: string | null = null) => {
    if (!items.length) return null;
    /* 卡片顶部色沿取当前所在组的 hue；未分组/找不到组时由 LibraryCard 回退纸色 */
    const contextHue = contextGroupId ? groups.find((group) => group.id === contextGroupId)?.hue ?? null : null;
    /* 书脊色相：正在某个组的层板上就用那个组的颜色；
       未分组区或多组共用时，取它所属的第一个组——一个库同时属于多个组，
       书脊只能上一色，取第一个是稳定且可解释的规则（卡片上的「也在」补全其余） */
    const hueOf = (library: Library) => {
      const owner = contextGroupId ?? library.group_ids[0] ?? null;
      return owner ? groups.find((group) => group.id === owner)?.hue ?? null : null;
    };
    if (view === "shelf") {
      return (
        <div className="min-h-[360px]">
          <div className="shelf-board flex flex-wrap items-end gap-4 px-6">
            {items.map((library, index) => (
              <LibrarySpine
                key={library.id}
                library={library}
                series={series}
                hue={hueOf(library)}
                dragging={dragging === library.id}
                onStart={dragProps.onStart}
                onEnd={dragProps.onEnd}
                delay={Math.min(index * 35, 420)}
              />
            ))}
          </div>
          {/* 层板：厚、带落影，书是放在架子上的，不是浮在页面上的。
              颜色走 .shelf-plank 的令牌，深色模式下不再是一条发光白板 */}
          <div className="shelf-plank mx-2 mt-0" />
          <div className="mx-6 mt-6 flex items-center gap-12 text-micro text-stone">
            <span className="flex items-center gap-4">
              <span className="h-6 w-12 rounded-xs bg-tint-mint" /> 全部可检索
            </span>
            <span className="flex items-center gap-4">
              <span className="h-6 w-12 rounded-xs bg-primary-soft" /> 部分可检索
            </span>
            <span className="flex items-center gap-4">
              <span className="h-6 w-12 rounded-xs bg-tint-gray" /> 暂不可检索
            </span>
          </div>
        </div>
      );
    }
    if (view === "card") {
      return (
        <div className="grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((library, index) => (
            <LibraryCard
              key={library.id}
              delay={Math.min(index * 28, 336)}
              library={library}
              groups={groups}
              contextGroupId={contextGroupId}
              contextHue={contextHue}
              series={series}
              dragging={dragging === library.id}
              onStart={dragProps.onStart}
              onEnd={dragProps.onEnd}
              onAddToGroup={(groupId) => {
                const group = groups.find((item) => item.id === groupId);
                if (group) void addToGroup(library, group);
              }}
              onArchive={() => void archive(library)}
            />
          ))}
        </div>
      );
    }
    const showGroupsCol = groups.length > 0;
    return (
      <div className="overflow-hidden rounded-lg border border-hairline bg-canvas">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-hairline bg-surface-soft text-left">
              <th className="py-7 pl-12 pr-12 text-micro font-medium text-steel">资料库</th>
              <th className="py-7 pr-12 text-micro font-medium text-steel">资料</th>
              <th className="whitespace-nowrap py-7 pr-12 text-micro font-medium text-steel">可检索</th>
              {showGroupsCol ? (
                <th className="whitespace-nowrap py-7 pr-12 text-micro font-medium text-steel">所属组</th>
              ) : null}
              <th className="py-7 pr-12 text-micro font-medium text-steel">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((library) => (
              <LibraryRow
                key={library.id}
                library={library}
                groups={groups}
                series={series}
                showGroups={showGroupsCol}
                dragging={dragging === library.id}
                onStart={dragProps.onStart}
                onEnd={dragProps.onEnd}
                onAddToGroup={(groupId) => {
                  const group = groups.find((item) => item.id === groupId);
                  if (group) void addToGroup(library, group);
                }}
                onArchive={() => void archive(library)}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  /* 组容器同时是拖放目标：高亮表示「松手就加到这里」 */
  const renderGroup = (group: Group, depth: number): ReactNode => {
    const members = filtered.filter((library) => library.group_ids.includes(group.id));
    const children = tree.childrenOf(group.id);
    const visibleChildren = children.filter((child) => {
      const childMembers = filtered.filter((library) => library.group_ids.includes(child.id));
      return childMembers.length > 0 || tree.childrenOf(child.id).length > 0;
    });
    if (needle && members.length === 0 && visibleChildren.length === 0) return null;

    const expanded = !collapsed.has(group.id) || Boolean(needle);
    const active = over === group.id;
    const sources = members.reduce((sum, library) => sum + library.source_count, 0);

    return (
      <section
        key={group.id}
        className={depth ? "mt-14" : "mt-26"}
        onDragOver={(event) => {
          if (!dragging) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setOver(group.id);
        }}
        onDragLeave={() => setOver((value) => (value === group.id ? null : value))}
        onDrop={(event) => {
          event.preventDefault();
          const libraryId = event.dataTransfer.getData("text/plain") || dragging;
          setOver(null);
          if (libraryId) void dropInto(libraryId, group.id);
        }}
      >
        <div
          className={`mb-12 flex items-center gap-9 border-l-2 pl-12 transition-colors duration-120 ${
            borderOf(group.hue)
          } ${active ? "bg-primary-soft" : ""}`}
        >
          {editingGroup?.id === group.id ? (
            <div className="flex min-w-0 flex-1 items-center gap-9 py-4">
              <span className="rounded-sm border border-dashed border-hairline-strong bg-surface px-7 py-3 text-micro text-stone">
                正在重命名
              </span>
              <input
                autoFocus
                className={`${inputCls} h-26 w-[220px] text-meta`}
                value={editingDraft}
                placeholder="分组名称"
                onChange={(event) => setEditingDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveGroup();
                  if (event.key === "Escape") setEditingGroup(null);
                }}
              />
              <label className="flex items-center gap-4 text-micro text-stone">
                色
                <select
                  value={editingHue}
                  onChange={(event) => setEditingHue(event.target.value)}
                  className="font-app h-26 rounded-xs border border-hairline bg-canvas px-6 text-micro text-slate"
                >
                  {GROUP_HUES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="primary" onClick={() => void saveGroup()} disabled={!editingDraft.trim()}>
                保存
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingGroup(null)}>
                取消
              </Button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={expanded}
                className="flex min-w-0 items-center gap-6 py-4 text-left"
              >
                <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} />
                <span className={`size-6 shrink-0 rounded-full ${toneOf(group.hue)}`} />
                <h2 className={depth ? "truncate text-title font-semibold text-ink" : "truncate text-h3 font-semibold text-ink"}>
                  {group.name}
                </h2>
              </button>
              <span className="text-micro tabular-nums text-stone">
                {members.length} 个库 · {sources} 份资料
              </span>
              {/* 有背景就标一下：组背景会随运行冻结进证据包，写了要让用户看得见 */}
              {group.background?.trim() ? (
                <span
                  title={group.background}
                  className="inline-flex items-center gap-3 rounded-pill bg-surface px-7 py-2 text-micro text-steel"
                >
                  <Icon name="layers" size={10} /> 有背景
                </span>
              ) : null}
              {active ? <span className="ml-auto text-micro text-primary">松手加入这个组</span> : null}
              {!active ? (
                <span className="ml-auto">
                  <Menu
                    align="left"
                    width={170}
                    trigger={(open, toggle) => (
                      <button
                        type="button"
                        aria-label="组操作"
                        aria-expanded={open}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle();
                        }}
                        className={`grid size-24 place-items-center rounded-sm text-stone transition-colors hover:bg-surface hover:text-charcoal ${
                          open ? "bg-surface text-charcoal" : ""
                        }`}
                      >
                        <Icon name="dots" size={13} />
                      </button>
                    )}
                    items={[
                      { label: "重命名 / 换色", icon: "edit", onSelect: () => beginEditGroup(group) },
                      { label: "组背景", icon: "layers", onSelect: () => void beginEditBackground(group) },
                      { label: depth < 2 ? `新建子分组` : `建同层分组`, icon: "plus", onSelect: () => { setCreatingSubOf(depth < 2 ? group.id : null); setSubDraft(""); } },
                      { label: "删除分组", icon: "trash", danger: true, onSelect: () => setConfirmDeleteId(group.id) },
                    ]}
                  />
                </span>
              ) : null}
            </>
          )}
        </div>

        {editingGroup?.id === group.id ? null : confirmDeleteId === group.id ? (
          <div className="mb-12 ml-2 flex items-center gap-8 rounded-md border border-danger-soft bg-danger-soft px-12 py-8 text-micro">
            <span className="min-w-0 flex-1 text-slate">
              {group.library_ids.length ? `删除分组「${group.name}」，它下面的 ${group.library_ids.length} 个库会移回未分组，但资料不删除。` : `删除分组「${group.name}」？`}
            </span>
            <Button size="sm" variant="danger" onClick={() => void deleteGroup(group)}>
              确认删除
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>
              取消
            </Button>
          </div>
        ) : null}

        {/* 组背景：回答「为什么建这个组、收什么、打算怎么用」，运行时会随范围冻结进证据包 */}
        {bgGroupId === group.id ? (
          <div className="mb-12 ml-2 rounded-md border border-hairline bg-surface-soft p-12">
            <label className="mb-6 block text-micro font-semibold text-slate">
              组背景 <span className="font-normal text-stone">（可留空；运行时作为上下文冻结）</span>
            </label>
            <textarea
              autoFocus
              className={`${textareaCls} min-h-[110px]`}
              value={bgDraft}
              placeholder={`「${group.name}」收的是哪类资料？为什么放在一起？有哪些已知缺口？`}
              onChange={(event) => setBgDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setBgGroupId(null);
              }}
            />
            <div className="mt-8 flex items-center gap-8">
              <Button size="sm" variant="primary" onClick={() => void saveGroupBackground()} disabled={bgBusy}>
                {bgBusy ? "保存中…" : "保存背景"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBgGroupId(null)}>
                取消
              </Button>
              {bgSaved.trim() ? (
                <button
                  type="button"
                  onClick={() => setBgDraft("")}
                  className="font-app ml-auto rounded-sm px-8 py-4 text-micro text-stone hover:bg-danger-soft hover:text-red"
                >
                  清空
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {creatingSubOf === group.id ? (
          <div className="mb-12 flex items-center gap-8 rounded-md border border-hairline bg-surface-soft px-12 py-8">
            <span className="text-micro text-stone">子分组</span>
            <input
              autoFocus
              className={`${inputCls} h-28 w-[260px] text-meta`}
              value={subDraft}
              placeholder={`「${group.name}」下的子分组名称`}
              onChange={(event) => setSubDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveSubGroup();
                if (event.key === "Escape") setCreatingSubOf(null);
              }}
            />
            <Button size="sm" variant="primary" onClick={() => void saveSubGroup()} disabled={!subDraft.trim()}>
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreatingSubOf(null)}>
              取消
            </Button>
          </div>
        ) : null}

        {expanded ? (
          <>
            {members.length ? (
              renderLibraries(members, group.id)
            ) : (
              <p
                className={`rounded-md border border-dashed px-12 py-10 text-micro transition-colors ${
                  active ? "border-primary bg-primary-soft text-primary" : "border-hairline text-stone"
                }`}
              >
                这个组还没有资料库。把库拖到这里，或在库卡片上点「加入分组」。
              </p>
            )}
            {visibleChildren.map((child) => renderGroup(child, depth + 1))}
          </>
        ) : null}
      </section>
    );
  };

  const ungrouped = filtered.filter((library) => library.group_ids.length === 0);
  const ungroupedActive = over === "__ungrouped__";
  const noMatch = Boolean(needle) && filtered.length === 0;

  return (
    <div className="h-full overflow-auto pb-40">
      <ViewHeader
        title="资料库"
        description="组只是陈列，一个库可以同时属于多个组；拖拽即加入分组。"
        stats={`${libraries.length} 个库 · ${groups.length} 个组 · ${totalSources} 份资料 · ${totalIndexed} 可检索`}
        actions={
          <>
            <Segmented value={view} onChange={setView} options={VIEWS} />
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setCreating("library");
                setDraft("");
              }}
            >
              新建资料库
            </Button>
            <Button
              icon="plus"
              onClick={() => {
                setCreating("group");
                setDraft("");
              }}
            >
              新建分组
            </Button>
          </>
        }
      />

      <div className="mx-auto w-full max-w-[1180px] px-34">
        <div className="mt-18 flex flex-wrap items-center gap-8">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="筛选资料库（名称或说明）"
            className="w-[300px]"
          />
          <label className="flex items-center gap-6 text-micro text-stone">
            排序
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              className="font-app h-32 rounded-md border border-hairline bg-canvas px-8 text-meta text-slate outline-none focus:border-primary"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {needle ? (
            <span className="text-micro tabular-nums text-stone">
              {filtered.length} / {libraries.length} 个库
            </span>
          ) : null}
        </div>

        {hint ? (
          <div className="mt-12 rounded-md border border-hairline bg-surface-soft px-12 py-8 text-meta text-slate">
            {hint}
          </div>
        ) : null}

        {creating ? (
          <div className="mt-16 rounded-lg border border-hairline bg-surface-soft p-16">
            <Field label={creating === "library" ? "资料库名称" : "分组名称"}>
              <input
                autoFocus
                className={inputCls}
                value={draft}
                placeholder={creating === "library" ? "例如：农业项目" : "例如：科研项目"}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                  if (event.key === "Escape") setCreating(null);
                }}
              />
            </Field>
            <div className="mt-10 flex gap-8">
              <Button variant="primary" onClick={() => void submit()} disabled={!draft.trim()}>
                保存
              </Button>
              <Button variant="ghost" onClick={() => setCreating(null)}>
                取消
              </Button>
            </div>
          </div>
        ) : null}

        {loading && libraries.length === 0 ? (
          <div className="mt-24 grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((slot) => (
              <div key={slot} className="skeleton h-128" />
            ))}
          </div>
        ) : null}

        {libraries.length === 0 && !creating ? (
          <div className="mt-24">
            <EmptyState
              title="还没有资料库"
              description="先建一个库，再导入资料。文本类（md/txt/json/csv）会进全文索引，PDF 与音视频首期只登记。"
              action={
                <Button variant="primary" icon="plus" onClick={() => setCreating("library")}>
                  新建资料库
                </Button>
              }
            />
          </div>
        ) : null}

        {noMatch ? (
          <p className="mt-24 rounded-md border border-dashed border-hairline px-12 py-14 text-center text-meta text-stone">
            没有匹配「{query.trim()}」的资料库。
          </p>
        ) : null}

        {/* 没有组时不再摆「全部资料库」节标题：页头统计已经说了，重复一遍只是噪音 */}
        {!noMatch && groups.length === 0 && filtered.length ? (
          <div className="mt-24">{renderLibraries(filtered)}</div>
        ) : null}

        {groups.length > 0 ? tree.tops.map((group) => renderGroup(group, 0)) : null}

        {groups.length > 0 && (ungrouped.length || dragging) ? (
          <section
            className="mt-30"
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setOver("__ungrouped__");
            }}
            onDragLeave={() => setOver((value) => (value === "__ungrouped__" ? null : value))}
            onDrop={(event) => {
              event.preventDefault();
              const libraryId = event.dataTransfer.getData("text/plain") || dragging;
              setOver(null);
              if (libraryId) void dropInto(libraryId, null);
            }}
          >
            <div
              className={`mb-12 flex items-center gap-9 border-l-2 border-hairline-strong pl-12 transition-colors duration-120 ${
                ungroupedActive ? "bg-surface" : ""
              }`}
            >
              <Icon name="grid" size={15} />
              <h2 className="text-h3 font-semibold text-ink">未分组</h2>
              <span className="text-micro tabular-nums text-stone">{ungrouped.length} 个库</span>
              {ungroupedActive ? (
                <span className="ml-auto text-micro text-steel">松手移出全部分组</span>
              ) : null}
            </div>
            {ungrouped.length ? (
              renderLibraries(ungrouped)
            ) : (
              <p className="rounded-md border border-dashed border-hairline px-12 py-10 text-micro text-stone">
                拖到这里会移除该库的全部分组关系。
              </p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
