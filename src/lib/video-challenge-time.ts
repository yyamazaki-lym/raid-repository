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
 * 2. 題名の練習の番号 (`DAY 7` / `PART7` / `7日目` / `パート7`) と、題名の日付
 *    (無ければ投稿日時の JST 暦日) が**両方とも同じ**で、さらに:
 *    - **系列が違う** (題名の数字を伏せた形が違う = 別の人・別の付け方) なら、
 *      分割の印 (前半 / 後半 / 続き など) が無く、日付と番号のほかの数字
 *      (`7-1` と `7-2`、`M3S` と `M4S`、`①` と `②`) が食い違わないとき
 *    - **系列が同じ**なら、題名がまったく同じとき (上げ直し) だけ
 *    - 日付は前後 1 日を許さない。本番で DAY 1 が「2026 09 18」、PART1 が
 *      「2026 09 19」だったのは題名の付け間違いで、ユーザーが題名を直す
 *      (2026-10-07)。1 日を許すと、Part を毎日 1 から数え直す付け方で隣の日の
 *      別の練習を消してしまう (PR のレビューで検出)
 *    - Day と Part の両方が書いてある題名 (`Day 3 Part 2`) は、両方が一致する
 *      ときだけ同じ。片方しか無い題名とは組にしない
 *    - ⚠ 絶の題名の `P1` `P2` はフェーズの意味なので Part と読まない。読むのは
 *      `DAY` / `PART` という語と `日目` / `パート` だけ
 * 3. 番号の無い動画・日付の分からない動画は、今までどおり 1 本ずつ足す
 *
 * 判定を間違えるとしても、組にしない (= 今と同じく足す) 側に倒す。結果は
 * 渡す順によらない (組を作る前に、ロケールに依存しない比較で並べる)。
 *
 * `@/` を import しない純モジュール (`scripts/check-video-challenge-time.mjs`)。
 */

export type ChallengeVideo = {
  id: string;
  title: string | null;
  url: string | null;
  durationSeconds: number | null;
  /** 投稿日時。呼び出し側は `posted_at ?? created_at` を渡す (4 か所で同じ)。 */
  postedAt: string | null;
};

