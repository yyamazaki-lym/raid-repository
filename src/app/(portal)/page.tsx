import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ScheduleDisabledNotice } from "@/components/portal/schedule-disabled-notice";
import { ScheduleOnboarding } from "@/components/portal/schedule-onboarding";
import { SchedulePageBody } from "@/components/portal/schedule-page-body";
import { fetchJapaneseHolidays } from "@/lib/japanese-holidays";
import { fetchNativeSchedule } from "@/lib/schedule/native-fetch";
import {
  fetchSchedule,
  pickNextDecision,
  type NextSessionResult,
} from "@/lib/schedule/next-session";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
import { getScheduleSourceUrl } from "@/lib/schedule/source-url";
import { SCHEDULE_TOP_TEXT_OVERRIDE_KEY } from "@/lib/schedule-top-text-keys";
import { fetchSessionLogsByDate } from "@/lib/server/fflogs";
import { fetchScheduleMemosByDateBulk } from "@/lib/server/schedule-memos-fetch";
import { buildSessionVideoLinkMap } from "@/lib/server/session-video-link";
import { fetchAppSettings } from "@/lib/supabase/app-settings";
import { fetchCategories } from "@/lib/supabase/categories";
import { fetchRecruitmentTemplatesServer } from "@/lib/supabase/recruitment-templates";
import {
  getAuthorizedUserRoles,
  requireDiscordMember,
  userIsAdmin,
} from "@/lib/server/auth";
import { filterVisibleCategories } from "@/lib/category-visibility";

export const metadata = {
  title: "スケジュール",
};

/**
 * 1.9 (2026-04-28) TODO #11: Edge Runtime 化でコールドスタートを短縮。
 *
 * Vercel Free tier では Node.js Function に 500ms〜1.5s のコールド
 * スタートペナルティがあるが、Edge Function は ~50ms。リロード時の
 * 「引っ掛かり」体感の主要因なのでまず Edge を試す。
 *
 * 互換性チェック済み:
 *   - `@supabase/ssr` server client: Edge 公式対応
 *   - `next/headers` cookies(): Edge 対応
 *   - 外部 fetch (character-sheets / fflogs / 祝日 API): Edge 対応
 *   - `Buffer.from(...).toString("base64")` を `btoa()` に置換済み
 *     (`fflogs-oauth.ts` の OAuth Basic 認証ヘッダー)
 *
 * 別ルート (/api/auth/fflogs/callback など) は Node Runtime 維持。
 * runtime config は per-route なので独立に運用できる。
 */
export const runtime = "edge";

/**
 * 2.1 (2026-05-01) TODO #55 part2 — Suspense streaming で FCP 改善。
 *
 * 旧 (1.9 (2026-04-28) 初期): 主データロードを `<Suspense fallback={skeleton}>`
 * でラップしていたが、「skeleton → 実コンテンツ swap」体感が悪く synchronous
 * に戻していた経緯あり (詳細は git log)。
 *
 * `(portal)/layout.tsx` の SiteHeader / MainTabs が data 完了直後に flush
 * されて FCP を計上するため、page 側の重い `Promise.all` を Suspense 境界の
 * 向こう側に追い出すだけで効果が出る。h1 は SchedulePageBody 内で既に描画
 * されているので shell には重複させない。
 *
 * 2.1 (2026-05-01) TODO #57 — fallback に遅延 fade-in "Now Loading" を投入。
 * `scheduleLoadingFadeIn` keyframe (globals.css) で `opacity: 0 → 1` を
 * `0.5s delay + 0.3s duration` で発火。ロードが 500ms 未満なら fallback は
 * 視認されず TODO #55 part2 の swap 違和感回避は維持、500ms を超える場合
 * のみ穏やかに "Now Loading" が出るので「真っ白」体感を解消できる。
 */
export default function SchedulePage() {
  return (
    <Suspense fallback={<ScheduleLoadingFallback />}>
      <ScheduleContent />
    </Suspense>
  );
}

function ScheduleLoadingFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground"
      style={{
        opacity: 0,
        animation: "scheduleLoadingFadeIn 300ms ease-out 500ms forwards",
      }}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="text-sm">Now Loading...</span>
    </div>
  );
}

