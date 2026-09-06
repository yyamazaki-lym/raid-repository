/**
 * pull 単位の付帯情報 — 死亡イベントとフェーズ遷移 (2026-09-06、調査ノート
 * 第 4 回 W-1 / W-2)。純関数のみ (client / server / check script 共用)。
 *
 * **保存するもの**: FFLogs の Summary table (`deathEvents`) と fights の
 * `phaseTransitions` から、pull の開始を 0 とした相対 ms に直したもの。
 * **保存しないもの**: プレイヤー名。死亡は「ジョブ + 何の技で落ちたか」だけ
 * を持ち、誰が落ちたかは持たない (個人を序列化して表示しない、という
 * 練習ログの設計原則の延長。死亡は火力ではないが、名指しにしない粒度で
 * 「どのギミックで崩れるか」に焦点を当てる)。
 */

/** 死亡 1 件の保存形 (jsonb `death_events` の要素)。 */
export type StoredDeathEvent = {
  /** pull 開始からの ms。 */
  t: number;
  /** FFLogs のジョブ名 (例 "WhiteMage")。取れなければ null。 */
  job: string | null;
  /** 致命の一撃 (killing blow) の技名。取れなければ null。 */
  ability: string | null;
};

/** フェーズ遷移 1 件の保存形 (jsonb `phase_transitions` の要素)。 */
export type StoredPhaseTransition = {
  /** FFLogs のフェーズ ID (fights.lastPhase と同じ番号体系)。 */
  id: number;
  /** pull 開始からの ms。 */
  t: number;
};

/** 表示用: フェーズごとの滞在区間。 */
export type PhaseSpan = {
  id: number;
  /** pull 開始からの ms。 */
  start: number;
  /** 滞在時間 ms。 */
  dur: number;
};

/** 表示用: 1 pull の「崩れ方」の要約 (wipe のみ、kill は null)。 */
export type WipeSummary = {
  /** 最初の死亡の pull 開始からの ms。 */
  t: number;
  /** 最初に落ちたジョブ (FFLogs 名)。 */
  job: string | null;
  /** 最初の死亡の致命技。 */
  ability: string | null;
  /** 最初の死亡から CLUSTER_WINDOW_MS 以内の死亡数 (最初の 1 人を含む)。 */
  cluster: number;
  /** その pull の死亡総数 (ワイプコール後の巻き添え込み)。 */
  total: number;
  /** 最初の死亡が起きたフェーズ ID。遷移情報が無ければ null。 */
  phase: number | null;
};

/**
 * 「同じギミックで崩れた」とみなす窓 (ms)。Wipefest は終了 30 秒前以降の
 * 最初の死亡クラスタだけを原因として採用する。ここでは最初の死亡から
 * 10 秒以内を 1 クラスタとし、以降 (ワイプコール後の巻き添え) は
 * `total` にだけ含める。
 */
export const CLUSTER_WINDOW_MS = 10_000;

/** 保存する死亡イベントの上限 (8 人 PT で蘇生込みでも十分)。 */
const MAX_DEATH_EVENTS = 24;
/** 保存するフェーズ遷移の上限。 */
const MAX_PHASE_TRANSITIONS = 32;

/**
 * FFLogs のジョブ名 → 3 文字略称。表示は略称で行う (JP の固定でも
 * WHM / SCH などの略称は共通語)。未知は先頭 3 文字を大文字化。
 */
export const JOB_ABBR: Record<string, string> = {
  Paladin: "PLD",
  Warrior: "WAR",
  DarkKnight: "DRK",
  Gunbreaker: "GNB",
  WhiteMage: "WHM",
  Scholar: "SCH",
  Astrologian: "AST",
  Sage: "SGE",
  Monk: "MNK",
  Dragoon: "DRG",
  Ninja: "NIN",
  Samurai: "SAM",
  Reaper: "RPR",
  Viper: "VPR",
  Bard: "BRD",
  Machinist: "MCH",
  Dancer: "DNC",
  BlackMage: "BLM",
  Summoner: "SMN",
  RedMage: "RDM",
  Pictomancer: "PCT",
  BlueMage: "BLU",
};

