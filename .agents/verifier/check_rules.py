"""文档驱动工程模板的规则与记录结构检查（只读，仅用标准库）。运行方式见 AGENTS.md；基线、例外和检查编号的对照见
.agents/DOCUMENTS.md。根目录取脚本所在位置的上两级。输出“错误 C<检查> 文件:行 说明”，有新增错误或基线需收缩时
退出码为 1；“警告”不影响退出码。只查结构，不查规则之间的逻辑一致性。"""
import datetime, os, re, subprocess, sys, unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
CHECKS = set(range(1, 10))
DOC = ".agents/DOCUMENTS.md"
LOGS = ".logsdev"
BASELINE = ".agents/verifier/check_rules.baseline"
DEFAULTS = {"query": ".logsdev/query.md", "PROJECTION": ".logsdev/PROJECTION.md",
            "INTERACTION": ".logsdev/INTERACTION.md", "DECISIONS": ".logsdev/DECISIONS.md"}
SECRET = re.compile(
    r"sk-(?:ant-)?[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}"
    r"|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}"
    r"|glpat-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----")
WD_NAME = re.compile(r"^.+-\d{8}(-\d{4})?$")
DEC_ID = r"D-\d{8}-[1-9]\d*"
WAIVER = re.compile(r"<!--\s*check-rules:\s*豁免\s+(C\d+)\s+至\s+(\d{4}-\d{2}-\d{2})\s+由 用户 批准：\s*\S[^>]*?-->\s*$")
CHAIN = r"(?:“[^”]+”(?:[和、与及或]|以及)?)+"
IMG = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"}
errors, warnings, CACHE, FIELDS, CUR = [], [], {}, [], [0]
TODAY = datetime.date.today()


def err(path, line, msg):
    errors.append((CUR[0], path, line, msg))


def rel(p):
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(p)


def git(*args, stdin=""):
    """在 ROOT 运行 git；不是仓库或没有 git 时返回 None。"""
    try:
        r = subprocess.run(["git", "-c", "core.quotePath=false", "-C", str(ROOT), *args], input=stdin,
                           capture_output=True, text=True, encoding="utf-8")
    except OSError:
        return None
    return r if r.returncode in (0, 1) else None


def read(r):
    if r not in CACHE:
        p, CACHE[r] = ROOT / r, None
        try:
            if p.is_file():
                CACHE[r] = p.read_text(encoding="utf-8-sig")
        except (UnicodeDecodeError, OSError) as e:
            errors.append((CUR[0], r, 1, f"无法读取：{type(e).__name__}"))
    return CACHE[r]


def lines(r):
    return enumerate((read(r) or "").splitlines(), 1)


def md(r):
    """返回 [(行号, 行, 是否在代码围栏内)]，围栏行本身算在围栏内。"""
    out, fence = [], False
    for no, ln in lines(r):
        tick = ln.lstrip().startswith("```")
        out.append((no, ln, fence or tick))
        fence ^= tick
    return out


def section(r, title):
    """返回 r 中 “## title” 一节的 (行号, 行)；不存在时返回 None。"""
    out, inside, found = [], False, False
    for no, ln, fenced in md(r):
        if ln.startswith("## ") and not fenced:
            inside = ln[3:].strip() == title
            found = found or inside
            continue
        if inside:
            out.append((no, ln))
    return out if found else None


def external(target):
    return re.match(r"[a-zA-Z][\w+.-]*://|//|[a-zA-Z]:[\\/]", target) is not None


def heads(r):
    return set(h.strip() for no, ln, f in md(r) if not f for h in re.findall(r"^#+\s+(.+?)\s*$", ln))


def anchors(r):
    return {re.sub(r"[^\w\- ]", "", h.lower()).replace(" ", "-") for h in heads(r)}


