// @ts-check
/*
 * ツクリオ公式メニューを取得して menu.json を生成するスクレイパ。
 * GitHub Actions(Node 20+)で実行する想定。
 *
 * 取得元（2026-06 時点）: 月単位ページ https://www.tsuklio.com/menu/<YYYYMM>/
 *  - 各週は <div id="weekly-menu-N"> セクション。<h4> に「6月15日〜6月21日」。
 *  - セクション内に「主菜」「副菜」ラベル＋ data-name="menu-card" のカードが並ぶ。
 *  - カード: 料理名は <p class="text-more-16 font-tgs-bold">、冷凍不可は <img alt="冷凍不可">、
 *    5食プラン限定は <span ...>5食プラン限定</span>（倍量は基本メニュー扱い）。
 *  - 当月＋翌月を取得（翌月が未公開なら404でスキップ）。
 *
 * 冷凍可否ルール: 「冷凍不可」が付くものだけ false、ほかは true。
 * フェイルセーフ: 有効な週が1つも取れなければ menu.json は更新しない。
 */

import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://www.tsuklio.com";
const KEEP_WEEKS = 10;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const OUT = new URL("../menu.json", import.meta.url);

/* ----------------------------- fetch helpers ----------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getText(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (attempt < 3) {
      await sleep(800 * attempt);
      return getText(url, attempt + 1);
    }
    throw e;
  }
}

/* ------------------------------ html helpers ------------------------------ */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/* ------------------------------ date helpers ------------------------------ */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function weekLabel(id) {
  // "20260615" -> "6/15〜6/21"
  const y = +id.slice(0, 4),
    mo = +id.slice(4, 6),
    da = +id.slice(6, 8);
  const start = new Date(Date.UTC(y, mo - 1, da));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${start.getUTCMonth() + 1}/${start.getUTCDate()}〜${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
}

/* ------------------------------ menu parsing ------------------------------ */
// 1枚のカードHTML -> { name, freezable, plan? } / 無効なら null
function parseCard(cardHtml, category) {
  const c = cardHtml.slice(0, 1800); // 自カードの範囲に限定
  let name = null;
  const pm = c.match(/<p class="text-more-16 font-tgs-bold[^"]*">([^<]+)<\/p>/);
  if (pm) name = decodeEntities(pm[1]).trim();
  if (!name) {
    const am = c.match(/alt="([^"]+)"/); // サムネ img の alt = 料理名
    if (am) name = decodeEntities(am[1]).trim();
  }
  if (!name || name === "冷凍不可") return null;
  const freezable = !/alt="冷凍不可"/.test(c);
  const plan = /5食プラン限定/.test(c) ? "5食" : undefined;
  const d = { name, category, freezable };
  if (plan) d.plan = plan;
  return d;
}

// 1セクション(=1週)の主菜/副菜カードを取り出す
function parseCategoryCards(sectionHtml, category) {
  const cards = sectionHtml.split('data-name="menu-card"').slice(1);
  const out = [];
  for (const c of cards) {
    const d = parseCard(c, category);
    if (d) out.push(d);
  }
  return out;
}

// 月ページ -> [{ id, label, recommend, dishes }]
function parseMonth(html, year) {
  const weeks = [];
  // コンテンツの週セクションは id="weekly-menu-N"（ナビは href="#..." なので一致しない）
  const parts = html.split('id="weekly-menu-');
  for (let k = 1; k < parts.length; k++) {
    let sec = parts[k];
    // 週セクション末尾の「Pick Up（人気メニュー）」スライダー等は重複カードなので切り落とす
    const cut = sec.search(/data-name="slider-|<!-- Pick Up|class="w-advertising/);
    if (cut >= 0) sec = sec.slice(0, cut);

    const h4m = sec.match(/<h4[\s\S]*?<\/h4>/);
    if (!h4m) continue;
    const h4txt = stripTags(h4m[0]).replace(/\s/g, ""); // "6月15日〜6月21日"
    const dm = h4txt.match(/(\d{1,2})月(\d{1,2})日/); // 先頭=開始日
    if (!dm) continue;
    const mo = +dm[1],
      da = +dm[2];
    const id = `${year}${pad2(mo)}${pad2(da)}`;

    const mainIdx = sec.indexOf(">主菜<");
    const sideIdx = sec.indexOf(">副菜<");
    const mainsHtml =
      mainIdx >= 0 ? sec.slice(mainIdx, sideIdx > mainIdx ? sideIdx : undefined) : "";
    const sidesHtml = sideIdx >= 0 ? sec.slice(sideIdx) : "";

    const raw = [
      ...parseCategoryCards(mainsHtml, "main"),
      ...parseCategoryCards(sidesHtml, "side"),
    ];
    // 同名同カテゴリの重複を除去（スライダー等の取りこぼし対策）
    const seen = new Set();
    const dishes = [];
    for (const d of raw) {
      const key = d.category + "::" + d.name;
      if (seen.has(key)) continue;
      seen.add(key);
      dishes.push(d);
    }
    if (dishes.length === 0) continue;

    const firstMain = dishes.find((d) => d.category === "main" && d.plan !== "5食");
    weeks.push({
      id,
      label: weekLabel(id),
      recommend: firstMain ? firstMain.name : dishes[0].name,
      dishes,
    });
  }
  return weeks;
}

/* --------------------------------- main ---------------------------------- */
async function loadExisting() {
  try {
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    return { weeks: [] };
  }
}

function monthsToFetch() {
  const now = new Date();
  const out = [];
  for (let i = 0; i < 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ year: d.getFullYear(), ym: `${d.getFullYear()}${pad2(d.getMonth() + 1)}` });
  }
  return out;
}

async function main() {
  const existing = await loadExisting();
  const byId = new Map();

  for (const { year, ym } of monthsToFetch()) {
    try {
      const html = await getText(`${BASE}/menu/${ym}/`);
      const weeks = parseMonth(html, year);
      console.log(`menu/${ym}: ${weeks.length}週`);
      for (const w of weeks) {
        const mains = w.dishes.filter((d) => d.category === "main").length;
        const sides = w.dishes.length - mains;
        console.log(`  ${w.id}: ${w.dishes.length}品 (主菜${mains}/副菜${sides}) おすすめ=${w.recommend}`);
        if (!byId.has(w.id)) byId.set(w.id, w);
      }
    } catch (e) {
      console.error(`menu/${ym} 取得失敗:`, e.message);
    }
    await sleep(500);
  }

  let weeks = [...byId.values()];
  if (weeks.length === 0) {
    console.error("有効な週が取れませんでした。menu.json は更新しません。");
    process.exit(0);
  }
  weeks.sort((a, b) => b.id.localeCompare(a.id));
  weeks = weeks.slice(0, KEEP_WEEKS);

  const out = { updatedAt: new Date().toISOString(), source: "tsuklio", weeks };
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`menu.json updated: ${weeks.length}週, updatedAt=${out.updatedAt}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