async function ScheduleContent() {
  // TODO #2 phase 1 (2026-05-07): スケジュールソースモードで分岐。
  // - sync     → 既存の character-sheets fetch + parse path
  // - native   → 自前テーブル fetch (phase 1 では空 skeleton)
  // - disabled → 機能停止 notice のみ
  const mode = await getScheduleSourceMode();

  if (mode === "disabled") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-xl text-foreground sm:text-2xl">
          Schedule
        </h1>
        <ScheduleDisabledNotice />
      </div>
    );
  }

  if (mode === "sync") {
    const url = await getScheduleSourceUrl();

    // No URL yet — render an onboarding card that lets the user register
    // one inline (same shape as the settings dialog body, but not behind
    // a gear).
    if (!url) {
      return (
        <div className="flex flex-col gap-4">
          <h1 className="font-display text-xl text-foreground sm:text-2xl">
            Schedule
          </h1>
          <ScheduleOnboarding />
        </div>
      );
    }

    const [
      result,
      holidays,
      recruitmentTemplates,
      categoriesResult,
      userRoles,
      sessionLogsByDate,
      appSettings,
      initialMemosByDate,
    ] = await Promise.all([
      fetchSchedule(),
      fetchJapaneseHolidays(),
      fetchRecruitmentTemplatesServer(),
      fetchCategories(),
      getAuthorizedUserRoles(),
      fetchSessionLogsByDate(),
      fetchAppSettings([SCHEDULE_TOP_TEXT_OVERRIDE_KEY]),
      fetchScheduleMemosByDateBulk(),
    ]);
    const topTextOverride = appSettings[SCHEDULE_TOP_TEXT_OVERRIDE_KEY] ?? null;
    const visibleCategories = categoriesResult.ok
      ? filterVisibleCategories(categoriesResult.categories, userRoles)
      : [];
    const recruitmentCategoryOptions = visibleCategories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
    }));
    const hasUltimateClear = visibleCategories.some(
      (c) => c.name.startsWith("絶") && c.status === "クリア済",
    );
    const sessionVideoLinks = result.ok
      ? await buildSessionVideoLinkMap(result.data.sessions)
      : {};
    const nextResult: NextSessionResult = result.ok
      ? { ok: true, session: pickNextDecision(result.data.sessions) }
      : { ok: false, reason: result.reason };

    return (
      <SchedulePageBody
        result={result}
        nextResult={nextResult}
        scheduleUrl={url}
        mode="sync"
        holidays={holidays}
        recruitmentTemplates={recruitmentTemplates}
        recruitmentCategories={recruitmentCategoryOptions}
        sessionVideoLinks={sessionVideoLinks}
        sessionLogsByDate={sessionLogsByDate}
        hasUltimateClear={hasUltimateClear}
        topTextOverride={topTextOverride}
        initialMemosByDate={initialMemosByDate}
      />
    );
  }

  // mode === "native": phase 2-A で本実装の native_schedule_* 取得 + 認証情報配線。
  // 動画リンク / FFLogs / メモ併用 fetch は将来の phase で必要に応じて足す。
  const [
    nativeResult,
    holidays,
    recruitmentTemplates,
    categoriesResult,
    userRoles,
    member,
  ] = await Promise.all([
    fetchNativeSchedule(),
    fetchJapaneseHolidays(),
    fetchRecruitmentTemplatesServer(),
    fetchCategories(),
    getAuthorizedUserRoles(),
    requireDiscordMember(),
  ]);
  const visibleCategories = categoriesResult.ok
    ? filterVisibleCategories(categoriesResult.categories, userRoles)
    : [];
  const recruitmentCategoryOptions = visibleCategories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
  }));
  const hasUltimateClear = visibleCategories.some(
    (c) => c.name.startsWith("絶") && c.status === "クリア済",
  );
  const sessionVideoLinks = nativeResult.ok
    ? await buildSessionVideoLinkMap(nativeResult.data.sessions)
    : {};
  const nextResult: NextSessionResult = nativeResult.ok
    ? { ok: true, session: pickNextDecision(nativeResult.data.sessions) }
    : { ok: false, reason: nativeResult.reason };
  const isAdmin = userIsAdmin(userRoles);

  return (
    <SchedulePageBody
      result={nativeResult}
      nextResult={nextResult}
      scheduleUrl={null}
      mode="native"
      holidays={holidays}
      recruitmentTemplates={recruitmentTemplates}
      recruitmentCategories={recruitmentCategoryOptions}
      sessionVideoLinks={sessionVideoLinks}
      sessionLogsByDate={{}}
      hasUltimateClear={hasUltimateClear}
      topTextOverride={null}
      initialMemosByDate={{}}
      currentDiscordId={member.discordId}
      isAdmin={isAdmin}
    />
  );
}