def mapping():
    carriers, designs, extra, seen = dict(DEFAULTS), [], {}, set()
    sec = section(DOC, "项目映射")
    if sec is None:
        err(DOC, 1, "缺少“## 项目映射”节")
    for no, ln in sec or []:
        s = ln.strip()
        if not s or s.startswith("<"):
            continue
        pairs = []
        if s.startswith("|"):
            cells = [c.strip().replace("`", "") for c in s.strip("|").split("|")]
            if all(re.fullmatch(r":?-{3,}:?", c) for c in cells) or cells[0] in ("载体", "名称"):
                continue
            if len(cells) == 2 and "→" not in cells[0]:
                pairs.append((cells[0], cells[1].lstrip("→ ").strip()))
                s = ""
            else:
                s = "；".join(cells)
        s = re.sub(r"^[-*]\s+", "", s).replace("`", "")
        for part in filter(None, (p.strip(" ，,。") for p in re.split(r"[；;]", s))):
            m = re.fullmatch(r"(.+?)\s*→\s*(\S+)", part)
            if not m:
                err(DOC, no, f"项目映射无法解析：“{part}”，应写成 `名称 → 路径`")
                continue
            pairs.append((m.group(1).strip(), m.group(2)))
        for name, target in pairs:
            key = re.sub(r"\s", "", unicodedata.normalize("NFKC", name))
            if key in seen:
                err(DOC, no, f"项目映射重复登记“{name}”（同一主题只登记一份）")
            seen.add(key)
            if name.startswith("设计载体"):
                stem = Path(target).parent.name if Path(target).name == "README.md" else Path(target).stem
                if not re.fullmatch(r"设计载体\([^)]+\)", key):
                    err(DOC, no, f"“{name}”应写成 `设计载体（主题）`")
                p, logs = (ROOT / target).resolve(), (ROOT / LOGS).resolve()
                if external(target) or "\\" in target or logs not in p.parents or logs / "archive" in [p, *p.parents]:
                    err(DOC, no, f"设计载体 {target} 须是 `.logsdev/` 下、archive 外的本地路径（用 `/` 分隔）")
                    continue
                designs.append((no, target))
                if not WD_NAME.match(stem):
                    err(DOC, no, f"设计载体 {target} 不符合工作文档命名 `<主题>-<YYYYMMDD>`")
            elif name in carriers or name == "删除记录":
                (carriers if name in carriers else extra)[name] = target
            else:
                err(DOC, no, f"项目映射登记了未知载体“{name}”")
            if not external(target) and "\\" in target:
                err(DOC, no, f"本地路径 {target} 用 `/` 分隔")
            elif not external(target) and not (ROOT / target).exists():
                err(DOC, no, f"项目映射登记的路径不存在：{target}")
    return carriers, designs, extra


def links(f):
    base = (ROOT / f).parent
    for no, ln, fenced in md(f):
        if fenced:
            continue
        for raw in re.findall(r"\]\((<[^>]+>|[^)\s]*)(?:\s+(?:\"[^\"]*\"|'[^']*'))?\)", ln):
            t, _, frag = raw.strip("<>").partition("#")
            if not external(t) and not t.startswith("mailto:") and (t or frag):
                yield no, t, (base / unquote(t)) if t else (ROOT / f), unquote(frag)


def conf(rec, label):
    """“词表与阈值”中 `- 标签：值` 的值；缺少时报错（检查不能空转）。"""
    m = re.search(rf"^- {label}：\s*(\S.*)$", rec, re.M)
    if not m:
        err(DOC, 1, f"“词表与阈值”缺少“{label}”一行")
    return m.group(1).strip() if m else ""


def real_date(d):
    try:
        return bool(datetime.datetime.strptime(d.replace("-", ""), "%Y%m%d"))
    except ValueError:
        return False


