/* ==================================================================
   资料展示：把「文件名 + frontmatter」还原成人能读的东西
   ------------------------------------------------------------------
   这批资料的文件名形如 `2023_2025_62206154_韩宇星_基于…研究.md`，
   正文最前面还有一整段 YAML frontmatter（id / projectName / ratifyNo /
   projectAdmin / dependUnit …）。原样显示有两个后果：

   - 标题是一串编号，认不出是什么项目；
   - 正文第一屏全是 `id: 3f98131e…`，真正的内容要往下滚才看得见。

   所以：从文件名拆出「年份 / 编号 / 负责人 / 项目名」，
   frontmatter 转成一条可折叠的信息条，正文从实际内容开始。
   ================================================================== */

export interface ParsedName {
  /** 干净的项目名；拆不出来时回退原文件名（去扩展名） */
  title: string;
  years: string | null;
  grantNo: string | null;
  owner: string | null;
}

/**
 * 从文件名拆出元信息。命名规律来自实际数据：
 * `<起>_<止>_<批准号>_<负责人>_<项目名>.<ext>`，
 * 也见过少一段的（如 `2021_2024_32071464_汪海_基于…`）。
 * 拆不出来时一律回退，不改写、不猜。
 */
export function parseSourceName(path: string): ParsedName {
  const base = path.split("/").pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, "");
  const parts = stem.split("_").filter(Boolean);
  const fallback: ParsedName = { title: stem, years: null, grantNo: null, owner: null };

  /* 前两段是四位年份时，才按这套命名解释 */
  const isYear = (value: string) => /^(19|20)\d{2}$/.test(value);
  if (parts.length < 4 || !isYear(parts[0]) || !isYear(parts[1])) return fallback;

  const [start, end, ...rest] = parts;
  /* 批准号是 6 位以上数字（含 82174533、U21A20522 这类字母开头的编号） */
  const grantNo = rest[0] && /^[0-9A-Z]{6,}$/i.test(rest[0]) ? rest[0] : null;
  const tail = grantNo ? rest.slice(1) : rest;
  const owner = tail.length > 1 ? tail[0] : null;
  const title = (tail.length > 1 ? tail.slice(1) : tail).join("_");

  return {
    title: title || fallback.title,
    years: `${start}–${end}`,
    grantNo,
    owner,
  };
}

export interface Frontmatter {
  fields: { key: string; value: string }[];
  /** 去掉 frontmatter 之后的正文 */
  body: string;
}

/** frontmatter 里这些字段已经在标题条上显示过，信息条里不再重复 */
const REDUNDANT = new Set(["id", "projectName", "ratifyNo", "projectAdmin", "startYear", "endYear"]);

/**
 * 拆出正文开头的 YAML frontmatter。
 *
 * 只处理「`---` 开头、遇到下一个 `---` 结束、中间每行是 `key: value`」这一种，
 * 其它情况原样返回——不是解析器，不假装能处理任意 YAML（嵌套、列表都不管）。
 */
export function splitFrontmatter(text: string): Frontmatter {
  if (!text.startsWith("---\n")) return { fields: [], body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { fields: [], body: text };

  const raw = text.slice(4, end);
  const fields: { key: string; value: string }[] = [];
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!match) {
      /* 出现不像 key: value 的行（嵌套、列表）就整体放弃，
         宁可把 frontmatter 当正文显示，也不错误地吃掉内容 */
      return { fields: [], body: text };
    }
    const value = match[2].trim();
    if (value) fields.push({ key: match[1], value });
  }
  if (!fields.length) return { fields: [], body: text };
  return { fields, body: text.slice(end + 4).replace(/^\n+/, "") };
}

/** 字段名转成人话：这套 frontmatter 的 key 是拼音缩写，直接显示没法读 */
const LABELS: Record<string, string> = {
  projectName: "项目名称",
  ratifyNo: "批准号",
  projectType: "项目类型",
  code: "申请代码",
  projectAdmin: "负责人",
  projectAdminID: "负责人 ID",
  adminPosition: "职务",
  dependUnit: "依托单位",
  dependUintID: "单位 ID",
  researchTimeScope: "研究期限",
  startYear: "起始年",
  endYear: "结束年",
  supportNum: "资助金额（万元）",
  hasReport: "有结题报告",
  achievementCount: "成果数",
};

export function labelOf(key: string): string {
  return LABELS[key] ?? key;
}

/** 信息条里该显示的字段：去掉已在标题条出现过的与纯技术 ID */
export function visibleFields(fields: { key: string; value: string }[]) {
  return fields.filter((field) => !REDUNDANT.has(field.key) && !/ID$/.test(field.key));
}

/** 从 Markdown 正文里抽标题，给阅读区做大纲 */
export function outlineOf(body: string): { level: number; text: string; index: number }[] {
  const lines = body.split("\n");
  const items: { level: number; text: string; index: number }[] = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (!match) return;
    /* 只有一级标题且就是文档标题时，不必在纲里重复一次 */
    items.push({ level: match[1].length, text: match[2].trim(), index });
  });
  return items;
}
