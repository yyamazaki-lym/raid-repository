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
