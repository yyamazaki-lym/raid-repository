import "server-only";
import { randomUUID } from "node:crypto";
import { acquireLease, type LeaseOps } from "@/lib/sync-lease";

/**
 * `src/lib/sync-lease.ts` の取り合いを `app_settings` の 1 行で行う
 * (2026-10-01 監査 C-5)。
 *
 * ロック名ごとに 1 行。リンク段と pull 取り込み段は別のロックにする —
 * 重なって困るのは「同じ段が 2 本」(auto リンクの消去と付け直し / 通知の
 * 二重) で、段どうしは並んでも問題ない。
 */
export const FFLOGS_LINK_LEASE_KEY = "fflogs_link_sync_lease";
export const FFLOGS_FIGHTS_LEASE_KEY = "fflogs_fights_sync_lease";

/** `app_settings` を読み書きできるクライアント (cookie / service role のどちらでも)。 */
type SettingsClient = {
  from: (table: "app_settings") => {
    update: (values: { value: string }) => {
      eq: (col: "key", v: string) => {
        lt: (col: "value", v: string) => { select: (c: "key") => PromiseLike<DbRes> };
        is: (col: "value", v: null) => { select: (c: "key") => PromiseLike<DbRes> };
      };
    };
    upsert: (
      row: { key: string; value: string },
      opts: { onConflict: "key"; ignoreDuplicates: true },
    ) => { select: (c: "key") => PromiseLike<DbRes> };
    delete: () => { eq: (col: "key", v: string) => { eq: (col: "value", v: string) => PromiseLike<{ error: { message: string } | null }> } };
  };
};
type DbRes = { data: unknown[] | null; error: { message: string } | null };

function touched(res: DbRes): boolean {
  if (res.error) throw new Error(res.error.message);
  return (res.data?.length ?? 0) > 0;
}

function opsFor(client: SettingsClient, key: string): LeaseOps {
  return {
    takeExpired: async (value, nowIso) =>
      touched(
        await client
          .from("app_settings")
          .update({ value })
          .eq("key", key)
          .lt("value", nowIso)
          .select("key"),
      ),
    takeNull: async (value) =>
      touched(
        await client
          .from("app_settings")
          .update({ value })
          .eq("key", key)
          .is("value", null)
          .select("key"),
      ),
    insertIfAbsent: async (value) =>
      touched(
        await client
          .from("app_settings")
          .upsert({ key, value }, { onConflict: "key", ignoreDuplicates: true })
          .select("key"),
      ),
  };
}

/**
 * ロックを取って `fn` を走らせ、終わったら解放する。他の実行が持っていたら
 * `fn` を走らせずに `onBusy()` を返す。
 *
 * ロックの取得自体が DB エラーで失敗したときは、**ロック無しで走らせる**
 * (fail-open)。ロックは無駄を省くためのもので、取れないことを理由に日次の
 * 同期を止める方が害が大きい。
 */
export async function withSyncLease<T>(
  client: unknown,
  key: string,
  fn: () => Promise<T>,
  onBusy: () => T,
): Promise<T> {
  const c = client as SettingsClient;
  let held: string | null = null;
  try {
    held = await acquireLease(opsFor(c, key), Date.now(), randomUUID());
    if (held === null) return onBusy();
  } catch (e) {
    console.warn(`[sync-lease] ${key} acquire failed — running without lock:`, e);
  }
  try {
    return await fn();
  } finally {
    if (held !== null) {
      const { error } = await c
        .from("app_settings")
        .delete()
        .eq("key", key)
        .eq("value", held);
      if (error) console.warn(`[sync-lease] ${key} release failed:`, error.message);
    }
  }
}