def main():
    for stream in (sys.stdout, sys.stderr):
        getattr(stream, "reconfigure", lambda **_: None)(encoding="utf-8", errors="replace")
    CUR[0] = 1
    for f in ["AGENTS.md", "CLAUDE.md", DOC]:
        if read(f) is None:
            err(f, 1, "必需文件缺失或无法读取")
    if read("AGENTS.md") is None or read(DOC) is None:
        return report()
    doc, agents = read(DOC), read("AGENTS.md")
    vocab, _ = statuses()
    CUR[0] = 5
    carriers, designs, extra = mapping()
    CUR[0] = 1
    local = {k: v for k, v in carriers.items() if not external(v)}
    for k, v in local.items():
        if read(v) is None:
            err(v, 1, f"必需文件缺失：{k} 的载体")
    for k, d in DEFAULTS.items():
        if carriers[k] != d and read(d) is not None:
            err(d, 1, f"{k} 已映射到 {carriers[k]}，默认文件仍在，删除以免平行副本")
    rules = [f for f in ["AGENTS.md", "CLAUDE.md", DOC] + sorted(rel(p) for p in (ROOT / ".agents/rules").glob("*.md"))
             if read(f) is not None]
    design_files = [t for t in (x.rstrip("/") + "/README.md" if (ROOT / x).is_dir() else x for _, x in designs)
                    if read(t) is not None]
    CUR[0] = 8
    wdocs, tasks = scan_logs(set(local.values()) | set(design_files) | set(DEFAULTS.values())
                             | {v for v in extra.values() if not external(v)})
    carrier_files = [v for v in local.values() if read(v) is not None] + design_files + tasks
    arch_readme = f"{LOGS}/archive/README.md"
    records = carrier_files + [arch_readme] * (read(arch_readme) is not None)
    files = rules + records + [w for w, _ in wdocs if read(w) is not None] \
        + [v for v in extra.values() if not external(v) and read(v) is not None]

    CUR[0] = 2
    claude = read("CLAUDE.md")
    if claude is not None and re.sub(r"<!--.*?-->", "", claude, flags=re.S).strip() != "@AGENTS.md":
        err("CLAUDE.md", 1, "除注释外只能有 `@AGENTS.md`，规则正文写在 AGENTS.md")
    m = re.match(r"\d+", conf(doc, "AGENTS 行数上限"))
    if m and len(agents.splitlines()) > int(m.group(0)):
        err("AGENTS.md", len(agents.splitlines()), f"超过 {m.group(0)} 行；把方法细则移到 .agents/")
    CUR[0] = 3
    dheads = heads(DOC)
    for f in files:
        for no, t, p, frag in links(f):
            if not p.exists():
                err(f, no, f"死链：{t}")
            elif frag and p.suffix == ".md" and frag.lower() not in anchors(rel(p)):
                err(f, no, f"锚点不存在：{t}#{frag}")
        for no, ln in lines(f):
            ln = re.sub(r"\]\([^)]*\)", "]", ln)
            refs = re.findall(rf"DOCUMENTS[^“\n]{{0,6}}({CHAIN})", ln) + [
                c for c in re.findall(rf"[见按](?:下文|上文|下方)?({CHAIN})", ln) if f == DOC]
            for chain in refs:
                for name in re.findall(r"“([^”]+)”", chain):
                    if name not in dheads | set(vocab):
                        err(f, no, f"引用的 DOCUMENTS 小节“{name}”不存在")
    CUR[0] = 4
    secrets(files)
    CUR[0] = 6
    for f in rules + records:
        for no, ln in lines(f):
            for q, bare in re.findall(r"(?:状态(?:为|改为|改回|写为?)|改回)(?:“([^”]+)”|([\u4e00-\u9fff]{2,3}))", ln):
                if vocab and q not in vocab and not (bare and any(bare.startswith(v) for v in vocab)):
                    err(f, no, f"状态“{q or bare}”不在词表中")
    CUR[0] = 7
    if "DECISIONS" in local and read(local["DECISIONS"]) is not None:
        decisions(local["DECISIONS"])
    CUR[0] = 8
    opaque = [k for k, v in carriers.items() if external(v)]
    linked, adir, inside = set(), (ROOT / LOGS / "archive").resolve(), {}
    top = git("rev-parse", "--show-toplevel")
    top = Path(top.stdout.strip()).resolve() if top and top.stdout.strip() else None
    for f in carrier_files:
        for no, t, p, _ in links(f):
            p = p.resolve()
            linked.add(p)
            if p == adir or adir in p.parents:
                err(f, no, f"权威载体引用了 archive 中的 {t}，截图和附件放在纳入版本控制的非 archive 路径")
            elif p.is_file() and top and top not in p.parents:
                err(f, no, f"权威载体引用了 git 仓库外的本地文件 {t}，未纳入版本控制")
            elif p.is_file():
                inside.setdefault(Path(os.path.relpath(p, ROOT)).as_posix(), (f, no, t))
    ign = git("check-ignore", "--stdin", stdin="\n".join(inside)) if top else None
    if ign is None:
        warnings.append(f"{ROOT.name} 不在 git 仓库中或没有 git，未检查权威载体引用的文件是否纳入版本控制")
    for r in ign.stdout.splitlines() if ign else []:
        if r in inside:
            err(inside[r][0], inside[r][1], f"权威载体引用的 {inside[r][2]} 被 .gitignore 忽略，未纳入版本控制")
    registered = {(ROOT / t).resolve() for t in design_files} | {(ROOT / t).resolve().parent
                                                                for t in design_files if t.endswith("README.md")}
    proj = local.get("PROJECTION")
    from_proj = {p.resolve() for _, _, p, _ in links(proj)} if proj and read(proj) is not None else set()
    for t, p in ((t, (ROOT / t).resolve()) for t in design_files):
        if "PROJECTION" not in local:
            warnings.append(f"{t} PROJECTION 在外部，无法确认设计载体是否被 PROJECTION 链接，人工核对")
        elif p not in from_proj and p.parent not in from_proj:
            err(t, 1, "设计载体须由 PROJECTION 链接")
        st = header(t)[0]
        if st is None or re.match(r"[^（(\s]*", st).group(0) != "现行":
            err(t, 1, "登记为设计载体，但开头没有 `状态：现行`")
    for w, name_src in wdocs:
        check_wdoc(w, name_src, vocab, linked, opaque)
    archive(arch_readme)
    CUR[0] = 9
    caps(doc, local)
    return report()