export function jobAbbr(job: string | null | undefined): string {
  if (!job) return "—";
  const hit = JOB_ABBR[job];
  if (hit) return hit;
  // "Dark Knight" のようにスペース入りで来た場合も吸収する。
  const compact = job.replace(/[\s_-]/g, "");
  const hit2 = JOB_ABBR[compact];
  if (hit2) return hit2;
  return compact.slice(0, 3).toUpperCase() || "—";
}

/**
 * FFLogs の時刻 (レポート開始からの相対 ms) を pull 開始からの相対 ms に直す。
 *
 * Summary table の `deathTime` と fights の `phaseTransitions[].startTime` は
 * ともにレポート相対で、fight の `startTime` / `endTime` も同じ基準。念のため
 * 「既に pull 相対 (0 〜 戦闘時間) で来た」場合も受け付け、どちらにも
 * 収まらない値は捨てる (範囲外の値を保存して表示を壊さない)。
 */
export function toFightRelativeMs(
  value: number,
  fightStartMs: number,
  fightEndMs: number,
): number | null {
  if (!Number.isFinite(value)) return null;
  const duration = Math.max(0, fightEndMs - fightStartMs);
  // 戦闘終了直後の死亡 (ワイプ判定の後に倒れる) を拾うための余白。
  const slack = 5_000;
  if (value >= fightStartMs - slack && value <= fightEndMs + slack) {
    return Math.max(0, Math.round(value - fightStartMs));
  }
  if (value >= 0 && value <= duration + slack) {
    return Math.round(value);
  }
  return null;
}

/**
 * Summary table の `deathEvents` を保存形に変換する。
 * 入力は FFLogs の JSON そのまま (形が違う要素は黙って捨てる)。
 */
export function extractDeathEvents(
  deathEvents: unknown,
  fightStartMs: number,
  fightEndMs: number,
): StoredDeathEvent[] {
  if (!Array.isArray(deathEvents)) return [];
  const out: StoredDeathEvent[] = [];
  for (const raw of deathEvents) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const deathTime = numberOrNull(e["deathTime"] ?? e["timestamp"]);
    if (deathTime === null) continue;
    const t = toFightRelativeMs(deathTime, fightStartMs, fightEndMs);
    if (t === null) continue;
    // FFXIV では `icon` / `type` の両方にジョブ名が入る (WCL 由来の
    // フィールド名)。どちらか文字列であればそれを使う。
    const job =
      stringOrNull(e["icon"]) ?? stringOrNull(e["type"]) ?? null;
    const abilityRaw = e["ability"];
    const ability =
      abilityRaw && typeof abilityRaw === "object"
        ? stringOrNull((abilityRaw as Record<string, unknown>)["name"])
        : null;
    out.push({ t, job, ability });
    if (out.length >= MAX_DEATH_EVENTS) break;
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * fights の `phaseTransitions` を保存形に変換する。
 * - 時刻は pull 相対に直し、昇順に並べる
 * - 同じ ID が連続する遷移は 1 つに畳む
 * - 先頭が 0 から始まらない場合、最初のフェーズが 0 で始まったものとして
 *   補う (FFLogs が開始フェーズを遷移として含めない場合の保険)
 * 遷移が 1 件も取れなければ null。
 */
export function normalizePhaseTransitions(
  raw: unknown,
  fightStartMs: number,
  fightEndMs: number,
): StoredPhaseTransition[] | null {
  if (!Array.isArray(raw)) return null;
  const list: StoredPhaseTransition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = numberOrNull(o["id"]);
    const startTime = numberOrNull(o["startTime"] ?? o["t"]);
    if (id === null || startTime === null) continue;
    if (!Number.isInteger(id) || id < 0) continue;
    const t = toFightRelativeMs(startTime, fightStartMs, fightEndMs);
    if (t === null) continue;
    list.push({ id, t });
    if (list.length >= MAX_PHASE_TRANSITIONS) break;
  }
  if (list.length === 0) return null;
  list.sort((a, b) => a.t - b.t || a.id - b.id);
  const merged: StoredPhaseTransition[] = [];
  for (const p of list) {
    const last = merged[merged.length - 1];
    if (last && last.id === p.id) continue;
    merged.push(p);
  }
  const first = merged[0]!;
  if (first.t > 0) {
    if (first.id > 1) {
      merged.unshift({ id: first.id - 1, t: 0 });
    } else {
      first.t = 0;
    }
  }
  return merged;
}

