/**
 * セッションサマリー (W-3) / チーム実績バッジ (W-31) / 層ごとの初討伐 (L-1)。
 * 2026-09-07〜08。
 *
 * どれも `fflogs_fights` に既に入っている列 (start_ms / end_ms / kill /
 * deaths / encounter_id) の集計だけで、新しい取得は要らない。
 *
 * ## W-3 セッションサマリー
 *
 * 「拘束時間のうち、実際に戦っていたのはどれくらいか」を日ごとに出す。
 * 固定運営で議論になるのは「22:00 開始で 2 時間やって何本回せたか」なので、
 * pull 数だけでなく **ダウンタイム比**と**平均プル長**を並べる。
 *
 * ⚠ 「ダウンタイム」には休憩・解説・作戦会議・リセット待ちが全部混ざる。
 * 「無駄な時間」ではないので、UI の文言は「戦闘外」に寄せる (調査ノート
 * 第 4 回 W-3 の「文言で吸収」)。
 *
 * ## W-31 チーム実績バッジ
 *
 * **個人ではなくチームの実績**だけを出す (個人 DPS / 出席率のランキングを
 * 作らないという方針と整合)。種類は 4 つに絞る — バッジを乱発すると
 * 陳腐化して誰も見なくなる (調査ノートのデメリット欄)。
 *
 * ## L-1 層ごとの初討伐
 *
 * W-31 の「初討伐」はティア全体で 1 つだけなので、零式では「3 層をいつ
 * 抜けたか」が残らない。層ごとに初討伐の日時 / pull 数 / 所要時間を出す
 * (絶の「各フェーズへの初到達」= `firstPhaseReaches` の層版)。詳細は
 * `floorFirstClears` の docstring。
 *
 * 検証: `node scripts/check-fflogs-session.mjs`
 */

/** 集計に必要な最小の pull 情報 (`FightRow` の部分集合)。 */
export type SessionFight = {
  startMs: number;
  endMs: number;
  kill: boolean;
  /** PT の死亡数。未取得は null。 */
  deaths: number | null;
  /** JST 暦日 `YYYY-MM-DD`。バッジの日付表示に使う。 */
  sessionDate?: string | null;
};

/**
 * pull の間の休憩を数える上限 (1 回あたり、2026-10-07 ユーザーの選択)。
 *
 * 拘束 (`sessionSummary`) とログ合計 (`totalLogMs`) で共通。以前のログ合計は
 * 「3 時間以上空いたら区切る」で、休憩が 3 時間の前後で値が約 3 時間跳ねて
 * いた。上限で切れば跳ねず、2 部制の日は間の 60 分だけ、複数日分を 1 本で
 * 上げたログでも夜の分は 60 分だけ入る。
 */
export const BREAK_CAP_MS = 60 * 60 * 1000;

/** 区間の和集合の長さ (重なる区間・接する区間は 1 回だけ数える)。 */
export function unionLengthMs(
  spans: ReadonlyArray<{ start: number; end: number }>,
): number {
  const sorted = [...spans]
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = Number.NaN;
  let curEnd = Number.NaN;
  for (const s of sorted) {
    const end = Math.max(s.start, s.end);
    if (Number.isNaN(curStart)) {
      curStart = s.start;
      curEnd = end;
    } else if (s.start <= curEnd) {
      if (end > curEnd) curEnd = end;
    } else {
      total += curEnd - curStart;
      curStart = s.start;
      curEnd = end;
    }
  }
  if (!Number.isNaN(curStart)) total += curEnd - curStart;
  return total;
}

/**
 * pull の区間と、pull の間の休憩の区間 (休憩の始まりから 1 回 `capMs` まで)。
 * 和集合の長さを取ると「pull の時間 + 休憩 (上限つき)」になる。pull が
 * 重なっていても (同じ時間帯のログが 2 本) 休憩は重なりを除いた時間で測る。
 */
