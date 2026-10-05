/**
 * 動画のチャプター (2026-10-05、F-6 の C-2)。
 *
 * 練習ログの pull と動画のオフセットから、YouTube の説明欄に貼るとチャプター
 * になる文字を作る (例: `0:00 開始前` / `2:13 #1 1層 残42.0%` …)。投稿する
 * 人が動画を見ながら区切りを打つ手間を消すのが目的。動画の時刻は pull 行の
 * リンクと同じ式 (`videoSecondsForPull`) で出すので、リンクとずれない。
 *
 * ## YouTube のチャプターの決まり (公式ヘルプ)
 *
 * - 最初の時刻は `0:00`
 * - 3 つ以上
 * - それぞれ 10 秒以上
 *
 * これを満たすように、10 秒未満で次の pull が始まったものは前のチャプターに
 * まとめ (その pull の名前は出ない)、最初の pull が 10 秒より後なら `0:00` に
 * 「開始前」を置き、10 秒未満なら最初の pull を `0:00` にずらす。3 つに
 * 満たなければ作らない (null)。動画の長さは分からないので、最後のチャプター
 * が 10 秒以上あるかは見ない。
 *
 * `@/` を import しない純モジュール (`scripts/check-video-chapters.mjs`)。
 */
import { formatClock } from "./fflogs-url";
import {
  floorLabel,
  formatPercentage,
  type FightRow,
  type FloorMap,
  type ProgressLocale,
} from "./fflogs-progress";
import { isBeforeVideoStart, videoSecondsForPull } from "./video-sync";

export const YOUTUBE_CHAPTER_MIN_SECONDS = 10;
export const YOUTUBE_CHAPTER_MIN_COUNT = 3;

export type ChapterPull = {
  /** 戦闘開始 (epoch ms)。 */
  startMs: number;
  /** チャプターの名前 (`chapterPullLabel`)。 */
  label: string;
};

/**
 * pull 1 つのチャプターの名前。`#回数 区間 結果` (例: `#3 4層後半 残23.4%` /
 * `#9 P5 CLEAR`)。回数は練習ログの日の行の番号と同じものを渡す。
 */
export function chapterPullLabel(
  fight: FightRow,
  index: number,
  floors: FloorMap,
  showPhase: boolean,
  locale: ProgressLocale = "ja",
): string {
  let segment = "";
  if (showPhase) {
    if (fight.lastPhase !== null) segment = `P${fight.lastPhase}`;
  } else if (floors && fight.encounterId !== null) {
    const floor = floors.byEncounter.get(fight.encounterId);
    if (floor !== undefined) segment = floorLabel(floors, floor, locale);
  }
  // 討伐は層を問わず CLEAR (pull 行の結果チップと同じ)。
  let result = "";
  if (fight.kill) result = "CLEAR";
  else if (fight.fightPercentage !== null) {
    const pct = formatPercentage(fight.fightPercentage);
    result = locale === "en" ? `${pct} left` : `残${pct}`;
  }
  return [`#${index}`, segment, result].filter((s) => s.length > 0).join(" ");
}

/**
 * チャプターの行を作る。作れない (YouTube の決まりを満たす数が無い) ときは null。
 *
 * @param pulls             そのレポートの pull (順不同)
 * @param offsetSeconds     その動画のオフセット
 * @param firstPullStartMs  そのレポートの pull #1 (画面と同じ定義)
 * @param introLabel        `0:00` に置く「開始前」の名前
 */
export function buildYoutubeChapters(
  pulls: ReadonlyArray<ChapterPull>,
  offsetSeconds: number,
  firstPullStartMs: number,
  introLabel: string,
): string[] | null {
  const visible = pulls
    .map((p) => ({
      seconds: videoSecondsForPull(offsetSeconds, p.startMs, firstPullStartMs),
      label: p.label,
    }))
    .filter((p) => Number.isFinite(p.seconds) && !isBeforeVideoStart(p.seconds))
    .map((p) => ({ seconds: Math.floor(p.seconds), label: p.label }))
    .sort((a, b) => a.seconds - b.seconds);

  const chapters: Array<{ seconds: number; label: string }> = [];
  for (const p of visible) {
    const prev = chapters[chapters.length - 1];
    if (prev && p.seconds - prev.seconds < YOUTUBE_CHAPTER_MIN_SECONDS) continue;
    chapters.push(p);
  }
  if (chapters.length === 0) return null;
  if (chapters[0]!.seconds >= YOUTUBE_CHAPTER_MIN_SECONDS) {
    chapters.unshift({ seconds: 0, label: introLabel });
  } else {
    chapters[0] = { ...chapters[0]!, seconds: 0 };
  }
  if (chapters.length < YOUTUBE_CHAPTER_MIN_COUNT) return null;
  return chapters.map((c) => `${formatClock(c.seconds)} ${c.label}`);
}