def statuses():
    """读“记录格式”代码块中除状态外的开头字段（存入 FIELDS）和状态表。"""
    CUR[0] = 8
    block = re.search(r"```\n(.*?)```", "\n".join(l for _, l in section(DOC, "记录格式") or []), re.S)
    if not block:
        err(DOC, 1, "“记录格式”缺少工作文档开头字段的代码块")
    FIELDS[:] = [n for n in re.findall(r"^\s*([^：\n]+)：", block.group(1), re.M) if n != "状态"] if block else []
    CUR[0] = 6
    sec = section(DOC, "状态表")
    if sec is None:
        err(DOC, 1, "缺少“## 状态表”")
        return [], {}
    rows = {}
    for no, ln in sec:
        s = ln.strip()
        if not s.startswith("|") or re.match(r"\|\s*-+", s) or "含义" in s:
            continue
        c = [x.strip() for x in s.strip("|").split("|")]
        if len(c) != 4:
            err(DOC, no, "状态表每行应为 状态｜含义｜处理时机｜可转到")
            continue
        rows[c[0]] = {"end": c[2], "to": c[3], "no": no}
    for name, r in rows.items():
        for t in re.split(r"[、，,]\s*", r["to"]):
            if t and t != "无" and t not in rows:
                err(DOC, r["no"], f"“{name}”可转到的“{t}”不在状态表中")
    return list(rows), rows


def caps(doc, local):
    """载体行数上限：超限即报错，说明该走 DOCUMENTS 的出口。"""
    raw = conf(doc, "载体行数上限")
    if not raw:
        return
    for part in raw.split("；"):
        m = re.match(r"\s*([A-Za-z]+)\s+(\d+)\s*$", part)
        if not m:
            err(DOC, 1, f"“载体行数上限”无法解析：{part}")
            continue
        name, limit = m.group(1), int(m.group(2))
        f = local.get(name)
        if f and read(f) is not None and len(read(f).splitlines()) > limit:
            err(f, limit + 1, f"{name} 超过载体上限 {limit} 行，按“载体上限与出口”归档或改写")


