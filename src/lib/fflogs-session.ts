/**
 * セッションサマリー (W-3) とチーム実績バッジ (W-31)。2026-09-07。
 *
 * どちらも `fflogs_fights` に既に入っている列 (start_ms / end_ms / kill /
 * deaths) の集計だけで、新しい取得は要らない。
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

export type SessionSummary = {
  /** 拘束時間 (ms) = 最初の pull の開始から最後の pull の終了まで。 */
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
 * 拘束時間は「最初の pull の**開始**から最後の pull の**終了**まで」。
 * 集合や休憩開始からではないので、実際の拘束よりは短く出る — pull の外は
 * ログに現れないため、これが観測できる上限。
 *
 * pull の順序は問わない (呼び出し側の並びに依存しないよう min/max で取る)。
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

  const start = Math.min(...valid.map((f) => f.startMs));
  const end = Math.max(...valid.map((f) => f.endMs));
  const spanMs = Math.max(0, end - start);
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
 */
export function teamBadges(
  fights: ReadonlyArray<SessionFight>,
): TeamBadge[] {
  const kills = fights
    .filter((f) => f.kill && Number.isFinite(f.startMs) && Number.isFinite(f.endMs))
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
