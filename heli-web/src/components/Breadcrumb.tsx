/* 位置指示（审核第二批第 6 条）：资料库的四个页面共用同一份实现，
   「资料库 / <库名> / [处理记录 | 信息提取]」，
   最后一段是当前位置；给了 to 就仍然可点（例如库名回到文档列表）。 */

import { Link } from "../app/router";

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="位置" className="flex min-w-0 flex-wrap items-center gap-6 text-meta text-stone">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const className = `truncate ${last ? "max-w-[320px] text-ink" : "hover:text-primary"}`;
        return (
          <span key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-6">
            {item.to ? (
              <Link to={item.to} className={className}>
                {item.label}
              </Link>
            ) : (
              <span className={className}>{item.label}</span>
            )}
            {last ? null : <span className="text-stone">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
