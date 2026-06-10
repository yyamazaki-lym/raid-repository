/**
 * 過去 / 未来表示の境界に使う「JST 今日 0:00」を UTC ms で返す共通ヘルパー。
 *
 * 過去詳細テーブル (schedule-list.tsx の `splitSessions`) と過去簡易チップ
 * (schedule-past-simple.tsx) の past 判定をここに一本化する (2.7, 2026-06-11)。
 * 以前は簡易側だけ `Date.now() - 6h` (NextSessionCard の STILL_RELEVANT_MS と
 * 同じグレース) を使っていたため、開催翌日の JST 0:00〜開始時刻+6h の間
 * 「詳細テーブルには出るが簡易チップには出ない」不一致が起きていた。
 * 逆に時刻未入力の日付 (JST 00:00 扱い) は当日朝 6:00 から簡易だけに
 * 出る不一致もあり、cutoff を揃えることで双方向とも解消する。
 *
 * cutoff の意味論は TODO #80 (2.1, 2026-05-12 part4) で確定した
 * 「JST 今日 0:00 より前を past とする」をそのまま踏襲。
 * JST は DST が無いので固定 9h オフセットで常に正しい。
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function jstTodayStartMs(): number {
  // `Date.now() + 9h` の UTC フィールドが「JST の壁時計」を表すので、
  // その年月日で UTC 0:00 を組み立ててから 9h 戻すと「JST 今日 0:00 の
  // UTC instant」になる。サーバ (Vercel = UTC) / ローカル (Asia/Tokyo)
  // どちらで実行しても同じ値を返す。
  const nowJst = new Date(Date.now() + JST_OFFSET_MS);
  return (
    Date.UTC(
      nowJst.getUTCFullYear(),
      nowJst.getUTCMonth(),
      nowJst.getUTCDate(),
      0,
      0,
      0,
      0,
    ) - JST_OFFSET_MS
  );
}
