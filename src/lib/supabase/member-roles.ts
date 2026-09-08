import { createClient } from "./server";
import { buildRoleByName, type RoleByName } from "@/lib/member-roles";

/**
 * 表示名 → ロールの対応 (UI-4、2026-09-08)。
 *
 * 軽減表のカードを「自分のロールだけ」に絞るために読む。ロールを 1 つも
 * 設定していない固定では **空オブジェクト**を返し、UI 側はトグルを出さない
 * (押しても全部が残るだけのボタンは壊れて見える)。
 *
 * 失敗時も空を返す — ロールが引けないのは表示の劣化でしかなく、軽減表
 * 本体の描画を止める理由にはならない (他の fetcher と同じ degrade 方針)。
 */
export async function fetchMemberRoleByName(): Promise<RoleByName> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("native_schedule_members")
      .select("display_name, role")
      .eq("is_active", true);
    if (error || !data) return {};
    return buildRoleByName(
      (data as Array<{ display_name: string; role?: string | null }>).map(
        (r) => ({ displayName: r.display_name ?? "", role: r.role ?? null }),
      ),
    );
  } catch (err) {
    // Next の内部 sentinel (DYNAMIC_SERVER_USAGE 等) は再 throw する
    // (他の fetcher と同じ扱い)。
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      ((err as { digest: string }).digest === "DYNAMIC_SERVER_USAGE" ||
        (err as { digest: string }).digest.startsWith("NEXT_"))
    ) {
      throw err;
    }
    console.warn("[member-roles] fetch failed:", err);
    return {};
  }
}
