/**
 * 死亡の直前を読む (W-8、2026-09-08) の純粋ロジック。
 *
 * FFLogs の `report.events(dataType: Deaths, includeResources: true)` は
 * 死亡イベント 1 件ごとに **その瞬間の HP / シールド / かかっていた効果**
 * を返す。ここはその JSON を画面に出す形へ正規化するだけで、fetch には
 * 触らない (`scripts/check-death-leadup.mjs` で検証できるように)。
 *
 * ## 軽減率の計算はしない
 *
 * 調査ノート第 4 回 7-A W-8 のデメリット欄は **「What-if 軽減は軽減率
 * テーブルの保守が要る」**。パッチごとに率が変わる表を抱えるのは割に
 * 合わないので、**かかっていた効果を名前のまま並べる**方針にした。
 * 「軽減が乗っていなかった」は一覧に堅陣等が無いことで読める。
 *
 * 例外は **ダメージダウン (`1002911`)** の 1 つだけ。ID が固定で、
 * 「火力が出ていない理由」として毎回確認する値なので明示する。
 */

/** ダメージダウン (被弾ミス等で付く debuff)。ID は FFXIV 固定。 */
export const DAMAGE_DOWN_ABILITY_ID = 1002911;

export type LeadUpAura = {
  /** 効果名 (FFLogs が返す名前。日本語 UI でも英名で返ることがある)。 */
  name: string | null;
  id: number | null;
  /** 重ねがけの数 (無ければ null)。 */
  stacks: number | null;
};

export type LeadUpDeath = {
  /** pull 開始からの相対 ms。 */
  t: number;
  job: string | null;
  /** 致命技 (FFLogs の ability.name)。 */
  ability: string | null;
  /** 死亡時点の HP (取れなければ null)。 */
  hp: number | null;
  maxHp: number | null;
  /** 死亡時点のシールド量 (absorb)。0 は「シールド無し」。 */
  shield: number | null;
  /** 死亡時点でかかっていた効果 (名前のまま)。 */
  auras: LeadUpAura[];
  /** ダメージダウンがかかっていたか。 */
  damageDown: boolean;
};

type Rec = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * `events` の JSON から死亡の直前情報を取り出す。
 *
 * @param raw          `report.events(dataType: Deaths, includeResources: true)`
 *                     の `data` (配列) か、その親オブジェクト
 * @param fightStartMs レポート相対の pull 開始 ms (時刻を pull 相対に直す)
 * @param fightEndMs   レポート相対の pull 終了 ms
 */
export function parseDeathLeadUp(
  raw: unknown,
  fightStartMs: number,
  fightEndMs: number,
): LeadUpDeath[] {
  const events = pickEventArray(raw);
  if (!events) return [];
  const out: LeadUpDeath[] = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const ev = e as Rec;
    const ts = num(ev["timestamp"]);
    if (ts === null) continue;
    // events の timestamp はレポート相対。pull 相対に直し、範囲外は捨てる。
    const rel = ts - fightStartMs;
    if (rel < -5_000 || rel > fightEndMs - fightStartMs + 5_000) continue;
    // 死亡した側の資源。`targetResources` に無ければ `sourceResources`
    // (FFLogs は視点によってどちらにも入れる)。
    const res =
      (ev["targetResources"] as Rec | undefined) ??
      (ev["sourceResources"] as Rec | undefined) ??
      undefined;
    const abilityObj = ev["ability"] as Rec | undefined;
    const auras = extractAuras(res?.["auras"] ?? ev["auras"]);
    out.push({
      t: Math.max(0, Math.round(rel)),
      // FFXIV ではジョブ名が icon / type に入る (death_events と同じ)。
      job: str(ev["icon"]) ?? str(ev["type"]) ?? null,
      ability: abilityObj ? str(abilityObj["name"]) : null,
      hp: res ? num(res["hitPoints"]) : null,
      maxHp: res ? num(res["maxHitPoints"]) : null,
      shield: res ? num(res["absorb"]) : null,
      auras,
      damageDown: auras.some((a) => a.id === DAMAGE_DOWN_ABILITY_ID),
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** `{data: [...]}` / `{events: {data: [...]}}` / 素の配列を受ける。 */
function pickEventArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Rec;
  if (Array.isArray(r["data"])) return r["data"] as unknown[];
  const events = r["events"];
  if (events && typeof events === "object") {
    const d = (events as Rec)["data"];
    if (Array.isArray(d)) return d as unknown[];
  }
  return null;
}

function extractAuras(v: unknown): LeadUpAura[] {
  if (!Array.isArray(v)) return [];
  const out: LeadUpAura[] = [];
  const seen = new Set<number | string>();
  for (const a of v) {
    if (!a || typeof a !== "object") continue;
    const o = a as Rec;
    const id = num(o["ability"]) ?? num(o["abilityGameID"]) ?? num(o["guid"]);
    const name = str(o["name"]);
    const key = id ?? name ?? "";
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, id, stacks: num(o["stacks"]) });
  }
  return out;
}

/**
 * HP の表示 (`1234 / 56789 (2%)`)。max が無ければ実数だけ。
 *
 * 割合を添えるのは、**「即死だったのか削られていたのか」**を 1 目で
 * 分けるため (数字だけだと最大 HP を覚えていないと判断できない)。
 */
export function formatLeadUpHp(hp: number | null, maxHp: number | null): string | null {
  if (hp === null) return null;
  if (maxHp === null || maxHp <= 0) return String(hp);
  const pct = Math.round((hp / maxHp) * 100);
  return `${hp} / ${maxHp} (${pct}%)`;
}
