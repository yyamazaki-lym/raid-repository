/**
 * ミス注釈のタグ語彙と集計 (W-7、2026-09-08)。
 *
 * FFLogs は「何が起きたか」(誰がいつ何で落ちたか) までしか持たない。
 * そこに人の判断 (「なぜ崩れたか」) を重ねるのが W-7 の狙いで、
 * **自由記述ではなく選択式**にしてある — 自由記述は集計できず、
 * 「傾向」を出せないため。
 *
 * ## 帰属の既定はチーム
 *
 * 調査ノート第 4 回 7-A W-7 のデメリット欄は **「個人責任の可視化は
 * 雰囲気悪化の恐れ」**。既定は `team` (誰のせいでもない) で、`self` は
 * **本人が自分に付けるときだけ**使える (他人に個人タグは付けられない)。
 *
 * ## 語彙を DB で縛らない
 *
 * `fflogs_pull_notes.tag` は 32 文字の自由文字列。語彙を増やすたびに
 * schema を触ると、デプロイ順の食い違いで新タグが弾かれる。集計は
 * この既知リストとの突き合わせで行い、**知らないタグは「その他」に
 * 落とす** (`attendance-summary.ts` の記号と同じ方針)。
 *
 * 検証: `node scripts/check-pull-note-tags.mjs`
 */

/** タグ id (DB に入る値)。**変えると既存の注釈が「その他」に落ちる。** */
export const PULL_NOTE_TAG_IDS = [
  "aoe-hit",
  "mit-missing",
  "switch-late",
  "position",
  "knockback",
  "add-handling",
  "heal-timing",
  "call-missed",
  "downtime",
  "other",
] as const;

export type PullNoteTagId = (typeof PULL_NOTE_TAG_IDS)[number];

const TAG_SET = new Set<string>(PULL_NOTE_TAG_IDS);

export function isPullNoteTagId(v: unknown): v is PullNoteTagId {
  return typeof v === "string" && TAG_SET.has(v);
}

/** 帰属。`self` は本人が自分に付けたタグ。 */
export type PullNoteScope = "team" | "self";

export function isPullNoteScope(v: unknown): v is PullNoteScope {
  return v === "team" || v === "self";
}

export type PullNote = {
  id: string;
  reportCode: string;
  fightId: number;
  /** 既知リスト外は "other" に寄せずそのまま持つ (表示側でラベルを補う)。 */
  tag: string;
  scope: PullNoteScope;
  /** `scope === "self"` のときの本人のメンバーキー。 */
  discordUserId: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: string;
};

export type TagCount = { tag: string; count: number };

/**
 * タグごとの件数 (多い順、同数は語彙の並び順 → id 順)。
 *
 * 語彙の並び順を第 2 キーにするのは、同数のときに表示順が実行ごとに
 * 揺れないようにするため (`Map` の挿入順に依存させない)。
 */
export function countPullNoteTags(
  notes: ReadonlyArray<Pick<PullNote, "tag">>,
): TagCount[] {
  const counts = new Map<string, number>();
  for (const n of notes) {
    const key = n.tag.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order = new Map<string, number>(
    PULL_NOTE_TAG_IDS.map((t, i) => [t, i]),
  );
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (order.get(a.tag) ?? 999) - (order.get(b.tag) ?? 999) ||
        a.tag.localeCompare(b.tag),
    );
}

/** 傾向の行の hover に出す注釈 1 件ぶん (2026-10-06)。 */
export type PullNoteDetail = {
  /** pull の日 (`YYYY-MM-DD`、日ごとの行と同じセッションの日)。明細に無ければ null。 */
  date: string | null;
  /** pull の開始時刻 (ms)。明細に無ければ null。 */
  startMs: number | null;
  /** ティア通算で何本目の pull か (1 始まり)。数えられなければ null。 */
  overallPulls: number | null;
  /** 一言メモ (空白だけなら null)。 */
  note: string | null;
};

/**
 * タグごとの注釈の明細 (2026-10-06 実機要望「ミス注釈の傾向はマウスオーバー
 * なりで見えるようにしてほしい」)。傾向の行は件数しか出さないので、
 * 「どの pull に付いたか」と一言メモを hover で引けるようにする。
 *
 * - 日時は明細 (`fights`) から引く。明細が打ち切られて (`truncated`) 古い pull
 *   が無いときは null (注釈の作成日時で代用しない — pull の日時と取り違える)
 * - ティア通算の番号は `numbered` (ティアの明細) を開始時刻の昇順に数える。
 *   初討伐カード (`floorFirstClears`) と同じ数え方。⚠ 明細が打ち切られている
 *   ときは呼び出し側が null を渡す (古い pull が落ちて番号が過小になる)
 * - 並びは新しい pull が先。日時の分からない注釈は後ろ (作成の新しい順)
 * - 振り分けるだけで、帰属 (`scope`) では絞らない (呼び出し側が渡したものを出す)
 */
