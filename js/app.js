/* ============================================================
 * 每日阅读 · Daily Reading —— 核心交互逻辑
 * 功能：文章加载 / 高亮 / 划线 / 翻译 / 单词释义与应用 / 笔记 / 书签
 * 数据：localStorage 持久化
 * ============================================================ */
(function () {
  "use strict";

  /* ---------- 全局状态 ---------- */
  const CAT = { en: "en", zh: "zh" };
  let currentCat = CAT.en;
  let currentArticle = null; // {id,title,date,source,kind,content,cat}

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- 存储封装 ---------- */
  const store = {
    get(key, def) {
      try { return JSON.parse(localStorage.getItem(key)) ?? def; }
      catch (e) { return def; }
    },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  };
  const K = {
    hl: "dl_hl",
    ul: "dl_ul",
    notes: "dl_notes",
    bm: "dl_bookmarks"
  };

  /* ---------- 牛津词典 ---------- */
  // 网页版（Oxford Learner's Dictionaries）始终可用；
  // 若在 https://developer.oxforddictionaries.com/ 注册并在 OX_CONFIG 填入 appId/appKey，
  // 将优先调用牛津官方 API（注意其 CORS 限制，若被拦截会自动回退第三方词典）。
  const OX_CONFIG = { appId: "", appKey: "" };

  function oxLink(word) {
    const url = "https://www.oxfordlearnersdictionaries.com/definition/english/" +
      encodeURIComponent(word.toLowerCase().replace(/'/g, ""));
    return `<a class="ox-link" href="${url}" target="_blank" rel="noopener">在 Oxford 词典中查询 ↗</a>`;
  }

  function getSegs(key, aid) { return store.get(key, {})[aid] || []; }
  function setSegs(key, aid, segs) {
    const all = store.get(key, {});
    all[aid] = segs;
    store.set(key, all);
  }
  function getAllBookmarks() { return store.get(K.bm, []); }
  function setAllBookmarks(list) { store.set(K.bm, list); }

  /* ---------- 高亮/划线/笔记的区间渲染 ---------- */
  // 类别优先级：note > hl > ul > word
  const PRIO = { note: 3, hl: 2, ul: 1, word: 0 };

  function clsToTag(cls, key) {
    switch (cls) {
      case "hl":  return { open: `<mark class="hl" data-key="${key}">`, close: "</mark>" };
      case "ul":  return { open: `<span class="ul" data-key="${key}">`, close: "</span>" };
      case "note":return { open: `<span class="note-flag" data-key="${key}">`, close: "</span>" };
      case "word":return { open: `<span class="word-tap" data-word="${escAttr(key)}">`, close: "</span>" };
      default: return { open: "", close: "" };
    }
  }

  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  /* 从纯文本段落生成带标记的 HTML */
  function buildParagraphHTML(plain, hlSegs, ulSegs, noteSegs, isEn) {
    const ranges = [];
    // 单词区间（仅英文）
    if (isEn) {
      const re = /[A-Za-z][A-Za-z'-]{2,}/g;
      let m;
      while ((m = re.exec(plain)) !== null) {
        ranges.push({ start: m.index, end: m.index + m[0].length, cls: "word", key: m[0] });
      }
    }
    // 高亮/划线/笔记区间
    [[hlSegs, "hl"], [ulSegs, "ul"], [noteSegs, "note"]].forEach(([segs, cls]) => {
      segs.forEach((s) => {
        let idx = plain.indexOf(s.text);
        while (idx !== -1) {
          ranges.push({ start: idx, end: idx + s.text.length, cls, key: s.key });
          idx = plain.indexOf(s.text, idx + s.text.length);
        }
      });
    });
    // 合并重叠区间
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    ranges.forEach((r) => {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) {
        if (PRIO[r.cls] > PRIO[last.cls]) last.cls = r.cls;
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push({ start: r.start, end: r.end, cls: r.cls, key: r.key });
      }
    });
    // 在未转义文本上按偏移插入标签，再对非标签文本做转义
    return insertTags(plain, merged);
  }

  /* 在纯文本上插入标签，然后对非标签部分做 HTML 转义 */
  function insertTags(plain, merged) {
    // 生成 token 流：文本段 + 标签段
    const tokens = [];
    let cursor = 0;
    merged.forEach((r) => {
      if (r.start > cursor) tokens.push({ t: "text", v: plain.slice(cursor, r.start) });
      tokens.push({ t: "tag", v: clsToTag(r.cls, r.key).open });
      tokens.push({ t: "text", v: plain.slice(r.start, r.end) });
      tokens.push({ t: "tagc", v: clsToTag(r.cls, r.key).close });
      cursor = r.end;
    });
    if (cursor < plain.length) tokens.push({ t: "text", v: plain.slice(cursor) });
    return tokens.map((tk) => tk.t === "text" ? esc(tk.v) : tk.v).join("");
  }

  /* ---------- 文章渲染 ---------- */
  function renderArticleList() {
    const list = $("#article-list");
    list.innerHTML = "";
    const arts = currentCat === CAT.en ? EN_ARTICLES : ZH_ARTICLES;
    arts.forEach((a) => {
      const li = document.createElement("li");
      const badge = currentCat === CAT.zh ? a.kind : "雅思";
      li.innerHTML = `<span class="badge ${currentCat === CAT.zh ? "zh" : ""}">${esc(badge)}</span>` +
        esc(a.title) + `<span class="date">${a.date}</span>`;
      li.dataset.id = a.id;
      if (currentArticle && currentArticle.id === a.id) li.classList.add("active");
      li.addEventListener("click", () => loadArticle(a.id));
      list.appendChild(li);
    });
    const tip = $("#daily-update-tip");
    tip.textContent = currentCat === CAT.en
      ? "雅思英语文章每日 09:30 自动更新一篇。"
      : "中文读写 · 短篇小说与散文。";
  }

  function getArticle(id) {
    const en = EN_ARTICLES.find((x) => x.id === id);
    if (en) return { ...en, cat: CAT.en };
    const zh = ZH_ARTICLES.find((x) => x.id === id);
    if (zh) return { ...zh, cat: CAT.zh };
    return null;
  }

  function loadArticle(id, scrollToPidx) {
    const art = getArticle(id);
    if (!art) return;
    currentArticle = art;
    $("#reader-title").textContent = art.title;
    const metaLink = art.link
      ? `<a class="meta-link" href="${escAttr(art.link)}" target="_blank" rel="noopener">官方来源 ↗</a>`
      : "";
    $("#reader-meta").innerHTML =
      `<span>${art.date}</span>` +
      (art.author ? `<span class="meta-author">${esc(art.author)}</span>` : "") +
      (art.book ? `<span class="meta-book">${esc(art.book)}</span>` : "") +
      (art.source ? `<span>${esc(art.source)}</span>` : "") +
      (art.kind ? `<span>${esc(art.kind)}</span>` : "") +
      (metaLink ? `<span>${metaLink}</span>` : "") +
      `<span id="bookmark-this-wrap">☆</span>`;
    const body = $("#article-body");
    body.className = "article-body " + (art.cat === CAT.en ? "en" : "zh");
    body.innerHTML = "";

    const hlAll = getSegs(K.hl, art.id);
    const ulAll = getSegs(K.ul, art.id);
    const noteAll = getSegs(K.notes, art.id);

    art.content.forEach((para, pidx) => {
      const hlSegs = hlAll.filter((s) => s.pidx === pidx);
      const ulSegs = ulAll.filter((s) => s.pidx === pidx);
      const noteSegs = noteAll.filter((s) => s.pidx === pidx);
      const p = document.createElement("p");
      p.dataset.pidx = pidx;
      p.innerHTML = buildParagraphHTML(para, hlSegs, ulSegs, noteSegs, art.cat === CAT.en);
      // 段落书签按钮
      const bm = document.createElement("span");
      bm.className = "para-bookmark";
      bm.title = "收藏此段";
      bm.textContent = "书签";
      bm.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleParagraphBookmark(art, pidx, para.slice(0, 60));
      });
      p.appendChild(bm);
      body.appendChild(p);
    });

    renderArticleList();
    updateCounts();
    updateBookmarkThisBtn();
    if (scrollToPidx !== undefined) {
      const target = body.querySelector(`p[data-pidx="${scrollToPidx}"]`);
      if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); flashPara(target); }
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  function flashPara(el) {
    el.style.transition = "background .8s";
    el.style.background = "#fff3c4";
    setTimeout(() => { el.style.background = ""; }, 1200);
  }

  /* ---------- 计数与书签按钮 ---------- */
  function updateCounts() {
    const bms = getAllBookmarks();
    $("#bookmark-count").textContent = bms.length;
    $("#note-count").textContent = currentArticle
      ? getSegs(K.notes, currentArticle.id).length
      : 0;
  }

  function updateBookmarkThisBtn() {
    const wrap = $("#bookmark-this-wrap");
    if (!wrap || !currentArticle) return;
    const bms = getAllBookmarks();
    const exists = bms.some((b) => b.articleId === currentArticle.id && b.pidx === undefined);
    wrap.innerHTML = exists ? "★" : "☆";
    wrap.style.cursor = "pointer";
    wrap.style.fontSize = "18px";
    wrap.onclick = () => toggleArticleBookmark(currentArticle);
  }

  function toggleArticleBookmark(art) {
    const list = getAllBookmarks();
    const idx = list.findIndex((b) => b.articleId === art.id && b.pidx === undefined);
    if (idx >= 0) list.splice(idx, 1);
    else list.unshift({ articleId: art.id, cat: art.cat, title: art.title, pidx: undefined, time: Date.now() });
    setAllBookmarks(list);
    updateBookmarkThisBtn();
    updateCounts();
  }

  function toggleParagraphBookmark(art, pidx, text) {
    const list = getAllBookmarks();
    const idx = list.findIndex((b) => b.articleId === art.id && b.pidx === pidx);
    if (idx >= 0) list.splice(idx, 1);
    else list.unshift({ articleId: art.id, cat: art.cat, title: art.title, pidx, text, time: Date.now() });
    setAllBookmarks(list);
    updateCounts();
  }

  /* ---------- 浮动工具条（选中文字） ---------- */
  const toolbar = $("#float-toolbar");
  let lastSelection = null;

  function showToolbar(x, y, sel) {
    toolbar.classList.remove("hidden");
    toolbar.style.left = x + "px";
    toolbar.style.top = y + "px";
    lastSelection = sel;
  }
  function hideToolbar() {
    toolbar.classList.add("hidden");
    lastSelection = null;
  }

  document.addEventListener("mouseup", (e) => {
    // 点击已标记元素时不弹工具条
    if (e.target.closest("mark.hl,.ul,.note-flag,.para-bookmark,.word-tap,.ft-btn,.icon-btn,.nav-btn,.panel-tab,.article-list li,.bookmark-list li")) {
      hideToolbar();
      return;
    }
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) { hideToolbar(); return; }
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const bodyEl = container.nodeType === 1 ? container : container.parentElement;
      if (!bodyEl || !bodyEl.closest("#article-body")) { hideToolbar(); return; }
      const rect = range.getBoundingClientRect();
      let x = rect.left + rect.width / 2 - 110;
      x = Math.max(8, Math.min(window.innerWidth - 240, x));
      const y = Math.max(8, rect.top - 44);
      showToolbar(x, y, sel);
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest(".float-toolbar")) e.preventDefault();
    else hideToolbar();
  });
  document.addEventListener("scroll", hideToolbar, true);

  /* ---------- 工具条动作 ---------- */
  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".ft-btn");
    if (!btn) return;
    const action = btn.dataset.action;
    const sel = lastSelection || window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    const pEl = getSelectionPara(sel);
    if (!pEl) return;
    const pidx = parseInt(pEl.dataset.pidx, 10);
    const art = currentArticle;
    switch (action) {
      case "highlight": addSegment(K.hl, art, pidx, text, null); break;
      case "underline": addSegment(K.ul, art, pidx, text, null); break;
      case "note": openNoteModal(art, pidx, text); break;
      case "translate": openTranslateModal(text); break;
      case "word": queryWord(text.split(/\s+/)[0]); break;
    }
    hideToolbar();
    sel.removeAllRanges();
  });

  function getSelectionPara(sel) {
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    return node.closest ? node.closest("p[data-pidx]") : null;
  }

  function addSegment(key, art, pidx, text, extra) {
    const segs = getSegs(key, art.id);
    const seg = { key: "k" + Date.now() + Math.floor(Math.random() * 1e6), pidx, text, ...extra };
    segs.push(seg);
    setSegs(key, art.id, segs);
    loadArticle(art.id, pidx);
  }

  /* 点击高亮/划线/笔记片段 */
  document.addEventListener("click", (e) => {
    const hl = e.target.closest("mark.hl");
    if (hl) {
      e.preventDefault(); e.stopPropagation();
      removeSegment(K.hl, currentArticle.id, hl.dataset.key);
      return;
    }
    const ul = e.target.closest(".ul");
    if (ul) {
      e.preventDefault(); e.stopPropagation();
      removeSegment(K.ul, currentArticle.id, ul.dataset.key);
      return;
    }
    const nf = e.target.closest(".note-flag");
    if (nf) {
      e.preventDefault(); e.stopPropagation();
      const seg = getSegs(K.notes, currentArticle.id).find((s) => s.key === nf.dataset.key);
      if (seg) openNoteViewModal(seg);
      return;
    }
    const wt = e.target.closest(".word-tap");
    if (wt) {
      e.preventDefault(); e.stopPropagation();
      queryWord(wt.dataset.word);
      return;
    }
  });

  function removeSegment(key, aid, k) {
    const segs = getSegs(key, aid).filter((s) => s.key !== k);
    setSegs(key, aid, segs);
    if (currentArticle && currentArticle.id === aid) loadArticle(aid);
  }

  /* ---------- 翻译（MyMemory 免费 API） ---------- */
  async function openTranslateModal(text) {
    $("#translate-source").textContent = text;
    $("#translate-result").textContent = "翻译中…";
    showModal("translate-modal");
    try {
      const langpair = currentArticle && currentArticle.cat === CAT.zh ? "zh-CN|en" : "en|zh-CN";
      const url = "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(text) + "&langpair=" + langpair;
      const resp = await fetch(url);
      const data = await resp.json();
      const translated = (data.responseData && data.responseData.translatedText) || "";
      $("#translate-result").textContent = translated || "（未能获取翻译结果，请检查网络）";
    } catch (err) {
      $("#translate-result").textContent = "翻译服务暂不可用，请检查网络连接。";
    }
  }

  /* ---------- 单词释义与应用 ---------- */
  async function queryWord(word) {
    if (!word) return;
    const clean = word.replace(/[^A-Za-z'-]/g, "");
    if (!clean) return;
    const modal = $("#word-modal");
    const detail = $("#word-detail");
    showModal("word-modal");
    detail.innerHTML = `<div class="wd-head"><span class="wd-word">${esc(clean)}</span><span class="wd-phon">查询中…</span></div>`;

    // 1) 优先本地词库（含中文释义 + 应用示例）
    const local = EN_VOCAB[clean.toLowerCase()];
    if (local) {
      renderWordDetail(detail, clean, local.phon, local.pos, local.def, local.use);
      $("#word-result").innerHTML = detail.innerHTML;
      return;
    }
    // 2) 牛津官方 API（需在 OX_CONFIG 填入 appId/appKey；CORS 受限时自动回退）
    if (OX_CONFIG.appId && OX_CONFIG.appKey) {
      try {
        const url = "https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/" +
          encodeURIComponent(clean) + "?fields=definitions,examples,pronunciations&strictMatch=false";
        const res = await fetch(url, { headers: { app_id: OX_CONFIG.appId, app_key: OX_CONFIG.appKey } });
        if (res.ok) {
          const data = await res.json();
          detail.innerHTML = oxHtmlFromData(data, clean);
          $("#word-result").innerHTML = detail.innerHTML;
          return;
        }
      } catch (e) { /* 回退到第三方在线词典 */ }
    }
    // 3) 第三方在线词典（dictionaryapi.dev）兜底
    try {
      const resp = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(clean));
      if (!resp.ok) throw new Error("not found");
      const data = await resp.json();
      const entry = data[0];
      const phon = (entry.phonetic) || (entry.phonetics && entry.phonetics.find((p) => p.text)?.text) || "";
      const meanings = entry.meanings || [];
      let html = `<div class="wd-head"><span class="wd-word">${esc(clean)}</span><span class="wd-phon">${esc(phon || "")}</span></div>` + oxLink(clean);
      const uses = [];
      meanings.slice(0, 3).forEach((m) => {
        (m.definitions || []).slice(0, 2).forEach((d) => {
          html += `<div class="wd-meaning"><span class="pos">${esc(m.partOfSpeech)}</span><span class="def">${esc(d.definition || "")}</span></div>`;
          if (d.example) uses.push([d.example, ""]);
        });
      });
      if (uses.length) {
        html += `<div class="wd-use"><h5>实际应用 Examples</h5>` +
          uses.map((u) => `<div class="use-item"><div class="use-en">${esc(u[0])}</div>${u[1] ? `<div class="use-zh">${esc(u[1])}</div>` : ""}</div>`).join("") +
          `</div>`;
      }
      detail.innerHTML = html || `<div class="wd-fallback">未找到释义。</div>`;
      $("#word-result").innerHTML = detail.innerHTML;
    } catch (err) {
      detail.innerHTML = `<div class="wd-fallback">在线词典暂不可用，本地词库未收录该词。建议联网重试。</div>`;
      $("#word-result").innerHTML = detail.innerHTML;
    }
  }

  /* 将牛津官方 API 响应渲染为详情（词性 / 短释义 / 例句） */
  function oxHtmlFromData(data, word) {
    const res = data && data.results && data.results[0];
    if (!res) return `<div class="wd-fallback">牛津词典未收录该词。</div>`;
    const lex = res.lexicalEntries || [];
    const prons = [];
    lex.forEach((l) => (l.entries || []).forEach((en) => (en.pronunciations || []).forEach((p) => prons.push(p))));
    const phon = (prons.find((p) => p.phoneticSpelling) || {}).phoneticSpelling || "";
    let html = `<div class="wd-head"><span class="wd-word">${esc(word)}</span><span class="wd-phon">${esc(phon || "")}</span></div>` + oxLink(word);
    const uses = [];
    lex.slice(0, 3).forEach((l) => {
      const cat = l.lexicalCategory;
      const pos = (cat && (cat.text || cat.id)) || "";
      (l.entries || []).forEach((en) => {
        (en.senses || []).slice(0, 3).forEach((s) => {
          const def = (s.shortDefinitions && s.shortDefinitions[0]) || (s.definitions && s.definitions[0]) || "";
          if (def) html += `<div class="wd-meaning"><span class="pos">${esc(pos)}</span><span class="def">${esc(def)}</span></div>`;
          (s.examples || []).slice(0, 1).forEach((ex) => { if (ex.text) uses.push([ex.text, ""]); });
        });
      });
    });
    if (uses.length) {
      html += `<div class="wd-use"><h5>实际应用 Examples（Oxford）</h5>` +
        uses.map((u) => `<div class="use-item"><div class="use-en">${esc(u[0])}</div></div>`).join("") +
        `</div>`;
    }
    return html || `<div class="wd-fallback">牛津词典未收录该词。</div>`;
  }

  function renderWordDetail(detail, word, phon, pos, def, uses) {
    detail.innerHTML =
      `<div class="wd-head"><span class="wd-word">${esc(word)}</span><span class="wd-phon">${esc(phon || "")}</span></div>` +
      oxLink(word) +
      `<div class="wd-meaning"><span class="pos">${esc(pos || "")}</span><span class="def">${esc(def || "")}</span></div>` +
      (uses && uses.length ? `<div class="wd-use"><h5>实际应用 Examples</h5>` +
        uses.map((u) => `<div class="use-item"><div class="use-en">${esc(u[0])}</div><div class="use-zh">${esc(u[1] || "")}</div></div>`).join("") +
        `</div>` : "");
  }

  /* ---------- 笔记 ---------- */
  function openNoteModal(art, pidx, text) {
    $("#note-source").textContent = text;
    $("#note-input").value = "";
    $("#note-save").onclick = () => {
      const note = $("#note-input").value.trim();
      if (!note) { alert("请输入笔记内容"); return; }
      addSegment(K.notes, art, pidx, text, { note });
      closeModal("note-modal");
      switchPanel("note");
    };
    showModal("note-modal");
    setTimeout(() => $("#note-input").focus(), 50);
  }

  function openNoteViewModal(seg) {
    $("#note-source").textContent = seg.text;
    $("#note-input").value = seg.note || "";
    $("#note-save").onclick = () => {
      const note = $("#note-input").value.trim();
      const segs = getSegs(K.notes, currentArticle.id);
      const s = segs.find((x) => x.key === seg.key);
      if (s) { s.note = note; setSegs(K.notes, currentArticle.id, segs); }
      closeModal("note-modal");
      loadArticle(currentArticle.id);
    };
    showModal("note-modal");
  }

  /* ---------- 侧栏面板 ---------- */
  function switchPanel(name) {
    $$(".panel-tab").forEach((t) => t.classList.toggle("active", t.dataset.panel === name));
    ["word", "note", "bookmark"].forEach((p) => {
      $("#panel-" + p).classList.toggle("hidden", p !== name);
    });
    if (name === "note") renderNotes();
    if (name === "bookmark") renderBookmarks();
  }
  $$(".panel-tab").forEach((t) => t.addEventListener("click", () => switchPanel(t.dataset.panel)));

  function renderNotes() {
    const ul = $("#note-list");
    ul.innerHTML = "";
    if (!currentArticle) { ul.innerHTML = "<li>请先选择一篇文章</li>"; return; }
    const segs = getSegs(K.notes, currentArticle.id);
    if (!segs.length) { ul.innerHTML = "<li style='color:var(--muted)'>暂无笔记</li>"; return; }
    segs.slice().reverse().forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="nq">${esc(s.text.slice(0, 60))}</span><span class="nt">${esc(s.note || "")}</span>` +
        `<span class="nx" title="删除笔记">✕</span>`;
      li.querySelector(".nx").onclick = (e) => {
        e.stopPropagation();
        removeSegment(K.notes, currentArticle.id, s.key);
        renderNotes();
      };
      li.style.cursor = "pointer";
      li.onclick = () => loadArticle(currentArticle.id, s.pidx);
      ul.appendChild(li);
    });
  }

  function renderBookmarks() {
    const ul = $("#bookmark-list");
    ul.innerHTML = "";
    const list = getAllBookmarks();
    if (!list.length) { ul.innerHTML = "<li style='color:var(--muted)'>暂无书签</li>"; return; }
    list.forEach((b) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="bq">${b.pidx !== undefined ? "段落 · " : ""}${esc(b.title)}</span>` +
        (b.text ? `<span class="bq">${esc(b.text)}</span>` : "") +
        `<span class="bx" title="删除书签">✕</span>`;
      li.querySelector(".bx").onclick = (e) => {
        e.stopPropagation();
        setAllBookmarks(list.filter((x) => !(x.articleId === b.articleId && x.pidx === b.pidx)));
        renderBookmarks();
        updateCounts();
      };
      li.onclick = () => loadArticle(b.articleId, b.pidx);
      ul.appendChild(li);
    });
  }

  /* ---------- 弹层管理 ---------- */
  function showModal(id) { $("#" + id).classList.remove("hidden"); }
  function closeModal(id) { $("#" + id).classList.add("hidden"); }
  ["translate-close", "word-close", "note-close"].forEach((id) => {
    $("#" + id).addEventListener("click", () => closeModal(id.replace("-close", "-modal")));
  });
  $$(".modal-mask").forEach((mask) => {
    mask.addEventListener("click", (e) => { if (e.target === mask) mask.classList.add("hidden"); });
  });

  /* ---------- 顶栏导航 ---------- */
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentCat = btn.dataset.cat;
      const defaultId = currentCat === CAT.en
        ? EN_ARTICLES[0].id
        : ZH_ARTICLES[0].id;
      loadArticle(defaultId);
    });
  });

  $("#btn-bookmarks").addEventListener("click", () => switchPanel("bookmark"));
  $("#btn-notes").addEventListener("click", () => switchPanel("note"));

  /* ---------- 启动 ---------- */
  renderArticleList();
  loadArticle(EN_ARTICLES[0].id);
  updateCounts();
  window.addEventListener("resize", hideToolbar);
})();
