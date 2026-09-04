# -*- coding: utf-8 -*-
"""
add_article.py —— 向英文文章库追加新文章（用于“每日 09:30 更新一篇”）

用法：
    python add_article.py --file 文章.json [--data data/articles-en.js]
    python add_article.py --interactive [--data data/articles-en.js]

JSON 文件格式（articles 为必填，vocab 可选）：
{
  "articles": [
    {
      "id": "en-008",
      "title": "The Title",
      "date": "2026-09-04",
      "source": "来源说明",
      "content": ["段落一", "段落二"]
    }
  ],
  "vocab": {
    "word": {"phon": "音标", "pos": "词性", "def": "中文释义",
             "use": [["英文例句", "中文翻译"]]}
  }
}

配合 Windows 任务计划程序：
    操作 -> 新建任务 -> 触发器设为“每天 09:30” ->
    操作 -> 启动程序：python.exe，参数：add_article.py --file 今日文章.json --data <绝对路径>
说明：本脚本负责把新文章写入文章库；新文章内容需由你/内容源提前准备好，
或在脚本前另写一步从内容源拉取并落成 JSON。页面加载时即可看到最新文章。
"""
import argparse, json, os, re, sys


def _load_data(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _find_articles_block(text):
    m = re.search(r"(const EN_ARTICLES\s*=\s*)(\[.*?\])(\s*;\s*)", text, re.S)
    if not m:
        raise SystemExit("未在文件中找到 EN_ARTICLES 数组，请检查数据文件格式。")
    return m


def _find_vocab_block(text):
    m = re.search(r"(const EN_VOCAB\s*=\s*\{)(.*?)(\}\s*;\s*)$", text, re.S)
    return m


def _parse_array(text):
    arr = re.sub(r"([{,]\s*)([A-Za-z_$][\w$]*)\s*:", r'\1"\2":', text)
    return json.loads(arr)


def add_articles(data_path, articles, vocab):
    text = _load_data(data_path)

    # 1) 更新 EN_ARTICLES
    m = _find_articles_block(text)
    existing = _parse_array(m.group(2))
    ids = {a["id"] for a in existing}
    dates = {a["date"] for a in existing}
    added = 0
    for a in articles:
        if a.get("id") in ids or a.get("date") in dates:
            print(f"跳过（id 或日期重复）：{a.get('date', '?')} {a.get('title', '?')}")
            continue
        if not a.get("content") or not a.get("title"):
            print(f"跳过（缺少 title 或 content）：{a}")
            continue
        existing.append(a)
        ids.add(a["id"]); dates.add(a["date"])
        added += 1
    existing.sort(key=lambda x: x["date"], reverse=True)
    new_arr = "[\n" + ",\n".join(
        "  {\n"
        + ",\n".join(f'    {k}: {json.dumps(v, ensure_ascii=False)}' for k, v in a.items())
        + "\n  }" for a in existing
    ) + "\n]"
    text = text[: m.start(2)] + new_arr + text[m.end(2):]

    # 2) 追加 EN_VOCAB
    if vocab:
        vm = _find_vocab_block(text)
        if vm:
            # 去除末尾注释等，直接拼接新词条
            inner = vm.group(2).rstrip()
            items = []
            for w, e in vocab.items():
                if f'"{w}"' in vm.group(2):
                    print(f"词条已存在，跳过：{w}")
                    continue
                items.append(f'  "{w}": {json.dumps(e, ensure_ascii=False)}')
            if items:
                sep = ",\n" if inner.strip() else ""
                text = text[: vm.start(2)] + inner + sep + ",\n".join(items) + text[vm.start(2) + len(inner):]
            else:
                print("没有需要追加的词汇。")

    with open(data_path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"完成：新增文章 {added} 篇，数据文件已更新 -> {data_path}")


def main():
    ap = argparse.ArgumentParser(description="向雅思英文文章库追加文章")
    here = os.path.dirname(os.path.abspath(__file__))
    default_data = os.path.normpath(os.path.join(here, "..", "data", "articles-en.js"))
    ap.add_argument("--data", default=default_data, help="articles-en.js 路径")
    ap.add_argument("--file", help="包含 articles/vocab 的 JSON 文件")
    ap.add_argument("--interactive", action="store_true", help="交互式输入")
    args = ap.parse_args()

    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            payload = json.load(f)
        add_articles(args.data, payload.get("articles", []), payload.get("vocab", {}))
    elif args.interactive:
        print("交互模式：请输入文章信息（输入空标题结束）。")
        articles, vocab = [], {}
        while True:
            title = input("标题（回车结束）: ").strip()
            if not title:
                break
            date = input("日期 YYYY-MM-DD: ").strip()
            source = input("来源: ").strip()
            print("输入正文段落，每行一段，空行结束：")
            content = []
            while True:
                line = input().strip()
                if not line:
                    break
                content.append(line)
            articles.append({"id": "en-{:03d}".format(999), "title": title,
                             "date": date, "source": source, "content": content})
        add_articles(args.data, articles, vocab)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
