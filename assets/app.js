/*
 * 欲しいもの整理アプリ — メインロジック。
 * 依存なし・ブラウザのみ。データは localStorage に保存する。
 */
(function () {
  "use strict";

  const CAT = window.WishlistCategories;
  const STORE_KEY = "wishlist-organizer/items/v1";
  const PREF_KEY = "wishlist-organizer/prefs/v1";

  /** @typedef {{
   *  id:string, title:string, price:number|null, url:string, image:string,
   *  category:string, priority:number, note:string, purchased:boolean,
   *  added:number, priceHistory:{price:number,date:number}[]
   * }} Item */

  /** @type {Item[]} */
  let items = [];
  let prefs = { view: "grouped", sort: "added-desc", hidePurchased: false, theme: "light" };
  let editingId = null;   // アイテム編集中の id
  let priceItemId = null; // 価格モーダルで表示中の id

  // ---------- 永続化 ----------
  function load() {
    try {
      items = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      if (!Array.isArray(items)) items = [];
    } catch { items = []; }
    try {
      Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || "{}"));
    } catch { /* ignore */ }
  }
  function saveItems() { localStorage.setItem(STORE_KEY, JSON.stringify(items)); }
  function savePrefs() { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }

  // ---------- ユーティリティ ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const yen = (n) => (n == null || isNaN(n)) ? "—" : "¥" + Number(n).toLocaleString("ja-JP");
  const PRIORITY_LABEL = { 3: "高", 2: "中", 1: "低" };

  // Amazon 欲しいものリスト抽出スクリプト（コンソール貼り付け用）。
  // 詳細版は tools/extract-wishlist.js にあり、これはコピーボタン用の同等版。
  const EXTRACTOR_SRC = `/* Amazon 欲しいものリスト抽出スクリプト — 欲しいもの整理アプリ用 */
(async function(){"use strict";const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function loadAll(){let last=-1;for(let i=0;i<60;i++){const items=document.querySelectorAll('#g-items > li, ul[id="g-items"] > li');window.scrollTo(0,document.body.scrollHeight);await sleep(700);const done=document.querySelector('#endOfListMarker');const c=items.length;if(done&&c===last)break;if(c===last&&i>1)break;last=c;}window.scrollTo(0,0);}
function price(t){if(!t)return null;const m=t.replace(/,/g,'').match(/[¥￥]?\\s*(\\d+)(?:\\s*円)?/);return m?Number(m[1]):null;}
function abs(h){if(!h)return'';try{return new URL(h,location.origin).href.split('?')[0];}catch(e){return h;}}
function txt(n){if(!n)return'';return((n.getAttribute&&n.getAttribute('title'))||n.textContent||'').trim();}
function pick(el){try{const t=el.querySelector('a[id^="itemName_"]')||el.querySelector('h2 a[href], h3 a[href]')||el.querySelector('a.a-link-normal[title][href]')||el.querySelector('a[href*="/dp/"]');let title=txt(t);if(!title)title=txt(el.querySelector('[id^="itemName_"]'));const url=abs(t&&t.getAttribute('href'));const p=el.querySelector('[id^="itemPrice_"] .a-offscreen')||el.querySelector('.a-price .a-offscreen')||el.querySelector('[id^="itemPrice_"]')||el.querySelector('.a-color-price');const price_=price(p&&p.textContent);const img=el.querySelector('img');const image=img?(img.getAttribute('src')||''):'';if(!title)return null;return{title:title,price:price_,url:url,image:image};}catch(e){return null;}}
console.log('%c欲しいものリストを読み込み中…','font-size:14px;color:#146eb4');await loadAll();
const nodes=document.querySelectorAll('#g-items > li, ul[id="g-items"] > li');const items=[];nodes.forEach(el=>{const it=pick(el);if(it)items.push(it);});
if(!items.length){console.warn('商品が見つかりませんでした。欲しいものリストのページで、ページを再読み込みしてから再実行してください。');return;}
const json=JSON.stringify(items,null,2);window.__wishlistData=json;let copied=false;try{if(typeof copy==='function'){copy(json);copied=true;}}catch(e){}if(!copied){try{await navigator.clipboard.writeText(json);copied=true;}catch(e){}}
if(copied){console.log('%c✅ '+items.length+'件を抽出しクリップボードにコピーしました！アプリの［取り込み→JSON］に貼り付けてください。','font-size:14px;color:#1e7e34;font-weight:bold');}else{console.log('%c✅ '+items.length+'件を抽出しました。次の1行でコピー →  copy(__wishlistData)','font-size:14px;color:#a9700a;font-weight:bold');}
console.log(json);console.table(items.map(i=>({title:i.title.slice(0,40),price:i.price})));return items;})();`;

  // Amazon URL から ASIN(10桁) を抽出。
  function extractAsin(url) {
    if (!url) return null;
    const m = String(url).match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|\/dp\/product\/|\/ASIN\/)([A-Z0-9]{10})/i)
      || String(url).match(/[/?&](?:asin|ASIN)=([A-Z0-9]{10})/)
      || String(url).match(/\b(B0[A-Z0-9]{8})\b/);
    return m ? m[1].toUpperCase() : null;
  }
  // Keepa（日本ドメイン=5）と camelcamelcamel(日本) の価格履歴 URL。
  function keepaUrl(asin) { return "https://keepa.com/#!product/5-" + asin; }
  function camelUrl(asin) { return "https://jp.camelcamelcamel.com/product/" + asin; }

  // 買い時判定：価格履歴から最安値と現在値を比較。
  function buyAdvice(item) {
    const hist = (item.priceHistory || []).filter((h) => h.price != null && !isNaN(h.price));
    const cur = item.price;
    if (cur == null || isNaN(cur)) return null;
    if (hist.length < 2) return { level: "info", text: "履歴を集めると判定できます", min: null };
    const prices = hist.map((h) => h.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (max === min) return { level: "info", text: "価格変動なし", min };
    // 現在値が最安値の +2% 以内なら買い時
    if (cur <= min * 1.02) return { level: "buy", text: "買い時！ ほぼ最安値", min };
    const dropPct = Math.round(((cur - min) / cur) * 100);
    if (cur >= max * 0.98) return { level: "wait", text: "高値圏。値下がり待ち", min };
    return { level: "watch", text: `あと約${dropPct}%下がると最安値`, min };
  }

  // 価格を履歴に記録（同日同額の重複は避ける）。
  function recordPrice(item, price) {
    if (price == null || isNaN(price)) return;
    item.priceHistory = item.priceHistory || [];
    const last = item.priceHistory[item.priceHistory.length - 1];
    if (last && last.price === price) return;
    item.priceHistory.push({ price: Number(price), date: Date.now() });
  }

  // ---------- アイテム操作 ----------
  function makeItem(data) {
    const price = data.price != null && data.price !== "" ? Number(data.price) : null;
    const item = {
      id: uid(),
      title: (data.title || "").trim(),
      price,
      url: (data.url || "").trim(),
      image: (data.image || "").trim(),
      category: data.category || CAT.categorize(data.title),
      priority: Number(data.priority) || 2,
      note: (data.note || "").trim(),
      purchased: !!data.purchased,
      added: data.added || Date.now(),
      priceHistory: [],
    };
    if (price != null) item.priceHistory.push({ price, date: item.added });
    return item;
  }

  function findExisting(data) {
    const asin = extractAsin(data.url);
    const title = (data.title || "").trim().toLowerCase();
    return items.find((it) => {
      if (asin && extractAsin(it.url) === asin) return true;
      if (title && it.title.trim().toLowerCase() === title) return true;
      return false;
    });
  }

  // 取り込み時のマージ：既存があれば価格履歴を追記、なければ追加。
  function upsert(data) {
    const existing = findExisting(data);
    if (existing) {
      const p = data.price != null && data.price !== "" ? Number(data.price) : null;
      if (p != null && p !== existing.price) {
        existing.price = p;
        recordPrice(existing, p);
      }
      if (!existing.image && data.image) existing.image = data.image;
      if (!existing.url && data.url) existing.url = data.url;
      return { added: false };
    }
    items.push(makeItem(data));
    return { added: true };
  }

  // ---------- レンダリング ----------
  function visibleItems() {
    const q = $("#search").value.trim().toLowerCase();
    const catFilter = $("#filter-category").value;
    let list = items.slice();
    if (prefs.hidePurchased) list = list.filter((it) => !it.purchased);
    if (catFilter && catFilter !== "all") list = list.filter((it) => it.category === catFilter);
    if (q) list = list.filter((it) => (it.title + " " + it.note).toLowerCase().includes(q));
    return sortItems(list);
  }

  function sortItems(list) {
    const s = prefs.sort;
    const byNum = (a, b, k, dir) => ((a[k] ?? 0) - (b[k] ?? 0)) * dir;
    switch (s) {
      case "added-asc": return list.sort((a, b) => byNum(a, b, "added", 1));
      case "price-desc": return list.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
      case "price-asc": return list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      case "priority": return list.sort((a, b) => b.priority - a.priority || byNum(a, b, "added", -1));
      case "name": return list.sort((a, b) => a.title.localeCompare(b.title, "ja"));
      case "added-desc":
      default: return list.sort((a, b) => byNum(a, b, "added", -1));
    }
  }

  function sparkline(hist) {
    const pts = (hist || []).filter((h) => h.price != null);
    if (pts.length < 2) return "";
    const w = 120, h = 28, pad = 2;
    const prices = pts.map((p) => p.price);
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min || 1;
    const step = (w - pad * 2) / (pts.length - 1);
    const coords = pts.map((p, i) => {
      const x = pad + i * step;
      const y = pad + (h - pad * 2) * (1 - (p.price - min) / range);
      return [x, y];
    });
    const d = coords.map((c, i) => (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1)).join(" ");
    const last = coords[coords.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" fill="currentColor"/>
    </svg>`;
  }

  function itemCard(it) {
    const cat = CAT.getCategory(it.category);
    const asin = extractAsin(it.url);
    const advice = buyAdvice(it);
    const priceLinks = asin ? `
      <a class="chip chip-link" href="${keepaUrl(asin)}" target="_blank" rel="noopener" title="Keepaで価格推移">📈 Keepa</a>
      <a class="chip chip-link" href="${camelUrl(asin)}" target="_blank" rel="noopener" title="camelcamelcamelで価格推移">🐫 Camel</a>` : "";
    const adviceBadge = advice ? `<span class="advice advice-${advice.level}">${esc(advice.text)}</span>` : "";
    const img = it.image
      ? `<img class="thumb" src="${esc(it.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="thumb thumb-ph">${cat.icon}</div>`;
    const titleHtml = it.url
      ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
      : esc(it.title);
    return `
    <article class="card ${it.purchased ? "is-purchased" : ""}" data-id="${it.id}">
      <div class="card-thumb">${img}</div>
      <div class="card-main">
        <div class="card-top">
          <span class="badge" style="--c:${catColor(it.category)}">${cat.icon} ${esc(cat.name)}</span>
          <span class="prio prio-${it.priority}" title="優先度">${PRIORITY_LABEL[it.priority]}</span>
        </div>
        <h3 class="card-title">${titleHtml}</h3>
        ${it.note ? `<p class="card-note">${esc(it.note)}</p>` : ""}
        <div class="card-price-row">
          <span class="price">${yen(it.price)}</span>
          ${sparkline(it.priceHistory)}
          ${adviceBadge}
        </div>
        <div class="card-links">
          ${priceLinks}
          <button class="chip" data-act="price" title="価格を記録・確認">💰 価格</button>
        </div>
      </div>
      <div class="card-actions">
        <label class="buy-check" title="購入済み">
          <input type="checkbox" data-act="purchased" ${it.purchased ? "checked" : ""}>
          <span>済</span>
        </label>
        <button class="icon-btn" data-act="edit" title="編集">✏️</button>
        <button class="icon-btn" data-act="delete" title="削除">🗑️</button>
      </div>
    </article>`;
  }

  // カテゴリ id から安定した色を割り当て。
  function catColor(id) {
    const idx = Math.max(0, CAT.list.findIndex((c) => c.id === id));
    const hue = (idx * 47) % 360;
    return `hsl(${hue} 62% 45%)`;
  }

  function render() {
    const root = $("#list-root");
    const list = visibleItems();
    const empty = $("#empty-state");

    if (items.length === 0) {
      root.innerHTML = "";
      empty.classList.remove("hidden");
    } else {
      empty.classList.add("hidden");
    }

    if (prefs.view === "grouped") {
      root.innerHTML = renderGrouped(list);
    } else {
      root.innerHTML = list.length
        ? `<div class="grid">${list.map(itemCard).join("")}</div>`
        : (items.length ? `<p class="no-match">条件に合うアイテムがありません。</p>` : "");
    }
    renderStats();
    renderCategoryFilter();
  }

  function renderGrouped(list) {
    if (!list.length) return items.length ? `<p class="no-match">条件に合うアイテムがありません。</p>` : "";
    const groups = new Map();
    for (const it of list) {
      if (!groups.has(it.category)) groups.set(it.category, []);
      groups.get(it.category).push(it);
    }
    // カテゴリ定義順で並べる
    const ordered = CAT.list.filter((c) => groups.has(c.id));
    return ordered.map((cat) => {
      const g = groups.get(cat.id);
      const subtotal = g.reduce((s, it) => s + (it.price || 0), 0);
      return `
      <section class="cat-group">
        <header class="cat-head" style="--c:${catColor(cat.id)}">
          <span class="cat-name">${cat.icon} ${esc(cat.name)}</span>
          <span class="cat-meta">${g.length}件 ・ 合計 ${yen(subtotal)}</span>
        </header>
        <div class="grid">${g.map(itemCard).join("")}</div>
      </section>`;
    }).join("");
  }

  function renderStats() {
    const total = items.length;
    const active = items.filter((it) => !it.purchased);
    const sum = active.reduce((s, it) => s + (it.price || 0), 0);
    const cats = new Set(items.map((it) => it.category)).size;
    const buyNow = items.filter((it) => { const a = buyAdvice(it); return a && a.level === "buy" && !it.purchased; }).length;
    $("#stats-bar").innerHTML = `
      <div class="stat"><span class="stat-num">${total}</span><span class="stat-label">アイテム</span></div>
      <div class="stat"><span class="stat-num">${cats}</span><span class="stat-label">カテゴリ</span></div>
      <div class="stat"><span class="stat-num">${yen(sum)}</span><span class="stat-label">未購入の合計</span></div>
      <div class="stat ${buyNow ? "stat-hot" : ""}"><span class="stat-num">${buyNow}</span><span class="stat-label">買い時🔥</span></div>`;
  }

  function renderCategoryFilter() {
    const sel = $("#filter-category");
    const cur = sel.value || "all";
    const counts = {};
    for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
    const used = CAT.list.filter((c) => counts[c.id]);
    sel.innerHTML = `<option value="all">すべてのカテゴリ (${items.length})</option>` +
      used.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)} (${counts[c.id]})</option>`).join("");
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "all";
  }

  // 追加/編集フォームのカテゴリ選択肢
  function fillCategorySelect(sel) {
    sel.innerHTML = CAT.list.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join("");
  }

  // ---------- モーダル ----------
  function openModal(id) { $(id).classList.remove("hidden"); document.body.classList.add("modal-open"); }
  function closeModal(el) { el.classList.add("hidden"); document.body.classList.remove("modal-open"); }
  function closeAllModals() { $$(".modal-backdrop").forEach((m) => closeModal(m)); }

  function openItemModal(item) {
    editingId = item ? item.id : null;
    $("#item-modal-title").textContent = item ? "アイテムを編集" : "アイテムを追加";
    $("#f-id").value = item ? item.id : "";
    $("#f-title").value = item ? item.title : "";
    $("#f-price").value = item && item.price != null ? item.price : "";
    $("#f-url").value = item ? item.url : "";
    $("#f-image").value = item ? item.image : "";
    $("#f-priority").value = item ? item.priority : 2;
    $("#f-note").value = item ? item.note : "";
    fillCategorySelect($("#f-category"));
    $("#f-category").value = item ? item.category : CAT.OTHER_ID;
    openModal("#item-modal");
    setTimeout(() => $("#f-title").focus(), 30);
  }

  function submitItemForm(e) {
    e.preventDefault();
    const data = {
      title: $("#f-title").value,
      price: $("#f-price").value,
      url: $("#f-url").value,
      image: $("#f-image").value,
      priority: $("#f-priority").value,
      category: $("#f-category").value,
      note: $("#f-note").value,
    };
    if (!data.title.trim()) return;
    if (editingId) {
      const it = items.find((x) => x.id === editingId);
      if (it) {
        const newPrice = data.price !== "" ? Number(data.price) : null;
        if (newPrice != null && newPrice !== it.price) recordPrice(it, newPrice);
        Object.assign(it, {
          title: data.title.trim(),
          price: newPrice,
          url: data.url.trim(),
          image: data.image.trim(),
          priority: Number(data.priority),
          category: data.category,
          note: data.note.trim(),
        });
      }
      toast("更新しました");
    } else {
      items.push(makeItem(data));
      toast("追加しました");
    }
    saveItems();
    closeAllModals();
    render();
  }

  // ---------- 価格モーダル ----------
  function openPriceModal(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    priceItemId = id;
    const asin = extractAsin(it.url);
    const advice = buyAdvice(it);
    const hist = (it.priceHistory || []).slice().reverse();
    const rows = hist.length
      ? hist.map((h) => `<tr><td>${new Date(h.date).toLocaleDateString("ja-JP")}</td><td>${yen(h.price)}</td></tr>`).join("")
      : `<tr><td colspan="2" class="muted">まだ記録がありません</td></tr>`;
    const min = it.priceHistory && it.priceHistory.length ? Math.min(...it.priceHistory.map((h) => h.price)) : null;
    const links = asin ? `
      <div class="price-ext">
        <p class="hint">正確な価格推移・最安値は外部サービスで確認できます（ASIN: ${asin}）</p>
        <a class="btn" href="${keepaUrl(asin)}" target="_blank" rel="noopener">📈 Keepaで見る</a>
        <a class="btn" href="${camelUrl(asin)}" target="_blank" rel="noopener">🐫 camelcamelcamelで見る</a>
      </div>`
      : `<p class="hint muted">Amazonの商品URLを登録すると、Keepa / camelcamelcamel の価格推移に直接リンクできます。</p>`;
    $("#price-modal-title").textContent = it.title;
    $("#price-modal-body").innerHTML = `
      <div class="price-summary">
        <div><span class="stat-label">現在</span><b>${yen(it.price)}</b></div>
        <div><span class="stat-label">記録上の最安</span><b>${yen(min)}</b></div>
        ${advice ? `<div class="advice advice-${advice.level} big">${esc(advice.text)}</div>` : ""}
      </div>
      ${sparkline(it.priceHistory) ? `<div class="price-chart">${sparkline(it.priceHistory)}</div>` : ""}
      <table class="price-table"><thead><tr><th>日付</th><th>価格</th></tr></thead><tbody>${rows}</tbody></table>
      ${links}`;
    $("#price-add-value").value = "";
    openModal("#price-modal");
  }

  function submitPriceForm(e) {
    e.preventDefault();
    const it = items.find((x) => x.id === priceItemId);
    if (!it) return;
    const v = $("#price-add-value").value;
    if (v === "" || isNaN(Number(v))) return;
    const price = Number(v);
    recordPrice(it, price);
    it.price = price;
    saveItems();
    openPriceModal(it.id); // 再描画
    render();
    toast("価格を記録しました");
  }

  // ---------- 取り込み ----------
  // 貼り付けテキストを 1行1商品としてパース。行末などの価格を抽出。
  function parsePaste(text) {
    const priceRe = /[¥￥]\s*([\d,]+)|([\d,]+)\s*円|(?:JPY|jpy)\s*([\d,]+)/;
    const out = [];
    for (let raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      // 明らかな不要行（数量・区切りなど）を軽くスキップ
      if (/^[-—=・\s]+$/.test(line)) continue;
      let price = null;
      const m = line.match(priceRe);
      if (m) {
        const num = (m[1] || m[2] || m[3] || "").replace(/,/g, "");
        if (num) price = Number(num);
      }
      let url = "";
      const urlM = line.match(/https?:\/\/\S+/);
      if (urlM) url = urlM[0];
      let title = line
        .replace(priceRe, "")
        .replace(/https?:\/\/\S+/, "")
        .replace(/\s{2,}/g, " ")
        .replace(/[-–—|]+\s*$/, "")
        .trim();
      if (!title && url) title = url;
      if (!title) continue;
      out.push({ title, price, url, category: CAT.categorize(title) });
    }
    return out;
  }

  function runImport() {
    const activeTab = $("#import-tabs .tab.active").dataset.tab;
    if (activeTab === "amazon") {
      toast("「JSON」タブに、抽出したデータを貼り付けてください", true);
      return;
    }
    const replace = $("#import-replace").checked;
    let parsed = [];
    try {
      if (activeTab === "json") {
        const arr = JSON.parse($("#json-input").value);
        if (!Array.isArray(arr)) throw new Error("配列ではありません");
        parsed = arr.map((o) => ({
          title: o.title || o.name || "",
          price: o.price != null ? Number(o.price) : null,
          url: o.url || o.link || "",
          image: o.image || o.img || "",
          category: o.category && CAT.getCategory(o.category).id === o.category ? o.category : CAT.categorize(o.title || o.name),
          priority: o.priority || 2,
          note: o.note || "",
          priceHistory: Array.isArray(o.priceHistory) ? o.priceHistory : undefined,
        }));
      } else {
        parsed = parsePaste($("#paste-input").value);
      }
    } catch (err) {
      toast("読み取れませんでした: " + err.message, true);
      return;
    }
    if (!parsed.length) { toast("取り込むデータがありませんでした", true); return; }

    if (replace) items = [];
    let added = 0, merged = 0;
    for (const d of parsed) {
      if (d.priceHistory && replace) {
        // JSON完全復元（履歴ごと）
        const it = makeItem(d);
        it.priceHistory = d.priceHistory;
        items.push(it);
        added++;
        continue;
      }
      const r = upsert(d);
      if (r.added) added++; else merged++;
    }
    saveItems();
    closeAllModals();
    render();
    $("#paste-input").value = "";
    $("#json-input").value = "";
    toast(`取り込み完了：新規 ${added}件${merged ? `・価格更新 ${merged}件` : ""}`);
  }

  // ---------- 書き出し ----------
  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJson() {
    download("wishlist-" + dateStamp() + ".json", JSON.stringify(items, null, 2), "application/json");
    closeAllModals();
  }
  function exportCsv() {
    const head = ["title", "price", "category", "priority", "purchased", "url", "note"];
    const lines = [head.join(",")];
    for (const it of items) {
      const row = [
        it.title, it.price ?? "", CAT.getCategory(it.category).name,
        PRIORITY_LABEL[it.priority], it.purchased ? "済" : "", it.url, it.note,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(row.join(","));
    }
    // Excel の文字化け対策に BOM を付与
    download("wishlist-" + dateStamp() + ".csv", "﻿" + lines.join("\r\n"), "text/csv");
    closeAllModals();
  }
  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  // ---------- トースト ----------
  let toastTimer = null;
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("toast-error", !!isError);
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  // ---------- テーマ ----------
  function applyTheme() {
    document.documentElement.dataset.theme = prefs.theme;
    $("#theme-toggle").textContent = prefs.theme === "dark" ? "☀️" : "🌙";
  }

  // ---------- イベント ----------
  function bindEvents() {
    $("#add-btn").addEventListener("click", () => openItemModal(null));
    $("#item-form").addEventListener("submit", submitItemForm);
    $("#auto-cat").addEventListener("click", () => {
      const t = $("#f-title").value;
      if (t.trim()) { $("#f-category").value = CAT.categorize(t); toast("カテゴリを自動判定しました"); }
    });

    $("#import-btn").addEventListener("click", () => openModal("#import-modal"));
    $("#import-run").addEventListener("click", runImport);
    $("#copy-extractor").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(EXTRACTOR_SRC);
        toast("スクリプトをコピーしました。Amazonのリストで貼り付けてください");
      } catch {
        // クリップボード不可の環境では選択して手動コピーできるようにする
        const ta = document.createElement("textarea");
        ta.value = EXTRACTOR_SRC;
        ta.style.cssText = "position:fixed;top:10%;left:5%;width:90%;height:60%;z-index:200";
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        toast("手動でコピーしてください（Ctrl/Cmd+C）", true);
        setTimeout(() => ta.remove(), 8000);
      }
    });
    $$("#import-tabs .tab").forEach((tab) => tab.addEventListener("click", () => {
      $$("#import-tabs .tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      $$("#import-modal .tab-panel").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab));
    }));

    $("#export-btn").addEventListener("click", () => openModal("#export-modal"));
    $("#export-json").addEventListener("click", exportJson);
    $("#export-csv").addEventListener("click", exportCsv);

    $("#price-add-form").addEventListener("submit", submitPriceForm);

    // モーダル共通の閉じる
    $$(".modal-backdrop").forEach((m) => {
      m.addEventListener("click", (e) => { if (e.target === m) closeModal(m); });
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeAllModals();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAllModals(); });

    // 空状態のボタン
    $("#empty-state").addEventListener("click", (e) => {
      const open = e.target.dataset.open;
      if (open === "add") openItemModal(null);
      if (open === "import") openModal("#import-modal");
    });
    $("#load-sample").addEventListener("click", loadSample);

    // ツールバー
    $("#search").addEventListener("input", render);
    $("#filter-category").addEventListener("change", render);
    $("#sort").addEventListener("change", (e) => { prefs.sort = e.target.value; savePrefs(); render(); });
    $("#hide-purchased").addEventListener("change", (e) => { prefs.hidePurchased = e.target.checked; savePrefs(); render(); });
    $$(".seg-btn").forEach((b) => b.addEventListener("click", () => {
      $$(".seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      prefs.view = b.dataset.view; savePrefs(); render();
    }));
    $("#theme-toggle").addEventListener("click", () => {
      prefs.theme = prefs.theme === "dark" ? "light" : "dark"; savePrefs(); applyTheme();
    });

    // カードのアクション（委譲）
    $("#list-root").addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      const it = items.find((x) => x.id === card.dataset.id);
      if (!it) return;
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "edit") openItemModal(it);
      else if (act === "delete") { if (confirm(`「${it.title}」を削除しますか？`)) { items = items.filter((x) => x.id !== it.id); saveItems(); render(); toast("削除しました"); } }
      else if (act === "price") openPriceModal(it.id);
    });
    $("#list-root").addEventListener("change", (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      const it = items.find((x) => x.id === card.dataset.id);
      if (it && e.target.dataset.act === "purchased") {
        it.purchased = e.target.checked; saveItems(); render();
      }
    });
  }

  // ---------- サンプル ----------
  function loadSample() {
    const sample = [
      { title: "ソニー ワイヤレスノイズキャンセリングヘッドホン WH-1000XM5", price: 49500, priority: 3, url: "https://www.amazon.co.jp/dp/B09Y2MYL3H", note: "セール待ち" },
      { title: "Anker PowerCore 10000 モバイルバッテリー", price: 2990, priority: 2, url: "https://www.amazon.co.jp/dp/B0194WDVHI" },
      { title: "人を動かす 文庫版 デール・カーネギー", price: 825, priority: 1 },
      { title: "山善 電気ケトル 1.0L", price: 2480, priority: 2 },
      { title: "ロジクール MX Master 3S ワイヤレスマウス", price: 13800, priority: 3, url: "https://www.amazon.co.jp/dp/B0B1234567" },
      { title: "無印良品 体にフィットするソファ", price: 15900, priority: 2 },
      { title: "任天堂 Nintendo Switch 有機ELモデル", price: 37980, priority: 3 },
      { title: "花王 アタック 抗菌EX 洗濯洗剤 詰め替え", price: 398, priority: 1 },
    ];
    items = sample.map(makeItem);
    // 価格履歴のデモを軽く付与
    items[0].priceHistory = [
      { price: 54000, date: Date.now() - 86400000 * 40 },
      { price: 51000, date: Date.now() - 86400000 * 20 },
      { price: 49500, date: Date.now() },
    ];
    items[4].priceHistory = [
      { price: 14800, date: Date.now() - 86400000 * 30 },
      { price: 13800, date: Date.now() },
    ];
    saveItems();
    render();
    toast("サンプルを読み込みました");
  }

  // ---------- 初期化 ----------
  function init() {
    load();
    applyTheme();
    $("#sort").value = prefs.sort;
    $("#hide-purchased").checked = prefs.hidePurchased;
    $$(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === prefs.view));
    fillCategorySelect($("#f-category"));
    bindEvents();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