export type ChallengeTimeResult = {
  /** 重複を除いた合計 (秒)。 */
  totalSeconds: number;
  /** 長さの分からない動画の本数 (組かどうかによらない。今までと同じ意味)。 */
  missing: number;
  /** 同じ練習の別の動画として数えなかった本数。 */
  duplicates: number;
  /** 数えた動画 (組の代表) の id。 */
  countedIds: Set<string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 分割の印。系列の違う動画どうしでも、これがあれば同じ練習とみなさない。 */
const SPLIT_MARKER = /前半|後半|前編|後編|続き|続編|その\d|part\s*\d+\s*[-/]\s*\d/i;

const norm = (title: string | null | undefined) =>
  (title ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

type SessionNumber = {
  key: string | null;
  values: number[];
  /** 番号の語の終わりの位置 (NFKC 後の題名で。番号が無ければ 0)。 */
  end: number;
};

function sessionNumber(title: string | null | undefined): SessionNumber {
  const t = (title ?? "").normalize("NFKC");
  let end = 0;
  const num = (m: RegExpExecArray | null) => {
    if (!m) return null;
    end = Math.max(end, m.index + m[0].length);
    return Number(m[1]);
  };
  const day =
    num(/(?<![a-z])day\s*[-_.#:]?\s*(\d{1,3})(?!\d)/i.exec(t)) ??
    num(/(\d{1,3})\s*日目/.exec(t));
  const part =
    num(/(?<![a-z])part\s*[-_.#:]?\s*(\d{1,3})(?!\d)/i.exec(t)) ??
    num(/パート\s*(\d{1,3})(?!\d)/.exec(t));
  if (day !== null && part !== null) return { key: `d${day}-p${part}`, values: [day, part], end };
  if (day !== null) return { key: `n${day}`, values: [day], end };
  if (part !== null) return { key: `n${part}`, values: [part], end };
  return { key: null, values: [], end: 0 };
}

/**
 * 題名の練習の番号。Day と Part の両方があれば `d3-p2`、片方なら `n7`、
 * 無ければ null。全角は NFKC でそろえる。
 */
export function parseSessionNumberKey(title: string | null | undefined): string | null {
  return sessionNumber(title).key;
}

/** 題名の数字を伏せた形 (同じ投稿者・同じ付け方の動画の「系列」)。 */
export function titleSeries(title: string | null | undefined): string {
  return norm(title).replace(/\d+/g, "#");
}

type TitleDate = { y: number; m: number; d: number };

function titleDate(v: Pick<ChallengeVideo, "title" | "postedAt">): {
  fromTitle: TitleDate | null;
  day: number | null;
} {
  const postedMs = v.postedAt ? Date.parse(v.postedAt) : Number.NaN;
  const postedJst = Number.isFinite(postedMs) ? new Date(postedMs + APP_UTC_OFFSET_MS) : null;
  // 全角の日付 (`２０２６ １０ ０１`) も読めるよう NFKC でそろえてから読む。
  const d = extractDateFromTitle(norm(v.title), postedJst?.getUTCFullYear());
  if (d) return { fromTitle: d, day: Date.UTC(d.y, d.m - 1, d.d) / DAY_MS };
  if (postedJst) {
    return {
      fromTitle: null,
      day:
        Date.UTC(postedJst.getUTCFullYear(), postedJst.getUTCMonth(), postedJst.getUTCDate()) /
        DAY_MS,
    };
  }
  return { fromTitle: null, day: null };
}

/** 練習日 (題名の日付 > 投稿日時の JST 暦日) を「1970-01-01 からの日数」で。 */
export function videoDayNumber(v: Pick<ChallengeVideo, "title" | "postedAt">): number | null {
  return titleDate(v).day;
}

/**
 * 日付と番号を除いた、題名に残る数字 (並べ替えた列)。`7-1` の `1`、`M3S` の
 * `3`、`①` (NFKC で `1`) など。値で 1 つずつ取り除く。
 */
function otherDigits(title: string | null | undefined, date: TitleDate | null, values: number[]): string {
  const runs = (norm(title).match(/\d+/g) ?? []).map(Number);
  const remove = [...values, ...(date ? [date.y, date.m, date.d] : [])];
  for (const r of remove) {
    const i = runs.indexOf(r);
    if (i >= 0) runs.splice(i, 1);
  }
  return runs.sort((a, b) => a - b).join(",");
}

type Item = {
  v: ChallengeVideo;
  ytId: string | null;
  key: string | null;
  day: number | null;
  series: string;
  /**
   * 題名の「番号の語まで」の書き方 (数字を伏せた形)。同じなら同じ投稿者の
   * 付け方とみなす (`sameSession`)。
   */
  scheme: string;
  normTitle: string;
  split: boolean;
  digits: string;
};

function toItem(v: ChallengeVideo): Item {
  const sn = sessionNumber(v.title);
  const td = titleDate(v);
  return {
    v,
    ytId: v.url ? parseYouTubeId(v.url) : null,
    key: sn.key,
    day: td.day,
    series: titleSeries(v.title),
    scheme: titleSeries((v.title ?? "").normalize("NFKC").slice(0, sn.end)),
    normTitle: norm(v.title),
    split: SPLIT_MARKER.test(norm(v.title)),
    digits: otherDigits(v.title, td.fromTitle, sn.values),
  };
}

/** ロケールに依存しない並び (サーバーとブラウザで同じ結果にする)。 */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 番号と日付が同じ 2 本が、同じ練習か。 */
function sameSession(a: Item, b: Item): boolean {
  // ⚠ 系列 (題名全体) が違っても、番号の語までの書き方が同じなら同じ投稿者
  // とみなす。1 本目に印を付けずに分割した (「【DAY 7】」と「【DAY 7-2】」)
  // 動画を、別の人の視点と取り違えて消さないため (PR のレビューで検出)。
  if (a.series === b.series || a.scheme === b.scheme) return a.normTitle === b.normTitle;
  if (a.split || b.split) return false;
  return a.digits === "" || b.digits === "" || a.digits === b.digits;
}

/**
 * 動画の挑戦時間を、同じ練習の動画を 1 本にまとめて合計する。
 * 呼び出し側は先に範囲 (クリアまで・選んだ動画など) を絞ってから渡す。
 */
export function challengeTime(videos: ReadonlyArray<ChallengeVideo>): ChallengeTimeResult {
  const items = videos.map(toItem);

  // 1. 同じ YouTube の動画をまとめる。代表 (番号の判定に使う 1 本) は、番号と
  //    日付の読める題名を優先し、渡す順によらず決める。
  const byYt = new Map<string, Item[]>();
  const groups: Array<{ head: Item; members: Item[] }> = [];
  for (const it of items) {
    if (!it.ytId) {
      groups.push({ head: it, members: [it] });
      continue;
    }
    const list = byYt.get(it.ytId);
    if (list) list.push(it);
    else byYt.set(it.ytId, [it]);
  }
  for (const members of byYt.values()) {
    const head = [...members].sort(
      (a, b) =>
        Number(a.key === null) - Number(b.key === null) ||
        Number(a.day === null) - Number(b.day === null) ||
        cmp(a.normTitle, b.normTitle) ||
        cmp(a.v.id, b.v.id),
    )[0]!;
    groups.push({ head, members });
  }

  // 2. 番号と日付が同じものの中で、同じ練習どうしを組にする。
  const clusters: Item[][] = [];
  const byKeyDay = new Map<string, typeof groups>();
  for (const g of groups) {
    if (g.head.key === null || g.head.day === null) {
      clusters.push(g.members);
      continue;
    }
    const k = `${g.head.key} ${g.head.day}`;
    const list = byKeyDay.get(k);
    if (list) list.push(g);
    else byKeyDay.set(k, [g]);
  }
  for (const list of byKeyDay.values()) {
    list.sort(
      (a, b) =>
        cmp(a.head.series, b.head.series) ||
        cmp(a.head.normTitle, b.head.normTitle) ||
        cmp(a.head.v.id, b.head.v.id),
    );
    const formed: Array<{ heads: Item[]; members: Item[] }> = [];
    for (const g of list) {
      const target = formed.find((c) => c.heads.every((h) => sameSession(h, g.head)));
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
  const countedIds = new Set<string>();
  const validSec = (s: number | null) =>
    typeof s === "number" && Number.isFinite(s) && s > 0 ? s : null;
  for (const it of items) if (validSec(it.v.durationSeconds) === null) missing += 1;
  for (const members of clusters) {
    let best: Item | null = null;
    for (const m of members) {
      const sec = validSec(m.v.durationSeconds);
      if (sec === null) continue;
      if (!best || sec > best.v.durationSeconds!) best = m;
    }
    if (!best) continue;
    totalSeconds += best.v.durationSeconds!;
    countedIds.add(best.v.id);
  }
  return { totalSeconds, missing, duplicates: items.length - clusters.length, countedIds };
}
