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
  { spine: string; deep: string; deepHover: string; text: string; accentBar: string }
> = {
  sky: {
    spine: "bg-domain-sky-spine", deep: "bg-domain-sky-deep",
    deepHover: "hover:bg-domain-sky-deep", text: "text-domain-sky-text",
    accentBar: "bg-domain-sky-accent",
  },
  mint: {
    spine: "bg-domain-mint-spine", deep: "bg-domain-mint-deep",
    deepHover: "hover:bg-domain-mint-deep", text: "text-domain-mint-text",
    accentBar: "bg-domain-mint-accent",
  },
  lav: {
    spine: "bg-domain-lavender-spine", deep: "bg-domain-lavender-deep",
    deepHover: "hover:bg-domain-lavender-deep", text: "text-domain-lavender-text",
    accentBar: "bg-domain-lavender-accent",
  },
  lavender: {
    spine: "bg-domain-lavender-spine", deep: "bg-domain-lavender-deep",
    deepHover: "hover:bg-domain-lavender-deep", text: "text-domain-lavender-text",
    accentBar: "bg-domain-lavender-accent",
  },
  peach: {
    spine: "bg-domain-peach-spine", deep: "bg-domain-peach-deep",
    deepHover: "hover:bg-domain-peach-deep", text: "text-domain-peach-text",
    accentBar: "bg-domain-peach-accent",
  },
  rose: {
    spine: "bg-domain-rose-spine", deep: "bg-domain-rose-deep",
    deepHover: "hover:bg-domain-rose-deep", text: "text-domain-rose-text",
    accentBar: "bg-domain-rose-accent",
  },
  neutral: {
    spine: "bg-domain-neutral-spine", deep: "bg-domain-neutral-deep",
    deepHover: "hover:bg-domain-neutral-deep", text: "text-domain-neutral-text",
    accentBar: "bg-domain-neutral-accent",
  },
  gray: {
    spine: "bg-domain-neutral-spine", deep: "bg-domain-neutral-deep",
    deepHover: "hover:bg-domain-neutral-deep", text: "text-domain-neutral-text",
    accentBar: "bg-domain-neutral-accent",
  },
};
const NEUTRAL_SPINE = HUE_SPINE.neutral;
const toneOf = (hue: string): ChipTone => HUE_TONE[hue] ?? "gray";
const borderOf = (hue: string): string => HUE_BORDER[hue] ?? HUE_BORDER.neutral;
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

/**
 * 档案卡的读数区。
 *
 * 不用「大数字 + 小灰字标签」那套默认做法：资料库的读数是拿来横向比较的，
 * 靠字号制造焦点只会让同排卡片各说各话。这里靠**对齐**产生秩序——
 * 等宽数字右对齐成列，刻度线长度直接编码覆盖率。
 */
