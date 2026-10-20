/* ===== 电子书阅读模块（独立 IIFE，与 app.js 互不干扰） =====
 * 功能：书架 / 章节阅读 / 两级目录 / 多色高亮 / 书签 / 阅读进度 / 字号 / 主题
 * 数据：全部存 localStorage（单浏览器，不跨设备同步）
 * 高亮定位：章节内「块索引 + 块内字符偏移」文本锚点，不依赖 DOM 序号
 */
(function () {
  "use strict";

  var BOOK = window.EBOOK_DATA;
  if (!BOOK) return;
  /* 完整阅读序列：前置内容（扉页/版权/献词/引言等）+ 正文章节 */
  var ALL = (BOOK.front || []).concat(BOOK.chapters || []);

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var IMG_BASE = "data/ebook/images/";
  var LS_PREFIX = "eb_" + BOOK.id + "_";

  /* ---------- 状态 ---------- */
  var state = {
    chapterId: null,
    scrollRatio: 0,      // 当前章节滚动比例
    topBidx: 0,          // 视口顶部块索引
    fontSize: 17,
    theme: "light",      // light | sepia | dark
    tocOpen: false,
    drawerOpen: null,    // "hl" | "bm" | null
    hlMenu: null,        // 当前操作的高亮记录 id
    suppressSelect: false
  };

  function lsGet(key, def) {
    try {
      var v = localStorage.getItem(LS_PREFIX + key);
      return v ? JSON.parse(v) : def;
    } catch (e) { return def; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch (e) {}
  }
  function lsDel(key) {
    try { localStorage.removeItem(LS_PREFIX + key); } catch (e) {}
  }

  /* ---------- 章节工具 ---------- */
  function findChapter(chId) {
    for (var i = 0; i < ALL.length; i++) {
      if (ALL[i].id === chId) return ALL[i];
    }
    return null;
  }
  function chapterIndex(chId) {
    for (var i = 0; i < ALL.length; i++) {
      if (ALL[i].id === chId) return i;
    }
    return -1;
  }
  function chapterTitle(ch) {
    return (ch && ch.title) ? ch.title : "（无标题）";
  }

  /* 构建章节文本拼接 + 块区间映射（块间以单个空格分隔） */
  function buildChapterMap(chapter) {
    var map = [];
    var parts = [];
    var bidx = 0;
    for (var i = 0; i < chapter.blocks.length; i++) {
      var b = chapter.blocks[i];
      if (b.type === "para" || b.type === "note") {
        var start = parts.join(" ").length;
        parts.push(b.text);
        map.push({ bidx: bidx, start: start, end: start + b.text.length, type: b.type });
        bidx++;
      }
    }
    return { text: parts.join(" "), map: map };
  }

  /* 全书进度：按全部章节文本长度累计 */
  function totalTextLen() {
    var sum = 0;
    ALL.forEach(function (c) {
      c.blocks.forEach(function (b) {
        if (b.type === "para" || b.type === "note") sum += b.text.length + 1;
      });
    });
    return sum;
  }
  function chapterTextLen(chId) {
    var c = findChapter(chId);
    if (!c) return 0;
    var sum = 0;
    c.blocks.forEach(function (b) {
      if (b.type === "para" || b.type === "note") sum += b.text.length + 1;
    });
    return sum;
  }

  /* ---------- 高亮 / 书签 / 进度 存储 ---------- */
  function getHighlights() { return lsGet("highlights", []); }
  function setHighlights(list) { lsSet("highlights", list); }
  function getBookmarks() { return lsGet("bookmarks", []); }
  function setBookmarks(list) { lsSet("bookmarks", list); }
  function getProgress() { return lsGet("progress", null); }
  function setProgress(p) { lsSet("progress", p); }
  function getPrefs() {
    var p = lsGet("prefs", null);
    if (p) return p;
    return { fontSize: 17, theme: "light" };
  }
  function setPrefs(p) { lsSet("prefs", p); }

  /* ---------- 渲染：书架 ---------- */
  function renderShelf() {
    var grid = $("#eb-shelf-grid");
    grid.innerHTML = "";
    var prog = getProgress();
    var percent = 0;
    if (prog && prog.chapterId) {
      var done = 0;
      var idx = chapterIndex(prog.chapterId);
      for (var i = 0; i < idx; i++) done += chapterTextLen(ALL[i].id);
      done += (prog.ratio || 0) * chapterTextLen(prog.chapterId);
      var total = totalTextLen();
      percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    }
    var card = document.createElement("div");
    card.className = "eb-book-card";
    card.innerHTML =
      '<div class="eb-book-cover-wrap"><img src="' + IMG_BASE + 'cover.jpeg" alt="' + escHtml(BOOK.title) + '" loading="lazy"></div>' +
      '<div class="eb-book-info">' +
      '<div class="eb-book-title">' + escHtml(BOOK.title) + '</div>' +
      '<div class="eb-book-author">' + escHtml(BOOK.author) + '</div>' +
      '<div class="eb-book-meta">' + escHtml(BOOK.translator ? "译者：" + BOOK.translator : "") + ' · ' + escHtml(BOOK.publisher || "") + '</div>' +
      '<div class="eb-book-progress">' +
      (percent > 0 ? ('已读 ' + percent + '%<span class="eb-pbar"><i style="width:' + percent + '%"></i></span>') : '尚未开始阅读<span class="eb-pbar"><i style="width:0%"></i></span>') +
      '</div>' +
      '<div class="eb-book-meta">' + escHtml((BOOK.description || "").length > 60 ? (BOOK.description || "").slice(0, 60) + "…" : (BOOK.description || "")) + '</div>' +
      '</div>';
    card.addEventListener("click", function () {
      openBook();
    });
    grid.appendChild(card);
  }

  /* ---------- 打开 / 返回 ---------- */
  function openBook() {
    var prog = getProgress();
    var target = (prog && prog.chapterId) ? prog.chapterId : ALL[0].id;
    var ratio = (prog && prog.chapterId) ? (prog.ratio || 0) : 0;
    $("#eb-shelf").classList.add("hidden");
    $("#eb-reader").classList.remove("hidden");
    loadChapter(target, ratio);
    // 桌面端默认打开侧边栏目录，移动端保持抽屉式
    if (window.innerWidth > 760) openToc(); else closeToc();
  }
  function backToShelf() {
    saveProgress();
    $("#eb-reader").classList.add("hidden");
    $("#eb-shelf").classList.remove("hidden");
    closeDrawers();
    closeToc();
    renderShelf();
  }

  /* ---------- 渲染：章节 ---------- */
  function loadChapter(chId, ratio) {
    var chapter = findChapter(chId);
    if (!chapter) return;
    state.chapterId = chId;
    state.scrollRatio = ratio || 0;
    renderChapter(chapter, ratio || 0);
    renderTocActive(chId);
    updateProgressBar();
    $("#eb-chapter-title").textContent = chapterTitle(chapter);
    $("#eb-foot-info").textContent = "划选文字即可添加高亮；点击高亮可改色或删除。";
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* 渲染章节正文：应用高亮 + 书签标记 */
  function renderChapter(chapter, ratio) {
    var content = $("#eb-content");
    var highlights = getHighlights().filter(function (h) { return h.chapterId === chapter.id; });
    var bookmarks = getBookmarks().filter(function (b) { return b.chapterId === chapter.id; });
    var bmByBidx = {};
    bookmarks.forEach(function (b) { bmByBidx[b.bidx] = b; });

    var frag = document.createDocumentFragment();
    var titleEl = document.createElement("h1");
    titleEl.className = "eb-chapter-title";
    titleEl.textContent = chapterTitle(chapter);
    frag.appendChild(titleEl);

    var bidx = 0;
    chapter.blocks.forEach(function (b) {
      if (b.type === "heading") {
        var h = document.createElement("h3");
        h.className = "eb-sub-title";
        h.textContent = b.text;
        frag.appendChild(h);
        return;
      }
      if (b.type === "divider") {
        frag.appendChild(document.createElement("hr")).className = "eb-divider";
        return;
      }
      if (b.type === "image") {
        var img = document.createElement("img");
        img.className = "eb-image";
        img.src = IMG_BASE + b.src;
        img.alt = "";
        img.loading = "lazy";
        frag.appendChild(img);
        return;
      }
      if (b.type === "para" || b.type === "note") {
        var el = document.createElement(b.type === "note" ? "div" : "p");
        el.className = b.type === "note" ? "eb-note" : "eb-para";
        el.setAttribute("data-bidx", String(bidx));
        el.setAttribute("data-text", b.text);
        if (bmByBidx[bidx]) el.classList.add("eb-has-bookmark");
        // 应用高亮：将记录中的 segs 展开到当前块
        var blockSegs = [];
        highlights.forEach(function (h) {
          (h.segs || []).forEach(function (seg) {
            if (seg.bidx === bidx && seg.start < seg.end) {
              blockSegs.push({ id: h.id, color: h.color, s: seg.start, e: seg.end });
            }
          });
        });
        blockSegs.sort(function (a, b2) { return a.s - b2.s || a.e - b2.e; });
        // 合并重叠（后建优先：重叠部分取后一条完整覆盖）
        var merged = [];
        blockSegs.forEach(function (s) {
          var last = merged[merged.length - 1];
          if (last && s.s < last.e) {
            // 重叠：跳过新段，避免互相覆盖
            return;
          }
          merged.push(s);
        });
        if (!merged.length) {
          el.textContent = b.text;
        } else {
          var frag2 = document.createDocumentFragment();
          var pos = 0;
          merged.forEach(function (s) {
            if (s.s > pos) frag2.appendChild(document.createTextNode(b.text.slice(pos, s.s)));
            var mk = document.createElement("mark");
            mk.className = "eb-hl eb-hl-" + s.color;
            mk.setAttribute("data-hlid", s.id);
            mk.textContent = b.text.slice(s.s, s.e);
            frag2.appendChild(mk);
            pos = s.e;
          });
          if (pos < b.text.length) frag2.appendChild(document.createTextNode(b.text.slice(pos)));
          el.appendChild(frag2);
        }
        // 书签标记
        if (bmByBidx[bidx]) {
          var flag = document.createElement("span");
          flag.className = "eb-bm-flag";
          flag.title = "此处有书签：" + (bmByBidx[bidx].label || chapterTitle(chapter));
          flag.textContent = "🔖";
          el.appendChild(flag);
        }
        frag.appendChild(el);
        bidx++;
        return;
      }
    });

    content.innerHTML = "";
    content.appendChild(frag);
    if (ratio > 0) {
      requestAnimationFrame(function () {
        var wrap = content;
        var max = wrap.scrollHeight - window.innerHeight + 90;
        if (max > 0) window.scrollTo(0, Math.min(max, ratio * max));
      });
    } else {
      window.scrollTo(0, 0);
    }
  }

  /* ---------- 目录 ---------- */
  function renderToc() {
    var ul = $("#eb-toc-list");
    ul.innerHTML = "";
    var openCh = lsGet("tocOpenChapters", {});
    ALL.forEach(function (c) {
      var li = document.createElement("li");
      var ch = document.createElement("div");
      ch.className = "eb-toc-chapter" + (openCh[c.id] ? " open" : "");
      ch.setAttribute("data-chid", c.id);
      var hasSections = (c.blocks || []).some(function (b) { return b.type === "heading" && b.level === 3; });
      ch.innerHTML =
        '<span class="eb-toc-cname">' + escHtml(chapterTitle(c)) + '</span>' +
        (hasSections ? '<span class="eb-toc-arrow">▶</span>' : '');
      ch.addEventListener("click", function (e) {
        if (hasSections) {
          var isOpen = ch.classList.toggle("open");
          openCh[c.id] = isOpen;
          lsSet("tocOpenChapters", openCh);
          if (!isOpen) return;
        }
        loadChapter(c.id, 0);
        closeTocMobile();
      });
      li.appendChild(ch);
      if (hasSections) {
        var sub = document.createElement("ul");
        sub.className = "eb-toc-sub";
        c.blocks.forEach(function (b) {
          if (b.type === "heading" && b.level === 3) {
            var sec = document.createElement("li");
            sec.className = "eb-toc-section";
            sec.textContent = b.text;
            sec.addEventListener("click", function () {
              loadChapter(c.id, 0);
              setTimeout(function () { scrollToHeading(b.text); }, 30);
              closeTocMobile();
            });
            sub.appendChild(sec);
          }
        });
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
  }
  function renderTocActive(chId) {
    $$(".eb-toc-chapter").forEach(function (c) {
      c.classList.toggle("active", c.dataset.chid === chId);
    });
  }
  function scrollToHeading(text) {
    var els = $$("#eb-content .eb-sub-title");
    for (var i = 0; i < els.length; i++) {
      if (els[i].textContent === text) {
        els[i].scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  }

  /* ---------- 目录开合 ---------- */
  function openToc() {
    state.tocOpen = true;
    $("#eb-toc").classList.remove("hidden");
    // 仅移动端抽屉模式显示遮罩，桌面端侧栏不遮挡正文
    if (window.innerWidth <= 760) $("#eb-toc-mask").classList.remove("hidden");
  }
  function closeToc() {
    state.tocOpen = false;
    $("#eb-toc").classList.add("hidden");
    $("#eb-toc-mask").classList.add("hidden");
  }
  function closeTocMobile() {
    if (window.innerWidth <= 760) closeToc();
  }

  /* ---------- 抽屉（高亮 / 书签管理） ---------- */
  function openDrawer(kind) {
    closeDrawers();
    state.drawerOpen = kind;
    if (kind === "hl") {
      renderHlList();
      $("#eb-hl-drawer").classList.remove("hidden");
    } else {
      renderBmList();
      $("#eb-bm-drawer").classList.remove("hidden");
    }
    $("#eb-toc-mask").classList.remove("hidden");
    if (kind === "hl") $("#eb-highlight-btn").classList.add("active");
    else $("#eb-bookmark-btn").classList.add("active");
  }
  function closeDrawers() {
    state.drawerOpen = null;
    $("#eb-hl-drawer").classList.add("hidden");
    $("#eb-bm-drawer").classList.add("hidden");
    $("#eb-toc-mask").classList.add("hidden");
    $("#eb-highlight-btn").classList.remove("active");
    $("#eb-bookmark-btn").classList.remove("active");
  }

  function renderHlList() {
    var ul = $("#eb-hl-list");
    var hls = getHighlights().slice().sort(function (a, b) { return b.time - a.time; });
    if (!hls.length) {
      ul.innerHTML = '<li class="eb-d-empty">还没有高亮，划选正文文字即可添加。</li>';
      return;
    }
    ul.innerHTML = "";
    hls.forEach(function (h) {
      var ch = findChapter(h.chapterId);
      var li = document.createElement("li");
      li.className = "eb-d-item";
      var colorMap = { yellow: "#ffe28a", green: "#c8e6c9", blue: "#bbdefb", pink: "#f8bbd0" };
      li.innerHTML =
        '<div class="eb-d-item-head">' +
        '<span class="eb-d-chapter"><span class="eb-d-color" style="background:' + (colorMap[h.color] || "#ffe28a") + '"></span>' +
        escHtml(ch ? chapterTitle(ch) : h.chapterId) + '</span>' +
        '<button class="eb-d-del" title="删除高亮">✕</button></div>' +
        '<div class="eb-d-text">' + escHtml(h.text || (h.segs || []).map(function (s) { return s.text; }).join(" ")) + '</div>';
      li.querySelector(".eb-d-del").addEventListener("click", function (e) {
        e.stopPropagation();
        removeHighlight(h.id);
      });
      li.style.cursor = "pointer";
      li.addEventListener("click", function () {
        jumpToHighlight(h);
      });
      ul.appendChild(li);
    });
  }
  function renderBmList() {
    var ul = $("#eb-bm-list");
    var bms = getBookmarks().slice().sort(function (a, b) { return b.time - a.time; });
    if (!bms.length) {
      ul.innerHTML = '<li class="eb-d-empty">还没有书签。点击顶栏「书签」可在当前阅读位置添加书签。</li>';
      return;
    }
    ul.innerHTML = "";
    bms.forEach(function (bm) {
      var ch = findChapter(bm.chapterId);
      var li = document.createElement("li");
      li.className = "eb-d-item";
      li.innerHTML =
        '<div class="eb-d-item-head">' +
        '<span class="eb-d-chapter">' + escHtml(bm.label || (ch ? chapterTitle(ch) : "")) + ' · ' + escHtml(ch ? chapterTitle(ch) : "") + '</span>' +
        '<button class="eb-d-del" title="删除书签">✕</button></div>' +
        (bm.preview ? '<div class="eb-d-text">' + escHtml(bm.preview) + '</div>' : '');
      li.querySelector(".eb-d-del").addEventListener("click", function (e) {
        e.stopPropagation();
        removeBookmark(bm.id);
      });
      li.style.cursor = "pointer";
      li.addEventListener("click", function () {
        jumpToBookmark(bm);
      });
      ul.appendChild(li);
    });
  }

  /* ---------- 高亮：选区 -> 记录 ---------- */
  /* 归一化选区文本（换行/空白 -> 单个空格） */
  function normalizeText(s) {
    return s.replace(/\s+/g, " ");
  }

  function getAnchorOffsetInBlock(range) {
    // 通过块映射反查：取 anchor 所在块的 data-text，用 DOM 计算偏移
    var node = range.startContainer;
    var el = node.nodeType === 3 ? node.parentElement : node;
    var blockEl = el && el.closest ? el.closest("[data-bidx]") : null;
    if (!blockEl) return null;
    var bidx = parseInt(blockEl.dataset.bidx, 10);
    // 计算 startContainer 在该块文本中的偏移
    var walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    var offset = 0;
    var n;
    while ((n = walker.nextNode())) {
      if (n === node) return { bidx: bidx, offset: offset + range.startOffset };
      offset += (n.textContent || "").length;
    }
    return { bidx: bidx, offset: offset };
  }

  /* 依据选区文本 + 锚点偏移，在章节文本拼接中定位，返回跨块记录 */
  function selectionToRecords(selText, anchor) {
    var chapter = findChapter(state.chapterId);
    if (!chapter) return null;
    var norm = normalizeText(selText);
    if (!norm) return null;
    var map = buildChapterMap(chapter);
    var text = map.text;
    var idx = text.indexOf(norm);
    if (idx < 0) return null; // 未找到（理论不应发生）
    // 若存在锚点（起始块），优先匹配离锚点最近的实例，避免重复文本定位错误
    if (anchor && anchor.bidx != null) {
      var blockStart = map.map[anchor.bidx] ? map.map[anchor.bidx].start : 0;
      var anchorPos = blockStart + (anchor.offset || 0);
      var searchFrom = Math.max(0, anchorPos - Math.floor(norm.length * 0.6));
      var near = text.indexOf(norm, searchFrom);
      if (near >= 0) idx = near;
    }
    var start = idx, end = idx + norm.length;
    var segs = [];
    for (var i = 0; i < map.map.length; i++) {
      var m = map.map[i];
      var s = Math.max(m.start, start);
      var e = Math.min(m.end, end);
      if (s < e) {
        var blockText = chapter.blocks.filter(function (b) {
          return (b.type === "para" || b.type === "note");
        })[m.bidx].text;
        segs.push({
          bidx: m.bidx,
          start: s - m.start,
          end: e - m.start,
          text: blockText.slice(s - m.start, e - m.start)
        });
      }
    }
    if (!segs.length) return null;
    return segs;
  }

  function addHighlights(segs, color) {
    var hls = getHighlights();
    var now = Date.now();
    var id = "hl" + now + Math.floor(Math.random() * 1e6);
    var rec = { id: id, chapterId: state.chapterId, color: color, time: now, segs: segs };
    // 重叠检测：与同章节同块已有记录冲突则跳过
    var overlap = false;
    segs.forEach(function (s) {
      hls.forEach(function (h) {
        if (h.chapterId !== state.chapterId) return;
        h.segs.forEach(function (hs) {
          if (hs.bidx === s.bidx && hs.start < s.end && s.start < hs.end) overlap = true;
        });
      });
    });
    if (overlap) {
      showFoot("该区域已有高亮，未重复标注。");
      return;
    }
    hls.push(rec);
    setHighlights(hls);
    reRenderCurrent();
    showFoot("已添加" + (segs.length > 1 ? "跨段" : "") + "高亮。");
  }

  function removeHighlight(id) {
    setHighlights(getHighlights().filter(function (h) { return h.id !== id; }));
    reRenderCurrent();
    renderHlList();
    showFoot("已删除高亮。");
  }

  function reRenderCurrent() {
    if (!state.chapterId) return;
    var ratio = getScrollRatio();
    renderChapter(findChapter(state.chapterId), ratio);
    renderHlList();
    updateProgressBar();
  }

  function jumpToHighlight(h) {
    loadChapter(h.chapterId, 0);
    setTimeout(function () {
      var els = $$("#eb-content [data-bidx]");
      var blockEl = null;
      for (var i = 0; i < els.length; i++) {
        if (parseInt(els[i].dataset.bidx, 10) === h.segs[0].bidx) { blockEl = els[i]; break; }
      }
      if (blockEl) blockEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    closeDrawers();
  }

  /* ---------- 书签 ---------- */
  function addBookmark() {
    var chapter = findChapter(state.chapterId);
    if (!chapter) return;
    var topBidx = getTopBidx();
    if (topBidx < 0) return;
    var blockEl = getBlockEl(topBidx);
    var blockText = blockEl ? (blockEl.dataset.text || "") : "";
    var label = prompt("书签名称（可留空，默认使用章节标题）：", "");
    if (label === null) return; // 用户取消
    label = label.trim() || chapterTitle(chapter);
    var bms = getBookmarks();
    // 同一块已有书签则提示
    var dup = bms.some(function (b) { return b.chapterId === state.chapterId && b.bidx === topBidx; });
    if (dup) { showFoot("该位置已有书签。"); return; }
    bms.push({
      id: "bm" + Date.now() + Math.floor(Math.random() * 1e6),
      chapterId: state.chapterId,
      bidx: topBidx,
      label: label,
      chapterTitle: chapterTitle(chapter),
      preview: blockText.slice(0, 40) + (blockText.length > 40 ? "…" : ""),
      time: Date.now()
    });
    setBookmarks(bms);
    reRenderCurrent();
    renderBmList();
    showFoot("已添加书签：「" + label + "」。");
  }
  function removeBookmark(id) {
    setBookmarks(getBookmarks().filter(function (b) { return b.id !== id; }));
    reRenderCurrent();
    renderBmList();
    showFoot("已删除书签。");
  }
  function jumpToBookmark(bm) {
    loadChapter(bm.chapterId, 0);
    setTimeout(function () {
      var el = getBlockEl(bm.bidx);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    closeDrawers();
  }
  function getBlockEl(bidx) {
    var els = $$("#eb-content [data-bidx]");
    for (var i = 0; i < els.length; i++) {
      if (parseInt(els[i].dataset.bidx, 10) === bidx) return els[i];
    }
    return null;
  }
  function getTopBidx() {
    var els = $$("#eb-content [data-bidx]");
    var best = -1, bestTop = 1e9;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.top > 80 && r.top < bestTop) { bestTop = r.top; best = parseInt(els[i].dataset.bidx, 10); }
    }
    return best >= 0 ? best : 0;
  }

  /* ---------- 阅读进度 ---------- */
  function getScrollRatio() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, window.scrollY / max));
  }
  function saveProgress() {
    if (!state.chapterId) return;
    var ratio = getScrollRatio();
    var prog = { chapterId: state.chapterId, ratio: ratio };
    setProgress(prog);
    state.scrollRatio = ratio;
    updateProgressBar();
  }
  function updateProgressBar() {
    var prog = getProgress();
    var pct = 0;
    if (prog && prog.chapterId) {
      var done = 0;
      var idx = chapterIndex(prog.chapterId);
      for (var i = 0; i < idx; i++) done += chapterTextLen(ALL[i].id);
      done += (prog.ratio || 0) * chapterTextLen(prog.chapterId);
      var total = totalTextLen();
      pct = total ? Math.round((done / total) * 100) : 0;
    }
    $("#eb-progress").textContent = pct + "%";
    var idx2 = chapterIndex(state.chapterId);
    $("#eb-foot-info").textContent = "第 " + (idx2 + 1) + " / " + ALL.length + " 节 · 全书 " + pct + "% · 划选文字添加高亮";
  }

  /* ---------- 字号 / 主题 ---------- */
  function applyPrefs() {
    var p = getPrefs();
    state.fontSize = p.fontSize || 17;
    state.theme = p.theme || "light";
    $("#eb-content").style.fontSize = state.fontSize + "px";
    document.body.classList.remove("eb-theme-light", "eb-theme-sepia", "eb-theme-dark");
    document.body.classList.add("eb-theme-" + state.theme);
  }
  function setFontSize(delta) {
    state.fontSize = Math.min(26, Math.max(13, state.fontSize + delta));
    var p = getPrefs();
    p.fontSize = state.fontSize;
    setPrefs(p);
    applyPrefs();
    showFoot("正文字号：" + state.fontSize + "px");
  }
  function cycleTheme() {
    var order = ["light", "sepia", "dark"];
    var idx = order.indexOf(state.theme);
    state.theme = order[(idx + 1) % order.length];
    var p = getPrefs();
    p.theme = state.theme;
    setPrefs(p);
    applyPrefs();
    showFoot("主题：" + ({ light: "浅色", sepia: "护眼暖色", dark: "深色" })[state.theme]);
  }

  /* ---------- 高亮操作菜单 ---------- */
  function showHlMenu(e, hlId) {
    var menu = $("#eb-hl-menu");
    menu.innerHTML =
      '<div class="eb-hl-menu-title">高亮颜色</div>' +
      '<div class="eb-hl-colors">' +
      '<span class="eb-hl-color" style="background:#ffe28a" data-color="yellow" title="黄色"></span>' +
      '<span class="eb-hl-color" style="background:#c8e6c9" data-color="green" title="绿色"></span>' +
      '<span class="eb-hl-color" style="background:#bbdefb" data-color="blue" title="蓝色"></span>' +
      '<span class="eb-hl-color" style="background:#f8bbd0" data-color="pink" title="粉色"></span>' +
      '</div>' +
      '<button class="eb-hl-del">删除此高亮</button>';
    menu.classList.remove("hidden");
    var x = Math.min(e.clientX, window.innerWidth - 160);
    var y = Math.min(e.clientY + 8, window.innerHeight - 130);
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.querySelectorAll(".eb-hl-color").forEach(function (c) {
      c.addEventListener("click", function () {
        changeHighlightColor(hlId, c.dataset.color);
        hideHlMenu();
      });
    });
    menu.querySelector(".eb-hl-del").addEventListener("click", function () {
      removeHighlight(hlId);
      hideHlMenu();
    });
  }
  function hideHlMenu() {
    var menu = $("#eb-hl-menu");
    menu.classList.add("hidden");
    menu.innerHTML = "";
  }
  function changeHighlightColor(id, color) {
    var hls = getHighlights();
    var rec = null;
    hls.forEach(function (h) { if (h.id === id) rec = h; });
    if (!rec) return;
    rec.color = color;
    setHighlights(hls);
    reRenderCurrent();
    showFoot("已更改高亮颜色。");
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    // 导航：进入电子书
    $$(".nav-btn").forEach(function (btn) {
      if (!btn.dataset.ebook) return;
      btn.addEventListener("click", function () {
        $$(".nav-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        document.body.classList.add("ebook-active");
        $("#ebook-module").classList.remove("hidden");
        renderShelf();
        renderToc();
        applyPrefs();
        if (state.chapterId) backToShelf();
        hideHlMenu();
        window.scrollTo(0, 0);
      });
    });
    // 点击原栏目按钮时退出电子书模式
    $$(".nav-btn").forEach(function (btn) {
      if (!btn.dataset.cat) return;
      btn.addEventListener("click", function () {
        document.body.classList.remove("ebook-active");
        $("#ebook-module").classList.add("hidden");
        closeDrawers();
        closeToc();
        hideHlMenu();
      });
    });

    // 书架/阅读导航
    $("#eb-back-site").addEventListener("click", function () {
      var active = $$(".nav-btn[data-cat]")[0];
      if (active) {
        $$(".nav-btn").forEach(function (b) { b.classList.remove("active"); });
        active.classList.add("active");
        active.click();
      } else {
        document.body.classList.remove("ebook-active");
        $("#ebook-module").classList.add("hidden");
      }
    });
    $("#eb-back-shelf").addEventListener("click", backToShelf);

    // 目录
    $("#eb-toc-toggle").addEventListener("click", function () {
      if (state.tocOpen) closeToc(); else openToc();
    });
    $("#eb-toc-close").addEventListener("click", closeToc);
    $("#eb-toc-mask").addEventListener("click", function () {
      if (state.drawerOpen) closeDrawers(); else closeToc();
    });

    // 抽屉
    $("#eb-highlight-btn").addEventListener("click", function () {
      if (state.drawerOpen === "hl") closeDrawers(); else openDrawer("hl");
    });
    $("#eb-bookmark-btn").addEventListener("click", function () {
      if (state.drawerOpen === "bm") closeDrawers(); else openDrawer("bm");
    });
    $("#eb-bm-add").addEventListener("click", function () { addBookmark(); });
    $("#eb-hl-close").addEventListener("click", closeDrawers);
    $("#eb-bm-close").addEventListener("click", closeDrawers);

    // 字号 / 主题
    $("#eb-font-dec").addEventListener("click", function () { setFontSize(-1); });
    $("#eb-font-inc").addEventListener("click", function () { setFontSize(1); });
    $("#eb-theme-toggle").addEventListener("click", cycleTheme);

    // 选区 -> 高亮菜单
    document.addEventListener("mouseup", function (e) {
      if (state.suppressSelect) return;
      if (!document.body.classList.contains("ebook-active")) return;
      if (!$("#eb-reader") || $("#eb-reader").classList.contains("hidden")) return;
      // 菜单内部点击不隐藏、不弹新菜单
      if (e.target && e.target.closest && e.target.closest(".eb-hl-menu")) return;
      if (e.target && e.target.closest && e.target.closest(".eb-hl,.eb-btn,.eb-toc,.eb-drawer,.eb-toc-mask")) {
        hideHlMenu();
        return;
      }
      setTimeout(function () {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) {
          hideHlMenu();
          return;
        }
        var range = sel.getRangeAt(0);
        var node = range.startContainer;
        var el = node.nodeType === 3 ? node.parentElement : node;
        if (!el || !el.closest || !el.closest("#eb-content")) { hideHlMenu(); return; }
        var rect = range.getBoundingClientRect();
        var menu = $("#eb-hl-menu");
        var anchor = getAnchorOffsetInBlock(range);
        menu.innerHTML =
          '<div class="eb-hl-menu-title">添加高亮</div>' +
          '<div class="eb-hl-colors">' +
          '<span class="eb-hl-color" style="background:#ffe28a" data-color="yellow" title="黄色"></span>' +
          '<span class="eb-hl-color" style="background:#c8e6c9" data-color="green" title="绿色"></span>' +
          '<span class="eb-hl-color" style="background:#bbdefb" data-color="blue" title="蓝色"></span>' +
          '<span class="eb-hl-color" style="background:#f8bbd0" data-color="pink" title="粉色"></span>' +
          '</div>';
        menu.classList.remove("hidden");
        var x = Math.min(Math.max(rect.left + rect.width / 2 - 70, 8), window.innerWidth - 160);
        var y = Math.max(rect.top - 52, 8);
        menu.style.left = x + "px";
        menu.style.top = y + "px";
        var selText = sel.toString();
        menu.querySelectorAll(".eb-hl-color").forEach(function (c) {
          c.addEventListener("click", function () {
            var segs = selectionToRecords(selText, anchor);
            if (segs) addHighlights(segs, c.dataset.color);
            hideHlMenu();
            sel.removeAllRanges();
          });
        });
      }, 20);
    }, true);

    // 点击已存在高亮 -> 操作菜单
    document.addEventListener("click", function (e) {
      var mk = e.target.closest(".eb-hl");
      if (mk) {
        e.preventDefault();
        e.stopPropagation();
        hideHlMenu();
        var hlId = mk.dataset.hlid;
        showHlMenu(e, hlId);
        return;
      }
      if (!e.target.closest(".eb-hl-menu")) {
        hideHlMenu();
      }
    }, true);

    // 点击页面空白关闭菜单（点击菜单内部时不隐藏）
    document.addEventListener("mousedown", function (e) {
      if (e.target && e.target.closest && e.target.closest(".eb-hl-menu")) return;
      hideHlMenu();
    }, true);

    // 滚动：保存进度 + 目录高亮
    var scrollTimer = null;
    window.addEventListener("scroll", function () {
      if (!document.body.classList.contains("ebook-active")) return;
      if ($("#eb-reader").classList.contains("hidden")) return;
      if (scrollTimer) return;
      scrollTimer = setTimeout(function () {
        scrollTimer = null;
        saveProgress();
        // 目录同步：当前章节不变，高亮当前章节即可
        if (state.tocOpen) renderTocActive(state.chapterId);
      }, 400);
    }, { passive: true });

    // 离开页面保存进度
    window.addEventListener("beforeunload", function () {
      saveProgress();
    });

    // 快捷键：Esc 关闭浮层
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        hideHlMenu();
        if (state.tocOpen) closeToc();
        if (state.drawerOpen) closeDrawers();
      }
    });
  }

  /* ---------- 底部提示 ---------- */
  var footTimer = null;
  function showFoot(msg) {
    $("#eb-foot-info").textContent = msg;
    if (footTimer) clearTimeout(footTimer);
    footTimer = setTimeout(function () {
      if (state.chapterId) updateProgressBar();
    }, 2500);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    applyPrefs();
    bindEvents();
    renderShelf();
    renderToc();
  }

  init();
})();
