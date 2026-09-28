import { toast } from "sonner";
import { importFflogsReportsAction } from "@/lib/server/fflogs-fights-actions";
import type { Messages } from "@/lib/i18n/messages";

/**
 * 日付に Logs を登録した直後に、そのレポートだけを練習ログへ取り込む
 * (2026-09-28)。同期式 (session-memo-popover) と自前作成式
 * (native-fflogs-link-popover) の両方から呼ぶ。
 *
 * 登録の Server Action とは別の呼び出しにする (取り込みは FFLogs への
 * 往復で数十秒かかることがあり、登録のトーストを待たせないため)。
 * 取り込みに失敗しても登録は成功のまま — 取りこぼしは JST 04:00 の
 * 同期 cron が日付登録済みの Logs も拾って埋める。
 */
export async function importRegisteredLogs(
  url: string,
  m: Messages["fflogsLink"],
): Promise<void> {
  const id = toast.loading(m.importing);
  try {
    const r = await importFflogsReportsAction(url);
    if (!r.ok) {
      toast.error(m.importFailed(r.reason), { id });
      return;
    }
    if (r.failed > 0 && r.fightsUpserted === 0) {
      toast.error(m.importFailed(r.failures[0]?.reason ?? ""), { id });
      return;
    }
    toast.success(m.imported(r.fightsUpserted), { id });
  } catch (err) {
    toast.error(m.importFailed(String(err)), { id });
  }
}
