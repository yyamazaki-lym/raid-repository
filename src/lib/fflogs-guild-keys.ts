/**
 * FFLogs guild の設定キー (W-5 の前段、2026-09-07)。
 *
 * W-5「レポート自動発見」は、FFLogs の `reports(guildID:)` を定期的に
 * 引いて**動画リンクを介さずに**レポートを見つける機能。実装の前に
 * 固定内で「レポートを FFLogs の guild に上げる」運用に揃える必要がある
 * (調査ノート第 4 回 W-5 の「運用前提を固定内で合意してから」)。
 *
 * そこでまず **guild ID を記録できる場所だけ**を作る。値は現時点で
 * 取り込みに使われない — ポーリングは運用が固まってから足す。
 * 設定 UI にもその旨を明示している (期待させないため)。
 */

/** FFLogs の guild ID (数値の文字列)。空 = 未設定。 */
export const FFLOGS_GUILD_ID_KEY = "fflogs_guild_id";

/** 入力の検証。空文字は「未設定に戻す」意味で許可する。 */
export function fflogsGuildIdError(raw: string): "format" | null {
  const v = raw.trim();
  if (!v) return null;
  // FFLogs の guild ID は 10 進の整数。URL を貼られたときも弾いて
  // 「数字だけ」と気付けるようにする (URL から抽出すると、別 guild の
  // URL を貼ったときに黙って別の guild を見に行ってしまう)。
  return /^\d{1,12}$/.test(v) ? null : "format";
}