export function pullNoteDetailsByTag(
  notes: ReadonlyArray<PullNote>,
  fights: ReadonlyArray<{
    reportCode: string;
    fightId: number;
    sessionDate: string | null;
    startMs: number;
  }>,
  numbered: ReadonlyArray<{ reportCode: string; fightId: number; startMs: number }> | null,
): Map<string, PullNoteDetail[]> {
  const keyOf = (reportCode: string, fightId: number) => `${reportCode}\u0000${fightId}`;
  const fightByKey = new Map(fights.map((f) => [keyOf(f.reportCode, f.fightId), f]));
  const overallByKey = new Map<string, number>();
  if (numbered) {
    [...numbered]
      .filter((f) => Number.isFinite(f.startMs))
      .sort((a, b) => a.startMs - b.startMs)
      .forEach((f, i) => overallByKey.set(keyOf(f.reportCode, f.fightId), i + 1));
  }
  const rows = notes
    .filter((n) => n.tag.trim())
    .map((n) => {
      const key = keyOf(n.reportCode, n.fightId);
      const fight = fightByKey.get(key);
      const startMs = fight && Number.isFinite(fight.startMs) ? fight.startMs : null;
      const note = (n.note ?? "").replace(/\s+/g, " ").trim();
      return {
        tag: n.tag.trim(),
        createdAt: n.createdAt,
        detail: {
          date: fight ? fight.sessionDate : null,
          startMs,
          overallPulls: overallByKey.get(key) ?? null,
          note: note || null,
        } satisfies PullNoteDetail,
      };
    })
    .sort((a, b) => {
      const sa = a.detail.startMs;
      const sb = b.detail.startMs;
      if (sa !== null && sb !== null) return sb - sa;
      if (sa !== null) return -1;
      if (sb !== null) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  const out = new Map<string, PullNoteDetail[]>();
  for (const r of rows) {
    const list = out.get(r.tag);
    if (list) list.push(r.detail);
    else out.set(r.tag, [r.detail]);
  }
  return out;
}

/**
 * hover (`title`) に出す行を、行数と文字数の両方で切って 1 つの文字列にする
 * (2026-10-06)。
 *
 * ⚠ **Windows の Chromium (Chrome / Edge) は `title` を 1024 文字 (UTF-16) で
 * 切る** (`ui/views/corewm/tooltip_state_manager.cc` の `kMaxTooltipLength`。
 * 他の OS は 2048)。行数だけで切ると、メモが長いときに末尾の行と
 * 「ほか N 件」が黙って消え、何件見えていないかが分からなくなる。
 * `maxChars` に収まる行だけを出し、出せなかった件数は必ず最後の 1 行に残す。
 * 1 行目は長くても出す (何も出ないよりよい。呼び出し側がメモを切って
 * 1 行を短く保つ)。`total` は全体の件数 (`lines` を上限ぶんだけ作って
 * 渡すとき。省略すると `lines.length`)。
 */
export function fitTooltipLines(
  lines: ReadonlyArray<string>,
  opts: { maxLines: number; maxChars: number; more: (n: number) => string; total?: number },
): string {
  const total = Math.max(opts.total ?? lines.length, lines.length);
  const out: string[] = [];
  let used = 0;
  for (const line of lines.slice(0, opts.maxLines)) {
    const rest = total - out.length - 1;
    // この行を入れた後に「ほか N 件」が要るなら、その分も残しておく。
    const reserve = rest > 0 ? opts.more(rest).length + 1 : 0;
    const next = used + (out.length > 0 ? 1 : 0) + line.length;
    if (out.length > 0 && next + reserve > opts.maxChars) break;
    out.push(line);
    used = next;
  }
  const hidden = total - out.length;
  if (hidden > 0) out.push(opts.more(hidden));
  return out.join("\n");
}

/**
 * Discord に貼る振り返りの本文 (W-7 の「Discord 用サマリ生成」)。
 *
 * ⚠ **個人タグ (`self`) は本文に出さない。** 本人が自分用に付けた印を
 * チャンネルへ流すのは意図と違う (自分で見返すためのもの)。件数だけを
 * 末尾に添えて「個人メモが N 件ある」ことは分かるようにする。
 *
 * @param header 1 行目に出す見出し (日付やコンテンツ名。呼び出し側が組む)
 * @param labelOf タグ id → 表示ラベル (i18n は呼び出し側の責務)
 */
export function buildPullNotesDigest({
  header,
  notes,
  labelOf,
  selfLabel,
  emptyLabel,
}: {
  header: string;
  notes: ReadonlyArray<PullNote>;
  labelOf: (tag: string) => string;
  /** 「個人メモ N 件」の書式。 */
  selfLabel: (n: number) => string;
  /** チーム帰属の注釈が 1 件も無いときの 1 行。 */
  emptyLabel: string;
}): string {
  const team = notes.filter((n) => n.scope === "team");
  const selfCount = notes.length - team.length;
  const lines: string[] = [header];
  for (const c of countPullNoteTags(team)) {
    lines.push(`- ${labelOf(c.tag)} ×${c.count}`);
  }
  // 一言メモはタグの集計とは別に、そのまま並べる (人が書いた文なので
  // 要約しない)。チーム帰属のものだけ。
  for (const n of team) {
    const note = (n.note ?? "").trim();
    if (note) lines.push(`  - ${labelOf(n.tag)}: ${note}`);
  }
  if (team.length === 0) lines.push(emptyLabel);
  if (selfCount > 0) lines.push(selfLabel(selfCount));
  return lines.join("\n");
}