def scan_logs(carriers):
    """一次遍历 `.logsdev/`：返回工作文档 [(入口, 命名用名称)] 和任务记录；同时检查任务记录命名和散落附件。"""
    logs, out, tasks = ROOT / LOGS, [], []
    carriers = {(ROOT / c).resolve() for c in carriers}
    for p in sorted(logs.iterdir()) if logs.is_dir() else []:
        r = rel(p)
        if p.name.startswith(".") or p.name == "archive" or p.resolve() in carriers or "Zone.Identifier" in p.name:
            continue
        if p.is_dir():
            if (p / "README.md").resolve() not in carriers:
                out.append((f"{r}/README.md", p.name))
        elif p.name.startswith("task-"):
            tasks.append(r)
            if not re.fullmatch(r"task-.+-\d{8}\.md", p.name):
                err(r, 1, "任务记录应命名为 `task-<主题>-<YYYYMMDD>.md`")
        elif p.suffix == ".md":
            out.append((r, p.stem))
        else:
            err(r, 1, "`.logsdev/` 根目录不放散落附件，放进所属工作文档的同名目录")
    return out, tasks


def header(f):
    """读取开头（第一个 `##` 小节之前），检查通用字段；返回 (状态, 行号, 日期)。"""
    head = []
    for no, ln in lines(f):
        if ln.startswith("## "):
            break
        head.append((no, ln.lstrip("> ").strip()))
    for name in FIELDS:
        if not any(re.match(rf"{name}：\s*\S", h) for _, h in head):
            err(f, 1, f"开头缺少 `{name}：` 一行（见 DOCUMENTS 的“工作文档开头”）")
    st = next(((h[3:].strip(), no) for no, h in head if h.startswith("状态：")), (None, 1))
    return st[0], st[1], next((h[3:].strip() for _, h in head if h.startswith("日期：")), None)


def check_wdoc(w, name_src, vocab, linked, opaque):
    if read(w) is None:
        if not (ROOT / w).is_file():
            err(w, 1, "工作文档目录缺少入口 README.md")
        return
    named = re.search(r"-(\d{8})(?:-\d{4})?$", name_src)
    if not WD_NAME.match(name_src) or not real_date(named.group(1)):
        err(w, 1, f"工作文档“{name_src}”不符合命名 `<主题>-<YYYYMMDD>`（可加 `-HHMM`）或日期不是真实日期")
    st, no, date = header(w)
    if date and not (re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) and real_date(date)):
        err(w, 1, f"开头日期 {date} 不是真实日期（写成 YYYY-MM-DD）")
    elif date and named and date.replace("-", "") != named.group(1):
        err(w, 1, f"开头日期 {date} 与文件名日期不一致（都写创建日期）")
    word = re.match(r"[^（(\s]+", st or "")
    if not word:
        err(w, no, "开头缺少 `状态：<状态词>` 一行（见 DOCUMENTS 的“工作文档开头”）")
        return
    word = word.group(0)
    if not re.fullmatch(r"[^（(\s]+(（[^（）]*\S[^（）]*）|\([^()]*\S[^()]*\))?", st):
        err(w, no, "状态行应为 `状态：<状态词>` 或 `状态：<状态词>（说明）`，括号成对且说明非空")
    if vocab and word not in vocab:
        err(w, no, f"状态“{word}”不在词表中：{'、'.join(vocab)}")
        return
    if word == "已废" and not re.search(r"[（(]", st):
        err(w, no, "“已废”须在括号中写取代者或失效原因")
    target = (ROOT / w).resolve()
    scope = target.parent if target.name == "README.md" else target
    hit = any(x == scope or scope in x.parents for x in linked)
    if word == "已废" and not hit:
        if opaque:
            warnings.append(f"{w} 状态为已废；{'、'.join(opaque)} 在外部，无法确认是否被引用，人工核对")
        else:
            warnings.append(f"{w} 状态为已废且未被引用，可按 DOCUMENTS 的“工作文档”删除")


