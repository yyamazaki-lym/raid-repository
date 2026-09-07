import { cache } from "react";
import { createClient, createSupabaseServiceRoleClient } from "./server";
import { requireDiscordMember } from "@/lib/server/auth";

/**
 * 攻略リンクの既読状態 (W-27) とタグ (B-1) の読み取り (2026-09-07)。
 *
 * ## 既読を service role で読む理由
 *
 * `category_link_reads` は RLS 有効 + **policy なし** で、anon /
 * authenticated からは 1 行も読めない (schema.sql 6b-8)。誰が何を読んだかの
 * 生データは公開 anon key で列挙されてはいけないためで、本モジュールが
 * service role で読んで**集計してから**返す。client に渡るのは
 *
 *   - 自分が既読か (boolean)
 *   - 未読の人数 (number)
 *   - admin のときだけ未読メンバーの表示名 (string[])
 *
 * の 3 つだけ。「誰が未読かは幹部のみ」(調査ノート第 4 回 W-27) をデータの
 * 出口で担保する — UI 側の出し分けだけに頼ると、RSC payload に生データが
 * 載ってしまう。
 *
 * ## 母数
 *
 * 未読人数の母数は `native_schedule_members` の **is_active な行**。
 * 抜けたメンバーの既読行 (孤児) は突き合わせで自然に無視される。
 * メンバー表が空の fork (Google Sheets モード等) では母数 0 になるので、
 * 未読人数は出さず既読トグルだけが機能する。
 */

export type LinkReadState = {
  /** 自分がこのリンクを既読にしているか。 */
  read: boolean;
  /** まだ既読にしていないアクティブメンバーの人数。 */
  unread: number;
  /** アクティブメンバーの総数 (0 ならメンバー表が未設定)。 */
  members: number;
  /**
   * 未読メンバーの表示名。**admin にのみ** 入る (非 admin は null)。
   * 名前は出しても「読んでいない人」だけで、既読者の一覧は返さない。
   */
  unreadNames: string[] | null;
};

/** リンク ID → 既読状態。渡した ID は必ずキーとして埋まる。 */
export type LinkReadMap = Record<string, LinkReadState>;

function emptyState(read = false): LinkReadState {
  return { read, unread: 0, members: 0, unreadNames: null };
}

/**
 * 複数リンクの既読状態をまとめて取る。
 *
 * `canEdit` は呼び出し側 (page) が `getCurrentUserCanEdit()` で得た値を
 * 渡す。ここで再取得しないのは、page 側が既に並列プリフェッチしていて
 * 二重問い合わせになるため。
 */
export async function fetchCategoryLinkReads(
  linkIds: ReadonlyArray<string>,
  canEdit: boolean,
): Promise<LinkReadMap> {
  const out: LinkReadMap = {};
  for (const id of linkIds) out[id] = emptyState();
  if (linkIds.length === 0) return out;

  let me: string | null = null;
  try {
    const member = await requireDiscordMember();
    // demo ゲストは固定 ID なので「自分の既読」は持たせない (書き込みも
    // Server Action 側で弾く)。
    me = member.isDemoGuest ? null : member.discordId;
  } catch (err) {
    rethrowNextSentinel(err);
    return out;
  }

  try {
    const admin = createSupabaseServiceRoleClient();
    const [readsRes, membersRes] = await Promise.all([
      admin
        .from("category_link_reads")
        .select("link_id, discord_user_id")
        .in("link_id", linkIds as string[]),
      admin
        .from("native_schedule_members")
        .select("discord_user_id, display_name, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);
    if (readsRes.error) {
      console.warn(
        "[supabase/category-link-reads] reads fetch error:",
        readsRes.error.message,
      );
      return out;
    }
    const members = (membersRes.data ?? []) as Array<{
      discord_user_id: string;
      display_name: string;
    }>;
    // link_id → 既読にしたメンバーの ID 集合。
    const readBy = new Map<string, Set<string>>();
    for (const r of (readsRes.data ?? []) as Array<{
      link_id: string;
      discord_user_id: string;
    }>) {
      let set = readBy.get(r.link_id);
      if (!set) readBy.set(r.link_id, (set = new Set()));
      set.add(r.discord_user_id);
    }

    for (const id of linkIds) {
      const set = readBy.get(id) ?? new Set<string>();
      const unreadMembers = members.filter((mem) => !set.has(mem.discord_user_id));
      out[id] = {
        read: me !== null && set.has(me),
        unread: unreadMembers.length,
        members: members.length,
        unreadNames: canEdit ? unreadMembers.map((mem) => mem.display_name) : null,
      };
    }
    return out;
  } catch (err) {
    rethrowNextSentinel(err);
    console.warn("[supabase/category-link-reads] read error:", err);
    return out;
  }
}

/**
 * カテゴリのリンクに付いているタグ (B-1)。
 *
 * タグは `tags` テーブル (target_type='category_link') に持つ。既読と違い
 * 秘匿する情報ではないので通常の RLS 経路 (authenticated SELECT) で読む。
 *
 * 戻り値はリンク ID → ラベル配列。並びは `label` 昇順で固定する
 * (作成順にすると同じカードでもリロードでチップの順が動く)。
 */
export const fetchCategoryLinkTags = cache(
  async (linkIds: ReadonlyArray<string>): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    for (const id of linkIds) out[id] = [];
    if (linkIds.length === 0) return out;
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("tags")
        .select("target_id, label")
        .eq("target_type", "category_link")
        .in("target_id", linkIds as string[])
        .order("label", { ascending: true });
      if (error) {
        console.warn("[supabase/category-link-reads] tag fetch error:", error.message);
        return out;
      }
      for (const r of (data ?? []) as Array<{ target_id: string; label: string }>) {
        (out[r.target_id] ??= []).push(r.label);
      }
      return out;
    } catch (err) {
      rethrowNextSentinel(err);
      console.warn("[supabase/category-link-reads] tag read error:", err);
      return out;
    }
  },
);

/**
 * Next.js の prerender bailout はそのまま投げ直す (他の読み取りモジュールと
 * 同じ扱い — catch で潰すと動的レンダリングへの切り替えが効かなくなる)。
 */
function rethrowNextSentinel(err: unknown): void {
  if (
    err &&
    typeof err === "object" &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string"
  ) {
    const digest = (err as { digest: string }).digest;
    if (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_")) {
      throw err;
    }
  }
}
