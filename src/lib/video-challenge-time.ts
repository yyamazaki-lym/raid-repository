import { APP_UTC_OFFSET_MS } from "./app-timezone";
import { extractDateFromTitle } from "./title-date";
import { parseYouTubeId } from "./youtube";

/**
 * 動画の「コンテンツ挑戦時間」の合計 (2026-10-07 実機報告「動画を複数取り込む
 * 場合、累計挑戦時間が重複して数えられる。Day が同じ、Part が同じなどは
 * どちらかを除外することは可能か」)。
 *
 * 同じ練習を 2 人が別の視点で録った動画 (本番の例: Discord 取り込みの
 * 「【2026 10 06】絶もうひとつの未来【DAY 7】」と再生リスト取り込みの
 * 「FINAL FANTASY XIV 絶エデン2026 10 06 PART7」) を両方足していたので、
 * 挑戦時間がほぼ倍になっていた。**同じ練習とみなした組は、長い方の 1 本だけ
 * 数える。**
 *
 * ## 同じ練習とみなす条件 (ユーザーの選択: 番号 + 日付)
 *
 * 1. 同じ YouTube の動画 (URL の書き方が違うだけ。`youtu.be/ID` と `watch?v=ID`)
 * 2. 題名の練習の番号 (`DAY 7` / `PART7` / `7日目` / `パート7`) が同じで、
 *    題名の日付 (無ければ投稿日時の JST 暦日) が 1 日以内
 *    - 本番では同じ練習の DAY 1 が「2026 09 18」、PART1 が「2026 09 19」と
 *      投稿者で日付が 1 日ずれていた。だから同じ日に限らない
 *    - ⚠ **同じ「系列」(題名の数字を伏せた形が同じ) どうしは、日付が違えば
 *      別の練習。** 投稿者によっては Part を毎日 1 から数え直すので、
 *      「Part 1」が 2 日続いても同じ練習ではない。系列が同じで日付も同じ
 *      ときだけ (上げ直し) 同じ練習とみなす
 *    - Day と Part の両方が書いてある題名 (`Day 3 Part 2`) は、両方が一致する
 *      ときだけ同じ。片方しか無い題名とは組にしない (数えすぎの側に倒す)
 *    - ⚠ 絶の題名の `P1` `P2` はフェーズの意味なので Part と読まない。読むのは
 *      `DAY` / `PART` という語と `日目` / `パート` だけ
 * 3. 番号の無い動画・日付の分からない動画は、今までどおり 1 本ずつ足す
 *
 * 判定を間違えるとしても、組にしない (= 今と同じく足す) 側に倒す。
 *
 * `@/` を import しない純モジュール (`scripts/check-video-challenge-time.mjs`)。
 */

export type ChallengeVideo = {
  id: string;
  title: string | null;
  url: string | null;
  durationSeconds: number | null;
  postedAt: string | null;
};