function Coverage({ library }: { library: Library }) {
  const total = library.source_count;
  const indexed = library.indexed_count;
  const percent = total ? Math.min(100, Math.round((indexed / total) * 100)) : 0;
  const complete = total > 0 && indexed >= total;
  /* 刻度分 12 格：像档案卡背面的容量标记。
     20 格太碎，远看像条形码；12 格既能数又成段。
     不依赖 requestAnimationFrame：标签页在后台时 RAF 不跑，
     刻度会一直空着（headless 截图里就是这样）。颜色直接由数据决定，
     生长感交给 transition-colors。 */
  const TICKS = 12;
  const lit = Math.round((percent / 100) * TICKS);

  return (
    <div className="mt-13">
      <div className="flex items-end justify-between gap-10">
        {/* 读数右对齐成列：同排卡片的数字因此能上下对齐比较 */}
        <span className="flex items-baseline gap-5">
          <span
            className={`font-ledger text-h3 leading-none ${
              complete ? "text-on-tint-mint" : indexed > 0 ? "text-ink" : "text-steel"
            }`}
          >
            {indexed}
          </span>
          <span className="font-ledger text-micro leading-none text-stone">/ {total}</span>
        </span>
        <span className="font-ledger text-micro leading-none text-stone">{percent}%</span>
      </div>

      <div className="mt-9 flex gap-[3px]" aria-hidden>
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            className={`h-8 flex-1 rounded-[1px] transition-colors duration-300 ${
              i < lit ? (complete ? "bg-on-tint-mint" : "bg-primary") : "bg-surface-sink"
            }`}
            style={{ transitionDelay: `${i * 14}ms` }}
          />
        ))}
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
      className={`flex h-28 w-28 items-center justify-center rounded-sm border transition-colors duration-120 ${
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

/**
 * 说明的「形状」：去掉括号里的差异部分，用来识别「同一句模板换个词」。
 * 这批库的说明大多是「国家自然科学基金结题报告（AI 与 X 方向）：PDF 原文与 …」，
 * 逐字比对不算重复，但对读者来说完全一样，不该在每张卡上铺三行。
 */
function descriptionShape(text: string): string {
  return text.trim().replace(/（[^）]*）/g, "（…）");
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

/* -------------------------------------------------------------- 组折叠态 ---- */

/**
 * 组收起时的样子：成员库叠成一堆卡片。
 *
 * 「一堆卡片」不是装饰——它编码两件事：这个组里有几个库（层数），
 * 以及它们都属于同一个领域（共用一条色边）。展开后才是可操作的卡片网格。
 *
 * 层数上限 3：再多也数不出来，反而把堆叠区撑高。
 */
function GroupStack({
  libraries,
  hue,
  onOpen,
}: {
  libraries: Library[];
  hue: string;
  onOpen: () => void;
}) {
  const skin = spineSet(hue);
  const shown = libraries.slice(0, 3);
  const rest = libraries.length - shown.length;
  /* 每层只向下偏移、左右略微内收：这才是「一叠纸」的形状。
     向右下斜移看起来像散开的一摊，不像压在一起。 */
  const OFFSET = 11;
  const INSET = 6;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`展开 ${libraries.length} 个库`}
      className="group/stack block w-full max-w-[380px] text-left"
    >
      {/* 用绝对定位而不是负 margin：负 margin 会把后续元素往上拉，
          把组标题一起盖掉。这里只让卡片在自己的盒子里错位。 */}
      <div
        className="relative"
        style={{ height: 104 + OFFSET * (shown.length - 1) + 6 }}
      >
        {shown.map((library, index) => {
          /* 第一个库在最上层（z 最高），后面的依次压到右下 */
          const depth = shown.length - 1 - index;
          return (
            <div
              key={library.id}
              style={{ top: depth * OFFSET, left: depth * INSET, right: depth * INSET, zIndex: 10 - depth }}
              className={`absolute flex h-[104px] flex-col justify-between rounded-sm border border-hairline bg-canvas p-13 transition-transform duration-200 ${
                depth === 0
                  ? "shadow-[0_2px_12px_-6px_rgb(15_15_15/0.24)] group-hover/stack:-translate-y-1"
                  : "shadow-[0_1px_3px_-2px_rgb(15_15_15/0.14)]"
              }`}
            >
              <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${skin.accentBar}`} />
              <div className="min-w-0 pl-6">
                <p className="font-reading truncate text-body font-medium text-ink">
                  {shortName(library.name, null)}
                </p>
                <p className="font-ledger mt-4 text-micro text-stone">
                  {library.indexed_count} / {library.source_count}
                </p>
              </div>
              {depth === 0 ? (
                <span className="pl-6 text-micro text-steel">
                  点开看这 {libraries.length} 个库{rest > 0 ? `，另 ${rest} 个` : ""}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </button>
  );
}

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
  descriptionShared,
  ownerGroupOf,
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
  /** 这个库的说明与其他库重复：重复时不占卡片版面 */
  descriptionShared: boolean;
  /** 卡面色带里要写的组：在组内浏览时是当前组，未分组区是首个所属组 */
  ownerGroupOf: (library: Library) => Group | null;
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
  const skin = spineSet(coverHue);
  /* 色带里写组名：颜色需要图例，名字是现成的。
     在组内浏览时用当前组，未分组区用该库所属的第一个组。 */
  const ownerGroup = ownerGroupOf(library);
  /* 卡片先回答三个决策问题：哪个库、有多少可用资料、最近动过没 */
  const pending = Math.max(0, library.source_count - library.indexed_count);
  /* 说明是否与其他库重复：这批库的说明大多是同一句模板换了个方向，
     铺三行既占地方又无区分度。重复时不占版面，只在 tooltip 里保留。 */
  const descRepeated = Boolean(descriptionShared);

  return (
    <Draggable libraryId={library.id} dragging={dragging} onStart={onStart} onEnd={onEnd} className="h-full">
      {/* 总览只回答「选哪个库、规模多大、能不能检索」；说明与操作进详情页与 hover。
          整块可点：用 role+tabIndex 而不是裸 div onClick，键盘用户才能 Tab 到、回车进入。 */}
      <article
        role="link"
        tabIndex={0}
        onClick={() => navigate(Paths.kb(library.id))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          navigate(Paths.kb(library.id));
        }}
        title={library.description || undefined}
        style={{ animationDelay: `${delay}ms` }}
        onMouseMove={(mouseEvent) => {
          const box = mouseEvent.currentTarget.getBoundingClientRect();
          mouseEvent.currentTarget.style.setProperty("--mx", `${mouseEvent.clientX - box.left}px`);
          mouseEvent.currentTarget.style.setProperty("--my", `${mouseEvent.clientY - box.top}px`);
        }}
        className="group animate-rise spotlight relative flex h-full cursor-pointer flex-col overflow-hidden rounded-sm border border-hairline bg-canvas transition-[border-color,box-shadow] duration-160 hover:border-hairline-strong hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {/* 封面带：跨组浏览时用色相区分归属，组内浏览时它没有区分作用，
            只留一根 accent 细线做视觉锚点，不占高度。
            十一个同系列库的标题与读数几乎一样，色带是扫视时唯一能定位归属的线索。 */}
        {!contextGroupId && ownerGroup ? (
          <div aria-hidden className={`relative h-28 shrink-0 ${skin.spine}`}>
            <span className={`absolute inset-x-0 bottom-0 h-[2px] ${skin.accentBar}`} />
            <span className={`absolute left-16 top-1/2 -translate-y-1/2 truncate text-micro font-medium ${skin.text}`}>
              {ownerGroup.name}
            </span>
          </div>
        ) : (
          <span aria-hidden className={`block h-[3px] shrink-0 ${skin.accentBar}`} />
        )}

        {/* 卡片操作：桌面端悬停才露出（平时让位给内容）；
            触屏没有 hover 这回事，所以在不能悬停的设备上常驻显示，
            否则「加入分组 / 归档」在手机上永远点不到。 */}
        <div className="absolute right-8 top-[3px] flex items-center gap-2 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
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

        <div className="flex min-h-0 flex-1 flex-col p-16">
          {/* 系列名不再重复：色带里已经写了组名。
              只有未分组时才需要它做归属提示。 */}
          {showSeries && !ownerGroup ? (
            <p className="mb-3 truncate text-micro font-medium tracking-[0.5px] text-stone">{series}</p>
          ) : null}
          {/* 标题用衬线：资料库的名字是「印上去的」，不是界面标签。
              与无衬线的读数/元信息形成对比，一眼能分出主次。 */}
          <h3 className="font-reading text-h3 font-semibold leading-[1.3] text-ink">{title}</h3>

          {/* 说明只在它能区分这个库时才占版面。
              这批库的说明大多是同一句模板换了个方向，铺三行既占地方又无区分度。 */}
          {!descRepeated ? (
            <p className="mt-6 line-clamp-2 text-micro leading-[1.7] whitespace-pre-wrap text-steel">
              {library.description}
            </p>
          ) : null}

          {/* 读数与底栏贴底：说明长短不一时卡片仍对齐 */}
          <div className={descRepeated ? "mt-auto pt-12" : "mt-auto"}>
            <Coverage library={library} />

            {/* 卡片底部只留「要不要进去」相关的三个事实：还差多少、年份跨度、最近动过。
                全部可检索时不重复写一遍——上面的 100% 与绿色进度条已经说过了 */}
            {/* 底栏是档案卡的「卡片目录」：年份跨度与待解析数都是索引信息，
                用细线把它们和上面的读数分开，避免三段挤成一行。 */}
            <div className="mt-11 flex items-center justify-between gap-8 border-t border-hairline-soft pt-9 text-micro">
              <span className="flex items-center gap-6 text-stone">
                {library.year_span ? (
                  <span className="font-ledger shrink-0" title="资料文件名里的年份跨度">
                    {library.year_span}
                  </span>
                ) : null}
                {pending > 0 ? (
                  <span className="shrink-0 text-steel">{pending} 待解析</span>
                ) : null}
              </span>
              <span className="shrink-0 text-stone">
                {library.source_count ? relTime(library.updated_at) : "空库"}
              </span>
            </div>
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

          {/* 展开的面板都收在内容容器里：外层已经不再有 padding，
              放外面会贴到卡片边缘。 */}
          {confirming ? (
            <div
              onClick={(event) => event.stopPropagation()}
              className="mt-12 rounded-md border border-danger-soft bg-danger-soft px-10 py-9"
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
            <div className="mt-12 flex flex-wrap gap-5 rounded-md bg-surface-soft p-8">
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
        </div>
      </article>
    </Draggable>
  );
}

