"""check_rules.py 的回归测试（仅用标准库 unittest）。运行方式见 AGENTS.md。

每个用例把规则、模板和检查脚本复制到临时目录，注入一处改动后运行脚本，断言退出码和输出；不写仓库，
子进程带 -B 且设置 PYTHONDONTWRITEBYTECODE=1。用例名与 .agents/DOCUMENTS.md“规则与检查对照”的“测试”栏对应。
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[2]
# 临时树要能独立通过检查：除了规则与记录，还得复制权威载体里被链接到的文件。
# 少了它们，真实载体指向 ../.knowledge/README.md、../scripts/README.md、../README.md 的链接
# 在临时树里全成死链，于是每个「应该通过」的用例都变成失败。新增跨目录链接时同步这份清单。
PARTS = ["AGENTS.md", "CLAUDE.md", ".agents", ".logsdev", "README.md", ".knowledge", "scripts"]
DOC, DEV, WRITING = ".agents/DOCUMENTS.md", ".agents/rules/development.md", ".agents/rules/writing.md"
PROJ, INTER, QUERY, DEC, ARC = (".logsdev/PROJECTION.md", ".logsdev/INTERACTION.md", ".logsdev/query.md",
                                ".logsdev/DECISIONS.md", ".logsdev/archive/README.md")
WD, WDIR = ".logsdev/调研-20261019.md", ".logsdev/调研-20261019"
KEY = "sk-" + "Ab3" * 10  # 拼接生成，仓库里不出现完整的密钥样式
GIT = shutil.which("git") is not None


def wdoc(state, extra="", date="2026-10-19"):
    return f"# 文档\n\n日期：{date}\n来源：用户指令\n状态：{state}\n{extra}\n## 正文\n\n内容\n"


class Tree:
    def __init__(self, root):
        self.root = root

    def read(self, r):
        return (self.root / r).read_text(encoding="utf-8")

    def write(self, r, text):
        (self.root / r).parent.mkdir(parents=True, exist_ok=True)
        if isinstance(text, bytes):
            (self.root / r).write_bytes(text)
        else:
            (self.root / r).write_text(text, encoding="utf-8", newline="\n")

    def append(self, r, text):
        self.write(r, self.read(r) + text)

    def sub(self, r, old, new, regex=False):
        text = self.read(r)
        out = re.sub(old, new, text, count=1, flags=re.S) if regex else text.replace(old, new, 1)
        if out == text:
            raise AssertionError(f"{r} 中没有找到要替换的内容：{old}")
        self.write(r, out)

    def rm(self, r):
        p = self.root / r
        shutil.rmtree(p) if p.is_dir() else p.unlink()

    def map(self, line):
        self.sub(DOC, "## 项目映射\n\n", f"## 项目映射\n\n{line}\n")

    def design(self, name="设计载体（界面）", path=".logsdev/界面-20261019.md", state="现行", link=True):
        self.map(f"{name} → {path}")
        self.write(path, wdoc(state))
        if link:
            self.append(PROJ, f"\n[界面设计]({Path(path).name})\n")

    def decisions(self, index, body):
        self.write(DEC, "# Decisions\n\n条目格式见 DOCUMENTS 的“DECISIONS 条目”。\n\n## 索引\n\n" + index + "\n" + body)

    def git(self, *args):
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args], cwd=self.root,
                       check=True, capture_output=True)


def run(t, *args):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-B", str(t.root / ".agents/verifier/check_rules.py"), *args], capture_output=True,
                       text=True, encoding="utf-8", errors="replace", env=env, cwd=t.root.parent)
    return r.returncode, r.stdout + r.stderr


class CheckRules(unittest.TestCase):
    def tree(self):
        tmp = Path(tempfile.mkdtemp(prefix="check-rules-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        root = tmp / "proj"
        for part in PARTS:
            src, dst = SRC / part, root / part
            if not src.exists():
                continue  # 夹具按本仓库的链接目标列举，接入项目缺其中某项时不算错
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("check_rules.baseline", "__pycache__")) if src.is_dir() else shutil.copy2(src, dst)
        return Tree(root)

    def expect(self, t, text=None, rc=1, *args):
        code, out = run(t, *args)
        self.assertEqual(code, rc, out)
        if text:
            self.assertIn(text, out)
        return out

    def cases(self, cases):
        for case in cases:
            name, change, text, rc = (case + (1,))[:4]
            with self.subTest(name):
                if "git" in name and not GIT:
                    self.skipTest("没有 git")
                t = self.tree()
                change(t)
                self.expect(t, text, rc)

    def test_clean(self):
        self.expect(self.tree(), "0 个新增错误", 0)

    def test_c01(self):
        self.cases([
            ("删除 CLAUDE.md", lambda t: t.rm("CLAUDE.md"), "必需文件缺失"),
            ("删除 DECISIONS", lambda t: t.rm(DEC), "必需文件缺失：DECISIONS"),
            ("改映射后默认文件仍在", lambda t: (t.write(".logsdev/PROJECT.md", t.read(PROJ)),
                                       t.map("PROJECTION → .logsdev/PROJECT.md")), "默认文件仍在"),
        ])

    def test_c02(self):
        self.cases([
            ("CLAUDE.md 写了正文", lambda t: t.append("CLAUDE.md", "\n规则正文\n"), "除注释外"),
            ("AGENTS 超过行数上限", lambda t: t.append("AGENTS.md", "\n" * 70), "超过 100 行"),
        ])

    def test_c03(self):
        self.cases([
            ("死链", lambda t: t.append(INTER, "\n[x](不存在.md)\n"), "死链"),
            ("带 title 的死链", lambda t: t.append(INTER, '\n[x](不存在.md "说明")\n'), "死链"),
            ("锚点不存在", lambda t: t.append(INTER, "\n[x](PROJECTION.md#不存在)\n"), "锚点不存在"),
            ("本文件锚点不存在", lambda t: t.append(INTER, "\n[x](#不存在)\n"), "锚点不存在"),
            ("DOCUMENTS 小节不存在", lambda t: t.append(WRITING, "\n见 DOCUMENTS 的“不存在”。\n"), "小节“不存在”不存在"),
            ("同一行第二个小节不存在", lambda t: t.append(WRITING, "\n见 DOCUMENTS 的“工作文档”和“不存在”。\n"),
             "小节“不存在”不存在"),
            ("中文锚点通过", lambda t: t.append(INTER, "\n[x](PROJECTION.md#当前有效要求)\n"), None, 0),
        ])

    def test_c04(self):
        self.cases([
            ("规则文件中的密钥", lambda t: t.append(WRITING, f"\n{KEY}\n"), "疑似密钥"),
            ("GBK 文件中的密钥", lambda t: (t.write(f"{WDIR}/README.md", wdoc("现行")),
                                       t.write(f"{WDIR}/log.txt", "日志 ".encode("gbk") + KEY.encode())), "疑似密钥"),
            ("私钥", lambda t: (t.write(f"{WDIR}/README.md", wdoc("现行")),
                              t.write(f"{WDIR}/k.txt", "-----BEGIN RSA " + "PRIVATE KEY-----\n")), "疑似密钥"),
        ])

    def test_c05(self):
        self.cases([
            ("映射无法解析", lambda t: t.map("PROJECTION .logsdev/x.md"), "无法解析"),
            ("重复登记", lambda t: t.map("删除记录 → .logsdev/archive/README.md；删除记录 → .logsdev/archive/README.md"),
             "重复登记"),
            ("全角半角括号同主题", lambda t: (t.design(), t.design("设计载体(界面)", ".logsdev/界面-20261020.md")), "重复登记"),
            ("设计载体名称格式", lambda t: t.design("设计载体界面"), "应写成"),
            ("外部设计载体", lambda t: t.map("设计载体（界面） → https://example.com/x"), "本地路径"),
            ("反斜杠路径", lambda t: (t.write(".logsdev/界面-20261019.md", wdoc("现行")),
                                 t.map("设计载体（界面） → .logsdev\\界面-20261019.md")), "用 `/` 分隔"),
            ("设计载体不在 .logsdev", lambda t: t.design(path="docs/界面-20261019.md", link=False), "本地路径"),
            ("缺少项目映射节", lambda t: t.sub(DOC, "## 项目映射", "## 映射"), "缺少“## 项目映射”节"),
            ("未知载体", lambda t: t.map("README → .logsdev/query.md"), "未知载体"),
            ("设计载体命名", lambda t: t.design(path=".logsdev/界面.md"), "不符合工作文档命名"),
            ("映射路径不存在", lambda t: t.map("删除记录 → .logsdev/无.md"), "路径不存在"),
            ("设计载体路径穿越", lambda t: (t.map("设计载体（界面） → .logsdev/../界面-20261019.md"),
                                       t.write("界面-20261019.md", wdoc("现行")),
                                       t.append(PROJ, "\n[d](../界面-20261019.md)\n")), "须是 `.logsdev/` 下"),
            ("非设计载体反斜杠路径", lambda t: (t.write(".logsdev/PROJECT.md", t.read(PROJ)), t.rm(PROJ),
                                         t.map("PROJECTION → .logsdev\\PROJECT.md")), "用 `/` 分隔"),
        ])

    def test_c06(self):
        self.cases([
            ("可转到未知状态", lambda t: t.sub(DOC, "| 现行、已废 |", "| 现行、完成 |"), "不在状态表中"),
            ("正文引号状态词", lambda t: t.append(WRITING, "\n状态改为“完成”。\n"), "不在词表中"),
            ("正文无引号状态词", lambda t: t.append(WRITING, "\n状态改为完成后交付。\n"), "不在词表中"),
            ("状态表列数", lambda t: t.sub(DOC, r"\| 现行 \|[^\n]*\n", "| 现行 | 当前有效的材料 | 已废 |\n", True),
             "状态表每行应为"),
            ("旧状态词已移除", lambda t: t.append(WRITING, "\n状态改为“已采纳”。\n"), "不在词表中"),
        ])

    def test_c07(self):
        e1, e2 = "## D-20261019-1 甲\n\n内容\n", "## D-20261019-2 乙\n\n内容\n"
        i1, i2 = "- D-20261019-1 甲｜范围｜现行\n", "- D-20261019-2 乙｜范围｜现行\n"
        by2 = "- D-20261019-1 甲｜范围｜被 D-20261019-2 取代\n"
        tail2 = "## D-20261019-1 甲\n\n内容\n\n被 D-20261019-2 取代\n"
        self.cases([
            ("标题无编号", lambda t: t.decisions("", "## 甲\n\n内容\n"), "条目标题应为"),
            ("日期无效", lambda t: t.decisions("- D-20261340-1 甲｜范围｜现行\n", "## D-20261340-1 甲\n"), "真实日期"),
            ("不在索引", lambda t: t.decisions("", e1), "不在索引中"),
            ("索引标题不一致", lambda t: t.decisions("- D-20261019-1 丙｜范围｜现行\n", e1), "不一致"),
            ("序号不从 1 起", lambda t: t.decisions(i2, e2), "从 1 起连续"),
            ("编号重复", lambda t: t.decisions(i1, e1 + e1), "重复"),
            ("取代者更早", lambda t: t.decisions(i1 + "- D-20261019-2 乙｜范围｜被 D-20261019-1 取代\n",
                                            e1 + e2 + "\n被 D-20261019-1 取代\n"), "编号更晚"),
            ("取代者不存在", lambda t: t.decisions("- D-20261019-1 甲｜范围｜被 D-20261020-1 取代\n",
                                             e1 + "\n被 D-20261020-1 取代\n"), "不存在"),
            ("正文已取代索引现行", lambda t: t.decisions(i1 + i2, tail2 + e2), "索引仍是“现行”"),
            ("索引已取代正文未注明", lambda t: t.decisions(by2 + i2, e1 + e2), "正文末尾未注明"),
            ("合法取代通过", lambda t: t.decisions(by2 + i2, tail2 + e2), None, 0),
        ])

    def test_c08(self):
        def ignored(t):
            t.git("init", "-q")
            t.write(".gitignore", "shot.png\n")
            t.write(f"{WDIR}/README.md", wdoc("现行"))
            t.write(f"{WDIR}/shot.png", b"png")
            t.append(PROJ, "\n![图](调研-20261019/shot.png)\n")

        def external(t):
            t.map("PROJECTION → https://example.com/issues/1")
            t.rm(PROJ)
            # PROJECTION 搬到外部后，本地引用它的链接必须一并去掉，否则就是真的死链
            t.sub(INTER, "现行要求见 [PROJECTION.md](PROJECTION.md)，", "")
            t.write(WD, wdoc("已废（失效）"))

        def outside(t):
            t.git("init", "-q")
            t.write("../outside.png", b"png")
            t.append(PROJ, "\n![外](../../outside.png)\n")

        self.cases([
            ("合法现行文档通过", lambda t: t.write(WD, wdoc("现行")), None, 0),
            ("命名不符", lambda t: t.write(".logsdev/调研.md", wdoc("现行")), "不符合命名"),
            ("缺状态行", lambda t: t.write(WD, "# 文档\n\n日期：2026-10-19\n来源：用户指令\n"), "缺少 `状态："),
            ("缺日期行", lambda t: t.write(WD, "# 文档\n\n来源：用户指令\n状态：现行\n"), "开头缺少 `日期："),
            ("未知状态", lambda t: t.write(WD, wdoc("完成")), "不在词表中"),
            ("已废缺括号", lambda t: t.write(WD, wdoc("已废")), "括号中写取代者"),
            ("已废未被引用只警告", lambda t: t.write(WD, wdoc("已废（失效）")), "可按 DOCUMENTS", 0),
            ("被引用目录内文件时保留", lambda t: (t.write(f"{WDIR}/README.md", wdoc("已废（失效）")),
                                          t.write(f"{WDIR}/a.txt", "x"), t.append(PROJ, "\n[a](调研-20261019/a.txt)\n")),
             None, 0),
            ("开头字段写在第一个小节之后", lambda t: t.write(WD, "# 文档\n\n## 背景\n\n日期：2026-10-19\n来源：x\n状态：现行\n"),
             "开头缺少 `日期："),
            ("长说明后的开头字段通过", lambda t: t.write(WD, "# 文档\n\n" + "说明。\n" * 25 + "\n日期：2026-10-19\n来源：x\n状态：现行\n"),
             None, 0),
            ("目录缺 README", lambda t: t.write(f"{WDIR}/a.txt", "x"), "缺少入口 README.md"),
            ("任务记录命名", lambda t: t.write(".logsdev/task-x.md", "# 任务\n"), "任务记录应命名"),
            ("根目录散落附件", lambda t: t.write(".logsdev/a.png", b"png"), "散落附件"),
            ("archive 的配置文件不登记清单", lambda t: t.write(".logsdev/archive/.gitignore", "*\n"), None, 0),
            ("引用 archive 内文件", lambda t: (t.write(".logsdev/archive/old.md", "旧\n"),
                                          t.append(ARC, "- `old.md` — 来源：x；删除条件：2099-01-01\n"),
                                          t.append(PROJ, "\n[旧](archive/old.md)\n")), "引用了 archive"),
            ("引用 archive 目录", lambda t: t.append(PROJ, "\n[旧](archive/)\n"), "引用了 archive"),
            ("设计载体未被 PROJECTION 链接", lambda t: t.design(link=False), "须由 PROJECTION 链接"),
            ("设计载体状态不是现行", lambda t: t.design(state="已废（被替换）"), "开头没有 `状态：现行`"),
            ("合法设计载体通过", lambda t: t.design(), None, 0),
            ("记录格式缺代码块", lambda t: t.sub(DOC, r"```\n日期：2026-10-19\n.*?```\n", "", True),
             "缺少工作文档开头字段的代码块"),
            ("PROJECTION 在外部时只警告", external, "无法确认是否被引用", 0),
            ("git 忽略的附件", ignored, "被 .gitignore 忽略"),
            ("git 仓库外的本地文件", outside, "仓库外"),
            ("设计载体状态只是以现行开头", lambda t: t.design(state="现行未确认"), "开头没有 `状态：现行`"),
            ("PROJECTION 在外部时设计载体给警告", lambda t: (external(t), t.rm(WD), t.design(link=False)),
             "无法确认设计载体是否被 PROJECTION 链接", 0),
            ("文件名日期不真实", lambda t: t.write(".logsdev/调研-20261399.md", wdoc("现行")), "不是真实日期"),
            ("开头日期不真实", lambda t: t.write(WD, wdoc("现行", date="2026-13-99")), "不是真实日期"),
            ("开头日期与文件名不一致", lambda t: t.write(WD, wdoc("现行", date="2026-10-20")), "与文件名日期不一致"),
            ("状态括号不完整", lambda t: t.write(WD, wdoc("已废（失效")), "状态行应为"),
        ])

    def test_c09(self):
        def grow(t, n=400):
            t.append(PROJ, "\n" + "行\n" * n)

        self.cases([
            ("PROJECTION 超过行数上限", grow, "PROJECTION 超过载体上限 400 行"),
            ("阈值行被删", lambda t: t.sub(DOC, r"- 载体行数上限：[^\n]*\n", "", True), "缺少“载体行数上限”"),
            ("阈值无法解析", lambda t: t.sub(DOC, "- 载体行数上限：query 400", "- 载体行数上限：query"), "无法解析"),
            ("AGENTS 上限独立", lambda t: t.append("AGENTS.md", "\n" * 70), "超过 100 行"),
        ])

    def test_waiver(self):
        line = "\n[x](a.md)<!-- check-rules: 豁免 {} 至 {} 由 {} 批准：测试 -->\n"
        self.cases([
            ("有效例外", lambda t: t.append(INTER, line.format("C3", "2999-12-31", "用户")), None, 0),
            ("过期例外", lambda t: t.append(INTER, line.format("C3", "2000-01-01", "用户")), "死链"),
            ("检查编号不符", lambda t: t.append(INTER, line.format("C1", "2999-12-31", "用户")), "死链"),
            ("不是用户批准", lambda t: t.append(INTER, line.format("C3", "2999-12-31", "Agent")), "死链"),
            ("批准写法多了空格", lambda t: t.append(INTER, line.replace("由 {} 批准", "由  {}  批准").format("C3", "2999-12-31", "用户")),
             "死链"),
            ("例外注释后还有文字", lambda t: t.append(INTER, line.format("C3", "2999-12-31", "用户").rstrip("\n") + " 尾随\n"),
             "死链"),
        ])

    def test_baseline(self):
        t, base = self.tree(), ".agents/verifier/check_rules.baseline"
        t.append(INTER, "\n[a](a.md)\n")
        self.expect(t, "已初始化", 0, "--write-baseline")
        first = t.read(base)
        self.assertEqual(first.count("\n"), 1)
        self.expect(t, "0 个新增错误", 0)
        t.append(INTER, "\n[b](b.md)\n")
        self.expect(t, "死链：b.md", 1)
        self.expect(t, "1 个新增错误不写入基线", 1, "--write-baseline")
        self.assertEqual(t.read(base), first)
        t.sub(INTER, "\n[b](b.md)\n", "")
        t.sub(INTER, "\n[a](a.md)\n", "")
        self.expect(t, "基线中有 1 条已消失", 1)
        self.expect(t, "已收缩", 0, "--write-baseline")
        self.assertEqual(t.read(base), "")
        self.expect(t, "0 个新增错误", 0)

    @unittest.skipUnless(GIT, "没有 git")
    def test_baseline_rebuild(self):
        t, base = self.tree(), ".agents/verifier/check_rules.baseline"
        t.git("init", "-q")
        t.write(base, "")
        t.git("add", base)
        t.git("commit", "-q", "-m", "baseline")
        t.rm(base)
        self.expect(t, "拒绝初始化", 1, "--write-baseline")
        self.assertFalse((t.root / base).exists())
        self.expect(t, "已初始化", 0, "--write-baseline", "--rebuild")

    def test_baseline_corrupt(self):
        t, base = self.tree(), ".agents/verifier/check_rules.baseline"
        t.write(base, b"\xff\xfe")
        self.expect(t, "无法读取", 1)
        self.expect(t, "无法读取", 1, "--write-baseline")
        self.assertEqual((t.root / base).read_bytes(), b"\xff\xfe")

    @unittest.skipUnless(GIT, "没有 git")
    def test_baseline_tamper(self):
        t, base = self.tree(), ".agents/verifier/check_rules.baseline"
        t.git("init", "-q")
        t.append(INTER, "\n[a](a.md)\n")
        self.expect(t, "已初始化", 0, "--write-baseline")
        t.git("add", base)
        t.git("commit", "-q", "-m", "baseline")
        t.append(base, "C3 .logsdev/INTERACTION.md 死链：b.md\n")
        t.append(INTER, "\n[b](b.md)\n")
        self.expect(t, "比最近提交的版本多 1 条", 1)
        t.git("rm", "-q", "-f", base)
        t.git("commit", "-q", "-m", "drop")
        t.write(base, "")
        self.expect(t, "2 个新增错误不写入基线", 1, "--write-baseline")
        self.assertEqual(t.read(base), "")


if __name__ == "__main__":
    unittest.main()
