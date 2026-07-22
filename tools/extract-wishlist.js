/*
 * Amazon 欲しいものリスト 抽出スクリプト
 * ------------------------------------------------------------
 * 使い方：
 *   1. ブラウザで自分のAmazon欲しいものリストのページを開く
 *      （例: https://www.amazon.co.jp/hz/wishlist/ls/XXXXXXXX）
 *   2. F12（またはCmd+Option+I）で「開発者ツール」を開き、「Console」タブへ
 *   3. このファイルの中身を全部コピーして貼り付け、Enter
 *   4. 自動で一番下までスクロールして全商品を読み込み、
 *      商品名・価格・URL・画像を抽出します
 *   5. 結果が自動でクリップボードにコピーされます（JSON形式）
 *   6. 「欲しいもの整理」アプリの「取り込み → JSON」に貼り付けて取り込み
 *
 * ※ 自分のブラウザ（ログイン済み）の中だけで動きます。データは外部に送られません。
 * ※ Amazonの画面仕様は時々変わります。うまく取れない場合はページを再読み込みして再実行してください。
 */
(async function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- 1. 遅延読み込み対策：最後まで自動スクロール ---
  async function loadAll() {
    let lastCount = -1;
    for (let i = 0; i < 60; i++) {
      const items = document.querySelectorAll('#g-items > li, ul[id="g-items"] > li');
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
      const done = document.querySelector("#endOfListMarker");
      const count = items.length;
      if (done && count === lastCount) break;
      if (count === lastCount) {
        // 2回連続で増えなければ終了
        if (i > 1) break;
      }
      lastCount = count;
    }
    window.scrollTo(0, 0);
  }

  // --- 2. 1商品ぶんの情報を取り出す ---
  function parsePrice(text) {
    if (!text) return null;
    const m = text.replace(/,/g, "").match(/[¥￥]?\s*(\d+)(?:\s*円)?/);
    return m ? Number(m[1]) : null;
  }
  function absoluteUrl(href) {
    if (!href) return "";
    try { return new URL(href, location.origin).href.split("?")[0]; }
    catch { return href; }
  }
  function extractItem(el) {
    // タイトルとURL
    const titleEl =
      el.querySelector('a[id^="itemName_"]') ||
      el.querySelector("h2 a, h3 a, .g-title a, a.a-link-normal[title]");
    const title = (titleEl && (titleEl.getAttribute("title") || titleEl.textContent || "")).trim();
    const url = absoluteUrl(titleEl && titleEl.getAttribute("href"));

    // 価格
    const priceEl =
      el.querySelector('[id^="itemPrice_"] .a-offscreen') ||
      el.querySelector(".a-price .a-offscreen") ||
      el.querySelector('[id^="itemPrice_"]') ||
      el.querySelector(".a-color-price");
    const price = parsePrice(priceEl && priceEl.textContent);

    // 画像
    const imgEl = el.querySelector("img");
    const image = imgEl ? imgEl.getAttribute("src") || "" : "";

    if (!title) return null;
    return { title, price, url, image };
  }

  // --- 実行 ---
  console.log("%c欲しいものリストを読み込み中… 少しお待ちください", "font-size:14px;color:#146eb4");
  await loadAll();

  const nodes = document.querySelectorAll('#g-items > li, ul[id="g-items"] > li');
  const items = [];
  nodes.forEach((el) => {
    const it = extractItem(el);
    if (it) items.push(it);
  });

  if (!items.length) {
    console.warn(
      "商品が見つかりませんでした。\n" +
      "・欲しいものリストのページで実行しているか確認してください\n" +
      "・ページを再読み込みしてから、もう一度お試しください"
    );
    return;
  }

  const json = JSON.stringify(items, null, 2);

  // クリップボードへコピー（失敗しても console から手動コピー可能）
  try {
    await navigator.clipboard.writeText(json);
    console.log(
      `%c✅ ${items.length}件を抽出し、クリップボードにコピーしました！\n` +
      `「欲しいもの整理」アプリの［取り込み → JSON］に貼り付けてください。`,
      "font-size:14px;color:#1e7e34;font-weight:bold"
    );
  } catch (e) {
    console.log(
      `%c✅ ${items.length}件を抽出しました（自動コピーは失敗）。\n` +
      `下の出力を選択してコピーしてください。`,
      "font-size:14px;color:#a9700a;font-weight:bold"
    );
  }

  // 常にコンソールにも出力（手動コピー用）
  console.log(json);
  // 表形式でも確認できるように
  console.table(items.map((i) => ({ title: i.title.slice(0, 40), price: i.price })));

  return items;
})();