export function cappedBreakIntervals(
  pulls: ReadonlyArray<{ start: number; end: number }>,
  capMs: number = BREAK_CAP_MS,
): Array<{ start: number; end: number }> {
  const sorted = pulls
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end))
    .map((p) => ({ start: p.start, end: Math.max(p.start, p.end) }))
    .sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  let runEnd = Number.NaN;
  for (const p of sorted) {
    if (!Number.isNaN(runEnd) && p.start > runEnd) {
      out.push({ start: runEnd, end: Math.min(p.start, runEnd + capMs) });
    }
    out.push(p);
    runEnd = Number.isNaN(runEnd) ? p.end : Math.max(runEnd, p.end);
  }
  return out;
}

export type SessionSummary = {
  /**
   * 拘束時間 (ms) = pull の時間 + pull の間の休憩 (1 回 `BREAK_CAP_MS` まで)。
   * 2026-10-07 までは「最初の pull の開始から最後の pull の終了まで」で、
   * 複数日分を 1 本で上げたログでは夜の分まで入っていた。
   */
  spanMs: number;
  /** 実戦闘時間 (ms) = 各 pull の戦闘時間の合計。 */
  fightMs: number;
  /** 戦闘外時間 (ms) = 拘束 − 実戦闘。休憩・解説・リセット待ちを含む。 */
  downtimeMs: number;
  /** 戦闘外の割合 (0-1)。拘束が 0 のときは 0。 */
  downtimeRatio: number;
  pulls: number;
  kills: number;
  /** kill でない pull の数。 */
  wipes: number;
  /** 平均プル長 (ms)。pull が 0 なら 0。 */
  avgPullMs: number;
};

/**
 * 1 セッション (= 1 日) のサマリー。
 *
 * 拘束時間は「pull の時間 + pull の間の休憩 (1 回 `BREAK_CAP_MS` まで)」。
 * 休憩が上限より短い日は、従来どおり「最初の pull の**開始**から最後の pull の
 * **終了**まで」と同じ値。集合や休憩開始からではないので、実際の拘束よりは
 * 短く出る — pull の外はログに現れないため、これが観測できる上限。
 *
 * pull の順序は問わない (並べ替えてから数える)。
 */
export function sessionSummary(
  fights: ReadonlyArray<SessionFight>,
): SessionSummary {
  const empty: SessionSummary = {
    spanMs: 0,
    fightMs: 0,
    downtimeMs: 0,
    downtimeRatio: 0,
    pulls: 0,
    kills: 0,
    wipes: 0,
    avgPullMs: 0,
  };
  const valid = fights.filter(
    (f) => Number.isFinite(f.startMs) && Number.isFinite(f.endMs),
  );
  if (valid.length === 0) return empty;

  // 2026-10-07: 休憩は 1 回 60 分まで (ログ合計と同じ数え方。ユーザーの選択)。
  const spanMs = unionLengthMs(
    cappedBreakIntervals(valid.map((f) => ({ start: f.startMs, end: f.endMs }))),
  );
  const fightMs = valid.reduce(
    (acc, f) => acc + Math.max(0, f.endMs - f.startMs),
    0,
  );
  // 実戦闘が拘束を超えることは理屈上ないが、pull が重なって記録されている
  // (別 PT のログが混ざった等) 場合に負の戦闘外時間を出さないよう clamp。
  const downtimeMs = Math.max(0, spanMs - fightMs);
  const kills = valid.filter((f) => f.kill).length;
  return {
    spanMs,
    fightMs,
    downtimeMs,
    downtimeRatio: spanMs > 0 ? downtimeMs / spanMs : 0,
    pulls: valid.length,
    kills,
    wipes: valid.length - kills,
    avgPullMs: Math.round(fightMs / valid.length),
  };
}

/** バッジの種類。増やすときは「チームの実績か」を必ず確認する。 */
export type TeamBadgeKind =
  /** 初討伐 (時系列で最初の kill)。 */
  | "firstClear"
  /** ノーデス討伐 (deaths === 0 の kill)。 */
  | "flawless"
  /** 討伐回数 (2 回以上のときだけ)。 */
  | "clears"
  /** 最速討伐 (戦闘時間が最短の kill)。 */
  | "fastestClear";