/* -------------------------------------------------------------- 书架 ---- */

function LibrarySpine({
  library,
  series,
  hue,
  ownerName,
  dragging,
  onStart,
  onEnd,
  delay = 0,
}: {
  library: Library;
  series: string | null;
  /** 所属组色相；null = 未分组，走纸色。书架据此给书脊上色，和卡片色沿保持一致 */
  hue: string | null;
  /** 封面顶带上的组名；未分组时为 null */
  ownerName: string | null;
  dragging: boolean;
  onStart: (id: string) => void;
  onEnd: () => void;
  delay?: number;
}) {
  const label = shortName(library.name, series);
  /* 封面标题用短名：顶带已经写了组名，再写「自然科学基金-AI与机器人自动化」
     是同一件事说两遍，书封上从不会这么印。 */
  const coverTitle = label;
  /* 抽书：悬停把这本书抽出来一截，浮出封面再决定要不要读 */
  const [pulled, setPulled] = useState(false);
  const total = library.source_count;
  const indexed = library.indexed_count;
  const percent = total ? Math.min(100, Math.round((indexed / total) * 100)) : 0;
  const skin = spineSet(hue);
  /* 高度 = 资料量（对数刻度）：书越高资料越多，一眼能比规模。
     区间收在 150–260：原来 200–320 让 510 份的书是 4 份的两倍多高，
     同一排里像两个物种。书架要有差异，但不能失去「一排书」的整体感。 */
  const thickness = Math.round(
    Math.min(260, Math.max(150, 150 + Math.log10(Math.max(total, 1) + 1) * 38)),
  );

  /* 书的厚度（书脊宽度）：抽出后它变成书的高度感的一部分。
     用资料量做对数映射——书越厚，内容越多。 */
  const DEPTH = 34;

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
      {/* 书架格：书在里面立着。书被抽出时，格子向右让出书的宽度，
          旁边的书跟着挪——真书架上抽走一本，邻居会倒过来。 */}
      <div
        className="relative transition-[margin] duration-320 ease-[cubic-bezier(0.22,1,0.32,1)]"
        style={{ animationDelay: `${delay}ms`, marginRight: pulled ? 210 : 0 }}
        onMouseEnter={() => setPulled(true)}
        onMouseLeave={() => setPulled(false)}
        onFocus={() => setPulled(true)}
        onBlur={() => setPulled(false)}
      >
        {/*
          真正的「书」：一个 3D 盒子，由书脊 + 封面 + 书页组成。
          - 静止：只看到书脊（封面绕 Y 轴转 90° 后与视线平行，看不见）
          - 抽出：整本书绕 Y 轴转 -90°，封面转到正面，书脊转到侧面

          用 CSS 3D 而不是弹面板：抽出来的应该是**这本书**，
          而不是旁边浮出一张写着这本书信息的卡。
        */}
        {/* 层板上的影子：书抬起时变大变淡，是「离开架面」的视觉证据 */}
        <span aria-hidden className={`book-shadow ${pulled ? "book-shadow-on" : ""}`} />

        <div
          className="relative"
          style={{ width: DEPTH, height: thickness, perspective: 1200 }}
        >
          <div
            className="relative h-full w-full transition-transform duration-380 ease-[cubic-bezier(0.22,1,0.32,1)]"
            style={{
              transformStyle: "preserve-3d",
              /* 抽出时：先离开架面（抬起 + 前移），同时转向读者。
                 三者合成一个 transform，浏览器插值时是同时进行的——
                 读起来就是「把书抽出来、顺手转过来看封面」。
                 transition-delay 让"抽出"先于"转向"：抬起走前 40%。 */
              /* 抬起 44px：书要离开层板，才像"拿起来"而不是"转过来"。
                 34px 时底边仍贴着层板，看起来只是转了向。 */
              /* rotateY 的轴默认在元素中心（书脊中线）。转向后书的中心不变，
                 所以不会往左跑——这一点很关键：轴若在左缘，书会甩到旁边去。 */
              transform: pulled
                ? `translate3d(0, -44px, 64px) rotateY(-90deg)`
                : "translate3d(0, 0, 0) rotateY(0deg)",
            }}
          >
            {/* 书脊：静止时朝向读者那一面 */}
            <button
              type="button"
              onClick={() => navigate(Paths.kb(library.id))}
              title={`${library.name} · ${total} 份资料 · ${indexed} 可检索`}
              className={`absolute inset-0 flex cursor-grab flex-col items-center rounded-t-sm border border-b-0 border-hairline px-4 pb-8 pt-10 active:cursor-grabbing ${skin.spine} ${
                pulled ? "shadow-none" : "shadow-book"
              }`}
              style={{ backfaceVisibility: "hidden" }}
            >
              <span className={`spine-serif text-meta leading-[1.45] ${skin.text}`}>
                {label}
              </span>
              <span className="mt-auto flex w-full flex-col items-center gap-5 pt-8">
                <span className="text-micro tabular-nums text-stone">{total}</span>
                <span className="flex w-full gap-[2px]" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`h-7 flex-1 rounded-[1px] ${
                        percent >= (i + 1) * 33
                          ? percent >= 100 ? "bg-on-tint-mint" : "bg-primary"
                          : "bg-canvas"
                      }`}
                    />
                  ))}
                </span>
              </span>
            </button>

            {/* 封面：平时绕 Y 轴转 90° 藏在侧面，抽出时转到正面。
                书的厚度方向朝 +Z，所以封面放在 +Z 侧的右半边。 */}
            <div
              className="absolute top-0 flex flex-col justify-between overflow-hidden rounded-r-sm border border-hairline bg-canvas"
              style={{
                /* 封面宽度 = 抽出来后读者看到的宽度 */
                width: 190,
                height: thickness,
                left: "100%",
                transform: "rotateY(90deg)",
                transformOrigin: "left center",
                backfaceVisibility: "hidden",
                boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.4)",
              }}
            >
              {/* 顶部色带：组/系列 */}
              <div className={`flex h-26 shrink-0 items-center px-13 ${skin.spine}`}>
                <span className={`truncate text-micro font-medium tracking-[0.06em] ${skin.text}`}>
                  {ownerName ?? "未分组"}
                </span>
              </div>
              <div className={`h-[2px] shrink-0 ${skin.accentBar}`} />

              <div className="flex min-h-0 flex-1 flex-col justify-between px-13 py-11">
                <p className="book-cover-line font-reading text-title font-semibold leading-[1.35] text-ink"
                   style={{ animationDelay: pulled ? "120ms" : "0ms" }}>
                  {coverTitle}
                </p>
                <div className="book-cover-line flex items-baseline gap-6 text-micro text-steel"
                     style={{ animationDelay: pulled ? "180ms" : "0ms" }}>
                  {library.year_span ? <span className="font-ledger shrink-0">{library.year_span}</span> : null}
                  <span className="ml-auto shrink-0 font-ledger">{total} 份</span>
                </div>
                <div className="book-cover-line" style={{ animationDelay: pulled ? "240ms" : "0ms" }}>
                  <div className="flex gap-[2px]" aria-hidden>
                    {Array.from({ length: 12 }, (_, i) => (
                      <span
                        key={i}
                        className={`h-6 flex-1 rounded-[1px] ${
                          i < Math.round((percent / 100) * 12)
                            ? percent >= 100 ? "bg-on-tint-mint" : "bg-primary"
                            : "bg-surface-sink"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-6 flex items-baseline justify-between text-micro text-stone">
                    <span className="font-ledger">{indexed} 可检索</span>
                    <span className="font-ledger">{percent}%</span>
                  </p>
                </div>
              </div>

              <div className="shrink-0 border-t border-hairline-soft px-13 py-8 text-micro text-primary">
                点击进入
              </div>
            </div>

            {/* 书页：书脊与封面之间的那一叠纸，从侧面能看到横纹 */}
            <div
              className="absolute top-0"
              style={{
                width: DEPTH,
                height: thickness,
                left: 0,
                transform: `rotateY(-90deg) translateX(-${DEPTH}px)`,
                transformOrigin: "right center",
                background:
                  "repeating-linear-gradient(to bottom, var(--color-canvas) 0 2px, var(--color-hairline-soft) 2px 3px)",
                backfaceVisibility: "hidden",
              }}
            />
          </div>
        </div>
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

  return (
    <tr
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", library.id);
        event.dataTransfer.effectAllowed = "copy";
        onStart(library.id);
      }}
      onDragEnd={onEnd}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-10 border-b border-hairline-soft px-12 py-10 transition-colors last:border-0 hover:bg-surface-soft md:table-row md:px-0 md:py-0 ${
        dragging ? "opacity-40" : ""
      }`}
    >
      {/* 窄屏：标题占满第一行，数字与操作并排第二行 */}
      <td className="col-span-2 min-w-0 md:table-cell md:w-auto md:py-10 md:pl-12 md:pr-12">
        <button type="button" onClick={() => navigate(Paths.kb(library.id))} className="min-w-0 text-left">
          {/* 标题用衬线，与卡片一致。系列名不在这里重复：
              组内浏览时组标题就在上方，跨组浏览时下面还有「所属组」列。 */}
          <span className="font-reading block truncate text-body font-medium text-ink">{title}</span>
        </button>
      </td>
      <td className="font-ledger text-right text-meta text-slate md:table-cell md:w-100 md:py-10 md:pr-20">
        <span className="font-app text-stone md:hidden">资料 </span>{library.source_count}
      </td>
      {/* 可检索数 + 进度条是一件事：窄屏把它们合成一格（数字在左、条在右），
          不再让数字和条分落两行。md 起恢复成独立列。 */}
      <td className="col-span-2 min-w-0 md:table-cell md:w-[180px] md:py-10 md:pr-12">
        {/* 与卡片同一套刻度语言：12 格、不靠平滑条 */}
        <div className="flex items-center gap-9">
          <span className={`font-ledger shrink-0 text-right text-meta md:w-32 ${complete ? "text-on-tint-mint" : "text-slate"}`}>
            <span className="font-app text-stone md:hidden">可检索 </span>{library.indexed_count}
          </span>
          <span className="flex flex-1 gap-[2px]" aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className={`h-6 flex-1 rounded-[1px] ${
                  i < Math.round((percent / 100) * 12)
                    ? complete ? "bg-on-tint-mint" : "bg-primary"
                    : "bg-surface-sink"
                }`}
              />
            ))}
          </span>
        </div>
      </td>
      {showGroups ? (
        <td className="col-span-2 min-w-0 md:table-cell md:w-auto md:py-10 md:pr-12">
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
      <td className="justify-self-end md:table-cell md:w-auto md:py-10 md:pr-12">
        <div className="flex items-center gap-4">
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) onAddToGroup(event.target.value);
            }}
            className="font-app h-28 min-w-0 max-w-full rounded-xs border border-hairline bg-canvas px-8 text-micro text-slate transition-colors hover:border-hairline-strong focus:border-primary"
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
    const descCount = new Map<string, number>();
    for (const item of libraries) {
      const key = descriptionShape(item.description);
      if (key) descCount.set(key, (descCount.get(key) ?? 0) + 1);
    }
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
          {/* 书架是「一面墙」：书从左往右排、底部对齐层板。
              窄屏下 gap 收小、书脊宽度由 .book 的 clamp 自己缩，
              不靠固定宽度硬撑，否则一屏只放得下三四本还溢出。 */}
          <div className="shelf-board flex flex-wrap items-end gap-x-3 gap-y-0 px-2 sm:gap-4 sm:px-6">
            {items.map((library, index) => (
              <LibrarySpine
                key={library.id}
                library={library}
                series={series}
                hue={hueOf(library)}
                ownerName={(() => {
                  const owner = contextGroupId ?? library.group_ids[0] ?? null;
                  return owner ? groups.find((group) => group.id === owner)?.name ?? null : null;
                })()}
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
              /* 入场只编排一次：首屏前几张做轻微错位，后续直接落位。
                 每张都演一遍位移+模糊，读起来像列表在“加载”，不是内容在“出现”。 */
              delay={index < 8 ? index * 18 : 0}
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
              descriptionShared={(descCount.get(descriptionShape(library.description)) ?? 0) > 1}
              ownerGroupOf={(item) => {
                const owner = contextGroupId ?? item.group_ids[0] ?? null;
                return owner ? groups.find((group) => group.id === owner) ?? null : null;
              }}
            />
          ))}
        </div>
      );
    }
    /* 「所属组」列只在跨组浏览时才有信息量：在组内浏览时每一行都是同一个组，
       这一列全是重复内容，白占宽度。 */
    const showGroupsCol = groups.length > 0 && !contextGroupId;
    return (
      /* 窄屏不出表格：五列在 390px 上会把表头挤成竖排单字、把操作列推出屏外。
         小屏改成一列一条的卡片式行（资料名 → 数字与所属组 → 操作），
         同一份 DOM 不再硬塞。md 起恢复表格，便于横向比较。 */
      <div className="rounded-sm border border-hairline bg-canvas md:overflow-hidden">
        <table className="block w-full border-collapse md:table">
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-hairline bg-surface-soft text-left">
              <th className="py-7 pl-12 pr-12 text-micro font-medium text-steel">资料库</th>
              <th className="py-7 pr-20 text-right text-micro font-medium text-steel md:w-100">资料</th>
              <th className="whitespace-nowrap py-7 pr-12 text-right text-micro font-medium text-steel">可检索</th>
              {showGroupsCol ? (
                <th className="whitespace-nowrap py-7 pr-12 text-micro font-medium text-steel">所属组</th>
              ) : null}
              <th className="py-7 pr-12 text-micro font-medium text-steel">操作</th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
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
          className={`mb-12 flex flex-wrap items-center gap-x-9 gap-y-5 border-l-2 pl-12 transition-colors duration-120 ${
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
                <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} className="shrink-0" />
                <span className={`size-6 shrink-0 rounded-full ${toneOf(group.hue)}`} />
                {/* 组名不截断：窄屏下把它压成「自然科…」就认不出是哪个组了，
                    宁可整行换行。 */}
                <h2 className={depth ? "text-title font-semibold text-ink" : "text-h3 font-semibold text-ink"}>
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

        {/* 收起时：成员库叠成一堆卡片。堆叠本身就是「这里有一组库」的信号，
            不用展开也知道有几个、属于哪个领域（共用色边）。 */}
        {!expanded && members.length ? (
          <div className="pb-4">
            <GroupStack
              libraries={members}
              hue={group.hue}
              onOpen={() => toggleGroup(group.id)}
            />
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