def decisions(f):
    entries, index, bodies, sec, cur = [], [], {}, None, None
    for no, ln, fenced in md(f):
        if ln.startswith("## ") and not fenced:
            h = ln[3:].strip()
            if h == "索引":
                if entries:
                    err(f, no, "“## 索引”应在所有条目之前")
                sec, cur = "idx", None
                continue
            sec = "entry"
            m = re.match(rf"({DEC_ID})\s+(\S.*)", h)
            if not m or not real_date(m.group(1)[2:10]):
                err(f, no, "条目标题应为 `## D-YYYYMMDD-n 标题`，日期为真实日期")
                cur = None
                continue
            cur = m.group(1)
            if cur in bodies:
                err(f, no, f"编号 {cur} 重复")
            entries.append((cur, m.group(2).strip(), no))
            bodies[cur] = ""
        elif sec == "entry" and cur:
            bodies[cur] += ln + "\n"
        elif sec == "idx":
            s = ln.strip()
            if not s or s.startswith("<"):
                continue
            m = re.fullmatch(rf"-\s+({DEC_ID})\s+([^｜|]+?)[｜|]([^｜|]+?)[｜|]\s*(.+?)", s)
            if not m:
                err(f, no, "索引行应为 `- D-YYYYMMDD-n 标题｜适用范围或关键词｜现行或被 D-… 取代`")
                continue
            index.append((m.group(1), m.group(2).strip(), m.group(4), no))
    if section(f, "索引") is None:
        err(f, 1, "缺少“## 索引”节")
    ids, titles = set(bodies), {e: t for e, t, _ in entries}
    for d in sorted({e[2:10] for e in ids}):
        ns = sorted(int(e[11:]) for e in ids if e[2:10] == d)
        if ns != list(range(1, len(ns) + 1)):
            err(f, 1, f"D-{d} 的当天序号应从 1 起连续，现有 {sorted(ns)}")
    if len(index) != len(entries):
        err(f, 1, f"索引 {len(index)} 行，条目 {len(entries)} 个，应一一对应")
    for e, _, no in entries:
        if e not in {i for i, _, _, _ in index}:
            err(f, no, f"条目 {e} 不在索引中")
    for i, title, state, no in index:
        if i not in ids:
            err(f, no, f"索引中的 {i} 没有对应条目")
            continue
        if titles.get(i) != title:
            err(f, no, f"索引标题“{title}”与条目“{titles.get(i)}”不一致")
        m = re.fullmatch(rf"被\s*({DEC_ID})\s*取代", state)
        tail = re.search(rf"被\s*({DEC_ID})\s*取代\W*$", bodies[i].strip())
        if state != "现行" and not m:
            err(f, no, "索引末栏只能是“现行”或“被 D-… 取代”")
        elif not m and tail:
            err(f, no, f"条目 {i} 正文写了被 {tail.group(1)} 取代，索引仍是“现行”")
        elif m and m.group(1) not in ids:
            err(f, no, f"取代者 {m.group(1)} 不存在")
        elif m and (m.group(1)[:10], int(m.group(1)[11:])) <= (i[:10], int(i[11:])):
            err(f, no, f"取代者 {m.group(1)} 须是编号更晚的条目")
        elif m and not (tail and tail.group(1) == m.group(1)):
            err(f, no, f"条目 {i} 正文末尾未注明“被 {m.group(1)} 取代”")


def archive(readme):
    adir = ROOT / LOGS / "archive"
    if not adir.is_dir():
        return
    if read(readme) is None:
        err(readme, 1, "archive 缺少 README.md 清单")
        return
    listed, sec = {}, section(readme, "清单")
    if sec is None:
        err(readme, 1, "缺少“## 清单”节")
    for no, ln in sec or []:
        s = ln.strip()
        if not s or s.startswith("<"):
            continue
        m = re.match(r"[-*]\s+`([^`]+)`\s*[—–-]+\s*(.*)$", s)
        if not m:
            err(readme, no, "清单行应为 `- `名称` — 来源：…；删除条件：…`")
            continue
        if not re.search(r"来源：\s*[^；;\s]", m.group(2)):
            err(readme, no, f"{m.group(1)} 缺少来源")
        cond = re.search(r"删除条件：\s*(.+)", m.group(2))
        if not cond or cond.group(1).strip(" 。.；;") in ("", "-"):
            err(readme, no, f"{m.group(1)} 缺少删除条件（日期、事件或“无”）")
        if m.group(1).rstrip("/") in listed:
            err(readme, no, f"{m.group(1)} 在清单中重复登记")
        listed[m.group(1).rstrip("/")] = no
    names = {c.name for c in adir.iterdir() if c.name != "README.md" and not c.name.startswith(".")}
    for n in sorted(names - set(listed)):
        err(readme, 1, f"archive 中的 {n} 未在清单登记删除条件")
    for n in sorted(set(listed) - names):
        err(readme, listed[n], f"清单中的 {n} 已不存在，删除该行")


