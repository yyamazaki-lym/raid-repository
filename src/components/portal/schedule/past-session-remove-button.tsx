"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { excludePastSessionAction } from "@/lib/server/categories-actions";
import type { ScheduleSourceMode } from "@/lib/schedule/source-mode";

/**
 * 2.9 (2026-08-24): 過去ログ (簡易チップ / 詳細表) の admin 専用ゴミ箱アイコン。
 *
 * 用途 (ユーザー要望): 「実施しなかったのに、取り消しを忘れたせいで記録された
 * 日」を過去ログから消す。設定ダイアログの「DB の保存件数」の × 削除は
 * (a) 直近 20 行しか出ない、(b) sync 経路の Discord/snapshot 行しか消せない、
 * (c) 消しても翌日の snapshot / 取り込みで復活する、という制約があったため、
 * 過去ログの現物を見ながら 1 クリックで消せる導線をこちらに用意する。
 *
 * 実際の消し方はモードで違うが分岐は Server Action 側 (`excludePastSessionAction`)
 * に寄せてあり、ここは確認ダイアログの文言だけモードで切り替える:
 * - native: `status='CANCELLED'` (設定ダイアログ「中止した日程」から復帰)
 * - sync:   `schedule_past_sessions.excluded_at` に印 (設定ダイアログ
 *   「過去ログから除外中の日程」から復帰。出欠スナップショットと FFLogs URL は
 *   行に残るので、解除するとそのまま戻る)
 */
export function PastSessionRemoveButton({
  rawDate,
  displayDate,
  mode,
  sessionDetails,
  size = "default",
}: {
  /** `2026/08/05(水) 21:00~23:00` 形式の元表記 (DB のキー)。 */
  rawDate: string;
  /** 確認ダイアログ / toast 用の表示日 (通常は rawDate の日付部分)。 */
  displayDate: string;
  /** スケジュールソースモード。確認ダイアログの文言分岐のみに使う。 */
  mode: ScheduleSourceMode;
  /**
   * sync mode で `schedule_past_sessions` に行がまだ無い日 (snapshot 前 /
   * Discord 通知なし) 用。除外済みプレースホルダ行の作成に使う。
   */
  sessionDetails?: {
    parsedDate: string;
    startTime: string;
    endTime: string;
    dayOfWeek: string;
  };
  /**
   * `default` (h-5 w-5) は詳細表、`compact` (h-4 w-4) は簡易チップ用。
   * `SessionActionIcons` の size と同じ寸法体系。
   */
  size?: "default" | "compact";
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, startTransition] = useTransition();

  const triggerSizeClass = size === "compact" ? "h-4 w-4" : "h-5 w-5";
  const iconSizeClass = size === "compact" ? "h-2.5 w-2.5" : "h-3 w-3";

  const onClick = async () => {
    const description =
      mode === "native"
        ? `「${displayDate}」を未実施 (中止) として過去ログから外します。\n\n出欠の記録は残るので、設定ダイアログの「中止した日程」から元に戻せます。`
        : `「${displayDate}」を未実施として過去ログから外します。\n\n出欠のスナップショットと FFLogs URL は残したまま非表示にするので、設定ダイアログの「過去ログから除外中の日程」から元に戻せます。自動取り込み / スナップショットで復活することもありません。`;
    if (
      !(await confirm({
        title: "この日を過去ログから消す",
        description,
        confirmText: "過去ログから消す",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const r = await excludePastSessionAction({ rawDate, sessionDetails });
      if (!r.ok) {
        toast.error("削除できませんでした: " + r.reason);
        return;
      }
      toast.success(
        r.method === "native-cancelled"
          ? `「${displayDate}」を中止にしました (過去ログから消えます)`
          : `「${displayDate}」を過去ログから外しました`,
      );
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`${displayDate} を過去ログから消す`}
      title="実施しなかった日を過去ログから消す (admin)"
      className={
        `inline-flex ${triggerSizeClass} shrink-0 items-center justify-center rounded ` +
        "text-muted-foreground/70 transition-all hover:bg-rose-500/15 hover:text-rose-300 " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60 active:scale-95 " +
        "disabled:opacity-40"
      }
    >
      {busy ? (
        <Loader2 className={`${iconSizeClass} animate-spin`} aria-hidden />
      ) : (
        <Trash2 className={iconSizeClass} aria-hidden />
      )}
    </button>
  );
}
