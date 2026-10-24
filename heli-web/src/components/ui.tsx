import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
/** 色调标签：只用于 Chip 一类小色块，色值来自 globals.css 的 tint 令牌 */
export type Tone = "mint" | "peach" | "lav" | "sky" | "rose" | "gray";

export const TONE_BG: Record<Tone, string> = {
  mint: "bg-tint-mint text-on-tint-mint",
  peach: "bg-tint-peach text-on-tint-peach",
  lav: "bg-tint-lavender text-on-tint-lavender",
  sky: "bg-tint-sky text-on-tint-sky",
  rose: "bg-tint-rose text-on-tint-rose",
  gray: "bg-tint-gray text-on-tint-gray",
};

/** 轻量态标签：用于状态、格式等弱强调信息 */
export function Chip({
  children,
  tone = "gray",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-4 rounded-xs px-7 py-2 text-micro font-medium whitespace-nowrap ${TONE_BG[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "outline" | "ghost" | "quiet" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-pressed border border-transparent",
  outline:
    "bg-canvas text-ink border border-hairline-strong hover:bg-surface",
  ghost:
    "bg-transparent text-slate border border-transparent hover:bg-surface",
  quiet:
    "bg-transparent text-slate border border-hairline hover:border-hairline-strong hover:text-charcoal",
  danger:
    "bg-red text-on-danger border border-transparent hover:brightness-95",
};

export function Button({
  variant = "outline",
  size = "md",
  icon,
  iconSize = 14,
  className = "",
  children,
  onClick,
  disabled,
  title,
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconSize?: number;
  className?: string;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  /* 触控高度：sm 28 / md 32 / lg 38。
     旧版 26/30 在触屏上偏小（iOS HIG 44、WCAG 2.2 AA 24 为下限，
     这里是桌面产品取折中），同时不把行高撑开太多。 */
  const sizeCls =
    size === "sm"
      ? "h-28 px-10 text-meta"
      : size === "lg"
        ? "h-38 w-full justify-center px-16 text-body"
        : "h-32 px-12 text-meta";

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`font-app inline-flex shrink-0 items-center gap-6 rounded-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,transform] duration-120 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${BUTTON[variant]} ${sizeCls} ${className}`}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------- ToolButton */

export function ToolButton({
  icon,
  label,
  active,
  onClick,
  title,
  iconSize = 15,
  className = "",
  disabled,
}: {
  icon: IconName;
  label?: string;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  iconSize?: number;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      className={`font-app inline-flex h-30 items-center gap-6 rounded-sm text-meta transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        label ? "px-10" : "w-30 justify-center"
      } ${
        active
          ? "bg-surface font-medium text-ink"
          : "text-slate hover:bg-surface"
      } ${className}`}
    >
      <Icon name={icon} size={iconSize} />
      {label}
    </button>
  );
}

/* ------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: IconName }[];
}) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  /* 滑块位移动画：实测选中按钮的 offsetLeft/width，120ms 滑过去 */
  useLayoutEffect(() => {
    const i = options.findIndex((o) => o.value === value);
    const el = btnRefs.current[i];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options]);

  return (
    <div className="relative flex gap-2 rounded-md border border-hairline bg-surface-soft p-2">
      {thumb ? (
        <span
          aria-hidden
          className="absolute top-2 bottom-2 rounded-xs bg-canvas shadow-card-hover transition-[left,width] duration-120"
          style={{
            left: thumb.left,
            width: thumb.width,
            transitionTimingFunction: "var(--ease-panel)",
          }}
        />
      ) : null}
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            btnRefs.current[i] = el;
          }}
          type="button"
          onClick={() => onChange(o.value)}
          className={`font-app relative z-10 inline-flex h-28 items-center gap-5 rounded-xs px-10 text-meta transition-colors ${
            value === o.value ? "font-medium text-ink" : "text-steel hover:text-charcoal"
          }`}
        >
          {o.icon ? <Icon name={o.icon} size={13} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- Divider */

export function VDivider() {
  return <span className="h-18 w-px shrink-0 bg-hairline" />;
}

/* ------------------------------------------------------------- Menu */

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * 统一的浮层菜单：列表项、卡片右上角、工具栏都用它，
 * 保证「点击外部关闭 / Esc 关闭 / 关闭后回焦」的行为一致。
 */
export function Menu({
  items,
  trigger,
  align = "right",
  width = 190,
  side = "up",
  header,
  footer,
}: {
  items: MenuItem[];
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
  /** 浮层相对触发器的展开方向：up 用于底部工具栏，down 用于页头 */
  side?: "up" | "down";
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((v) => !v))}
      {open ? (
        <div
          style={{ width }}
          className={`absolute z-[var(--z-menu)] rounded-card border border-hairline bg-canvas p-5 shadow-menu ${
            side === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
          } ${align === "right" ? "right-0" : "left-0"}`}
        >
          {header ? (
            <div className="px-9 pt-6 pb-7 text-micro font-semibold tracking-[0.4px] text-stone uppercase">
              {header}
            </div>
          ) : null}
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={`font-app flex w-full items-center gap-8 rounded-sm px-9 py-7 text-left text-meta transition-colors disabled:opacity-45 ${
                it.danger
                  ? "text-red hover:bg-danger-soft"
                  : "text-charcoal hover:bg-surface"
              }`}
            >
              {it.icon ? <Icon name={it.icon} size={14} strokeWidth={1.9} /> : null}
              {it.label}
            </button>
          ))}
          {footer ? (
            <div className="mt-3 border-t border-hairline px-9 pt-7 pb-4 text-micro text-stone">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- PanelRow */

export function PanelRow({
  icon,
  dot,
  title,
  meta,
  active,
  onClick,
  actions,
  titleClassName = "",
}: {
  icon?: IconName;
  dot?: string;
  title: string;
  meta?: string;
  active?: boolean;
  onClick?: () => void;
  actions?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <div
      className={`group flex w-full items-center gap-9 rounded-sm pr-4 transition-colors ${
        active ? "bg-surface-active" : "hover:bg-surface-hover"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`font-app flex min-w-0 flex-1 items-center gap-9 rounded-sm py-8 pl-8 text-left ${
          active ? "font-medium text-ink" : "text-slate"
        }`}
      >
        {dot ? (
          <span className="size-6 shrink-0 rounded-full" style={{ background: dot }} />
        ) : null}
        {icon ? <Icon name={icon} size={14} className="shrink-0" /> : null}
        <span className={`min-w-0 flex-1 truncate text-body ${titleClassName}`}>{title}</span>
        {meta ? (
          <span
            className={`shrink-0 pr-6 text-micro ${
              active ? "text-steel" : "text-stone"
            }`}
          >
            {meta}
          </span>
        ) : null}
      </button>
      {actions ? (
        <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </span>
      ) : null}
    </div>
  );
}

export function GroupLabel({
  children,
  className = "",
  aside,
}: {
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-8 px-8 pt-12 pb-6 text-micro font-semibold tracking-[0.6px] text-stone uppercase ${className}`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aside}
    </div>
  );
}

/* --------------------------------------------------------------- Search */

export function SearchField({
  value,
  onChange,
  onEnter,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label
      className={`flex min-h-34 items-center gap-8 rounded-md border border-hairline bg-canvas px-10 py-7 text-stone transition-colors focus-within:border-primary ${className}`}
    >
      <Icon name="search" size={14} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        placeholder={placeholder}
        className="font-app h-20 w-full min-w-0 border-0 bg-transparent text-body text-ink outline-none placeholder:text-stone"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          title="清空"
          aria-label="清空"
          className="grid size-24 shrink-0 place-items-center rounded-full text-stone transition-colors hover:bg-surface hover:text-charcoal"
        >
          <Icon name="close" size={11} strokeWidth={2.4} />
        </button>
      ) : null}
    </label>
  );
}

/* ------------------------------------------------------------ 表单字段 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-14 flex flex-col gap-6">
      <span className="flex items-center gap-6 text-meta font-semibold text-slate">
        {label}
        {hint ? <span className="font-normal text-stone">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "font-app rounded-md border border-hairline-strong bg-canvas px-11 py-9 text-body leading-[1.55] text-ink outline-none placeholder:text-stone focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)]";

export const textareaCls = `${inputCls} min-h-[72px] resize-y`;

/* ------------------------------------------------------------- 进度条 */

export function Progress({
  value,
  tone = "var(--primary)",
  height = 4,
}: {
  value: number;
  tone?: string;
  height?: number;
}) {
  return (
    <div
      className="w-full overflow-hidden rounded-pill bg-hairline"
      style={{ height }}
    >
      <i
        className="block h-full rounded-pill transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }}
      />
    </div>
  );
}

/* ---------------------------------------------------------- 空态与分区 */

export function EmptyState({
  icon = "library",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-10 rounded-lg border border-dashed border-hairline-strong bg-surface-soft px-24 py-44 text-center">
      <span className="grid size-38 place-items-center rounded-card bg-canvas text-stone">
        <Icon name={icon} size={19} />
      </span>
      <span className="text-body font-semibold text-ink">{title}</span>
      {description ? (
        <span className="max-w-[420px] text-meta leading-[1.6] text-steel">
          {description}
        </span>
      ) : null}
      {action}
    </div>
  );
}

/** 视图页头：标题 + 说明 + 操作区，各板块共用，保证节奏一致 */
export function ViewHeader({
  title,
  description,
  actions,
  stats,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  stats?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-34 pt-24">
      {breadcrumb}
      {/* 页标题用一点负字距：大字号下默认字距偏松，收一点才有「排过」的感觉。
          说明文字压在 62 字宽以内（中文约 31 字/行），再宽人眼回行会掉行。 */}
      <h1 className="text-h1 font-semibold tracking-[-0.9px] text-ink">{title}</h1>
      {description ? (
        <p className="mt-7 max-w-[62ch] text-body leading-[1.65] text-steel">
          {description}
        </p>
      ) : null}
      {stats || actions ? (
        <div className="mt-18 flex flex-wrap items-center gap-9">
          {actions}
          {stats ? <span className="text-meta tabular-nums text-stone">{stats}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- 命中高亮 */

/**
 * 检索片段高亮：后端 FTS5 的 snippet() 用 `<<` / `>>` 标出命中词，
 * 直接渲染会把尖括号当成正文显示出来（旧版就是这么漏的）。
 * 这里按标记切段，命中部分包成 <mark>，其余保持普通文本。
 */
export function Highlight({ text }: { text: string }) {
  const parts = text.split(/(<<.*?>>)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("<<") && part.endsWith(">>") ? (
          <mark
            key={index}
            className="rounded-xs bg-tint-yellow px-1 text-ink [box-decoration-break:clone]"
          >
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
