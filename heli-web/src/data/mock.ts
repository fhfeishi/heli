import type {
  Artifact,
  ChatMessage,
  Citation,
  KnowledgeBase,
  KnowledgeDocument,
  ModelOption,
  PromptCard,
  ReportTemplate,
  SessionGroup,
  TaskTemplate,
} from "../types";

/* ==================================================================
   原型数据。真实环境下由 src/api 拉取，这里只保证界面自洽可跑。
   ================================================================== */

/** 知识库本地落盘结构：heli/.knowledge/<slug>/{source,parsed,vectordb,datadb/kb.db} */
function kbStorage(slug: string) {
  const root = `heli/.knowledge/${slug}`;
  return {
    root,
    source: `${root}/source`,
    parsed: `${root}/parsed`,
    vectordb: `${root}/vectordb`,
    db: `${root}/datadb/kb.db`,
  };
}

/* ------------------------------------------------------------ 文件池 */

const FILES: KnowledgeDocument[] = [
  {
    id: "d1",
    name: "固态电池产业研究 2024.pdf",
    format: "PDF",
    size: "18.4 MB",
    pages: "P.128",
    score: 0.91,
    updatedAt: "2024-11-08",
    origin: "file",
    status: "parsed",
    chunks: 412,
    source: "/data/research/solid-state-2024.pdf",
    path: "source/固态电池产业研究 2024.pdf",
    preview: [
      {
        heading: "第三章 · 硫化物电解质的工程化进展",
        paragraphs: [
          "截至 2023 年末，硫化物电解质的室温离子电导率已稳定在 10⁻² S/cm 量级，接近液态电解液水平。制约其放量的主要因素不再是电导率本身，而是空气稳定性与生产环境成本：每 GWh 产线需要额外投入约 1.2 亿元的干燥间与气氛控制设备。",
          "中试线数据显示，采用硫化物路线的软包电芯能量密度达到 420 Wh/kg，循环 1000 次后容量保持率 82%，已接近车规要求的下限。但良率仍是核心制约——2024 年上半年三条中试线的平均良率仅 61%，距离量产要求的 92% 仍有明显差距。",
        ],
      },
      {
        heading: "第四章 · 成本结构与产线兼容性",
        paragraphs: [
          "在完全新建产线的假设下，硫化物路线的单位产能投资约为传统液态锂电的 2.4 倍。若改为复用现有液态产线的涂布与封装工序，该倍数可降至 1.5 倍左右，这是决定放量节奏的首要变量。",
          "综合材料成本、设备折旧与良率损失，预计 2027 年前后硫化物电芯的度电成本可降至 0.62 元/Wh，仍高于同期液态锂电约 35%。",
        ],
      },
    ],
  },
  {
    id: "d2",
    name: "全球固态电池专利态势.pdf",
    format: "PDF",
    size: "9.1 MB",
    pages: "P.64",
    score: 0.88,
    updatedAt: "2024-10-22",
    origin: "file",
    status: "parsed",
    chunks: 236,
    source: "/data/research/patent-landscape-2024.pdf",
    path: "source/全球固态电池专利态势.pdf",
    preview: [
      {
        heading: "专利布局的时间线",
        paragraphs: [
          "2019–2021 年的专利申请集中在电解质材料组成本身；2022 年之后重心明显转向界面工程与制造工艺，界面阻抗与枝晶抑制方向的申请量在两年内增长了 3.1 倍。",
          "这表明行业共识已经从「能不能做出材料」转向「能不能稳定地做出来」——瓶颈发生了位移。",
        ],
      },
      {
        heading: "主要申请人分布",
        paragraphs: [
          "丰田、松下、三星 SDI 与宁德时代构成第一梯队，合计占硫化物路线有效专利的 47%。国内申请人在氧化物与卤化物路线上布局更密集。",
        ],
      },
    ],
  },
  {
    id: "d3",
    name: "硫化物电解质中试线纪要.docx",
    format: "DOCX",
    size: "1.2 MB",
    pages: "P.12",
    score: 0.83,
    updatedAt: "2024-11-15",
    origin: "file",
    status: "parsed",
    chunks: 48,
    source: "/data/internal/meeting-2024-11-12.docx",
    path: "source/硫化物电解质中试线纪要.docx",
    preview: [
      {
        heading: "2024-11-12 中试线例会纪要",
        paragraphs: [
          "本批次良率 63.4%，较上批次提升 2.1 个百分点，主要来自干燥间露点控制的收严。但极片边缘的微裂纹问题仍未解决，预计与辊压压力分布不均有关。",
          "建议下周对辊压工序做一次参数扫描，重点观察压力在 0.8–1.4 t/cm 区间内对界面阻抗的影响。",
        ],
      },
    ],
  },
  {
    id: "d4",
    name: "界面工程研究综述.pdf",
    format: "PDF",
    size: "22.7 MB",
    pages: "P.212",
    score: 0.79,
    updatedAt: "2024-09-30",
    origin: "file",
    status: "parsed",
    chunks: 690,
    source: "/data/papers/interface-review-2024.pdf",
    path: "source/界面工程研究综述.pdf",
    preview: [
      {
        heading: "Interface engineering for solid-state batteries: a review",
        paragraphs: [
          "固-固界面的接触损失是固态电池阻抗的主要来源。综述汇总了 2018 年以来 214 篇相关文献，将界面改性手段归纳为缓冲层、原位固化与梯度结构三类。",
          "其中原位固化在循环稳定性上表现最优，但工艺窗口窄、对温度控制要求高，目前仅有少数团队实现连续化制备。",
        ],
      },
    ],
  },
  {
    id: "d5",
    name: "2024 新能源材料白皮书.pdf",
    format: "PDF",
    size: "31.5 MB",
    pages: "P.96",
    score: 0.76,
    updatedAt: "2024-08-18",
    origin: "file",
    status: "parsed",
    chunks: 358,
    source: "/data/whitepaper/2024-new-materials.pdf",
    path: "source/2024 新能源材料白皮书.pdf",
    preview: [
      {
        heading: "第 2 章 · 技术路线横向对比",
        paragraphs: [
          "四条主流路线的成熟度排序为：氧化物（半固态已量产）> 硫化物（中试）> 聚合物（小批量）> 卤化物（实验室）。该排序在 2024 年内未发生变化。",
          "产线兼容性是决定放量节奏的首要变量。能够复用现有液态产线 60% 以上工序的方案，才有机会率先进入规模装车。",
        ],
      },
    ],
  },
  {
    id: "d6",
    name: "车企装车路线 · 网页快照 (2024-11)",
    format: "WEB",
    size: "0.4 MB",
    pages: "—",
    score: 0.71,
    updatedAt: "2024-11-20",
    origin: "web",
    status: "parsed",
    chunks: 26,
    source: "https://www.oem-roadmap.example/solid-state",
    path: "source/web/oem-roadmap-2024-11.html",
    preview: [
      {
        heading: "车企固态电池装车时间表（公开口径汇总）",
        paragraphs: [
          "丰田：2027–2028 年小批量装车，硫化物路线，初期用于高端车型。",
          "日产：2028 年量产，试点线已在横滨运行。",
          "国内某头部车企：2026 年半固态规模装车，全固态 2030 年之后。",
          "注：以上均为公开信息，实际节奏受良率与成本曲线影响，存在 1–2 年滑移可能。",
        ],
      },
    ],
  },
  {
    id: "d7",
    name: "中试线良率台账.xlsx",
    format: "XLSX",
    size: "2.6 MB",
    pages: "12 个 Sheet",
    score: 0.68,
    updatedAt: "2024-11-18",
    origin: "file",
    status: "parsed",
    chunks: 94,
    source: "/data/internal/yield-ledger.xlsx",
    path: "source/中试线良率台账.xlsx",
    preview: [
      {
        heading: "Sheet: 2024-Q3 批次良率",
        paragraphs: [
          "批次 B2314：投料 1,200 片，合格 742 片，良率 61.8%，主要失效模式为极片边缘微裂纹。",
          "批次 B2317：投料 1,180 片，合格 806 片，良率 68.3%，干燥间露点由 -35℃ 收严至 -45℃。",
        ],
      },
    ],
  },
  {
    id: "d8",
    name: "干燥间改造工程笔记.md",
    format: "MD",
    size: "86 KB",
    pages: "—",
    score: 0.62,
    updatedAt: "2024-10-05",
    origin: "file",
    status: "parsing",
    chunks: 0,
    source: "/data/internal/notes/dry-room.md",
    path: "source/干燥间改造工程笔记.md",
    preview: [
      {
        heading: "改造目标与约束",
        paragraphs: [
          "目标露点 -45℃，现有机组能力 -32℃，需要增加两级转轮除湿并改造送回风管路。",
          "预算约束：单条线改造费用控制在 1,800 万元以内，停产窗口不超过 12 天。",
        ],
      },
    ],
  },
  {
    id: "d9",
    name: "竞品发布会纪要 · 2024 秋.pdf",
    format: "PDF",
    size: "5.4 MB",
    pages: "P.28",
    score: 0.74,
    updatedAt: "2024-10-11",
    origin: "file",
    status: "failed",
    chunks: 0,
    source: "/data/competitors/launch-notes-2024-autumn.pdf",
    path: "source/竞品发布会纪要 · 2024 秋.pdf",
    preview: [
      {
        heading: "解析失败说明",
        paragraphs: [
          "该文件为扫描件，OCR 置信度低于 0.5，已挂起等待人工确认。可改用「图像增强 + 重解析」或上传文字版。",
        ],
      },
    ],
  },
];

