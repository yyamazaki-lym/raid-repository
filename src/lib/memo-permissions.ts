/**
 * 日付メモを誰が編集・削除できるか (L-18、2026-09-09)。
 *
 * TODO #92 (2026-09-09) で所有者概念を入れたが、判定が UI 1 箇所に
 * 直書きされていて **RLS (`supabase/schema.sql` 7a-2) と 2 重に持つ形**
 * だった。ここに寄せて、UI とポリシーが同じ規則を指すようにする。
 *
 * ## 規則
 *
 * | 行 | 編集 | 削除 |
 * |---|---|---|
 * | 自分のメモ (`authorUserId === viewerId`) | ○ | ○ |
 * | admin | ○ | ○ |
 * | 所有者不明 (`authorUserId === null`) | ✕ | ✕ |
 * | 他人のメモ | ✕ | ✕ |
 *
 * 2026-09-09 (L-18) は所有者不明の行を「削除だけ」ログイン済みメンバーに
 * 開けていたが、**2026-10-02 のユーザー決定で閉じた** (監査 S-10)。開けて
 * いる間は、非 admin メンバー 1 人が PostgREST 直叩きで所有者不明のメモを
 * 一括削除できた。所有者不明の行の片付けは admin が行う。
 *
 * 作成は本人の ID でだけ (admin の代理作成も 2026-10-02 にやめた。S-11)。
 * 1 人が 1 つの日付に作れるのは `MEMO_PER_DATE_LIMIT` 件まで (S-3)。
 *
 * ⚠ `authorName` は所有者ではない。localStorage 由来の表示名で誰でも
 * 好きな名前を書けるので、判定に使ってはいけない (schema 7a-2 と同じ注意)。
 *
 * ⚠ `viewerId` は **demo のゲストでは null を渡すこと**。ゲストは anon key
 * なので RLS で必ず弾かれる。ここで true を返すと「押せるのに失敗する」
 * ボタンが出る (`category-link-reads.ts` の `me` と同じ正規化)。
 *
 * 検証: `node scripts/check-memo-permissions.mjs`
 */

/**
 * 1 人が 1 つの日付に作れるメモの数 (2026-10-02 のユーザー決定、監査 S-3)。
 * DB 側は schema のトリガー `schedule_session_memos_enforce_limit` が同じ値で
 * 弾く (`scripts/check-memo-permissions.mjs` が突き合わせる)。
 */
export const MEMO_PER_DATE_LIMIT = 10;

/**
 * 1 人が持てるメモの総数と本文の合計文字数 (2026-10-07 セキュリティ精査 M-3)。
 * どの日程にも無い日付で 10 件ずつ作り続けると、全員の TOP (SSR の全件取得) と
 * Realtime が膨らんだ。DB 側は同じトリガーが同じ値で弾く (ブラウザからの作成・
 * 書き換えだけ。取り込みと予定の日時の付け替えは対象外)。
 */
export const MEMO_TOTAL_LIMIT = 300;
export const MEMO_TOTAL_CHARS_LIMIT = 200_000;

/** 判定に要る最小の形 (`ScheduleSessionMemo` の部分集合)。 */
export type MemoOwnership = {
  /** 所有者の Discord ID。移行前の行と匿名投稿は null。 */
  authorUserId: string | null;
};

/** 見ている人。未ログイン / demo ゲストは `id: null`。 */
export type MemoViewer = {
  id: string | null;
  isAdmin: boolean;
};

/** 自分のメモか (所有者が記録されていて、それが見ている人と一致する)。 */
export function isOwnMemo(memo: MemoOwnership, viewer: MemoViewer): boolean {
  return (
    viewer.id !== null &&
    memo.authorUserId !== null &&
    memo.authorUserId === viewer.id
  );
}

/** 所有者が記録されていない行 (移行前 / 匿名)。 */
export function isOrphanMemo(memo: MemoOwnership): boolean {
  return memo.authorUserId === null;
}

/** 編集できるか。所有者不明の行は admin だけ (文面のすり替えを防ぐ)。 */
export function canEditMemo(memo: MemoOwnership, viewer: MemoViewer): boolean {
  return viewer.isAdmin || isOwnMemo(memo, viewer);
}

/**
 * 削除できるか。編集と同じ (自分のメモ か admin)。2026-10-02 (S-10) に
 * 所有者不明の行の削除開放を閉じたので、編集と削除の規則は同じになった。
 */
export function canDeleteMemo(
  memo: MemoOwnership,
  viewer: MemoViewer,
): boolean {
  return canEditMemo(memo, viewer);
}
