import { useReducer, useEffect, useState, useMemo } from "react";
import {
  Snowflake,
  Refrigerator,
  Plus,
  CalendarDays,
  Settings,
  Check,
  ArrowRight,
  Trash2,
  X,
  Undo2,
  Sparkles,
  AlertTriangle,
  PackageOpen,
  RefreshCw,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 *  ツクリオリオ — ツクリオの一週間こんだてプランナー
 *  冷蔵のおかずは前半に、冷凍できるものは後半にまわして使い切る。
 * ------------------------------------------------------------------ */

const WD = ["日", "月", "火", "水", "木", "金", "土"];

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function dateForIndex(startISO, i) {
  const d = new Date(startISO + "T00:00:00");
  d.setDate(d.getDate() + i);
  return d;
}
function isoOf(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
/* どの日付を渡しても、その週の月曜日を返す（こんだては月曜はじまり） */
function mondayISO(iso) {
  const d = new Date((iso || todayISO()) + "T00:00:00");
  const wd = d.getDay(); // 0=日, 1=月, ... 6=土
  d.setDate(d.getDate() + (wd === 0 ? -6 : 1 - wd));
  return isoOf(d);
}
/* お届け週ID "20260615" -> "2026-06-15"（＝その週の月曜） */
function weekStartISO(id) {
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
}
/* 今日を含む（まだ終わっていない）最初のお届け週を選ぶ */
function pickCurrentWeek(weeks) {
  const list = weeks && weeks.length ? weeks : WEEKS;
  const today = todayISO();
  const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
  for (const w of sorted) {
    const d = new Date(weekStartISO(w.id) + "T00:00:00");
    d.setDate(d.getDate() + 6); // その週の日曜
    if (isoOf(d) >= today) return w;
  }
  return sorted[sorted.length - 1];
}
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/* 同一オリジンの menu.json（GitHub Actions が毎週自動更新）を読みにいく。
 * 取れなければ null を返し、ハードコードの WEEKS をフォールバックに使う。 */
async function loadMenu() {
  try {
    const res = await fetch("./menu.json?ts=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && Array.isArray(data.weeks) && data.weeks.length > 0) return data;
  } catch {
    /* ネット断・404・パース失敗などは無視してフォールバック */
  }
  return null;
}

/* ツクリオ公式お届けメニュー（tsuklio.com/menu より取得・2026年6月時点）。
 * freezable は公式の「冷凍不可」表示に基づく（不可=false）。
 * plan:"5食" は週5食プラン限定／倍量メニュー。 */
const WEEKS = [
  {
    id: "20260622",
    label: "6/22〜6/28",
    recommend: "牛バラ大根",
    dishes: [
      { name: "辛くないマーボーなす", category: "main", freezable: true },
      { name: "牛バラ大根", category: "main", freezable: true },
      { name: "白身魚のフライ", category: "main", freezable: true },
      { name: "五目つくねの出汁あんかけ", category: "main", freezable: true, plan: "5食" },
      { name: "家常豆腐", category: "main", freezable: true, plan: "5食" },
      { name: "春雨サラダ", category: "side", freezable: false },
      { name: "ブロッコリーと卵のデリ風サラダ", category: "side", freezable: false },
      { name: "たけのこの土佐煮", category: "side", freezable: true },
      { name: "ひき肉と豆腐のにら炒め", category: "side", freezable: false },
      { name: "湯葉と食べるオクラと菜の花のお浸し", category: "side", freezable: false },
      { name: "ラタトゥイユ", category: "side", freezable: true, plan: "5食" },
    ],
  },
  {
    id: "20260615",
    label: "6/15〜6/21",
    recommend: "みそ旨チーズタッカルビ",
    dishes: [
      { name: "みそ旨チーズタッカルビ", category: "main", freezable: true, kid: true },
      { name: "塩まーぼー", category: "main", freezable: false },
      { name: "豚肉とレンコンのイタリア風煮込み", category: "main", freezable: true, kid: true },
      { name: "5種野菜入りソースのポークチャップ", category: "main", freezable: true, plan: "5食" },
      { name: "ごはんと一緒に！ガパオミート", category: "main", freezable: true, plan: "5食" },
      { name: "定番の五目白和え", category: "side", freezable: true },
      { name: "小松菜とごぼうの胡麻和え", category: "side", freezable: false },
      { name: "クリームソースのかぼちゃニョッキ", category: "side", freezable: false },
      { name: "5種野菜のみぞれ煮", category: "side", freezable: true },
      { name: "さつま揚げと糸こんにゃくの甘辛炒め", category: "side", freezable: false },
      { name: "五目野菜とひじきの中華そぼろ炒め", category: "side", freezable: true, plan: "5食" },
    ],
  },
];

const initialSettings = { people: 2, days: 7, freshDays: 3, startDate: mondayISO() };
const blankState = () => ({ dishes: [], settings: { ...initialSettings } });

function makeDish(d) {
  return {
    id: uid(),
    name: d.name.trim(),
    category: d.category || "main",
    freezable: !!d.freezable,
    servings: d.servings || 2,
    source: d.source || "tsukurioki",
    kid: !!d.kid,
    dayIndex: null,
    storage: null, // 'fridge' | 'frozen'
    status: "planned", // 'planned' | 'eaten'
  };
}

function storageFor(dish, dayIndex, freshDays) {
  if (!dish.freezable) return "fridge";
  return dayIndex >= freshDays ? "frozen" : "fridge";
}

/* ---- 自動ふりわけ: 冷蔵のみ→前半 / 冷凍可→後半 ---- */
function autoArrange(dishes, settings) {
  const { days, freshDays } = settings;
  const kept = dishes.filter((d) => d.status === "eaten");
  const movable = dishes
    .filter((d) => d.status !== "eaten")
    .map((d) => ({ ...d, dayIndex: null, storage: null, status: "planned" }));

  const mainLoad = Array(days).fill(0);
  const sideLoad = Array(days).fill(0);

  const pick = (load, prefer, cap) => {
    let order = load.map((_, i) => i);
    if (prefer === "late") order = order.reverse();
    for (const i of order) if (load[i] < cap) return i; // spread first
    let best = order[0];
    for (const i of order) if (load[i] < load[best]) best = i; // then least-loaded
    return best;
  };

  const place = (list, isMain) => {
    const cap = isMain ? 1 : 2;
    const load = isMain ? mainLoad : sideLoad;
    const fridge = list.filter((d) => !d.freezable);
    const freeze = list.filter((d) => d.freezable);
    for (const d of fridge) {
      const t = pick(load, "early", cap);
      d.dayIndex = t;
      load[t]++;
      d.storage = storageFor(d, t, freshDays);
    }
    for (const d of freeze) {
      const t = pick(load, "late", cap);
      d.dayIndex = t;
      load[t]++;
      d.storage = storageFor(d, t, freshDays);
    }
  };

  place(movable.filter((d) => d.category === "main"), true);
  place(movable.filter((d) => d.category === "side"), false);

  return [...kept, ...movable];
}

function reducer(state, action) {
  switch (action.type) {
    case "LOAD":
      return action.payload;
    case "SET_SETTINGS": {
      const patch = { ...action.patch };
      if (patch.startDate) patch.startDate = mondayISO(patch.startDate); // 週は必ず月曜はじまり
      return { ...state, settings: { ...state.settings, ...patch } };
    }
    case "ADD_DISHES":
      return { ...state, dishes: [...state.dishes, ...action.dishes.map(makeDish)] };
    case "DELETE_DISH":
      return { ...state, dishes: state.dishes.filter((d) => d.id !== action.id) };
    case "TOGGLE_FREEZABLE":
      return {
        ...state,
        dishes: state.dishes.map((d) =>
          d.id === action.id ? { ...d, freezable: !d.freezable } : d
        ),
      };
    case "ASSIGN":
      return {
        ...state,
        dishes: state.dishes.map((d) =>
          d.id === action.id
            ? {
                ...d,
                dayIndex: action.dayIndex,
                storage: storageFor(d, action.dayIndex, state.settings.freshDays),
                status: "planned",
              }
            : d
        ),
      };
    case "UNASSIGN":
      return {
        ...state,
        dishes: state.dishes.map((d) =>
          d.id === action.id
            ? { ...d, dayIndex: null, storage: null, status: "planned" }
            : d
        ),
      };
    case "SET_STATUS":
      return {
        ...state,
        dishes: state.dishes.map((d) =>
          d.id === action.id ? { ...d, status: action.status } : d
        ),
      };
    case "AUTO":
      return { ...state, dishes: autoArrange(state.dishes, state.settings) };
    case "CLEAR_PLAN":
      return {
        ...state,
        dishes: state.dishes.map((d) => ({
          ...d,
          dayIndex: null,
          storage: null,
          status: "planned",
        })),
      };
    case "RESET":
      return blankState();
    default:
      return state;
  }
}

/* ------------------------------- storage ------------------------------- *
 * 保存先の優先順位：
 *   1. localStorage（実環境のブラウザ。これが本命）
 *   2. window.storage（Claude アーティファクト環境のフォールバック）
 * どちらも使えない場合は保存しない（メモリ上のみ）。
 * ---------------------------------------------------------------------- */
const KEY = "okazu:state:v1";

const hasLocal = (() => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = "__okazu_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false; // プライベートモード等で無効化されているケース
  }
})();
const hasArtifactStore = typeof window !== "undefined" && !!window.storage;

async function loadSaved() {
  try {
    if (hasLocal) {
      const v = window.localStorage.getItem(KEY);
      return v ? JSON.parse(v) : null;
    }
    if (hasArtifactStore) {
      const r = await window.storage.get(KEY);
      return r ? JSON.parse(r.value) : null;
    }
  } catch {
    /* 壊れたデータ等は無視して初期状態から始める */
  }
  return null;
}

async function persist(s) {
  try {
    const json = JSON.stringify(s);
    if (hasLocal) {
      window.localStorage.setItem(KEY, json);
      return;
    }
    if (hasArtifactStore) {
      await window.storage.set(KEY, json);
    }
  } catch {
    /* 容量超過等は無視 */
  }
}

/* ================================ APP ================================= */
export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, blankState);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("plan"); // 'plan' | 'dishes'
  const [showSettings, setShowSettings] = useState(false);
  const [sheet, setSheet] = useState(null); // { id, mode:'assign'|'move', from }
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState({ weeks: WEEKS, updatedAt: null }); // 最新メニュー（menu.json）

  useEffect(() => {
    (async () => {
      // 先に最新メニュー（menu.json）を読み込む。取れなければ WEEKS をフォールバック。
      const menuData = await loadMenu();
      const weeks = menuData ? menuData.weeks : WEEKS;
      if (menuData) setMenu({ weeks, updatedAt: menuData.updatedAt });

      const saved = await loadSaved();
      if (saved && saved.dishes) {
        dispatch({ type: "LOAD", payload: saved });
        // 既存データも月曜はじまりに揃える
        dispatch({
          type: "SET_SETTINGS",
          patch: { startDate: (saved.settings && saved.settings.startDate) || todayISO() },
        });
      } else {
        // 初回起動：今週お届けのおかず（週3食ぶん）をストックに入れて、すぐ見える状態に
        const wk = pickCurrentWeek(weeks);
        dispatch({ type: "SET_SETTINGS", patch: { startDate: weekStartISO(wk.id) } });
        const seed = wk.dishes
          .filter((d) => d.plan !== "5食")
          .map((d) => ({ ...d, source: "tsukurioki", servings: initialSettings.people }));
        dispatch({ type: "ADD_DISHES", dishes: seed });
      }
      setReady(true);
    })();
  }, []);

  // 「最新メニューに更新」ボタン用：menu.json を取り直して週リストを差し替える
  const refreshMenu = async () => {
    const data = await loadMenu();
    if (data) {
      setMenu({ weeks: data.weeks, updatedAt: data.updatedAt });
      ping(`最新メニューに更新しました（${data.weeks.length}週分）`);
    } else {
      ping("メニューを取得できませんでした");
    }
  };

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => persist(state), 250);
    return () => clearTimeout(t);
  }, [state, ready]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const { dishes, settings } = state;
  const stock = useMemo(() => dishes.filter((d) => d.dayIndex === null), [dishes]);
  const assignedCount = dishes.length - stock.length;

  const warnings = useMemo(() => {
    return dishes.filter(
      (d) =>
        d.dayIndex !== null &&
        d.status !== "eaten" &&
        d.storage === "fridge" &&
        d.dayIndex >= settings.freshDays
    );
  }, [dishes, settings.freshDays]);

  const ping = (m) => setToast(m);

  return (
    <div className="om-root">
      <style>{CSS}</style>

      <header className="om-head">
        <div className="om-brand">
          <span className="om-mark" aria-hidden>
            <span className="om-mark-i" />
          </span>
          <div>
            <h1>ツクリオリオ</h1>
            <p>ツクリオの一週間こんだてプランナー</p>
          </div>
        </div>
        <button className="om-icon" onClick={() => setShowSettings(true)} aria-label="設定">
          <Settings size={20} />
        </button>
      </header>

      <nav className="om-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "plan"}
          className={tab === "plan" ? "on" : ""}
          onClick={() => setTab("plan")}
        >
          <CalendarDays size={17} /> こんだて
        </button>
        <button
          role="tab"
          aria-selected={tab === "dishes"}
          className={tab === "dishes" ? "on" : ""}
          onClick={() => setTab("dishes")}
        >
          <PackageOpen size={17} /> おかず
          {dishes.length > 0 && <span className="om-count">{dishes.length}</span>}
        </button>
      </nav>

      <main className="om-main">
        {tab === "plan" ? (
          <PlanView
            state={state}
            stock={stock}
            assignedCount={assignedCount}
            warnings={warnings}
            onAuto={() => {
              if (dishes.length === 0) {
                setTab("dishes");
                ping("まずはおかずを登録してね");
                return;
              }
              dispatch({ type: "AUTO" });
              ping("冷蔵は前半・冷凍は後半にふりわけました");
            }}
            onClear={() => dispatch({ type: "CLEAR_PLAN" })}
            onOpenSheet={(id, mode, from) => setSheet({ id, mode, from })}
            onStatus={(id, status) => {
              dispatch({ type: "SET_STATUS", id, status });
            }}
            onGoDishes={() => setTab("dishes")}
          />
        ) : (
          <DishesView
            dishes={dishes}
            settings={settings}
            weeks={menu.weeks}
            menuUpdatedAt={menu.updatedAt}
            onRefreshMenu={refreshMenu}
            onLoadWeek={(items, weekId) => {
              if (weekId)
                dispatch({ type: "SET_SETTINGS", patch: { startDate: weekStartISO(weekId) } });
              const have = new Set(dishes.map((d) => d.source + "::" + d.name));
              const fresh = items.filter((d) => !have.has("tsukurioki::" + d.name));
              if (fresh.length === 0) {
                ping("その週のこんだてに切り替えました");
                return;
              }
              dispatch({ type: "ADD_DISHES", dishes: fresh });
              ping(`${fresh.length}品をストックに追加しました`);
            }}
            onAdd={(d) => {
              dispatch({ type: "ADD_DISHES", dishes: [d] });
              ping("おかずを追加しました");
            }}
            onDelete={(id) => dispatch({ type: "DELETE_DISH", id })}
            onToggleFreeze={(id) => dispatch({ type: "TOGGLE_FREEZABLE", id })}
          />
        )}
      </main>

      {showSettings && (
        <SettingsSheet
          settings={settings}
          onChange={(patch) => dispatch({ type: "SET_SETTINGS", patch })}
          onReset={() => {
            dispatch({ type: "RESET" });
            setShowSettings(false);
            ping("すべてリセットしました");
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {sheet && (
        <DaySheet
          dish={dishes.find((d) => d.id === sheet.id)}
          mode={sheet.mode}
          from={sheet.from}
          settings={settings}
          dishes={dishes}
          onPick={(dayIndex) => {
            dispatch({ type: "ASSIGN", id: sheet.id, dayIndex });
            setSheet(null);
            ping("ふりわけました");
          }}
          onUnassign={() => {
            dispatch({ type: "UNASSIGN", id: sheet.id });
            setSheet(null);
            ping("ストックに戻しました");
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {toast && <div className="om-toast">{toast}</div>}
    </div>
  );
}

/* ------------------------------ Plan view ------------------------------ */
function PlanView({
  state,
  stock,
  assignedCount,
  warnings,
  onAuto,
  onClear,
  onOpenSheet,
  onStatus,
  onGoDishes,
}) {
  const { dishes, settings } = state;
  const days = settings.days;
  const todayIdx = useMemo(() => {
    const t = todayISO();
    for (let i = 0; i < days; i++) {
      const d = dateForIndex(settings.startDate, i);
      if (
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}` === t
      )
        return i;
    }
    return -1;
  }, [settings.startDate, days]);

  return (
    <div className="om-plan">
      <div className="om-actions">
        <button className="om-primary" onClick={onAuto}>
          <Sparkles size={17} /> 1週間に自動でふりわけ
        </button>
        {assignedCount > 0 && (
          <button className="om-ghost" onClick={onClear}>
            <Undo2 size={15} /> リセット
          </button>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="om-warn">
          <AlertTriangle size={16} />
          <span>
            冷蔵のおかずが{warnings.length}品、{settings.freshDays}日目以降にあります。
            早めに食べきりましょう。
          </span>
        </div>
      )}

      {/* ストック棚 */}
      <section className="om-shelf">
        <div className="om-shelf-h">
          <PackageOpen size={15} />
          <span>みわりあて（ストック）</span>
          <em>{stock.length}品</em>
        </div>
        {stock.length === 0 ? (
          <p className="om-empty-line">
            {dishes.length === 0 ? (
              <>
                おかずがまだありません。
                <button className="om-link" onClick={onGoDishes}>
                  「おかず」から登録
                </button>
                してね。
              </>
            ) : (
              "すべてふりわけ済みです 🎉"
            )}
          </p>
        ) : (
          <div className="om-chips">
            {stock.map((d) => (
              <button
                key={d.id}
                className="om-chip"
                onClick={() => onOpenSheet(d.id, "assign")}
              >
                <DishDot d={d} />
                <span className="om-chip-name">{d.name}</span>
                {d.freezable ? (
                  <Snowflake size={13} className="om-frz" />
                ) : (
                  <Refrigerator size={13} className="om-frd" />
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 週ボード */}
      <div className="om-scrollhint">← 横にスクロールして1週間 →</div>
      <div className="om-board">
        {Array.from({ length: days }).map((_, i) => {
          const date = dateForIndex(settings.startDate, i);
          const items = dishes.filter((d) => d.dayIndex === i);
          return (
            <DayCard
              key={i}
              i={i}
              date={date}
              isToday={i === todayIdx}
              items={items}
              onOpenSheet={onOpenSheet}
              onStatus={onStatus}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayCard({ i, date, isToday, items, onOpenSheet, onStatus }) {
  const mains = items.filter((d) => d.category === "main");
  const sides = items.filter((d) => d.category === "side");
  return (
    <div className={"om-day" + (isToday ? " today" : "")}>
      <div className="om-day-h">
        <span className="om-wd">{WD[date.getDay()]}</span>
        <span className="om-dt">
          {date.getMonth() + 1}/{date.getDate()}
        </span>
        {isToday && <span className="om-today-tag">きょう</span>}
      </div>
      <div className="om-day-body">
        {items.length === 0 ? (
          <p className="om-day-empty">—</p>
        ) : (
          <>
            {mains.length > 0 && <DishGroup label="主菜" items={mains} onOpenSheet={onOpenSheet} onStatus={onStatus} dayIndex={i} />}
            {sides.length > 0 && <DishGroup label="副菜" items={sides} onOpenSheet={onOpenSheet} onStatus={onStatus} dayIndex={i} />}
          </>
        )}
      </div>
    </div>
  );
}

function DishGroup({ label, items, onOpenSheet, onStatus, dayIndex }) {
  return (
    <div className="om-group">
      <span className="om-group-l">{label}</span>
      {items.map((d) => (
        <PlannedDish
          key={d.id}
          d={d}
          dayIndex={dayIndex}
          onOpenSheet={onOpenSheet}
          onStatus={onStatus}
        />
      ))}
    </div>
  );
}

function PlannedDish({ d, dayIndex, onOpenSheet, onStatus }) {
  const [open, setOpen] = useState(false);
  const eaten = d.status === "eaten";
  return (
    <div className={"om-pd " + (d.storage === "frozen" ? "frz" : "frd") + (eaten ? " eaten" : "")}>
      <button className="om-pd-main" onClick={() => setOpen((v) => !v)}>
        <span className="om-pd-badge">
          {d.storage === "frozen" ? <Snowflake size={12} /> : <Refrigerator size={12} />}
          {d.storage === "frozen" ? "冷凍" : "冷蔵"}
        </span>
        <span className="om-pd-name">{d.name}</span>
        {eaten && <Check size={14} className="om-eaten-i" />}
      </button>
      {open && (
        <div className="om-pd-menu">
          {!eaten ? (
            <>
              <button onClick={() => { onStatus(d.id, "eaten"); setOpen(false); }}>
                <Check size={14} /> 食べた
              </button>
              <button onClick={() => { onOpenSheet(d.id, "move", dayIndex); setOpen(false); }}>
                <ArrowRight size={14} /> 後日にまわす
              </button>
              <button onClick={() => { onOpenSheet(d.id, "assign", dayIndex); setOpen(false); }}>
                <PackageOpen size={14} /> 別の日／ストックへ
              </button>
            </>
          ) : (
            <button onClick={() => { onStatus(d.id, "planned"); setOpen(false); }}>
              <Undo2 size={14} /> 食べたを取り消す
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DishDot({ d }) {
  return (
    <span
      className="om-dot"
      style={{ background: d.category === "main" ? "var(--accent)" : "var(--olive)" }}
      title={d.category === "main" ? "主菜" : "副菜"}
    />
  );
}

/* ------------------------------ Day sheet ------------------------------ */
function DaySheet({ dish, mode, from, settings, dishes, onPick, onUnassign, onClose }) {
  if (!dish) return null;
  const days = settings.days;
  const title =
    mode === "move" ? "後日にまわす" : mode === "assign" && from != null ? "別の日へ移す" : "どの日に食べる？";
  return (
    <div className="om-modal-wrap" onClick={onClose}>
      <div className="om-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="om-sheet-grab" />
        <div className="om-sheet-h">
          <div>
            <h3>{title}</h3>
            <p className="om-sheet-sub">
              {dish.name}
              {dish.freezable ? "（冷凍OK）" : "（冷蔵のみ）"}
            </p>
          </div>
          <button className="om-icon sm" onClick={onClose} aria-label="閉じる">
            <X size={18} />
          </button>
        </div>

        {mode === "move" && dish.freezable && (
          <p className="om-sheet-tip">
            <Snowflake size={13} /> 冷凍できるので、{settings.freshDays}日目以降にまわすと長持ちします。
          </p>
        )}
        {mode === "move" && !dish.freezable && (
          <p className="om-sheet-tip warn">
            <AlertTriangle size={13} /> 冷蔵のみのおかずです。翌日までに食べきりましょう。
          </p>
        )}

        <div className="om-sheet-days">
          {Array.from({ length: days }).map((_, i) => {
            const date = dateForIndex(settings.startDate, i);
            const load = dishes.filter((d) => d.dayIndex === i && d.id !== dish.id).length;
            const disabled = mode === "move" && from != null && i <= from;
            const willFreeze = dish.freezable && i >= settings.freshDays;
            return (
              <button
                key={i}
                className={"om-sheet-day" + (i === from ? " current" : "")}
                disabled={disabled}
                onClick={() => onPick(i)}
              >
                <span className="om-sd-wd">{WD[date.getDay()]}</span>
                <span className="om-sd-dt">
                  {date.getMonth() + 1}/{date.getDate()}
                </span>
                <span className={"om-sd-store " + (willFreeze ? "frz" : "frd")}>
                  {willFreeze ? "冷凍" : "冷蔵"}
                </span>
                {load > 0 && <span className="om-sd-load">{load}品</span>}
                {i === from && <span className="om-sd-now">今ここ</span>}
              </button>
            );
          })}
        </div>

        {from != null && (
          <button className="om-ghost wide" onClick={onUnassign}>
            <PackageOpen size={15} /> ストックに戻す
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Dishes view ------------------------------ */
function DishesView({
  dishes,
  settings,
  weeks,
  menuUpdatedAt,
  onRefreshMenu,
  onLoadWeek,
  onAdd,
  onDelete,
  onToggleFreeze,
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("main");
  const [freezable, setFreezable] = useState(false);
  const [source, setSource] = useState("tsukurioki");
  const [weekId, setWeekId] = useState(() => pickCurrentWeek(weeks).id);
  const [include5, setInclude5] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // menu.json が後から読み込まれて週が入れ替わったら、選択を今週に寄せる
  useEffect(() => {
    if (!weeks.some((w) => w.id === weekId)) setWeekId(pickCurrentWeek(weeks).id);
  }, [weeks]);

  const week = weeks.find((w) => w.id === weekId) || weeks[0];
  const preview = week.dishes.filter((d) => include5 || d.plan !== "5食");

  const submit = () => {
    if (!name.trim()) return;
    onAdd({ name, category, freezable, source, servings: settings.people });
    setName("");
    setFreezable(false);
  };

  const loadWeek = () => {
    onLoadWeek(
      preview.map((d) => ({ ...d, source: "tsukurioki", servings: settings.people })),
      week.id
    );
  };

  const tsuk = dishes.filter((d) => d.source === "tsukurioki");
  const home = dishes.filter((d) => d.source === "home");

  return (
    <div className="om-dishes">
      {/* お届け週から読み込む */}
      <section className="om-card">
        <h2 className="om-h2">
          <Sparkles size={15} className="om-h2-i" /> お届け週から読み込む
        </h2>
        <p className="om-card-sub">
          ツクリオ公式メニューの主菜・副菜を、冷凍可否つきでまとめて登録します。
        </p>

        <div className="om-menu-update">
          <span className="om-menu-date">
            メニュー更新日：
            {menuUpdatedAt ? new Date(menuUpdatedAt).toLocaleDateString("ja-JP") : "—（内蔵データ）"}
          </span>
          <button
            className="om-refresh"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await onRefreshMenu();
              setRefreshing(false);
            }}
          >
            <RefreshCw size={14} className={refreshing ? "om-spin" : ""} />
            {refreshing ? "更新中…" : "最新メニューに更新"}
          </button>
        </div>

        <div className="om-week-pick">
          {weeks.map((w) => (
            <button
              key={w.id}
              className={"om-week" + (w.id === weekId ? " on" : "")}
              onClick={() => setWeekId(w.id)}
            >
              <span className="om-week-d">{w.label}</span>
              <span className="om-week-r">おすすめ：{w.recommend}</span>
            </button>
          ))}
        </div>

        <div className="om-week-preview">
          {preview.map((d) => (
            <span key={d.name} className={"om-prev " + (d.freezable ? "frz" : "frd")}>
              {d.freezable ? <Snowflake size={11} /> : <Refrigerator size={11} />}
              {d.name}
            </span>
          ))}
        </div>

        <button
          className={"om-mini-toggle" + (include5 ? " on" : "")}
          onClick={() => setInclude5((v) => !v)}
        >
          <span className="om-switch sm" aria-hidden>
            <span className="om-switch-knob" />
          </span>
          5食プラン限定・倍量メニューも含める
        </button>

        <button className="om-primary wide" onClick={loadWeek}>
          <Plus size={17} /> この週のこんだてにする（{preview.length}品）
        </button>
        <p className="om-src-note">
          出典：ツクリオ公式お届けメニュー（毎日自動取得）。冷凍可否は公式の「冷凍不可」表示にもとづきます。
        </p>
      </section>

      {/* 手動で追加 */}
      <section className="om-card">
        <h2 className="om-h2">じぶんで追加</h2>
        <input
          className="om-input"
          placeholder="おかずの名前（例：肉じゃが）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <div className="om-seg-row">
          <Seg
            options={[
              ["main", "主菜"],
              ["side", "副菜"],
            ]}
            value={category}
            onChange={setCategory}
          />
        </div>

        <button
          className={"om-freeze-toggle" + (freezable ? " on" : "")}
          onClick={() => setFreezable((v) => !v)}
        >
          {freezable ? <Snowflake size={16} /> : <Refrigerator size={16} />}
          {freezable ? "冷凍できる（後半にまわせる）" : "冷蔵のみ（早めに食べる）"}
          <span className="om-switch" aria-hidden>
            <span className="om-switch-knob" />
          </span>
        </button>

        <div className="om-seg-row">
          <Seg
            options={[
              ["tsukurioki", "ツクリオ"],
              ["home", "自作"],
            ]}
            value={source}
            onChange={setSource}
          />
        </div>

        <button className="om-primary wide" onClick={submit} disabled={!name.trim()}>
          <Plus size={17} /> 追加する
        </button>
      </section>

      {dishes.length === 0 ? (
        <p className="om-empty">
          登録したおかずがここに並びます。ツクリオで届いたものも、自分で作ったものも、
          まとめて管理できます。
        </p>
      ) : (
        <>
          {tsuk.length > 0 && (
            <DishList title="ツクリオ" items={tsuk} onDelete={onDelete} onToggleFreeze={onToggleFreeze} />
          )}
          {home.length > 0 && (
            <DishList title="自作" items={home} onDelete={onDelete} onToggleFreeze={onToggleFreeze} />
          )}
        </>
      )}
    </div>
  );
}

function DishList({ title, items, onDelete, onToggleFreeze }) {
  return (
    <section className="om-list">
      <div className="om-list-h">
        {title} <em>{items.length}品</em>
      </div>
      {items.map((d) => (
        <div key={d.id} className="om-row">
          <DishDot d={d} />
          <span className="om-row-cat">{d.category === "main" ? "主菜" : "副菜"}</span>
          <span className="om-row-name">{d.name}</span>
          {d.kid && <span className="om-kid">子</span>}
          <button
            className={"om-row-store " + (d.freezable ? "frz" : "frd")}
            onClick={() => onToggleFreeze(d.id)}
            title="冷蔵／冷凍を切りかえ"
          >
            {d.freezable ? <Snowflake size={13} /> : <Refrigerator size={13} />}
            {d.freezable ? "冷凍可" : "冷蔵"}
          </button>
          <button className="om-row-del" onClick={() => onDelete(d.id)} aria-label="削除">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------ Settings ------------------------------ */
function SettingsSheet({ settings, onChange, onReset, onClose }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="om-modal-wrap" onClick={onClose}>
      <div className="om-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="om-sheet-grab" />
        <div className="om-sheet-h">
          <h3>設定</h3>
          <button className="om-icon sm" onClick={onClose} aria-label="閉じる">
            <X size={18} />
          </button>
        </div>

        <label className="om-field">
          <span>お届け日（週のはじめ・毎週月曜）</span>
          <input
            type="date"
            className="om-input"
            value={settings.startDate}
            onChange={(e) => onChange({ startDate: e.target.value })}
          />
          <small className="om-hint">どの曜日を選んでも、その週の月曜はじまりに調整されます。</small>
        </label>

        <div className="om-field">
          <span>ふりわける日数</span>
          <Seg
            options={[
              [5, "5日"],
              [6, "6日"],
              [7, "7日"],
            ]}
            value={settings.days}
            onChange={(v) => onChange({ days: v })}
          />
        </div>

        <div className="om-field">
          <span>冷蔵で食べきる日数</span>
          <Seg
            options={[
              [2, "2日"],
              [3, "3日"],
              [4, "4日"],
            ]}
            value={settings.freshDays}
            onChange={(v) => onChange({ freshDays: v })}
          />
          <small className="om-hint">これを過ぎる日には、冷凍できるおかずをまわします。</small>
        </div>

        <label className="om-field">
          <span>人数</span>
          <Seg
            options={[
              [1, "1人"],
              [2, "2人"],
              [4, "4人"],
            ]}
            value={settings.people}
            onChange={(v) => onChange({ people: v })}
          />
        </label>

        {!confirm ? (
          <button className="om-danger" onClick={() => setConfirm(true)}>
            <Trash2 size={15} /> すべてリセット
          </button>
        ) : (
          <div className="om-confirm">
            <span>登録したおかずと献立を全部消します。よろしいですか？</span>
            <div>
              <button className="om-ghost" onClick={() => setConfirm(false)}>
                やめる
              </button>
              <button className="om-danger" onClick={onReset}>
                消す
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Segmented ------------------------------ */
function Seg({ options, value, onChange }) {
  return (
    <div className="om-seg" role="group">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          className={value === v ? "on" : ""}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ================================ STYLE ================================ */
const CSS = `
:root{
  --bg:#ECE9E1; --card:#FFFFFF; --ink:#2C2825; --ink2:#7A746B; --line:#E4E0D6;
  --fresh:#3F8F57; --fresh-bg:#E7F1E7;
  --frozen:#3A82A6; --frozen-bg:#E3EEF4;
  --accent:#D6852F; --accent-bg:#FBEEDC; --olive:#A9A083; --warn:#C4552E;
  --font:'Hiragino Maru Gothic ProN','ヒラギノ丸ゴ ProN','Hiragino Kaku Gothic ProN','Yu Gothic Medium','メイリオ',Meiryo,system-ui,sans-serif;
}
*{box-sizing:border-box;}
.om-root{font-family:var(--font); color:var(--ink); background:var(--bg);
  min-height:100vh; max-width:760px; margin:0 auto; padding:0 0 64px;
  -webkit-font-smoothing:antialiased; letter-spacing:.01em;}
.om-root button{font-family:inherit; cursor:pointer; color:inherit;}

/* header */
.om-head{display:flex; align-items:center; justify-content:space-between;
  padding:18px 18px 12px;}
.om-brand{display:flex; align-items:center; gap:12px;}
.om-mark{width:38px;height:38px;border-radius:13px;background:var(--accent);
  display:grid;place-items:center; box-shadow:0 4px 10px rgba(214,133,47,.28); position:relative;}
.om-mark-i{width:18px;height:18px;border-radius:50% 50% 50% 4px; background:#fff; transform:rotate(45deg);}
.om-brand h1{font-size:21px; margin:0; font-weight:800; letter-spacing:.04em;}
.om-brand p{font-size:11.5px; margin:1px 0 0; color:var(--ink2);}
.om-icon{background:var(--card); border:1px solid var(--line); border-radius:12px;
  width:40px;height:40px; display:grid;place-items:center; color:var(--ink2);}
.om-icon.sm{width:34px;height:34px;border-radius:10px;}
.om-icon:hover{color:var(--ink);}

/* tabs */
.om-tabs{display:flex; gap:8px; padding:0 18px 12px; position:sticky; top:0; z-index:5;
  background:linear-gradient(var(--bg),var(--bg) 70%, transparent);}
.om-tabs button{flex:1; display:flex; align-items:center; justify-content:center; gap:7px;
  padding:11px; border:1px solid var(--line); background:var(--card); color:var(--ink2);
  border-radius:13px; font-weight:700; font-size:14px;}
.om-tabs button.on{background:var(--ink); color:#fff; border-color:var(--ink);}
.om-count{background:var(--accent); color:#fff; font-size:11px; border-radius:9px; padding:1px 6px; font-weight:800;}
.om-tabs button.on .om-count{background:rgba(255,255,255,.22);}

.om-main{padding:4px 18px 0;}

/* actions */
.om-actions{display:flex; gap:10px; align-items:center; margin:6px 0 12px;}
.om-primary{display:inline-flex; align-items:center; gap:8px; background:var(--accent);
  color:#fff; border:none; border-radius:13px; padding:13px 18px; font-weight:800; font-size:14.5px;
  box-shadow:0 5px 14px rgba(214,133,47,.30); flex:1; justify-content:center;}
.om-primary:hover{filter:brightness(1.04);}
.om-primary:disabled{opacity:.45; box-shadow:none;}
.om-primary.wide{width:100%; margin-top:4px;}
.om-ghost{display:inline-flex; align-items:center; gap:6px; background:transparent;
  border:1px solid var(--line); border-radius:12px; padding:11px 14px; font-weight:700; color:var(--ink2); font-size:13px;}
.om-ghost.wide{width:100%; justify-content:center; margin-top:12px;}
.om-ghost:hover{color:var(--ink); border-color:var(--ink2);}

/* warn banner */
.om-warn{display:flex; align-items:flex-start; gap:9px; background:#FBEAE2; color:var(--warn);
  border:1px solid #F1CFC0; border-radius:13px; padding:11px 13px; font-size:12.5px; font-weight:600; margin-bottom:12px;}
.om-warn svg{flex-shrink:0; margin-top:1px;}

/* shelf */
.om-shelf{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:13px; margin-bottom:14px;}
.om-shelf-h{display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:800; color:var(--ink2); margin-bottom:10px;}
.om-shelf-h em{margin-left:auto; font-style:normal; color:var(--accent); font-weight:800;}
.om-empty-line{font-size:12.5px; color:var(--ink2); margin:2px 0 0;}
.om-link{background:none;border:none;color:var(--accent);font-weight:800;padding:0;text-decoration:underline;}
.om-chips{display:flex; flex-wrap:wrap; gap:8px;}
.om-chip{display:inline-flex; align-items:center; gap:7px; background:#FAF8F3; border:1px solid var(--line);
  border-radius:11px; padding:8px 11px; font-size:12.5px; font-weight:600;}
.om-chip:hover{border-color:var(--accent); background:var(--accent-bg);}
.om-chip-name{max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.om-frz{color:var(--frozen);} .om-frd{color:var(--fresh);}
.om-dot{width:8px;height:8px;border-radius:50%; flex-shrink:0;}

/* board */
.om-scrollhint{font-size:10.5px; color:var(--ink2); text-align:center; margin:2px 0 7px; letter-spacing:.08em; opacity:.7;}
.om-board{display:flex; gap:11px; overflow-x:auto; padding:2px 2px 16px; scroll-snap-type:x mandatory;
  -webkit-overflow-scrolling:touch;}
.om-board::-webkit-scrollbar{height:6px;}
.om-board::-webkit-scrollbar-thumb{background:#D7D2C6; border-radius:3px;}
.om-day{flex:0 0 195px; scroll-snap-align:start; background:var(--card); border:1px solid var(--line);
  border-radius:16px; overflow:hidden; display:flex; flex-direction:column; min-height:150px;
  animation:rise .4s ease both;}
@keyframes rise{from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:none;}}
.om-day.today{border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-bg);}
.om-day-h{display:flex; align-items:center; gap:8px; padding:10px 13px; border-bottom:1px solid var(--line);
  background:#FAF8F3;}
.om-wd{font-weight:800; font-size:15px;}
.om-dt{font-size:12px; color:var(--ink2); font-weight:700;}
.om-today-tag{margin-left:auto; background:var(--accent); color:#fff; font-size:10px; font-weight:800;
  padding:2px 7px; border-radius:8px;}
.om-day-body{padding:10px 11px; display:flex; flex-direction:column; gap:10px; flex:1;}
.om-day-empty{color:#CFC9BC; text-align:center; margin:auto; font-size:18px;}
.om-group{display:flex; flex-direction:column; gap:5px;}
.om-group-l{font-size:10px; font-weight:800; color:var(--ink2); letter-spacing:.1em;}

/* planned dish */
.om-pd{border-radius:10px; overflow:hidden; border:1px solid transparent;}
.om-pd.frd{background:var(--fresh-bg);}
.om-pd.frz{background:var(--frozen-bg);}
.om-pd.eaten{opacity:.5;}
.om-pd-main{display:flex; align-items:center; gap:6px; width:100%; background:none; border:none;
  padding:7px 9px; text-align:left;}
.om-pd-badge{display:inline-flex; align-items:center; gap:3px; font-size:9.5px; font-weight:800;
  padding:2px 5px; border-radius:6px; flex-shrink:0;}
.om-pd.frd .om-pd-badge{background:var(--fresh); color:#fff;}
.om-pd.frz .om-pd-badge{background:var(--frozen); color:#fff;}
.om-pd-name{font-size:12px; font-weight:700; line-height:1.25;}
.om-pd.eaten .om-pd-name{text-decoration:line-through;}
.om-eaten-i{margin-left:auto; color:var(--fresh); flex-shrink:0;}
.om-pd-menu{display:flex; flex-direction:column; border-top:1px solid rgba(0,0,0,.06);}
.om-pd-menu button{display:flex; align-items:center; gap:7px; background:rgba(255,255,255,.6);
  border:none; padding:8px 10px; font-size:11.5px; font-weight:700; text-align:left; color:var(--ink);
  border-bottom:1px solid rgba(0,0,0,.04);}
.om-pd-menu button:last-child{border-bottom:none;}
.om-pd-menu button:hover{background:#fff;}

/* dishes view */
.om-dishes{padding-bottom:20px;}
.om-card{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin:6px 0 12px;}
.om-h2{font-size:15px; font-weight:800; margin:0 0 12px;}
.om-input{width:100%; border:1px solid var(--line); border-radius:11px; padding:12px 13px;
  font-size:14px; font-family:inherit; background:#FAF8F3; color:var(--ink); outline:none;}
.om-input:focus{border-color:var(--accent); background:#fff;}
.om-seg-row{margin:11px 0;}
.om-seg{display:flex; gap:6px; background:#F1EEE6; padding:4px; border-radius:12px;}
.om-seg button{flex:1; border:none; background:none; padding:9px; border-radius:9px; font-weight:700;
  font-size:13px; color:var(--ink2);}
.om-seg button.on{background:#fff; color:var(--ink); box-shadow:0 1px 4px rgba(0,0,0,.08);}
.om-freeze-toggle{width:100%; display:flex; align-items:center; gap:9px; border:1px solid var(--line);
  background:var(--fresh-bg); color:var(--fresh); border-radius:12px; padding:12px 14px; font-weight:700; font-size:13px; margin:11px 0;}
.om-freeze-toggle.on{background:var(--frozen-bg); color:var(--frozen);}
.om-switch{margin-left:auto; width:40px; height:23px; border-radius:12px; background:#CFC9BC; position:relative; transition:background .18s;}
.om-freeze-toggle.on .om-switch{background:var(--frozen);}
.om-switch-knob{position:absolute; top:2.5px; left:2.5px; width:18px; height:18px; border-radius:50%; background:#fff; transition:left .18s; box-shadow:0 1px 3px rgba(0,0,0,.25);}
.om-freeze-toggle.on .om-switch-knob{left:19.5px;}
.om-card-sub{font-size:12px; color:var(--ink2); margin:0 0 12px; line-height:1.55;}
.om-h2-i{vertical-align:-2px; color:var(--accent); margin-right:3px;}
.om-week-pick{display:flex; gap:8px; margin-bottom:12px;}
.om-week{flex:1; text-align:left; background:#FAF8F3; border:1.5px solid var(--line); border-radius:13px; padding:10px 12px;
  display:flex; flex-direction:column; gap:3px;}
.om-week.on{border-color:var(--accent); background:var(--accent-bg);}
.om-week-d{font-weight:800; font-size:14px;}
.om-week-r{font-size:10.5px; color:var(--ink2); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.om-week-preview{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:13px;}
.om-prev{display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:700; padding:5px 8px; border-radius:8px;}
.om-prev.frd{background:var(--fresh-bg); color:var(--fresh);}
.om-prev.frz{background:var(--frozen-bg); color:var(--frozen);}
.om-mini-toggle{display:flex; align-items:center; gap:9px; background:none; border:none; padding:4px 0 12px;
  font-size:12.5px; font-weight:700; color:var(--ink2);}
.om-mini-toggle.on{color:var(--frozen);}
.om-switch.sm{width:34px; height:20px;}
.om-switch.sm .om-switch-knob{width:15px; height:15px;}
.om-mini-toggle.on .om-switch{background:var(--frozen);}
.om-mini-toggle.on .om-switch.sm .om-switch-knob{left:16.5px;}
.om-src-note{font-size:10.5px; color:var(--ink2); line-height:1.55; margin:11px 0 0; opacity:.85;}
.om-menu-update{display:flex; align-items:center; gap:8px; justify-content:space-between; margin:0 0 12px; flex-wrap:wrap;}
.om-menu-date{font-size:11px; color:var(--ink2); font-weight:700;}
.om-refresh{display:inline-flex; align-items:center; gap:6px; background:var(--frozen-bg); color:var(--frozen);
  border:1px solid #CFE0EA; border-radius:11px; padding:8px 12px; font-weight:800; font-size:12px;}
.om-refresh:hover:not(:disabled){filter:brightness(.97);}
.om-refresh:disabled{opacity:.6;}
.om-spin{animation:om-rot .8s linear infinite;}
@keyframes om-rot{to{transform:rotate(360deg);}}
.om-kid{font-size:10px; font-weight:800; color:var(--accent); background:var(--accent-bg); padding:2px 6px; border-radius:6px; flex-shrink:0;}
.om-empty{font-size:13px; color:var(--ink2); line-height:1.7; text-align:center; padding:24px 12px;}

/* dish list */
.om-list{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:8px 12px; margin-bottom:12px;}
.om-list-h{font-size:12.5px; font-weight:800; color:var(--ink2); padding:9px 4px 8px; border-bottom:1px solid var(--line);}
.om-list-h em{font-style:normal; color:var(--accent); margin-left:6px;}
.om-row{display:flex; align-items:center; gap:9px; padding:11px 4px; border-bottom:1px solid var(--line);}
.om-row:last-child{border-bottom:none;}
.om-row-cat{font-size:10px; font-weight:800; color:var(--ink2); background:#F1EEE6; padding:2px 6px; border-radius:6px; flex-shrink:0;}
.om-row-name{font-size:13.5px; font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.om-row-store{display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:800; padding:5px 9px; border-radius:9px; border:1px solid transparent; flex-shrink:0;}
.om-row-store.frd{background:var(--fresh-bg); color:var(--fresh);}
.om-row-store.frz{background:var(--frozen-bg); color:var(--frozen);}
.om-row-del{background:none; border:none; color:#C9C3B6; padding:5px; flex-shrink:0;}
.om-row-del:hover{color:var(--warn);}

/* modal / sheet */
.om-modal-wrap{position:fixed; inset:0; background:rgba(36,32,28,.42); z-index:30;
  display:flex; align-items:flex-end; justify-content:center; animation:fade .2s ease;}
@keyframes fade{from{opacity:0;}to{opacity:1;}}
.om-sheet{background:var(--bg); width:100%; max-width:760px; border-radius:22px 22px 0 0; padding:8px 18px 26px;
  max-height:88vh; overflow-y:auto; animation:slideup .26s cubic-bezier(.2,.8,.25,1);}
@keyframes slideup{from{transform:translateY(100%);}to{transform:none;}}
.om-sheet-grab{width:38px;height:4px;border-radius:2px;background:#CFC9BC; margin:4px auto 14px;}
.om-sheet-h{display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:6px;}
.om-sheet-h h3{font-size:17px; margin:0; font-weight:800;}
.om-sheet-sub{font-size:12.5px; color:var(--ink2); margin:3px 0 0;}
.om-sheet-tip{display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; color:var(--frozen);
  background:var(--frozen-bg); border-radius:11px; padding:9px 12px; margin:10px 0;}
.om-sheet-tip.warn{color:var(--warn); background:#FBEAE2;}
.om-sheet-days{display:grid; grid-template-columns:repeat(auto-fill,minmax(86px,1fr)); gap:9px; margin:12px 0;}
.om-sheet-day{position:relative; background:var(--card); border:1px solid var(--line); border-radius:13px;
  padding:11px 6px 9px; display:flex; flex-direction:column; align-items:center; gap:3px;}
.om-sheet-day:hover:not(:disabled){border-color:var(--accent);}
.om-sheet-day:disabled{opacity:.35;}
.om-sheet-day.current{border-color:var(--accent); background:var(--accent-bg);}
.om-sd-wd{font-weight:800; font-size:15px;}
.om-sd-dt{font-size:11px; color:var(--ink2); font-weight:700;}
.om-sd-store{font-size:10px; font-weight:800; padding:1px 6px; border-radius:6px; margin-top:2px;}
.om-sd-store.frd{background:var(--fresh-bg); color:var(--fresh);}
.om-sd-store.frz{background:var(--frozen-bg); color:var(--frozen);}
.om-sd-load{font-size:9.5px; color:var(--ink2); font-weight:700;}
.om-sd-now{position:absolute; top:-7px; right:-4px; background:var(--accent); color:#fff; font-size:9px; font-weight:800; padding:1px 5px; border-radius:6px;}

/* settings fields */
.om-field{display:block; margin:14px 0;}
.om-field>span{display:block; font-size:12.5px; font-weight:800; color:var(--ink2); margin-bottom:7px;}
.om-hint, .om-field small{display:block; font-size:11px; color:var(--ink2); margin-top:6px; line-height:1.5;}
.om-danger{display:inline-flex; align-items:center; gap:7px; background:#FBEAE2; color:var(--warn);
  border:1px solid #F1CFC0; border-radius:12px; padding:12px 16px; font-weight:800; font-size:13px; margin-top:18px;}
.om-confirm{margin-top:18px; background:#FBEAE2; border:1px solid #F1CFC0; border-radius:13px; padding:14px; font-size:12.5px; font-weight:700; color:var(--warn);}
.om-confirm>div{display:flex; gap:9px; margin-top:11px;}
.om-confirm .om-ghost{flex:1; justify-content:center; color:var(--ink2); background:#fff;}
.om-confirm .om-danger{flex:1; justify-content:center; margin:0;}

/* toast */
.om-toast{position:fixed; bottom:22px; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff;
  padding:12px 20px; border-radius:13px; font-size:13px; font-weight:700; z-index:50; box-shadow:0 8px 24px rgba(0,0,0,.25);
  animation:toastin .25s ease;}
@keyframes toastin{from{opacity:0; transform:translate(-50%,10px);}to{opacity:1; transform:translate(-50%,0);}}

button:focus-visible{outline:2.5px solid var(--accent); outline-offset:2px;}
@media (prefers-reduced-motion:reduce){*{animation:none !important; transition:none !important;}}
@media (max-width:520px){ .om-chip-name{max-width:120px;} }
`;