export type TeamBadge = {
  kind: TeamBadgeKind;
  /** バッジに添える数値 (回数 / 秒数)。無い種類は null。 */
  value: number | null;
  /** 達成した日 (`YYYY-MM-DD`)。取れなければ null。 */
  date: string | null;
};

/**
 * チーム実績バッジ (W-31)。討伐が 1 つも無ければ空配列。
 *
 * 並びは firstClear → flawless → fastestClear → clears で固定する
 * (「初討伐」が先頭に来るのが読み手の期待。回数は最後の補足情報)。
 *
 * `flawless` は **deaths を取得できている kill のみ**を見る。未取得
 * (null) を 0 と見なすと、古い pull が全部「ノーデス討伐」になってしまう。
 *
 * ## 何を「討伐」と数えるか (2026-10-05)
 *
 * `isClear` で決める (既定は kill = 絶など区間の無いコンテンツ向け)。零式では
 * 練習ログの画面が **最終層の kill** (`isClearFight(f, floors)`) を渡す。以前は
 * kill をそのまま数えていたため、零式では 1〜3 層の討伐が「初討伐」「最速討伐」
 * 「討伐回数」に入り、初討伐が下の層を初めて倒した日になっていた (demo: バッジは
 * 7/22、最終層の初討伐は 9/3)。サマリーのクリア数 (`summarize` / `totalClears`) と
 * 同じ数え方にそろえる。層ごとの節目は L-1 (`floorFirstClears`) が別に出す。
 * このファイルは `fflogs-progress.ts` の型を引かない方針なので、判定は関数で受ける。
 */
export function teamBadges<T extends SessionFight>(
  fights: ReadonlyArray<T>,
  isClear: (f: T) => boolean = (f) => f.kill,
): TeamBadge[] {
  const kills = fights
    .filter((f) => isClear(f) && Number.isFinite(f.startMs) && Number.isFinite(f.endMs))
    .sort((a, b) => a.startMs - b.startMs);
  if (kills.length === 0) return [];

  const out: TeamBadge[] = [];

  const first = kills[0]!;
  out.push({
    kind: "firstClear",
    value: null,
    date: first.sessionDate ?? null,
  });

  // deaths が取れている kill だけを対象にする (null を 0 扱いしない)。
  const flawless = kills.find((f) => f.deaths === 0);
  if (flawless) {
    out.push({
      kind: "flawless",
      value: null,
      date: flawless.sessionDate ?? null,
    });
  }

  const fastest = kills.reduce((best, f) =>
    f.endMs - f.startMs < best.endMs - best.startMs ? f : best,
  );
  out.push({
    kind: "fastestClear",
    value: Math.max(0, Math.round((fastest.endMs - fastest.startMs) / 1000)),
    date: fastest.sessionDate ?? null,
  });

  // 1 回だけなら「初討伐」と同じ情報なので出さない。
  if (kills.length > 1) {
    out.push({
      kind: "clears",
      value: kills.length,
      date: kills[kills.length - 1]!.sessionDate ?? null,
    });
  }
  return out;
}

/** バッジの配色。種類ごとに固定 (ラベルと 1:1 で覚えられるように)。 */
export function teamBadgeToneClass(kind: TeamBadgeKind): string {
  switch (kind) {
    case "firstClear":
      return "border-emerald-400/45 bg-emerald-400/10 text-emerald-200";
    case "flawless":
      return "border-amber-400/45 bg-amber-400/10 text-amber-200";
    case "fastestClear":
      return "border-sky-400/45 bg-sky-400/10 text-sky-200";
    case "clears":
      return "border-violet-400/45 bg-violet-400/10 text-violet-200";
  }
}

/**
 * 層ごとの初討伐に必要な最小の pull 情報 (L-1、2026-09-08)。
 *
 * 層 index は呼び出し側が `FloorMap.byEncounter` で解決して渡す — ここで
 * `fflogs-progress.ts` の型を引くと、単体コンパイルで検証する方針
 * (`scripts/check-fflogs-session.mjs`) が崩れるため。層クラスタ外の pull は
 * 呼び出し側で除外済みとする (`filterToFloorCluster`)。
 */