/** 遷移列 → 滞在区間。戦闘時間を超える区間は切り詰める。 */
export function phaseSpans(
  transitions: StoredPhaseTransition[] | null,
  fightDurationMs: number,
): PhaseSpan[] | null {
  if (!transitions || transitions.length === 0) return null;
  const total = Math.max(0, fightDurationMs);
  const out: PhaseSpan[] = [];
  for (let i = 0; i < transitions.length; i++) {
    const cur = transitions[i]!;
    const next = transitions[i + 1];
    const start = Math.min(cur.t, total);
    const end = Math.min(next ? next.t : total, total);
    const dur = Math.max(0, end - start);
    // 0 秒の区間 (同時刻の遷移、戦闘終了後の遷移) は表示に意味が無いので
    // 落とす。全部 0 なら null (戦闘時間 0 の壊れた行)。
    if (dur === 0) continue;
    out.push({ id: cur.id, start, dur });
  }
  return out.length > 0 ? out : null;
}

/** 時刻 t が属するフェーズ ID (遷移列から)。 */
export function phaseAt(
  transitions: StoredPhaseTransition[] | null,
  t: number,
): number | null {
  if (!transitions || transitions.length === 0) return null;
  let cur: number | null = null;
  for (const p of transitions) {
    if (p.t <= t) cur = p.id;
    else break;
  }
  return cur;
}

/**
 * 死亡イベント列 → ワイプ原因の要約。kill の pull や死亡 0 の pull は null。
 */
export function summarizeWipe(
  deaths: StoredDeathEvent[] | null,
  transitions: StoredPhaseTransition[] | null,
  kill: boolean,
): WipeSummary | null {
  if (kill || !deaths || deaths.length === 0) return null;
  const sorted = [...deaths].sort((a, b) => a.t - b.t);
  const first = sorted[0]!;
  const cluster = sorted.filter((d) => d.t - first.t <= CLUSTER_WINDOW_MS).length;
  return {
    t: first.t,
    job: first.job,
    ability: first.ability,
    cluster,
    total: sorted.length,
    phase: phaseAt(transitions, first.t),
  };
}

/** ワイプ原因の表示ラベル (`WHM ← 技名 +2` の形)。 */
export function formatWipeLabel(w: WipeSummary): string {
  const extra = w.cluster > 1 ? ` +${w.cluster - 1}` : "";
  const ability = w.ability ?? "不明";
  return `${jobAbbr(w.job)} ← ${ability}${extra}`;
}

export type WipeCauseCount = { ability: string; count: number };

/**
 * 複数 pull のワイプ原因を技名で集計する (多い順、同数は名前順)。
 * 「どのギミックで一番崩れているか」の 1 行サマリ用。
 */
export function wipeCauseCounts(
  wipes: Array<WipeSummary | null | undefined>,
  limit = 5,
): WipeCauseCount[] {
  const counts = new Map<string, number>();
  for (const w of wipes) {
    if (!w) continue;
    const key = w.ability ?? "不明";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ability, count]) => ({ ability, count }))
    .sort((a, b) => b.count - a.count || a.ability.localeCompare(b.ability, "ja"))
    .slice(0, limit);
}

export type PhaseTimeTotal = { id: number; ms: number; share: number };

/**
 * 複数 pull のフェーズ滞在時間を合計する (フェーズ ID 昇順)。
 * `share` は全体に対する割合 (0-1)。区間情報の無い pull は無視する。
 */
export function phaseTimeTotals(
  spansList: Array<PhaseSpan[] | null | undefined>,
): PhaseTimeTotal[] {
  const totals = new Map<number, number>();
  let all = 0;
  for (const spans of spansList) {
    if (!spans) continue;
    for (const s of spans) {
      totals.set(s.id, (totals.get(s.id) ?? 0) + s.dur);
      all += s.dur;
    }
  }
  if (all <= 0) return [];
  return [...totals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, ms]) => ({ id, ms, share: ms / all }));
}

/** ms → `m:ss` / `h:mm:ss`。 */
export function formatMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