def secrets(files):
    """密钥模式只含 ASCII，按 latin-1 读字节，任何兼容 ASCII 的编码（含 GBK）都能查到。"""
    logs = ROOT / LOGS
    for p in sorted({(ROOT / f).resolve() for f in files} | (set(logs.rglob("*")) if logs.is_dir() else set())):
        if p.is_file() and p.suffix.lower() not in IMG:
            try:
                text = p.read_bytes().decode("latin-1")
            except OSError as e:
                err(rel(p), 1, f"无法读取，未检查密钥：{type(e).__name__}")
                continue
            for no, ln in enumerate(text.split("\n"), 1):
                if SECRET.search(ln):
                    err(rel(p), no, "疑似密钥：任何地方都不泄露密钥")


def waived(e):
    cid, path, no, _ = e
    m = WAIVER.search(next((l for n, l in lines(path) if n == no), ""))
    try:
        return bool(m) and m.group(1) == f"C{cid}" and datetime.date.fromisoformat(m.group(2)) >= TODAY
    except ValueError:
        return False


def committed():
    """最近一次提交中的基线（该提交删除了基线时取其父提交）；没有历史时返回 None。"""
    h = git("log", "-1", "--format=%H", "--", BASELINE)
    c = h.stdout.strip() if h else ""
    r = c and (git("show", f"{c}:./{BASELINE}") or git("show", f"{c}^:./{BASELINE}"))
    return Counter(l.strip() for l in r.stdout.splitlines() if l.strip()) if r else None


def report():
    exists, rebuild = (ROOT / BASELINE).is_file(), "--rebuild" in sys.argv
    if exists and read(BASELINE) is None:
        print(f"错误 {BASELINE} 无法读取，未比对也不写入：从最近的提交恢复后再运行")
        return 1
    live = [e for e in errors if not waived(e)]
    base, comm = Counter(l.strip() for l in (read(BASELINE) or "").splitlines() if l.strip()), committed()
    grown = sum((base - comm).values()) if exists and comm is not None and not rebuild else 0
    base = base & comm if grown else base
    left, fresh, now = Counter(base), [], Counter()
    for e in live:
        k = f"C{e[0]} {e[1]} {re.sub(r':[0-9]+', '', e[3])}"
        now[k] += 1
        if left[k] > 0:
            left[k] -= 1
        else:
            fresh.append(e)
    stale = sum(left.values())
    if "--write-baseline" in sys.argv and not exists and not rebuild and comm is not None:
        print(f"拒绝初始化：{BASELINE} 在 git 历史中存在过；删除后重建须经用户批准，批准后加 `--rebuild`")
        return 1
    if "--write-baseline" in sys.argv:
        kept = base & now if exists else now
        (ROOT / BASELINE).write_text("".join(k + "\n" for k in sorted(kept.elements())), encoding="utf-8", newline="\n")
        print(f"{'已收缩' if exists else '已初始化'} {BASELINE}：{sum(kept.values())} 条"
              + (f"；{len(fresh)} 个新增错误不写入基线" if exists and fresh else ""))
        fresh, stale = (fresh if exists else []), 0
    for w in warnings:
        print("警告", w)
    for cid, path, no, msg in fresh:
        print(f"错误 C{cid} {path}:{no} {msg}")
    if stale:
        print(f"基线中有 {stale} 条已消失：运行 `--write-baseline` 收缩基线")
    if grown:
        print(f"基线比最近提交的版本多 {grown} 条，多出的不生效：基线只减不增、不手工编辑；重建须经用户批准并加 `--rebuild`")
    print(f"check_rules：{len(fresh)} 个新增错误，{len(warnings)} 个警告（{ROOT.name}）")
    return 1 if fresh or stale or grown else 0


if __name__ == "__main__":
    sys.exit(main())