export type FloorClearFight = {
  startMs: number;
  endMs: number;
  kill: boolean;
  /** 層 index (1 始まり)。前半 / 後半に分かれる層は別 index。 */
  floorIndex: number;
  /** JST 暦日 `YYYY-MM-DD`。無ければ null (表示側が startMs で補う)。 */
  sessionDate?: string | null;
};

/** 表示用: ある層を初めて討伐した時点 (L-1、2026-09-08)。 */
export type FloorFirstClear = {
  /** 層 index (1 始まり)。表示ラベルは呼び出し側が `floorLabel` で引く。 */
  index: number;
  /**
   * **その層の**累計戦闘時間 (ms、討伐した pull 自身を含む)。絶の
   * 「初到達まで」と同じ意味の値だが、母数がフェーズではなく層になる。
   */
  ms: number;
  /** その層で何本目の pull だったか (1 始まり)。 */
  pulls: number;
  /** ティア全体で何本目の pull だったか (1 始まり)。層を行き来する零式向け。 */
  overallPulls: number;
  /** 初討伐の日 (`YYYY-MM-DD`)。取れなければ null。 */
  date: string | null;
  /** 初討伐 pull の開始時刻 (ms)。hover に実時刻を出すのに使う。 */
  startMs: number;
};

/**
 * 層ごとの初討伐 (L-1、2026-09-08 実機要望)。
 *
 * 絶には「各フェーズへの初到達」(`firstPhaseReaches`) があるのに、零式には
 * 層ごとの節目が無く、チーム実績バッジの「初討伐」もティア全体で 1 つだけ
 * だった。層フィルタがあるのだから層ごとに出す、というのがこの関数。
 *
 * ## pull 数を 2 つ返す理由
 *
 * 零式は**層を行き来する** (4 層で詰まっている間に 1〜3 層を消化で回す) ので、
 * 「その層に何本かけたか」(`pulls`) が実態に合う。一方で絶の「初到達まで」は
 * ティア開始からの通し番号なので、一貫性のために通算 (`overallPulls`) も返す。
 * どちらを前に出すかは表示側の判断 (`floor-clear-card.tsx`)。
 *
 * ## 数え方
 *
 * 入力は順不同で良い (ここで開始時刻の昇順に並べ替える)。討伐した pull 自身を
 * 含めて数える (絶の `firstPhaseReaches` と同じ)。同じ層の 2 回目以降の討伐は
 * 無視する。討伐が 1 度も無い層は返さない — 「未討伐」の行を並べても
 * 「まだ倒していない」以上の情報が無く、層フィルタのチップで足りる。
 */
export function floorFirstClears(
  fights: ReadonlyArray<FloorClearFight>,
): FloorFirstClear[] {
  const sorted = [...fights]
    .filter(
      (f) =>
        Number.isFinite(f.startMs) &&
        Number.isFinite(f.endMs) &&
        Number.isFinite(f.floorIndex),
    )
    .sort((a, b) => a.startMs - b.startMs);
  const out = new Map<number, FloorFirstClear>();
  const perFloorMs = new Map<number, number>();
  const perFloorPulls = new Map<number, number>();
  let overall = 0;
  for (const f of sorted) {
    overall += 1;
    const ms = (perFloorMs.get(f.floorIndex) ?? 0) + Math.max(0, f.endMs - f.startMs);
    const pulls = (perFloorPulls.get(f.floorIndex) ?? 0) + 1;
    perFloorMs.set(f.floorIndex, ms);
    perFloorPulls.set(f.floorIndex, pulls);
    if (!f.kill || out.has(f.floorIndex)) continue;
    out.set(f.floorIndex, {
      index: f.floorIndex,
      ms,
      pulls,
      overallPulls: overall,
      date: f.sessionDate ?? null,
      startMs: f.startMs,
    });
  }
  return [...out.values()].sort((a, b) => a.index - b.index);
}
