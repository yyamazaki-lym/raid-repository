import { createClient } from "./server";
import type { CategoryBisLink, LootWeeklyRow, LootWeeklyStatus } from "@/lib/loot-weekly";
import { isLootWeeklyStatus } from "@/lib/loot-weekly";

/**
 * ロットタブの追加データ (TODO #94)。
 *   - `category_bis_links`  … コンテンツごとの最適装備 (BiS) リンク
 *   - `loot_weekly_checks`  … 今週の消化チェック
 *
 * どちらも失敗時は空配列を返し、ロットタブ本体 (Sheets iframe) の描画は
 * 妨げない (他の fetcher と同じ degrade 方針)。
 */

export async function fetchCategoryBisLinks(
  categoryId: string,
): Promise<CategoryBisLink[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("category_bis_links")
      .select("*")
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      categoryId: r.category_id as string,
      label: (r.label as string) ?? "",
      url: r.url as string,
      job: (r.job as string | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      sortOrder: r.sort_order as number,
    }));
  } catch (err) {
    rethrowNextSentinel(err);
    console.warn("[loot-extras] bis links error:", err);
    return [];
  }
}

/**
 * 指定週の消化チェック行を返す。
 *
 * 行が無いメンバーは「未消化」とみなすため、`native_schedule_members`
 * (固定のロスター) をベースに、既存行をマージした一覧を返す。native
 * スケジュールを使っていない固定ではロスターが空なので、その場合は
 * 「行があるメンバーだけ」+ 呼び出し側が本人分を足す形になる。
 */
export async function fetchLootWeekly(
  categoryId: string,
  weekStart: string,
  viewerDiscordId: string,
): Promise<LootWeeklyRow[]> {
  try {
    const supabase = await createClient();
    const [checksRes, membersRes] = await Promise.all([
      supabase
        .from("loot_weekly_checks")
        .select("id, discord_user_id, display_name, status, note, updated_at")
        .eq("category_id", categoryId)
        .eq("week_start", weekStart),
      supabase
        .from("native_schedule_members")
        .select("discord_user_id, display_name, sort_order, is_active")
        .order("sort_order", { ascending: true }),
    ]);

    const checks = new Map<
      string,
      {
        id: string;
        displayName: string;
        status: LootWeeklyStatus;
        note: string | null;
        updatedAt: string | null;
      }
    >();
    for (const r of checksRes.data ?? []) {
      const did = r.discord_user_id as string;
      const status = r.status as unknown;
      checks.set(did, {
        id: r.id as string,
        displayName: (r.display_name as string) ?? "",
        status: isLootWeeklyStatus(status) ? status : "未消化",
        note: (r.note as string | null) ?? null,
        updatedAt: (r.updated_at as string | null) ?? null,
      });
    }

    const out: LootWeeklyRow[] = [];
    const seen = new Set<string>();
    for (const m of membersRes.data ?? []) {
      if ((m.is_active as boolean) === false) continue;
      const did = m.discord_user_id as string;
      seen.add(did);
      const hit = checks.get(did);
      out.push({
        id: hit?.id ?? `roster:${did}`,
        displayName: hit?.displayName || ((m.display_name as string) ?? ""),
        status: hit?.status ?? "未消化",
        note: hit?.note ?? null,
        isMe: did === viewerDiscordId,
        updatedAt: hit?.updatedAt ?? null,
      });
    }
    // ロスターに載っていないが行だけある人 (旧メンバー / 同期式運用) も出す。
    for (const [did, hit] of checks) {
      if (seen.has(did)) continue;
      out.push({
        id: hit.id,
        displayName: hit.displayName || "(名前未設定)",
        status: hit.status,
        note: hit.note,
        isMe: did === viewerDiscordId,
        updatedAt: hit.updatedAt,
      });
    }
    return out;
  } catch (err) {
    rethrowNextSentinel(err);
    console.warn("[loot-extras] weekly checks error:", err);
    return [];
  }
}

/** Next.js の内部 sentinel error は握りつぶさず再送出する (他 fetcher と同方針)。 */
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
