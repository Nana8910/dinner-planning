// @ts-check
/*
 * ツクリオ公式メニュー(https://www.tsukurioki.jp/menu/<YYYYMMDD>)を取得して
 * アプリが読む menu.json を生成するスクレイパ。GitHub Actions(Node 20+)で実行する想定。
 *
 * 仕様メモ（2026-06 時点の実HTML構造にもとづく）:
 *  - 各週ページに「３食プラン」「５食プラン」の2つの <table> がある。
 *  - 各表は <tr> ごとに「主菜 / 副菜」のラベルセルと、おかず名を <br> 区切りで並べた内容セルを持つ。
 *  - おかず名に「（冷凍不可）」が付くものだけ冷凍不可。ほかは冷凍可とみなす。
 *  - 「【倍量】」は3食と同じ品の倍量表記なので前置きを除去して同一品として扱う。
 *  - 5食プランにしか無い品（差分）に plan:"5食" を付ける。
 *  - <title> 例: 今週のおすすめ「みそ旨チーズタッカルビ」｜2026年4月27日週お届けメニュー
 *
 * フェイルセーフ: ある週が0品になった場合は既存 menu.json の該当週を温存。
 *                 全週が空なら何も書かない（既存維持）。
 */

import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://www.tsukurioki.jp";
const LIST_URL = `${BASE}/menu`;
const KEEP_WEEKS = 6;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const OUT = new URL("../menu.json", import.meta.url);

/* ----------------------------- fetch helpers ----------------------------- */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
function matchAll(re, s) {
  const out = [];
  let m;
  while ((m = re.exec(s))) out.push(m);
  return out;
}

