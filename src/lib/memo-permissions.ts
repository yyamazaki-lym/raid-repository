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
 * | 所有者不明 (`authorUserId === null`) | ✕ | ○ (ログイン済みメンバー) |
 * | 他人のメモ | ✕ | ✕ |
 *
 * **所有者不明の行を「削除だけ」開けるのは 2026-09-09 のユーザー決定。**
 * `author_user_id` は 2026-09-09 に足した列なので、それ以前のメモは全部
 * NULL で、admin 以外は片付けられなかった。誰の物か分からない行は
 * **書き換えさせない (履歴が別人の文面にすり替わる)** が、**消すのは許す**。
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
 * 削除できるか。編集できる人に加えて、**所有者不明の行はログイン済み
 * メンバーなら誰でも**消せる。
 */
export function canDeleteMemo(
  memo: MemoOwnership,
  viewer: MemoViewer,
): boolean {
  if (canEditMemo(memo, viewer)) return true;
  return isOrphanMemo(memo) && viewer.id !== null;
}
