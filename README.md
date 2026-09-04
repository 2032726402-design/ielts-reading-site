---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1a1100291a99d6569c275b6c78b5f601_def2bd11a77911f1891f525400f8a581
    ReservedCode1: mAUblAa72O9Oexh5nTtEJC08R5cTIwSKMKluwZEeFlFsEvN1TzEK8OkDSd7cXTBwgw7E1m2Q1Yg1bgQE8XHni47kQz8nw8j2QDaueSxrFimj44+HWVwlng7OGk/upUQVz4c7pZXNSm0n2qKbhcWQu9IpuaGO4mU1Pgv4ZDkALWa3pp1KLt0D9M7yDl4=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1a1100291a99d6569c275b6c78b5f601_def2bd11a77911f1891f525400f8a581
    ReservedCode2: mAUblAa72O9Oexh5nTtEJC08R5cTIwSKMKluwZEeFlFsEvN1TzEK8OkDSd7cXTBwgw7E1m2Q1Yg1bgQE8XHni47kQz8nw8j2QDaueSxrFimj44+HWVwlng7OGk/upUQVz4c7pZXNSm0n2qKbhcWQu9IpuaGO4mU1Pgv4ZDkALWa3pp1KLt0D9M7yDl4=
---

# 每日阅读 · Daily Reading

一个简约风格的本地阅读网站：每天更新一篇雅思阅读英文文章 + 中文短篇小说 / 散文，支持高亮、划线、翻译、单词释义、做笔记、书签。

## 打开方式

直接用浏览器打开 `index.html` 即可（无需服务器）。推荐使用 Chrome / Edge。

```
ielts-reading-site/
├── index.html          # 入口页面
├── css/style.css       # 简约风格样式（中文文章用楷体）
├── js/app.js           # 交互逻辑（高亮/划线/翻译/单词/笔记/书签）
├── data/
│   ├── articles-en.js  # 英文文章库（含作者/来源书籍/官方链接）+ 雅思词汇库（18 词条）
│   └── articles-zh.js  # 中文文章库（1 篇短篇小说 + 5 篇史铁生风格散文，标注来源参考）
└── scripts/
    └── add_article.py  # 每日 09:30 追加新文章的辅助脚本
```

## 功能说明

| 功能 | 操作 |
|------|------|
| 高亮 | 选中文字 -> 浮动工具条点「高亮」；再次点击高亮处可取消 |
| 划线 | 选中文字 -> 点「划线」；再次点击划线处可取消 |
| 翻译 | 选中文字 -> 点「翻译」弹出翻译结果（英文<->中文自动切换） |
| 单词释义 | 点击文中的英文单词，或选中后点「查询释义」；本地词库优先，未收录则优先走牛津词典（配置后启用官方 API），兜底联网词典，含音标 / 词性 / 释义 / 例句，并可一键跳转 Oxford 网页版查词 |
| 文章来源 | 每篇文章标题下方标注 作者 / 来源书籍 / 可查证的官方链接，一键跳转核验 |
| 做笔记 | 选中文字 -> 点「笔记」写入批注，可随时查看 / 删除 |
| 书签 | 顶栏「书签」收藏整篇文章；每段左侧「书签」小按钮收藏指定段落 |
| 数据持久化 | 所有高亮 / 划线 / 笔记 / 书签保存在浏览器本地（localStorage） |

## 关于“每天上午 9:30 更新一篇英文文章”

纯静态网页本身不具备定时任务能力，页面会显示“雅思英语文章每日 09:30 自动更新一篇”的提示。要让每天 09:30 真正追加一篇新文章，任选其一：

### 方案 A：本地定时脚本 + Windows 任务计划程序（推荐）

1. 把当天的新文章按格式写成一个 JSON 文件（参考 `add_article.py` 头部的字段说明）。
2. 打开「任务计划程序」-> 创建任务：
   - 触发器：每天，开始时间 `09:30`
   - 操作：启动程序 → `python.exe`，参数：`"<本目录>\scripts\add_article.py" --file "<当日文章.json>" --data "<本目录>\data\articles-en.js"`
3. 每天 09:30 脚本会把新文章按日期排序写入文章库，刷新页面即可看到。

也可先手动跑一次验证：
```
python scripts\add_article.py --file 今日文章.json
```

### 方案 B：部署到支持定时任务的环境

将整个目录部署到支持 cron / 定时函数的托管平台（如 GitHub Actions、Vercel、云服务器），在 09:30 拉取内容源并调用 `add_article.py` 生成最新文章，实现全自动更新。

## 数据说明

- 英文文章：雅思阅读风格（学术科普向），每篇 6~7 段，标注作者、来源书籍（NIH / WHO / ILO / UNEP / UNESCO / 学术期刊 / Britannica 等）与可查证的官方链接；已内置 18 个高频雅思词汇（含中文释义 + 双例句应用）。
- 中文文章：1 篇短篇小说《雨巷茶馆》+ 5 篇原创散文，正文使用楷体显示；散文风格致敬史铁生（静观、哲思、生命感悟），并标注风格参考书目《我与地坛》。
- 翻译使用 MyMemory 免费接口；查词链路：本地词库 → 牛津词典（在 `js/app.js` 顶部 `OX_CONFIG` 填入 appId/appKey 后启用官方 API，需在 https://developer.oxforddictionaries.com/ 注册）→ dictionaryapi.dev 兜底；词条详情始终提供 Oxford 网页版跳转。联网时可用，断网时本地词库仍可用。
*（内容由AI生成，仅供参考）*