/* ------------------------------ date helpers ------------------------------ */
function isoOf(d) {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}
function weekLabel(id) {
  // "20260427" -> "4/27〜5/3"
  const y = +id.slice(0, 4),
    mo = +id.slice(4, 6),
    da = +id.slice(6, 8);
  const start = new Date(Date.UTC(y, mo - 1, da));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${start.getUTCMonth() + 1}/${start.getUTCDate()}〜${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
}

/* ------------------------------ menu parsing ------------------------------ */
// 1行のおかず文字列 -> { name, freezable } / 無効なら null
function parseDishLine(raw) {
  let name = stripTags(raw).trim();
  if (!name) return null;
  if (/^(&nbsp;| )?$/.test(name)) return null;
  const freezable = !/冷凍不可/.test(name);
  name = name
    .replace(/（冷凍不可）|\(冷凍不可\)/g, "")
    .replace(/^【[^】]*】/, "") // 【倍量】等の前置きを除去
    .trim();
  if (!name) return null;
  return { name, freezable };
}

// 1つの <table> -> [{ name, category, freezable }]
function parseTable(tableHtml) {
  const rows = matchAll(/<tr[\s\S]*?<\/tr>/gi, tableHtml).map((m) => m[0]);
  const dishes = [];
  for (const row of rows) {
    const cells = matchAll(/<td[\s\S]*?<\/td>/gi, row).map((m) => m[0]);
    if (cells.length < 2) continue;
    // ラベルセル（主菜/副菜）と内容セルを判定
    let category = null;
    let contentCell = null;
    for (const cell of cells) {
      const txt = stripTags(cell);
      if (/^主菜$/.test(txt)) category = "main";
      else if (/^副菜$/.test(txt)) category = "side";
      else if (/<br/i.test(cell) || txt.length > 0) contentCell = cell;
    }
    if (!category || !contentCell) continue;
    const inner = contentCell.replace(/<\/?td[^>]*>/gi, "");
    for (const part of inner.split(/<br\s*\/?>/i)) {
      const d = parseDishLine(part);
      if (d) dishes.push({ ...d, category });
    }
  }
  return dishes;
}

// プラン種別 ('three' | 'five' | null) を表ヘッダから判定
function planOfTable(tableHtml) {
  const head = stripTags(tableHtml.slice(0, 600));
  if (/[5５]\s*食プラン/.test(head)) return "five";
  if (/[3３]\s*食プラン/.test(head)) return "three";
  return null;
}

function parseWeek(html, id) {
  const titleM = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : "";
  const recM = title.match(/「([^」]+)」/);
  const recommend = recM ? recM[1] : "";

  const tables = matchAll(/<table[\s\S]*?<\/table>/gi, html).map((m) => m[0]);
  let three = [];
  let five = [];
  for (const t of tables) {
    const plan = planOfTable(t);
    if (plan === "three") three = three.concat(parseTable(t));
    else if (plan === "five") five = five.concat(parseTable(t));
  }

  // 3食プランを基本に、5食にしか無い品へ plan:"5食" を付ける
  let base = three;
  if (base.length === 0) base = five; // 3食表が無い週はフォールバック
  const baseNames = new Set(base.map((d) => d.category + "::" + d.name));
  const extras = five
    .filter((d) => !baseNames.has(d.category + "::" + d.name))
    .map((d) => ({ ...d, plan: "5食" }));

  // 重複排除（同名同カテゴリは1つに）
  const seen = new Set();
  const dishes = [];
  for (const d of [...base, ...extras]) {
    const k = d.category + "::" + d.name;
    if (seen.has(k)) continue;
    seen.add(k);
    dishes.push(d);
  }
  // 主菜→副菜の順に
  dishes.sort((a, b) => (a.category === b.category ? 0 : a.category === "main" ? -1 : 1));

  return { id, label: weekLabel(id), recommend, dishes };
}

/* --------------------------------- main ---------------------------------- */
async function loadExisting() {
  try {
    const txt = await readFile(OUT, "utf8");
    return JSON.parse(txt);
  } catch {
    return { weeks: [] };
  }
}

async function main() {
  const existing = await loadExisting();
  const existingById = new Map((existing.weeks || []).map((w) => [w.id, w]));

  // 1) 週ID一覧を収集（メニュー一覧ページ）
  let ids = [];
  try {
    const listHtml = await getText(LIST_URL);
    ids = [...new Set(matchAll(/\/menu\/(\d{8})/g, listHtml).map((m) => m[1]))];
  } catch (e) {
    console.error("menu list fetch failed:", e.message);
  }
  // 既存IDも候補に含め、新しい順に上位 KEEP_WEEKS 週
  ids = [...new Set([...ids, ...existingById.keys()])].sort((a, b) => b.localeCompare(a));
  const targets = ids.slice(0, KEEP_WEEKS);
  console.log("target weeks:", targets.join(", ") || "(none)");

  // 2) 各週を取得・パース（失敗/0品は既存を温存）
  const weeks = [];
  for (const id of targets) {
    let parsed = null;
    try {
      const html = await getText(`${BASE}/menu/${id}`);
      parsed = parseWeek(html, id);
    } catch (e) {
      console.error(`week ${id} fetch failed:`, e.message);
    }
    if (parsed && parsed.dishes.length > 0) {
      const mains = parsed.dishes.filter((d) => d.category === "main").length;
      const sides = parsed.dishes.length - mains;
      console.log(`  ${id}: ${parsed.dishes.length}品 (主菜${mains}/副菜${sides}) おすすめ=${parsed.recommend}`);
      weeks.push(parsed);
    } else if (existingById.has(id)) {
      console.log(`  ${id}: パース0品 -> 既存データを温存`);
      weeks.push(existingById.get(id));
    } else {
      console.log(`  ${id}: データ無し -> スキップ`);
    }
    await sleep(500);
  }

  if (weeks.length === 0) {
    console.error("有効な週が1つも取れませんでした。menu.json は更新しません。");
    process.exit(0);
  }

  weeks.sort((a, b) => b.id.localeCompare(a.id));
  const out = {
    updatedAt: new Date().toISOString(),
    source: "tsukurioki",
    weeks,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`menu.json updated: ${weeks.length} weeks, updatedAt=${out.updatedAt}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
