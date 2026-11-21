"""扫描项目根目录（本文件的上一级）下所有 .html，把导航数据写进 common/common.js。

- 扫描范围：根目录及所有子目录，自动跳过 .git / .venv / __pycache__ / node_modules 等
- 想排除某些页面，改下面「排除配置」三个常量即可
- 页面自己也能退出导航：加 <meta name="nav-hide" content="1">
- nav.js 里的 path 相对项目根；common.js 用脚本自身 src 反推站点根，跨目录不 404

页面可选的元信息：
    <meta name="nav-title"  content="两融出清信号">   二级导航文案（不给就用 <title> 里「·」之前）
    <meta name="nav-group"  content="顶底部研究">     一级导航（不给就用所在目录，同目录有声明则继承）
    <meta name="nav-sub"    content="市场估值">       二级导航小标题（可选）
    <meta name="nav-order"  content="2">              组内排序，小的在前
"""
import fnmatch
import json
import os
import re

COMMON_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(COMMON_DIR)
COMMON_JS = os.path.join(COMMON_DIR, "common.js")

# ---------- 排除配置 ----------
SKIP_DIRS = {".git", ".venv", "venv", "__pycache__", "node_modules",
             "legacy", ".idea", ".vscode", "draft", "private", "tmp"}
SKIP_GLOBS = {"*_test.html", "*_draft.html", "test*.html", "备份*.html"}

EXCLUDE_DIRS = {"new-no", "new_no"}      # 按目录名排除，任意层级
EXCLUDE_NAMES = {"index.html"}           # 按文件名排除，任意层级（通常是总首页）
EXCLUDE_PATHS = set()                    # 按相对根的路径精确排除，如 {"market/index.html"}

# ---------- 其他 ----------
DEFAULT_GROUP = "顶底部研究"
# 与首页板块顺序保持一致；未列出的分组排在最后
GROUP_ORDER = ["顶底部研究", "资金结构", "市场估值", "未来研究", "研究报告"]
BEGIN_MARK = "/* NAV:BEGIN */"
END_MARK = "/* NAV:END */"


def excluded(rel):
    parts = rel.split("/")
    if any(d in EXCLUDE_DIRS for d in parts[:-1]):
        return True
    if parts[-1] in EXCLUDE_NAMES:
        return True
    for ex in EXCLUDE_PATHS:
        ex = ex.strip("/").replace("\\", "/")
        if rel == ex or rel.startswith(ex + "/"):
            return True
    return False


def read_page(path, rel):
    try:
        with open(path, encoding="utf-8") as f:
            head = f.read(6000)
    except Exception:
        return None
    if "<html" not in head.lower():
        return None

    # 页面可以自己声明不进导航
    if re.search(r'<meta\s+name="nav-(?:hide|exclude|hidden)"', head, re.I):
        return None

    def meta(name):
        m = re.search(r'<meta\s+name="' + name + r'"\s+content="([^"]*)"', head, re.I)
        return m.group(1).strip() if m else ""

    m_title = re.search(r"<title>(.*?)</title>", head, re.S | re.I)
    title = re.split(r"\s*[·|｜]\s*", m_title.group(1).strip())[0].strip() \
        if m_title else os.path.basename(path)[:-5]
    title = meta("nav-title") or title

    order = meta("nav-order")
    return {
        "path": rel,
        "title": title,
        "group": meta("nav-group") or None,
        "sub": meta("nav-sub"),
        "order": int(order) if order.isdigit() else 999,
        "dir": os.path.dirname(rel),
    }


def main():
    pages = []
    for root, dirs, files in os.walk(BASE_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            if not name.lower().endswith(".html"):
                continue
            if any(fnmatch.fnmatch(name, g) for g in SKIP_GLOBS):
                continue
            rel = os.path.relpath(os.path.join(root, name), BASE_DIR).replace("\\", "/")
            if excluded(rel):
                continue
            info = read_page(os.path.join(root, name), rel)
            if info:
                pages.append(info)

    # 同目录内只要有一页写了 nav-group，整目录都用它
    declared = {}
    for p in pages:
        if p["group"]:
            declared.setdefault(p["dir"], p["group"])
    for p in pages:
        p["group"] = p["group"] or declared.get(p["dir"]) or DEFAULT_GROUP
        p.pop("dir", None)

    def group_rank(name):
        return GROUP_ORDER.index(name) if name in GROUP_ORDER else len(GROUP_ORDER)

    pages.sort(key=lambda p: (group_rank(p["group"]), p["group"], p["sub"], p["order"], p["title"]))

    payload = [{k: p[k] for k in ("path", "title", "group", "sub", "order")} for p in pages]
    items = ",\n".join("    " + json.dumps(p, ensure_ascii=False, separators=(",", ":"))
                       for p in payload)
    data = "const NAV_PAGES = [\n" + items + "\n  ];" if items else "const NAV_PAGES = [];"

    with open(COMMON_JS, encoding="utf-8") as f:
        js = f.read()
    if BEGIN_MARK not in js or END_MARK not in js:
        raise SystemExit("common.js 里找不到 NAV:BEGIN / NAV:END 标记")
    head, rest = js.split(BEGIN_MARK, 1)
    _, tail = rest.split(END_MARK, 1)
    js = head + BEGIN_MARK + "\n  " + data + "\n  " + END_MARK + tail
    with open(COMMON_JS, "w", encoding="utf-8") as f:
        f.write(js)

    print(f"common.js 导航已更新：{len(pages)} 页")
    for p in pages:
        sub = f" / {p['sub']}" if p["sub"] else ""
        print(f"  [{p['group']}{sub}] {p['title']} -> {p['path']}")


if __name__ == "__main__":
    main()