export type ChallengeTimeResult = {
  /** 重複を除いた合計 (秒)。 */
  totalSeconds: number;
  /** 長さの分からない練習の数 (組のどれにも長さが無いもの)。 */
  missing: number;
  /** 同じ練習の 2 本目以降として数えなかった動画の数。 */
  duplicates: number;
  /** 数えた動画 (組の代表) の id。 */
  countedIds: Set<string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 題名の練習の番号。Day と Part の両方があれば `d3-p2`、片方なら `n7`、
 * 無ければ null。全角は NFKC でそろえる。
 */
export function parseSessionNumberKey(title: string | null | undefined): string | null {
  const t = (title ?? "").normalize("NFKC");
  const num = (m: RegExpExecArray | null) => (m ? String(Number(m[1])) : null);
  const day =
    num(/(?<![a-z])day\s*[-_.#:]?\s*(\d{1,3})(?!\d)/i.exec(t)) ??
    num(/(\d{1,3})\s*日目/.exec(t));
  const part =
    num(/(?<![a-z])part\s*[-_.#:]?\s*(\d{1,3})(?!\d)/i.exec(t)) ??
    num(/パート\s*(\d{1,3})(?!\d)/.exec(t));
  if (day !== null && part !== null) return `d${day}-p${part}`;
  if (day !== null) return `n${day}`;
  if (part !== null) return `n${part}`;
  return null;
}

/** 題名の数字を伏せた形 (同じ投稿者・同じ付け方の動画の「系列」)。 */
export function titleSeries(title: string | null | undefined): string {
  return (title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** 練習日 (題名の日付 > 投稿日時の JST 暦日) を「1970-01-01 からの日数」で。 */
export function videoDayNumber(v: Pick<ChallengeVideo, "title" | "postedAt">): number | null {
  const postedMs = v.postedAt ? Date.parse(v.postedAt) : Number.NaN;
  const postedJst = Number.isFinite(postedMs) ? new Date(postedMs + APP_UTC_OFFSET_MS) : null;
  const d = extractDateFromTitle(v.title ?? "", postedJst?.getUTCFullYear());
  if (d) return Date.UTC(d.y, d.m - 1, d.d) / DAY_MS;
  if (postedJst) {
    return (
      Date.UTC(postedJst.getUTCFullYear(), postedJst.getUTCMonth(), postedJst.getUTCDate()) /
      DAY_MS
    );
  }
  return null;
}

type Item = {
  v: ChallengeVideo;
  ytId: string | null;
  key: string | null;
  day: number | null;
  series: string;
};

/**
 * 動画の挑戦時間を、同じ練習の動画を 1 本にまとめて合計する。
 * 呼び出し側は先に範囲 (クリアまで・選んだ動画など) を絞ってから渡す。
 */
export function challengeTime(videos: ReadonlyArray<ChallengeVideo>): ChallengeTimeResult {
  const items: Item[] = videos.map((v) => ({
    v,
    ytId: v.url ? parseYouTubeId(v.url) : null,
    key: parseSessionNumberKey(v.title),
    day: videoDayNumber(v),
    series: titleSeries(v.title),
  }));

  // 1. 同じ YouTube の動画をまとめる。
  const clusters: Item[][] = [];
  const byYt = new Map<string, Item[]>();
  const rest: Item[] = [];
  for (const it of items) {
    if (it.ytId) {
      const list = byYt.get(it.ytId);
      if (list) list.push(it);
      else byYt.set(it.ytId, [it]);
    } else {
      rest.push(it);
    }
  }
  // YouTube の組は 1 本の代表 (最初の 1 本) に置き換えて、番号の判定に回す。
  const groups: Array<{ head: Item; members: Item[] }> = [
    ...[...byYt.values()].map((members) => ({ head: members[0]!, members })),
    ...rest.map((it) => ({ head: it, members: [it] })),
  ];

  // 2. 番号 + 日付で組にする (系列の条件つき)。
  const byKey = new Map<string, typeof groups>();
  for (const g of groups) {
    if (g.head.key === null || g.head.day === null) {
      clusters.push(g.members);
      continue;
    }
    const list = byKey.get(g.head.key);
    if (list) list.push(g);
    else byKey.set(g.head.key, [g]);
  }
  for (const list of byKey.values()) {
    list.sort(
      (a, b) =>
        a.head.day! - b.head.day! ||
        a.head.series.localeCompare(b.head.series) ||
        a.head.v.id.localeCompare(b.head.v.id),
    );
    const formed: Array<{ heads: Item[]; members: Item[] }> = [];
    for (const g of list) {
      const day = g.head.day!;
      const fits = (c: { heads: Item[] }) =>
        c.heads.every(
          (h) =>
            Math.abs(h.day! - day) <= 1 &&
            (h.series !== g.head.series || h.day === day),
        );
      // 同じ日の組を優先し、無ければ前後 1 日の組に入れる。
      const candidates = formed.filter(fits);
      const target =
        candidates.find((c) => c.heads.some((h) => h.day === day)) ?? candidates[0];
      if (target) {
        target.heads.push(g.head);
        target.members.push(...g.members);
      } else {
        formed.push({ heads: [g.head], members: [...g.members] });
      }
    }
    for (const c of formed) clusters.push(c.members);
  }

  // 3. 組ごとに長い方を 1 本数える。
  let totalSeconds = 0;
  let missing = 0;
  let duplicates = 0;
  const countedIds = new Set<string>();
  for (const members of clusters) {
    let best: Item | null = null;
    for (const m of members) {
      const sec = m.v.durationSeconds;
      if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) continue;
      if (!best || sec > (best.v.durationSeconds ?? 0)) best = m;
    }
    duplicates += members.length - 1;
    if (!best) {
      missing += 1;
      continue;
    }
    totalSeconds += best.v.durationSeconds!;
    countedIds.add(best.v.id);
  }
  return { totalSeconds, missing, duplicates, countedIds };
}