const byIds = (...ids: string[]) => FILES.filter((f) => ids.includes(f.id));

/* -------------------------------------------------------- 知识库 */

export const KNOWLEDGE_BASES: KnowledgeBase[] = [
  {
    id: "kb-solid-state",
    name: "固态电池产业研究",
    description:
      "覆盖 2019–2024 年全球固态电池技术路线、中试数据与专利布局，含券商深度报告与产线纪要。",
    initial: "固",
    tint: "var(--tint-mint)",
    fg: "var(--on-tint-mint)",
    docs: 128,
    size: "4.2 GB",
    updatedAt: "2 天前",
    tags: [
      { label: "产业研究", tone: "mint" },
      { label: "新能源", tone: "peach" },
    ],
    readyPct: 96,
    slug: "solid-state",
    status: "parsing",
    storage: kbStorage("solid-state"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "语义切分 · 800 字 / 片段，重叠 15%",
    files: byIds("d1", "d2", "d3", "d7"),
    owner: "陈默",
    lastChatAt: "1 小时前",
    pinned: true,
  },
  {
    id: "kb-whitepaper",
    name: "2024 新能源材料白皮书",
    description:
      "权威年度白皮书全集，含技术路线对比表与成本模型，是跨知识库交叉验证的基准来源。",
    initial: "新",
    tint: "var(--tint-sky)",
    fg: "var(--on-tint-sky)",
    docs: 64,
    size: "2.8 GB",
    updatedAt: "5 天前",
    tags: [
      { label: "白皮书", tone: "sky" },
      { label: "基准源", tone: "lav" },
    ],
    readyPct: 100,
    slug: "whitepaper-2024",
    status: "ready",
    storage: kbStorage("whitepaper-2024"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "按标题层级切分",
    files: byIds("d5"),
    owner: "陈默",
    lastChatAt: "昨天",
  },
  {
    id: "kb-interface",
    name: "界面工程研究综述",
    description:
      "固态电解质界面阻抗、枝晶抑制方向的学术文献集合，用于支撑技术瓶颈判断。",
    initial: "界",
    tint: "var(--tint-lavender)",
    fg: "var(--on-tint-lavender)",
    docs: 312,
    size: "1.6 GB",
    updatedAt: "1 周前",
    tags: [
      { label: "学术文献", tone: "lav" },
      { label: "已向量化", tone: "mint" },
    ],
    readyPct: 100,
    slug: "interface-engineering",
    status: "ready",
    storage: kbStorage("interface-engineering"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "语义切分 · 800 字 / 片段",
    files: byIds("d4"),
    owner: "林越",
  },
  {
    id: "kb-oem",
    name: "车企固态装车路线图",
    description:
      "从公开网页、发布会纪要、财报电话会中抓取的车企时间表，每月自动增量更新。",
    initial: "车",
    tint: "var(--tint-peach)",
    fg: "var(--on-tint-peach)",
    docs: 486,
    size: "0.9 GB",
    updatedAt: "3 小时前",
    tags: [
      { label: "网页快照", tone: "peach" },
      { label: "自动更新", tone: "mint" },
    ],
    readyPct: 88,
    slug: "oem-roadmap",
    status: "parsing",
    storage: kbStorage("oem-roadmap"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "固定长度 · 512 tokens",
    files: byIds("d6", "d9"),
    owner: "陈默",
  },
  {
    id: "kb-rivals",
    name: "竞品情报 · 日韩厂商",
    description:
      "丰田、松下、三星 SDI 等厂商的公开专利、公告与产线公开信息汇总。",
    initial: "竞",
    tint: "var(--tint-rose)",
    fg: "var(--on-tint-rose)",
    docs: 207,
    size: "1.1 GB",
    updatedAt: "2 周前",
    tags: [{ label: "竞品", tone: "rose" }],
    readyPct: 100,
    slug: "rivals-jp-kr",
    status: "ready",
    storage: kbStorage("rivals-jp-kr"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "语义切分 · 800 字 / 片段",
    files: byIds("d9", "d2"),
    owner: "林越",
  },
  {
    id: "kb-internal",
    name: "研发内部实验记录",
    description:
      "内部中试线实验数据与失败归因记录，仅本团队可见，不参与外部检索。",
    initial: "研",
    tint: "var(--tint-yellow)",
    fg: "var(--on-tint-yellow)",
    docs: 89,
    size: "0.6 GB",
    updatedAt: "昨天",
    tags: [
      { label: "内部", tone: "gray" },
      { label: "受限", tone: "rose" },
    ],
    readyPct: 74,
    restricted: true,
    slug: "internal-lab",
    status: "error",
    storage: kbStorage("internal-lab"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "语义切分 · 800 字 / 片段",
    files: byIds("d8", "d7"),
    owner: "陈默",
  },
  {
    id: "kb-nsfc-ai-med",
    name: "自然科学基金-AI与医疗",
    description:
      "医学影像辅助诊断、临床 NLP 与蛋白质结构预测方向的基金申请书与结题报告合集。",
    initial: "医",
    tint: "var(--tint-mint)",
    fg: "var(--on-tint-mint)",
    docs: 96,
    size: "1.4 GB",
    updatedAt: "昨天",
    tags: [
      { label: "自然科学基金", tone: "mint" },
      { label: "AI+医疗", tone: "sky" },
    ],
    readyPct: 100,
    slug: "nsfc-ai-med",
    status: "ready",
    storage: kbStorage("nsfc-ai-med"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "语义切分 · 800 字 / 片段",
    files: byIds("d4", "d5"),
    owner: "林越",
  },
  {
    id: "kb-nsfc-ai-fin",
    name: "自然科学基金-AI与金融",
    description:
      "智能风控、量化因子挖掘与金融大模型方向的立项材料，持续解析中。",
    initial: "金",
    tint: "var(--tint-sky)",
    fg: "var(--on-tint-sky)",
    docs: 54,
    size: "0.8 GB",
    updatedAt: "3 小时前",
    tags: [
      { label: "自然科学基金", tone: "mint" },
      { label: "AI+金融", tone: "sky" },
    ],
    readyPct: 62,
    slug: "nsfc-ai-fin",
    status: "parsing",
    storage: kbStorage("nsfc-ai-fin"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "按标题层级切分",
    files: byIds("d7"),
    owner: "陈默",
  },
  {
    id: "kb-nsfc-materials",
    name: "自然科学基金-材料基因组",
    description:
      "高通量计算与材料逆向设计方向的文献与数据集说明，部分扫描件解析失败待处理。",
    initial: "材",
    tint: "var(--tint-peach)",
    fg: "var(--on-tint-peach)",
    docs: 73,
    size: "1.1 GB",
    updatedAt: "4 天前",
    tags: [
      { label: "自然科学基金", tone: "mint" },
      { label: "材料计算", tone: "peach" },
    ],
    readyPct: 38,
    slug: "nsfc-materials",
    status: "error",
    storage: kbStorage("nsfc-materials"),
    embeddingModel: "heli-embed-v3",
    chunkStrategy: "语义切分 · 800 字 / 片段",
    files: byIds("d8", "d9"),
    owner: "林越",
  },
];

/* ---------------------------------------------------- 报告模板库 */

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: "rt-text-1",
    type: "text",
    name: "标准调研简报",
    summary: "一页纸说清结论、依据与风险，适合快速同步。",
    outline: ["结论摘要", "关键依据（引注）", "风险与不确定性", "后续动作建议"],
    tint: "var(--tint-gray)",
    fg: "var(--on-tint-gray)",
    builtin: true,
    usage: 128,
  },
  {
    id: "rt-text-2",
    type: "text",
    name: "深度长文报告",
    summary: "分章节展开，含术语表与附录，适合存档与外发。",
    outline: ["摘要", "正文（3–6 章）", "术语表", "附录：数据来源"],
    tint: "var(--tint-gray)",
    fg: "var(--on-tint-gray)",
    builtin: true,
    usage: 64,
  },
  {
    id: "rt-rich-1",
    type: "rich",
    name: "图文编排 · 杂志版",
    summary: "大标题 + 配图 + 侧栏数据卡，适合汇报与分享。",
    outline: ["封面与主标题", "图文混排正文", "数据卡片 / 侧栏", "结语"],
    tint: "var(--tint-lavender)",
    fg: "var(--on-tint-lavender)",
    builtin: true,
    usage: 92,
  },
  {
    id: "rt-rich-2",
    type: "rich",
    name: "图文编排 · 演示版",
    summary: "按页组织，每页一个论点，可直接转演示。",
    outline: ["议题页", "论点页 ×N", "证据页", "结论页"],
    tint: "var(--tint-lavender)",
    fg: "var(--on-tint-lavender)",
    builtin: false,
    usage: 37,
  },
  {
    id: "rt-data-1",
    type: "data",
    name: "指标趋势分析",
    summary: "以指标口径与趋势为主，配数据表与变化归因。",
    outline: ["指标口径定义", "趋势与拐点", "归因分析", "数据表"],
    tint: "var(--tint-sky)",
    fg: "var(--on-tint-sky)",
    builtin: true,
    usage: 71,
  },
  {
    id: "rt-data-2",
    type: "data",
    name: "结构化数据台账",
    summary: "表格优先，字段固定，便于后续入库比对。",
    outline: ["字段说明", "主表", "异常值标注", "导出说明"],
    tint: "var(--tint-sky)",
    fg: "var(--on-tint-sky)",
    builtin: false,
    usage: 19,
  },
  {
    id: "rt-compare-1",
    type: "compare",
    name: "多方案对比矩阵",
    summary: "统一维度打分，输出对比矩阵与推荐结论。",
    outline: ["对比维度定义", "方案 × 维度矩阵", "加权得分", "推荐与理由"],
    tint: "var(--tint-peach)",
    fg: "var(--on-tint-peach)",
    builtin: true,
    usage: 103,
  },
  {
    id: "rt-compare-2",
    type: "compare",
    name: "竞品格局对照",
    summary: "按玩家 × 站位组织，输出格局判断。",
    outline: ["玩家清单", "技术 / 产品站位", "专利与产能", "格局判断"],
    tint: "var(--tint-peach)",
    fg: "var(--on-tint-peach)",
    builtin: true,
    usage: 58,
  },
  {
    id: "rt-kb-analysis-1",
    type: "kb-analysis",
    name: "知识库体检报告",
    summary: "评估库的覆盖度、时效与冲突，给出补库建议。",
    outline: ["语料构成", "覆盖度与缺口", "时效分布", "冲突口径清单", "补库建议"],
    tint: "var(--tint-mint)",
    fg: "var(--on-tint-mint)",
    builtin: true,
    usage: 44,
  },
  {
    id: "rt-kb-analysis-2",
    type: "kb-analysis",
    name: "跨库一致性核查",
    summary: "比较多个知识库对同一问题的口径差异。",
    outline: ["核查问题集", "各库口径对照", "差异归因", "采信建议"],
    tint: "var(--tint-mint)",
    fg: "var(--on-tint-mint)",
    builtin: false,
    usage: 26,
  },
  {
    id: "rt-kb-summary-1",
    type: "kb-summary",
    name: "知识汇总 · 要点提炼",
    summary: "把一个库压成一页要点，保留来源编号。",
    outline: ["主题聚类", "要点清单（含引注）", "待确认项", "延伸阅读"],
    tint: "var(--tint-rose)",
    fg: "var(--on-tint-rose)",
    builtin: true,
    usage: 87,
  },
  {
    id: "rt-kb-summary-2",
    type: "kb-summary",
    name: "知识汇总 · 时间线",
    summary: "按时间轴重排知识点，适合梳理演进过程。",
    outline: ["阶段划分", "时间线事件", "关键转折", "当前状态"],
    tint: "var(--tint-rose)",
    fg: "var(--on-tint-rose)",
    builtin: false,
    usage: 33,
  },
];

/* ------------------------------------------------------ 任务模板 */

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "t-status",
    title: "现状分析",
    description:
      "梳理某一领域近年来的技术发展情况、已取得的成果、带来的收益，以及对后续的影响。",
    background:
      "需要对一个技术领域做一次完整的现状盘点：它现在走到哪一步、拿到了什么结果、这些结果带来了哪些可量化的收益，以及会对后续产生什么影响。",
    details: [
      "按时间梳理技术发展的关键节点，标注每个节点解决了什么问题",
      "区分「已验证的成果」与「仍处于实验阶段的进展」",
      "收益必须量化：成本、性能、产能或市占，优先使用知识库中的数字",
      "每处结论都要给出来源编号；口径冲突时并列说明",
    ],
    output: {
      type: "data",
      templateId: "rt-data-1",
      hint: "知识库 + 联网 · 输出数据分析报告",
    },
    tint: "var(--tint-mint)",
    fg: "var(--on-tint-mint)",
    icon: "trend",
    prompt:
      "【现状分析】梳理固态电池近年来的技术发展脉络、已取得的成果、带来的收益，以及对后续产业的影响。请标注每处结论的来源。",
    suggestKbIds: ["kb-solid-state", "kb-whitepaper"],
    category: "产业研究",
    builtin: true,
    usage: 46,
  },
  {
    id: "t-history",
    title: "历史背景调查",
    description:
      "还原技术演进过程，划分阶段，说明每阶段要解决的核心问题，以及部分技术为何没落。",
    background:
      "在判断一项技术之前，需要先理解它是怎么走到今天的：出现过哪些路线、每个阶段的核心矛盾是什么、为什么有些路线被淘汰。",
    details: [
      "按「每个阶段要解决的核心问题」划分阶段，而不是简单按年份切",
      "对被淘汰的路线给出明确归因：技术瓶颈、成本、产业链或时机",
      "保留关键人物 / 机构 / 事件，作为后续检索的锚点",
    ],
    output: {
      type: "kb-summary",
      templateId: "rt-kb-summary-2",
      hint: "知识库为主 · 强时间线",
    },
    tint: "var(--tint-lavender)",
    fg: "var(--on-tint-lavender)",
    icon: "history",
    prompt:
      "【历史背景调查】梳理固态电池的技术演进过程，划分为若干阶段，说明每个阶段要解决的核心问题，并解释部分技术路线为何被淘汰。",
    suggestKbIds: ["kb-solid-state", "kb-interface"],
    category: "产业研究",
    builtin: true,
    usage: 28,
  },
  {
    id: "t-forecast",
    title: "未来趋势预测",
    description:
      "研判领域发展趋势与国内外现状对比，结合联网检索给出技术演变预测。",
    background:
      "需要在现状之外给出前瞻判断：未来 3–5 年技术会怎么演变、国内外处于什么位置、哪些信号值得跟踪。",
    details: [
      "必须先联网补充知识库截止时间之后的新增信息",
      "预测要给出置信度与触发条件，避免空泛判断",
      "给出国内外对比，说明差距在缩小还是扩大",
    ],
    output: {
      type: "rich",
      templateId: "rt-rich-1",
      hint: "必须联网 · 输出预测置信度",
    },
    tint: "var(--tint-sky)",
    fg: "var(--on-tint-sky)",
    icon: "forecast",
    prompt:
      "【未来趋势预测】结合知识库与联网检索，分析固态电池的发展趋势、国内外现状对比，并给出未来技术演变的预测与置信度。",
    suggestKbIds: ["kb-oem", "kb-whitepaper"],
    category: "趋势研判",
    builtin: true,
    usage: 35,
  },
  {
    id: "t-due",
    title: "技术尽调",
    description:
      "对主要技术路线从性能、成本、成熟度、专利布局四个维度做对比尽调。",
    background:
      "为一次投资或立项决策提供依据：把候选技术路线放在同一套维度下比较，明确各自的卡点与适用场景。",
    details: [
      "四个维度必须统一口径后再打分，避免各路线数据不可比",
      "每个维度给出数据来源与采集时间",
      "对得分接近的路线补充「什么条件下会反转」的判断",
    ],
    output: {
      type: "compare",
      templateId: "rt-compare-1",
      hint: "多知识库交叉 · 输出对比矩阵",
    },
    tint: "var(--tint-peach)",
    fg: "var(--on-tint-peach)",
    icon: "checklist",
    prompt:
      "【技术尽调】针对固态电池的四条主要技术路线，从性能、成本、成熟度、专利布局四个维度做尽调对比，输出结构化对比表。",
    suggestKbIds: ["kb-solid-state", "kb-whitepaper", "kb-rivals"],
    category: "尽调决策",
    builtin: true,
    usage: 22,
  },
  {
    id: "t-rivals",
    title: "竞品格局分析",
    description:
      "识别主要玩家、技术路线站位、专利与产能布局，输出竞争格局图。",
    background:
      "需要一张清晰的竞争格局图：谁在做什么、各自押注哪条路线、专利与产能落在哪、谁更有机会先跑出来。",
    details: [
      "玩家名单要覆盖国内外，至少给出第一梯队与第二梯队",
      "专利与产能尽量落到具体数字与时间",
      "输出可直接转演示的格局判断，不要只罗列事实",
    ],
    output: {
      type: "compare",
      templateId: "rt-compare-2",
      hint: "竞品知识库 · 输出格局图",
    },
    tint: "var(--tint-rose)",
    fg: "var(--on-tint-rose)",
    icon: "competitors",
    prompt:
      "【竞品格局分析】识别固态电池领域的主要玩家，梳理其技术路线站位、专利与产能布局，输出竞争格局分析。",
    suggestKbIds: ["kb-rivals", "kb-oem"],
    category: "竞品情报",
    builtin: true,
    usage: 18,
  },
  {
    id: "t-kb-review",
    title: "知识库体检",
    description:
      "评估一个知识库的覆盖度、时效与内部冲突，给出补库与重建建议。",
    background:
      "知识库会用旧。需要定期检查：哪些问题它答不了、哪些材料已经过期、哪些口径互相打架。",
    details: [
      "按主题聚类统计文档分布，标出稀疏区",
      "统计文档的更新时间分布，标出超过 18 个月的部分",
      "抽取同一事实的多种口径，列出冲突清单",
    ],
    output: {
      type: "kb-analysis",
      templateId: "rt-kb-analysis-1",
      hint: "单知识库 · 输出体检报告",
    },
    tint: "var(--tint-mint)",
    fg: "var(--on-tint-mint)",
    icon: "checklist",
    prompt:
      "【知识库体检】评估所选知识库的覆盖度、时效性与内部口径冲突，给出补库与重建建议。",
    suggestKbIds: ["kb-solid-state"],
    category: "知识治理",
    builtin: true,
    usage: 9,
  },
];

/* ---------------------------------------------------------- 成果 */

export const ARTIFACTS: Artifact[] = [
  {
    id: "a1",
    title: "固态电池技术演进与趋势分析报告",
    type: "data",
    status: "done",
    taskId: "t-status",
    taskTitle: "现状分析",
    kbIds: ["kb-solid-state", "kb-whitepaper"],
    citationCount: 32,
    sessionId: "s1",
    origin: "来自会话「固态电池技术演进与趋势分析」",
    meta: ["18 页", "6,240 字", "引注 32 处"],
    updatedAt: "2 小时前",
    blocks: [
      { kind: "h", text: "结论摘要" },
      {
        kind: "p",
        text: "过去五年固态电池的演进主线，是硫化物路线的工程化提速与氧化物半固态的过渡落地。能量密度从中试前的 300 Wh/kg 级推进到 420 Wh/kg，但良率仍是量产的最大约束。[[1]][[2]]",
      },
      { kind: "h", text: "关键指标趋势" },
      {
        kind: "table",
        columns: ["指标", "2020", "2024", "变化"],
        rows: [
          ["能量密度 (Wh/kg)", "300", "420", "+40%"],
          ["循环寿命 (次)", "180", "1000", "+456%"],
          ["中试良率", "32%", "61%", "+29pt"],
        ],
      },
      { kind: "h", text: "对后续的影响" },
      {
        kind: "p",
        text: "决定放量节奏的不再是材料性能，而是产线兼容性：能复用现有液态产线 60% 以上工序的方案会率先规模装车。[[3]]",
      },
    ],
    citations: [],
    metrics: {
      firstTokenMs: 1120,
      thinkingMs: 8384,
      totalMs: 10640,
      inputTokens: 1204,
      outputTokens: 638,
    },
  },
  {
    id: "a2",
    title: "钠离子电池产业化阶段复盘",
    type: "kb-summary",
    status: "done",
    taskId: "t-history",
    taskTitle: "历史背景调查",
    kbIds: ["kb-whitepaper"],
    citationCount: 47,
    origin: "历史背景调查任务 · 划分 4 个阶段",
    meta: ["24 页", "8,910 字", "引注 47 处"],
    updatedAt: "昨天",
    blocks: [
      { kind: "h", text: "阶段划分" },
      {
        kind: "list",
        items: [
          "第一阶段（2011–2015）：材料体系探索，核心问题是正负极材料的可逆容量。",
          "第二阶段（2016–2019）：工程放大，核心问题是电解液匹配与首效损失。",
          "第三阶段（2020–2022）：成本驱动，核心问题是锂价波动带来的替代窗口。",
          "第四阶段（2023–至今）：场景收敛，核心问题是在储能与两轮车找到稳定需求。",
        ],
      },
    ],
  },
  {
    id: "a3",
    title: "2025 固态电池装车时间表研判",
    type: "rich",
    status: "generating",
    progress: 62,
    taskId: "t-forecast",
    taskTitle: "未来趋势预测",
    kbIds: ["kb-oem", "kb-whitepaper"],
    citationCount: 21,
    origin: "趋势预测任务 · 含 12 条外部来源",
    meta: ["生成中 62%", "已引用 21 处"],
    updatedAt: "刚刚",
    blocks: [
      { kind: "p", text: "正在汇总国内外车企公开时间表，并与知识库中的产线节奏交叉验证……" },
    ],
  },
  {
    id: "a4",
    title: "日韩厂商硫化物专利布局尽调",
    type: "compare",
    status: "done",
    taskId: "t-due",
    taskTitle: "技术尽调",
    kbIds: ["kb-rivals"],
    citationCount: 63,
    origin: "技术尽调任务 · 对比 4 条技术路线",
    meta: ["31 页", "11,200 字", "附表 6"],
    updatedAt: "3 天前",
    blocks: [
      { kind: "h", text: "专利布局对比" },
      {
        kind: "table",
        columns: ["厂商", "主力路线", "有效专利", "第一发明人占比"],
        rows: [
          ["丰田", "硫化物", "1,823", "18%"],
          ["松下", "硫化物", "742", "11%"],
          ["三星 SDI", "硫化物", "966", "14%"],
        ],
      },
    ],
  },
  {
    id: "a5",
    title: "氧化物复合电解质路线评估",
    type: "text",
    status: "review",
    taskId: "t-due",
    taskTitle: "技术尽调",
    kbIds: ["kb-interface", "kb-whitepaper"],
    citationCount: 21,
    origin: "竞品格局分析任务 · 待人工复核",
    meta: ["15 页", "5,100 字", "引注 21 处"],
    updatedAt: "上周",
    blocks: [
      { kind: "p", text: "氧化物路线的半固态方案已量产，但界面接触损失仍依赖复合电解质缓解，需人工复核第 3 章的良率数据来源。" },
    ],
  },
  {
    id: "a6",
    title: "内部实验记录 · 干燥间改造草稿",
    type: "text",
    status: "draft",
    kbIds: ["kb-internal"],
    citationCount: 4,
    origin: "手动新建 · 尚未生成",
    meta: ["草稿", "3 个要点"],
    updatedAt: "2 天前",
    blocks: [
      { kind: "h", text: "待补充" },
      { kind: "p", text: "1) 改造预算与停产窗口；2) 露点目标与机组能力差距；3) 对良率的预期影响。" },
    ],
  },
];

/* ------------------------------------------------- 提示词 / Skill */

export const PROMPT_CARDS: PromptCard[] = [
  {
    id: "p1",
    kind: "prompt",
    title: "结论先行 · 三段式",
    summary: "先给结论，再给依据，最后给不确定项，避免铺垫式长文。",
    content:
      "回答请遵循：\n1. 结论：用 2-3 句话直接给出判断；\n2. 依据：逐条列出，每条标注来源编号；\n3. 不确定项：说明口径差异、数据缺口与建议核对方式。",
    tags: [{ label: "结构", tone: "lav" }],
    tint: "var(--tint-lavender)",
    fg: "var(--on-tint-lavender)",
    builtin: true,
    usage: 156,
    updatedAt: "3 天前",
  },
  {
    id: "p2",
    kind: "prompt",
    title: "口径校验 · 冲突消解",
    summary: "遇到多来源数字不一致时，强制并列并给出采信理由。",
    content:
      "当不同来源给出冲突数据时：\n1. 并列列出各来源的数值、时间与口径定义；\n2. 说明差异来源（统计范围 / 时间点 / 单位）；\n3. 给出本回答采用的口径与理由。",
    tags: [{ label: "严谨", tone: "mint" }],
    tint: "var(--tint-mint)",
    fg: "var(--on-tint-mint)",
    builtin: true,
    usage: 88,
    updatedAt: "1 周前",
  },
  {
    id: "p3",
    kind: "prompt",
    title: "量化优先",
    summary: "能用数字表达的不要用形容词，缺数据时明确标注缺失。",
    content:
      "所有关于性能、成本、规模的判断必须给出数字与单位；若知识库中确实没有，明确写「知识库中未提供该数据」，不要用模糊表述。",
    tags: [{ label: "量化", tone: "sky" }],
    tint: "var(--tint-sky)",
    fg: "var(--on-tint-sky)",
    builtin: true,
    usage: 61,
    updatedAt: "2 周前",
  },
  {
    id: "p4",
    kind: "prompt",
    title: "反方视角",
    summary: "主动给出与结论相反的解释，防止单边论证。",
    content:
      "在给出结论后，补充一节「反方视角」：列出 2-3 条支持相反结论的证据或合理怀疑，并说明为什么最终没有采纳。",
    tags: [{ label: "思辨", tone: "peach" }],
    tint: "var(--tint-peach)",
    fg: "var(--on-tint-peach)",
    builtin: false,
    usage: 34,
    updatedAt: "3 周前",
  },
  {
    id: "s1",
    kind: "skill",
    title: "多知识库交叉核查",
    summary: "同时在多个库检索同一问题，比对口径并输出差异清单。",
    content:
      "【Skill】多知识库交叉核查\n输入：一个待核查的问题 / 事实；\n输出：各库口径对照表 + 差异归因 + 采信建议。",
    tags: [{ label: "Skill", tone: "lav" }, { label: "检索", tone: "mint" }],
    tint: "var(--tint-lavender)",
    fg: "var(--on-tint-lavender)",
    builtin: true,
    usage: 73,
    updatedAt: "4 天前",
    steps: [
      "在所有已选知识库中并行检索同一问题",
      "按事实点归并结果，标出一致 / 冲突",
      "对冲突项回溯原文片段，判断统计口径",
      "输出采信建议与需要人工确认的项",
    ],
  },
  {
    id: "s2",
    kind: "skill",
    title: "联网增补 · 时效对齐",
    summary: "用联网检索补齐知识库截止时间之后的新信息。",
    content:
      "【Skill】联网增补\n输入：知识库中最新材料的截止时间；\n输出：该时间之后的增量事实清单 + 来源链接。",
    tags: [{ label: "Skill", tone: "sky" }, { label: "联网", tone: "sky" }],
    tint: "var(--tint-sky)",
    fg: "var(--on-tint-sky)",
    builtin: true,
    usage: 52,
    updatedAt: "6 天前",
    steps: [
      "确定知识库最新材料的时间点",
      "联网检索该时间点之后的关键进展",
      "过滤与主题无关的商业资讯",
      "以「增量事实 + 来源」形式回写",
    ],
  },
  {
    id: "s3",
    kind: "skill",
    title: "报告成稿 · Word 导出",
    summary: "把结论按指定模板编排为可导出的报告，保留引注编号。",
    content:
      "【Skill】报告成稿\n输入：结论要点 + 选定模板；\n输出：按模板纲要编排的报告，含引注与附录来源表。",
    tags: [{ label: "Skill", tone: "rose" }, { label: "产出", tone: "rose" }],
    tint: "var(--tint-rose)",
    fg: "var(--on-tint-rose)",
    builtin: true,
    usage: 97,
    updatedAt: "昨天",
    steps: [
      "确认目标模板的纲要结构",
      "把结论映射到各章节",
      "为每处事实补引注编号",
      "生成附录来源表并导出 Word / Markdown",
    ],
  },
  {
    id: "s4",
    kind: "skill",
    title: "失败归因 · 实验复盘",
    summary: "针对实验或产线异常，按人机料法环分层归因。",
    content:
      "【Skill】失败归因\n输入：异常现象描述；\n输出：分层归因树 + 下一步验证动作。",
    tags: [{ label: "Skill", tone: "gray" }, { label: "内部", tone: "gray" }],
    tint: "var(--tint-gray)",
    fg: "var(--on-tint-gray)",
    builtin: false,
    usage: 21,
    updatedAt: "1 个月前",
    steps: [
      "复现路径与现象量化",
      "按人 / 机 / 料 / 法 / 环分层列举候选原因",
      "用已有数据排除或保留候选",
      "给出成本最低的下一步验证动作",
    ],
  },
];

/* ------------------------------------------------------------ 模型 */

export const MODELS: ModelOption[] = [
  {
    id: "heli-reason",
    name: "heli-reason",
    vendor: "heli",
    context: "128k",
    good: "多步推理 · 长文档交叉",
    cost: 1,
  },
  {
    id: "heli-fast",
    name: "heli-fast",
    vendor: "heli",
    context: "64k",
    good: "要点提炼 · 快速问答",
    cost: 0.35,
  },
  {
    id: "heli-deep",
    name: "heli-deep",
    vendor: "heli",
    context: "256k",
    good: "超长知识库 · 报告成稿",
    cost: 2.4,
  },
  {
    id: "heli-vision",
    name: "heli-vision",
    vendor: "heli",
    context: "32k",
    good: "图表与版面理解",
    cost: 1.2,
  },
];

/* ------------------------------------------------------------ 会话 */

export const SESSION_GROUPS: SessionGroup[] = [
  {
    label: "置顶",
    items: [
      { id: "s1", title: "固态电池技术演进与趋势分析", updatedAt: "2 小时前", messageCount: 8, pinned: true, kbIds: ["kb-solid-state", "kb-whitepaper"] },
    ],
  },
  {
    label: "今天",
    items: [
      { id: "s2", title: "氧化物电解质界面阻抗综述", updatedAt: "5 小时前", messageCount: 4, kbIds: ["kb-interface"] },
      { id: "s3", title: "硫化物中试线良率归因", updatedAt: "6 小时前", messageCount: 12, kbIds: ["kb-internal"] },
    ],
  },
  {
    label: "昨天",
    items: [
      { id: "s4", title: "2025 装车时间表 · 快速研判", updatedAt: "昨天", messageCount: 6, kbIds: ["kb-oem"] },
      { id: "s5", title: "日韩厂商专利布局尽调", updatedAt: "昨天", messageCount: 15, kbIds: ["kb-rivals"] },
      { id: "s6", title: "半固态过渡方案的商业合理性", updatedAt: "昨天", messageCount: 9 },
    ],
  },
  {
    label: "更早",
    items: [
      { id: "s7", title: "钠离子电池产业化阶段复盘", updatedAt: "3 天前", messageCount: 11 },
      { id: "s8", title: "锂电回收技术现状梳理", updatedAt: "1 周前", messageCount: 7 },
      { id: "s9", title: "2024 材料白皮书要点提炼", updatedAt: "2 周前", messageCount: 5 },
      { id: "s10", title: "聚合物电解质为何没成为主流", updatedAt: "1 个月前", messageCount: 6 },
    ],
  },
];

/* ------------------------------------------------------------ 引用 */

export const CITATIONS: Citation[] = [
  {
    index: 1,
    docName: "固态电池产业研究 2024.pdf",
    page: "P.12",
    score: 0.91,
    kbId: "kb-solid-state",
    snippet:
      "硫化物电解质室温离子电导率已稳定在 10⁻² S/cm 量级，接近液态电解液水平，制约因素转向空气稳定性与产线环境成本。",
  },
  {
    index: 2,
    docName: "全球固态电池专利态势.pdf",
    page: "P.34",
    score: 0.88,
    kbId: "kb-solid-state",
    snippet:
      "中试线软包电芯能量密度达 420 Wh/kg，循环 1000 次后容量保持率 82%，已接近车规要求下限。",
  },
  {
    index: 3,
    docName: "2024 新能源材料白皮书.pdf",
    page: "P.7",
    score: 0.86,
    kbId: "kb-whitepaper",
    snippet:
      "产线兼容性是决定固态电池放量节奏的首要变量，能够复用现有液态产线 60% 以上工序的方案更具产业化优势。",
  },
  {
    index: 4,
    docName: "硫化物电解质中试线纪要.docx",
    page: "P.2",
    score: 0.83,
    kbId: "kb-solid-state",
    snippet:
      "每 GWh 产线需要额外投入约 1.2 亿元的干燥间与气氛控制设备，是硫化物路线规模化的主要成本项。",
  },
  {
    index: 5,
    docName: "界面工程研究综述.pdf",
    page: "P.19",
    score: 0.79,
    kbId: "kb-interface",
    snippet:
      "界面阻抗与枝晶抑制是过去两年专利布局最集中的方向，表明瓶颈已从材料可行性转向界面工程。",
  },
];

/* ------------------------------------------------- 首屏对话种子 */

export const SEED_THREAD: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    time: "21:02",
    text: "结合《固态电池产业研究》与《2024 新能源材料白皮书》两个知识库，分析固态电池近五年的技术发展情况、取得的成果、带来的收益，以及会对后续产生什么影响。",
  },
  {
    id: "m2",
    role: "assistant",
    time: "21:02",
    model: "heli-reason",
    taskId: "t-status",
    trace: {
      summary: "4 步 · 共 8.4s",
      steps: [
        {
          title: "解析任务意图，拆解为 3 个子问题",
          meta: "技术发展 · 成果与收益 · 后续影响",
          status: "done",
          durationMs: 1240,
        },
        {
          title: "检索《固态电池产业研究》· 命中 23 个相关片段",
          meta: "向量召回 top-40 → 重排保留 23 · 最高相关度 0.91",
          status: "done",
          durationMs: 3620,
        },
        {
          title: "检索《2024 新能源材料白皮书》· 命中 11 个相关片段",
          meta: "含 3 张技术路线对比表，已转入结构化抽取",
          status: "done",
          durationMs: 2080,
        },
        {
          title: "联网补充检索 · 已获取 12 条外部来源",
          meta: "用于校验知识库时间线 · 覆盖 2024-01 之后的新增进展",
          status: "done",
          durationMs: 1440,
        },
      ],
    },
    metrics: {
      firstTokenMs: 1120,
      thinkingMs: 8384,
      totalMs: 10640,
      inputTokens: 1204,
      outputTokens: 638,
    },
    blocks: [
      {
        kind: "p",
        text: "固态电池过去五年的演进，本质上是一场「用材料工程换能量密度上限」的竞赛：行业从液态锂电的渐进改良，转向对电解质体系的整体替换。知识库覆盖的 2019–2024 年间，主线是硫化物路线的工程化提速与氧化物路线的半固态过渡方案落地。[[1]][[4]]",
      },
      { kind: "h", text: "关键结论" },
      {
        kind: "list",
        items: [
          "能量密度已从实验室 300 Wh/kg 级推进到中试线 400–500 Wh/kg，循环寿命从不足 200 次提升至 1000 次以上，接近车规门槛。[[2]]",
          "真正的瓶颈已从「材料可行性」转移到界面阻抗与量产良率——这是过去两年新增专利最集中的方向。[[5]]",
          "半固态作为过渡路线在 2023 年后被大规模采用，使得全固态的商业化时间表被普遍后推 2–3 年。[[3]]",
        ],
      },
      { kind: "h", text: "四条技术路线的当前站位" },
      {
        kind: "table",
        columns: ["路线", "离子电导率", "成熟度", "卡点"],
        rows: [
          ["硫化物", "10⁻² S/cm 级", "中试", "空气稳定性差，需干燥间生产"],
          ["氧化物", "10⁻⁴ S/cm 级", "半固态量产", "脆性大，界面接触依赖复合方案"],
          ["聚合物", "10⁻⁵ S/cm 级", "小批量", "需加热运行，室温性能不足"],
          ["卤化物", "10⁻³ S/cm 级", "实验室", "成本高，规模化合成路径未定"],
        ],
      },
      { kind: "h", text: "对后续的影响" },
      {
        kind: "p",
        text: "未来 3 年内最值得关注的不是「谁先做出全固态」，而是产线兼容性：能够复用现有液态产线 60% 以上工序的方案，才有机会率先进入规模装车。这一点在知识库的两份材料中口径一致。[[3]][[2]]",
      },
      {
        kind: "report",
        fileName: "固态电池技术演进与趋势分析报告.docx",
        meta: ["18 页", "6,240 字", "引注 32 处", "2 张图表"],
      },
    ],
    citations: CITATIONS,
  },
];
